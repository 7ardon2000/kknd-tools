#!/usr/bin/env python3
"""
Generate viewer/sprites.json from *_frames.json files.
Run from repo root: python scripts/generate-viewer-manifest.py
"""
import json
from pathlib import Path

def main():
    repo = Path(__file__).parent.parent
    out_path = repo / 'viewer' / 'src' / 'sprites.json'
    entries = []
    skip_dirs = {'dist', 'node_modules', '.git', 'openkrush'}

    for frames_file in sorted(repo.rglob('*_frames.json')):
        if any(part in skip_dirs for part in frames_file.parts):
            continue
        rel = frames_file.relative_to(repo)
        path = str(rel.parent).replace('\\', '/')
        stem = frames_file.stem.replace('_frames', '')
        entries.append({"path": path, "stem": stem})

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(entries, f, indent=2)

    print(f"Wrote {len(entries)} sprites to {out_path}")

if __name__ == '__main__':
    main()
