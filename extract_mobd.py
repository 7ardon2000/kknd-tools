#!/usr/bin/env python3
"""
KKnD MOBD/LVL extractor: SPRITES.LVL (or the .mobd files in this repo) -> PNG frames + metadata JSON.

    python extract_mobd.py                  # from content/sprites.lvl (copied by extract-assets.ps1)
    python extract_mobd.py --from-repo      # re-parse the .mobd files already in units/, effects/, ui/
    python extract_mobd.py --metadata-only  # JSON only, no PNGs

Parsing lives in tools/mobd.py (a port of the OpenKrush reader). The palette and the LVL file names
come from content/ if present, otherwise from OpenKrush (cloned to .cache/openkrush on first use).
Supports Gen1 (SPRT) and Gen2 (SPNS/SPRC). Requires: pip install Pillow
"""

import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "tools"))
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


def parse_lvl(lvl_path, lookup_yaml_path=None):
    """Parse LVL file, return dict of filename -> (offset, size)"""
    with open(lvl_path, 'rb') as f:
        raw = f.read()

    # KKnD LVL has DATA header: "DATA" (4) + size (4, big-endian)
    if raw[:4] == b'DATA':
        size = (raw[4] << 24) | (raw[5] << 16) | (raw[6] << 8) | raw[7]
        data = raw[8:8+size]
    else:
        data = raw

    lookup = {}
    if lookup_yaml_path and Path(lookup_yaml_path).exists():
        with open(lookup_yaml_path) as fp:
            for line in fp:
                if ':' in line and not line.strip().startswith('#'):
                    k, v = line.strip().split(':', 1)
                    lookup[k.strip()] = v.strip()

    file_type_list_offset, = struct.unpack_from('<i', data, 0)
    index = {}
    pos = file_type_list_offset
    first_file_list_offset = 0

    for i in range(1000):
        if pos + 8 > len(data):
            break
        file_type = data[pos:pos+4].decode('ascii', errors='replace')
        file_list_offset, = struct.unpack_from('<i', data, pos+4)
        pos += 8

        if file_list_offset == 0:
            break
        if first_file_list_offset == 0:
            first_file_list_offset = file_list_offset

        next_off_pos = pos
        if next_off_pos + 4 <= len(data):
            file_list_end, = struct.unpack_from('<i', data, next_off_pos)
        else:
            file_list_end = file_type_list_offset
        if file_list_end == 0:
            file_list_end = file_type_list_offset

        list_pos = file_list_offset
        prev_offset = None
        prev_name = None
        j = 0
        while list_pos + 4 <= file_list_end and list_pos < len(data):
            file_offset, = struct.unpack_from('<i', data, list_pos)
            list_pos += 4

            if file_offset == 0:
                j += 1
                continue

            if prev_offset is not None:
                sz = file_offset - prev_offset
                index[prev_name] = (prev_offset, sz)

            asset_name = f"{j}.{file_type.lower()}"
            if asset_name in lookup:
                asset_name = lookup[asset_name]
            prev_offset = file_offset
            prev_name = asset_name
            j += 1

        if prev_offset is not None:
            sz = first_file_list_offset - prev_offset
            index[prev_name] = (prev_offset, sz)

    return index, data  # data is content after DATA header (offset 0 = start of content)


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
    import os
    import argparse
    base = Path(__file__).parent
    content_dir = Path(os.environ.get('KKND_CONTENT', str(base / 'content')))
    sprites_lvl = content_dir / 'sprites.lvl'
    lookup_path = content_dir / 'sprites.lvl.yaml'
    palette_path = content_dir / 'palette.png'

    parser = argparse.ArgumentParser(description='Extract MOBD frames from KKnD sprites.lvl')
    parser.add_argument('--metadata-only', action='store_true',
                        help='Only extract frame metadata (with points) to JSON, skip PNG. Works without palette.')
    parser.add_argument('--from-repo', action='store_true',
                        help='Re-parse the .mobd files already in units/, effects/, ui/ (no sprites.lvl needed). '
                             'Use this when you do not have the game installed.')
    parser.add_argument('--openkrush', help='path to an OpenKrush checkout (default: .cache/openkrush, cloned if needed)')
    args = parser.parse_args()

    # palette and LVL file names: content/ first, else OpenKrush
    if not palette_path.exists() or not lookup_path.exists():
        from build_battle_assets import ensure_openkrush
        gen1 = ensure_openkrush(args.openkrush) / 'mods' / 'openkrush_gen1'
        if not palette_path.exists():
            palette_path = gen1 / 'core' / 'rules' / 'palette.png'
        if not lookup_path.exists():
            lookup_path = gen1 / 'archives' / 'sprites.lvl.yaml'

    if args.from_repo:
        palette = load_palette(palette_path) if palette_path.exists() else None
        for p in sorted(base.glob('*/*/*.mobd')):
            if p.parts[-3] not in ('units', 'effects', 'ui') or p.stat().st_size == 0:
                continue
            data = p.read_bytes()
            meta = p.with_name(p.stem + '_frames.json')
            expected = json.loads(meta.read_text())['total_frames'] if meta.exists() else None
            try:
                # pointers inside a MOBD are absolute SPRITES.LVL offsets: recover where it lived
                offset, _, _ = mobd.find_base(data, expected)
            except ValueError as e:
                print(f"Skip {p.name}: {e}")
                continue
            lvl_like = bytes(offset) + data
            extract_mobd_to_png(lvl_like, offset, len(data), p.parent, palette or [(0, 0, 0)] * 256, p.name,
                                metadata_only=palette is None)
            print(f"Re-parsed {p.name} (LVL offset {offset:#x})")
        return

    if not sprites_lvl.exists():
        print("sprites.lvl not found in content/. Run extract-assets.ps1 first to copy game content from KKnD Xtreme.")
        sys.exit(1)
    if not args.metadata_only and not palette_path.exists():
        print(f"No palette found ({palette_path}).")
        sys.exit(1)

    palette = load_palette(palette_path) if palette_path.exists() else [(0, 0, 0)] * 256
    index, lvl_data = parse_lvl(sprites_lvl, lookup_path)
    mobd_entries = [k for k in index if k.endswith('.mobd')]
    print(f"Found {len(mobd_entries)} MOBD entries in LVL")

    output_base = base
    for mobd_name in index:
        if not mobd_name.endswith('.mobd'):
            continue
        if mobd_name not in index:
            continue
        offset, size = index[mobd_name]
        stem = Path(mobd_name).stem
        # Organize: effects (explosions, projectiles, oil), units (vehicles, infantry), ui
        effect_stems = {'extras', 'flame', 'shrapnels', 'oil'}
        ui_stems = {'gui', 'buttons', 'cursors', 'bigfont', 'fontmini', 'fontregular', 'uifont'}
        stem_lower = stem.lower()
        if stem_lower in effect_stems:
            out_sub = output_base / 'effects' / stem_lower
        elif stem_lower in ui_stems:
            out_sub = output_base / 'ui' / stem_lower
        else:
            out_sub = output_base / 'units' / stem_lower
        try:
            n = extract_mobd_to_png(lvl_data, offset, size, out_sub, palette, mobd_name, metadata_only=args.metadata_only)
            if n > 0:
                print(f"Extracted {mobd_name}")
        except Exception as e:
            print(f"Skip {mobd_name}: {e}")


if __name__ == '__main__':
    main()
