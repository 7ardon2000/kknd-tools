/**
 * KKnD MOBD sprite decoder: a port of tools/mobd.py, itself a port of OpenKrush's reader.
 * Pointers inside a MOBD are absolute offsets into the SPRITES.LVL data block, so a MOBD is parsed
 * in place inside that block.
 *
 * parseMobd(data, offset, size) -> flat frame list (rotational animations first, then simple ones),
 * each frame { ox, oy, w, h, pixels: Uint8Array (palette indices), points: [[id, x, y], ...], key }.
 */

// OpenRA needs equal frame counts per facing, so OpenKrush duplicates a frame in a few animations
// that are one or two frames short. Keyed by absolute LVL offset.
const MISSING_FRAME_WORKAROUND = new Map([[174278, 2], [2010426, 1], [2010466, 1], [2094122, 1]]);

class View {
  constructor(data, start, end) {
    this.d = data;
    this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.start = start;
    this.end = end;
  }

  ok(p, n = 1) {
    return p >= this.start && p + n <= this.end;
  }

  check(p, n) {
    if (!this.ok(p, n)) throw new Error(`read out of range at ${p}`);
  }

  i32(p) {
    this.check(p, 4);
    return this.dv.getInt32(p, true);
  }

  u32(p) {
    this.check(p, 4);
    return this.dv.getUint32(p, true);
  }

  u16(p) {
    this.check(p, 2);
    return this.dv.getUint16(p, true);
  }

  u8(p) {
    this.check(p, 1);
    return this.d[p];
  }
}

function decompressGen1(v, pos, w, h) {
  const out = new Uint8Array(w * h);
  let o = 0;
  while (o < out.length) {
    const size = v.u8(pos) - 1;
    pos += 1;
    const lineEnd = pos + size;
    let skip = true;
    while (pos < lineEnd) {
      const n = v.u8(pos);
      pos += 1;
      if (skip) {
        o += n;
      } else {
        v.check(pos, n);
        out.set(v.d.subarray(pos, pos + n), o);
        o += n;
        pos += n;
      }
      skip = !skip;
    }
    o += (w - (o % w)) % w;
  }
  return out;
}

function decompressGen2(v, pos, w, h, has256) {
  const out = new Uint8Array(w * h);
  let o = 0;
  const put = (b) => {
    if (o < out.length) out[o] = b;
    o++;
  };
  while (o < out.length) {
    let size;
    if (has256) {
      size = v.u16(pos);
      pos += 2;
    } else {
      size = v.u8(pos);
      pos += 1;
    }
    if (size === 0) {
      o += w;
    } else if (!has256 && size > 0x80) {
      for (let i = 0; i < size - 0x80; i++) {
        const two = v.u8(pos++);
        put(two >> 4);
        if (o % w !== 0) put(two & 0xf);
      }
    } else {
      const lineEnd = pos + size;
      while (pos < lineEnd) {
        const n = v.u8(pos++);
        if (n < 0x80) {
          o += n;
        } else {
          const count = n - 0x80;
          if (has256) {
            for (let i = 0; i < count; i++) put(v.u8(pos++));
          } else {
            const nbytes = (count >> 1) + (count & 1);
            for (let j = 0; j < nbytes; j++) {
              const two = v.u8(pos++);
              put(two >> 4);
              if (j + 1 < nbytes || count % 2 === 0) put(two & 0xf);
            }
          }
        }
      }
    }
    o += (w - (o % w)) % w;
  }
  return out;
}

