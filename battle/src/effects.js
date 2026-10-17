import { CONFIG } from './config.js';

const OFFSCREEN_FX_MARGIN = 160;
import { dirFromVector, fname, frameIndex } from './sprites.js';

/** Depth bands. Units/decor use their ground y as depth; these sit relative to that. */
export const DEPTH = {
  ground: -100000, // craters, oil
  corpse: -50000,
  air: 1000000, // projectiles, flying debris
  top: 2000000,
};

/**
 * Lightweight animated sprites that are not units: muzzle flashes, impacts, explosions,
 * corpses, craters, projectiles and debris.
 */
export class Effects {
  constructor(scene, db, bank, rng) {
    this.scene = scene;
    this.db = db;
    this.bank = bank;
    this.rng = rng;
    this.items = [];
    this.decals = [];
  }

  effectSeq(name) {
    const e = this.db.effects[name];
    return e ? { sprite: e.sprite, start: e.start, length: e.length, stride: e.length, facings: 1, tick: e.tick } : null;
  }

  /**
   * Play a sequence once at a position.
   * opts: dir (16-facing), depth, follow(fn -> [x,y]) for attached effects, hold (ms to keep last frame),
   *       fade (ms), red (team texture), loops
   */
  play(seq, x, y, opts = {}) {
    if (typeof seq === 'string') seq = this.effectSeq(seq);
    if (!seq) return null;
    // nobody sees short-lived effects off-screen: do not create them at all (corpses are kept, the
    // camera may pan to them later)
    if (!opts.hold && !opts.force && !this.scene.inView(x, y, OFFSCREEN_FX_MARGIN)) return null;
    const key = this.bank.textureKey(seq.sprite, opts.red);
    const dir = opts.dir ?? 0;
    // things that stay put (corpses) sit on whole pixels so they do not jiggle while the camera pans
    if (opts.hold) {
      x = Math.round(x);
      y = Math.round(y);
    }
    const spr = this.scene.add.sprite(x, y, key, fname(frameIndex(seq, dir, 0)));
    spr.setDepth(opts.depth ?? y);
    const item = { spr, seq, dir, t: 0, follow: opts.follow, hold: opts.hold ?? 0, fade: opts.fade ?? 0, loops: opts.loops ?? 1, done: false };
    this.items.push(item);
    return item;
  }

  /** A ground decal that stays for a while (craters, scorch). */
  decal(name, x, y) {
    const seq = this.effectSeq(name);
    if (!seq) return;
    x = Math.round(x);
    y = Math.round(y);
    const spr = this.scene.add.sprite(x, y, seq.sprite, fname(seq.start)).setDepth(DEPTH.ground + y);
    this.decals.push({ spr, life: CONFIG.corpseTime * 2000 });
    while (this.decals.length > 80) this.decals.shift().spr.destroy();
  }

  /** Shrapnel / blood piece flying in an arc and playing its animation. */
  debris(name, x, y, dist, height, durationMs, opts = {}) {
    const seq = this.effectSeq(name);
    if (!seq) return;
    const ang = this.rng() * Math.PI * 2;
    const item = this.play(seq, x, y, { depth: DEPTH.air, loops: Math.ceil(durationMs / (seq.tick * seq.length)) });
    if (!item) return;
    item.flight = { x0: x, y0: y, x1: x + Math.cos(ang) * dist, y1: y + Math.sin(ang) * dist * 0.7, h: height, dur: durationMs };
    item.onEnd = opts.onEnd;
  }

  /** Spawn a projectile. `onHit(x, y)` is called on arrival. */
  projectile(proj, red, x0, y0, x1, y1, onHit) {
    const seq = proj.seq;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const dur = Math.max(80, (dist / proj.speed) * 1000);
    // off-screen shots: no sprite, but the hit still lands when the projectile would have arrived
    const seen = this.scene.inView(x0, y0, OFFSCREEN_FX_MARGIN) || this.scene.inView(x1, y1, OFFSCREEN_FX_MARGIN);
    if (!seen) {
      this.scene.time.delayedCall(dur, () => onHit(x1, y1));
      return;
    }
    const dir = seq.facings > 1 ? dirFromVector(x1 - x0, y1 - y0) : 0;
    const item = this.play(seq, x0, y0, { dir, depth: DEPTH.air, red: red && proj.team, loops: Infinity, force: true });
    if (!item) {
      this.scene.time.delayedCall(dur, () => onHit(x1, y1));
      return;
    }
    item.flight = { x0, y0, x1, y1, h: proj.arc ? Math.min(60, dist * 0.3) : 0, dur, straightDir: seq.facings > 1 };
    item.trail = proj.trail;
    item.trailT = 0;
    item.onEnd = () => onHit(x1, y1);
    item.killOnLand = true;
  }

  update(dtMs) {
    // compact the list in place (no per-frame array allocation)
    const items = this.items;
    let w = 0;
    for (let r = 0; r < items.length; r++) {
      const it = items[r];
      if (it.done) continue;
      it.t += dtMs;
      const seq = it.seq;
      const step = Math.floor(it.t / seq.tick);
      const total = seq.length * it.loops;

      if (it.flight) {
        const f = it.flight;
        const p = Math.min(1, it.t / f.dur);
        const x = f.x0 + (f.x1 - f.x0) * p;
        const yGround = f.y0 + (f.y1 - f.y0) * p;
        const lift = 4 * f.h * p * (1 - p);
        it.spr.setPosition(x, yGround - lift);
        if (f.straightDir && f.h > 0) {
          // arcing projectiles keep their ground heading; facing already set at launch
        }
        if (it.trail) {
          it.trailT += dtMs;
          if (it.trailT > 70) {
            it.trailT = 0;
            this.play(it.trail, x, yGround - lift, { depth: DEPTH.air - 1 });
          }
        }
        if (p >= 1) {
          it.onEnd?.();
          it.onEnd = null;
          if (it.killOnLand || it.loops !== Infinity) {
            it.spr.destroy();
            it.done = true;
            continue;
          }
        }
      } else if (it.follow) {
        const pos = it.follow();
        if (pos) it.spr.setPosition(pos[0], pos[1]);
      }

      const visible = this.scene.inView(it.spr.x, it.spr.y, 96);
      if (it.spr.visible !== visible) it.spr.setVisible(visible);
      if (step < total) {
        // off-screen animations do not need their frame updated
        if (visible) it.spr.setFrame(fname(frameIndex(seq, it.dir, step % seq.length)));
      } else if (it.t < total * seq.tick + it.hold) {
        // hold the last frame (corpses); make sure it is set even if the animation ran off-screen
        if (!it.held) {
          it.held = true;
          it.spr.setFrame(fname(frameIndex(seq, it.dir, seq.length - 1)));
        }
      } else if (it.fade && it.t < total * seq.tick + it.hold + it.fade) {
        it.spr.setAlpha(1 - (it.t - total * seq.tick - it.hold) / it.fade);
      } else if (!it.flight) {
        it.onEnd?.();
        it.spr.destroy();
        it.done = true;
        continue;
      }
      items[w++] = it;
    }
    items.length = w;

    const decals = this.decals;
    w = 0;
    for (let r = 0; r < decals.length; r++) {
      const d = decals[r];
      d.life -= dtMs;
      if (d.life <= 0) {
        d.spr.destroy();
        continue;
      }
      if (d.life < 3000) d.spr.setAlpha(d.life / 3000);
      decals[w++] = d;
    }
    decals.length = w;
  }

  clear() {
    for (const it of this.items) it.spr.destroy();
    for (const d of this.decals) d.spr.destroy();
    this.items = [];
    this.decals = [];
  }
}
