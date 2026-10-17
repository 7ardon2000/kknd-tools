/**
 * The wallpaper ships without any original KKnD graphics. The unit and effect sprites are decoded
 * here from the player's own SPRITES.LVL, found in this order:
 *   1. gamefiles/ next to index.html (put there by Setup.cmd: SPRITES.LVL or the demo's KKND_XT.EXE)
 *   2. the copy remembered in this browser (IndexedDB)
 *   3. a file the player picks on the setup screen
 */
import { mobdImages, pack, TEAM_REMAP } from './atlas.js';
import { lvlIndex } from './lvl.js';
import { parseMobd } from './mobd.js';
import { extractSpritesLvl } from './source.js';
import { loadStored, store } from './store.js';
import { askForGameFiles } from './setup.js';

const BUNDLED = ['gamefiles/SPRITES.LVL', 'gamefiles/sprites.lvl', 'gamefiles/KKND_XT.EXE'];

async function fetchBundled() {
  for (const url of BUNDLED) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length) return await extractSpritesLvl(bytes);
    } catch {
      // not there (or not a usable file): try the next source
    }
  }
  return null;
}

/** Check that a SPRITES.LVL has every sprite the wallpaper needs; returns a list of missing ones. */
function missingSprites(db, lvl) {
  const { files } = lvlIndex(lvl, db.lvlNames);
  const have = new Set(Object.keys(files).map((n) => n.toLowerCase()));
  return Object.entries(db.sprites)
    .filter(([stem, info]) => info.mobd && !have.has(`${stem.toLowerCase()}.mobd`))
    .map(([stem]) => stem);
}

/** SPRITES.LVL bytes from the first source that has a usable one (asks the player if needed). */
export async function getSpritesLvl(db) {
  const bundled = await fetchBundled();
  if (bundled && !missingSprites(db, bundled).length) return bundled;
  const stored = await loadStored();
  if (stored && !missingSprites(db, stored).length) return stored;
  const picked = await askForGameFiles(async (bytes) => {
    const lvl = await extractSpritesLvl(bytes);
    const missing = missingSprites(db, lvl);
    if (missing.length) throw new Error(`this SPRITES.LVL is missing ${missing.length} sprites (${missing.slice(0, 3).join(', ')}...)`);
    return lvl;
  });
  await store(picked);
  return picked;
}

function canvasFrom(width, height, rgba) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
}

/**
 * Decode every MOBD sprite listed in db.sprites into Phaser atlases (`<Stem>`, team-coloured
 * `<Stem>_red`) and their embedded points (json cache `pts_<Stem>`), the same layout
 * tools/atlas.py produced as files. Yields to the browser between sprites; onProgress(0..1).
 */
export async function buildSprites(scene, db, lvl, onProgress = () => {}) {
  const { data, files } = lvlIndex(lvl, db.lvlNames);
  const byName = {};
  for (const [name, entry] of Object.entries(files)) byName[name.toLowerCase()] = entry;
  const palette = db.palette;
  const stems = Object.entries(db.sprites).filter(([, info]) => info.mobd);
  for (let i = 0; i < stems.length; i++) {
    const [stem, info] = stems[i];
    const [offset, size] = byName[`${stem.toLowerCase()}.mobd`];
    const frames = parseMobd(data, offset, size);
    const variants = info.team ? [[stem, null], [`${stem}_red`, TEAM_REMAP]] : [[stem, null]];
    for (const [key, remap] of variants) {
      const atlas = pack(mobdImages(frames, palette, remap));
      atlas.json.meta.image = key;
      if (scene.textures.exists(key)) scene.textures.remove(key);
      scene.textures.addAtlasJSONHash(key, canvasFrom(atlas.width, atlas.height, atlas.rgba), atlas.json);
    }
    const points = {};
    frames.forEach((f, n) => {
      if (f.points.length) points[n] = f.points;
    });
    scene.cache.json.add(`pts_${stem}`, points);
    onProgress((i + 1) / stems.length);
    await new Promise((r) => setTimeout(r, 0));
  }
}
