# KKnD Tools

A set of **modding tools** for **KKnD** (Krush Kill 'n Destroy) — built by fans, for fans. Extract sprites, preview animations, and tinker with game assets for **solo, offline, just-for-fun** projects.

> **Disclaimer:** These tools are intended for **enthusiastic fans** who want more freedom to create personal mods — for testing, experimentation, and fun. **Single-player and offline use only.** Not for multiplayer, competitive, or commercial use.

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

Pick a sprite, filter by direction/anim, and play. Per-frame hotspot (ox, oy) is applied for correct placement.

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
