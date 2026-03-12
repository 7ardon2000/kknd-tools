import Phaser from 'phaser';
import manifest from './sprites.json';

class ViewerScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Viewer' });
  }

  create() {
    this.sprite = null;
    this.meta = null;
    this.filteredFrames = [];
    this.frameIndex = 0;
    this.playing = false;
    this.lastAdvance = 0;
    this.frameSpeed = 15; // frames per second

    this.setupUI();
    this.loadManifest();
  }

  loadManifest() {
    const sel = document.getElementById('sprite-select');
    sel.innerHTML = '<option value="">-- Select sprite --</option>';
    for (const entry of manifest) {
      const opt = document.createElement('option');
      opt.value = JSON.stringify(entry);
      opt.textContent = `${entry.path} (${entry.stem})`;
      sel.appendChild(opt);
    }

    sel.addEventListener('change', () => this.onSpriteSelect());
    document.getElementById('play-btn').addEventListener('click', () => this.togglePlay());
    document.getElementById('step-btn').addEventListener('click', () => this.stepFrame());
    document.getElementById('speed').addEventListener('input', (e) => {
      this.frameSpeed = Math.max(1, parseInt(e.target.value, 10) || 15);
    });
  }

  setupUI() {
    document.getElementById('dir-select').addEventListener('change', () => this.rebuildFilteredFrames());
  }

  async onSpriteSelect() {
    const sel = document.getElementById('sprite-select');
    const val = sel.value;
    if (!val) {
      this.clearSprite();
      return;
    }

    const entry = JSON.parse(val);
    const { path, stem } = entry;

    document.getElementById('frame-info').textContent = 'Loading...';
    document.getElementById('dir-select').innerHTML = '<option value="all">All frames</option>';

    try {
      const metaRes = await fetch(`/${path}/${stem}_frames.json`);
      if (!metaRes.ok) throw new Error(`Failed to fetch ${stem}_frames.json`);
      this.meta = await metaRes.json();
    } catch (e) {
      console.error(e);
      document.getElementById('frame-info').textContent = `Error: ${e.message}`;
      return;
    }

    if (this.sprite) {
      this.sprite.destroy();
      this.sprite = null;
    }

    const totalFrames = this.meta.total_frames || this.meta.frames.length;
    const keyPrefix = `f-${stem}-`;

    for (let i = 0; i < totalFrames; i++) {
      const pad = String(i).padStart(4, '0');
      this.load.image(`${keyPrefix}${i}`, `/${path}/${stem}_${pad}.png`);
    }

    this.load.once('complete', () => {
      this.finishSpriteLoad(entry);
    });
    this.load.once('loaderror', (file) => {
      document.getElementById('frame-info').textContent = `Load error: ${file.key}`;
    });
    this.load.start();
  }

  finishSpriteLoad(entry) {
    const { stem } = entry;
    const keyPrefix = `f-${stem}-`;
    const firstKey = `${keyPrefix}0`;

    if (!this.textures.exists(firstKey)) {
      document.getElementById('frame-info').textContent = 'No frames loaded';
      return;
    }

    this.sprite = this.add.sprite(400, 300, firstKey);
    this.sprite.setDepth(1);

    this.buildDirDropdown();
    this.rebuildFilteredFrames();
    this.applyFrame(0);
    document.getElementById('frame-info').textContent = `${this.filteredFrames.length} frames`;
  }

  buildDirDropdown() {
    const dirSel = document.getElementById('dir-select');
    dirSel.innerHTML = '<option value="all">All frames</option>';

    const rc = this.meta.rotational_count || 0;
    const sc = this.meta.simple_count || 0;

    for (let i = 0; i < rc; i++) {
      const opt = document.createElement('option');
      opt.value = `dir-${i}`;
      opt.textContent = `Dir ${i}`;
      dirSel.appendChild(opt);
    }
    for (let i = 0; i < sc; i++) {
      const opt = document.createElement('option');
      opt.value = `idx-${i}`;
      opt.textContent = `Simple ${i}`;
      dirSel.appendChild(opt);
    }
  }

  rebuildFilteredFrames() {
    const dirSel = document.getElementById('dir-select');
    const val = dirSel.value;
    const frames = this.meta?.frames || [];

    if (!val || val === 'all') {
      this.filteredFrames = frames;
    } else if (val.startsWith('dir-')) {
      const dir = parseInt(val.slice(4), 10);
      this.filteredFrames = frames.filter((f) => f.dir === dir);
    } else if (val.startsWith('idx-')) {
      const idx = parseInt(val.slice(4), 10);
      this.filteredFrames = frames.filter((f) => f.idx === idx);
    } else {
      this.filteredFrames = frames;
    }

    this.frameIndex = Math.min(this.frameIndex, Math.max(0, this.filteredFrames.length - 1));
    if (this.filteredFrames.length > 0 && this.sprite) {
      this.applyFrame(this.frameIndex);
    }
    document.getElementById('frame-info').textContent =
      this.meta ? `${this.frameIndex + 1}/${this.filteredFrames.length} frames` : '';
  }

  applyFrame(index) {
    if (!this.sprite || !this.meta || this.filteredFrames.length === 0) return;
    const frame = this.filteredFrames[index];
    if (!frame) return;

    const stem = this.getCurrentStem();
    if (!stem) return;

    const key = `f-${stem}-${frame.i}`;
    if (!this.textures.exists(key)) return;

    this.sprite.setTexture(key);
    const tex = this.sprite.texture;
    const w = tex.getSourceImage().width || 1;
    const h = tex.getSourceImage().height || 1;
    const ox = Math.max(0, Math.min(1, frame.ox / w));
    const oy = Math.max(0, Math.min(1, frame.oy / h));
    this.sprite.setOrigin(ox, oy);
  }

  getCurrentStem() {
    const sel = document.getElementById('sprite-select');
    const val = sel?.value;
    if (!val) return null;
    try {
      return JSON.parse(val).stem;
    } catch {
      return null;
    }
  }

  togglePlay() {
    this.playing = !this.playing;
    document.getElementById('play-btn').textContent = this.playing ? 'Pause' : 'Play';
    if (this.playing) this.lastAdvance = this.game.loop.now;
  }

  stepFrame() {
    this.playing = false;
    document.getElementById('play-btn').textContent = 'Play';
    if (this.filteredFrames.length === 0) return;
    this.frameIndex = (this.frameIndex + 1) % this.filteredFrames.length;
    this.applyFrame(this.frameIndex);
    document.getElementById('frame-info').textContent = `${this.frameIndex + 1}/${this.filteredFrames.length} frames`;
  }

  update(time, delta) {
    if (!this.playing || this.filteredFrames.length <= 1) return;

    this.lastAdvance += delta;
    const msPerFrame = 1000 / this.frameSpeed;
    while (this.lastAdvance >= msPerFrame) {
      this.lastAdvance -= msPerFrame;
      this.frameIndex = (this.frameIndex + 1) % this.filteredFrames.length;
      this.applyFrame(this.frameIndex);
    }
    document.getElementById('frame-info').textContent = `${this.frameIndex + 1}/${this.filteredFrames.length} frames`;
  }

  clearSprite() {
    if (this.sprite) {
      this.sprite.destroy();
      this.sprite = null;
    }
    this.meta = null;
    this.filteredFrames = [];
    this.playing = false;
    document.getElementById('play-btn').textContent = 'Play';
    document.getElementById('dir-select').innerHTML = '<option value="all">All frames</option>';
    document.getElementById('frame-info').textContent = '';
  }
}

const config = {
  type: Phaser.AUTO,
  parent: 'canvas-wrapper',
  width: 800,
  height: 600,
  backgroundColor: '#222222',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: ViewerScene,
};

new Phaser.Game(config);
