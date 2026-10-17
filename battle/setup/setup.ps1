# KKnD Battle wallpaper setup.
#
# The download contains no original KKnD files. This finds SPRITES.LVL in your own copy of the game
# (GOG, Steam, a KKnD / KKnD Xtreme CD - the same places OpenKrush looks) or downloads the free
# official KKnD Xtreme demo, copies it into the wallpaper folder and builds a zip for Lively.
#
#   Setup.cmd                      find the game automatically
#   Setup.cmd -Source <file>       use this SPRITES.LVL or KKND_XT.EXE
#   Setup.cmd -Demo                use the free demo even if the game is installed
param(
    [string]$Source = "",
    [switch]$Demo,
    [switch]$NoPause,
    [switch]$NoExplorer
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Wallpaper = Join-Path $Root "wallpaper"
$GameFiles = Join-Path $Wallpaper "gamefiles"
$ZipPath = Join-Path $Root "KKnD Battle Wallpaper.zip"

$DemoUrl = "https://archive.org/download/KKNDXT/KKND_XT.EXE"
$DemoSha1 = "90222373C1FF06A02509F0D811385C0571E398DF"
$SteamAppId = "1292170"
$GogGameId = "1207659107"
$LvlPaths = @("LEVELS\640\SPRITES.LVL", "KKND\LEVELS\640\SPRITES.LVL")

function Done([int]$code) {
    if (-not $NoPause) {
        Write-Host ""
        Read-Host "Press Enter to close" | Out-Null
    }
    exit $code
}

function Reg([string]$key, [string]$name) {
    try { return (Get-ItemProperty -Path $key -Name $name -ErrorAction Stop).$name } catch { return $null }
}

function Test-Lvl([string]$path) {
    try {
        $fs = [IO.File]::OpenRead($path)
        try {
            $b = New-Object byte[] 4
            [void]$fs.Read($b, 0, 4)
            return [Text.Encoding]::ASCII.GetString($b) -eq "DATA"
        } finally { $fs.Dispose() }
    } catch { return $false }
}

function Get-SteamDirs {
    $steam = Reg "HKCU:\Software\Valve\Steam" "SteamPath"
    if (-not $steam) { $steam = Reg "HKLM:\SOFTWARE\WOW6432Node\Valve\Steam" "InstallPath" }
    if (-not $steam) { return @() }
    $libs = @($steam)
    $vdf = Join-Path $steam "steamapps\libraryfolders.vdf"
    if (Test-Path -LiteralPath $vdf) {
        foreach ($m in [regex]::Matches((Get-Content -LiteralPath $vdf -Raw), '"path"\s+"([^"]+)"')) {
            $libs += $m.Groups[1].Value.Replace("\\", "\")
        }
    }
    $dirs = @()
    foreach ($lib in $libs) {
        $acf = Join-Path $lib "steamapps\appmanifest_$SteamAppId.acf"
        if (Test-Path -LiteralPath $acf) {
            $m = [regex]::Match((Get-Content -LiteralPath $acf -Raw), '"installdir"\s+"([^"]+)"')
            if ($m.Success) { $dirs += (Join-Path $lib ("steamapps\common\" + $m.Groups[1].Value)) }
        }
    }
    return $dirs
}

function Find-SpritesLvl {
    $dirs = @()
    if ($env:KKND_XTREME) { $dirs += @{ Name = "KKND_XTREME folder"; Path = $env:KKND_XTREME } }
    foreach ($key in @("HKLM:\SOFTWARE\WOW6432Node\GOG.com\Games\$GogGameId", "HKLM:\SOFTWARE\GOG.com\Games\$GogGameId")) {
        $p = Reg $key "path"
        if ($p) { $dirs += @{ Name = "KKnD Xtreme (GOG)"; Path = $p } }
    }
    foreach ($p in Get-SteamDirs) { $dirs += @{ Name = "KKnD Xtreme (Steam)"; Path = $p } }
    foreach ($p in @("C:\GOG Games\KKnD Xtreme", "C:\Program Files (x86)\GOG Galaxy\Games\KKnD Xtreme",
                     "C:\Program Files\GOG Galaxy\Games\KKnD Xtreme", "C:\Games\KKnD Xtreme")) {
        $dirs += @{ Name = "KKnD Xtreme"; Path = $p }
    }
    foreach ($d in [IO.DriveInfo]::GetDrives()) {
        if ($d.DriveType -eq "CDRom" -and $d.IsReady) { $dirs += @{ Name = "CD in drive $($d.Name)"; Path = $d.RootDirectory.FullName } }
    }
    foreach ($d in $dirs) {
        foreach ($rel in $LvlPaths) {
            $f = Join-Path $d.Path $rel
            if ((Test-Path -LiteralPath $f) -and (Test-Lvl $f)) { return @{ Name = $d.Name; File = $f } }
        }
    }
    return $null
}

function Get-Demo {
    $target = Join-Path $env:TEMP "KKND_XT.EXE"
    if (-not ((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm SHA1).Hash -eq $DemoSha1)) {
        Write-Host "Downloading the free official KKnD Xtreme demo (7.7 MB) from archive.org..."
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $ProgressPreference = "SilentlyContinue"
        Invoke-WebRequest -Uri $DemoUrl -OutFile $target -UseBasicParsing
        if ((Get-FileHash -LiteralPath $target -Algorithm SHA1).Hash -ne $DemoSha1) {
            Remove-Item -LiteralPath $target -Force
            throw "The demo download is damaged (checksum mismatch). Please try again."
        }
    }
    return $target
}

function Select-File {
    Add-Type -AssemblyName System.Windows.Forms
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Title = "Choose SPRITES.LVL (in your KKnD folder: LEVELS\640) or the demo KKND_XT.EXE"
    $dlg.Filter = "KKnD files (SPRITES.LVL, KKND_XT.EXE)|SPRITES.LVL;KKND_XT.EXE;*.lvl;*.exe|All files (*.*)|*.*"
    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $dlg.FileName }
    return $null
}

function New-WallpaperZip {
    # zip entries must use "/" (PowerShell 5's Compress-Archive writes "\", which some tools reject)
    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
    $zip = [IO.Compression.ZipFile]::Open($ZipPath, [IO.Compression.ZipArchiveMode]::Create)
    try {
        $base = (Resolve-Path -LiteralPath $Wallpaper).Path.TrimEnd("\") + "\"
        foreach ($f in Get-ChildItem -LiteralPath $Wallpaper -Recurse -File) {
            $name = $f.FullName.Substring($base.Length).Replace("\", "/")
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $name, [IO.Compression.CompressionLevel]::Optimal)
        }
    } finally { $zip.Dispose() }
}

try {
    Write-Host ""
    Write-Host "  KKnD Battle - live wallpaper setup" -ForegroundColor Yellow
    Write-Host "  ----------------------------------"
    Write-Host "  This fan wallpaper ships without any original KKnD files."
    Write-Host "  It uses the graphics from your own copy of the game (or the free demo)."
    Write-Host ""
    if (-not (Test-Path -LiteralPath (Join-Path $Wallpaper "index.html"))) {
        throw "The 'wallpaper' folder is missing. Extract the whole download first, then run Setup.cmd again."
    }

    $file = $null
    if ($Source) {
        $file = $Source
        Write-Host "Using $file"
    } elseif ($Demo) {
        $file = Get-Demo
    } else {
        Write-Host "Looking for KKnD (GOG, Steam, CD)..."
        $found = Find-SpritesLvl
        if ($found) {
            Write-Host "Found $($found.Name):" -ForegroundColor Green
            Write-Host "  $($found.File)"
            $file = $found.File
        } else {
            Write-Host "KKnD was not found on this computer." -ForegroundColor DarkYellow
            Write-Host ""
            Write-Host "  [1] Download the free official KKnD Xtreme demo (7.7 MB, recommended)"
            Write-Host "  [2] Choose the file myself (SPRITES.LVL or KKND_XT.EXE)"
            Write-Host "  [Q] Quit"
            $choice = Read-Host "Choice"
            if ($choice -eq "1") { $file = Get-Demo }
            elseif ($choice -eq "2") { $file = Select-File }
            if (-not $file) { Write-Host "Nothing selected."; Done 1 }
        }
    }
    if (-not (Test-Path -LiteralPath $file)) { throw "File not found: $file" }

    # the page reads either file (it unpacks the demo installer itself)
    if (Test-Path -LiteralPath $GameFiles) { Remove-Item -LiteralPath $GameFiles -Recurse -Force }
    New-Item -ItemType Directory -Path $GameFiles | Out-Null
    if (Test-Lvl $file) {
        Copy-Item -LiteralPath $file -Destination (Join-Path $GameFiles "SPRITES.LVL")
    } else {
        Copy-Item -LiteralPath $file -Destination (Join-Path $GameFiles "KKND_XT.EXE")
    }

    Write-Host "Building the wallpaper..."
    New-WallpaperZip
    Write-Host ""
    Write-Host "Done!" -ForegroundColor Green
    Write-Host "  Lively Wallpaper:  drag 'KKnD Battle Wallpaper.zip' onto the Lively window."
    Write-Host "  Wallpaper Engine:  Open Wallpaper > Open from File > wallpaper\project.json"
    Write-Host ""
    Write-Host "  The zip contains your own game files: keep it to yourself, please don't share it."
    if (-not $NoExplorer) { Start-Process explorer.exe "/select,`"$ZipPath`"" }
    Done 0
} catch {
    Write-Host ""
    Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
    Done 1
}
