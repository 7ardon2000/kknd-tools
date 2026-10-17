import Phaser from 'phaser';
import { CONFIG } from './config.js';
import { BattleScene, BootScene } from './battle.js';
import { installWallpaperHooks } from './wallpaper.js';

/**
 * Phaser's sprite shaders compute vertex positions in mediump. On GPUs where that is a 16-bit float,
 * screen coordinates above ~1024 px are not exact, and the shader's pixel rounding then moves each
 * sprite by +-1 px independently from frame to frame (small objects jiggle against the ground).
 * Compile shaders with full precision where the GPU supports it.
 */
for (const Ctx of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
  if (!Ctx) continue;
  const shaderSource = Ctx.prototype.shaderSource;
  Ctx.prototype.shaderSource = function (shader, source) {
    // uniforms shared by both stages must match, so fragment shaders are upgraded too when the GPU
    // supports highp there (every desktop GPU does); otherwise everything is left as Phaser wrote it
    if (this._kkndHighp === undefined) {
      const f = this.getShaderPrecisionFormat(this.FRAGMENT_SHADER, this.HIGH_FLOAT);
      this._kkndHighp = !!f && f.precision > 0;
    }
    if (this._kkndHighp) source = source.replace(/precision\s+(lowp|mediump)\s+float/g, 'precision highp float');
    return shaderSource.call(this, shader, source);
  };
}

/**
 * Render at the screen's real pixel resolution. With Windows display scaling (125%, 150%...) the
 * browser would otherwise stretch a smaller canvas by a fractional factor, so some game pixels become
 * one screen pixel wide and others two; that pattern shifts whenever the camera moves and the whole
 * picture wobbles.
 */
let exactDevicePixels = null; // from ResizeObserver: the browser's exact device-pixel size
function devicePixels() {
  const dpr = window.devicePixelRatio || 1;
  const est = [Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr)];
  // prefer the exact measurement, but only when it agrees with the estimate (emulated or buggy
  // environments can report CSS pixels there)
  const e = exactDevicePixels;
  if (e && Math.abs(e[0] - est[0]) <= 2 && Math.abs(e[1] - est[1]) <= 2) return e;
  return est;
}
const [startW, startH] = devicePixels();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#000000',
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  scale: { mode: Phaser.Scale.NONE, width: startW, height: startH },
  fps: { target: CONFIG.fps, limit: CONFIG.fps < 60 ? CONFIG.fps : 0 },
  // a wallpaper keeps running when it loses focus
  disableContextMenu: true,
  autoFocus: false,
  scene: [BootScene, BattleScene],
});

game.events.on('blur', () => game.loop.wake());
window.kkndGame = game;

function fitCanvas() {
  const [w, h] = devicePixels();
  if (game.scale.width !== w || game.scale.height !== h) game.scale.resize(w, h);
  // one canvas pixel per device pixel; the CSS size fills the window (100%) so a fractional
  // CSS size (e.g. 150% scaling) is never rounded to a size the browser must resample
  game.canvas.style.width = '100%';
  game.canvas.style.height = '100%';
}
// exact device-pixel size of the game area, where the browser supports it (Chromium / WebView2 do)
try {
  const ro = new ResizeObserver((entries) => {
    const box = entries[0].devicePixelContentBoxSize?.[0];
    if (!box) return;
    exactDevicePixels = [box.inlineSize, box.blockSize];
    if (game.canvas) fitCanvas();
  });
  ro.observe(document.getElementById('game'), { box: 'device-pixel-content-box' });
} catch (e) {
  // older browsers: devicePixelRatio estimate is used
}
game.events.once('ready', fitCanvas);
window.addEventListener('resize', fitCanvas);
// moving the window to a screen with a different scale factor changes devicePixelRatio
let dprQuery = null;
function watchDpr() {
  dprQuery?.removeEventListener('change', onDpr);
  dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  dprQuery.addEventListener('change', onDpr);
}
function onDpr() {
  fitCanvas();
  watchDpr();
}
watchDpr();
installWallpaperHooks(game);

