# Setu Companion - Multi-Platform Bundle Builder
# Packages release bundles into d:\setu\downloads\ for automatic download in Setu.

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$DownloadsDir = Join-Path $RepoRoot "downloads"
$StagingDir = Join-Path $ScriptDir "staging"

function Write-UnixFile($Path, [string]$Content) {
    # Strictly enforce Unix LF (\n) line endings with zero carriage returns
    $normalized = $Content.Replace("`r`n", "`n").Replace("`r", "`n")
    [System.IO.File]::WriteAllBytes($Path, [System.Text.Encoding]::UTF8.GetBytes($normalized))
}

Write-Host "----------------------------------------------------"
Write-Host "Setu Companion - Packaging Release Bundles"
Write-Host "----------------------------------------------------"
Write-Host "[Path] Repository Root: $RepoRoot"
Write-Host "[Path] Downloads Directory: $DownloadsDir"

if (-not (Test-Path $DownloadsDir)) {
    New-Item -ItemType Directory -Path $DownloadsDir -Force | Out-Null
    Write-Host "[Created] downloads directory"
}

# 1. Package Windows Bundle (setu-companion-windows-x64.zip)
$WinStage = Join-Path $StagingDir "windows-x64"
if (Test-Path $WinStage) { Remove-Item -Recurse -Force $WinStage }
New-Item -ItemType Directory -Path $WinStage -Force | Out-Null

$WinReadme = @"
Setu Companion (Windows 64-bit)
====================================================
This background application allows remote participants to control your screen
when you grant permission during a Setu meeting.

How to Run:
1. Double-click run-companion.bat (or setu-companion.exe if compiled).
2. Keep this window open while sharing your screen.
3. Configure your Port and Security Passkey in config.json to match Setu Settings.

Security:
- Listens exclusively on 127.0.0.1 (localhost).
- Requires your security passkey to execute any commands.
- Host supremacy: If you touch your physical mouse, remote commands are immediately paused.

Updating Setu Companion:
When an update is released, simply extract the new files into this folder and replace them.
Your existing config.json (which contains your private passkey and port) is never overwritten.
"@
Set-Content -Path (Join-Path $WinStage "README.txt") -Value $WinReadme

$WinBat = @"
@echo off
title Setu Companion Daemon
cd /d "%~dp0"
if not exist "config.json" (
    if exist "config.example.json" (
        copy "config.example.json" "config.json" >nul
    )
)
if exist "setu-companion.exe" (
    start "" "setu-companion.exe" %*
) else (
    node "setu-companion.js" %*
)
"@
Set-Content -Path (Join-Path $WinStage "run-companion.bat") -Value $WinBat

Copy-Item (Join-Path $ScriptDir "config.example.json") (Join-Path $WinStage "config.example.json")
Copy-Item (Join-Path $ScriptDir "setu-companion.js") (Join-Path $WinStage "setu-companion.js")
Copy-Item (Join-Path $ScriptDir "win-driver.ps1") (Join-Path $WinStage "win-driver.ps1")

# If cargo compiled binary exists, copy it
$CargoWinBinary = Join-Path $ScriptDir "target\release\setu-companion.exe"
if (Test-Path $CargoWinBinary) {
    Copy-Item $CargoWinBinary (Join-Path $WinStage "setu-companion.exe")
    Write-Host "[Included] Compiled Windows binary"
}

$WinZip = Join-Path $DownloadsDir "setu-companion-windows-x64.zip"
if (Test-Path $WinZip) { Remove-Item -Force $WinZip }
Compress-Archive -Path "$WinStage\*" -DestinationPath $WinZip -Force
Write-Host "[Packaged] $WinZip"

# Shared POSIX-compliant Unix shell launcher (strictly LF line endings, no bashisms)
$UnixSh = @'
#!/bin/sh
DIR="$(cd "$(dirname "$0")" >/dev/null 2>&1 && pwd)"
cd "$DIR"
if [ ! -f "./config.json" ] && [ -f "./config.example.json" ]; then
    cp "./config.example.json" "./config.json"
fi
if [ -f "./setu-companion" ]; then
    chmod +x ./setu-companion
    exec ./setu-companion "$@"
