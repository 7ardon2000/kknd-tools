/**
 * Where the fighting is: used to start the camera of a new world on a big fight.
 * Explosions and deaths add decaying heat; units count by how busy they are.
 */
export class Hotspots {
  constructor(scene) {
    this.s = scene;
    this.heat = []; // {x, y, w, t}
  }

  /** Something loud happened here (explosions, deaths). */
  note(x, y, w = 1) {
    this.heat.push({ x, y, w, t: 6000 });
    if (this.heat.length > 300) this.heat.shift();
  }

  tick(dt) {
    if (!this.heat.length) return;
    let w = 0;
    for (const h of this.heat) {
      h.t -= dt;
      if (h.t > 0) this.heat[w++] = h;
    }
    this.heat.length = w;
  }

  clear() {
    this.heat.length = 0;
  }

  /** Best place to look at, as [x, y, score], scored over a window about a third of the screen. */
  best() {
    const cam = this.s.cameras.main;
    const r = (Math.min(cam.width, cam.height) / cam.zoom) * 0.38;
    const pts = [];
    for (const u of this.s.units) pts.push([u.x, u.y, u.target ? (u.inRange(u.target) ? 1 : 0.4) : 0.04]);
    for (const h of this.heat) pts.push([h.x, h.y, 0.3 * h.w * (h.t / 6000)]);
    let best = null;
    const cands = pts.filter((p, i) => p[2] >= 0.5 || i % 6 === 0);
    for (const c of cands) {
      let w = 0;
      let x = 0;
      let y = 0;
      for (const p of pts) {
        if (Math.abs(p[0] - c[0]) > r || Math.abs(p[1] - c[1]) > r) continue;
        w += p[2];
        x += p[0] * p[2];
        y += p[1] * p[2];
      }
      if (w > 0 && (!best || w > best[2])) best = [x / w, y / w, w];
    }
    return best;
  }
}
