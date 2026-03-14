# KKnD Asset Extraction – Documentation

Tools for **KKnD** (Krush Kill 'n Destroy) fans to extract unit frames and effects from game files into organized local folders. Built for **solo, offline modding** — testing, experimentation, and fun.

## Prerequisites

- **PowerShell 5+**
- **Python 3** with Pillow (`pip install Pillow`) – for MOBD extraction
- **KKnD Xtreme** install at `C:\Games\KKND Xtreme` – provides `LEVELS\640\SPRITES.LVL`, `LEVELS\MUTE.SLV`, `LEVELS\SURV.SLV`
- **Node.js 18+** (for Animation Viewer)

---

## Quick Start

```powershell
# 1. Ensure KKnD Xtreme is installed at C:\Games\KKND Xtreme
# 2. Run extraction (copies game files to content/, extracts MOBD → PNG)
.\extract-assets.ps1

# 3. For Gen1 sprites, place palette.png in content/ (256-color palette from your game)
```

---

## How Extraction Works

### Phase 0: Game content copy

The script copies required game files to OpenRA’s content directory so the MOBD extractor can read them:

- `LEVELS\640\SPRITES.LVL` → `content\sprites.lvl`
- `LEVELS\MUTE.SLV` → `mute.slv`
- `LEVELS\SURV.SLV` → `surv.slv`

### Phase 1: PNG assets (optional)

If you provide `-SourcePath` pointing to a compatible `mods/` structure, sidebars, unit icons, UI assets (chrome, dialog, glyphs, logo), and palette are copied. Otherwise, place `palette.png` in `content/` manually for Gen1 sprites.

### Phase 2: MOBD extraction

1. **LVL parsing**: `extract_mobd.py` reads `content/sprites.lvl`, which embeds multiple `.mobd` files.
2. **MOBD parsing**: Each MOBD has:
   - **Rotational animations** (0..N): one animation per facing (8 or 16 directions). Each direction is a sequence of frames (e.g. walk cycle, attack).
   - **Simple animations** (0..M): non-directional (death, spawn, etc.).
3. **Frame export**: For each frame the extractor:
   - Decodes the pixel data (Gen1/SPRT or Gen2/SPNS)
   - Applies the palette (`content/palette.png` for Gen1, or embedded for Gen2)
   - Makes index 0 transparent
   - Writes `{Name}_{i:04d}.png` (e.g. `DireWolf_0000.png`, `DireWolf_0001.png`, …)
4. **Metadata**: Each MOBD folder gets `{Name}_frames.json` with frame structure, per-frame offsets (`ox`, `oy`), and per-frame `points` (from the MODB point list: projectile placement, turret, dock points). Use `python extract_mobd.py --metadata-only` to regenerate JSON without PNGs when palette is unavailable.

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
| `w` | number | *(If present)* Frame width from MOBD. Used by the viewer for correct sprite size in export and tester (especially for larger units like DireWolf). |
| `h` | number | *(If present)* Frame height from MOBD. |
| `dir` | number | *(Rotational only)* Direction index (0..rotational_count−1). 0 = N, 1 = NE, etc. |
| `idx` | number | *(Simple only)* Simple animation index (0..simple_count−1). |
| `points` | array | *(Optional)* Per-frame points from the MODB point list (projectile placement, turret, dock points, etc.). Each entry has `type`, `x`, `y`. Used by the Units tab for per-frame shoot effect positioning. |

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

### Backfilling w/h into older metadata

If your `*_frames.json` files lack `w` and `h` (e.g. from extraction before these were added), run:

```bash
python scripts/backfill_frames_metadata.py
```

This adds `w` and `h` from existing PNG dimensions to all frames. Run from project root.

### Using the metadata

- Play a single direction: filter `frames` by `dir === selected_direction`.
- Play a simple animation: filter `frames` by `idx === selected_animation`.
- Use `ox` and `oy` when drawing so the sprite anchor matches the game position.
- Use `points` for per-frame projectile/shoot effect placement: offset = (point.x - ox, point.y - oy). Prefer points with `type === 1` (projectile) when available.

---

## Animation Viewer (Phaser Tester)

A small Phaser 3 app lets you view MOBD animations in the browser and check extraction. Uses a **unified four-section layout** (all sections visible at once, no tabs).

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

Open http://localhost:5173 (or 5174 if 5173 is in use)

### Unified layout (4 stacked sections)

1. **Section 1 – Sprite Viewer (20%)** – Load any sprite, choose a preset (e.g. "stand north", "attack east") or Custom. Frame start/end define the visible range. Play, Step, Speed control playback. Preview area shows the current frame.
2. **Section 2 – Animations (20%)** – **Unit** dropdown to select infantry units (ElPresidente, Flamer, SWAT, etc.) or Effects (Extras). Displays 25 unit animations or 59 effects in a horizontal row with scrollbar. Each cell shows animation name and plays at 8 FPS. Mouse wheel to zoom, scrollbar to pan. **Export** / **Export All** download spritesheet PNGs. **Test** / **Test All** send to Section 4. Click a cell to select.
3. **Section 3 – Configure (flex)** – Compose up to 3 animations on a draggable grid. Timeline, layer/scale/FPS per slot. **Export** downloads spritesheet; **Test** sends to Section 4.
4. **Section 4 – Spritesheet Tester (35%)** – Map background with FPS control. **Test** from Sections 2 or 3 loads the generated spritesheet and plays it; drag the sprite to reposition on the map. Mouse scroll to zoom.

### Configure section (animation composition and spritesheet export)

Use Section 3 (Configure) to fix shoot effect positioning and export pre-composited spritesheets:

1. **Select animation to edit** from the dropdown: SWAT attack north, northeast, east, etc., or "New composition…" (in Section 3).
2. Configure layers, scale, and FPS per slot.
3. **Timeline** – Click cells in overlay rows to place blocks: "this overlay appears on this base frame". Example: click frame 2 in the shoot-effect row so the muzzle flash plays only on the 3rd attack frame.
4. Drag sprites or use arrow keys (Shift+arrow = 5 px) to position; mouse scroll to zoom.
5. **Save** – Updates compositions in memory and downloads `animation-compositions.json`.
6. **Export Spritesheet** – Renders the composed animation to a single PNG spritesheet (horizontal strip) plus a JSON with frame definitions. Downloads to your browser's Downloads folder. Format is compatible with Unity, Godot, Phaser, etc.

**Using composited spritesheets:** Place the exported files in `units/{path}/composite/` (e.g. `units/swat/composite/`). Name them `{Stem}_{anim_name}.png` and `{Stem}_{anim_name}.json` (e.g. `SWAT_attack_north.png`). When available, compositions will use these for accurate WYSIWYG output.

### Animation compositions file format

`viewer/src/animation-compositions.json`:

```json
{
  "compositions": [
    {
      "id": "SWAT/attack north",
      "layers": [
        { "source": "units/swat", "stem": "SWAT", "anim": "attack north", "layer": 0, "offsetX": 0, "offsetY": 0 },
        { "source": "effects/extras", "stem": "Extras", "anim": "shootNorth1", "layer": 1, "offsetX": -1, "offsetY": -9, "timelineBlocks": [{ "baseFrame": 2 }] }
      ]
    }
  ]
}
```

- **id**: Matches `{unitStem}/{animName}` for the Units tab (e.g. `SWAT/attack north`).
- **layers**: Ordered by `layer`; base unit at 0, overlays at 1, 2. Each layer has `source`, `stem`, `anim`, `layer`, `offsetX`, `offsetY`, `scale` (optional), `fps` (optional), and **timelineBlocks** (optional).
- **timelineBlocks**: Array of `{ baseFrame }` — overlay appears only on those base frames. When an overlay has 2 frames and `baseFrame: 2`, both effect frames play during base frame 2 (output expands to 5 frames for a 4-frame attack).

### Section 1 controls (Sprite Viewer)

| Control | Purpose |
|--------|---------|
| **Sprite** | Choose which unit/effect to load. |
| **Preset** | Presets for units (UNIT_ANIMATIONS) or effects (EFFECTS_ANIMATIONS); "Custom" for manual frame range. |
| **Frame start / end** | Define visible frame range. |
| **Speed** | Playback speed (frames per second). |
| **Play** | Start or pause animation. |
| **Step** | Advance one frame. |

The viewer applies `ox` and `oy` for each frame so sprites are positioned correctly. Preset definitions in `viewer/src/unit-config.js` and `viewer/src/effects-config.js`.

### Regenerate sprite list

After extraction, regenerate the viewer’s sprite list:

```bash
python scripts/generate-viewer-manifest.py
```

This writes `viewer/src/sprites.json` and must be run from the project root.

---

## Output Structure

```
kknd-tools/
├── content/             # Game files (sprites.lvl, palette.png) — not committed
├── units/
│   ├── direwolf/          # DireWolf.mobd, DireWolf_0000.png..0247.png, DireWolf_frames.json
│   ├── swat/
│   │   ├── composite/     # Optional: composited spritesheets from Configure Export (e.g. SWAT_attack_north.png + .json)
│   ├── beetle/
│   ├── evolved/           # Mutants – sidebar, vehicles/, infantry/, buildings/
│   ├── survivors/
│   ├── bunker/
│   └── ...
├── maps/                  # map_layer0.png, map_layer1.png for Spritesheet Tester tab
├── spritesheets-test/     # Test spritesheet PNGs + spritesheets.json manifest for dropdown
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
│   │   ├── effects-config.js  # Effects tab: Extras effect animations
│   │   ├── configure-config.js     # Configure tab: getAllAnimations
│   │   └── animation-compositions.json  # Optional: composition overlays (from Configure tab)
│   └── index.html
├── extract-assets.ps1
├── extract_mobd.py
├── documentation.md
└── README.md
```

---

## Script Parameters

```powershell
.\extract-assets.ps1 [-SourcePath <path>] [-OutputPath <path>] [-KKnDXtremePath <path>]
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| SourcePath | *(none)* | Optional. Path to folder with mods/ structure for PNG assets and palette |
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
- **Palette**: Gen1 uses `content/palette.png`; Gen2 uses embedded palette

---

## Game Content Location

After extraction, game content is copied to the local `content/` folder:

- `content/sprites.lvl` (from `LEVELS\640\SPRITES.LVL`)
- `content/mute.slv`
- `content/surv.slv`
- `content/palette.png` (required for Gen1; place manually or provide via `-SourcePath`)

---

## References

- [Dzierzan/KKnD-1](https://github.com/Dzierzan/KKnD-1) – KKnD format research (archived)
- Original KKnD Xtreme game files (SPRITES.LVL, MUTE.SLV, SURV.SLV)

---

### Spritesheet Tester (Section 4)

Test spritesheets on a map background:

1. **Section 4** shows the map (from `maps/map_layer0.png` and `maps/map_layer1.png`), zoomed to fill the entire section (cover scaling).
2. Use **Test** from Section 2 (Animations) or Section 3 (Configure) to load a generated spritesheet. It plays at the center of Section 4 on top of the map layers.
3. **FPS** control sets playback speed.
4. **Drag** the sprite to reposition it on the map.
5. Use mouse scroll over Section 4 to zoom in and out.

**Optional – adding test spritesheets manually:** You can also place PNG files in `spritesheets-test/` and register them in `spritesheets-test/spritesheets.json` for direct loading (if supported by the UI):

```json
[
  { "id": "swat_attack_east", "label": "SWAT Attack East", "png": "SWAT_attack_east.png", "frameWidth": 16, "frameHeight": 13, "frameCount": 5 }
]
```

Frame dimensions must divide the image evenly (e.g. 80×13 with 5 frames → frameWidth 16, frameHeight 13).

Place `map_layer0.png` (base terrain) and `map_layer1.png` (scattered objects overlay) in `maps/` for the map to display. Layer 1 is processed on load: black/dark pixels (RGB ≤ 30) are made transparent so the overlay complements layer 0 instead of hiding it. Spritesheet sprites use depth 100 so they render above the map layers (0 and 1).

## Changelog

- **2026-03-14**: Sprite Viewer height, Configure grid clipping, drag fix
  - Section 1 (Sprite Viewer): Increased height (min-height 95px, canvas 65px), SECTION_BANDS adjusted (80px band); sprite centered in band
  - Configure grid sprawl: Cameras 1, 2, 4 now ignore the configureGridContainer so zoomed grid no longer bleeds into other sections
  - Configure drag: Use section-3-canvas getBoundingClientRect to detect clicks; sections use pointer-events: none with children auto so canvas-host clicks reach the canvas
- **2026-03-14**: UI fixes and enhancements
  - Layout: Section 1 reduced height (auto, 40px canvas) to remove dead space; Section 3 overflow: visible to eliminate vertical scrollbar; Section 2/4 proportions adjusted; SECTION_BANDS updated for new layout
  - Section 2 (Animations): Added "Custom..." option — select sprite from dropdown, set frame start/end, click Load to display a horizontal strip of frames
  - Section 3 (Configure): Zoom +/- buttons; drag-to-move now uses the Move dropdown selection (click anywhere in section to drag the selected slot)
  - Section 4 (Tester): Zoom +/- buttons
  - canvas-host: pointer-events: none so Phaser input receives clicks
- **2026-03-14**: Spritesheet Tester (Section 4) map and animation layout
  - Map now uses cover scaling (`Math.max`) so it fills the entire Section 4 viewport instead of fitting small in the center
  - Test animation sprite is placed at the center of Section 4's camera view (computed from `getSection4Center()`)
  - Map and sprite reposition correctly when the section viewport changes (resize)
- **2026-03-14**: Frame sizing for large units (DireWolf, etc.) + Animations section base-only export
  - Unit export and Spritesheet Tester use 1:1 sizing (unitScale=1, EXPORT_SCALE=1) so larger units display at correct size
  - Custom mode: `generateAnimSpritesheet` and `testAllAnimations` use metadata `w`/`h` when available for frame dimensions
  - **Animations section Export/Test**: Exports base unit animations only, no shoot-effect overlay (SWAT attack no longer includes muzzle flash)
  - **Grid export bleed fix**: Per-cell clip and clear so sprites cannot bleed into adjacent cells (fixes yellow artifact from shoot effect bleeding into base frames)
  - `scripts/backfill_frames_metadata.py`: Backfills `w`/`h` into existing `*_frames.json` from PNG dimensions when metadata lacks them
- **2026-03-14**: Fix Export/Test Spritesheet Accuracy (Section 2)
  - Section 2 Export/Test buttons for **units** now use the proven old Units export pipeline (`exportUnitGridAnimationToSpritesheet`, `exportAllUnitGridAnimationsToSpritesheet`) instead of the simplified `generateAnimSpritesheet`
  - Pipeline uses per-frame bounds and unitScale/EXPORT_SCALE=1 for correct spritesheet output (see above for large-unit sizing fix)
  - When a unit is loaded in Section 2, `unitGridMeta` and `unitGridStem` are synced so Export/Test use the same draw logic as the Units tab
  - For **Effects (Extras)**, `generateAnimSpritesheet` remains in use (scope limited to units)
  - `exportUnitGridAnimationToSpritesheet` and `exportAllUnitGridAnimationsToSpritesheet` accept optional `sendToTester` and `statusElId` params; when `sendToTester` is true, spritesheet is sent to Section 4 instead of downloaded
  - Test All sends the first animation's row to the tester (25-row grid format; tester expects horizontal strip)
- **2026-03-14**: Section 2 Unit selector + zoom
  - Animations section: Unit dropdown (ElPresidente, Flamer, SWAT, etc.) and Effects (Extras); Phaser-rendered 1-row strip with correct animation-to-frame mapping (UNIT_ANIMATIONS, EFFECTS_ANIMATIONS)
  - Mouse wheel zoom in all 4 sections (Sprite Viewer, Animations, Configure, Spritesheet Tester)
  - Horizontal scrollbar for Animations strip when content overflows
- **2026-03-14**: Unified Sprite Viewer layout
  - Replaced tab-based UI with four stacked sections (Sprite Viewer 20%, Animations 20%, Configure flex, Spritesheet Tester 35%)
  - Section 1: Sprite + Preset dropdown + Frame start/end; presets from UNIT_ANIMATIONS (units) or EFFECTS_ANIMATIONS (Extras)
  - Section 2: 1-row horizontal animation strip; Export, Export All, Test, Test All (no shoot-effect controls)
  - Section 3: Configure with Test button (sends spritesheet to Section 4)
  - Section 4: FPS control, drag-to-place on map; Test from S2/S3 loads spritesheet
  - Phaser multi-camera viewports for each section; removed Units/Effects tabs and shoot-effect controls
- **2026-03-13**: Spritesheet Tester tab
  - New tab to test exported spritesheets on a two-layer map background
  - Second bar below tab bar (visible only when Spritesheet Tester is active) with Spritesheet dropdown
  - **Dropdown selection**: Spritesheets loaded from `spritesheets-test/` folder via manifest (`spritesheets.json`); avoids file browse issues
  - **Layer 0 / Layer 1** checkboxes to toggle map layer visibility
  - **Layer 1 transparency**: Black/dark pixels (RGB ≤ 30) in map_layer1.png are made transparent so the overlay complements layer 0 instead of hiding it
  - Load via Phaser Loader from server URL; sprite depth 100 so it renders above map layers
  - Mouse scroll zoom (0.5×–3×)
- **2026-03-13**: Configure tab – Timeline and spritesheet export
  - **Timeline UI**: Multi-row timeline grid below the Configure canvas. Rows = layers (0=back, 1=middle, 2=front); columns = base frames. Click overlay cells to place blocks: overlay appears only on those base frames (e.g. shoot effect on frame 2 only).
  - **Export Spritesheet**: Button exports the composed animation as a PNG spritesheet (horizontal strip) + JSON frame definitions. Downloads to browser. Format compatible with Unity, Godot, Phaser.
  - **Units tab**: When composited spritesheets exist at `units/{path}/composite/{Name}.png` and `.json`, the Units tab loads and displays them instead of raw + overlay. Enables WYSIWYG accuracy.
  - `timelineBlocks` per layer in composition schema (optional, backward compatible).
- **2026-03-13**: Configure tab
  - Composition-first workflow: select animation to edit (SWAT attack north, etc.) from dropdown; loads into slots
  - Save updates in-memory compositions; switch to Units tab to see updates without reload
  - New Configure tab to compose up to 3 animations (units + effects) on a draggable grid
  - Select animations per slot, assign layers, set scale (0.05×–2×) and FPS (1–60) per layer independently
  - Drag to set offsets, Save downloads `animation-compositions.json` (includes scale/fps per layer)
  - Units tab uses composition overlays when file exists (replaces `ATTACK_TO_SHOOT_EFFECT` for SWAT)
  - Predefined SWAT attack compositions for all 8 directions with tuned scale (0.3), fps (4), and offsets
  - Overlay rendering uses `layer.scale` from composition when present (preserves Configure tab ratio)
- Offset conversion: effect position is relative to unit; scaled by `(cellScale / unitLayerScale)` to match Configure
  - `viewer/src/configure-config.js`, `viewer/src/animation-compositions.json`
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

- **2026-03-14**: Repo cleanup and de-coupling
  - Removed extracted PNG assets from repo (kept locally; added to .gitignore)
  - Switched to local `content/` folder for game files instead of APPDATA
  - Renamed `OpenKrushPath` → `SourcePath` (optional); Phase 1 now optional
  - Removed all OpenKrush references from docs and README
  - Revamped README: fan-modding, solo/offline, just-for-fun disclaimer
