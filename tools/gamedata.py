"""
Find KKnD's SPRITES.LVL on this computer. No game files are kept in this repository.

Sources, in order (the same ones OpenKrush's installer looks at):
  1. content/sprites.lvl, or the folder in the KKND_XTREME environment variable
  2. an installed KKnD Xtreme: Steam (app 1292170), GOG (game 1207659107), common folders
  3. a KKnD or KKnD Xtreme CD in any drive
  4. the official free KKnD Xtreme demo, downloaded once from archive.org into .cache/ (SHA-1 checked)

The demo installer is a self-extracting archive holding a ZIP with an InstallShield v5 cabinet
(data1.cab). `InstallShieldCab` is a port of OpenRA's InstallShieldCABCompression (GPL-3.0),
limited to the single-volume case the demo needs.
"""

import hashlib
import io
import os
import re
import struct
import urllib.request
import zipfile
import zlib
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

DEMO_URL = "https://archive.org/download/KKNDXT/KKND_XT.EXE"
DEMO_SHA1 = "90222373c1ff06a02509f0d811385c0571e398df"
DEMO_ZIP_OFFSET = 0x000B7B95  # where the embedded ZIP starts (from OpenKrush's DemoLoader)
DEMO_ZIP_SIZE = 6984869
DEMO_SPRITES = "Multiplayer Levels\\LEVELS\\640\\SPRITES.LVL"

STEAM_APP_ID = "1292170"
GOG_GAME_ID = "1207659107"
COMMON_DIRS = [
    "C:/Games/KKND Xtreme",
    "C:/GOG Games/KKnD Xtreme",
    "C:/Program Files (x86)/GOG Galaxy/Games/KKnD Xtreme",
    "C:/Program Files/GOG Galaxy/Games/KKnD Xtreme",
]
# KKnD Xtreme (install or CD) and the original KKnD CD
LVL_PATHS = ["LEVELS/640/SPRITES.LVL", "KKND/LEVELS/640/SPRITES.LVL"]


def _registry(root, key, value):
    try:
        import winreg
        with winreg.OpenKey(getattr(winreg, root), key) as k:
            return winreg.QueryValueEx(k, value)[0]
    except (ImportError, OSError):
        return None


def _steam_dirs():
    """KKnD Xtreme folders in every Steam library (libraryfolders.vdf + appmanifest)."""
    steam = (_registry("HKEY_CURRENT_USER", "Software\\Valve\\Steam", "SteamPath")
             or _registry("HKEY_LOCAL_MACHINE", "SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"))
    if not steam:
        return []
    libs = [Path(steam)]
    vdf = Path(steam) / "steamapps" / "libraryfolders.vdf"
    if vdf.exists():
        libs += [Path(p.replace("\\\\", "\\")) for p in re.findall(r'"path"\s+"([^"]+)"', vdf.read_text(errors="replace"))]
    found = []
    for lib in libs:
        acf = lib / "steamapps" / f"appmanifest_{STEAM_APP_ID}.acf"
        if acf.exists():
            m = re.search(r'"installdir"\s+"([^"]+)"', acf.read_text(errors="replace"))
            if m:
                found.append(lib / "steamapps" / "common" / m.group(1))
    return found


def _gog_dirs():
    for key in (f"SOFTWARE\\WOW6432Node\\GOG.com\\Games\\{GOG_GAME_ID}", f"SOFTWARE\\GOG.com\\Games\\{GOG_GAME_ID}"):
        path = _registry("HKEY_LOCAL_MACHINE", key, "path")
        if path:
            return [Path(path)]
    return []


def _disc_dirs():
    if os.name != "nt":
        return []
    return [Path(f"{c}:/") for c in "DEFGHIJKLMNOPQRSTUVWXYZ" if os.path.exists(f"{c}:/")]


def find_sprites_lvl():
    """Path of SPRITES.LVL from the user's own KKnD copy, or None."""
    local = REPO / "content" / "sprites.lvl"
    if local.exists():
        return local
    dirs = [Path(os.environ["KKND_XTREME"])] if os.environ.get("KKND_XTREME") else []
    dirs += _steam_dirs() + _gog_dirs() + [Path(d) for d in COMMON_DIRS] + _disc_dirs()
    for d in dirs:
        for rel in LVL_PATHS:
            try:
                if (d / rel).exists():
                    return d / rel
            except OSError:  # e.g. an empty optical drive
                continue
    return None


