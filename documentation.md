# KKnD Tools: technical reference

How KKnD's sprite data is stored, what the extracted metadata means, and how the battle wallpaper's
asset pipeline works. For using the tools see [README.md](README.md) and
[battle/README.md](battle/README.md).

## Repository layout

```
extract_mobd.py            MOBD -> PNG frames + {Name}_frames.json
extract-assets.ps1         copies SPRITES.LVL from KKnD Xtreme into content/ and runs the extractor
tools/
  mobd.py                  MOBD parser (port of OpenKrush's reader) + base-offset recovery
  atlas.py                 palette -> RGBA, shadow handling, pivot-correct Phaser atlas packing
  maps.py                  OpenKrush maps (map.bin + tilesets) -> tile data, passability, decor
  miniyaml.py              reader for OpenRA/OpenKrush MiniYaml (with Inherits)
  build_battle_assets.py   builds everything in battle/public/assets
units/ effects/ ui/        raw .mobd files from SPRITES.LVL + {Name}_frames.json
battle/                    the live wallpaper (Phaser 3, Vite)
content/                   (git-ignored) game files copied by extract-assets.ps1
.cache/openkrush/          (git-ignored) OpenKrush checkout, cloned on first use
```

## Where the data comes from

* **Sprites:** KKnD Xtreme's `LEVELS\640\SPRITES.LVL` embeds about 80 MOBD sprite files. They are
  already extracted into `units/`, `effects/` and `ui/`, so the game is not needed.
