/** Helpers for MOBD-derived sequences: facings, frame indices and embedded points. */

export const FACINGS = 16;

const NAMES = [];
/** Atlas frame names are the frame indices as strings; cache them so frames allocate nothing. */
export function fname(n) {
  return NAMES[n] || (NAMES[n] = String(n));
}

/** Facing index (0 = north, clockwise) for a direction vector in screen space. */
export function dirFromVector(dx, dy, facings = FACINGS) {
  const a = Math.atan2(dx, -dy); // 0 = up, clockwise positive
  const step = (Math.PI * 2) / facings;
  return ((Math.round(a / step) % facings) + facings) % facings;
}

/** Continuous facing (0..16) for a vector; used for smooth vehicle turning. */
export function facingFromVector(dx, dy) {
  const a = Math.atan2(dx, -dy);
  return ((a / (Math.PI * 2)) * FACINGS + FACINGS) % FACINGS;
}

/** Shortest signed difference between two continuous facings. */
export function facingDelta(from, to) {
  let d = (to - from) % FACINGS;
  if (d > FACINGS / 2) d -= FACINGS;
  if (d < -FACINGS / 2) d += FACINGS;
  return d;
}

/** Global MOBD frame index of `seq` for a 16-facing direction and animation step. */
export function frameIndex(seq, dir16, step = 0) {
  const facings = seq.facings || 1;
  const d = facings > 1 ? Math.round((dir16 * facings) / FACINGS) % facings : 0;
  const stride = seq.stride ?? seq.length;
  return seq.start + d * stride + (step % seq.length);
}

export class SpriteBank {
  constructor(scene, db) {
    this.scene = scene;
    this.db = db;
    this.keys = {};
    this.points = {};
  }

  textureKey(stem, red) {
    let k = this.keys[stem];
    if (!k) k = this.keys[stem] = [stem, this.db.sprites[stem]?.team ? `${stem}_red` : stem];
    return red ? k[1] : k[0];
  }

  /**
   * Embedded MOBD point with the given id (default 0) for a frame, as [id, x, y] with x/y relative
   * to the pivot (the stored array itself: do not modify).
   */
  point(stem, frame, id = 0) {
    let table = this.points[stem];
    if (!table) {
      table = this.points[stem] = [];
      const json = this.scene.cache.json.get(`pts_${stem}`) || {};
      for (const [k, list] of Object.entries(json)) table[+k] = list;
    }
    const list = table[frame];
    if (!list) return null;
    for (let i = 0; i < list.length; i++) if (list[i][0] === id) return list[i];
    return null;
  }

  /** Size of a frame's trimmed image (for hit radius estimates). */
  frameSize(stem, frame) {
    const tex = this.scene.textures.get(stem);
    const f = tex.get(String(frame));
    return f ? [f.cutWidth, f.cutHeight] : [16, 16];
  }
}
