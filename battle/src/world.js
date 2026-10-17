/**
 * Stitch several maps of one tileset into a single large battlefield.
 *
 * Maps are laid out on a cols x rows grid. Every map is surrounded by a corridor of plain ground
 * (the tileset's commonest ground tile), so there is always a way around a map, while the cliffs,
 * water and buildings inside each map split the battle into several routes and fronts.
 */
export const CORRIDOR = 3; // cells of plain ground around and between maps

export function composeWorld(maps, cols, rows, fillTiles, groups, rng) {
  const T = maps[0].tile;
  const colW = new Array(cols).fill(0);
  const rowH = new Array(rows).fill(0);
  maps.forEach((m, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    colW[c] = Math.max(colW[c], m.width);
    rowH[r] = Math.max(rowH[r], m.height);
  });
  const width = colW.reduce((a, b) => a + b, 0) + CORRIDOR * (cols + 1);
  const height = rowH.reduce((a, b) => a + b, 0) + CORRIDOR * (rows + 1);

  const tiles = new Array(width * height).fill(-1);
  const blocked = new Uint8Array(width * height);
  const decor = [];
  const parts = [];

  maps.forEach((m, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    let ox = CORRIDOR;
    for (let k = 0; k < c; k++) ox += colW[k] + CORRIDOR;
    let oy = CORRIDOR;
    for (let k = 0; k < r; k++) oy += rowH[k] + CORRIDOR;
    // centre smaller maps inside their slot
    ox += Math.floor((colW[c] - m.width) / 2);
    oy += Math.floor((rowH[r] - m.height) / 2);

    for (let y = 0; y < m.height; y++) {
      const row = m.grid[y];
      for (let x = 0; x < m.width; x++) {
        const j = (oy + y) * width + ox + x;
        tiles[j] = m.tiles[y * m.width + x];
        blocked[j] = row.charCodeAt(x) === 49 ? 1 : 0;
      }
    }
    const dx = ox * T;
    const dy = oy * T;
    for (const d of m.decor) {
      // whole pixels: fractional positions round differently from frame to frame while panning
      decor.push({ ...d, x: Math.round(d.x + dx), y: Math.round(d.y + dy), z: d.z < 0 ? d.z : d.z + dy, atlas: m.decorAtlas });
    }
    parts.push({ id: m.id, title: m.title, x: ox, y: oy, w: m.width, h: m.height });
  });

  extendEdges(tiles, width, height, fillTiles, groups, rng);
  return { tile: T, width, height, tiles, blocked, decor, parts, tileset: maps[0].tileset };
}

/**
 * Fill the corridors. Each map's edge ground grows a few cells outward (so a sandy edge continues as
 * sand), the rest is the tileset's common ground, and a majority-vote smoothing pass turns the result
 * into organic patches instead of straight seams or stripes.
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
