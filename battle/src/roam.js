import { CONFIG } from './config.js';
import { centerSnapped } from './snap.js';

/**
 * The main camera: drifts slowly in a straight line across the battlefield and bounces off the
 * edges of the world like a screensaver (hitting a side wall flips the horizontal direction,
 * the top or bottom flips the vertical one, with a little random variation so the path never repeats).
 */
export class Roamer {
  constructor(scene) {
    this.s = scene;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
  }

  viewSize() {
    const cam = this.s.cameras.main;
    return [cam.width / cam.zoom, cam.height / cam.zoom];
  }

  /** Start from the camera's current centre in a random diagonal direction. */
  reset() {
    const cam = this.s.cameras.main;
    // start on whole screen pixels so every step lands on the pixel grid
    this.x = Math.round((cam.scrollX + cam.width / 2) * cam.zoom) / cam.zoom;
    this.y = Math.round((cam.scrollY + cam.height / 2) * cam.zoom) / cam.zoom;
    this.kx = undefined;
    this.setDirection((Math.PI / 4) * (1 + 2 * Math.floor(this.s.rng() * 4)));
    this.clamp();
  }

  /**
   * Travel on exact 45-degree diagonals (like the bouncing DVD logo): x and y then step on the same
   * frames, so the picture glides instead of jerking sideways and down at different moments.
   */
  setDirection(a) {
    const c = CONFIG.pan / Math.SQRT2;
    this.vx = Math.cos(a) >= 0 ? c : -c;
    this.vy = Math.sin(a) >= 0 ? c : -c;
  }

  clamp() {
    const [vw, vh] = this.viewSize();
    const W = this.s.worldW;
    const H = this.s.worldH;
    this.x = W <= vw ? W / 2 : Math.max(vw / 2, Math.min(W - vw / 2, this.x));
    this.y = H <= vh ? H / 2 : Math.max(vh / 2, Math.min(H - vh / 2, this.y));
    centerSnapped(this.s.cameras.main, this.x, this.y);
  }

  /**
   * Even pacing: the camera moves whole screen pixels, one step every k frames per axis (k from the
   * measured frame rate). Irregular 2-or-3-frame gaps between pixel steps are what reads as judder
   * on slow pixel-art scrolling; a fixed rhythm per axis reads as a smooth crawl.
   */
  cadence() {
    const fps = Math.max(20, Math.min(240, this.s.game.loop.actualFps || 60));
    this.fps = fps;
    const sx = Math.abs(this.vx) * this.s.cameras.main.zoom; // screen px per second
    const sy = Math.abs(this.vy) * this.s.cameras.main.zoom;
    // one shared rhythm for both axes (diagonal travel)
    const k = Math.max(1, Math.round(fps / Math.max(sx, sy, 0.5)));
    this.kx = sx > 0.5 ? k : 0;
    this.ky = sy > 0.5 ? k : 0;
    this.cx = 0;
    this.cy = 0;
  }

  update(dt) {
    const cam = this.s.cameras.main;
    const [vw, vh] = this.viewSize();
    const W = this.s.worldW;
    const H = this.s.worldH;
    const sp = Math.hypot(this.vx, this.vy) || 1;
    if (Math.abs(sp - CONFIG.pan) > 0.01) {
      this.vx *= CONFIG.pan / sp;
      this.vy *= CONFIG.pan / sp;
      this.kx = undefined;
    }
    // re-derive the rhythm when it is unset or the frame rate has really changed
    this.recheck = (this.recheck || 0) + dt;
    if (this.kx === undefined || (this.recheck > 5000 && Math.abs((this.s.game.loop.actualFps || 60) - this.fps) > this.fps * 0.2)) {
      this.recheck = 0;
      this.cadence();
    }
    const px = 1 / cam.zoom; // one screen pixel in world units
    if (this.kx && ++this.cx >= this.kx) {
      this.cx = 0;
      this.x += Math.sign(this.vx) * px;
    }
    if (this.ky && ++this.cy >= this.ky) {
      this.cy = 0;
      this.y += Math.sign(this.vy) * px;
    }
    let bounced = false;
    if (W > vw) {
      if (this.x - vw / 2 <= 0 && this.vx < 0) { this.vx = -this.vx; bounced = true; }
      if (this.x + vw / 2 >= W && this.vx > 0) { this.vx = -this.vx; bounced = true; }
    }
    if (H > vh) {
      if (this.y - vh / 2 <= 0 && this.vy < 0) { this.vy = -this.vy; bounced = true; }
      if (this.y + vh / 2 >= H && this.vy > 0) { this.vy = -this.vy; bounced = true; }
    }
    if (bounced) this.cadence();
    this.clamp();
  }
}