* **Palette, unit definitions, maps:** [OpenKrush](https://github.com/IceReaper/OpenKrush) (GPL-3.0),
  `mods/openkrush_gen1`:
  * `core/rules/palette.png`: the 256-colour palette for Gen1 (KKnD 1) sprites
  * `archives/sprites.lvl.yaml`: names of the files inside `SPRITES.LVL` (`0.mobd: AlchemyHall.mobd`, ...)
  * `actors/**/sequences.yaml`, `rules.yaml`, `weapons.yaml`: every unit's animations, stats and weapons
  * `tilesets/` and `maps/`: tilesets as PNGs and 35 maps in OpenRA format (`map.bin` + `map.yaml`)

The tools clone OpenKrush into `.cache/openkrush` when they need it. Pass `--openkrush PATH` to use
an existing checkout.

## The MOBD format

A MOBD is a set of animations; each animation is a list of frames.

* **Rotational animations** are listed first and indexed globally in order. A unit with 16 facings has
  one rotational animation per facing for each action. For example SWAT has 48: 16 idle (1 frame each),
  16 shooting (4 frames each) and 16 walking (6 frames each). Facing 0 is north, and facings go clockwise.
* **Simple animations** (non-directional, such as deaths and explosions) follow.

Each **frame** record (28 bytes) holds:

| Field | Type | Meaning |
|---|---|---|
| origin x, y | int32 (signed) | Pivot inside the image: the point placed at the unit's position. Can be negative or beyond the image (a muzzle flash is anchored at its base, outside its own pixels). |
| render flags offset | uint32 | Image header: type `SPRT` (Gen1, external palette) or `SPNS`/`SPRC` (Gen2, embedded palette), flip flag, image offset |
| box list offset | uint32 | Hit boxes (not used) |
| point list offset | uint32 | Points, see below |

The **point list** is a sequence of 16-byte records `{id: int32, x: int32, y: int32, z: int32}`, ending
with `0xFFFFFFFF`. `x` and `y` are 24.8 fixed point (shift right by 8 for pixels) and are offsets from
the frame origin. **Point id 0 is the weapon muzzle** on infantry and turrets, and the **turret mount**
on vehicle bodies. Other ids exist (infantry also carry id 2, around chest height); their use isn't
documented.

Images are RLE-compressed rows of palette indices (index 0 = transparent). Gen1 sprites use the
external palette, and index 177 (near black) is used for drop shadows.

### Absolute offsets and base recovery

Pointers inside a MOBD are **absolute offsets into the `SPRITES.LVL` data block**, not offsets within
the `.mobd` file. A standalone `.mobd` therefore cannot be parsed until you know where it originally sat.
`tools/mobd.py:find_base` recovers this: the first animation's first frame pointer minus that frame
record's position in the file gives the base. It tries each candidate and keeps the one whose full parse
succeeds with the expected frame count.

### What the old extractor got wrong

* It guessed the point list was `count:uint16` followed by 5-byte entries. That is wrong, so all
  `points` data was garbage, and muzzle effects could not be placed from data.
* It read origins as unsigned.
* The old viewer clamped the origin into the image (`ox / width` limited to 0..1), which misplaced
  anything anchored outside its pixels.

## `{Name}_frames.json`

Written next to each `.mobd` by `extract_mobd.py`:

```json
{
  "rotational_count": 48,
  "simple_count": 0,
  "total_frames": 176,
  "frames": [
    { "i": 16, "anim": "rotational", "dir": 16, "frame": 0, "ox": 5, "oy": 20, "w": 10, "h": 27,
      "points": [ { "id": 2, "x": 0, "y": -17 }, { "id": 0, "x": 2, "y": -20 } ] }
  ]
}
```

| Field | Meaning |
|---|---|
| `i` | Global frame index (PNG: `{Name}_{i:04d}.png`) |
| `anim` | `rotational` or `simple` |
| `dir` / `idx` | Rotational animation index (facings × actions) or simple animation index |
| `frame` | Frame number inside that animation |
| `ox`, `oy` | Origin (pivot) inside the image, signed |
| `w`, `h` | Image size |
| `points` | Offsets from the origin; `id 0` = muzzle / turret mount |

**Drawing a frame:** place the image's top-left at `position - (ox, oy)`.
**Muzzle position:** `position + point(id 0)`.
**Turret:** draw the turret frame at `body position + body point(id 0)`. Its muzzle is that plus the
turret frame's own point 0.

## Battle asset pipeline (`tools/build_battle_assets.py`)

Writes everything the wallpaper loads into `battle/public/assets`:

* **`sprites/<Stem>.png` + `.json`:** one Phaser atlas per MOBD. Frames are trimmed and packed into a
  power-of-two texture. Each frame's `sourceSize` is an even square centred on its (whole-pixel) origin,
  so a sprite with origin 0.5 puts the MOBD origin exactly at its position. Unit sprites also get a
  `<Stem>_red` variant (team colour: palette indices 8–13, blue, are remapped to 24–29, red). Shadow
  pixels touching the outside become translucent black.
* **`sprites/<Stem>.points.json`:** MOBD points per frame, `{frame: [[id, x, y], ...]}`.
* **`units.json`:**
  * `units`: per unit, the `seq` sequences (idle / move / aim / shoot / turret, as
    `{sprite, start, length, stride, facings, tick}`), `hp`, `speed` (px/s), turn speeds, `muzzle`,
    `die`, and `weapon` (range px, reload ms, burst, damage per armour class, projectile).
  * `effects`: named effects such as explosions, hits, blood, debris, craters and smoke.
  * `aircraft`: the airstrike planes.
  * `maps` and `tilesets`: the map index and per-tileset ground tiles.
* **`maps/<id>.json`:** tile indices into `tiles_<tileset>.png`, a passability grid (water, cliffs,
  building footprints), spawns and decor `{x, y, z, f}`. **`maps/<id>_decor.png/.json`:** that map's
  object atlas.

OpenRA units are converted with 1 cell = 1024 world units = 32 px and 1 tick = 40 ms.

A frame index for facing `d` (0–15, clockwise from north) and step `s` of a sequence is
`start + d * stride + (s % length)`.

## Extractor options

```
python extract_mobd.py                  # from content/sprites.lvl
python extract_mobd.py --from-repo      # from the .mobd files in units/, effects/, ui/ (no game needed)
python extract_mobd.py --metadata-only  # JSON only
python extract_mobd.py --openkrush PATH # use an existing OpenKrush checkout for palette / file names
```

`content/palette.png` and `content/sprites.lvl.yaml` are used if present; otherwise they come from OpenKrush.
