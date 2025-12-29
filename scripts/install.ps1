# Torm Install Script for Windows
# Usage: irm https://raw.githubusercontent.com/realAndi/torm/main/scripts/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "realAndi/torm"
$BinaryName = "torm.exe"

# Default install location
$InstallDir = if ($env:TORM_INSTALL) { $env:TORM_INSTALL } else { "$env:LOCALAPPDATA\torm" }

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] " -ForegroundColor Blue -NoNewline
    Write-Host $Message
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Write-Err {
    param([string]$Message)
    Write-Host "[ERROR] " -ForegroundColor Red -NoNewline
    Write-Host $Message
    exit 1
}

function Get-Architecture {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    switch ($arch) {
        "X64" { return "x64" }
        "Arm64" { return "arm64" }
        default { Write-Err "Unsupported architecture: $arch" }
    }
}

function Get-LatestVersion {
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -UseBasicParsing
        $version = $release.tag_name -replace '^v', ''
        return $version
    }
    catch {
        Write-Err "Failed to get latest version: $_"
    }
}

function Add-ToPath {
    param([string]$Directory)

    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -notlike "*$Directory*") {
        [Environment]::SetEnvironmentVariable("Path", "$currentPath;$Directory", "User")
        $env:Path = "$env:Path;$Directory"
        Write-Success "Added $Directory to PATH"
        return $true
    }
    return $false
}

function Install-Torm {
    # Print banner
    Write-Host ""
    Write-Host "  ████████╗ ██████╗ ██████╗ ███╗   ███╗" -ForegroundColor Cyan
    Write-Host "  ╚══██╔══╝██╔═══██╗██╔══██╗████╗ ████║" -ForegroundColor Cyan
    Write-Host "     ██║   ██║   ██║██████╔╝██╔████╔██║" -ForegroundColor Cyan
    Write-Host "     ██║   ██║   ██║██╔══██╗██║╚██╔╝██║" -ForegroundColor Cyan
    Write-Host "     ██║   ╚██████╔╝██║  ██║██║ ╚═╝ ██║" -ForegroundColor Cyan
    Write-Host "     ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Terminal BitTorrent Client" -ForegroundColor Gray
    Write-Host ""

    Write-Info "Detecting architecture..."
    $arch = Get-Architecture
    Write-Success "Architecture: $arch"

    Write-Info "Getting latest version..."
    $version = Get-LatestVersion
    Write-Success "Version: $version"

    $downloadUrl = "https://github.com/$Repo/releases/download/v$version/torm-$version-windows-$arch.exe"
    Write-Info "Downloading from: $downloadUrl"

    # Create install directory
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }

    $targetPath = Join-Path $InstallDir $BinaryName
    $tempFile = Join-Path $env:TEMP "torm-download.exe"

    try {
        # Download
        Invoke-WebRequest -Uri $downloadUrl -OutFile $tempFile -UseBasicParsing

        # Move to install location
        Move-Item -Path $tempFile -Destination $targetPath -Force

        Write-Success "Installed torm to $targetPath"
    }
    catch {
        if (Test-Path $tempFile) { Remove-Item $tempFile -Force }
        Write-Err "Failed to download torm: $_"
    }

    # Add to PATH
    $addedToPath = Add-ToPath -Directory $InstallDir

    Write-Host ""
    Write-Success "Installation complete!"
    Write-Host ""

    if ($addedToPath) {
        Write-Host "Restart your terminal, then run 'torm' to get started." -ForegroundColor Gray
    }
    else {
        Write-Host "Run 'torm' to get started." -ForegroundColor Gray
    }

    # Try to show version
    try {
        & $targetPath --version
    }
    catch {
        # Ignore if it fails
    }
}

# Run installation
Install-Torm
