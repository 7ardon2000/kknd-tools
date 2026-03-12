#!/usr/bin/env python3
"""
KKnD MOBD/LVL Extractor - Extracts unit frames and effects from sprites.lvl to PNG.
Ported from OpenKrush MobdLoader, Lvl, MobdImage (Gen1/SPRT format).
Requires: pip install Pillow
"""

import json
import struct
import sys
from pathlib import Path

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
    """Load 256-color palette from OpenKrush palette.png"""
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


class MobdImage:
    def __init__(self, data, offset, flags, gen1=True):
        self.offset = offset
        pos = offset
        width, height = struct.unpack_from('<ii', data, pos)
        pos += 8
        self.width = width
        self.height = height
        self.pixels = bytearray(width * height)

        if gen1:
            flipped = (flags & 1) == 1
            is_compressed = data[pos] == 2
            pos += 1
            if is_compressed:
                pos = self._decompress_gen1(data, pos)
            else:
                self.pixels[:] = data[pos:pos + len(self.pixels)]
                pos += len(self.pixels)
            if flipped:
                for i in range(height):
                    row_start = i * width
                    self.pixels[row_start:row_start+width] = reversed(self.pixels[row_start:row_start+width])
        else:
            flipped = ((flags >> 31) & 1) == 1
            is_compressed = ((flags >> 27) & 1) == 1
            has_256 = ((flags >> 26) & 1) == 1
            if is_compressed:
                pos = self._decompress_gen2(data, pos, has_256)
            else:
                self.pixels[:] = data[pos:pos + len(self.pixels)]
                pos += len(self.pixels)
            if flipped:
                for i in range(height):
                    row_start = i * width
                    self.pixels[row_start:row_start+width] = reversed(self.pixels[row_start:row_start+width])
        self.end_pos = pos

    def _decompress_gen1(self, data, pos):
        decompressed = bytearray()
        cap = len(self.pixels)
        while len(decompressed) < cap:
            compressed_size = data[pos] - 1
            pos += 1
            line_end = pos + compressed_size
            is_skip = True
            while pos < line_end:
                chunk = data[pos]
                pos += 1
                if is_skip:
                    decompressed.extend(b'\x00' * chunk)
                else:
                    decompressed.extend(data[pos:pos+chunk])
                    pos += chunk
                is_skip = not is_skip
            # Align to width
            rem = (self.width - (len(decompressed) % self.width)) % self.width
            decompressed.extend(b'\x00' * rem)
        self.pixels[:] = decompressed[:cap]
        return pos

    def _decompress_gen2(self, data, pos, has_256):
        decompressed = bytearray()
        cap = len(self.pixels)
        while len(decompressed) < cap:
            if has_256:
                compressed_size, = struct.unpack_from('<H', data, pos)
                pos += 2
            else:
                compressed_size = data[pos]
                pos += 1

            if compressed_size == 0:
                decompressed.extend(b'\x00' * self.width)
            elif not has_256 and compressed_size > 0x80:
                pixel_count = compressed_size - 0x80
                for _ in range(pixel_count):
                    two = data[pos]
                    pos += 1
                    decompressed.append((two >> 4) & 0xF)
                    if len(decompressed) % self.width != 0:
                        decompressed.append(two & 0xF)
            else:
                line_end = pos + compressed_size
                while pos < line_end:
                    chunk = data[pos]
                    pos += 1
                    if chunk < 0x80:
                        decompressed.extend(b'\x00' * chunk)
                    else:
                        pixel_count = chunk - 0x80
                        if has_256:
                            decompressed.extend(data[pos:pos+pixel_count])
                            pos += pixel_count
                        else:
                            size = pixel_count // 2 + pixel_count % 2
                            for j in range(size):
                                two = data[pos]
                                pos += 1
                                decompressed.append((two >> 4) & 0xF)
                                if j + 1 < size or pixel_count % 2 == 0:
                                    decompressed.append(two & 0xF)
            rem = (self.width - (len(decompressed) % self.width)) % self.width
            decompressed.extend(b'\x00' * rem)
        self.pixels[:] = decompressed[:cap]
        return pos


