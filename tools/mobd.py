"""
KKnD1 (Gen1) / KKnD2 (Gen2) MOBD sprite parser.

Port of the OpenKrush reader (OpenRA.Mods.OpenKrush/Assets/FileFormats/Mobd*.cs).

A MOBD stores pointers that are absolute offsets into the SPRITES.LVL data block (the
contents after its DATA header), not offsets relative to the .mobd file, so it is
parsed in place: parse(lvl_data[offset:offset + size], offset). See gamedata.lvl_index.
battle/src/gamefiles/mobd.js is a JavaScript port of this file.
"""

import struct


class Frame:
    __slots__ = ("ox", "oy", "w", "h", "pixels", "points", "palette", "image_key")

    def __init__(self):
        self.points = []
        self.palette = None


class Animation:
    __slots__ = ("unk", "frames", "offset")

    def __init__(self):
        self.frames = []


class _View:
    """Byte view addressed by absolute LVL offsets."""

    def __init__(self, data, base):
        self.data = data
        self.base = base
        self.end = base + len(data)

    def ok(self, pos, n=1):
        return self.base <= pos and pos + n <= self.end

    def i32(self, pos):
        if not self.ok(pos, 4):
            raise ValueError(f"read out of range at {pos:#x}")
        return struct.unpack_from("<i", self.data, pos - self.base)[0]

    def u32(self, pos):
        return self.i32(pos) & 0xFFFFFFFF

    def u16(self, pos):
        if not self.ok(pos, 2):
            raise ValueError(f"read out of range at {pos:#x}")
        return struct.unpack_from("<H", self.data, pos - self.base)[0]

    def u8(self, pos):
        if not self.ok(pos, 1):
            raise ValueError(f"read out of range at {pos:#x}")
        return self.data[pos - self.base]

    def bytes(self, pos, n):
        if not self.ok(pos, n):
            raise ValueError(f"read out of range at {pos:#x}")
        return self.data[pos - self.base:pos - self.base + n]


# OpenRA needs equal frame counts per facing, so OpenKrush duplicates a frame in a
# few animations that are one or two frames short. Keyed by absolute LVL offset.
_MISSING_FRAME_WORKAROUND = {174278: 2, 2010426: 1, 2010466: 1, 2094122: 1}


def _decompress_gen1(v, pos, w, h):
    out = bytearray(w * h)
    o = 0
    while o < len(out):
        size = v.u8(pos) - 1
        pos += 1
        line_end = pos + size
        skip = True
        while pos < line_end:
            n = v.u8(pos)
            pos += 1
            if skip:
                o += n
            else:
                out[o:o + n] = v.bytes(pos, n)
                o += n
                pos += n
            skip = not skip
        o += (w - o % w) % w
    if len(out) != w * h:
        raise ValueError("gen1 row overflow")
    return out


def _decompress_gen2(v, pos, w, h, has256):
    out = bytearray(w * h)
    o = 0

    def put(b):
        nonlocal o
        if o < len(out):
            out[o] = b
        o += 1

    while o < len(out):
        if has256:
            size = v.u16(pos)
            pos += 2
        else:
            size = v.u8(pos)
            pos += 1
        if size == 0:
            o += w
        elif not has256 and size > 0x80:
            for _ in range(size - 0x80):
                two = v.u8(pos)
                pos += 1
                put(two >> 4)
                if o % w != 0:
                    put(two & 0xF)
        else:
            line_end = pos + size
            while pos < line_end:
                n = v.u8(pos)
                pos += 1
                if n < 0x80:
                    o += n
                else:
                    count = n - 0x80
                    if has256:
                        for b in v.bytes(pos, count):
                            put(b)
                        pos += count
                    else:
                        nbytes = count // 2 + count % 2
                        for j in range(nbytes):
                            two = v.u8(pos)
                            pos += 1
                            put(two >> 4)
                            if j + 1 < nbytes or count % 2 == 0:
                                put(two & 0xF)
        o += (w - o % w) % w
    return bytes(out[:w * h])


