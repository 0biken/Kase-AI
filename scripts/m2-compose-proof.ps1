[CmdletBinding()]
param(
  [switch]$KeepStack,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

$services = @('postgres', 'redis', 'minio', 'minio-init', 'fixture', 'egress-proxy', 'migrate', 'api', 'scheduler', 'worker-recon', 'sast-checkout-init', 'worker-sast', 'worker-retention')
$proofRoot = Join-Path $repoRoot '.m2-proof'
$proofRepository = Join-Path $proofRoot 'repository'
$apiUrl = 'http://localhost:3002/api/v1'

function New-KaseId([string]$prefix) {
  $alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  $chars = New-Object char[] 26
  $chars[0] = '0'
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 25
  try { $random.GetBytes($bytes) } finally { $random.Dispose() }
  for ($i = 1; $i -lt 26; $i++) { $chars[$i] = $alphabet[$bytes[$i - 1] % $alphabet.Length] }
  return "${prefix}_$(-join $chars)"
}

function Get-TextSha256([string]$value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($value)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '') }
  finally { $sha.Dispose() }
}

function Get-FileSha256([string]$path) {
  $stream = [IO.File]::OpenRead($path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return (($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) -join '') }
  finally {
    $sha.Dispose()
    $stream.Dispose()
  }
}

function Invoke-Psql([string]$sql) {
  $value = $sql | & docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -At -U kase -d kase
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL command failed' }
  return ($value | Out-String).Trim()
}

function Wait-Until([scriptblock]$Probe, [string]$Description, [int]$Seconds = 180) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $result = & $Probe
    if ($null -ne $result -and $false -ne $result -and '' -ne $result) { return $result }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for $Description"
}

function Invoke-Kase([string]$Method, [string]$Path, [hashtable]$Headers, [object]$Body = $null) {
  $parameters = @{
    Method = $Method
    Uri = "$apiUrl/$Path"
    Headers = $Headers
    TimeoutSec = 30
  }
  if ($null -ne $Body) {
    $parameters.ContentType = 'application/json'
    $parameters.Body = $Body | ConvertTo-Json -Depth 8
  }
  try {
    return Invoke-RestMethod @parameters
  } catch {
    throw "API $Method $Path failed: $($_.Exception.Message)"
  }
}

function New-SecurityAudit([string]$projectId, [string]$repositoryId, [string]$commitSha, [hashtable]$headers) {
  return Invoke-Kase 'Post' "projects/$projectId/audits" ($headers + @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }) @{
    repositoryId = $repositoryId
    mode = 'security'
    categories = @('sast')
    commitSha = $commitSha
  }
}

function Assert-Equal([object]$Actual, [object]$Expected, [string]$Message) {
  if ($Actual -ne $Expected) { throw "$Message (expected=$Expected actual=$Actual)" }
}

function Get-SastProcessList {
  $containerId = (& docker compose ps -q worker-sast | Out-String).Trim()
  if (-not $containerId) { throw 'worker-sast container is not running' }
  return (& docker top $containerId -eo pid,args | Out-String)
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is not available' }
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop Linux engine is not running' }

if (-not $env:KASE_LOCAL_KEK) {
  $kek = [byte[]]::new(32)
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($kek) } finally { $random.Dispose() }
  $env:KASE_LOCAL_KEK = [Convert]::ToBase64String($kek)
}
$env:KASE_SAST_RULE_PACK_SHA256 = Get-FileSha256 'rules/kase/typescript-security/idor/missing-ownership-predicate.yml'
$env:KASE_ENABLE_PROOF_HOOKS = 'true'
$env:KASE_SEMGREP_PROOF_HOLD_MS = '90000'
$env:KASE_JOB_LEASE_MS = '10000'
$env:KASE_JOB_HEARTBEAT_MS = '2000'
$env:KASE_SCHEDULER_RECOVERY_MS = '2000'
$env:KASE_BULL_LOCK_DURATION_MS = '15000'
$env:KASE_BULL_STALLED_INTERVAL_MS = '5000'
$env:KASE_RETENTION_INTERVAL_MS = '2000'

