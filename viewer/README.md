# KKnD Animation Viewer

Phaser-based viewer for MOBD animations extracted by `extract_mobd.py`.

## Prerequisites

- Node.js 18+
- npm

## Setup

```bash
cd viewer
npm install
```

## Run

```bash
npm run dev
```

Open http://localhost:5173 and pick a sprite from the dropdown. Use the direction/anim filter to view specific rotational or simple animations.

## Regenerate Sprite List

After extracting new MOBDs, regenerate the manifest (from repo root):

```bash
python scripts/generate-viewer-manifest.py
```

This writes `viewer/src/sprites.json`.

## Controls

- **Sprite**: Select which unit/effect to view
- **Direction / Anim**: Filter by rotational direction (Dir 0..N) or simple animation (Simple 0..N)
- **Speed**: Animation playback speed (frames per second)
- **Play / Pause**: Toggle animation
- **Step**: Advance one frame manually
