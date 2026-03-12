# KKnD Asset Extraction Script
# Extracts PNG assets from OpenKrush and optionally copies game content
# Usage: .\extract-assets.ps1 [-OpenKrushPath <path>] [-OutputPath <path>] [-KKnDXtremePath <path>]

param(
    [string]$OpenKrushPath = "$PSScriptRoot\openkrush",
    [string]$OutputPath = $PSScriptRoot,
    [string]$KKnDXtremePath = "C:\Games\KKND Xtreme"
)

$ErrorActionPreference = "Stop"

$src = Join-Path $OpenKrushPath "mods"
$gen1 = Join-Path $src "openkrush_gen1"
$modcontent = Join-Path $src "modcontent"

if (-not (Test-Path $gen1)) {
    Write-Error "OpenKrush not found at $OpenKrushPath. Clone it first: git clone https://github.com/IceReaper/OpenKrush.git openkrush"
}

# Phase 0: Copy game content to OpenRA (required for MOBD extraction)
$contentDir = "$env:APPDATA\OpenRA\Content\openkrush_gen1"
$kkndLevels = Join-Path $KKnDXtremePath "LEVELS"
if (Test-Path $kkndLevels) {
    Write-Host "Copying game content to OpenRA..."
    if (-not (Test-Path $contentDir)) { New-Item -ItemType Directory -Path $contentDir -Force | Out-Null }
    Copy-Item (Join-Path $kkndLevels "640\SPRITES.LVL") "$contentDir\sprites.lvl" -Force
    Copy-Item (Join-Path $kkndLevels "MUTE.SLV") "$contentDir\mute.slv" -Force
    Copy-Item (Join-Path $kkndLevels "SURV.SLV") "$contentDir\surv.slv" -Force
    Write-Host "Game content copied to $contentDir"
}

# Create output structure
$dirs = @(
    "units\evolved\vehicles", "units\evolved\infantry", "units\evolved\buildings", "units\evolved\aircrafts",
    "units\survivors\vehicles", "units\survivors\infantry", "units\survivors\buildings", "units\survivors\aircrafts",
    "units\bunker\vehicles",
    "ui\uibits", "ui\modcontent", "ui\sidebar",
    "effects"
)
foreach ($d in $dirs) {
    $fullPath = Join-Path $OutputPath $d
    if (-not (Test-Path $fullPath)) { New-Item -ItemType Directory -Path $fullPath -Force | Out-Null }
}

# Phase 1: Copy PNG assets
Write-Host "Copying PNG assets..."

# Sidebars
Copy-Item (Join-Path $gen1 "actors\evolved\sidebar.png") (Join-Path $OutputPath "units\evolved\") -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $gen1 "actors\survivors\sidebar.png") (Join-Path $OutputPath "units\survivors\") -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $gen1 "actors\survivors\rallypoint.png") (Join-Path $OutputPath "units\survivors\") -Force -ErrorAction SilentlyContinue

# UI
Copy-Item (Join-Path $gen1 "core\sequences\sidebar\frames.png") (Join-Path $OutputPath "ui\sidebar\") -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $modcontent "chrome.png") (Join-Path $OutputPath "ui\modcontent\") -Force -ErrorAction SilentlyContinue

# Uibits PNGs
$uibitsPngs = @("chrome.png", "dialog.png", "glyphs.png", "logo.png", "loadscreen.png", "splashscreen.png")
foreach ($f in $uibitsPngs) {
    $srcFile = Join-Path $gen1 "uibits\$f"
    if (Test-Path $srcFile) { Copy-Item $srcFile (Join-Path $OutputPath "ui\uibits\") -Force }
}

# Evolved - vehicles, infantry, buildings
foreach ($cat in @("vehicles", "infantry", "buildings", "aircrafts")) {
    $actorPath = Join-Path $gen1 "actors\evolved\$cat"
    if (Test-Path $actorPath) {
        Get-ChildItem $actorPath -Directory | ForEach-Object {
            $unitName = $_.Name
            $destPath = Join-Path $OutputPath "units\evolved\$cat\$unitName"
            if (-not (Test-Path $destPath)) { New-Item -ItemType Directory -Path $destPath -Force | Out-Null }
            foreach ($png in @("frames.png", "icon.png")) {
                $srcFile = Join-Path $_.FullName $png
                if (Test-Path $srcFile) { Copy-Item $srcFile $destPath -Force }
            }
        }
    }
}

# Survivors
foreach ($cat in @("vehicles", "infantry", "buildings", "aircrafts")) {
    $actorPath = Join-Path $gen1 "actors\survivors\$cat"
    if (Test-Path $actorPath) {
        Get-ChildItem $actorPath -Directory | ForEach-Object {
            $unitName = $_.Name
            $destPath = Join-Path $OutputPath "units\survivors\$cat\$unitName"
            if (-not (Test-Path $destPath)) { New-Item -ItemType Directory -Path $destPath -Force | Out-Null }
            foreach ($png in @("frames.png", "icon.png")) {
                $srcFile = Join-Path $_.FullName $png
                if (Test-Path $srcFile) { Copy-Item $srcFile $destPath -Force }
            }
        }
    }
}

# Bunker vehicles
$bunkerPath = Join-Path $gen1 "actors\bunker\vehicles"
if (Test-Path $bunkerPath) {
    Get-ChildItem $bunkerPath -Directory | ForEach-Object {
        $unitName = $_.Name
        $destPath = Join-Path $OutputPath "units\bunker\vehicles\$unitName"
        if (-not (Test-Path $destPath)) { New-Item -ItemType Directory -Path $destPath -Force | Out-Null }
        foreach ($png in @("frames.png", "icon.png")) {
            $srcFile = Join-Path $_.FullName $png
            if (Test-Path $srcFile) { Copy-Item $srcFile $destPath -Force }
        }
    }
}

Write-Host "PNG extraction complete."

# Phase 2: Extract MOBD from sprites.lvl
$pythonScript = Join-Path $OutputPath "extract_mobd.py"
if (Test-Path $pythonScript) {
    Write-Host "Extracting MOBD sprites..."
    python $pythonScript
}

# Phase 3: Regenerate viewer sprite manifest
$manifestScript = Join-Path $OutputPath "scripts\generate-viewer-manifest.py"
if (Test-Path $manifestScript) {
    python $manifestScript
}
