#!/usr/bin/env python3
"""
KKnD sprite extractor: SPRITES.LVL -> units/, effects/, ui/ with the raw .mobd, PNG frames and
{Name}_frames.json metadata (origins, animation structure, weapon/turret points).

    python extract_mobd.py                  # PNGs + metadata
    python extract_mobd.py --metadata-only  # metadata only

SPRITES.LVL comes from content/sprites.lvl, a KKnD Xtreme install (set KKND_XTREME to its folder if
it is not found automatically), or the free official KKnD Xtreme demo, downloaded once (see
tools/gamedata.py). Parsing lives in tools/mobd.py (a port of the OpenKrush reader). The palette and
LVL file names come from OpenKrush. Requires: pip install Pillow
"""

import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "tools"))
import gamedata  # noqa: E402
import mobd  # noqa: E402

try:
    from PIL import Image
except ImportError:
    print("Install Pillow: pip install Pillow")
    sys.exit(1)


def read_struct(f, fmt):
    size = struct.calcsize(fmt)
    data = f.read(size)
    if len(data) < size:
        raise EOFError
    return struct.unpack(fmt, data)


def load_palette(palette_path):
    """Load 256-color palette from a PNG file (e.g. palette.png)."""
    img = Image.open(palette_path)
    if img.mode == 'P' and 'transparency' in img.info:
        palette = list(img.getcolors(256)) if img.getcolors else []
    # Get colors from palette PNG - usually first row or palette attr
    if hasattr(img, 'getpalette') and img.getpalette():
        pal = img.getpalette()
        return [(pal[i*3], pal[i*3+1], pal[i*3+2]) for i in range(min(256, len(pal)//3))]
    # Fallback: sample first row
    data = list(img.getdata())
    seen = {}
    colors = []
    for c in data:
        if c not in seen and len(colors) < 256:
            seen[c] = len(colors)
            if isinstance(c, tuple):
                colors.append(c[:3])
            else:
                colors.append((c, c, c))
    while len(colors) < 256:
        colors.append((0, 0, 0))
    return colors[:256]


class _Img:
    __slots__ = ("width", "height", "pixels")

    def __init__(self, w, h, pixels):
        self.width, self.height, self.pixels = w, h, pixels


def parse_mobd(data, mobd_start, mobd_end, default_palette=None):
    """Parse a MOBD embedded in LVL data. Yields
    (anim_type, anim_idx, frame_idx, global_idx, ox, oy, img, palette, points).

    Uses tools/mobd.py (a port of the OpenKrush reader). Points are
    {"id", "x", "y"} offsets in pixels from the frame origin; id 0 is the weapon
    (or turret mount) point. Origins can be negative or exceed the image size
    (effects anchored outside their own pixels), so never clamp them.
    """
    rot, simple = mobd.parse(data[mobd_start:mobd_end], mobd_start)
    g = 0
    for kind, anims in (("rotational", rot), ("simple", simple)):
        for ai, anim in enumerate(anims):
            for fi, f in enumerate(anim.frames):
                yield kind, ai, fi, g, f.ox, f.oy, _Img(f.w, f.h, f.pixels), f.palette, f.points
                g += 1


def _image_to_png(img, palette, output_path):
    """Save MobdImage as indexed PNG with palette; index 0 transparent."""
    if not palette or len(palette) < 256:
        return False
    pal_flat = []
    for r, g, b in palette[:256]:
        pal_flat.extend((r, g, b))
    while len(pal_flat) < 768:
        pal_flat.extend((0, 0, 0))
    pimg = Image.new('P', (img.width, img.height))
    pimg.putpalette(pal_flat[:768])
    pimg.putdata(bytes(img.pixels))
    pimg.info['transparency'] = 0
    pimg.save(output_path, 'PNG')
    return True


def extract_mobd_raw(lvl_data, offset, size, output_path):
    """Extract raw MOBD binary to file."""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'wb') as f:
        f.write(lvl_data[offset:offset+size])
    return True


def extract_mobd_to_png(lvl_data, offset, size, output_dir, palette, name, metadata_only=False):
    """Extract raw MOBD binary, convert frames to PNGs, and write frame metadata JSON."""
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    base = Path(name).stem
    raw_file = out_path / f"{base}.mobd"
    with open(raw_file, 'wb') as f:
        f.write(lvl_data[offset:offset+size])

    frames_meta = []
    png_count = 0
    rotational_count = 0
    simple_count = 0
    try:
        for anim_type, anim_idx, frame_idx, global_idx, ox, oy, img, pal, points in parse_mobd(
            lvl_data, offset, offset + size, palette
        ):
            if anim_type == "rotational":
                rotational_count = max(rotational_count, anim_idx + 1)
            else:
                simple_count = max(simple_count, anim_idx + 1)
            entry = {"i": global_idx, "anim": anim_type, "frame": frame_idx, "ox": ox, "oy": oy}
            if img and img.width > 0 and img.height > 0:
                entry["w"] = img.width
                entry["h"] = img.height
            if points:
                entry["points"] = points
            if anim_type == "rotational":
                entry["dir"] = anim_idx
            else:
                entry["idx"] = anim_idx
            frames_meta.append(entry)
            pal_use = pal if pal else palette
            if not metadata_only and pal_use and img and img.width > 0 and img.height > 0:
                png_path = out_path / f"{base}_{global_idx:04d}.png"
                if _image_to_png(img, pal_use, png_path):
                    png_count += 1
        json_path = out_path / f"{base}_frames.json"
        with open(json_path, 'w') as f:
            json.dump({
                "rotational_count": rotational_count,
                "simple_count": simple_count,
                "total_frames": len(frames_meta),
                "frames": frames_meta
            }, f, indent=2)
    except Exception as e:
        sys.stderr.write(f"PNG conversion failed for {base}: {e}\n")

    return 1 + png_count


def main():
    import argparse
    base = Path(__file__).parent
    content_dir = base / 'content'

    parser = argparse.ArgumentParser(description='Extract KKnD MOBD sprites from SPRITES.LVL to PNG frames + metadata')
    parser.add_argument('--metadata-only', action='store_true', help='only write {Name}_frames.json, no PNGs')
    parser.add_argument('--openkrush', help='path to an OpenKrush checkout (default: .cache/openkrush, cloned if needed)')
    args = parser.parse_args()

    # palette and LVL file names: content/ first, else OpenKrush
    palette_path = content_dir / 'palette.png'
    lookup_path = content_dir / 'sprites.lvl.yaml'
    if not palette_path.exists() or not lookup_path.exists():
        from build_battle_assets import ensure_openkrush
        gen1 = ensure_openkrush(args.openkrush) / 'mods' / 'openkrush_gen1'
        if not palette_path.exists():
            palette_path = gen1 / 'core' / 'rules' / 'palette.png'
        if not lookup_path.exists():
            lookup_path = gen1 / 'archives' / 'sprites.lvl.yaml'
    palette = load_palette(palette_path)

    raw, source = gamedata.sprites_lvl()
    print(f"SPRITES.LVL from {source}")
    index, lvl_data = gamedata.lvl_index(raw, lookup_path)
    effect_stems = {'extras', 'flame', 'shrapnels', 'oil'}
    ui_stems = {'gui', 'buttons', 'cursors', 'bigfont', 'fontmini', 'fontregular', 'uifont'}
    count = 0
    for name, (offset, size) in index.items():
        if not name.endswith('.mobd') or size <= 0:
            continue
        stem = Path(name).stem.lower()
        group = 'effects' if stem in effect_stems else 'ui' if stem in ui_stems else 'units'
        try:
            extract_mobd_to_png(lvl_data, offset, size, base / group / stem, palette, name,
                                metadata_only=args.metadata_only)
            count += 1
        except Exception as ex:  # keep going: one bad file should not stop the rest
            print(f"Skip {name}: {ex}")
    print(f"Extracted {count} MOBD files into units/, effects/ and ui/")


if __name__ == '__main__':
    main()
