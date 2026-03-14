#!/usr/bin/env python3
"""
Backfill w,h into *_frames.json from existing PNGs.
Use when metadata was extracted before w,h were added to the schema.
Run from project root: python scripts/backfill_frames_metadata.py
"""
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Install Pillow: pip install Pillow")
    sys.exit(1)


def backfill_dir(dir_path):
    """Add w,h to frames in a _frames.json from PNG dimensions."""
    dir_path = Path(dir_path)
    frames_files = list(dir_path.glob("*_frames.json"))
    if not frames_files:
        return 0
    count = 0
    for frames_path in frames_files:
        stem = frames_path.stem.replace("_frames", "")
        try:
            with open(frames_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            print(f"  Skip {frames_path}: {e}")
            continue
        frames = data.get("frames")
        if not frames:
            continue
        updated = False
        for entry in frames:
            if "w" in entry and "h" in entry:
                continue
            i = entry.get("i", 0)
            png_path = dir_path / f"{stem}_{i:04d}.png"
            if not png_path.exists():
                continue
            try:
                img = Image.open(png_path)
                entry["w"] = img.width
                entry["h"] = img.height
                updated = True
                count += 1
            except Exception:
                pass
        if updated:
            with open(frames_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            print(f"  Updated {frames_path.name}")
    return count


def main():
    base = Path(__file__).parent.parent
    units_dir = base / "units"
    effects_dir = base / "effects"
    total = 0
    for parent in (units_dir, effects_dir):
        if not parent.exists():
            continue
        print(f"Scanning {parent}...")
        for sub in parent.iterdir():
            if sub.is_dir():
                n = backfill_dir(sub)
                total += n
    print(f"Backfilled w,h for {total} frame entries")


if __name__ == "__main__":
    main()
