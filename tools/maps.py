"""Render OpenKrush gen1 maps (OpenRA map.bin + tileset PNGs) into battle-ready assets."""

import glob
import json
import struct
from pathlib import Path

from PIL import Image

import atlas
import miniyaml as my

TILE = 32
BLOCKING_TERRAIN = {"Water", "Cliff"}
GROUND_TERRAIN = {"Clear", "Sand", "Dirt", "Grass"}


def png_frames(path):
    """Read OpenRA PngSheet `Frame[i]` metadata: {i: (x, y, w, h, offx, offy)}."""
    data = Path(path).read_bytes()
    pos = 8
    frames = {}
    while pos < len(data):
        ln, = struct.unpack(">I", data[pos:pos + 4])
        kind = data[pos + 4:pos + 8]
        if kind == b"tEXt":
            body = data[pos + 8:pos + 8 + ln]
            k, _, v = body.partition(b"\0")
            k = k.decode("latin1")
            if k.startswith("Frame["):
                i = int(k[6:-1])
                rect, _, off = v.decode("latin1").partition(";")
                x, y, w, h = (int(n) for n in rect.split(","))
                ox, oy = (int(float(n)) for n in (off or "0,0").split(","))
                frames[i] = (x, y, w, h, ox, oy)
        pos += 12 + ln
    return frames


