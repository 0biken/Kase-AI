$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $tempRoot "kase-node22-$PID-$([Guid]::NewGuid().ToString('N'))"))
if (-not $runtimeRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Temporary Node runtime escaped the system temporary directory'
}

$archiveName = 'node-v22.14.0-win-x64.zip'
$archivePath = Join-Path $runtimeRoot $archiveName
$checksumsPath = Join-Path $runtimeRoot 'SHASUMS256.txt'
$previousPath = $env:PATH
$previousDockerConfig = $env:DOCKER_CONFIG
$previousCorepackLatest = $env:COREPACK_DEFAULT_TO_LATEST

try {
  New-Item -ItemType Directory -Path $runtimeRoot | Out-Null
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v22.14.0/$archiveName" -OutFile $archivePath
  Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/SHASUMS256.txt' -OutFile $checksumsPath
  $checksumLine = Get-Content -LiteralPath $checksumsPath | Where-Object { $_ -match "\s$([Regex]::Escape($archiveName))$" } | Select-Object -First 1
  if (-not $checksumLine -or $checksumLine -notmatch '^([a-f0-9]{64})\s+') { throw 'Official Node checksum is missing' }
  $actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Matches[1]) { throw 'Node 22.14.0 archive checksum mismatch' }

  Expand-Archive -LiteralPath $archivePath -DestinationPath $runtimeRoot
  $nodeRoot = Join-Path $runtimeRoot 'node-v22.14.0-win-x64'
  $node = Join-Path $nodeRoot 'node.exe'
  if ((& $node --version) -ne 'v22.14.0') { throw 'Extracted runtime is not Node 22.14.0' }
  $env:PATH = "$nodeRoot;$previousPath"
  $env:COREPACK_DEFAULT_TO_LATEST = '0'
  $dockerConfig = Join-Path $runtimeRoot 'docker-config'
  New-Item -ItemType Directory -Path $dockerConfig | Out-Null
  $dockerPluginDirectory = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\cli-plugins'
  if (Test-Path -LiteralPath $dockerPluginDirectory) {
    $dockerConfigJson = @{ cliPluginsExtraDirs = @($dockerPluginDirectory) } | ConvertTo-Json
    [IO.File]::WriteAllText(
      (Join-Path $dockerConfig 'config.json'),
      $dockerConfigJson,
      [Text.UTF8Encoding]::new($false)
    )
  }
  $env:DOCKER_CONFIG = $dockerConfig

  Push-Location $repoRoot
  try {
    & $node 'scripts/verify-m2-recovery.mjs'
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } finally { Pop-Location }
  Write-Output 'KASE_M2_NODE22_VERIFIED'
} finally {
  $env:PATH = $previousPath
  $env:DOCKER_CONFIG = $previousDockerConfig
  $env:COREPACK_DEFAULT_TO_LATEST = $previousCorepackLatest
  if (Test-Path -LiteralPath $runtimeRoot) {
    $resolved = [IO.Path]::GetFullPath($runtimeRoot)
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Refusing to remove a temporary runtime outside the system temporary directory'
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
