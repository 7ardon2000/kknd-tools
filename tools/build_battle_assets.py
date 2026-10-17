#!/usr/bin/env python3
"""
Build everything the KKnD battle wallpaper (battle/) needs:

  battle/public/assets/sprites/<Stem>[_red].png/.json   Phaser atlases (pivot-correct, with MOBD points)
  battle/public/assets/units.json                         unit / weapon / effect database
  battle/public/assets/maps/<id>.png/.json                rendered maps + passability + decor

Sources:
  * the raw .mobd files committed in this repo (units/, effects/)
  * OpenKrush (https://github.com/IceReaper/OpenKrush, GPL-3.0) for the palette, unit sequence
    layouts, weapon stats, tilesets and maps. Cloned to .cache/openkrush if --openkrush is not given.

Usage: python tools/build_battle_assets.py [--openkrush PATH] [--maps all|id1,id2]
"""

import argparse
import glob
import json
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import atlas  # noqa: E402
import miniyaml as my  # noqa: E402
import mobd  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "battle" / "public" / "assets"

# OpenRA units: 1 cell = 1024 WDist = 32 px; 1 game tick = 40 ms.
PX_PER_WDIST = 32 / 1024
TICK_MS = 40


def wdist(s):
    """Parse an OpenRA distance ('4c512', '1500', '2c0') into pixels."""
    s = str(s).strip()
    if "c" in s:
        c, r = s.split("c", 1)
        v = int(c) * 1024 + (int(r) if r else 0)
    else:
        v = int(s)
    return v * PX_PER_WDIST


def ensure_openkrush(path):
    if path:
        return Path(path)
    cache = REPO / ".cache" / "openkrush"
    if not (cache / "mods").exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        print("Cloning OpenKrush into", cache)
        subprocess.check_call(["git", "clone", "--depth", "1", "https://github.com/IceReaper/OpenKrush", str(cache)])
    return cache


# --------------------------------------------------------------------------------------------
# MOBD loading


def find_mobd_files():
    files = {}
    for p in glob.glob(str(REPO / "units" / "*" / "*.mobd")) + glob.glob(str(REPO / "effects" / "*" / "*.mobd")):
        files[Path(p).stem.lower()] = Path(p)
    return files


_mobd_cache = {}


def load_frames(path):
    """Return the flattened frame list (rotational then simple), as OpenKrush indexes it."""
    if path in _mobd_cache:
        return _mobd_cache[path]
    data = path.read_bytes()
    meta = path.with_name(path.stem + "_frames.json")
    expected = json.loads(meta.read_text())["total_frames"] if meta.exists() else None
    _, rot, simple = mobd.find_base(data, expected)
    frames = [f for a in rot + simple for f in a.frames]
    _mobd_cache[path] = frames
    return frames


def export_sprite(stem, path, palette, out_dir, team_variants):
    frames = load_frames(path)
    variants = [("", None)] + ([("_red", atlas.TEAM_REMAP)] if team_variants else [])
    for suffix, remap in variants:
        imgs = []
        cache = {}
        for i, f in enumerate(frames):
            key = (f.image_key, remap is not None)
            if key not in cache:
                cache[key] = atlas.to_rgba(f.w, f.h, f.pixels, palette, remap)
            imgs.append((str(i), cache[key], f.ox, f.oy))
        img, js = atlas.pack(imgs)
        js["meta"]["image"] = f"{stem}{suffix}.png"
        img.save(out_dir / f"{stem}{suffix}.png", optimize=True)
        (out_dir / f"{stem}{suffix}.json").write_text(json.dumps(js, separators=(",", ":")))
    points = {str(i): [[p["id"], p["x"], p["y"]] for p in f.points] for i, f in enumerate(frames) if f.points}
    (out_dir / f"{stem}.points.json").write_text(json.dumps(points, separators=(",", ":")))
    return len(frames)


def png_sheet_meta(path):
    """OpenRA PngSheet text chunks (FrameSize, Offset, FrameAmount)."""
    import struct as _s
    d = Path(path).read_bytes()
    pos, meta = 8, {}
    while pos < len(d):
        ln, = _s.unpack(">I", d[pos:pos + 4])
        if d[pos + 4:pos + 8] == b"tEXt":
            k, _, v = d[pos + 8:pos + 8 + ln].partition(b"\0")
            meta[k.decode("latin1")] = v.decode("latin1")
        pos += 12 + ln
    return meta