class InstallShieldCab:
    """Minimal InstallShield v5/6 cabinet reader (single volume, no obfuscation)."""

    MAX_FILE_GROUPS = 71

    def __init__(self, data):
        self.d = data
        if self.u32(0) != 0x28635349:
            raise ValueError("not an InstallShield cabinet")
        v = self.u32(4)
        if v >> 24 == 1:
            self.version = (v >> 12) & 0xF
        elif v >> 24 in (2, 4):
            self.version = (v & 0xFFFF) // 100 if v & 0xFFFF else 0
        else:
            self.version = 0
        cab = self.u32(12)  # cab descriptor offset
        p = cab + 12
        file_table = self.u32(p)
        dir_count = self.u32(p + 16)
        file_table2 = self.u32(p + 32)
        p += 36 + 14
        group_offsets = [self.u32(p + 4 * i) for i in range(self.MAX_FILE_GROUPS)]
        table = cab + file_table
        dirs = [self.asciiz(table + self.u32(table + 4 * i)) for i in range(dir_count)]

        groups = []
        for off in group_offsets:
            nxt = off
            while nxt:
                desc = self.u32(cab + nxt + 4)
                nxt = self.u32(cab + nxt + 8)
                q = cab + desc
                name = self.asciiz(cab + self.u32(q))
                q += 4 + 18 + (54 if self.version <= 5 else 0)
                groups.append((name, self.u32(q), self.u32(q + 4)))

        self.index = {}
        for gname, first, last in groups:
            for i in range(first, last + 1):
                if self.version <= 5:
                    q = table + self.u32(table + file_table2 + i * 4)
                    name_off, dir_idx = self.u32(q), self.u32(q + 4)
                    flags = self.u16(q + 8)
                    expanded, compressed = self.u32(q + 10), self.u32(q + 14)
                    data_off = self.u32(q + 38)
                else:
                    q = table + file_table2 + i * 0x57
                    flags = self.u16(q)
                    expanded, compressed = self.u32(q + 2), self.u32(q + 10)
                    data_off = self.u32(q + 18)
                    name_off, dir_idx = self.u32(q + 58), self.u16(q + 62)
                if flags & 0x8:  # invalid
                    continue
                fname = self.asciiz(table + name_off)
                self.index[f"{gname}\\{dirs[dir_idx]}\\{fname}"] = (flags, expanded, compressed, data_off)

    def u16(self, p):
        return struct.unpack_from("<H", self.d, p)[0]

    def u32(self, p):
        return struct.unpack_from("<I", self.d, p)[0]

    def asciiz(self, p):
        return self.d[p:self.d.index(b"\0", p)].decode("latin1")

    def read(self, name):
        flags, expanded, compressed, off = self.index[name]
        if flags & 0x2:
            raise NotImplementedError("obfuscated files are not supported")
        if not flags & 0x4:
            return self.d[off:off + expanded]
        # compressed: a series of [uint16 size][raw deflate block], each inflated on its own
        out = bytearray()
        p, end = off, off + compressed
        while p < end:
            n = self.u16(p)
            p += 2
            out += zlib.decompressobj(-15).decompress(self.d[p:p + n])
            p += n
        if len(out) != expanded:
            raise ValueError(f"{name}: expanded to {len(out)} bytes, expected {expanded}")
        return bytes(out)


def _download_demo():
    cache = REPO / ".cache" / "kknd-demo" / "KKND_XT.EXE"
    if cache.exists() and hashlib.sha1(cache.read_bytes()).hexdigest() == DEMO_SHA1:
        return cache.read_bytes()
    cache.parent.mkdir(parents=True, exist_ok=True)
    print(f"No KKnD install found; downloading the free official KKnD Xtreme demo ({DEMO_URL}) ...")
    with urllib.request.urlopen(DEMO_URL) as r:
        data = r.read()
    if hashlib.sha1(data).hexdigest() != DEMO_SHA1:
        raise RuntimeError("KKnD Xtreme demo download failed its checksum")
    cache.write_bytes(data)
    return data


def sprites_lvl_from_demo():
    exe = _download_demo()
    z = zipfile.ZipFile(io.BytesIO(exe[DEMO_ZIP_OFFSET:DEMO_ZIP_OFFSET + DEMO_ZIP_SIZE]))
    return InstallShieldCab(z.read("data1.cab")).read(DEMO_SPRITES)


def sprites_lvl():
    """Return (bytes, source description) of SPRITES.LVL."""
    p = find_sprites_lvl()
    if p is not None:
        return p.read_bytes(), str(p)
    return sprites_lvl_from_demo(), "KKnD Xtreme demo (archive.org)"


def lvl_names(lookup_yaml_path):
    """OpenKrush's archives/sprites.lvl.yaml: {'0.mobd': 'AlchemyHall.mobd', ...}."""
    names = {}
    if lookup_yaml_path and Path(lookup_yaml_path).exists():
        for line in Path(lookup_yaml_path).read_text().splitlines():
            if ":" in line and not line.strip().startswith("#"):
                k, v = line.strip().split(":", 1)
                names[k.strip()] = v.strip()
    return names


def lvl_index(raw, lookup_yaml_path=None):
    """Index a KKnD .LVL archive (bytes). Returns ({filename: (offset, size)}, data); offsets point
    into `data` (the contents after the 8-byte DATA header). This is also where MOBD pointers point."""
    if raw[:4] == b"DATA":
        size = struct.unpack_from(">I", raw, 4)[0]
        data = raw[8:8 + size]
    else:
        data = raw
    lookup = lvl_names(lookup_yaml_path)

    type_list, = struct.unpack_from("<i", data, 0)
    index = {}
    pos = type_list
    first_list = 0
    for _ in range(1000):
        if pos + 8 > len(data):
            break
        file_type = data[pos:pos + 4].decode("ascii", errors="replace")
        list_off, = struct.unpack_from("<i", data, pos + 4)
        pos += 8
        if list_off == 0:
            break
        if first_list == 0:
            first_list = list_off
        list_end = struct.unpack_from("<i", data, pos)[0] if pos + 4 <= len(data) else type_list
        if list_end == 0:
            list_end = type_list
        lp = list_off
        prev_off = prev_name = None
        j = 0
        while lp + 4 <= list_end and lp < len(data):
            off, = struct.unpack_from("<i", data, lp)
            lp += 4
            if off == 0:
                j += 1
                continue
            if prev_off is not None:
                index[prev_name] = (prev_off, off - prev_off)
            name = f"{j}.{file_type.lower()}"
            prev_off, prev_name = off, lookup.get(name, name)
            j += 1
        if prev_off is not None:
            index[prev_name] = (prev_off, first_list - prev_off)
    return index, data
