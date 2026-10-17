# KKnD Battle: live wallpaper

An endless KKnD battle as your desktop background.

Each battlefield is a screen-sized piece of one of the 35 classic KKnD maps, shown with a still camera,
so your icons and windows stay calm on top of it. Survivors march in from the left edge of the screen
and Evolved from the right, and fronts form wherever they meet. Units fight with their real weapons
and animations: muzzle flashes, rockets with smoke trails, flamethrowers, beetle spit, tank shells,
burning and exploding deaths, craters and wrecks. Reinforcements arrive in loose groups at different points along the screen edges, and now and then as a
special squad of one unit type: a SWAT team, a Dire Wolf pack, a column of tanks, a beetle swarm. Units
that break through march on and leave at the far edge. The side being pushed back reinforces harder and launches offensives, so the front swings
back and forth. Now and then the losing side calls in a Wilbur bomber or a Wasp.

Every 15 minutes the screen fades to black and fades back in on a new battlefield from a different map.

It is a web page (Phaser 3), so it runs in **Lively Wallpaper** (free, Windows), **Wallpaper Engine**
or any browser.

> Fan project for the KKnD community: free and non-commercial. Not affiliated with Beam Software,
> Melbourne House or the rights holders.

## Install

**No original KKnD files are included in the download.** The wallpaper draws the units from your own
copy of the game: KKnD Xtreme ([GOG](https://www.gog.com/game/krush_kill_n_destroy_xtreme) or Steam),
a KKnD / KKnD Xtreme CD, or the free official KKnD Xtreme demo.

1. Download **[kknd-battle-wallpaper.zip](https://github.com/7ardon2000/kknd-tools/releases/latest/download/kknd-battle-wallpaper.zip)**
   from the [latest release](https://github.com/7ardon2000/kknd-tools/releases/latest) and extract it
   (right-click → **Extract All**).
2. Double-click **`Setup.cmd`**. It looks for KKnD the way [OpenKrush](https://github.com/IceReaper/OpenKrush)
   does: GOG, Steam, common install folders and CD drives. If it finds nothing, it offers to download
   the free [KKnD Xtreme demo](https://archive.org/details/KKNDXT) (7.7 MB, checksum verified), or lets
   you choose the file yourself: `SPRITES.LVL` in the game's `LEVELS\640` folder, or the demo's
   `KKND_XT.EXE`.
3. Setup copies that one file into `wallpaper\gamefiles\` and creates **`KKnD Battle Wallpaper.zip`**
   next to `Setup.cmd`. That zip contains your own game file, so keep it for yourself.

**Lively Wallpaper** (Windows, free: [rocksdanister.com/lively](https://www.rocksdanister.com/lively/))
1. Drag `KKnD Battle Wallpaper.zip` onto the Lively window, or use **+ Add Wallpaper → Browse**.
2. Select it. **Customise** opens the settings listed below.
3. Tip: in Lively's settings, pause the wallpaper while a fullscreen or maximised app is running, so
   the battle does not compete with your games.

**Wallpaper Engine**
After Setup, **Open Wallpaper → Open from File** and choose `wallpaper\project.json`. The same settings
appear in its properties panel.

**Browser**
Serve the `wallpaper` folder with any static web server, for example `npx serve wallpaper`, then open
the printed address. Opening `index.html` straight from disk does not work, because browsers block
loading files over `file://`. Without Setup, the page asks once for `SPRITES.LVL` or `KKND_XT.EXE`
(choose or drop the file) and the browser remembers it.

## Settings

Lively and Wallpaper Engine show these in their settings panel. In a browser, add them to the address,
for example `index.html?map=desertstorm&rotate=5&teams=mixed,mixed`.

| Setting | URL parameter | Default | What it does |
|---|---|---|---|
| Map | `map` | all | One map to always use (a new part of it each rotation), or all maps in a shuffled playlist (`desertstorm`, `highlandjig`, `urbaneassault`, ...) |
| Armies | `teams` | `survivors,evolved` | Faction per side: `survivors`, `evolved` or `mixed` |
| Pixel zoom | `zoom` | auto | Whole-number zoom; auto is 1× up to 1440p and 2× on 4K. Higher zoom = bigger units, smaller battlefield |
| Units per side | `units` | auto | Base unit cap per side (auto: about 30 on a 1080p screen, scaled with screen area) |
| Vehicles | `vehicles` | on | Off = infantry only |
| Lethality | `lethality` | `0.9` | Damage multiplier: higher means shorter, bloodier fights |
| Reinforcements | `wave` | `8` | Average seconds between reinforcement waves |
| Special squads | `squads` | `0.18` | Share of waves that are a squad of one unit type (`0` = never) |
| Battlefield every | `rotate` | `15` | Minutes before fading to the next battlefield (`0` = never) |
| Airstrikes | `airstrike` | `2` | Average minutes between airstrikes (`0` = off) |
| Corpses stay | `corpses` | `25` | Seconds corpses stay on the ground |
| Game speed | `speed` | `1` | Speed of the whole battle |
| Frame rate | `fps` | `60` | `30` uses roughly half the CPU/GPU |

URL-only options: `maps` (`classic`, `multiplayer` or `all`: pool for random maps), `seed` (replay the
same battle), `lod=0` (full-detail updates for off-screen units), `debug=1` (stats overlay with GPU,
resolution and frame time, blocked cells, HP bars), and `roster0` / `roster1` (limit a side to unit ids
containing these words, e.g. `roster0=anacondatank,sniper`).

## Build from source

Requires Python 3 with Pillow, Node.js 18+ and git. From the repository root:

```bash
npm run setup      # pip install -r requirements.txt, then npm install in battle/
npm run assets     # unit data and maps -> battle/public/assets (clones OpenKrush into .cache/),
                   # and your SPRITES.LVL -> battle/public/gamefiles/ for the dev server (git-ignored)
npm run dev        # http://localhost:5180
npm run package    # -> battle/release/ and battle/kknd-battle-wallpaper.zip
```

`npm run assets` finds your game like Setup does (see `tools/gamedata.py`; set `KKND_XTREME` to the
game folder if it is somewhere unusual) and falls back to the free demo.

`npm run package` builds the release: `Setup.cmd` and `setup/setup.ps1` (from `setup/`), a
`README.txt`, and `wallpaper/`: the built page plus `LivelyInfo.json`, `LivelyProperties.json`
(Lively) and `project.json` (Wallpaper Engine), all generated by `scripts/package.mjs` from one list of
settings. It removes `gamefiles/` from the build and refuses to package if any game file
(`.lvl`, `.mobd`, `.exe`, decoded sprite sheets) is left in it.

## Code layout (`src/`)

| File | Role |
|---|---|
| `main.js` | Phaser setup, pixel-exact canvas sizing, full-precision shaders |
| `battle.js` | The scene: map playlist and rotation, battlefield building, spawning and waves, damage, front lines and offensives, airstrikes, culling |
| `unit.js` | One unit: targeting, movement, turning, turrets, firing, deaths |
| `effects.js` | Animated effects, projectiles, debris, craters |
| `world.js` | Picks a screen-sized region of a map and cuts it out (fills the gap if the map is smaller than the screen) |
| `terrain.js` | Soft ground: feathers hard tile seams |
| `grid.js` | Passability, line of sight, flow fields |
| `airstrike.js` | Bomber / Wasp flyover and bomb |
| `spatial.js` | Spatial hash for neighbour queries |
| `sprites.js` | Facings, frame indices, MOBD points |
| `gamefiles/` | Reads the player's game files: finds `SPRITES.LVL` (next to the page, remembered in IndexedDB, or chosen on the setup screen), unpacks the demo installer (ZIP + InstallShield cabinet), decodes MOBD sprites and packs them into Phaser atlases |
| `snap.js` | Puts the camera on whole screen pixels |
| `wallpaper.js` | Settings from Lively / Wallpaper Engine |
| `config.js` | Defaults and URL parameters |

## How it works

* **Sprites from your own game files.** At startup the page reads `SPRITES.LVL`, decodes the original
  `.mobd` sprites (a JavaScript port of OpenKrush's reader) and packs them into texture atlases, with a
  red team-colour copy for the Evolved side. This takes about half a second. Each frame carries an
  origin and a list of points; point 0 is the gun muzzle (infantry and turrets) or the turret mount
  (vehicle bodies). Turrets, muzzle flashes and projectile launch positions use those points, so
  nothing is placed by hand. See [../documentation.md](../documentation.md).
* **Units, weapons and maps** come from [OpenKrush](https://github.com/IceReaper/OpenKrush), the
  open-source KKnD engine. Its `openkrush_gen1` mod describes every unit (animations per facing, HP,
  speed, weapon range, reload, burst, projectile, muzzle flash, death) and contains the palette,
  tilesets and the 35 maps in OpenRA format.
* **Battlefields.** Each one is a region of a map exactly the size of the screen, plus 4 off-screen
  cells on the left and right where reinforcements spawn and where units leave. The region is chosen
  for open fighting ground with some terrain and objects, and must have a route from side to side.
  Maps play from a shuffled playlist; maps smaller than the screen get their edges extended with their
  own ground.
* **Battle.** Flow fields lead each side to the far edge around cliffs, water and buildings. The
  battlefield is split into three lanes, each with its own front line. Waves come as 1–3 loose clusters
  at random heights; marching units keep their own lane with a slowly wandering heading, and close in
  on distant enemies at an angle rather than in a straight line, so groups advance as a spread-out
  front instead of in single file.
* **Pixel-exact.** The canvas uses the screen's real pixel resolution even with Windows display
  scaling, zoom is always a whole number, and every sprite sits on whole pixels, so the pixel art stays
  crisp.
* **Soft terrain.** Where tiles meet that were never meant to touch (maps cut through a feature, blocky
  patches), the hard seam is feathered over about 30 px. Designed edges (cliffs, roads, dunes) are
  detected and stay sharp.
* **Staying light on long runs.** Units in the off-screen strips update about 5 times a second, and
  effects there are not created (their hits still land). Corpses, craters and wrecks fade out. Each
  new battlefield unloads the previous map's data and textures; memory stays flat (about 14 MB of
  JavaScript heap). Game logic costs about 0.5 ms per frame.

## Credits

* KKnD (Krush Kill 'n Destroy) © Beam Software / Melbourne House. The game graphics belong to their
  owners and are not distributed here: they are read from the player's own copy of the game.
* [OpenKrush](https://github.com/IceReaper/OpenKrush) (GPL-3.0) by IceReaper and the OpenKrush team:
  unit, weapon and map data, palette, tilesets, the MOBD format the parser is ported from, and the
  game/demo installer logic Setup follows. Infantry burn and explode death animations by Dzierzan.
* The InstallShield cabinet reader follows [OpenRA](https://github.com/OpenRA/OpenRA) (GPL-3.0).
* Built with [Phaser 3](https://phaser.io).