# Fan-made infantry death animations from OpenKrush (by Dzierzan, GPL-3.0): fire and explosion kills.
DEATH_SHEETS = [("burn", 70), ("explode", 60)]


def export_death_sheets(ok, palette, out_dir, effects):
    sprites = {}
    for faction in ("survivors", "evolved"):
        stem = f"InfDeath{faction.capitalize()}"
        imgs = []
        for name, tick in DEATH_SHEETS:
            path = ok / "mods" / "openkrush_gen1" / "actors" / faction / "infantry" / f"{name}.png"
            if not path.exists():
                continue
            meta = png_sheet_meta(path)
            fw, fh = (int(v) for v in meta["FrameSize"].split(","))
            offx, offy = (int(float(v)) for v in meta.get("Offset", "0,0").split(",")[:2])
            sheet = Image.open(path)
            cols, rows = sheet.width // fw, sheet.height // fh
            count = int(meta.get("FrameAmount", cols * rows))
            sp = sheet.getpalette()
            spal = [tuple(sp[i * 3:i * 3 + 3]) for i in range(len(sp) // 3)] + [(0, 0, 0)] * 256
            # these sheets mark shadows with darker shades of the purple index-0 colour
            base = spal[0][0] or 1
            shadow = {i: min(200, int((base - r) / base * 330)) for i, (r, g, b) in enumerate(spal[:256])
                      if i and g == 0 and r > 20 and b > 20 and r < base}
            start = len(imgs)
            for i in range(count):
                x, y = (i % cols) * fw, (i // cols) * fh
                crop = sheet.crop((x, y, x + fw, y + fh))
                rgba = atlas.to_rgba(fw, fh, crop.tobytes(), spal, shadows=False, shadow_alpha=shadow)
                imgs.append((str(len(imgs)), rgba, fw / 2 - offx, fh / 2 - offy))
            effects[f"{name}_{faction}"] = {"sprite": stem, "start": start, "length": count, "tick": tick}
        if not imgs:
            continue
        img, js = atlas.pack(imgs)
        js["meta"]["image"] = f"{stem}.png"
        img.save(out_dir / f"{stem}.png", optimize=True)
        (out_dir / f"{stem}.json").write_text(json.dumps(js, separators=(",", ":")))
        (out_dir / f"{stem}.points.json").write_text("{}")
        sprites[stem] = {"frames": len(imgs), "team": False}
    return sprites


def death_type(weapon):
    """Which infantry death a weapon causes (matches OpenKrush DeathTypes)."""
    p = weapon["projectile"]
    if p["type"] == "bullet" and (p.get("seq") or {}).get("start") == 292 and p["seq"]["sprite"] == "Extras":
        return "burn"
    if any(i.startswith("explosion") for i in weapon["impacts"]):
        return "explode"
    return None


# --------------------------------------------------------------------------------------------
# Unit database from OpenKrush yaml


def seq_info(node):
    """Sequence node -> dict, or None if it isn't sourced from a .mobd."""
    if node is None or ".mobd" not in node.value:
        return None
    stem = node.value.split("|")[-1].replace(".mobd", "")
    length = node.val("Length", "1")
    length = 1 if length == "*" else int(length)
    facings = abs(int(node.val("Facings", "1")))
    return {
        "sprite": stem,
        "start": int(node.val("Start", "0")),
        "length": length,
        "stride": int(node.val("Stride", str(length))),
        "facings": facings,
        "tick": int(node.val("Tick", "40")),
    }


EFFECT_NAMES = {
    # name: (sprite, start, length, tick)
    "hit_a": ("Extras", 261, 6, 120),
    "hit_b": ("Extras", 267, 4, 120),
    "hit_c": ("Extras", 271, 4, 120),
    "smoke": ("Extras", 275, 6, 120),
    "flamethrower": ("Extras", 292, 16, 50),
    "splat": ("Extras", 338, 6, 60),
    "laser": ("Extras", 371, 5, 60),
    "explosion_xs": ("Extras", 237, 12, 60),
    "explosion_s": ("Extras", 249, 12, 60),
    "explosion_m": ("Extras", 224, 13, 120),
    "explosion_l": ("Extras", 208, 16, 100),
    "explosion_xl": ("Extras", 192, 16, 120),
    "die_survivors": ("Extras", 308, 15, 120),
    "die_evolved": ("Extras", 323, 15, 120),
    "debris1": ("Shrapnels", 0, 8, 120),
    "debris2": ("Shrapnels", 8, 8, 120),
    "debris3": ("Shrapnels", 16, 8, 120),
    "debris4": ("Shrapnels", 24, 41, 120),
    "debris5": ("Shrapnels", 65, 37, 120),
    "debris6": ("Shrapnels", 102, 41, 120),
    "spark1": ("Shrapnels", 143, 8, 120),
    "spark2": ("Shrapnels", 151, 8, 120),
    "spark3": ("Shrapnels", 159, 2, 120),
    "blood1": ("Shrapnels", 164, 1, 120),
    "blood2": ("Shrapnels", 165, 1, 120),
    "blood3": ("Shrapnels", 166, 1, 120),
    "blood4": ("Shrapnels", 167, 3, 120),
    "blood5": ("Shrapnels", 170, 3, 120),
    "oil": ("Oil", 0, 14, 120),
}
for i, c in enumerate("abcdefghi"):
    EFFECT_NAMES[f"crater_{c}"] = ("Extras", 362 + i, 1, 1000)

EXPLOSION_ALIAS = {"xs": "explosion_xs", "s": "explosion_s", "m": "explosion_m", "l": "explosion_l",
                   "xl": "explosion_xl", "xl_fast": "explosion_xl", "splat": "splat"}

# Units OpenKrush draws from fan-made PNGs although an original MOBD exists with the standard
# infantry layout (16 idle, 16x4 shoot, 16x6 move).
INFANTRY_LAYOUT_OVERRIDES = {
    "survivors_infantry_swat": "SWAT",
}

# Projectiles OpenKrush draws from fan-made PNGs: substitute a similar original sprite.
# Projectile behaviour corrections (OpenKrush lobs these; in KKnD they fly straight).
PROJECTILE_TWEAKS = {
    "survivors_vehicle_barragecraft": {"arc": False, "inaccuracy": 24.0},
}

PROJECTILE_OVERRIDES = {
    "evolved_infantry_rioter": {"sprite": "Sapper", "start": 0, "length": 8, "stride": 8, "facings": 16, "tick": 60},
}


def build_weapon(wdefs, seqs, weapon_name, actor_seq):
    w = my.resolve(wdefs, weapon_name)
    proj = w.get("Projectile")
    out = {
        "id": weapon_name,
        "range": wdist(w.val("Range", "4c0")),
        "reload": int(w.val("ReloadDelay", "25")) * TICK_MS,
        "burst": int(w.val("Burst", "1")),
        "burstDelay": int((w.val("BurstDelays", "0") or "0").split(",")[0]) * TICK_MS,
    }
    damage = {"infantry": 100, "vehicle": 100, "building": 100}
    spread = 1.0
    impacts = []
    smudge = False
    for c in w.children:
        if not c.key.startswith("Warhead"):
            continue
        if c.value == "SpreadDamage":
            base = int(c.val("Damage", "100"))
            spread = wdist(c.val("Spread", "32"))
            versus = c.get("Versus")
            if versus:
                for v in versus.children:
                    damage[v.key] = base * int(v.value) // 100
        elif c.value == "ShrapnelCreateEffect":
            for e in (c.val("Explosions", "") or "").split(","):
                e = e.strip()
                if e in EFFECT_NAMES:
                    impacts.append(e)
                elif e in EXPLOSION_ALIAS:
                    impacts.append(EXPLOSION_ALIAS[e])
        elif c.value == "LeaveSmudge":
            smudge = True
    out["damage"] = damage
    out["spread"] = round(spread, 1)
    out["impacts"] = sorted(set(impacts)) or (["hit_a", "hit_b", "hit_c"] if proj is None or proj.value == "InstantHit" else [])
    out["smudge"] = smudge

    if proj is None or proj.value == "InstantHit":
        out["projectile"] = {"type": "instant"}
    else:
        image = proj.val("Image", "")
        seqname = proj.val("Sequences", "projectile")
        pseq = None
        if image == "projectiles":
            name = seqname
            if name in EFFECT_NAMES:
                s, st, ln, tk = EFFECT_NAMES[name]
                pseq = {"sprite": s, "start": st, "length": ln, "stride": ln, "facings": 1, "tick": tk}
        else:
            src = my.resolve(seqs, image)
            pseq = seq_info(src.get(seqname))
        speed = proj.val("Speed", "300").split(",")[0]
        trail = None
        if proj.val("TrailImage") == "projectiles" and proj.val("TrailSequences") in EFFECT_NAMES:
            trail = proj.val("TrailSequences")
        out["projectile"] = {
            "type": "bullet",
            "seq": pseq,
            "team": proj.val("IsPlayerPalette") == "true",
            "speed": round(int(speed) * PX_PER_WDIST * 1000 / TICK_MS, 1),
            "inaccuracy": round(wdist(proj.val("Inaccuracy", "0")), 1),
            "arc": proj.val("LaunchAngle") is not None,
            "trail": trail,
        }
        if weapon_name in PROJECTILE_OVERRIDES:
            out["projectile"]["seq"] = PROJECTILE_OVERRIDES[weapon_name]
        out["projectile"].update(PROJECTILE_TWEAKS.get(weapon_name, {}))
    return out


def build_units(ok):
    gen1 = ok / "mods" / "openkrush_gen1"
    rules = my.load_tree(glob.glob(str(gen1 / "**" / "rules.yaml"), recursive=True)
                         + glob.glob(str(gen1 / "core" / "rules" / "**" / "*.yaml"), recursive=True))
    seqs = my.load_tree(glob.glob(str(gen1 / "**" / "sequences.yaml"), recursive=True)
                        + glob.glob(str(gen1 / "core" / "sequences" / "*.yaml")))
    wdefs = my.load_tree(glob.glob(str(gen1 / "**" / "weapons.yaml"), recursive=True)
                         + glob.glob(str(gen1 / "core" / "weapons" / "*.yaml")))

    units = {}
    skipped = []
    for name in sorted(rules):
        if not (name.startswith("survivors_") or name.startswith("evolved_")):
            continue
        kind = "infantry" if "_infantry_" in name else "vehicle" if "_vehicle_" in name else None
        if kind is None:
            continue
        r = my.resolve(rules, name)
        s = my.resolve(seqs, name)
        if name in INFANTRY_LAYOUT_OVERRIDES:
            stem = INFANTRY_LAYOUT_OVERRIDES[name]
            seq = {
                "idle": {"sprite": stem, "start": 0, "length": 1, "stride": 1, "facings": 16, "tick": 40},
                "aim": {"sprite": stem, "start": 16, "length": 1, "stride": 4, "facings": 16, "tick": 40},
                "shoot": {"sprite": stem, "start": 16, "length": 4, "stride": 4, "facings": 16, "tick": 120},
                "move": {"sprite": stem, "start": 80, "length": 6, "stride": 6, "facings": 16, "tick": 120},
            }
            muzzle = seq_info(my.resolve(seqs, "^muzzle_8_directions").get("muzzle"))
            die = seq_info(s.get("die"))
        else:
            seq = {k: seq_info(s.get(k)) for k in ("idle", "move", "aim", "shoot", "turret")}
            seq = {k: v for k, v in seq.items() if v}
            muzzle = seq_info(s.get("muzzle"))
            die = seq_info(s.get("die"))
        if "idle" not in seq or "move" not in seq:
            skipped.append((name, "no mobd idle/move"))
            continue
        arm = [c for c in r.children if c.key.split("@")[0] in ("OffsetsArmament", "Armament")]
        weapons = [a.val("Weapon") for a in arm if a.val("Weapon")]
        if not weapons:
            skipped.append((name, "unarmed"))
            continue
        weapon = build_weapon(wdefs, seqs, weapons[0], s)
        weapon["deathType"] = death_type(weapon)
        if weapon["projectile"]["type"] == "bullet" and not weapon["projectile"]["seq"]:
            skipped.append((name, "projectile sprite not in MOBDs"))
            continue
        mobile = r.get("Mobile")
        turreted = r.get("Turreted")
        valued = r.get("Valued")
        tooltip = r.get("Tooltip")
        unit = {
            "id": name,
            "name": tooltip.val("Name", name) if tooltip else name,
            "faction": name.split("_")[0],
            "kind": kind,
            "cost": int(valued.val("Cost", "100")) if valued else 100,
            "hp": int(r.get("Health").val("HP", "100")),
            "speed": round(int(mobile.val("Speed", "50")) * PX_PER_WDIST * 1000 / TICK_MS, 1),
            # OpenRA TurnSpeed is WAngle (1024 = full turn) per tick -> facings(16)/second
            "turnSpeed": round(int(mobile.val("TurnSpeed", "512")) / 1024 * 16 * 1000 / TICK_MS, 2),
            "turretTurnSpeed": round(int(turreted.val("TurnSpeed", "512")) / 1024 * 16 * 1000 / TICK_MS, 2) if turreted else None,
            "seq": seq,
            "muzzle": muzzle,
            "die": die,
            "weapon": weapon,
        }
        units[name] = unit
    # aircraft for the occasional airstrike event
    aircraft = {}
    for name in ("survivors_aircraft_bomber", "evolved_aircraft_wasp"):
        r = my.resolve(rules, name)
        sq = my.resolve(seqs, name)
        idle = seq_info(sq.get("idle"))
        bomb = seq_info(my.resolve(seqs, "survivors_aircraft_bomber").get("projectile"))
        ac = r.get("Aircraft")
        if idle and bomb:
            aircraft[name.split("_")[0]] = {
                "id": name,
                "seq": idle,
                "bomb": bomb,
                "speed": round(int(ac.val("Speed", "200")) * PX_PER_WDIST * 1000 / TICK_MS, 1) if ac else 150,
            }
    return units, skipped, aircraft


# --------------------------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--openkrush", help="path to an OpenKrush checkout")
    ap.add_argument("--maps", default="all", help="'all', 'none', or comma-separated map ids")
    args = ap.parse_args()

    ok = ensure_openkrush(args.openkrush)
    pal_img = Image.open(ok / "mods" / "openkrush_gen1" / "core" / "rules" / "palette.png")
    p = pal_img.getpalette()
    palette = [tuple(p[i * 3:i * 3 + 3]) for i in range(256)]

    (OUT / "sprites").mkdir(parents=True, exist_ok=True)
    units, skipped, aircraft = build_units(ok)
    for n, why in skipped:
        print(f"  skip {n}: {why}")

    maps_index = None
    extra = []
    if args.maps != "none":
        import maps as maprender
        ids = None if args.maps == "all" else args.maps.split(",")
        maps_index = maprender.build_all(ok, OUT / "maps", palette, ids)
        extra = maps_index["extraSprites"]

    mobds = find_mobd_files()
    team_stems = set()
    plain_stems = {"Extras", "Shrapnels", "Flame", "Oil"} | set(extra)
    for u in units.values():
        for sq in u["seq"].values():
            team_stems.add(sq["sprite"])
        if u["muzzle"]:
            plain_stems.add(u["muzzle"]["sprite"])
        if u["die"]:
            plain_stems.add(u["die"]["sprite"])
        pr = u["weapon"]["projectile"]
        if pr["type"] == "bullet":
            (team_stems if pr["team"] else plain_stems).add(pr["seq"]["sprite"])
    for a in aircraft.values():
        team_stems.add(a["seq"]["sprite"])
        team_stems.add(a["bomb"]["sprite"])
    plain_stems -= team_stems

    sprites = {}
    for stem in sorted(team_stems | plain_stems):
        path = mobds.get(stem.lower())
        if path is None:
            print("  missing MOBD", stem)
            continue
        n = export_sprite(stem, path, palette, OUT / "sprites", stem in team_stems)
        sprites[stem] = {"frames": n, "team": stem in team_stems}
        print(f"  sprite {stem}: {n} frames{' (+red)' if stem in team_stems else ''}")

    # drop units whose sprites failed
    units = {k: u for k, u in units.items() if all(sq["sprite"] in sprites for sq in u["seq"].values())}

    effects = {k: {"sprite": s, "start": st, "length": ln, "tick": tk} for k, (s, st, ln, tk) in EFFECT_NAMES.items()}
    sprites.update(export_death_sheets(ok, palette, OUT / "sprites", effects))
    db = {"sprites": sprites, "effects": effects, "units": units, "aircraft": aircraft}

    if maps_index:
        db["maps"] = maps_index["list"]
        db["tilesets"] = maps_index["tilesets"]

    (OUT / "units.json").write_text(json.dumps(db, indent=1))
    print(f"Wrote {len(units)} units, {len(sprites)} sprites to {OUT}")


if __name__ == "__main__":
    main()
