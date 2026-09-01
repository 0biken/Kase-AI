[CmdletBinding()]
param(
  [switch]$KeepStack,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

function New-KaseId([string]$prefix) {
  $alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  $chars = New-Object char[] 26
  $chars[0] = '0'
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 25
  $random.GetBytes($bytes)
  $random.Dispose()
  for ($i = 1; $i -lt 26; $i++) {
    $chars[$i] = $alphabet[$bytes[$i - 1] % $alphabet.Length]
  }
  return "${prefix}_$(-join $chars)"
}

function Get-Sha256([string]$value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($value)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally {
    $sha.Dispose()
  }
}

function Invoke-Psql([string]$sql) {
  $value = $sql | & docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -At -U kase -d kase
  if ($LASTEXITCODE -ne 0) { throw 'Postgres command failed' }
  return ($value | Out-String).Trim()
}

function Wait-Until([scriptblock]$Probe, [string]$Description, [int]$Seconds = 90) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $result = & $Probe
    if ($result) { return $result }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for $Description"
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI is not available.'
}
$previousErrorPreference = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
& docker info *> $null
$dockerInfoExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorPreference
if ($dockerInfoExitCode -ne 0) {
  throw 'Docker Linux engine is not running. Install/enable WSL 2, then start Docker Desktop.'
}

if (-not $env:KASE_LOCAL_KEK) {
  $kek = [byte[]]::new(32)
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  $random.GetBytes($kek)
  $random.Dispose()
  $env:KASE_LOCAL_KEK = [Convert]::ToBase64String($kek)
}

$organizationId = New-KaseId 'org'
$projectId = New-KaseId 'prj'
$gatePolicyId = New-KaseId 'gpol'
$scopePolicyId = New-KaseId 'scp'
$targetId = New-KaseId 'tgt'
$blockedTargetId = New-KaseId 'tgt'
$tokenId = New-KaseId 'tok'
$tokenPlaintext = "kase_$([Guid]::NewGuid().ToString('N'))"
$tokenHash = Get-Sha256 $tokenPlaintext
$secretName = "m1-proof-$([Guid]::NewGuid().ToString('N'))"

try {
  if ($SkipBuild) {
    & docker compose up -d postgres redis minio minio-init fixture egress-proxy migrate api worker-recon
  } else {
    & docker compose up --build -d postgres redis minio minio-init fixture egress-proxy migrate api worker-recon
  }
  if ($LASTEXITCODE -ne 0) { throw 'Compose stack did not start' }

  Wait-Until -Description 'API readiness' -Probe {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3002/api/v1/projects' -Headers @{ Authorization = "Bearer $tokenPlaintext" } -TimeoutSec 2 | Out-Null
      return $true
    } catch {
      # A 401 still proves Nest is listening; seed data is inserted below.
      if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) { return $true }
      return $false
    }
  } | Out-Null

  $seedSql = @"
