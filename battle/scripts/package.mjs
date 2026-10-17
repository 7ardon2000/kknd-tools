// Turn battle/dist into the release download: the wallpaper (for Lively Wallpaper and Wallpaper
// Engine) WITHOUT any original game files, plus Setup.cmd, which finds the player's own KKnD files
// and builds the final wallpaper on their PC.
// Usage (from battle/): npm run package   -> release/ + kknd-battle-wallpaper.zip
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const db = JSON.parse(fs.readFileSync(path.join(root, 'public', 'assets', 'units.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// public/gamefiles/ holds the developer's own SPRITES.LVL for `npm run dev`: never ship it
fs.rmSync(path.join(dist, 'gamefiles'), { recursive: true, force: true });
const forbidden = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(lvl|slv|mobd|exe|cab)$/i.test(e.name)) forbidden.push(p);
    else if (path.basename(dir) === 'sprites' && !e.name.startsWith('InfDeath')) forbidden.push(p);
  }
})(dist);
if (forbidden.length) throw new Error(`game files in dist/, refusing to package:\n${forbidden.join('\n')}`);

// keep in sync with src/wallpaper.js
const TEAM_LABELS = ['Survivors vs Evolved', 'Mixed vs Mixed', 'Survivors civil war', 'Evolved civil war'];
const maps = db.maps.filter((m) => m.id !== 'shellmap');
const mapItems = ['All maps (a new one each rotation)', ...maps.map((m) => `${m.title} (${m.category}, ${m.tileset})`)];

const props = [
  { name: 'map', kind: 'dropdown', text: 'Map', value: 0, items: mapItems },
  { name: 'teams', kind: 'dropdown', text: 'Armies', value: 0, items: TEAM_LABELS },
  { name: 'zoom', kind: 'slider', text: 'Pixel zoom (0 = auto: 1x up to 1440p, 2x on 4K)', value: 0, min: 0, max: 5, step: 1 },
  { name: 'units', kind: 'slider', text: 'Units per side (0 = auto from screen size)', value: 0, min: 0, max: 120, step: 1 },
  { name: 'vehicles', kind: 'checkbox', text: 'Vehicles', value: true },
  { name: 'lethality', kind: 'slider', text: 'Lethality', value: 0.9, min: 0.3, max: 4, step: 0.1 },
  { name: 'wave', kind: 'slider', text: 'Seconds between reinforcement waves', value: 8, min: 2, max: 30, step: 1 },
  { name: 'rotate', kind: 'slider', text: 'Minutes per battlefield (0 = never change)', value: 15, min: 0, max: 120, step: 1 },
  { name: 'squads', kind: 'slider', text: 'Special squads (share of waves that are one unit type)', value: 0.18, min: 0, max: 0.6, step: 0.02 },
  { name: 'airstrike', kind: 'slider', text: 'Minutes between airstrikes (0 = off)', value: 2, min: 0, max: 15, step: 0.5 },
  { name: 'corpses', kind: 'slider', text: 'Seconds corpses and wrecks stay', value: 25, min: 3, max: 120, step: 1 },
  { name: 'speed', kind: 'slider', text: 'Game speed', value: 1, min: 0.25, max: 3, step: 0.25 },
  { name: 'fps', kind: 'dropdown', text: 'Frame rate', value: 0, items: ['60 fps', '30 fps (less CPU/GPU)'] },
];

// Lively Wallpaper
const lively = {};
for (const p of props) {
  if (p.kind === 'dropdown') lively[p.name] = { type: 'dropdown', value: p.value, text: p.text, items: p.items };
  else if (p.kind === 'slider') lively[p.name] = { type: 'slider', value: p.value, text: p.text, min: p.min, max: p.max, step: p.step };
  else lively[p.name] = { type: 'checkbox', value: p.value, text: p.text };
}
fs.writeFileSync(path.join(dist, 'LivelyProperties.json'), JSON.stringify(lively, null, 2));
fs.writeFileSync(path.join(dist, 'LivelyInfo.json'), JSON.stringify({
  AppVersion: '2.0.0.0',
  Title: 'KKnD Battle',
  Thumbnail: 'preview.jpg',
  Preview: 'preview.jpg',
  Desc: 'Endless KKnD battle: Survivors and Evolved fight it out on the classic maps. Fan project, not affiliated with the original developers.',
  Author: 'kknd-tools fans',
  License: 'Fan project - see README',
  Contact: 'https://github.com/7ardon2000/kknd-tools',
  Type: 1, // web
  FileName: 'index.html',
  Arguments: null,
  IsAbsolutePath: false,
  Tags: ['kknd', 'rts', 'pixel art', 'game'],
  Version: 1,
}, null, 2));