def parse_mobd_render_flags(data, offset, default_palette):
    """Parse MobdRenderFlags, return (MobdImage, palette_or_none). All offsets absolute in data."""
    pos = offset
    if pos + 16 > len(data):
        return None, None
    type_chars = bytes(reversed(data[pos:pos+4]))
    pos += 4
    type_str = type_chars.decode('ascii', errors='replace')
    flags, = struct.unpack_from('<I', data, pos)
    pos += 4
    gen1 = type_str == 'SPRT'
    palette = None

    if type_str in ('SPNS', 'SPRC'):
        pal_off, = struct.unpack_from('<I', data, pos)
        pos += 4
        return_pos = pos
        pos = pal_off
        if pos + 14 <= len(data):
            pos += 12  # skip 3x uint32
            num_colors, = struct.unpack_from('<H', data, pos)
            pos += 2
            palette = []
            for _ in range(min(num_colors, 256)):
                if pos + 2 > len(data):
                    break
                color16, = struct.unpack_from('<H', data, pos)
                pos += 2
                r = ((color16 & 0x7c00) >> 7) & 0xff
                g = ((color16 & 0x03e0) >> 2) & 0xff
                b = ((color16 & 0x001f) << 3) & 0xff
                palette.append((r, g, b))
            while len(palette) < 256:
                palette.append((0, 0, 0))
        pos = return_pos

    if pos + 4 > len(data):
        return None, palette
    img_offset, = struct.unpack_from('<I', data, pos)
    # imageOffset is absolute position in data
    img_offset_abs = img_offset
    if img_offset_abs < 0 or img_offset_abs >= len(data):
        return None, palette
    try:
        img = MobdImage(data, img_offset_abs, flags, gen1=gen1)
        return img, palette
    except (struct.error, IndexError, EOFError):
        return None, palette


def parse_mobd_frame(data, offset, default_palette):
    """Parse MobdFrame at offset. Returns (ox, oy, img, palette) or (0, 0, None, None)."""
    if offset + 28 > len(data):
        return 0, 0, None, None
    pos = offset
    ox, oy = struct.unpack_from('<II', data, pos)
    pos += 8
    pos += 4   # unk
    render_flags_off, = struct.unpack_from('<I', data, pos)
    pos += 4
    pos += 8   # boxListOffset, unk
    point_list_off, = struct.unpack_from('<I', data, pos)
    if render_flags_off < 0 or render_flags_off >= len(data):
        return ox, oy, None, None
    img, pal = parse_mobd_render_flags(data, render_flags_off, default_palette)
    return ox, oy, img, pal


def _missing_frame_workaround(pos):
    """Port of MobdAnimation position-specific workarounds."""
    if pos == 174278:
        return 2   # Beetle
    if pos in (2010426, 2010466):
        return 1   # Flame
    if pos == 2094122:
        return 1   # Gort
    return 0


def parse_mobd_animation(data, offset, default_palette):
    """Parse MobdAnimation at offset. Yields (ox, oy, img, palette) for each frame."""
    if offset + 8 > len(data):
        return
    pos = offset
    missing = _missing_frame_workaround(pos)
    pos += 4   # unk
    while pos + 4 <= len(data):
        value, = struct.unpack_from('<i', data, pos)
        pos += 4
        if value in (0, -1):
            break
        if value < 0 or value >= len(data):
            continue
        ox, oy, img, pal = parse_mobd_frame(data, value, default_palette)
        if img and img.width > 0 and img.height > 0 and img.width < 2048 and img.height < 2048:
            yield ox, oy, img, pal
            if missing > 0:
                missing -= 1
                yield ox, oy, img, pal