INSERT INTO "Organization" ("id", "name", "slug")
VALUES ('$organizationId', 'M1 Proof', 'm1-proof-$($projectId.Substring($projectId.Length - 8))');
INSERT INTO "Project" ("id", "organizationId", "name", "slug", "defaultGatePolicyId")
VALUES ('$projectId', '$organizationId', 'M1 Proof', 'm1-proof-$($projectId.Substring($projectId.Length - 8))', '$gatePolicyId');
INSERT INTO "GatePolicy" ("id", "projectId", "version", "name", "rules")
VALUES ('$gatePolicyId', '$projectId', 1, 'default', '{"blockOn":{"requiresReplayableEvidence":true}}');
INSERT INTO "ScopePolicy" ("id", "projectId", "allowedHosts", "deniedPaths", "maxRequestsPerSecond", "maxRequestsPerAudit", "destructiveAllowed", "authorizationAttestedBy", "authorizationAttestedAt")
VALUES ('$scopePolicyId', '$projectId', ARRAY['fixture'], ARRAY[]::TEXT[], 10, 50, FALSE, 'm1-proof', CURRENT_TIMESTAMP);
INSERT INTO "Target" ("id", "projectId", "name", "baseUrl", "environment", "authMode")
VALUES ('$targetId', '$projectId', 'fixture', 'http://fixture:3000', 'local', 'none');
INSERT INTO "ApiToken" ("id", "projectId", "name", "tokenHash", "displayPrefix", "role", "createdBy")
VALUES ('$tokenId', '$projectId', 'M1 proof', '$tokenHash', '$($tokenPlaintext.Substring(0, 8))', 'admin', 'm1-proof');
"@
  Invoke-Psql $seedSql | Out-Null

  $headers = @{ Authorization = "Bearer $tokenPlaintext" }
  $secret = Invoke-RestMethod -Method Post -Uri "http://localhost:3002/api/v1/projects/$projectId/secrets" -Headers ($headers + @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }) -ContentType 'application/json' -Body (@{
      name = $secretName
      kind = 'target_header'
      value = 'X-Kase-M1-Proof: secret-must-not-leak'
    } | ConvertTo-Json)
  if ($secret.PSObject.Properties.Name -contains 'value') { throw 'Secret API returned plaintext' }

  Invoke-Psql "UPDATE `"Target`" SET `"authMode`"='header', `"authCredentialId`"='$($secret.id)' WHERE `"id`"='$targetId';" | Out-Null

  $audit = Invoke-RestMethod -Method Post -Uri "http://localhost:3002/api/v1/projects/$projectId/audits" -Headers ($headers + @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }) -ContentType 'application/json' -Body (@{
      targetId = $targetId
      mode = 'smoke'
      category = 'fixture_health'
    } | ConvertTo-Json)

  Wait-Until -Description 'successful recon audit' -Probe {
    $status = Invoke-Psql "SELECT `"status`" FROM `"Audit`" WHERE `"id`"='$($audit.id)';"
    if ($status -eq 'failed') { throw 'Allowed fixture audit failed' }
    if ($status -eq 'completed') { return $status }
    return $null
  } | Out-Null

  $evidence = Invoke-Psql "SELECT `"artifactUri`" || '|' || `"sha256`" || '|' || `"sizeBytes`" FROM `"Evidence`" WHERE `"auditId`"='$($audit.id)';"
  if (-not $evidence) { throw 'No evidence row was persisted' }
  $uri, $databaseSha, $databaseSize = $evidence.Split('|')
  $objectPath = $uri.Replace('s3://kase-evidence/', '')
  $objectProof = & docker compose run --rm --entrypoint sh minio-init -c "mc alias set local http://minio:9000 minioadmin minioadmin >/dev/null && mc cat local/kase-evidence/$objectPath | sha256sum"
  if ($LASTEXITCODE -ne 0) { throw 'Evidence object could not be read from MinIO' }
  $objectSha = ($objectProof -split '\s+')[0]
  if ($objectSha -ne $databaseSha) { throw "Evidence hash mismatch: DB=$databaseSha object=$objectSha" }
  if ([int64]$databaseSize -le 0) { throw 'Evidence size is not positive' }

  Invoke-Psql "UPDATE `"ScopePolicy`" SET `"allowedHosts`"=ARRAY['blocked.invalid'] WHERE `"id`"='$scopePolicyId'; INSERT INTO `"Target`" (`"id`", `"projectId`", `"name`", `"baseUrl`", `"environment`", `"authMode`") VALUES ('$blockedTargetId', '$projectId', 'blocked', 'http://blocked.invalid:3000', 'local', 'none');" | Out-Null
  $blockedAudit = Invoke-RestMethod -Method Post -Uri "http://localhost:3002/api/v1/projects/$projectId/audits" -Headers ($headers + @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }) -ContentType 'application/json' -Body (@{
      targetId = $blockedTargetId
      mode = 'smoke'
      category = 'fixture_health'
    } | ConvertTo-Json)

  Wait-Until -Description 'fail-closed denied audit' -Probe {
    $status = Invoke-Psql "SELECT `"status`" FROM `"Audit`" WHERE `"id`"='$($blockedAudit.id)';"
    if ($status -eq 'completed') { throw 'Non-allowlisted proxy destination unexpectedly completed' }
    if ($status -eq 'failed') { return $status }
    return $null
  } | Out-Null
  $denialCount = Invoke-Psql "SELECT count(*) FROM `"AuditTrailEvent`" WHERE `"resourceId`"='$($blockedAudit.id)' AND `"action`"='worker.egress.denied' AND `"outcome`"='denied';"
  if ([int]$denialCount -lt 1) { throw 'Worker egress denial was not written to the audit trail' }
  $proxyLog = & docker compose exec -T --user 13:13 egress-proxy cat /var/log/squid/access.log
  if ($LASTEXITCODE -ne 0) { throw 'Proxy access log could not be read' }
  if (($proxyLog | Out-String) -notmatch 'blocked\.invalid') { throw 'Proxy denial log does not mention blocked.invalid' }

  & docker compose --profile security-check run --rm worker-agent-check
  if ($LASTEXITCODE -ne 0) { throw 'Agent image reached the fixture or did not run as UID 10001' }

  Write-Host "M1 proof passed: audit=$($audit.id), evidenceSha=$databaseSha, deniedAudit=$($blockedAudit.id)"
} finally {
  if (-not $KeepStack) {
    & docker compose down
  }
}
