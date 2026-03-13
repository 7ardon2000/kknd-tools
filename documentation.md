# KKnD Asset Extraction – Documentation

Extracts unit frame images and effects from the [OpenKrush](https://github.com/IceReaper/OpenKrush) mod (KKnD/KKnD2 remake on OpenRA engine) into organized local folders.

## Prerequisites

- **Git** – to clone OpenKrush
- **PowerShell 5+**
- **Python 3** with Pillow (`pip install Pillow`) – for MOBD extraction
- **KKnD Xtreme** install at `C:\Games\KKND Xtreme` – provides `LEVELS\640\SPRITES.LVL`, `LEVELS\MUTE.SLV`, `LEVELS\SURV.SLV`
- **Node.js 18+** (for Animation Viewer)

---

## Quick Start

```powershell
# 1. Clone OpenKrush (if not already present)
git clone https://github.com/IceReaper/OpenKrush.git openkrush

# 2. Run extraction
.\extract-assets.ps1
```

---

## How Extraction Works

### Phase 0: Game content copy

The script copies required game files to OpenRA’s content directory so the MOBD extractor can read them:

- `LEVELS\640\SPRITES.LVL` → `%APPDATA%\OpenRA\Content\openkrush_gen1\sprites.lvl`
- `LEVELS\MUTE.SLV` → `mute.slv`
- `LEVELS\SURV.SLV` → `surv.slv`

### Phase 1: PNG assets

Sidebars, unit icons, and UI assets (chrome, dialog, glyphs, logo) are copied from the OpenKrush mod.

### Phase 2: MOBD extraction

1. **LVL parsing**: `extract_mobd.py` reads `sprites.lvl`, which embeds multiple `.mobd` files.
2. **MOBD parsing**: Each MOBD has:
   - **Rotational animations** (0..N): one animation per facing (8 or 16 directions). Each direction is a sequence of frames (e.g. walk cycle, attack).
   - **Simple animations** (0..M): non-directional (death, spawn, etc.).
3. **Frame export**: For each frame the extractor:
   - Decodes the pixel data (Gen1/SPRT or Gen2/SPNS)
   - Applies the palette (OpenKrush `palette.png` or embedded)
   - Makes index 0 transparent
   - Writes `{Name}_{i:04d}.png` (e.g. `DireWolf_0000.png`, `DireWolf_0001.png`, …)
4. **Metadata**: Each MOBD folder gets `{Name}_frames.json` with frame structure and per-frame offsets.

---

## Metadata File Format (`{Name}_frames.json`)

Each extracted MOBD folder contains a JSON file describing frame layout and animation structure.

### Top-level fields

| Field | Type | Meaning |
|-------|------|---------|
| `rotational_count` | number | Number of rotational animations (one per facing). Often 8 or 16. |
| `simple_count` | number | Number of simple (non-directional) animations. |
| `total_frames` | number | Total number of frames across all animations. |
| `frames` | array | Per-frame objects (see below). |

### Per-frame object fields

| Field | Type | Meaning |
|-------|------|---------|
| `i` | number | Global frame index. Used to map to PNG: `{Name}_{i:04d}.png`. |
| `anim` | string | Either `"rotational"` or `"simple"`. |
| `frame` | number | Index within the current animation (0, 1, 2, …). |
| `ox` | number | X offset of the anchor point inside the frame (pixels from left). Used to position the sprite correctly on the game grid. |
| `oy` | number | Y offset of the anchor point inside the frame (pixels from top). |
| `dir` | number | *(Rotational only)* Direction index (0..rotational_count−1). 0 = N, 1 = NE, etc. |
| `idx` | number | *(Simple only)* Simple animation index (0..simple_count−1). |

### Examples

**Rotational frame (DireWolf, direction 0, frame 2):**
```json
{
  "i": 2,
  "anim": "rotational",
  "frame": 2,
  "ox": 10,
  "oy": 14,
  "dir": 0
}
```
→ PNG: `DireWolf_0002.png`, facing north, third frame in that direction.

**Simple frame (Extras, animation 0):**
```json
{
  "i": 200,
  "anim": "simple",
  "frame": 5,
  "ox": 42,
  "oy": 80,
  "idx": 0
}
```
→ PNG: `Extras_0200.png`, simple animation index 0, sixth frame in that sequence.

### Using the metadata

- Play a single direction: filter `frames` by `dir === selected_direction`.
- Play a simple animation: filter `frames` by `idx === selected_animation`.
- Use `ox` and `oy` when drawing so the sprite anchor matches the game position.

---

## Animation Viewer (Phaser Tester)

A small Phaser 3 app lets you view MOBD animations in the browser and check extraction.

### Run the viewer

**From project root:**
```bash
npm start
```

**Or from the viewer folder:**
```bash
cd viewer
npm install
npm run dev
```

Open http://localhost:5173

### Viewer tabs

- **Sprite Viewer** – Load any sprite, filter by direction/animation, and play at configurable speed.
- **Units** – Select an infantry-type unit from a dropdown to view its 25 animations in a 5×5 grid at 8 FPS. All units share the same frame layout (stand, move, attack in 8 directions plus stand south2) for comparison. For SWAT, shoot effects (shootNorth1, shootEast1, etc.) from Extras are overlaid in front of the rifle barrel during attack animations. Available units: ElPresidente, Flamer, Harry, Infantry, KingZog, Mech, Mekanik, Pyromaniac, Rioter, RocketInfantry, RocketLauncher, Saboteur, Sapper, Sniper, Swat, Technician, Vandal.
- **Effects** – Displays 59 effect animations from Extras (effects/extras) in a grid at 8 FPS: shrapnel, dust, fire, explosions, acid, electricity, craters, laser, death, and shoot effects. Definitions in `viewer/src/effects-config.js`.

### Viewer controls (Sprite Viewer tab)

| Control | Purpose |
|--------|---------|
| **Sprite** | Choose which unit/effect to load. |
| **Direction / Anim** | Filter by rotational direction (Dir 0..N) or simple animation (Simple 0..M). |
| **Speed** | Playback speed (frames per second). |
| **Play** | Start or pause animation. |
| **Step** | Advance one frame. |

The viewer applies `ox` and `oy` for each frame so sprites are positioned correctly. Units tab animation definitions and unit list are in `viewer/src/unit-config.js`. Effects tab uses `viewer/src/effects-config.js`.

### Regenerate sprite list

After extraction, regenerate the viewer’s sprite list:

```bash
python scripts/generate-viewer-manifest.py
```

This writes `viewer/src/sprites.json` and must be run from the project root.

---

## Output Structure

```
kknd-assets/
├── units/
│   ├── direwolf/          # DireWolf.mobd, DireWolf_0000.png..0247.png, DireWolf_frames.json
│   ├── beetle/
│   ├── evolved/           # Mutants – sidebar, vehicles/, infantry/, buildings/
│   ├── survivors/
│   ├── bunker/
│   └── ...
├── effects/
│   ├── extras/            # Explosions, projectiles
│   ├── flame/
│   ├── shrapnels/
│   └── oil/
├── ui/
│   ├── uibits/            # chrome.png, dialog.png, glyphs.png, logo.png
│   ├── modcontent/
│   └── sidebar/
├── scripts/
│   └── generate-viewer-manifest.py
├── viewer/                # Phaser Animation Viewer
│   ├── package.json
│   ├── src/
│   │   ├── main.js
│   │   ├── sprites.json   # Generated sprite manifest
│   │   ├── unit-config.js     # Units tab: animation definitions + unit list
│   │   └── effects-config.js  # Effects tab: Extras effect animations
│   └── index.html
├── extract-assets.ps1
├── extract_mobd.py
├── documentation.md
└── README.md
```

---

## Script Parameters

```powershell
.\extract-assets.ps1 [-OpenKrushPath <path>] [-OutputPath <path>] [-KKnDXtremePath <path>]
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| OpenKrushPath | `.\openkrush` | Path to OpenKrush clone |
| OutputPath | `$PSScriptRoot` | Output directory |
| KKnDXtremePath | `C:\Games\KKND Xtreme` | KKnD Xtreme installation |

---

## Asset Types

### Phase 1 (PNG)

- **Sidebars**: Production panel icons per faction
- **Unit icons/frames**: `frames.png`, `icon.png` for units using PNG
- **UI**: uibits (chrome, dialog, glyphs, logo), sidebar frames

### Phase 2 (MOBD)

- **Raw .mobd**: Extracted from `sprites.lvl` into `units/`, `effects/`, `ui/`
- **PNG frames**: Parsed and exported as `{Name}_{i:04d}.png`; index 0 is transparent
- **Metadata**: `{Name}_frames.json` with animation structure and per-frame `ox`, `oy`
- **Palette**: Gen1 uses OpenKrush `palette.png`; Gen2 uses embedded palette

---

## Game Content Location

After extraction, game content is copied to:

- `%APPDATA%\OpenRA\Content\openkrush_gen1\`
  - `sprites.lvl` (from `LEVELS\640\SPRITES.LVL`)
  - `mute.slv`
  - `surv.slv`

---

## Sources

- [IceReaper/OpenKrush](https://github.com/IceReaper/OpenKrush) – KKnD mod for OpenRA
- [Dzierzan/KKnD-1](https://github.com/Dzierzan/KKnD-1) – Fork (archived)
- Original KKnD Xtreme game files (SPRITES.LVL, MUTE.SLV, SURV.SLV)

---

## Changelog

- **2026-03-13**: Effects tab
  - New tab displaying 59 Extras effect animations (shrapnel, dust, fire, explosions, acid, electricity, craters, laser, death, shoot) in a grid at 8 FPS
  - `viewer/src/effects-config.js` defines `EFFECTS_ANIMATIONS`
- **2026-03-13**: Units tab
  - Renamed SWAT Grid → Units; dropdown to select infantry-type unit (ElPresidente, Flamer, Harry, Infantry, KingZog, Mech, Mekanik, Pyromaniac, Rioter, RocketInfantry, RocketLauncher, Saboteur, Sapper, Sniper, Swat, Technician, Vandal)
  - All units use shared frame layout (25 animations) for comparison at 8 FPS
  - `viewer/src/unit-config.js` defines `UNIT_ANIMATIONS` and `UNITS`
- **2026-03-12**: Phaser Animation Viewer
  - viewer/ with Phaser 3 + Vite
  - Sprite manifest (`scripts/generate-viewer-manifest.py`)
  - Direction/anim filter, play/pause, per-frame hotspot
- **2026-03-12**: MOBD frame metadata extraction
  - `{Name}_frames.json` with rotational/simple structure, direction indices, ox/oy per frame
- **2026-03-12**: MOBD to PNG conversion
  - Parses Mobd → MobdAnimation → MobdFrame → MobdRenderFlags → MobdImage
  - Gen1/Gen2 palette handling
- **2026-03-12**: Initial implementation (Phase 0–2, extract-assets.ps1, extract_mobd.py)
