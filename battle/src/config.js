/**
 * Runtime options, overridable via URL query string, e.g.
 *   index.html?map=desertstorm&zoom=2&units=16&teams=survivors,evolved&rotate=10&debug=1
 */
const params = new URLSearchParams(window.location.search);

function num(name, def) {
  const v = params.get(name);
  return v === null || v === '' || Number.isNaN(Number(v)) ? def : Number(v);
}
function str(name, def) {
  const v = params.get(name);
  return v === null || v === '' ? def : v;
}

export const CONFIG = {
  /** Map id to put in the middle of the world (see assets/units.json "maps"), or 'random'. */
  map: str('map', 'random'),
  /** World size in maps (columns x rows) stitched together, e.g. 3x2. */
  world: str('world', '3x2'),
  /** Camera panning speed in world pixels per second. */
  pan: num('pan', 22),
  /** Map categories used when map=random: 'classic', 'multiplayer' or 'all'. */
  maps: str('maps', 'all'),
  /** Integer pixel zoom; 0 = automatic (1x up to 1440p, 2x on 4K). */
  zoom: num('zoom', 0),
  /** Base max units alive per team; 0 = automatic from world size. */
  units: num('units', 0),
  /** Comma-separated faction for each team: survivors | evolved | mixed. */
  teams: str('teams', 'survivors,evolved').split(','),
  /** Minutes between switching to another map / location (0 = never). */
  rotate: num('rotate', 12),
  /** Average minutes between airstrikes (bomber / wasp), 0 = off. */
  airstrike: num('airstrike', 2),
  /** Seconds between reinforcement waves (average). */
  waveInterval: num('wave', 8),
  /** Damage multiplier: >1 makes fights shorter and bloodier. */
  lethality: num('lethality', 0.9),
  /** Game speed multiplier. */
  speed: num('speed', 1),
  /** Frame-rate cap (lower = less CPU for a wallpaper). */
  fps: num('fps', 60),
  /** Allow vehicles (0 = infantry only). */
  vehicles: num('vehicles', 1),
  /** Seconds before corpses / craters fade out. */
  corpseTime: num('corpses', 25),
  /** Random seed (0 = random). */
  seed: num('seed', 0),
  /** Update off-screen units at a reduced rate (1) or every frame (0). */
  lod: num('lod', 1),
  /** Debug overlay: blocked cells, HP bars, stats. */
  debug: num('debug', 0),
  /** Restrict a team to units whose id contains one of these comma-separated words (testing). */
  roster: [str('roster0', ''), str('roster1', '')].map((s) => s.split(',').filter(Boolean)),
};
