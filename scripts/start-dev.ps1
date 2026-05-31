$ErrorActionPreference = "Stop"

$rootPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$electronCandidates = @(
  (Join-Path $rootPath "node_modules\electron\dist\electron.exe"),
  (Join-Path $rootPath ".vendor\electron\electron.exe")
)

$electronPath = $electronCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $electronPath) {
  Write-Error "Electron was not found. Run npm install, or make sure .vendor\electron\electron.exe exists."
  exit 1
}

Push-Location $rootPath
try {
  & $electronPath .
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
