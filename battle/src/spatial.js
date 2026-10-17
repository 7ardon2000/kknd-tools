/**
 * Uniform grid bucketing of units for cheap neighbour / target queries, rebuilt every frame.
 * Buckets and the result array are reused, so steady-state frames allocate nothing here.
 */
export class SpatialHash {
  constructor(cell = 64) {
    this.cell = cell;
    this.map = new Map();
    this.used = [];
    this.out = [];
  }

  /** Forget all buckets (new world). */
  reset() {
    this.map.clear();
    this.used.length = 0;
  }

  rebuild(units) {
    for (const b of this.used) b.length = 0;
    this.used.length = 0;
    const c = this.cell;
    for (const u of units) {
      if (!u.alive) continue;
      const k = Math.floor(u.x / c) * 65536 + Math.floor(u.y / c);
      let b = this.map.get(k);
      if (!b) this.map.set(k, (b = []));
      if (b.length === 0) this.used.push(b);
      b.push(u);
    }
  }

  /**
   * Units in cells overlapping the circle (caller checks exact distance). Returns a shared array
   * that the next near() call overwrites: do not nest calls while iterating.
   */
  near(x, y, r) {
    const out = this.out;
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c);
    const x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c);
    const y1 = Math.floor((y + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const b = this.map.get(cx * 65536 + cy);
        if (b) for (let i = 0; i < b.length; i++) out.push(b[i]);
      }
    }
    return out;
  }

  /** Callback form for code that is not per-frame hot (safe to nest). */
  query(x, y, r, fn) {
    const list = this.near(x, y, r).slice();
    for (const u of list) fn(u);
  }
}