// Wallpaper Engine (web wallpaper)
const weProps = {};
props.forEach((p, i) => {
  const base = { text: p.text, order: 100 + i };
  if (p.kind === 'dropdown') {
    weProps[p.name] = { ...base, type: 'combo', value: String(p.value), options: p.items.map((label, v) => ({ label, value: String(v) })) };
  } else if (p.kind === 'slider') {
    weProps[p.name] = { ...base, type: 'slider', value: p.value, min: p.min, max: p.max, step: p.step, fraction: p.step < 1 };
  } else {
    weProps[p.name] = { ...base, type: 'bool', value: p.value };
  }
});
fs.writeFileSync(path.join(dist, 'project.json'), JSON.stringify({
  title: 'KKnD Battle',
  type: 'web',
  file: 'index.html',
  preview: 'preview.jpg',
  description: 'Endless KKnD battle on the classic maps (fan project).',
  tags: ['Game'],
  general: { properties: weProps },
  version: pkg.version,
}, null, 2));

const readme = `KKnD Battle - live wallpaper (v${pkg.version})
==========================================

An endless KKnD battle on the classic maps: Survivors vs Evolved, reinforcements keep coming.

This download contains NO original KKnD files. The wallpaper uses the graphics from your own copy
of the game: KKnD Xtreme (GOG or Steam), a KKnD / KKnD Xtreme CD, or the free official demo.

Install
  1. Extract this zip (right-click > Extract All).
  2. Double-click Setup.cmd. It finds your game (GOG, Steam, CD) by itself. No game? It offers to
     download the free official KKnD Xtreme demo from archive.org, or lets you pick the file
     (SPRITES.LVL, in the game's LEVELS\\640 folder) yourself.
  3. Setup makes "KKnD Battle Wallpaper.zip" next to Setup.cmd.
     Lively Wallpaper (free, https://www.rocksdanister.com/lively/): drag that zip onto the Lively
       window, select the wallpaper, then use "Customise" for map, armies, zoom, units, speed...
     Wallpaper Engine: Open Wallpaper > Open from File > choose wallpaper\\project.json.
  The zip Setup makes contains your own game file: keep it for yourself, please don't share it.

Browser
  Serve the wallpaper folder with a local web server (e.g. "npx serve wallpaper") and open it.
  Without Setup it asks for SPRITES.LVL or KKND_XT.EXE once and remembers it.

Credits
  KKnD (Krush Kill 'n Destroy) (c) Beam Software / Melbourne House. Free, non-commercial fan project.
  Game files are read in the same way as OpenKrush (https://github.com/IceReaper/OpenKrush, GPL-3.0),
  by IceReaper and the OpenKrush team, which also provides the unit, weapon and map data, palette,
  tilesets and the infantry death animations (Dzierzan). Built with Phaser 3.
  Source: https://github.com/7ardon2000/kknd-tools
`;
fs.writeFileSync(path.join(dist, 'README.txt'), readme);

// release folder: README.txt, Setup.cmd, setup/setup.ps1, wallpaper/ (= dist)
const release = path.join(root, 'release');
fs.rmSync(release, { recursive: true, force: true });
fs.mkdirSync(path.join(release, 'setup'), { recursive: true });
fs.cpSync(dist, path.join(release, 'wallpaper'), { recursive: true });
fs.writeFileSync(path.join(release, 'README.txt'), readme.replace(/\n/g, '\r\n'));
fs.copyFileSync(path.join(root, 'setup', 'Setup.cmd'), path.join(release, 'Setup.cmd'));
fs.copyFileSync(path.join(root, 'setup', 'setup.ps1'), path.join(release, 'setup', 'setup.ps1'));

const zip = path.join(root, 'kknd-battle-wallpaper.zip');
fs.rmSync(zip, { force: true });
if (process.platform === 'win32') {
  // ZipArchive with "/" separators (Compress-Archive in Windows PowerShell writes backslashes)
  const ps = `Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$src = '${release}'; $z = [IO.Compression.ZipFile]::Open('${zip}', 'Create')
try { foreach ($f in Get-ChildItem -LiteralPath $src -Recurse -File) {
  $n = $f.FullName.Substring($src.Length + 1).Replace('\\', '/')
  [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $f.FullName, $n, 'Optimal') } } finally { $z.Dispose() }`;
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-qr', zip, '.'], { cwd: release, stdio: 'inherit' });
}
console.log(`Packaged ${path.relative(root, zip)} (${(fs.statSync(zip).size / 1e6).toFixed(1)} MB)`);
