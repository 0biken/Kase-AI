# G5: real workers, disposable infrastructure and synthetic provider exchanges.
[CmdletBinding()]
param([switch]$KeepStack, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$driverArguments = @((Join-Path $PSScriptRoot 'm4-compose-driver.mjs'))
if ($KeepStack) { $driverArguments += '--keep-stack' }
if ($SkipBuild) { $driverArguments += '--skip-build' }
& node @driverArguments
exit $LASTEXITCODE