$organizationId = New-KaseId 'org'
$projectId = New-KaseId 'prj'
$gatePolicyId = New-KaseId 'gpol'
$repositoryId = New-KaseId 'repo'
$tokenId = New-KaseId 'tok'
$tokenPlaintext = "kase_$([Guid]::NewGuid().ToString('N'))"
$tokenHash = Get-TextSha256 $tokenPlaintext

try {
  $savedErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & docker compose stop worker-sast 2>&1 | Out-Null
  $stopExitCode = $LASTEXITCODE
  $ErrorActionPreference = $savedErrorPreference
  if ($stopExitCode -ne 0) { throw 'Could not stop an existing worker-sast before replacing the proof repository' }
  if (Test-Path -LiteralPath $proofRoot) {
    $resolvedRoot = [IO.Path]::GetFullPath($proofRoot)
    $resolvedRepo = [IO.Path]::GetFullPath($repoRoot)
    if (-not $resolvedRoot.StartsWith($resolvedRepo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Refusing to replace proof repository outside the Kase workspace'
    }
    Remove-Item -LiteralPath $proofRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $proofRepository -Force | Out-Null
  Copy-Item -LiteralPath 'fixtures/vulnerable-app/invoices' -Destination $proofRepository -Recurse
  Copy-Item -LiteralPath 'fixtures/vulnerable-app/db.ts' -Destination $proofRepository
  & git -C $proofRepository init -b main | Out-Null
  & git -C $proofRepository config user.email 'm2-proof@kase.local'
  & git -C $proofRepository config user.name 'Kase M2 Proof'
  & git -C $proofRepository add --all
  & git -C $proofRepository commit -m 'Seed vulnerable IDOR fixture' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the local proof repository' }
  $commitSha = (& git -C $proofRepository rev-parse HEAD | Out-String).Trim()
  if ($commitSha -notmatch '^[a-f0-9]{40}$') { throw 'Proof repository did not produce a full commit SHA' }

  if ($SkipBuild) { & docker compose up -d $services }
  else { & docker compose up --build -d $services }
  if ($LASTEXITCODE -ne 0) { throw 'M2 Compose stack did not start' }

  Wait-Until -Description 'API readiness' -Probe {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$apiUrl/projects" -Headers @{ Authorization = "Bearer $tokenPlaintext" } -TimeoutSec 2 | Out-Null
      return $true
    } catch {
      if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) { return $true }
      return $false
    }
  } | Out-Null

  $suffix = $projectId.Substring($projectId.Length - 10).ToLowerInvariant()
  $seedSql = @"
INSERT INTO "Organization" ("id", "name", "slug")
VALUES ('$organizationId', 'M2 Compose Proof', 'm2-compose-$suffix');
INSERT INTO "Project" ("id", "organizationId", "name", "slug", "defaultGatePolicyId")
VALUES ('$projectId', '$organizationId', 'M2 Compose Proof', 'm2-compose-$suffix', '$gatePolicyId');
INSERT INTO "GatePolicy" ("id", "projectId", "version", "name", "rules")
VALUES ('$gatePolicyId', '$projectId', 1, 'default', '{"blockOn":{"requiresReplayableEvidence":true}}');
INSERT INTO "Repository" ("id", "projectId", "provider", "url", "defaultBranch")
VALUES ('$repositoryId', '$projectId', 'local-proof', 'file:///proof-repository', 'main');
INSERT INTO "ApiToken" ("id", "projectId", "name", "tokenHash", "displayPrefix", "role", "createdBy")
VALUES ('$tokenId', '$projectId', 'M2 proof', '$tokenHash', '$($tokenPlaintext.Substring(0, 8))', 'admin', 'm2-proof');
"@
  Invoke-Psql $seedSql | Out-Null
  $headers = @{ Authorization = "Bearer $tokenPlaintext" }

  # First audit: interrupt the SAST container only after replayable evidence is committed.
  $recoveryAudit = New-SecurityAudit $projectId $repositoryId $commitSha $headers
  $semgrepJobId = Wait-Until -Description 'first Semgrep evidence hold' -Seconds 180 -Probe {
    $row = Invoke-Psql "SELECT j.`"id`" || '|' || j.`"status`" || '|' || count(e.`"id`") FROM `"AuditJob`" j LEFT JOIN `"Evidence`" e ON e.`"auditId`"=j.`"auditId`" AND e.`"type`"='sast_json' WHERE j.`"auditId`"='$($recoveryAudit.id)' AND j.`"kind`"='semgrep' GROUP BY j.`"id`", j.`"status`";"
    if ($row) {
      $parts = $row.Split('|')
      if ($parts[1] -eq 'running' -and [int]$parts[2] -eq 1) { return $parts[0] }
      if ($parts[1] -in @('failed', 'timed_out', 'cancelled')) { throw "First Semgrep job became $($parts[1])" }
    }
    return $null
  }
  $holdBeforeCrash = Get-SastProcessList
  if ($holdBeforeCrash -notmatch 'semgrep-proof-hold') { throw 'Proof hold process was not running before worker interruption' }
  & docker compose kill -s SIGKILL worker-sast
  if ($LASTEXITCODE -ne 0) { throw 'Could not interrupt worker-sast' }
  & docker compose up -d worker-sast
  if ($LASTEXITCODE -ne 0) { throw 'Could not restart worker-sast' }

  Wait-Until -Description 'recovered Semgrep audit completion' -Seconds 240 -Probe {
    $status = Invoke-Psql "SELECT `"status`" FROM `"Audit`" WHERE `"id`"='$($recoveryAudit.id)';"
    if ($status -in @('failed', 'partial', 'cancelled')) { throw "Recovered audit ended as $status" }
    if ($status -eq 'completed') { return $status }
    return $null
  } | Out-Null

  $jobs = Invoke-Psql "SELECT string_agg(`"kind`" || ':' || `"status`" || ':' || `"attempts`", ',' ORDER BY CASE `"kind`" WHEN 'build_provenance' THEN 1 WHEN 'semgrep' THEN 2 ELSE 3 END) FROM `"AuditJob`" WHERE `"auditId`"='$($recoveryAudit.id)';"
  if ($jobs -notmatch '^build_provenance:succeeded:1,semgrep:succeeded:2,normalize_severity:succeeded:1$') { throw "Unexpected recovered graph: $jobs" }
  $finding = Invoke-Psql "SELECT f.`"ruleId`" || '|' || f.`"severity`" || '|' || f.`"category`" || '|' || f.`"aiGenerated`" || '|' || s.`"file`" || '|' || s.`"enclosingSymbol`" || '|' || s.`"verified`" FROM `"Finding`" f JOIN `"SourceLocation`" s ON s.`"findingId`"=f.`"id`" WHERE f.`"auditId`"='$($recoveryAudit.id)';"
  Assert-Equal $finding 'kase.idor.missing-ownership-predicate|high|authorization|false|invoices/invoice.service.ts|InvoiceService.find|true' 'Normalized IDOR finding did not match the authoritative contract'
  $severitySource = Invoke-Psql "SELECT `"severitySource`" FROM `"Finding`" WHERE `"auditId`"='$($recoveryAudit.id)';"
  if ($severitySource -notmatch 'kase-policy' -or $severitySource -notmatch 'rule severity floor') { throw 'Finding severity was not assigned by the centralized Kase policy' }
  $engineNamespaceCount = Invoke-Psql "SELECT count(*) FROM `"Finding`" WHERE `"auditId`"='$($recoveryAudit.id)' AND `"ruleId`" LIKE 'semgrep.%';"
  Assert-Equal $engineNamespaceCount '0' 'A Semgrep engine namespace escaped normalization'
  $agentJobCount = Invoke-Psql "SELECT count(*) FROM `"AuditJob`" WHERE `"auditId`"='$($recoveryAudit.id)' AND `"kind`" IN ('blackbox_agent','whitebox_agent','agent');"
  Assert-Equal $agentJobCount '0' 'An agent job was created in the deterministic audit'

  $evidence = Invoke-Psql "SELECT `"id`" || '|' || `"artifactUri`" || '|' || `"sha256`" || '|' || `"sizeBytes`" FROM `"Evidence`" WHERE `"auditId`"='$($recoveryAudit.id)' AND `"type`"='sast_json';"
  $evidenceRows = @($evidence -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($evidenceRows.Count -ne 1) {
    throw "Expected exactly one replayable Semgrep evidence row after recovery; found $($evidenceRows.Count): $($evidenceRows -join '; ')"
  }
  $evidenceParts = $evidenceRows[0].Split('|')
  if ($evidenceParts.Count -ne 4 -or [string]::IsNullOrWhiteSpace($evidenceParts[0]) -or [string]::IsNullOrWhiteSpace($evidenceParts[1]) -or $evidenceParts[2] -notmatch '^[a-f0-9]{64}$') {
    throw "Replayable Semgrep evidence row is malformed: $($evidenceRows[0])"
  }
  $evidenceId, $uri, $databaseSha, $databaseSize = $evidenceParts
  if ([int64]$databaseSize -le 0) { throw 'Semgrep evidence has a non-positive size' }
  $objectPath = $uri.Replace('s3://kase-evidence/', '')
  $objectProof = & docker compose run --rm --no-deps --entrypoint sh minio-init -c "mc alias set local http://minio:9000 minioadmin minioadmin >/dev/null && mc cat local/kase-evidence/$objectPath | sha256sum"
  if ($LASTEXITCODE -ne 0) { throw 'Could not independently read Semgrep evidence from MinIO' }
  $objectSha = ($objectProof -split '\s+')[0]
  Assert-Equal $objectSha $databaseSha 'MinIO bytes do not match Evidence.sha256'

  $counts = Invoke-Psql "SELECT (SELECT count(*) FROM `"ToolExecution`" WHERE `"auditJobId`"='$semgrepJobId') || '|' || (SELECT count(*) FROM `"Evidence`" WHERE `"auditId`"='$($recoveryAudit.id)' AND `"type`"='sast_json') || '|' || (SELECT count(*) FROM `"Finding`" WHERE `"auditId`"='$($recoveryAudit.id)') || '|' || (SELECT count(*) FROM `"FindingIdentity`" WHERE `"projectId`"='$projectId') || '|' || (SELECT count(*) FROM `"FindingEvidence`" fe JOIN `"Finding`" f ON f.`"id`"=fe.`"findingId`" WHERE f.`"auditId`"='$($recoveryAudit.id)');"
  Assert-Equal $counts '1|1|1|1|1' 'Crash recovery duplicated deterministic records'

  # Second audit: cancellation lands while the proof hold is active, after evidence exists.
  $cancelAudit = New-SecurityAudit $projectId $repositoryId $commitSha $headers
  Wait-Until -Description 'cancellable Semgrep evidence hold' -Seconds 180 -Probe {
    $row = Invoke-Psql "SELECT j.`"status`" || '|' || count(e.`"id`") FROM `"AuditJob`" j LEFT JOIN `"Evidence`" e ON e.`"auditId`"=j.`"auditId`" AND e.`"type`"='sast_json' WHERE j.`"auditId`"='$($cancelAudit.id)' AND j.`"kind`"='semgrep' GROUP BY j.`"status`";"
    if ($row -eq 'running|1') { return $row }
    if ($row -match '^(failed|timed_out|cancelled)\|') { throw "Cancellable Semgrep job became $row" }
    return $null
  } | Out-Null
  $holdBeforeCancel = Get-SastProcessList
  if ($holdBeforeCancel -notmatch 'semgrep-proof-hold') { throw 'Proof hold process was not running before cancellation' }
  Invoke-Kase 'Post' "audits/$($cancelAudit.id)/cancel" $headers | Out-Null
  Wait-Until -Description 'terminal cancelled audit' -Seconds 90 -Probe {
    $status = Invoke-Psql "SELECT `"status`" FROM `"Audit`" WHERE `"id`"='$($cancelAudit.id)';"
    if ($status -in @('completed', 'partial', 'failed')) { throw "Cancelled audit ended as $status" }
    if ($status -eq 'cancelled') { return $status }
    return $null
  } | Out-Null
  Start-Sleep -Seconds 2
  $holdAfterCancel = Get-SastProcessList
  if ($holdAfterCancel -match 'semgrep-proof-hold') { throw 'Cancellation left the controlled Semgrep proof process running' }
  $cancelState = Invoke-Psql "SELECT (SELECT count(*) FROM `"Evidence`" WHERE `"auditId`"='$($cancelAudit.id)') || '|' || (SELECT count(*) FROM `"Finding`" WHERE `"auditId`"='$($cancelAudit.id)') || '|' || (SELECT count(*) FROM `"GateEvaluation`" WHERE `"auditId`"='$($cancelAudit.id)') || '|' || (SELECT count(*) FROM `"AuditEvent`" WHERE `"auditId`"='$($cancelAudit.id)' AND `"type`"='audit.cancel') || '|' || (SELECT count(*) FROM `"AuditJob`" WHERE `"auditId`"='$($cancelAudit.id)' AND `"status`"='cancelled');"
  Assert-Equal $cancelState '1|0|0|1|2' 'Cancellation did not preserve evidence and cancel active/pending work exactly once'

  # Make the captured evidence two days old, then shorten policy to one day.
  Invoke-Psql "UPDATE `"Evidence`" SET `"capturedAt`"=CURRENT_TIMESTAMP - interval '2 days' WHERE `"id`"='$evidenceId';" | Out-Null
  Invoke-Kase 'Put' "projects/$projectId/evidence-policy" $headers @{
    replayableEvidenceDays = 1
    nonReplayableEvidenceDays = $null
    rawToolOutputDays = $null
    agentTranscriptDays = $null
  } | Out-Null
  $rescheduled = Invoke-Psql "SELECT (`"expiresAt`" <= CURRENT_TIMESTAMP)::text FROM `"Evidence`" WHERE `"id`"='$evidenceId';"
  Assert-Equal $rescheduled 'true' 'Shortened project policy did not advance the existing expiry commitment'
  Wait-Until -Description 'retention tombstone' -Seconds 90 -Probe {
    $row = Invoke-Psql "SELECT (`"artifactUri`" IS NULL)::text || '|' || (`"objectDeletedAt`" IS NOT NULL)::text || '|' || (`"tombstonedAt`" IS NOT NULL)::text || '|' || `"sha256`" || '|' || `"sizeBytes`" FROM `"Evidence`" WHERE `"id`"='$evidenceId';"
    if ($row -match '^true\|true\|true\|') { return $row }
    return $null
  } | Out-Null
  & docker compose run --rm --no-deps --entrypoint sh minio-init -c "mc alias set local http://minio:9000 minioadmin minioadmin >/dev/null && ! mc stat local/kase-evidence/$objectPath >/dev/null 2>&1"
  if ($LASTEXITCODE -ne 0) { throw 'Retention tombstoned metadata but left object bytes in MinIO' }
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "$apiUrl/projects/$projectId/audits/$($recoveryAudit.id)/evidence/$evidenceId/download" -Headers $headers -TimeoutSec 15 | Out-Null
    throw 'Tombstoned evidence download unexpectedly succeeded'
  } catch {
    if (-not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 410) { throw }
    $problem = $_.ErrorDetails.Message | ConvertFrom-Json
    Assert-Equal $problem.code 'EVIDENCE_EXPIRED' 'Tombstoned download did not return the RFC 9457 evidence code'
  }

  $running = & docker compose ps --status running --services
  foreach ($service in @('postgres', 'redis', 'minio', 'fixture', 'egress-proxy', 'api', 'scheduler', 'worker-recon', 'worker-sast', 'worker-retention')) {
    if ($running -notcontains $service) { throw "Retained service is not running: $service" }
  }

  Write-Host "M2 proof passed: audit=$($recoveryAudit.id), finding=kase.idor.missing-ownership-predicate, evidenceSha=$databaseSha, recoveredAttempts=2, cancelledAudit=$($cancelAudit.id), tombstone=$evidenceId"
  & docker compose ps
} catch {
  Write-Host "M2 proof failure: $($_.Exception.Message)" -ForegroundColor Red
  & docker compose ps -a
  & docker compose logs --tail 120 api scheduler worker-sast worker-retention
  throw
} finally {
  if (-not $KeepStack) { & docker compose down }
}
