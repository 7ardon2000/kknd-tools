# KKnD Tools

A set of **modding tools** for **KKnD** (Krush Kill 'n Destroy) — built by fans, for fans. Extract sprites, preview animations, and tinker with game assets for **solo, offline, just-for-fun** projects.

> **Disclaimer:** These tools are intended for **enthusiastic fans** who want more freedom to create personal mods — for testing, experimentation, and fun. **Single-player and offline use only.** Not for multiplayer, competitive, or commercial use.

---

## ⚠️ WORK IN PROGRESS — Known Issues

**This project is actively in development.** Expect bugs and rough edges:

- **Frame sizing**: Exported spritesheet frame sizes can be incorrect for larger units (e.g. DireWolf) or when metadata `w`/`h` is missing. Run `python scripts/backfill_frames_metadata.py` after extraction to improve accuracy.
- **Export artifacts**: Some sprites may show visual artifacts (e.g. stray pixels) when exporting. Per-cell clipping helps but edge cases remain.
- **Shoot effect composition**: SWAT attack + muzzle flash composition is tuned for specific units; other units may need manual adjustment.
- **UI/UX**: The viewer layout and controls are still being refined.

Use at your own risk. Report issues on [GitHub Issues](https://github.com/TajRizek/kknd-tools/issues).

## What You Get

- **MOBD/LVL extractor** — Converts sprite data from `SPRITES.LVL` to PNG frames with metadata
- **Frame metadata** (`*_frames.json`) — Rotational/simple animations, directions, per-frame offsets (ox, oy)
- **Phaser Animation Viewer** — Browser tool to preview and verify extracted animations
- **Scripts** — Python + PowerShell for extraction and manifest generation

## Quick Start

```powershell
# 1. Ensure KKnD Xtreme is installed at C:\Games\KKND Xtreme
# 2. Run extraction (copies game files to content/, extracts MOBD → PNG)
.\extract-assets.ps1

# 3. For Gen1 sprites, place palette.png in content/ (256-color palette from your game)

# 4. Run the animation viewer
npm start
```

Open http://localhost:5173 to preview animations.

**Requires:** [KKnD Xtreme](https://store.steampowered.com/app/281030/KKND_Xtreme/) at `C:\Games\KKND Xtreme`, Python 3, Pillow, Node.js 18+

## Extraction

1. **Phase 0** — Copies game content (SPRITES.LVL, MUTE.SLV, SURV.SLV) from KKnD Xtreme into `content/`
2. **Phase 1** — Optional: Copy PNG assets (sidebar, UI) if you provide `-SourcePath` to a compatible source
3. **Phase 2** — Parses MOBD from `sprites.lvl`, exports PNG frames, writes metadata

See [documentation.md](documentation.md) for details.

## Metadata Format

Each sprite folder contains `{Name}_frames.json`:

```json
{
  "rotational_count": 50,
  "simple_count": 0,
  "total_frames": 248,
  "frames": [
    {"i": 0, "anim": "rotational", "frame": 0, "ox": 12, "oy": 13, "dir": 0},
    ...
  ]
}
```

- **i**: Global frame index → `{Name}_{i:04d}.png`
- **anim**: `"rotational"` or `"simple"`
- **frame**: Index within current animation
- **ox**, **oy**: Anchor point for correct placement
- **dir** (rotational): Direction 0..N
- **idx** (simple): Animation index

See [documentation.md](documentation.md) for full details.

## Animation Viewer

```bash
npm start
```

Open http://localhost:5173. The viewer uses a **unified four-section layout** — all sections are visible at once (no tabs).

### Section 1 — Sprite Viewer (top)

- **Sprite**: Choose any unit or effect from the dropdown.
- **Preset**: Quick presets like "stand north", "attack east", or "Custom" for manual frame range.
- **Frame start / end**: Define which frames to display.
- **Speed**: Playback rate (frames per second).
- **Play** / **Step**: Control animation playback.

Use this to inspect a single sprite or browse a frame range.

### Section 2 — Animations

- **Unit**: Select an infantry unit (ElPresidente, SWAT, etc.) or **Effects (Extras)**. Use **Custom...** to pick any sprite and set a frame range manually.
- **Horizontal strip**: Shows all 25 unit animations or 59 effect animations in one scrollable row. Each cell plays at 8 FPS. Click to select.
- **Export** / **Export All**: Download spritesheet PNGs (base animations only — no shoot-effect overlay).
- **Test** / **Test All**: Send the generated spritesheet to Section 4 (Spritesheet Tester).

### Section 3 — Configure (combine sprites)

Compose up to 3 layers (e.g. unit + muzzle flash):

- **Animation**: Pick a SWAT attack (or "New composition...") to edit.
- **Slots 1–3**: Each slot = one animation (unit, effect, etc.). Set layer order, scale, and FPS.
- **Timeline**: Click cells to decide when overlays appear (e.g. muzzle flash only on frame 2).
- **Drag**: Move sprites on the canvas; use Move dropdown + arrow keys for fine control.
- **Save**: Updates compositions and downloads `animation-compositions.json`.
- **Export** / **Test**: Render the composed spritesheet or send it to Section 4.

### Section 4 — Spritesheet Tester

- Receives spritesheets from **Test** in Sections 2 or 3.
- Plays the animation over a map background.
- **FPS**: Adjust playback speed.
- **Zoom**: Mouse scroll to zoom in/out.
- **Drag**: Reposition the sprite on the map.

After extraction, regenerate the sprite list:

```bash
python scripts/generate-viewer-manifest.py
```

## Output Layout

```
content/              → sprites.lvl, palette.png (game content; not committed)
units/direwolf/       → DireWolf.mobd, DireWolf_0000.png..0247.png, DireWolf_frames.json
effects/extras/       → Extras.mobd, Extras_0000.png..0391.png, Extras_frames.json
ui/buttons/          → Buttons.mobd, Buttons_*.png, Buttons_frames.json
viewer/               → Phaser animation tester
```

**Note:** Extracted PNGs and `content/` are kept locally for testing. They are not committed to the repo.

## Documentation

See [documentation.md](documentation.md) for:

- How extraction works (phases 0–2)
- Metadata format and field meanings
- How to run and use the animation viewer
- Script parameters and options

## License

Scripts: GPL-3.0. See [LICENSE](LICENSE). Use responsibly — for personal, non-commercial, offline modding fun only.
