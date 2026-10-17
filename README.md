# KKnD Tools

Fan-made tools for **KKnD** (Krush Kill 'n Destroy, 1997): extract the game's sprites with correct
alignment data, and run an endless self-playing KKnD battle as a live desktop wallpaper.

> Free, non-commercial fan project for the KKnD community. Not affiliated with Beam Software,
> Melbourne House or the rights holders. Single-player / offline fun only.

## What's here

| | |
|---|---|
| **[battle/](battle/README.md)** | **KKnD Battle**, a live wallpaper for Lively Wallpaper, Wallpaper Engine or a browser. Screen-sized battlefields from the classic maps, Survivors vs Evolved, real weapons and effects, endless reinforcements, a new battlefield every 15 minutes. |
| `extract_mobd.py` | Extracts KKnD `.mobd` sprites to PNG frames plus `{Name}_frames.json` metadata (origins, animation structure, weapon/turret points). |
| `extract-assets.ps1` | Copies `SPRITES.LVL` from a KKnD Xtreme install and runs the extractor. |
| `tools/` | The Python pipeline: MOBD parser, sprite atlas packer, map renderer, battle asset builder. |
| `units/`, `effects/`, `ui/` | The raw `.mobd` files from KKnD Xtreme's `SPRITES.LVL`, with their frame metadata. |
| [documentation.md](documentation.md) | Technical reference: file formats, metadata, how the pipeline works. |

## Quick start

**Just want the wallpaper?**
1. Install [Lively Wallpaper](https://apps.microsoft.com/detail/9ntm2qc6qws7) (free, Microsoft Store).
2. Download **[kknd-battle-wallpaper.zip](https://github.com/7ardon2000/kknd-tools/releases/latest/download/kknd-battle-wallpaper.zip)**
   (all versions: [Releases](https://github.com/7ardon2000/kknd-tools/releases)).
3. Drag the zip onto the Lively window and click it.

See [battle/README.md](battle/README.md) for Wallpaper Engine, browser use and all settings.

**Build it yourself** (Python 3, Node.js 18+, git):

```bash
npm run setup      # Python + Node dependencies
npm run assets     # build sprites, unit data and maps (downloads OpenKrush data on first run)
npm run dev        # preview at http://localhost:5180
npm run package    # -> battle/kknd-battle-wallpaper.zip
```

**Extract sprites as PNGs:**

```bash
python extract_mobd.py --from-repo   # from the .mobd files in this repo, no game needed
.\extract-assets.ps1                 # or from your KKnD Xtreme install (default C:\Games\KKND Xtreme)
```

PNGs land next to each `.mobd` file (for example `units/swat/SWAT_0000.png`) and are git-ignored.

## What was wrong before, and what fixed it

Earlier versions of these tools tried to export units as sprite sheets and line up muzzle flashes and
other effects by hand. That never worked reliably. Three causes were found and fixed:

1. **The weapon point data was decoded wrongly.** Every MOBD frame stores where its gun muzzle (or turret
   mount) is. The old extractor guessed that list's format, so every `points` entry in the metadata was
   garbage, and effects had to be nudged by hand. The real format is a list of
   `{id, x, y, z}` records (int32, x/y in 1/256 px) ending with `0xFFFFFFFF`. All committed
   `*_frames.json` files have been regenerated with correct points.
2. **Frame origins were treated as unsigned and clamped to the image.** Origins are signed and often lie
   outside the image. A muzzle flash, for example, is anchored at its base, outside its own pixels. The
   old viewer clamped them, so flashes always appeared in the wrong place.
3. **Every unit was assumed to share one frame layout.** In reality each MOBD lists its animations per
   facing (16 directions) with different frame counts. The battle now reads each unit's real layout,
   weapons and effects from [OpenKrush](https://github.com/IceReaper/OpenKrush), the open-source KKnD
   engine.

The parser is now a faithful port of OpenKrush's MOBD reader (`tools/mobd.py`). It also handles a quirk
of the `.mobd` files in this repo: their internal pointers are absolute offsets into the original
`SPRITES.LVL`, so each file's original position is recovered automatically. That means the sprites
decode without the game installed. Details are in [documentation.md](documentation.md).

The old manual alignment viewer (`viewer/`) has been removed; the battle app supersedes it. It remains
in the git history (commit `1818a50`) if you need it.

## Requirements

* Python 3 with Pillow (`pip install -r requirements.txt`)
* Node.js 18+ (for the battle app)
* git (the build downloads OpenKrush's data on first run)
* Optional: KKnD Xtreme ([Steam](https://store.steampowered.com/app/281030/KKND_Xtreme/)), only needed
  to re-extract from the original game files

## License

The code is GPL-3.0 (see [LICENSE](LICENSE)); the MOBD parser is a port of GPL-3.0 OpenKrush code.
KKnD's graphics and data belong to their owners. Personal, non-commercial fan use only.
