[CmdletBinding()]
param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

$arguments = @{ KeepStack = $true; SkipBuild = [bool]$SkipBuild }

& (Join-Path $PSScriptRoot 'm1-compose-proof.ps1') @arguments
if ($LASTEXITCODE -ne 0) { throw 'M1 live regression proof failed' }
& (Join-Path $PSScriptRoot 'm2-compose-proof.ps1') @arguments
if ($LASTEXITCODE -ne 0) { throw 'M2 live regression proof failed' }

Write-Host 'KASE_M1_M2_LIVE_REGRESSIONS_VERIFIED'
