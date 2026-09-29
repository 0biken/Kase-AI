# G6 remains deferred until both Router protocols and pinned models are known.
# Never certify this gate from source checks or credential presence alone.
param()
$ErrorActionPreference = 'Stop'
$missing = @()
foreach ($name in @('KASE_OPENAI_BASE_URL', 'KASE_ANTHROPIC_BASE_URL', 'KASE_AGENT_ROUTER_HOSTS', 'KASE_M4_OPENAI_MODEL_ID', 'KASE_M4_ANTHROPIC_MODEL_ID')) {
    if (-not [Environment]::GetEnvironmentVariable($name)) { $missing += $name }
}
if ($missing.Count -gt 0) {
    Write-Error ("G6 INCOMPLETE: configure " + ($missing -join ', ') + '. Credentials must be resolved securely for both providers; values must never be included in proof artifacts.')
    exit 1
}
Write-Error 'G6 INCOMPLETE: live Router proof is deferred. Required evidence: both pinned-provider tool exchanges; unaided seeded-IDOR audit and ownership-fixed negative control with the same proof model; independent HTTP replays; persisted evidence/usage/terminal states; complete M1-M4 regressions. Configuration presence is not proof.'
exit 1