else
    exec node setu-companion.js "$@"
fi
'@

# 2. Package macOS Bundle (setu-companion-macos.zip)
$MacStage = Join-Path $StagingDir "macos"
if (Test-Path $MacStage) { Remove-Item -Recurse -Force $MacStage }
New-Item -ItemType Directory -Path $MacStage -Force | Out-Null

$MacReadme = @"
Setu Companion (macOS)
====================================================
Requirements:
Grant Accessibility permission in System Settings -> Privacy & Security -> Accessibility.

How to Run:
1. Open Terminal in this folder.
2. Run: ./run-companion.sh

Updating Setu Companion:
Extract the new bundle into this folder and overwrite existing files.
Your existing config.json is never overwritten.
"@
Write-UnixFile (Join-Path $MacStage "README.txt") $MacReadme
Write-UnixFile (Join-Path $MacStage "run-companion.sh") $UnixSh

$jsContent = [System.IO.File]::ReadAllText((Join-Path $ScriptDir "setu-companion.js"))
Write-UnixFile (Join-Path $MacStage "setu-companion.js") $jsContent

$cfgContent = [System.IO.File]::ReadAllText((Join-Path $ScriptDir "config.example.json"))
Write-UnixFile (Join-Path $MacStage "config.example.json") $cfgContent

# If cargo compiled binary exists, copy it
$CargoMacBinary = Join-Path $ScriptDir "target\release\setu-companion"
if (Test-Path $CargoMacBinary) {
    Copy-Item $CargoMacBinary (Join-Path $MacStage "setu-companion")
    Write-Host "[Included] Compiled macOS binary"
}

$MacZip = Join-Path $DownloadsDir "setu-companion-macos.zip"
if (Test-Path $MacZip) { Remove-Item -Force $MacZip }
Compress-Archive -Path "$MacStage\*" -DestinationPath $MacZip -Force
Write-Host "[Packaged] $MacZip"

# 3. Package Linux Bundle (setu-companion-linux-x64.tar.gz)
$LinuxStage = Join-Path $StagingDir "linux-x64"
if (Test-Path $LinuxStage) { Remove-Item -Recurse -Force $LinuxStage }
New-Item -ItemType Directory -Path $LinuxStage -Force | Out-Null

$LinuxReadme = @"
Setu Companion (Linux 64-bit)
====================================================
Requirements:
For native input execution, install xdotool:
  sudo apt install xdotool    (Debian/Ubuntu)
  sudo dnf install xdotool    (Fedora/RHEL)
  sudo pacman -S xdotool      (Arch)

How to Run:
1. Open Terminal in this folder.
2. Run: chmod +x run-companion.sh && ./run-companion.sh

Updating Setu Companion:
Extract the new bundle into this folder and overwrite existing files.
Your existing config.json is never overwritten.
"@
Write-UnixFile (Join-Path $LinuxStage "README.txt") $LinuxReadme
Write-UnixFile (Join-Path $LinuxStage "run-companion.sh") $UnixSh
Write-UnixFile (Join-Path $LinuxStage "setu-companion.js") $jsContent
Write-UnixFile (Join-Path $LinuxStage "config.example.json") $cfgContent

# If cargo compiled binary exists, copy it
$CargoLinuxBinary = Join-Path $ScriptDir "target\release\setu-companion"
if (Test-Path $CargoLinuxBinary) {
    Copy-Item $CargoLinuxBinary (Join-Path $LinuxStage "setu-companion")
    Write-Host "[Included] Compiled Linux binary"
}

$LinuxTar = Join-Path $DownloadsDir "setu-companion-linux-x64.tar.gz"
if (Test-Path $LinuxTar) { Remove-Item -Force $LinuxTar }
tar -czf $LinuxTar -C $LinuxStage .
Write-Host "[Packaged] $LinuxTar"

# Also write run-companion.sh in companion/ folder directly with Unix LF endings
Write-UnixFile (Join-Path $ScriptDir "run-companion.sh") $UnixSh

# Clean up staging
Remove-Item -Recurse -Force $StagingDir
Write-Host "[Complete] All bundles generated successfully in $DownloadsDir"
