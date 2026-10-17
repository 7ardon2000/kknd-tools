/**
 * Soft terrain seams.
 *
 * KKnD ground is a grid of 32 px tiles. Where two tiles meet that do not belong together (stitched
 * map borders, maps cut through a feature, blocky sand/dirt patches) the boundary is a hard,
 * ruler-straight line. Seamless boundaries (cliffs, roads, proper transition tiles) are left alone.
 *
 * Near the camera, the ground is baked into 512 px chunks on a 2D canvas: tiles are drawn, then every
 * hard seam is feathered by fading the neighbouring tile's texture into each side of the boundary, so
 * the two grounds blend over ~40 px. Chunks are built a few per frame within a time budget, kept only
 * around the view, and their canvases/textures are reused.
 */
import { DEPTH } from './effects.js';

const CHUNK = 512;
const T = 32;
const FEATHER = 28; // px a neighbour's ground fades into this tile
const SEAM = 1.7; // a jump this many times the texture's own row-to-row variation is a hard seam
const MIN_JUMP = 12; // ignore boundaries whose average per-channel jump is below this
const BIG_JUMP = 32; // always a seam above this average per-channel jump
const BUDGET_MS = 3; // only used while the first view fills in
const MAX_CHUNKS = 48;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W; opposite = (d + 2) % 4

const edgeCache = new Map(); // tileset key -> { rows: Uint8Array, noise: Float32Array }

/**
 * Per tile and side: the outermost pixel row/column (rows) and how much the image normally changes
 * from that row to the next one inside the tile (noise). A boundary is a hard seam when the jump
 * across it is much larger than that natural texture variation.
 */
function tileEdges(img, key) {
  if (edgeCache.has(key)) return edgeCache.get(key);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, img.width, img.height).data;
  const cols = img.width / T;
  const n = cols * (img.height / T);
  const rows = new Uint8Array(n * 4 * T * 3);
  const noise = new Float32Array(n * 4);
  const at = (x, y, ch) => px[(y * img.width + x) * 4 + ch];
  for (let i = 0; i < n; i++) {
    const ox = (i % cols) * T;
    const oy = Math.floor(i / cols) * T;
    for (let d = 0; d < 4; d++) {
      let diff = 0;
      for (let k = 0; k < T; k++) {
        // outer pixel and the one just inside, along side d
        let x0, y0, x1, y1;
        if (d === 0) [x0, y0, x1, y1] = [k, 0, k, 1];
        else if (d === 1) [x0, y0, x1, y1] = [T - 1, k, T - 2, k];
        else if (d === 2) [x0, y0, x1, y1] = [k, T - 1, k, T - 2];
        else [x0, y0, x1, y1] = [0, k, 1, k];
        for (let ch = 0; ch < 3; ch++) {
          const v = at(ox + x0, oy + y0, ch);
          rows[((i * 4 + d) * T + k) * 3 + ch] = v;
          diff += Math.abs(v - at(ox + x1, oy + y1, ch));
        }
      }
      noise[i * 4 + d] = diff / (T * 3);
    }
  }
  const out = { rows, noise };
  edgeCache.set(key, out);
  return out;
}