def parse_mobd(data, mobd_start, mobd_end, default_palette=None):
    """Parse MOBD structure. Yields (anim_type, anim_idx, frame_idx, global_idx, ox, oy, img, pal)."""
    file_start = mobd_start
    first_frame_start = mobd_end
    animation_offsets = []
    pos = mobd_start

    # Phase 1: collect animation offset positions and find first frame
    phase2_start = mobd_start
    while pos + 4 <= first_frame_start and pos < len(data):
        value, = struct.unpack_from('<i', data, pos)
        if value == 0 or (0 <= value < pos and value >= file_start):
            phase2_start = pos  # rewind: we're at the value that triggered break
            break
        animation_offsets.append(pos)
        pos += 4
        while pos + 4 <= len(data):
            v, = struct.unpack_from('<i', data, pos)
            pos += 4
            if v in (-1, 0):
                break
            if 0 < v < len(data):
                first_frame_start = min(first_frame_start, v)

    # Phase 2: rotational - scan from phase2_start to first_frame_start
    remaining = list(animation_offsets)
    scan_pos = phase2_start
    rotational_idx = 0
    global_idx = 0
    while scan_pos + 4 <= first_frame_start and scan_pos < len(data):
        value, = struct.unpack_from('<I', data, scan_pos)
        scan_pos += 4
        if value == 0:
            continue
        if value in remaining:
            remaining.remove(value)
            for frame_idx, (ox, oy, img, pal) in enumerate(parse_mobd_animation(data, value, default_palette)):
                yield "rotational", rotational_idx, frame_idx, global_idx, ox, oy, img, pal
                global_idx += 1
            rotational_idx += 1

    # Phase 3: simple animations - remaining table starts
    simple_idx = 0
    for anim_off in remaining:
        if anim_off + 8 > len(data):
            continue
        for frame_idx, (ox, oy, img, pal) in enumerate(parse_mobd_animation(data, anim_off, default_palette)):
            yield "simple", simple_idx, frame_idx, global_idx, ox, oy, img, pal
            global_idx += 1
        simple_idx += 1


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


def extract_mobd_to_png(lvl_data, offset, size, output_dir, palette, name):
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
        for anim_type, anim_idx, frame_idx, global_idx, ox, oy, img, pal in parse_mobd(
            lvl_data, offset, offset + size, palette
        ):
            if anim_type == "rotational":
                rotational_count = max(rotational_count, anim_idx + 1)
            else:
                simple_count = max(simple_count, anim_idx + 1)
            entry = {"i": global_idx, "anim": anim_type, "frame": frame_idx, "ox": ox, "oy": oy}
            if anim_type == "rotational":
                entry["dir"] = anim_idx
            else:
                entry["idx"] = anim_idx
            frames_meta.append(entry)
            pal_use = pal if pal else palette
            if not pal_use or not img or img.width <= 0 or img.height <= 0:
                continue
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
    base = Path(__file__).parent
    content_dir = Path(os.environ.get('OPENRA_CONTENT', str(base / 'content')))
    sprites_lvl = content_dir / 'openkrush_gen1' / 'sprites.lvl'
    if not sprites_lvl.exists():
        sprites_lvl = Path(os.environ['APPDATA']) / 'OpenRA' / 'Content' / 'openkrush_gen1' / 'sprites.lvl'
    lookup_path = base / 'openkrush' / 'mods' / 'openkrush_gen1' / 'archives' / 'sprites.lvl.yaml'
    palette_path = base / 'openkrush' / 'mods' / 'openkrush_gen1' / 'core' / 'rules' / 'palette.png'

    if not sprites_lvl.exists():
        apd = os.environ.get('APPDATA', '')
        if apd:
            sprites_lvl = Path(apd) / 'OpenRA' / 'Content' / 'openkrush_gen1' / 'sprites.lvl'
    if not sprites_lvl.exists():
        print("sprites.lvl not found. Run extract-assets.ps1 first to copy game content.")
        sys.exit(1)
    if not palette_path.exists():
        print(f"palette.png not found at {palette_path}")
        sys.exit(1)

    palette = load_palette(palette_path)
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
            n = extract_mobd_to_png(lvl_data, offset, size, out_sub, palette, mobd_name)
            if n > 0:
                print(f"Extracted {mobd_name}")
        except Exception as e:
            print(f"Skip {mobd_name}: {e}")


if __name__ == '__main__':
    main()
