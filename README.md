# KKnD Assets

Tools and extracted assets for **KKnD** (Krush Kill 'n Destroy) unit frames and effects from the [OpenKrush](https://github.com/IceReaper/OpenKrush) mod (OpenRA engine).

## What You Get

- **81 MOBD sprites** converted to PNG frames (~9,500 PNGs) with metadata
- **Frame metadata** (`*_frames.json`) describing rotational/simple animations, directions, and per-frame offsets (ox, oy)
- **Phaser Animation Viewer** – browser tool to verify and preview animations
- **PNG assets** from the mod: sidebars, unit icons, UI (chrome, dialog, glyphs, logo)

## Quick Start

```powershell
# 1. Clone OpenKrush
git clone https://github.com/IceReaper/OpenKrush.git openkrush

# 2. Run extraction
.\extract-assets.ps1

# 3. Run the animation viewer
npm start
```

**Requires**: [KKnD Xtreme](https://store.steampowered.com/app/281030/KKND_Xtreme/) at `C:\Games\KKND Xtreme`, Python 3, Pillow, Node.js 18+

## Extraction

- **Phase 0**: Copies game content (SPRITES.LVL, MUTE.SLV, SURV.SLV) to OpenRA.
- **Phase 1**: Copies PNG assets (sidebars, icons, UI) from the mod.
- **Phase 2**: Parses MOBD from `sprites.lvl`, exports PNG frames, and writes metadata.

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
- **dir** (rotational): Direction 0..N (0=N, 1=NE, …)
- **idx** (simple): Animation index 0..M

See [documentation.md#metadata-file-format](documentation.md#metadata-file-format-name_framesjson) for full details.

## Animation Viewer

```bash
npm start
```

Open http://localhost:5173. Pick a sprite, filter by direction/anim, and play. Per-frame hotspot (ox, oy) is applied for correct placement.

After extraction, regenerate the sprite list:

```bash
python scripts/generate-viewer-manifest.py
```

## Output Layout

```
units/direwolf/     → DireWolf.mobd, DireWolf_0000.png..0247.png, DireWolf_frames.json
effects/extras/     → Extras.mobd, Extras_0000.png..0391.png, Extras_frames.json
ui/buttons/         → Buttons.mobd, Buttons_*.png, Buttons_frames.json
viewer/             → Phaser animation tester
```

## Documentation

See [documentation.md](documentation.md) for:

- How extraction works (phases 0–2)
- Metadata format and field meanings
- How to run and use the animation viewer
- Script parameters
- Changelog

## License

Scripts: GPL-3.0. See [LICENSE](LICENSE). Extracted assets derive from KKnD and OpenKrush; their use may be subject to the original game’s and mod’s terms.
