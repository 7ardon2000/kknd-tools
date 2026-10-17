/**
 * Turn decoded MOBD frames into a Phaser texture atlas: a port of tools/atlas.py (to_rgba + pack).
 *
 * Phaser places a trimmed frame inside its sourceSize; every frame's sourceSize is a square of side
 * 2R centred on the frame's whole-pixel pivot, so `setOrigin(0.5)` puts the pivot exactly on the
 * sprite position (a half-pixel pivot makes sprites jiggle against the ground).
 */

export const SHADOW_INDEX = 177; // near-black palette entry used for drop shadows
const SHADOW_ALPHA = 110;
export const TEAM_REMAP = { 8: 24, 9: 25, 10: 26, 11: 27, 12: 28, 13: 29 }; // blue ramp -> red ramp

/** Shadow pixels connected to the transparent background (interior dark details stay opaque). */
function outerShadowMask(w, h, px) {
  const mask = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h * 4 + 2 * (w + h) + 8);
  let head = 0;
  let tail = 0;
  for (let x = 0; x < w; x++) {
    queue[tail++] = x;
    queue[tail++] = (h - 1) * w + x;
  }
  for (let y = 0; y < h; y++) {
    queue[tail++] = y * w;
    queue[tail++] = y * w + w - 1;
  }
  while (head < tail) {
    const i = queue[head++];
    if (seen[i]) continue;
    seen[i] = 1;
    const v = px[i];
    if (v !== 0 && v !== SHADOW_INDEX) continue;
    if (v === SHADOW_INDEX) mask[i] = 1;
    const x = i % w;
    if (x > 0 && !seen[i - 1]) queue[tail++] = i - 1;
    if (x < w - 1 && !seen[i + 1]) queue[tail++] = i + 1;
    if (i >= w && !seen[i - w]) queue[tail++] = i - w;
    if (i + w < w * h && !seen[i + w]) queue[tail++] = i + w;
  }
  return mask;
}

/** Palette indices -> RGBA bytes. palette: flat [r, g, b, r, g, b, ...] (256 entries). */
export function toRGBA(w, h, pixels, palette, remap = null) {
  const mask = outerShadowMask(w, h, pixels);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < pixels.length; i++) {
    let v = pixels[i];
    if (v === 0) continue;
    const o = i * 4;
    if (mask[i]) {
      out[o + 3] = SHADOW_ALPHA;
      continue;
    }
    if (remap && remap[v] !== undefined) v = remap[v];
    out[o] = palette[v * 3];
    out[o + 1] = palette[v * 3 + 1];
    out[o + 2] = palette[v * 3 + 2];
    out[o + 3] = 255;
  }
  return out;
}

/** Crop to the opaque bounding box: { w, h, rgba, tx, ty }. */
function trim(w, h, rgba) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { w: 1, h: 1, rgba: new Uint8ClampedArray(4), tx: 0, ty: 0 };
  const tw = x1 - x0 + 1;
  const th = y1 - y0 + 1;
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) out.set(rgba.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x1 + 1) * 4), y * tw * 4);
  return { w: tw, h: th, rgba: out, tx: x0, ty: y0 };
}

function hashBytes(a, w, h) {
  let x = (2166136261 ^ w ^ (h << 16)) >>> 0;
  for (let i = 0; i < a.length; i++) x = Math.imul(x ^ a[i], 16777619);
  return `${w}x${h}:${x >>> 0}`;
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const pow2 = (n) => {
  let p = 1;
  while (p < n) p *= 2;
  return p;
};

/**
 * images: [{ name, w, h, rgba, ox, oy }] where (ox, oy) is the pivot inside the image.
 * Returns { width, height, rgba (atlas pixels), json (Phaser JSON hash) }.
 */
export function pack(images, pad = 4) {
  const uniq = []; // { w, h, rgba }
  const byHash = new Map();
  const entries = [];
  for (const im of images) {
    const ox = Math.floor(im.ox);
    const oy = Math.floor(im.oy);
    const t = trim(im.w, im.h, im.rgba);
    const hk = hashBytes(t.rgba, t.w, t.h);
    let list = byHash.get(hk);
    if (!list) byHash.set(hk, (list = []));
    let u = list.find((c) => sameBytes(c.rgba, t.rgba));
    if (!u) {
      u = { w: t.w, h: t.h, rgba: t.rgba };
      list.push(u);
      uniq.push(u);
    }
    entries.push({ name: im.name, u, px: ox - t.tx, py: oy - t.ty });
  }

  // radius: largest pivot-to-edge distance over all frames, so every frame shares one sourceSize
  let R = 1;
  for (const { u, px, py } of entries) R = Math.max(R, Math.abs(px), Math.abs(py), Math.abs(u.w - px), Math.abs(u.h - py));
  R = Math.ceil(R);

  const order = uniq.slice().sort((a, b) => b.h - a.h || b.w - a.w);
  const shelf = (maxW) => {
    const pos = new Map();
    let x = pad;
    let y = pad;
    let shelfH = 0;
    let width = 0;
    for (const u of order) {
      if (x + u.w + pad > maxW && x > pad) {
        x = pad;
        y += shelfH + pad;
        shelfH = 0;
      }
      pos.set(u, [x, y]);
      x += u.w + pad;
      shelfH = Math.max(shelfH, u.h);
      width = Math.max(width, x);
    }
    return { pos, width, height: y + shelfH + pad };
  };

  // try several widths and keep the smallest power-of-two texture (less GPU memory)
  let best = null;
  for (const maxW of [128, 256, 512, 1024, 2048]) {
    if (uniq.some((u) => u.w + 2 * pad > maxW)) continue;
    const s = shelf(maxW);
    if (pow2(s.height) > 4096) continue;
    const area = pow2(Math.max(s.width, 1)) * pow2(Math.max(s.height, 1));
    if (!best || area < best.area) best = { ...s, area };
  }
  if (!best) best = shelf(2048);

  const width = pow2(Math.max(best.width, 1));
  const height = pow2(Math.max(best.height, 1));
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (const u of uniq) {
    const [ax, ay] = best.pos.get(u);
    for (let y = 0; y < u.h; y++) rgba.set(u.rgba.subarray(y * u.w * 4, (y + 1) * u.w * 4), ((ay + y) * width + ax) * 4);
  }

  const frames = {};
  for (const { name, u, px, py } of entries) {
    const [ax, ay] = best.pos.get(u);
    frames[name] = {
      frame: { x: ax, y: ay, w: u.w, h: u.h },
      rotated: false,
      trimmed: true,
      spriteSourceSize: { x: R - px, y: R - py, w: u.w, h: u.h },
      sourceSize: { w: 2 * R, h: 2 * R },
    };
  }
  return { width, height, rgba, json: { frames, meta: { image: '', size: { w: width, h: height }, scale: '1' } } };
}

/** All frames of one MOBD as atlas input; frames sharing an image are converted once. */
export function mobdImages(frames, palette, remap = null) {
  const cache = new Map();
  return frames.map((f, i) => {
    let rgba = cache.get(f.key);
    if (!rgba) cache.set(f.key, (rgba = toRGBA(f.w, f.h, f.pixels, palette, remap)));
    return { name: String(i), w: f.w, h: f.h, rgba, ox: f.ox, oy: f.oy };
  });
}
