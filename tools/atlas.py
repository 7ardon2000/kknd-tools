"""Pack indexed KKnD frames into an RGBA texture atlas with a Phaser-compatible JSON."""

import hashlib
import math
from collections import deque

from PIL import Image

SHADOW_INDEX = 177  # near-black palette entry used for drop shadows
SHADOW_ALPHA = 110
TEAM_REMAP = {8: 24, 9: 25, 10: 26, 11: 27, 12: 28, 13: 29}  # blue ramp -> red ramp


def _outer_shadow_mask(w, h, px):
    """Shadow pixels connected to the transparent background (interior dark details stay opaque)."""
    mask = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            q.append(y * w + x)
    for y in range(h):
        for x in (0, w - 1):
            q.append(y * w + x)
    seen = bytearray(w * h)
    while q:
        i = q.popleft()
        if seen[i]:
            continue
        seen[i] = 1
        v = px[i]
        if v not in (0, SHADOW_INDEX):
            continue
        if v == SHADOW_INDEX:
            mask[i] = 1
        x, y = i % w, i // w
        if x > 0:
            q.append(i - 1)
        if x < w - 1:
            q.append(i + 1)
        if y > 0:
            q.append(i - w)
        if y < h - 1:
            q.append(i + w)
    return mask


def to_rgba(w, h, pixels, palette, remap=None, shadows=True, shadow_alpha=None):
    """shadow_alpha: optional {palette index: alpha} drawn as translucent black (decor sheets)."""
    mask = _outer_shadow_mask(w, h, pixels) if shadows else None
    out = bytearray(w * h * 4)
    for i, v in enumerate(pixels):
        if v == 0:
            continue
        o = i * 4
        if shadow_alpha and v in shadow_alpha:
            out[o:o + 4] = bytes((0, 0, 0, shadow_alpha[v]))
            continue
        if mask is not None and mask[i]:
            out[o:o + 4] = bytes((0, 0, 0, SHADOW_ALPHA))
            continue
        if remap:
            v = remap.get(v, v)
        r, g, b = palette[v]
        out[o:o + 4] = bytes((r, g, b, 255))
    return Image.frombytes("RGBA", (w, h), bytes(out))


def _trim(img):
    bbox = img.getbbox()
    if bbox is None:
        return img.crop((0, 0, 1, 1)), 0, 0
    return img.crop(bbox), bbox[0], bbox[1]


def pack(images, max_width=2048, pad=4):
    """images: list of (name, PIL.Image RGBA, ox, oy) where (ox, oy) is the pivot inside the image.

    Phaser places a trimmed frame inside its sourceSize; we make every frame's sourceSize a square
    of side 2*R centred on the pivot so `setOrigin(0.5)` puts the pivot exactly at the sprite position.
    Returns (atlas_image, phaser_json).
    """
    entries = []
    uniq = {}
    for name, img, ox, oy in images:
        # whole-pixel pivots: a half-pixel pivot puts the sprite's corners exactly between screen
        # pixels, and the GPU then rounds them differently from frame to frame (sprites jiggle)
        ox = int(math.floor(ox))
        oy = int(math.floor(oy))
        timg, tx, ty = _trim(img)
        key = hashlib.md5(timg.tobytes() + bytes(str(timg.size), "ascii")).hexdigest()
        if key not in uniq:
            uniq[key] = timg
        # pivot relative to the trimmed image's top-left
        entries.append((name, key, timg.size, ox - tx, oy - ty))

    # radius: largest pivot-to-edge distance over all frames, so every frame shares one sourceSize
    R = 1
    for _, _, (w, h), px, py in entries:
        R = max(R, abs(px), abs(py), abs(w - px), abs(h - py))
    R = int(math.ceil(R))  # sourceSize 2R is even, so origin 0.5 is a whole pixel

    def pow2(n):
        p = 1
        while p < n:
            p *= 2
        return p

    def shelf(max_w):
        """Shelf packing (tallest first) into max_w; returns (positions, used_w, used_h)."""
        order = sorted(uniq.items(), key=lambda kv: (-kv[1].size[1], -kv[1].size[0]))
        pos = {}
        x = y = pad  # keep a margin at the atlas border too (mipmaps + repeat wrapping)
        shelf_h = 0
        width = 0
        for key, img in order:
            w, h = img.size
            if x + w + pad > max_w and x > pad:
                x = pad
                y += shelf_h + pad
                shelf_h = 0
            pos[key] = (x, y)
            x += w + pad
            shelf_h = max(shelf_h, h)
            width = max(width, x)
        return pos, width, y + shelf_h + pad

    # try several widths and keep the smallest power-of-two texture (less GPU memory)
    best = None
    for max_w in (128, 256, 512, 1024, 2048):
        if any(img.size[0] + 2 * pad > max_w for img in uniq.values()):
            continue
        pos, width, height = shelf(max_w)
        area = pow2(max(width, 1)) * pow2(max(height, 1))
        if pow2(height) > 4096:
            continue
        if best is None or area < best[0]:
            best = (area, pos, width, height)
    if best is None:
        _, pos, width, height = (0, *shelf(max_width))
    else:
        _, pos, width, height = best

    atlas = Image.new("RGBA", (pow2(max(width, 1)), pow2(max(height, 1))), (0, 0, 0, 0))
    for key, img in uniq.items():
        atlas.paste(img, pos[key])

    frames = {}
    for name, key, (w, h), px, py in entries:
        ax, ay = pos[key]
        frames[name] = {
            "frame": {"x": ax, "y": ay, "w": w, "h": h},
            "rotated": False,
            "trimmed": True,
            "spriteSourceSize": {"x": R - px, "y": R - py, "w": w, "h": h},
            "sourceSize": {"w": 2 * R, "h": 2 * R},
        }
    meta = {"image": "", "size": {"w": atlas.width, "h": atlas.height}, "scale": "1"}
    return atlas, {"frames": frames, "meta": meta}
