// Turn battle/dist into a wallpaper package for Lively Wallpaper and Wallpaper Engine.
// Usage (from battle/): npm run package   -> dist/ + kknd-battle-wallpaper.zip
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const db = JSON.parse(fs.readFileSync(path.join(root, 'public', 'assets', 'units.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

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

fs.writeFileSync(path.join(dist, 'README.txt'), `KKnD Battle - live wallpaper (v${pkg.version})
==========================================

An endless KKnD battle on the classic maps: Survivors vs Evolved, reinforcements keep coming.

Lively Wallpaper (Windows, free - https://www.rocksdanister.com/lively/)
  Drag this zip onto the Lively window, select the wallpaper, then use "Customise" to pick
  the map, armies, zoom, number of units, lethality, frame rate...

Wallpaper Engine
  Extract the zip, then "Open Wallpaper" > "Open from File" and choose project.json.

Browser
  Serve the extracted folder with a local web server (e.g. "npx serve .") and open it.
  Opening index.html directly from disk does not work (browsers block file:// loading).

Credits
  KKnD (Krush Kill 'n Destroy) (c) Beam Software / Melbourne House. Original game graphics
  belong to their owners; this is a free, non-commercial fan project for the KKnD community.
  Unit, weapon and map data, palette and tilesets from OpenKrush (https://github.com/IceReaper/OpenKrush, GPL-3.0).
  Infantry burn/explode death animations by Dzierzan (OpenKrush).
  Built with Phaser 3. Source: https://github.com/7ardon2000/kknd-tools
`);

const zip = path.join(root, 'kknd-battle-wallpaper.zip');
fs.rmSync(zip, { force: true });
if (process.platform === 'win32') {
  execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${dist}\\*' -DestinationPath '${zip}' -Force`], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-qr', zip, '.'], { cwd: dist, stdio: 'inherit' });
}
console.log(`Packaged ${path.relative(root, zip)} (${(fs.statSync(zip).size / 1e6).toFixed(1)} MB)`);