/** 32x32 alpha masks: opaque-ish at the shared edge on side d, fading to nothing FEATHER px inside. */
function makeMasks() {
  return DIRS.map((_, d) => {
    const c = document.createElement('canvas');
    c.width = c.height = T;
    const ctx = c.getContext('2d');
    const im = ctx.createImageData(T, T);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        // distance from the edge facing the neighbour
        const t = d === 0 ? y : d === 1 ? T - 1 - x : d === 2 ? T - 1 - y : x;
        const u = Math.min(1, (t + 0.5) / FEATHER);
        const a = 0.5 * (1 - u * u * (3 - 2 * u)); // smoothstep fade, 50% at the seam
        im.data[(y * T + x) * 4 + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(im, 0, 0);
    return c;
  });
}

export class Terrain {
  constructor(scene, world, tilesetKey) {
    this.s = scene;
    this.w = world;
    this.key = tilesetKey;
    this.img = scene.textures.get(tilesetKey).getSourceImage();
    this.cols = this.img.width / T;
    this.edges = tileEdges(this.img, tilesetKey);
    this.masks = makeMasks();
    this.tmp = document.createElement('canvas');
    this.tmp.width = this.tmp.height = T;
    this.tctx = this.tmp.getContext('2d');
    this.chunks = new Map(); // "cx,cy" -> { canvas, ctx, tex, image, used }
    this.pool = [];
    this.seq = 0;
    this.enabled = true;
    this.cw = Math.ceil((world.width * T) / CHUNK);
    this.ch = Math.ceil((world.height * T) / CHUNK);
  }

  /** Ratio of the jump across the a|b boundary (a's side d) to the textures' own row-to-row variation. */
  seamScore(a, b, d) {
    const { rows, noise } = this.edges;
    const o = (d + 2) % 4;
    const ra = (a * 4 + d) * T * 3;
    const rb = (b * 4 + o) * T * 3;
    let diff = 0;
    for (let k = 0; k < T * 3; k++) diff += Math.abs(rows[ra + k] - rows[rb + k]);
    diff /= T * 3;
    const natural = Math.max(4, (noise[a * 4 + d] + noise[b * 4 + o]) / 2);
    if (diff < MIN_JUMP) return 0;
    // a very large jump is a seam even across busy textures (dune next to plain dirt)
    return diff >= BIG_JUMP ? SEAM : diff / natural;
  }

  bake(cx, cy) {
    let c = this.pool.pop();
    if (!c) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = CHUNK;
      const key = `terrain_chunk_${this.seq++}`;
      const tex = this.s.textures.addCanvas(key, canvas);
      c = { canvas, ctx: canvas.getContext('2d'), tex, key, image: null };
    }
    const ctx = c.ctx;
    const W = this.w;
    const tiles = W.tiles;
    const x0 = (cx * CHUNK) / T;
    const y0 = (cy * CHUNK) / T;
    const n = CHUNK / T;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, CHUNK, CHUNK);
    // 1) plain tiles
    for (let ty = 0; ty < n; ty++) {
      const wy = y0 + ty;
      if (wy >= W.height) break;
      for (let tx = 0; tx < n; tx++) {
        const wx = x0 + tx;
        if (wx >= W.width) break;
        const t = tiles[wy * W.width + wx];
        ctx.drawImage(this.img, (t % this.cols) * T, Math.floor(t / this.cols) * T, T, T, tx * T, ty * T, T, T);
      }
    }
    // 2) feather hard seams: the neighbour's ground fades into this tile
    const tctx = this.tctx;
    for (let ty = 0; ty < n; ty++) {
      const wy = y0 + ty;
      if (wy >= W.height) break;
      for (let tx = 0; tx < n; tx++) {
        const wx = x0 + tx;
        if (wx >= W.width) break;
        const a = tiles[wy * W.width + wx];
        for (let d = 0; d < 4; d++) {
          const nx = wx + DIRS[d][0];
          const ny = wy + DIRS[d][1];
          if (nx < 0 || ny < 0 || nx >= W.width || ny >= W.height) continue;
          const b = tiles[ny * W.width + nx];
          if (b === a || this.seamScore(a, b, d) < SEAM) continue;
          tctx.globalCompositeOperation = 'copy';
          tctx.drawImage(this.img, (b % this.cols) * T, Math.floor(b / this.cols) * T, T, T, 0, 0, T, T);
          tctx.globalCompositeOperation = 'destination-in';
          tctx.drawImage(this.masks[d], 0, 0);
          ctx.drawImage(this.tmp, tx * T, ty * T);
        }
      }
    }
    c.tex.refresh();
    if (!c.image) {
      c.image = this.s.add.image(0, 0, c.key).setOrigin(0, 0).setDepth(DEPTH.ground - 999);
    }
    c.image.setPosition(cx * CHUNK, cy * CHUNK).setVisible(this.enabled);
    c.used = performance.now();
    this.chunks.set(`${cx},${cy}`, c);
  }

  /** Bake missing chunks around the view (time-budgeted) and recycle far-away ones. */
  update(view) {
    if (!this.enabled) return;
    const m = 256;
    const x0 = Math.max(0, Math.floor((view.x - m) / CHUNK));
    const y0 = Math.max(0, Math.floor((view.y - m) / CHUNK));
    const x1 = Math.min(this.cw - 1, Math.floor((view.x + view.w + m) / CHUNK));
    const y1 = Math.min(this.ch - 1, Math.floor((view.y + view.h + m) / CHUNK));
    const now = performance.now();
    const missing = [];
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = this.chunks.get(`${cx},${cy}`);
        if (c) c.used = now;
        else missing.push([cx, cy]);
      }
    }
    if (missing.length) {
      const mx = (view.x + view.w / 2) / CHUNK;
      const my = (view.y + view.h / 2) / CHUNK;
      missing.sort((p, q) => Math.hypot(p[0] + 0.5 - mx, p[1] + 0.5 - my) - Math.hypot(q[0] + 0.5 - mx, q[1] + 0.5 - my));
      // one chunk per frame (~3 ms) keeps frames even; a fresh world fills in over a few frames
      // behind the fade, and while roaming the margin bakes chunks long before they scroll in
      const start = performance.now();
      for (const [cx, cy] of missing) {
        this.bake(cx, cy);
        if (this.warm || performance.now() - start > BUDGET_MS * 10) break;
      }
      this.warm = true;
    }
    if (this.chunks.size > MAX_CHUNKS) {
      const old = [...this.chunks.entries()].sort((p, q) => p[1].used - q[1].used);
      for (const [k, c] of old.slice(0, this.chunks.size - MAX_CHUNKS)) {
        if (c.used === now) continue;
        this.chunks.delete(k);
        c.image.setVisible(false);
        this.pool.push(c);
      }
    }
  }

  setEnabled(on) {
    this.enabled = on;
    for (const c of this.chunks.values()) c.image.setVisible(on);
  }

  destroy() {
    for (const c of [...this.chunks.values(), ...this.pool]) {
      c.image?.destroy();
      this.s.textures.remove(c.key);
    }
    this.chunks.clear();
    this.pool = [];
  }
}
