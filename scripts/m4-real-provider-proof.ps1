# G6: real-provider proof. Providers: Gemini plus KASE_M4_SECOND_PROVIDER (anthropic|openai).
# The provider's own API host is the Agent Router, reached only through the agent egress proxy.
#   Part A  live two-turn tool exchange per provider (no Docker)        -> pnpm --filter @kase/api test:live
#   Part B  unaided seeded-IDOR audit + ownership-fixed negative control -> m4-compose-driver.mjs --real-provider
#   Part C  complete local M1-M4 regressions
# Exactly one bounded attempt per step; never rerun discovery to obtain a pass. Never certify from configuration presence.
# Credentials are read from the environment by name and never written to proof artifacts.
[CmdletBinding()]
param([switch]$KeepStack, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Fail([string]$message) { Write-Error "G6 INCOMPLETE: $message"; exit 1 }

$second = $env:KASE_M4_SECOND_PROVIDER
if ($second -notin @('anthropic', 'openai')) { Fail 'set KASE_M4_SECOND_PROVIDER to anthropic or openai' }
$providers = @('gemini', $second)
$required = @{
    gemini    = @('GEMINI_API_KEY', 'KASE_M4_GEMINI_MODEL_ID', 'KASE_GEMINI_BASE_URL')
    anthropic = @('ANTHROPIC_API_KEY', 'KASE_M4_ANTHROPIC_MODEL_ID', 'KASE_ANTHROPIC_BASE_URL')
    openai    = @('OPENAI_API_KEY', 'KASE_M4_OPENAI_MODEL_ID', 'KASE_OPENAI_BASE_URL')
}
$missing = @('KASE_AGENT_ROUTER_HOSTS') + ($providers | ForEach-Object { $required[$_] }) | Where-Object { -not [Environment]::GetEnvironmentVariable($_) }
if ($missing) { Fail ("configure " + (($missing | Select-Object -Unique) -join ', ')) }

# Part A: live provider tool exchanges (runs without Docker).
& pnpm --dir $root --filter '@kase/api' test:live
if ($LASTEXITCODE -ne 0) { Fail 'part A live tool exchange did not pass (see .m4-proof/live/G6-exchange.json)' }

# Part B needs the Docker Linux engine.
& docker version --format '{{.Server.Version}}' *> $null
if ($LASTEXITCODE -ne 0) { Fail 'Docker unavailable; part A passed, part B (unaided audit + fixed control) and part C not run' }
foreach ($provider in $providers) {
    $driverArguments = @((Join-Path $PSScriptRoot 'm4-compose-driver.mjs'), '--real-provider', $provider)
    if ($KeepStack) { $driverArguments += '--keep-stack' }
    if ($SkipBuild) { $driverArguments += '--skip-build' }
    & node @driverArguments
    if ($LASTEXITCODE -ne 0) { Fail "part B audit proof failed for $provider" }
}

# Part C: complete local regressions.
& node (Join-Path $PSScriptRoot 'verify-m4-local-regressions.mjs')
if ($LASTEXITCODE -ne 0) { Fail 'part C M1-M4 regressions failed' }

Write-Output ("M4 real-provider proof passed: providers=" + ($providers -join ','))
exit 0
