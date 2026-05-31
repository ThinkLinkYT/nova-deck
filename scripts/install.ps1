param(
  [string]$InstallDir = "$env:LOCALAPPDATA\Programs\Nova Deck",
  [switch]$NoDesktopShortcut,
  [switch]$Launch
)

$ErrorActionPreference = "Stop"

$SourceDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
$LocalPrograms = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Programs"))

if (-not $InstallDir.StartsWith($LocalPrograms, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "InstallDir must be inside $LocalPrograms"
}

$RequiredElectron = Join-Path $SourceDir ".vendor\electron\electron.exe"
if (-not (Test-Path -LiteralPath $RequiredElectron)) {
  throw "Missing Electron runtime at $RequiredElectron"
}

$ItemsToCopy = @(
  "package.json",
  "README.md",
  "Launch Nova Deck.cmd",
  "src",
  ".vendor\electron"
)

function New-Shortcut {
  param(
    [Parameter(Mandatory = $true)][string]$ShortcutPath,
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [string]$IconPath
  )

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.WorkingDirectory = $WorkingDirectory
  if ($IconPath -and (Test-Path -LiteralPath $IconPath)) {
    $shortcut.IconLocation = $IconPath
  }
  $shortcut.Save()
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

foreach ($item in $ItemsToCopy) {
  $sourcePath = Join-Path $SourceDir $item
  $targetPath = Join-Path $InstallDir $item

  if (-not (Test-Path -LiteralPath $sourcePath)) {
    continue
  }

  if (Test-Path -LiteralPath $targetPath) {
    Remove-Item -LiteralPath $targetPath -Recurse -Force
  }

  Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Recurse -Force
}

$InstalledLauncher = Join-Path $InstallDir "Nova Deck.cmd"
$LauncherContent = @"
@echo off
set "APP_DIR=%~dp0."
start "" "%~dp0.vendor\electron\electron.exe" "%APP_DIR%"
"@
Set-Content -LiteralPath $InstalledLauncher -Value $LauncherContent -Encoding ASCII

$InstalledUpdater = Join-Path $InstallDir "Update Nova Deck.cmd"
$InstallerScript = Join-Path $SourceDir "scripts\install.ps1"
$ShortcutIcon = Join-Path $InstallDir "src\renderer\assets\nova-deck-icon.ico"
$UpdaterContent = @"
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$InstallerScript" -Launch
"@
Set-Content -LiteralPath $InstalledUpdater -Value $UpdaterContent -Encoding ASCII

$StartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Nova Deck"
New-Item -ItemType Directory -Force -Path $StartMenuDir | Out-Null
New-Shortcut -ShortcutPath (Join-Path $StartMenuDir "Nova Deck.lnk") -TargetPath $InstalledLauncher -WorkingDirectory $InstallDir -IconPath $ShortcutIcon
New-Shortcut -ShortcutPath (Join-Path $StartMenuDir "Update Nova Deck.lnk") -TargetPath $InstalledUpdater -WorkingDirectory $InstallDir -IconPath $ShortcutIcon

if (-not $NoDesktopShortcut) {
  $DesktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Nova Deck.lnk"
  New-Shortcut -ShortcutPath $DesktopShortcut -TargetPath $InstalledLauncher -WorkingDirectory $InstallDir -IconPath $ShortcutIcon
}

Write-Host "Nova Deck installed to: $InstallDir"
Write-Host "Start Menu shortcuts created under: $StartMenuDir"
if (-not $NoDesktopShortcut) {
  Write-Host "Desktop shortcut created."
}

if ($Launch) {
  Start-Process -FilePath $InstalledLauncher -WorkingDirectory $InstallDir
}