def _read_render_flags(v, pos, frame):
    kind = v.bytes(pos, 4)[::-1].decode("ascii", "replace")
    flags = v.u32(pos + 4)
    pos += 8
    if kind == "SPRT":
        gen = 1
    elif kind in ("SPNS", "SPRC"):
        gen = 2
    else:
        raise ValueError(f"unknown render type {kind!r}")

    if gen == 2:
        pal_off = v.u32(pos)
        pos += 4
        p = pal_off + 12
        n = v.u16(p)
        p += 2
        pal = []
        for _ in range(min(n, 256)):
            c = v.u16(p)
            p += 2
            pal.append((((c & 0x7C00) >> 7) & 0xFF, ((c & 0x03E0) >> 2) & 0xFF, ((c & 0x1F) << 3) & 0xFF))
        frame.palette = pal + [(0, 0, 0)] * (256 - len(pal))

    img = v.u32(pos)
    frame.image_key = img
    w = v.i32(img)
    h = v.i32(img + 4)
    if not (0 < w < 1024 and 0 < h < 1024):
        raise ValueError(f"bad image size {w}x{h}")
    p = img + 8
    if gen == 1:
        flipped = flags & 1
        compressed = v.u8(p) == 2
        p += 1
        pixels = _decompress_gen1(v, p, w, h) if compressed else bytearray(v.bytes(p, w * h))
    else:
        flipped = (flags >> 31) & 1
        compressed = (flags >> 27) & 1
        has256 = (flags >> 26) & 1
        pixels = _decompress_gen2(v, p, w, h, has256) if compressed else bytearray(v.bytes(p, w * h))
    if flipped:
        pixels = bytearray(pixels)
        for r in range(h):
            pixels[r * w:(r + 1) * w] = pixels[r * w:(r + 1) * w][::-1]
        frame.image_key = -img
    frame.w, frame.h, frame.pixels = w, h, bytes(pixels)


def _read_frame(v, pos):
    f = Frame()
    # Origin is signed: effects such as muzzle flashes anchor outside their image.
    f.ox = v.i32(pos)
    f.oy = v.i32(pos + 4)
    render_off = v.u32(pos + 12)
    point_off = v.u32(pos + 24)
    if not (-4096 <= f.ox <= 4096 and -4096 <= f.oy <= 4096):
        raise ValueError("bad origin")
    if point_off:
        p = point_off
        for _ in range(64):
            if v.u32(p) == 0xFFFFFFFF:
                break
            # id, x (24.8 fixed), y (24.8 fixed), z (unused)
            f.points.append({"id": v.i32(p), "x": v.i32(p + 4) >> 8, "y": v.i32(p + 8) >> 8})
            p += 16
        else:
            raise ValueError("unterminated point list")
    _read_render_flags(v, render_off, f)
    return f


def _read_animation(v, pos):
    a = Animation()
    a.offset = pos
    missing = _MISSING_FRAME_WORKAROUND.get(pos, 0)
    a.unk = v.u32(pos)
    pos += 4
    for _ in range(512):
        value = v.i32(pos)
        pos += 4
        if value in (0, -1):
            break
        fr = _read_frame(v, value)
        a.frames.append(fr)
        if missing > 0:
            missing -= 1
            a.frames.append(fr)
    else:
        raise ValueError("unterminated animation")
    return a


def parse(data, base):
    """Parse MOBD bytes that originally lived at absolute LVL offset `base`.
    Returns (rotational_animations, simple_animations)."""
    v = _View(data, base)
    file_start = base
    first_frame = v.end
    anim_offsets = []
    pos = base
    while pos < first_frame:
        value = v.i32(pos)
        pos += 4
        if value == 0 or (file_start <= value < pos):
            pos -= 4
            break
        anim_offsets.append(pos - 4)
        while True:
            value = v.i32(pos)
            pos += 4
            if value in (-1, 0):
                break
            if not v.ok(value, 28):
                raise ValueError("frame pointer outside file")
            first_frame = min(first_frame, value)

    rotational = []
    while pos < first_frame:
        value = v.u32(pos)
        pos += 4
        if value == 0:
            continue
        if value in anim_offsets:
            anim_offsets.remove(value)
        rotational.append(_read_animation(v, value))

    simple = [_read_animation(v, off) for off in anim_offsets]
    return rotational, simple
