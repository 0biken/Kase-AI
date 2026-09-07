[CmdletBinding()]
param(
  [switch]$KeepStack,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

$services = @('postgres', 'redis', 'minio', 'minio-init', 'fixture', 'recon-trap', 'egress-proxy', 'migrate', 'api', 'scheduler', 'worker-recon', 'sast-checkout-init', 'worker-sast', 'worker-retention')
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
  finally { $sha.Dispose(); $stream.Dispose() }
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
  $parameters = @{ Method = $Method; Uri = "$apiUrl/$Path"; Headers = $Headers; TimeoutSec = 30 }
  if ($null -ne $Body) {
    $parameters.ContentType = 'application/json'
    $parameters.Body = $Body | ConvertTo-Json -Depth 8
  }
  try { return Invoke-RestMethod @parameters }
  catch { throw "API $Method $Path failed: $($_.Exception.Message)" }
}

function New-ReconAudit([string]$projectId, [string]$targetId, [string]$repositoryId, [string]$commitSha, [hashtable]$headers) {
  return Invoke-Kase 'Post' "projects/$projectId/audits" ($headers + @{ 'Idempotency-Key' = [Guid]::NewGuid().ToString() }) @{
    targetId = $targetId
    repositoryId = $repositoryId
    mode = 'full'
    categories = @('http')
    commitSha = $commitSha
  }
}

function Wait-AuditCompleted([string]$auditId, [int]$Seconds = 240) {
  Wait-Until -Description "audit $auditId completion" -Seconds $Seconds -Probe {
    $status = Invoke-Psql "SELECT `"status`" FROM `"Audit`" WHERE `"id`"='$auditId';"
    if ($status -in @('failed', 'partial', 'cancelled')) { throw "Audit $auditId ended as $status" }
    if ($status -eq 'completed') { return $status }
    return $null
  } | Out-Null
}

function Assert-Equal([object]$Actual, [object]$Expected, [string]$Message) {
  if ($Actual -ne $Expected) { throw "$Message (expected=$Expected actual=$Actual)" }
}

