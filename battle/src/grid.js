/** Map passability grid, line of sight and flow fields (cell = 32 px). */

export class Grid {
  /** world: { tile, width, height, blocked: Uint8Array } (see world.js) */
  constructor(world) {
    this.tile = world.tile;
    this.w = world.width;
    this.h = world.height;
    this.blocked = world.blocked;
  }

  cellOf(px, py) {
    return [Math.floor(px / this.tile), Math.floor(py / this.tile)];
  }

  isBlockedCell(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return true;
    return this.blocked[cy * this.w + cx] === 1;
  }

  isBlockedAt(px, py) {
    return this.isBlockedCell(Math.floor(px / this.tile), Math.floor(py / this.tile));
  }

  /** True if the straight segment between two points crosses no blocked cell. */
  lineOfSight(x0, y0, x1, y1) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(dist / (this.tile / 3));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isBlockedAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  /**
   * Dijkstra over the cell grid (8-connected, no corner cutting) from the goal cells, using a
   * bucket queue with integer costs (10 straight, 14 diagonal). Distances are returned in cells.
   */
  flowField(goalCells) {
    const { w, h } = this;
    const INF = 0x7fffffff;
    const dist = new Int32Array(w * h).fill(INF);
    const buckets = [[]];
    for (const [x, y] of goalCells) {
      if (this.isBlockedCell(x, y)) continue;
      dist[y * w + x] = 0;
      buckets[0].push(y * w + x);
    }
    const dirs = [[1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14]];
    for (let d = 0; d < buckets.length; d++) {
      const bucket = buckets[d];
      if (!bucket) continue;
      for (let k = 0; k < bucket.length; k++) {
        const i = bucket[k];
        if (dist[i] !== d) continue;
        const x = i % w;
        const y = (i - x) / w;
        for (const [dx, dy, c] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          if (this.isBlockedCell(nx, ny)) continue;
          if (dx && dy && (this.isBlockedCell(x + dx, y) || this.isBlockedCell(x, y + dy))) continue;
          const j = ny * w + nx;
          const nd = d + c;
          if (nd < dist[j]) {
            dist[j] = nd;
            (buckets[nd] ||= []).push(j);
          }
        }
      }
      buckets[d] = null;
    }
    const out = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = dist[i] === INF ? Infinity : dist[i] / 10;
    return out;
  }

  /** Direction (unit vector, written into `out`) of steepest descent of a flow field at a world position. */
  flowDir(field, px, py, out) {
    const [cx, cy] = this.cellOf(px, py);
    const here = this.isBlockedCell(cx, cy) ? Infinity : field[cy * this.w + cx];
    let best = here;
    let bx = 0;
    let by = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (this.isBlockedCell(nx, ny)) continue;
        if (dx && dy && (this.isBlockedCell(cx + dx, cy) || this.isBlockedCell(cx, cy + dy))) continue;
        const d = field[ny * this.w + nx];
        if (d < best) {
          best = d;
          bx = dx;
          by = dy;
        }
      }
    }
    if (!bx && !by) return null;
    // aim for the centre of the chosen neighbour cell so units do not hug walls
    const tx = (cx + bx + 0.5) * this.tile - px;
    const ty = (cy + by + 0.5) * this.tile - py;
    const len = Math.hypot(tx, ty) || 1;
    out[0] = tx / len;
    out[1] = ty / len;
    return out;
  }
}
