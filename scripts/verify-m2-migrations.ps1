$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectName = "kase-m2-migration-$PID-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$composeFile = Join-Path ([IO.Path]::GetTempPath()) "$projectName.yml"
$dockerConfig = Join-Path ([IO.Path]::GetTempPath()) "$projectName-docker-config"
$previousDatabaseUrl = $env:DATABASE_URL
$previousDockerConfig = $env:DOCKER_CONFIG

try {
  New-Item -ItemType Directory -Path $dockerConfig | Out-Null
  $dockerPluginDirectory = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\cli-plugins'
  if (Test-Path -LiteralPath $dockerPluginDirectory) {
    $dockerConfigJson = @{ cliPluginsExtraDirs = @($dockerPluginDirectory) } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $dockerConfig 'config.json'), $dockerConfigJson, [Text.UTF8Encoding]::new($false))
  }
  $env:DOCKER_CONFIG = $dockerConfig
  $composeYaml = @"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: kase
      POSTGRES_PASSWORD: password
      POSTGRES_DB: kase
    ports:
      - "127.0.0.1::5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kase -d kase"]
      interval: 2s
      timeout: 3s
      retries: 30
volumes:
  postgres-data:
"@
  [IO.File]::WriteAllText($composeFile, $composeYaml, [Text.UTF8Encoding]::new($false))

  docker compose -f $composeFile -p $projectName up -d --wait postgres
  if ($LASTEXITCODE -ne 0) { throw 'Fresh PostgreSQL failed to start' }
  $portText = docker compose -f $composeFile -p $projectName port postgres 5432
  if ($LASTEXITCODE -ne 0 -or $portText -notmatch ':(\d+)\s*$') { throw "Could not resolve PostgreSQL port: $portText" }
  $env:DATABASE_URL = "postgresql://kase:password@127.0.0.1:$($Matches[1])/kase?schema=public"

  Push-Location $repoRoot
  try {
    corepack pnpm --filter '@kase/db' run migrate:deploy
    if ($LASTEXITCODE -ne 0) { throw 'First migration deployment failed' }
    corepack pnpm --filter '@kase/db' run migrate:deploy
    if ($LASTEXITCODE -ne 0) { throw 'Second migration deployment failed' }
    corepack pnpm --filter '@kase/db' run migrate:status
    if ($LASTEXITCODE -ne 0) { throw 'Migration status failed' }
  } finally { Pop-Location }

  $expected = @(
    'AuditJob_timeoutMs_check','AuditJob_maxRetries_check','AuditJob_attempts_check',
    'Evidence_sizeBytes_check','Evidence_sha256_check','Evidence_tombstone_check','Evidence_deletionLease_check',
    'OrganizationMember_role_check','EvidenceRetentionPolicy_replayable_days_check',
    'ProjectEvidenceRetentionOverride_replayable_days_check'
  )
  $constraints = docker compose -f $composeFile -p $projectName exec -T postgres psql -U kase -d kase -Atc 'SELECT conname FROM pg_constraint ORDER BY conname'
  foreach ($name in $expected) { if ($constraints -notcontains $name) { throw "Missing constraint: $name" } }
  foreach ($name in @('Audit_repositoryId_fkey','AuditEvent_auditId_fkey','BuildProvenance_auditId_fkey','OrganizationMember_userId_fkey','OrganizationMember_organizationId_fkey','EvidenceRetentionPolicy_organizationId_fkey','ProjectEvidenceRetentionOverride_projectId_fkey')) {
    if ($constraints -notcontains $name) { throw "Missing foreign key: $name" }
  }
  $indexes = docker compose -f $composeFile -p $projectName exec -T postgres psql -U kase -d kase -Atc 'SELECT indexname FROM pg_indexes WHERE schemaname = ''public'' ORDER BY indexname'
  foreach ($name in @('Evidence_live_expiry_idx','FindingIdentity_projectId_fingerprint_key','AuditEvent_auditId_sequence_key','BuildProvenance_auditId_key')) {
    if ($indexes -notcontains $name) { throw "Missing index: $name" }
  }
  $liveExpiryDefinition = docker compose -f $composeFile -p $projectName exec -T postgres psql -U kase -d kase -Atc 'SELECT indexdef FROM pg_indexes WHERE schemaname = ''public'' AND indexname = ''Evidence_live_expiry_idx'''
  if ($liveExpiryDefinition -notmatch 'WHERE \("tombstonedAt" IS NULL\)$') {
    throw "Evidence_live_expiry_idx is not partial over live evidence: $liveExpiryDefinition"
  }
  $timestampTypes = docker compose -f $composeFile -p $projectName exec -T postgres psql -U kase -d kase -Atc "SELECT table_name || '.' || column_name || '=' || data_type FROM information_schema.columns WHERE (table_name,column_name) IN (('Audit','startedAt'),('AuditJob','leaseExpiresAt'),('Evidence','expiresAt')) ORDER BY 1"
  if (($timestampTypes | Where-Object { $_ -notmatch '=timestamp with time zone$' }).Count -gt 0 -or $timestampTypes.Count -ne 3) {
    throw "Unexpected timestamp types: $($timestampTypes -join ', ')"
  }
  Write-Output 'KASE_M2_MIGRATIONS_VERIFIED'
} finally {
  $savedErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    docker compose -f $composeFile -p $projectName down --volumes --remove-orphans *> $null
  } finally {
    $ErrorActionPreference = $savedErrorAction
    if (Test-Path -LiteralPath $composeFile) { Remove-Item -LiteralPath $composeFile -Force }
    $env:DATABASE_URL = $previousDatabaseUrl
    $env:DOCKER_CONFIG = $previousDockerConfig
    if (Test-Path -LiteralPath $dockerConfig) {
      $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
      $resolvedDockerConfig = [IO.Path]::GetFullPath($dockerConfig)
      if (-not $resolvedDockerConfig.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to remove a Docker config outside the system temporary directory'
      }
      Remove-Item -LiteralPath $resolvedDockerConfig -Recurse -Force
    }
  }
}