function Assert-EvidenceHash([string]$auditId, [string]$type) {
  $value = Invoke-Psql "SELECT `"id`" || '|' || `"artifactUri`" || '|' || `"sha256`" || '|' || `"sizeBytes`" FROM `"Evidence`" WHERE `"auditId`"='$auditId' AND `"type`"='$type' ORDER BY `"id`";"
  $rows = @($value -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($rows.Count -ne 1) { throw "Expected one $type evidence row for $auditId; found $($rows.Count): $($rows -join '; ')" }
  $parts = $rows[0].Split('|')
  if ($parts.Count -ne 4 -or $parts[2] -notmatch '^[a-f0-9]{64}$' -or [int64]$parts[3] -le 0) { throw "Malformed $type evidence row: $($rows[0])" }
  $objectPath = $parts[1].Replace('s3://kase-evidence/', '')
  $objectProof = & docker compose run --rm --no-deps --entrypoint sh minio-init -c "mc alias set local http://minio:9000 minioadmin minioadmin >/dev/null && mc cat local/kase-evidence/$objectPath | sha256sum"
  if ($LASTEXITCODE -ne 0) { throw "Could not read $type evidence from MinIO" }
  Assert-Equal (($objectProof -split '\s+')[0]) $parts[2] "$type object bytes do not match Evidence.sha256"
  return $parts[2]
}

function Get-ReconProcessList {
  $containerId = (& docker compose ps -q worker-recon | Out-String).Trim()
  if (-not $containerId) { throw 'worker-recon container is not running' }
  return (& docker top $containerId -eo pid,args | Out-String)
}

function Set-FixtureMode([string]$version, [bool]$slow) {
  $env:KASE_FIXTURE_RECON_VERSION = $version
  $env:KASE_FIXTURE_SLOW_RECON = $slow.ToString().ToLowerInvariant()
  & docker compose up -d --force-recreate fixture
  if ($LASTEXITCODE -ne 0) { throw 'Could not recreate the fixture' }
  Wait-Until -Description 'fixture readiness' -Probe {
    & docker compose exec -T fixture node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>$null
    return $LASTEXITCODE -eq 0
  } | Out-Null
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
$env:KASE_FIXTURE_RECON_VERSION = '1'
$env:KASE_FIXTURE_SLOW_RECON = 'false'
$env:KASE_JOB_LEASE_MS = '15000'
$env:KASE_JOB_HEARTBEAT_MS = '3000'
$env:KASE_SCHEDULER_RECOVERY_MS = '2000'
$env:KASE_BULL_LOCK_DURATION_MS = '30000'
$env:KASE_BULL_STALLED_INTERVAL_MS = '5000'
$env:KASE_RETENTION_INTERVAL_MS = '5000'

$organizationId = New-KaseId 'org'
$projectId = New-KaseId 'prj'
$gatePolicyId = New-KaseId 'gpol'
$repositoryId = New-KaseId 'repo'
$targetId = New-KaseId 'tgt'
$scopePolicyId = New-KaseId 'scp'
$tokenId = New-KaseId 'tok'
$tokenPlaintext = "kase_$([Guid]::NewGuid().ToString('N'))"
$tokenHash = Get-TextSha256 $tokenPlaintext

try {
  $existingSast = (& docker compose ps -q worker-sast | Out-String).Trim()
  if ($existingSast) { & docker compose stop worker-sast | Out-Null }
  if (Test-Path -LiteralPath $proofRoot) {
    $resolvedRoot = [IO.Path]::GetFullPath($proofRoot)
    $resolvedRepo = [IO.Path]::GetFullPath($repoRoot)
    if (-not $resolvedRoot.StartsWith($resolvedRepo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to replace proof repository outside Kase' }
    Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $proofRepository -Force | Out-Null
  Copy-Item -LiteralPath 'fixtures/vulnerable-app/invoices' -Destination $proofRepository -Recurse
  Copy-Item -LiteralPath 'fixtures/vulnerable-app/db.ts' -Destination $proofRepository
  & git -C $proofRepository init -b main | Out-Null
  & git -C $proofRepository config user.email 'm3-proof@kase.local'
  & git -C $proofRepository config user.name 'Kase M3 Proof'
  & git -C $proofRepository add --all
  & git -C $proofRepository commit -m 'Seed M3 provenance fixture' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the proof repository' }
  $commitSha = (& git -C $proofRepository rev-parse HEAD | Out-String).Trim()
  if ($commitSha -notmatch '^[a-f0-9]{40}$') { throw 'Proof repository did not produce a full commit SHA' }

  if ($SkipBuild) { & docker compose up -d $services } else { & docker compose up --build -d $services }
  if ($LASTEXITCODE -ne 0) { throw 'M3 Compose stack did not start' }
  Wait-Until -Description 'API readiness' -Probe {
    try { Invoke-WebRequest -UseBasicParsing -Uri "$apiUrl/projects" -Headers @{ Authorization = "Bearer $tokenPlaintext" } -TimeoutSec 2 | Out-Null; return $true }
    catch { if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) { return $true }; return $false }
  } | Out-Null

  $suffix = $projectId.Substring($projectId.Length - 10).ToLowerInvariant()
  Invoke-Psql @"
INSERT INTO "Organization" ("id", "name", "slug") VALUES ('$organizationId', 'M3 Compose Proof', 'm3-compose-$suffix');
INSERT INTO "Project" ("id", "organizationId", "name", "slug", "defaultGatePolicyId") VALUES ('$projectId', '$organizationId', 'M3 Compose Proof', 'm3-compose-$suffix', '$gatePolicyId');
INSERT INTO "GatePolicy" ("id", "projectId", "version", "name", "rules") VALUES ('$gatePolicyId', '$projectId', 1, 'default', '{"blockOn":{"requiresReplayableEvidence":true}}');
INSERT INTO "Repository" ("id", "projectId", "provider", "url", "defaultBranch") VALUES ('$repositoryId', '$projectId', 'local-proof', 'file:///proof-repository', 'main');
INSERT INTO "Target" ("id", "projectId", "name", "baseUrl", "environment", "authMode") VALUES ('$targetId', '$projectId', 'fixture', 'http://fixture:3000', 'local', 'none');
INSERT INTO "ScopePolicy" ("id", "projectId", "allowedHosts", "deniedPaths", "maxRequestsPerSecond", "maxRequestsPerAudit", "destructiveAllowed", "authorizationAttestedBy", "authorizationAttestedAt") VALUES ('$scopePolicyId', '$projectId', ARRAY['fixture'], ARRAY['/admin','/proof'], 3, 2000, false, 'm3-proof', CURRENT_TIMESTAMP);
INSERT INTO "ApiToken" ("id", "projectId", "name", "tokenHash", "displayPrefix", "role", "createdBy") VALUES ('$tokenId', '$projectId', 'M3 proof', '$tokenHash', '$($tokenPlaintext.Substring(0, 8))', 'admin', 'm3-proof');
"@ | Out-Null
  $headers = @{ Authorization = "Bearer $tokenPlaintext" }

  $first = New-ReconAudit $projectId $targetId $repositoryId $commitSha $headers
  Wait-AuditCompleted $first.id
  $graph = Invoke-Psql "SELECT count(*) || '|' || count(*) FILTER (WHERE `"status`"='succeeded') || '|' || count(*) FILTER (WHERE `"kind`" IN ('recon','http','normalize_severity','agent','blackbox_agent','whitebox_agent')) FROM `"AuditJob`" WHERE `"auditId`"='$($first.id)';"
  Assert-Equal $graph '6|6|0' 'M3 graph did not contain exactly the six deterministic non-AI jobs'
  $dependencyOrder = Invoke-Psql "SELECT bool_and(c.`"startedAt`" >= p.`"finishedAt`")::text FROM `"AuditJob`" c CROSS JOIN LATERAL unnest(c.`"dependsOn`") d(id) JOIN `"AuditJob`" p ON p.`"id`"=d.id WHERE c.`"auditId`"='$($first.id)';"
  Assert-Equal $dependencyOrder 'true' 'M3 jobs did not execute after their dependencies finished'
  $invoice = Invoke-Psql "SELECT count(*) || '|' || bool_or(401=ANY(`"statusObserved`"))::text || '|' || bool_and(`"contentType`" IS NOT NULL)::text || '|' || bool_or(cardinality(`"technologies`") > 0)::text FROM `"Endpoint`" e JOIN `"EndpointInventory`" i ON i.`"id`"=e.`"inventoryId`" WHERE i.`"auditId`"='$($first.id)' AND e.`"method`"='GET' AND e.`"pathTemplate`"='/api/invoices/{id}';"
  Assert-Equal $invoice '1|true|true|true' 'Invoice variants did not merge with expected live metadata'
  $invoiceSources = Invoke-Psql "SELECT array_to_string(`"discoveredBy`", ',') || '|' || cardinality(`"rawExamples`") || '|' || jsonb_array_length(`"parameters`") FROM `"Endpoint`" e JOIN `"EndpointInventory`" i ON i.`"id`"=e.`"inventoryId`" WHERE i.`"auditId`"='$($first.id)' AND e.`"pathTemplate`"='/api/invoices/{id}';"
  if ($invoiceSources -notmatch 'httpx' -or $invoiceSources -notmatch 'katana' -or $invoiceSources -notmatch '\|2\|2$') { throw "Canonical invoice provenance/parameters are incomplete: $invoiceSources" }
  $denials = Invoke-Psql "SELECT count(*) || '|' || count(DISTINCT `"metadata`"->>'url') FROM `"AuditTrailEvent`" WHERE `"projectId`"='$projectId' AND `"action`"='worker.egress.denied' AND `"resourceId`" LIKE '$($first.id):%';"
  Assert-Equal $denials '2|2' 'Denied path and external host were not recorded exactly once'
  $deniedJson = & docker compose exec -T fixture node -e "fetch('http://127.0.0.1:3000/proof/denied-count').then(r=>r.text()).then(console.log).catch(()=>process.exit(1))"
  if ($LASTEXITCODE -ne 0) { throw 'Could not read the fixture denial counter' }
  $deniedCount = ($deniedJson | ConvertFrom-Json).count
  Assert-Equal $deniedCount 0 'The denied fixture path received a request'
  $trapLogs = & docker compose logs recon-trap
  if (($trapLogs | Out-String) -match 'TRAP_REQUEST') { throw 'The non-allowlisted trap received a request' }
  $crawlSha = Assert-EvidenceHash $first.id 'crawl_result'
  $httpxSha = Assert-EvidenceHash $first.id 'httpx_jsonl'
  $inventoryResponse = Invoke-Kase 'Get' "audits/$($first.id)/inventory?method=GET&path=invoices&statusClass=4xx" $headers
  Assert-Equal $inventoryResponse.endpoints.Count 1 'Inventory API filters did not return the canonical invoice endpoint'

  Set-FixtureMode '2' $false
  $second = New-ReconAudit $projectId $targetId $repositoryId $commitSha $headers
  Wait-AuditCompleted $second.id
  $drift = Invoke-Psql "SELECT count(*) FILTER (WHERE `"kind`"='added' AND `"endpointKey`"='GET /api/reports/{id}') || '|' || count(*) FILTER (WHERE `"kind`"='removed' AND `"endpointKey`"='GET /recon-redirect') FROM `"EndpointDrift`" d JOIN `"EndpointInventory`" i ON i.`"id`"=d.`"inventoryId`" WHERE i.`"auditId`"='$($second.id)';"
  Assert-Equal $drift '1|1' 'Second fixture version did not produce added/removed endpoint drift'

  $concurrentA = New-ReconAudit $projectId $targetId $repositoryId $commitSha $headers
  $concurrentB = New-ReconAudit $projectId $targetId $repositoryId $commitSha $headers
  Wait-AuditCompleted $concurrentA.id 300
  Wait-AuditCompleted $concurrentB.id 300
  $eventRows = Invoke-Psql "SELECT `"type`" FROM `"AuditEvent`" WHERE `"auditId`" IN ('$($concurrentA.id)','$($concurrentB.id)') AND `"type`" IN ('recon.host_lease.acquired','recon.host_lease.released') ORDER BY `"createdAt`", `"id`";"
  $active = $false
  $eventCount = 0
  foreach ($eventType in @($eventRows -split "`r?`n" | Where-Object { $_ })) {
    $eventCount += 1
    if ($eventType -eq 'recon.host_lease.acquired') { if ($active) { throw 'Concurrent audits overlapped the shared target-host lease' }; $active = $true }
    elseif ($eventType -eq 'recon.host_lease.released') { if (-not $active) { throw 'Host lease release had no matching acquisition' }; $active = $false }
  }
  if ($active -or $eventCount -ne 8) { throw "Expected four serialized network stages; observed $eventCount lease events" }
  $budgetSafe = Invoke-Psql "SELECT bool_and(`"consumed`" <= `"reconLimit`" AND `"reserved`"=0)::text FROM `"ReconRequestBudget`" WHERE `"auditId`" IN ('$($concurrentA.id)','$($concurrentB.id)');"
  Assert-Equal $budgetSafe 'true' 'Concurrent recon audits exceeded or leaked their request reservations'

  Set-FixtureMode '2' $true
  $cancelled = New-ReconAudit $projectId $targetId $repositoryId $commitSha $headers
  Wait-Until -Description 'live Katana process for cancellation' -Seconds 180 -Probe {
    $status = Invoke-Psql "SELECT `"status`" FROM `"AuditJob`" WHERE `"auditId`"='$($cancelled.id)' AND `"kind`"='katana_discover';"
    if ($status -in @('failed','timed_out','cancelled','succeeded')) { throw "Katana became $status before cancellation could be exercised" }
    if ($status -eq 'running' -and (Get-ReconProcessList) -match '(^|\s)katana(\s|$)') { return $status }
    return $null
  } | Out-Null
  Invoke-Kase 'Post' "audits/$($cancelled.id)/cancel" $headers | Out-Null
  Wait-Until -Description 'cancelled recon audit' -Seconds 120 -Probe {
    $status = Invoke-Psql "SELECT `"status`" FROM `"Audit`" WHERE `"id`"='$($cancelled.id)';"
    if ($status -in @('completed','partial','failed')) { throw "Cancelled recon audit ended as $status" }
    if ($status -eq 'cancelled') { return $status }
    return $null
  } | Out-Null
  Start-Sleep -Seconds 2
  if ((Get-ReconProcessList) -match '(^|\s)katana(\s|$)') { throw 'Cancellation left Katana running' }
  $cancelState = Invoke-Psql "SELECT count(*) FILTER (WHERE `"status`"='cancelled') || '|' || (SELECT count(*) FROM `"EndpointInventory`" WHERE `"auditId`"='$($cancelled.id)') || '|' || (SELECT count(*) FROM `"GateEvaluation`" WHERE `"auditId`"='$($cancelled.id)') || '|' || (SELECT count(*) FROM `"AuditEvent`" WHERE `"auditId`"='$($cancelled.id)' AND `"type`"='audit.cancel') FROM `"AuditJob`" WHERE `"auditId`"='$($cancelled.id)';"
  Assert-Equal $cancelState '5|0|0|1' 'Cancellation did not stop active work and cancel pending jobs exactly once'

  $running = & docker compose ps --status running --services
  foreach ($service in @('postgres','redis','minio','fixture','recon-trap','egress-proxy','api','scheduler','worker-recon','worker-sast','worker-retention')) {
    if ($running -notcontains $service) { throw "Retained M3 service is not running: $service" }
  }
  Write-Host "M3 recon proof passed: audit=$($first.id), crawlSha=$crawlSha, httpxSha=$httpxSha, driftAudit=$($second.id), cancelledAudit=$($cancelled.id)"
  & docker compose ps
} catch {
  Write-Host "M3 proof failure: $($_.Exception.Message)" -ForegroundColor Red
  & docker compose ps -a
  & docker compose logs --tail 160 api scheduler worker-recon worker-sast fixture recon-trap egress-proxy
  throw
} finally {
  if (-not $KeepStack) { & docker compose down }
}
