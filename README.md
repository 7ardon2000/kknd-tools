# KKnD Tools

Fan-made tools for **KKnD** (Krush Kill 'n Destroy, 1997): extract the game's sprites with correct
alignment data, and run an endless self-playing KKnD battle as a live desktop wallpaper.

> Free, non-commercial fan project for the KKnD community. Not affiliated with Beam Software,
> Melbourne House or the rights holders.

**No original game files are included.** Like [OpenKrush](https://github.com/IceReaper/OpenKrush),
everything here reads the graphics from **your own copy** of the game: KKnD Xtreme from
[GOG](https://www.gog.com/game/krush_kill_n_destroy_xtreme) or Steam, a KKnD / KKnD Xtreme CD, or the
free official [KKnD Xtreme demo](https://archive.org/details/KKNDXT). The tools find an installed game
automatically, the same way OpenKrush does.

## What's here

| | |
|---|---|
| **[battle/](battle/README.md)** | **KKnD Battle**, a live wallpaper for Lively Wallpaper, Wallpaper Engine or a browser. Screen-sized battlefields from the classic maps, Survivors vs Evolved, real weapons and effects, endless reinforcements, a new battlefield every 15 minutes. |
| `extract_mobd.py` | Extracts KKnD's `.mobd` sprites from your `SPRITES.LVL` to PNG frames plus `{Name}_frames.json` metadata (origins, animation structure, weapon/turret points). |
| `tools/` | The Python pipeline: game file finder (`gamedata.py`), MOBD parser, sprite atlas packer, map builder, battle asset builder. |
| [documentation.md](documentation.md) | Technical reference: file formats, metadata, how the pipeline works. |

## Quick start

**Just want the wallpaper?**
1. Download **[kknd-battle-wallpaper.zip](https://github.com/7ardon2000/kknd-tools/releases/latest/download/kknd-battle-wallpaper.zip)**
   and extract it (right-click → Extract All).
2. Double-click **`Setup.cmd`**. It finds your KKnD (GOG, Steam, CD) by itself. No game? It offers to
   download the free official demo, or lets you choose `SPRITES.LVL` yourself.
3. Drag the **`KKnD Battle Wallpaper.zip`** it creates onto [Lively Wallpaper](https://www.rocksdanister.com/lively/)
   (free) and click it.

See [battle/README.md](battle/README.md) for Wallpaper Engine, browser use and all settings.

**Build it yourself** (Python 3, Node.js 18+, git):

```bash
npm run setup      # Python + Node dependencies
npm run assets     # unit data and maps from OpenKrush (cloned on first run), plus your SPRITES.LVL for dev
npm run dev        # preview at http://localhost:5180
npm run package    # -> battle/kknd-battle-wallpaper.zip (no game files inside)
```

**Extract sprites as PNGs:**

```bash
python extract_mobd.py                  # PNG frames + metadata into units/, effects/, ui/
python extract_mobd.py --metadata-only  # metadata only
```

The game files are looked up in this order (see [`tools/gamedata.py`](tools/gamedata.py)):
`content/sprites.lvl`, the folder in the `KKND_XTREME` environment variable, Steam (app 1292170),
GOG (game 1207659107), common install folders, a KKnD / KKnD Xtreme CD, and finally the free demo,
downloaded once from archive.org into `.cache/` (SHA-1 checked). Everything extracted stays on your
computer: `units/`, `effects/`, `ui/` and `content/` are git-ignored. Please don't publish them.

## What was wrong before, and what fixed it

Earlier versions of these tools tried to export units as sprite sheets and line up muzzle flashes and
other effects by hand. That never worked reliably. Three causes were found and fixed:

1. **The weapon point data was decoded wrongly.** Every MOBD frame stores where its gun muzzle (or turret
   mount) is. The old extractor guessed that list's format, so every `points` entry in the metadata was
   garbage, and effects had to be nudged by hand. The real format is a list of
   `{id, x, y, z}` records (int32, x/y in 1/256 px) ending with `0xFFFFFFFF`.
2. **Frame origins were treated as unsigned and clamped to the image.** Origins are signed and often lie
   outside the image. A muzzle flash, for example, is anchored at its base, outside its own pixels. The
   old viewer clamped them, so flashes always appeared in the wrong place.
3. **Every unit was assumed to share one frame layout.** In reality each MOBD lists its animations per
   facing (16 directions) with different frame counts. The battle now reads each unit's real layout,
   weapons and effects from [OpenKrush](https://github.com/IceReaper/OpenKrush), the open-source KKnD
   engine.

The parser is a faithful port of OpenKrush's MOBD reader, in Python (`tools/mobd.py`) and in
JavaScript for the wallpaper (`battle/src/gamefiles/mobd.js`). Details are in
[documentation.md](documentation.md).

## Requirements

* Python 3 with Pillow (`pip install -r requirements.txt`)
* Node.js 18+ (for the battle app)
* git (the build downloads OpenKrush's data on first run)
* KKnD or KKnD Xtreme, or the free demo (downloaded automatically when no game is found)

## License and credits

The code is GPL-3.0 (see [LICENSE](LICENSE)). The MOBD parser and the game file installers follow
GPL-3.0 code from [OpenKrush](https://github.com/IceReaper/OpenKrush) by IceReaper and the OpenKrush
team, and its InstallShield reader follows [OpenRA](https://github.com/OpenRA/OpenRA). Unit, weapon and
map data, the palette, tilesets and the infantry death animations (Dzierzan) come from OpenKrush.
KKnD's graphics belong to their owners and are never stored in this repository.
