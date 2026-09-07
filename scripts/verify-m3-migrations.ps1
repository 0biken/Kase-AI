$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectName = "kase-m3-migration-$PID-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$composeFile = Join-Path ([IO.Path]::GetTempPath()) "$projectName.yml"
$dockerConfig = Join-Path ([IO.Path]::GetTempPath()) "$projectName-docker-config"
$previousDatabaseUrl = $env:DATABASE_URL
$previousDockerConfig = $env:DOCKER_CONFIG

try {
  New-Item -ItemType Directory -Path $dockerConfig | Out-Null
  $pluginDirectory = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\cli-plugins'
  if (Test-Path -LiteralPath $pluginDirectory) {
    [IO.File]::WriteAllText((Join-Path $dockerConfig 'config.json'), (@{ cliPluginsExtraDirs = @($pluginDirectory) } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  }
  $env:DOCKER_CONFIG = $dockerConfig
  [IO.File]::WriteAllText($composeFile, @"
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
"@, [Text.UTF8Encoding]::new($false))

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

  $constraints = docker compose -f $composeFile -p $projectName exec -T postgres psql -U kase -d kase -Atc 'SELECT conname FROM pg_constraint ORDER BY conname'
  foreach ($name in @('ReconRequestBudget_nonnegative_check','EndpointInventory_counts_check','EndpointInventory_status_check','EndpointDrift_kind_check','ReconRequestBudget_auditId_fkey','EndpointInventory_auditId_fkey','EndpointInventory_projectId_fkey','EndpointInventory_targetId_fkey','EndpointInventory_previousInventoryId_fkey','EndpointDrift_inventoryId_fkey')) {
    if ($constraints -notcontains $name) { throw "Missing M3 constraint: $name" }
  }
  $indexes = docker compose -f $composeFile -p $projectName exec -T postgres psql -U kase -d kase -Atc 'SELECT indexname FROM pg_indexes WHERE schemaname = ''public'' ORDER BY indexname'
  foreach ($name in @('EndpointInventory_auditId_key','EndpointInventory_projectId_targetId_generatedAt_idx','Endpoint_inventoryId_method_pathTemplate_key','EndpointDrift_inventoryId_endpointKey_kind_key')) {
    if ($indexes -notcontains $name) { throw "Missing M3 index: $name" }
  }
  $timestampTypes = docker compose -f $composeFile -p $projectName exec -T postgres psql -U kase -d kase -Atc "SELECT table_name || '.' || column_name || '=' || data_type FROM information_schema.columns WHERE (table_name,column_name) IN (('EndpointInventory','generatedAt'),('EndpointDrift','createdAt'),('ReconRequestBudget','updatedAt')) ORDER BY 1"
  if (($timestampTypes | Where-Object { $_ -notmatch '=timestamp with time zone$' }).Count -gt 0 -or $timestampTypes.Count -ne 3) { throw "Unexpected M3 timestamp types: $($timestampTypes -join ', ')" }
  $requiredEndpointColumns = docker compose -f $composeFile -p $projectName exec -T postgres psql -U kase -d kase -Atc "SELECT column_name || '=' || is_nullable FROM information_schema.columns WHERE table_name='Endpoint' AND column_name IN ('rawExamples','discoveredBy','statusObserved','parameters','technologies') ORDER BY column_name"
  if ($requiredEndpointColumns.Count -ne 5 -or ($requiredEndpointColumns | Where-Object { $_ -notmatch '=NO$' }).Count -gt 0) { throw "M3 Endpoint collection columns are unexpectedly nullable: $($requiredEndpointColumns -join ', ')" }
  Write-Output 'KASE_M3_MIGRATIONS_VERIFIED'
} finally {
  $saved = $ErrorActionPreference
  try { $ErrorActionPreference = 'Continue'; docker compose -f $composeFile -p $projectName down --volumes --remove-orphans *> $null }
  finally {
    $ErrorActionPreference = $saved
    if (Test-Path -LiteralPath $composeFile) { Remove-Item -LiteralPath $composeFile -Force }
    $env:DATABASE_URL = $previousDatabaseUrl
    $env:DOCKER_CONFIG = $previousDockerConfig
    if (Test-Path -LiteralPath $dockerConfig) {
      $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
      $resolved = [IO.Path]::GetFullPath($dockerConfig)
      if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to remove Docker config outside temp' }
      Remove-Item -LiteralPath $resolved -Recurse -Force
    }
  }
}
