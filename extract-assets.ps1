# KKnD sprite extraction (optional: the repo already contains the raw .mobd files).
#
# Copies SPRITES.LVL from a KKnD Xtreme install into content/ and extracts every MOBD in it to
# units/, effects/ and ui/ as PNG frames + {Name}_frames.json metadata.
#
# Usage: .\extract-assets.ps1 [-KKnDXtremePath "C:\Games\KKND Xtreme"]
#
# Without the game, re-parse the .mobd files already in this repo instead:
#   python extract_mobd.py --from-repo

param(
    [string]$KKnDXtremePath = "C:\Games\KKND Xtreme"
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$contentDir = Join-Path $root "content"
New-Item -ItemType Directory -Path $contentDir -Force | Out-Null

$lvl = Join-Path $KKnDXtremePath "LEVELS\640\SPRITES.LVL"
if (Test-Path $lvl) {
    Copy-Item $lvl (Join-Path $contentDir "sprites.lvl") -Force
    Write-Host "Copied $lvl to content\sprites.lvl"
} elseif (-not (Test-Path (Join-Path $contentDir "sprites.lvl"))) {
    Write-Error "SPRITES.LVL not found at $lvl. Pass -KKnDXtremePath, or run 'python extract_mobd.py --from-repo' to use the .mobd files already in the repo."
}

python (Join-Path $root "extract_mobd.py")
