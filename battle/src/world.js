/**
 * Battlefields: a screen-sized region cut out of one KKnD map.
 *
 * The region is as wide as the screen plus MARGIN cells on the left and right, where reinforcements
 * spawn and where units leave, out of sight. Where a map is smaller than the screen, the missing cells
 * are filled with that map's own ground (see extendEdges).
 */
import { Grid } from './grid.js';

export const MARGIN = 4; // off-screen cells on the left and right of the battlefield

/** Cut cells [x0, x0+w) x [y0, y0+h) out of a map (may extend past the map). */
export function cropWorld(map, x0, y0, w, h, fillTiles, groups, rng) {
  const T = map.tile;
  const tiles = new Array(w * h).fill(-1);
  const blocked = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const my = y0 + y;
    if (my < 0 || my >= map.height) continue;
    const row = map.grid[my];
    for (let x = 0; x < w; x++) {
      const mx = x0 + x;
      if (mx < 0 || mx >= map.width) continue;
      tiles[y * w + x] = map.tiles[my * map.width + mx];
      blocked[y * w + x] = row.charCodeAt(mx) === 49 ? 1 : 0;
    }
  }
  const dx = -x0 * T;
  const dy = -y0 * T;
  const decor = [];
  for (const d of map.decor) {
    const x = d.x + dx;
    const y = d.y + dy;
    // keep objects that may reach into the region (big buildings are up to ~350 px across)
    if (x < -360 || y < -360 || x > w * T + 360 || y > h * T + 360) continue;
    decor.push({ ...d, x: Math.round(x), y: Math.round(y), z: d.z < 0 ? d.z : d.z + dy, atlas: map.decorAtlas });
  }
  extendEdges(tiles, w, h, fillTiles, groups, rng);
  return {
    tile: T, width: w, height: h, tiles, blocked, decor, tileset: map.tileset,
    parts: [{ id: map.id, title: map.title, x: -x0, y: -y0, w: map.width, h: map.height }],
  };
}

/**
 * Choose where to cut a w x h battlefield out of a map: mostly open ground with some terrain and
 * objects for interest, and a route from one side to the other. Returns [x0, y0].
 */
export function pickRegion(map, w, h, rng) {
  const span = (size, total) => (total >= size ? [0, total - size] : [Math.floor((total - size) / 2), Math.floor((total - size) / 2)]);
  const [ax, bx] = span(w, map.width);
  const [ay, by] = span(h, map.height);
  const T = map.tile;
  const cands = [];
  for (let i = 0; i < 40; i++) {
    const x0 = ax + Math.floor(rng() * (bx - ax + 1));
    const y0 = ay + Math.floor(rng() * (by - ay + 1));
    let free = 0;
    let total = 0;
    for (let y = Math.max(0, y0); y < Math.min(map.height, y0 + h); y++) {
      const row = map.grid[y];
      for (let x = Math.max(0, x0); x < Math.min(map.width, x0 + w); x++) {
        total++;
        if (row.charCodeAt(x) !== 49) free++;
      }
    }
    const open = total ? free / total : 1;
    let objects = 0;
    for (const d of map.decor) {
      const cx = d.x / T - x0;
      const cy = d.y / T - y0;
      if (cx >= MARGIN && cx < w - MARGIN && cy >= 0 && cy < h) objects++;
    }
    // want mostly open ground (fighting room) but not a featureless desert
    let score = Math.min(open, 0.88) - Math.max(0, open - 0.97) * 2 + Math.min(objects, 25) * 0.008;
    if (open < 0.55) score -= 1;
    cands.push({ x0, y0, score });
  }
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands.slice(0, 12)) {
    if (connected(map, c.x0, c.y0, w, h)) return [c.x0, c.y0];
  }
  return [cands[0].x0, cands[0].y0];
}

/** Can units cross from the left edge to the right edge over most of the screen height? */
function connected(map, x0, y0, w, h) {
  const blocked = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const my = y0 + y;
    if (my < 0 || my >= map.height) continue;
    for (let x = 0; x < w; x++) {
      const mx = x0 + x;
      if (mx >= 0 && mx < map.width && map.grid[my].charCodeAt(mx) === 49) blocked[y * w + x] = 1;
    }
  }
  const g = new Grid({ tile: map.tile, width: w, height: h, blocked });
  const goal = [];
  for (let y = 0; y < h; y++) goal.push([w - 1, y]);
  const field = g.flowField(goal);
  let ok = 0;
  let open = 0;
  for (let y = 0; y < h; y++) {
    if (g.isBlockedCell(0, y)) continue;
    open++;
    if (Number.isFinite(field[y * w])) ok++;
  }
  return open >= h * 0.3 && ok >= open * 0.6;
}

/**
 * Fill cells outside the map. The map's edge ground grows a few cells outward (so a sandy edge
 * continues as sand), the rest is the tileset's common ground, and a majority-vote smoothing pass turns
 * the result into organic patches instead of straight seams or stripes.
 */
function extendEdges(tiles, width, height, fillTiles, groups, rng) {
  const groupOf = new Map();
  groups.forEach((g, i) => g.forEach((t) => groupOf.set(t, i)));
  const N = width * height;
  const isMap = new Uint8Array(N);
  const group = new Int16Array(N).fill(-1); // -1 = filler ground
  const dist = new Int16Array(N).fill(-1);
  let frontier = [];
  for (let i = 0; i < N; i++) {
    if (tiles[i] < 0) continue;
    isMap[i] = 1;
    group[i] = groupOf.has(tiles[i]) ? groupOf.get(tiles[i]) : -1;
    dist[i] = 0;
    frontier.push(i);
  }
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (frontier.length) {
    const next = [];
    for (const i of frontier) {
      const x = i % width;
      const y = (i - x) / width;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (dist[j] >= 0) continue;
        dist[j] = dist[i] + 1;
        group[j] = group[i];
        next.push(j);
      }
    }
    frontier = next;
  }
  // edge ground only reaches a ragged few cells out; beyond that, common ground
  for (let i = 0; i < N; i++) if (!isMap[i] && dist[i] > 2 + Math.floor(rng() * 5)) group[i] = -1;

  // majority smoothing over corridor cells (map cells are fixed but vote)
  for (let pass = 0; pass < 4; pass++) {
    const out = group.slice();
    const counts = new Map();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (isMap[i]) continue;
        counts.clear();
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const g = group[ny * width + nx];
            counts.set(g, (counts.get(g) || 0) + 1);
          }
        }
        let best = group[i];
        let bestN = -1;
        for (const [g, n] of counts) if (n > bestN || (n === bestN && rng() < 0.5)) [best, bestN] = [g, n];
        out[i] = best;
      }
    }
    group.set(out);
  }

  const pick = (list) => list[Math.floor(rng() * list.length)];
  for (let i = 0; i < N; i++) {
    if (isMap[i]) continue;
    tiles[i] = group[i] >= 0 ? pick(groups[group[i]]) : pick(fillTiles);
  }
}
