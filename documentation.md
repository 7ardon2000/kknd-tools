# KKnD Tools: technical reference

How KKnD's sprite data is stored, what the extracted metadata means, and how the battle wallpaper's
asset pipeline works. For using the tools see [README.md](README.md) and
[battle/README.md](battle/README.md).

## Repository layout

```
extract_mobd.py            SPRITES.LVL -> PNG frames + {Name}_frames.json (into units/, effects/, ui/)
tools/
  gamedata.py              finds SPRITES.LVL (Steam, GOG, CD, demo download), LVL archive index,
                           InstallShield cabinet reader for the demo installer
  mobd.py                  MOBD parser (port of OpenKrush's reader)
  atlas.py                 palette -> RGBA, shadow handling, pivot-correct Phaser atlas packing
  maps.py                  OpenKrush maps (map.bin + tilesets) -> tile data, passability, decor
  miniyaml.py              reader for OpenRA/OpenKrush MiniYaml (with Inherits)
  build_battle_assets.py   builds everything in battle/public/assets
battle/                    the live wallpaper (Phaser 3, Vite)
  src/gamefiles/           JavaScript ports of gamedata/mobd/atlas: decodes the player's SPRITES.LVL
  setup/                   Setup.cmd + setup.ps1: finds the player's game and builds their wallpaper
```

Git-ignored, never committed: `content/` (your own game files, optional), `units/`, `effects/`,
`ui/` (extractor output), `battle/public/gamefiles/` (your SPRITES.LVL for the dev server),
`.cache/openkrush/` (OpenKrush checkout) and `.cache/kknd-demo/` (the demo, if it was downloaded).

## Where the data comes from

* **Sprites:** `LEVELS\640\SPRITES.LVL` of the player's own KKnD Xtreme or KKnD (the original KKnD CD
  has it under `KKND\LEVELS\640`) embeds 81 MOBD sprite files. Nothing from it is stored in this
  repository or in the wallpaper download. `tools/gamedata.py` looks for it in this order, following
  OpenKrush's installer (`mods/openkrush_gen1/installer/*.yaml`):
  1. `content/sprites.lvl`, or the folder in the `KKND_XTREME` environment variable
  2. Steam: `SteamPath` from the registry, every library in `steamapps/libraryfolders.vdf`, the
     install folder from `appmanifest_1292170.acf`
  3. GOG: `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\1207659107`, value `path`
  4. common install folders, then every CD drive
  5. the free official KKnD Xtreme demo, `https://archive.org/download/KKNDXT/KKND_XT.EXE`
     (SHA-1 `90222373c1ff06a02509f0d811385c0571e398df`). It is a self-extracting installer: a ZIP
     at offset `0xB7B95` holds `data1.cab`, an InstallShield v5 cabinet, in which
     `Multiplayer Levels\LEVELS\640\SPRITES.LVL` is stored as a series of `[uint16 size][raw
     deflate]` blocks. Its 81 MOBDs are byte-identical to the full game's.

  The wallpaper's `setup.ps1` searches the same places. The page itself (`battle/src/gamefiles/`)
  accepts `SPRITES.LVL`, `KKND_XT.EXE`, `data1.cab` or a ZIP holding one of them.
* **Palette, unit definitions, maps:** [OpenKrush](https://github.com/IceReaper/OpenKrush) (GPL-3.0),
  `mods/openkrush_gen1`:
  * `core/rules/palette.png`: the 256-colour palette for Gen1 (KKnD 1) sprites
  * `archives/sprites.lvl.yaml`: names of the files inside `SPRITES.LVL` (`0.mobd: AlchemyHall.mobd`, ...)
  * `actors/**/sequences.yaml`, `rules.yaml`, `weapons.yaml`: every unit's animations, stats and weapons
  * `tilesets/` and `maps/`: tilesets as PNGs and 35 maps in OpenRA format (`map.bin` + `map.yaml`)

The tools clone OpenKrush into `.cache/openkrush` when they need it. Pass `--openkrush PATH` to use
an existing checkout.

### The LVL archive

`SPRITES.LVL` starts with `DATA` and a big-endian uint32 size; the rest is the data block. Its first
int32 points to a type table of `{type: char[4], list offset: int32}` entries; each list holds int32
file offsets (0 = empty slot). A file ends where the next one starts. `0.mobd` is the first MOBD in
the list; OpenKrush's `sprites.lvl.yaml` maps these to names.

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

### Absolute offsets

Pointers inside a MOBD are **absolute offsets into the `SPRITES.LVL` data block**, not offsets within
the MOBD itself, so a MOBD is parsed in place inside the data block: `mobd.parse(data[off:off + size],
off)` in Python, `parseMobd(data, off, size)` in JavaScript.

### What the old extractor got wrong

* It guessed the point list was `count:uint16` followed by 5-byte entries. That is wrong, so all
  `points` data was garbage, and muzzle effects could not be placed from data.
* It read origins as unsigned.
* The old viewer clamped the origin into the image (`ox / width` limited to 0..1), which misplaced
  anything anchored outside its pixels.

## `{Name}_frames.json`

Written next to each extracted `.mobd` by `extract_mobd.py`:

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

Writes everything the wallpaper loads as files into `battle/public/assets`. None of it is original
game graphics:

* **Game sprites are not files.** `units.json` lists them (`sprites.<Stem>.mobd: true`) along with the
  palette and the LVL file names, and the page builds them at startup from the player's
  `SPRITES.LVL` (`battle/src/gamefiles/`): one Phaser atlas per MOBD, frames trimmed and packed into a
  power-of-two texture. Each frame's `sourceSize` is an even square centred on its (whole-pixel)
  origin, so a sprite with origin 0.5 puts the MOBD origin exactly at its position. Unit sprites also
  get a `<Stem>_red` variant (team colour: palette indices 8–13, blue, are remapped to 24–29, red).
  Shadow pixels touching the outside become translucent black. MOBD points per frame go into the
  Phaser JSON cache as `pts_<Stem>`, `{frame: [[id, x, y], ...]}`. The JavaScript decoder and packer
  produce the same frames and atlases as `tools/mobd.py` and `tools/atlas.py`, byte for byte.
* **`sprites/InfDeath*.png` + `.json`:** OpenKrush's fan-made infantry death sheets, same atlas layout.
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
python extract_mobd.py                  # PNG frames + metadata into units/, effects/, ui/
python extract_mobd.py --metadata-only  # JSON only
python extract_mobd.py --openkrush PATH # use an existing OpenKrush checkout for palette / file names
```

`content/palette.png` and `content/sprites.lvl.yaml` are used if present; otherwise they come from
OpenKrush. The output is for your own use: it is git-ignored, please don't publish it.