function readImage(v, pos, f) {
  const kind = String.fromCharCode(v.u8(pos + 3), v.u8(pos + 2), v.u8(pos + 1), v.u8(pos));
  const flags = v.u32(pos + 4);
  pos += 8;
  let gen;
  if (kind === 'SPRT') gen = 1;
  else if (kind === 'SPNS' || kind === 'SPRC') gen = 2;
  else throw new Error(`unknown render type ${kind}`);
  if (gen === 2) pos += 4; // embedded palette offset (KKnD 2 only; KKnD 1 uses the external palette)

  const img = v.u32(pos);
  const w = v.i32(img);
  const h = v.i32(img + 4);
  if (!(w > 0 && w < 1024 && h > 0 && h < 1024)) throw new Error(`bad image size ${w}x${h}`);
  let p = img + 8;
  let pixels;
  let flipped;
  if (gen === 1) {
    flipped = flags & 1;
    const compressed = v.u8(p) === 2;
    p += 1;
    if (compressed) pixels = decompressGen1(v, p, w, h);
    else {
      v.check(p, w * h);
      pixels = v.d.slice(p, p + w * h);
    }
  } else {
    flipped = (flags >>> 31) & 1;
    const compressed = (flags >>> 27) & 1;
    const has256 = (flags >>> 26) & 1;
    if (compressed) pixels = decompressGen2(v, p, w, h, has256);
    else {
      v.check(p, w * h);
      pixels = v.d.slice(p, p + w * h);
    }
  }
  f.key = img;
  if (flipped) {
    for (let r = 0; r < h; r++) pixels.subarray(r * w, (r + 1) * w).reverse();
    f.key = -img;
  }
  f.w = w;
  f.h = h;
  f.pixels = pixels;
}

function readFrame(v, pos) {
  // origin is signed: effects such as muzzle flashes anchor outside their image
  const f = { ox: v.i32(pos), oy: v.i32(pos + 4), points: [] };
  const renderOff = v.u32(pos + 12);
  const pointOff = v.u32(pos + 24);
  if (Math.abs(f.ox) > 4096 || Math.abs(f.oy) > 4096) throw new Error('bad origin');
  if (pointOff) {
    let p = pointOff;
    let n = 0;
    while (v.u32(p) !== 0xffffffff) {
      // id, x (24.8 fixed point), y (24.8 fixed point), z (unused)
      f.points.push([v.i32(p), v.i32(p + 4) >> 8, v.i32(p + 8) >> 8]);
      p += 16;
      if (++n > 64) throw new Error('unterminated point list');
    }
  }
  readImage(v, renderOff, f);
  return f;
}

function readAnimation(v, pos, cache) {
  const frames = [];
  let missing = MISSING_FRAME_WORKAROUND.get(pos) || 0;
  pos += 4; // unknown (likely the animation speed)
  for (let n = 0; n < 512; n++) {
    const value = v.i32(pos);
    pos += 4;
    if (value === 0 || value === -1) return frames;
    let fr = cache.get(value);
    if (!fr) cache.set(value, (fr = readFrame(v, value)));
    frames.push(fr);
    if (missing > 0) {
      missing--;
      frames.push(fr);
    }
  }
  throw new Error('unterminated animation');
}

export function parseMobd(data, offset, size) {
  const v = new View(data, offset, offset + size);
  const cache = new Map();
  let firstFrame = v.end;
  const animOffsets = [];
  let pos = offset;
  while (pos < firstFrame) {
    let value = v.i32(pos);
    pos += 4;
    if (value === 0 || (value >= offset && value < pos)) {
      pos -= 4;
      break;
    }
    animOffsets.push(pos - 4);
    for (;;) {
      value = v.i32(pos);
      pos += 4;
      if (value === -1 || value === 0) break;
      if (!v.ok(value, 28)) throw new Error('frame pointer outside file');
      firstFrame = Math.min(firstFrame, value);
    }
  }
  const frames = [];
  while (pos < firstFrame) {
    const value = v.u32(pos);
    pos += 4;
    if (value === 0) continue;
    const k = animOffsets.indexOf(value);
    if (k >= 0) animOffsets.splice(k, 1);
    frames.push(...readAnimation(v, value, cache));
  }
  for (const off of animOffsets) frames.push(...readAnimation(v, off, cache));
  return frames;
}