class Tileset:
    def __init__(self, gen1, name):
        self.gen1 = gen1
        tree = my.parse_text((gen1 / "tilesets" / name / "tileset.yaml").read_text(encoding="utf-8"))
        templates = next(n for n in tree if n.key == "Templates")
        self.templates = {}
        self.pick_any = set()  # plain-ground templates whose variants are interchangeable
        self.groups_used = set()
        for t in templates.children:
            tid = int(t.val("Id"))
            images = [s.strip() for s in t.val("Images").split(",")]
            tiles = t.get("Tiles")
            types = {int(c.key): c.value for c in tiles.children} if tiles else {}
            self.templates[tid] = (images[0], types)
            if t.val("PickAny") == "true" and types and all(v in GROUND_TERRAIN for v in types.values()):
                self.pick_any.add(tid)
        self._img = {}
        self.name = name
        self.atlas_tiles = []  # unique 32x32 tiles used by any map, in atlas order
        self._atlas_index = {}
        self.ground_usage = {}  # template id -> count of plain-ground cells, to pick the filler terrain

    def atlas_index(self, tid, index):
        """Index of this template tile in the shared tileset atlas (added on first use)."""
        key = (tid, index)
        if key not in self._atlas_index:
            tile, ttype = self.tile(tid, index)
            if tile is None:
                tile = Image.new("RGBA", (TILE, TILE), (0, 0, 0, 255))
            self._atlas_index[key] = (len(self.atlas_tiles), ttype)
            self.atlas_tiles.append(tile)
        return self._atlas_index[key]

    def filler_tiles(self):
        """Atlas indices of every variant of the most used plain-ground template.
        The battle uses them to fill the gaps when it stitches several maps into one world."""
        if not self.ground_usage:
            return [0]
        tid = max(self.ground_usage, key=self.ground_usage.get)
        img_path, _ = self.templates[tid]
        img = Image.open(self.gen1 / img_path)
        count = max(1, (img.width // TILE) * (img.height // TILE))
        return [self.atlas_index(tid, i)[0] for i in range(count)]

    def variants(self, tid):
        img_path, _ = self.templates[tid]
        img = Image.open(self.gen1 / img_path)
        count = max(1, (img.width // TILE) * (img.height // TILE))
        return [self.atlas_index(tid, i)[0] for i in range(count)]

    def ground_groups(self):
        """Variant lists of the plain-ground templates the maps use (to extend map edges into the gaps)."""
        return [self.variants(tid) for tid in sorted(self.groups_used)]

    def save_atlas(self, out_dir, cols=64):
        rows = (len(self.atlas_tiles) + cols - 1) // cols
        img = Image.new("RGB", (cols * TILE, max(1, rows) * TILE))
        for i, t in enumerate(self.atlas_tiles):
            img.paste(t.convert("RGB"), ((i % cols) * TILE, (i // cols) * TILE))
        img.save(out_dir / f"tiles_{self.name}.png", optimize=True)

    def tile(self, tid, index):
        if tid not in self.templates:
            return None, "Clear"
        img_path, types = self.templates[tid]
        if img_path not in self._img:
            self._img[img_path] = Image.open(self.gen1 / img_path).convert("RGBA")
        img = self._img[img_path]
        cols = max(1, img.width // TILE)
        rows = max(1, img.height // TILE)
        index %= cols * rows
        x, y = (index % cols) * TILE, (index // cols) * TILE
        return img.crop((x, y, x + TILE, y + TILE)), types.get(index, "Clear")


def read_map_bin(path):
    d = Path(path).read_bytes()
    fmt = d[0]
    w, h = struct.unpack_from("<HH", d, 1)
    if fmt != 2:
        raise ValueError(f"unsupported map.bin format {fmt}")
    tiles_off, = struct.unpack_from("<I", d, 5)
    tiles = {}
    pos = tiles_off
    for i in range(w):
        for j in range(h):
            tid, idx = struct.unpack_from("<HB", d, pos)
            pos += 3
            if idx == 255:
                idx = i % 4 + (j % 4) * 4
            tiles[(i, j)] = (tid, idx)
    return w, h, tiles


def parse_footprint(fp, dims):
    rows = fp.split() if fp else ["x" * dims[0]] * dims[1]
    return [(x, y, c) for y, row in enumerate(rows) for x, c in enumerate(row)]


def build_all(ok, out_dir, palette, only_ids=None):
    gen1 = Path(ok) / "mods" / "openkrush_gen1"
    out_dir.mkdir(parents=True, exist_ok=True)
    rules = my.load_tree(glob.glob(str(gen1 / "**" / "rules.yaml"), recursive=True))
    seqs = my.load_tree(glob.glob(str(gen1 / "**" / "sequences.yaml"), recursive=True))
    tilesets = {}
    index = []
    extra_stems = set()

    for map_dir in sorted(glob.glob(str(gen1 / "maps" / "*" / "*"))):
        map_dir = Path(map_dir)
        map_id = map_dir.name.lower()
        if only_ids and map_id not in only_ids:
            continue
        nodes = {n.key: n for n in my.parse_text((map_dir / "map.yaml").read_text(encoding="utf-8"))}
        ts_name = nodes["Tileset"].value
        if ts_name not in tilesets:
            tilesets[ts_name] = Tileset(gen1, ts_name)
        ts = tilesets[ts_name]
        bx, by, bw, bh = (int(v) for v in nodes["Bounds"].value.split(","))
        mw, mh, tiles = read_map_bin(map_dir / "map.bin")

        grid = [[0] * bw for _ in range(bh)]
        tile_ids = []
        for cy in range(bh):
            for cx in range(bw):
                tid, idx = tiles[(cx + bx, cy + by)]
                ai, ttype = ts.atlas_index(tid, idx)
                tile_ids.append(ai)
                if ttype in GROUND_TERRAIN:
                    ts.ground_usage[tid] = ts.ground_usage.get(tid, 0) + 1
                if tid in ts.pick_any:
                    ts.groups_used.add(tid)
                if ttype in BLOCKING_TERRAIN:
                    grid[cy][cx] = 1

        decor_imgs = {}
        decor = []
        spawns = []
        for a in (nodes.get("Actors").children if nodes.get("Actors") else []):
            atype = a.value
            loc = a.val("Location")
            if not loc:
                continue
            lx, ly = (int(v) for v in loc.split(","))
            lx -= bx
            ly -= by
            if atype == "mpspawn":
                spawns.append([lx * TILE + TILE // 2, ly * TILE + TILE // 2])
                continue
            r = my.resolve(rules, atype)
            s = my.resolve(seqs, atype)
            idle = s.get("idle") or s.get("idle-open") or (s.children[0] if s.children else None)
            if idle is None:
                continue
            b = r.get("Building")
            dims = (1, 1)
            fp = None
            lco = (0, 0)
            if b is not None:
                if b.val("Dimensions"):
                    dims = tuple(int(v) for v in b.val("Dimensions").split(","))
                fp = b.val("Footprint")
                if b.val("LocalCenterOffset"):
                    v = [int(n) for n in b.val("LocalCenterOffset").split(",")]
                    lco = (v[0] * TILE / 1024, v[1] * TILE / 1024)
            cx = lx * TILE + dims[0] * TILE / 2 + lco[0]
            cy = ly * TILE + dims[1] * TILE / 2 + lco[1]
            if b is not None:
                for fx, fy, c in parse_footprint(fp, dims):
                    gx, gy = lx + fx, ly + fy
                    if c == "x" and 0 <= gx < bw and 0 <= gy < bh:
                        grid[gy][gx] = 1
            off = idle.val("Offset")
            if off:
                ox, oy = (int(v) for v in off.split(",")[:2])
                cx += ox
                cy += oy
            start = int(idle.val("Start", "0"))
            entry = {"x": round(cx, 1), "y": round(cy, 1), "z": round(cy + dims[1] * TILE / 2 - TILE / 2, 1)}
            if ".mobd" in idle.value:
                stem = idle.value.split("|")[-1].replace(".mobd", "")
                extra_stems.add(stem)
                length = idle.val("Length", "1")
                entry["seq"] = {"sprite": stem, "start": start,
                                "length": 1 if length == "*" else int(length), "tick": int(idle.val("Tick", "120"))}
                entry["z"] = -1 if idle.val("ZOffset", "0").startswith("-") else entry["z"]
            elif idle.value.endswith(".png"):
                png = gen1 / idle.value
                key = f"{idle.value}#{start}"
                if key not in decor_imgs:
                    frames = png_frames(png)
                    sheet = Image.open(png)
                    if start in frames:
                        x, y, w, h, fox, foy = frames[start]
                    else:
                        x, y, w, h, fox, foy = 0, 0, sheet.width, sheet.height, 0, 0
                    crop = sheet.crop((x, y, x + w, y + h))
                    if crop.mode == "P":
                        # OpenRA convention: palette index 0 is transparent
                        sp = crop.getpalette()
                        spal = [tuple(sp[i * 3:i * 3 + 3]) for i in range(len(sp) // 3)]
                        spal += [(0, 0, 0)] * (256 - len(spal))
                        # decor sheets encode shadows as darker shades of the purple index-0 colour
                        base = spal[0][0] or 1
                        shadow = {i: min(200, int((base - r) / base * 330)) for i, (r, g, b) in enumerate(spal)
                                  if i and g == 0 and r > 20 and b > 20 and r < base}
                        crop = atlas.to_rgba(w, h, crop.tobytes(), spal, shadows=False, shadow_alpha=shadow)
                    else:
                        crop = crop.convert("RGBA")
                    # OpenRA draws frames centred on the actor plus the frame offset
                    decor_imgs[key] = (str(len(decor_imgs)), crop, w / 2 - fox, h / 2 - foy)
                entry["f"] = decor_imgs[key][0]
            else:
                continue
            decor.append(entry)

        decor_name = None
        if decor_imgs:
            dimg, djs = atlas.pack(list(decor_imgs.values()))
            decor_name = f"{map_id}_decor"
            djs["meta"]["image"] = decor_name + ".png"
            dimg.save(out_dir / f"{decor_name}.png", optimize=True)
            (out_dir / f"{decor_name}.json").write_text(json.dumps(djs, separators=(",", ":")))

        title = nodes["Title"].value if "Title" in nodes else map_dir.name
        meta = {
            "id": map_id, "title": title, "tileset": ts_name, "tile": TILE,
            "width": bw, "height": bh,
            "tiles": tile_ids,
            "grid": ["".join(str(v) for v in row) for row in grid],
            "spawns": spawns, "decor": decor, "decorAtlas": decor_name,
        }
        (out_dir / f"{map_id}.json").write_text(json.dumps(meta, separators=(",", ":")))
        index.append({"id": map_id, "title": title, "tileset": ts_name, "width": bw, "height": bh,
                      "category": map_dir.parent.name})
        print(f"  map {map_id}: {bw}x{bh} {ts_name}, {len(decor)} decor, {len(spawns)} spawns")
    fills = {}
    for ts in tilesets.values():
        fills[ts.name] = {"fill": ts.filler_tiles(), "groups": ts.ground_groups()}
        ts.save_atlas(out_dir)
        print(f"  tileset {ts.name}: {len(ts.atlas_tiles)} tiles, {len(fills[ts.name]['groups'])} ground groups")
    return {"list": index, "extraSprites": sorted(extra_stems), "tilesets": fills}
