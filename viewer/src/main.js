import Phaser from 'phaser';
import manifest from './sprites.json';
import { UNIT_ANIMATIONS, UNITS, ATTACK_TO_SHOOT_EFFECT, SHOOT_EFFECT_SCALE } from './unit-config.js';
import { EFFECTS_ANIMATIONS, EFFECTS_SPRITE } from './effects-config.js';

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

    this.activeTab = 'sprite';
    this.unitGridSprites = [];
    this.unitGridMeta = null;
    this.unitGridStem = null;
    this.unitGridLoadInProgress = false;

    this.effectsGridSprites = [];
    this.effectsGridMeta = null;
    this.effectsGridLoadInProgress = false;
    this.effectsGridLoaded = false;

    this.setupUI();
    this.loadManifest();
    this.setupTabs();
    this.setupUnitsTab();
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

  setupTabs() {
    const tabSprite = document.getElementById('tab-sprite');
    const tabUnits = document.getElementById('tab-units');
    const tabEffects = document.getElementById('tab-effects');
    const spriteUI = document.getElementById('sprite-viewer-ui');
    const unitsUI = document.getElementById('units-ui');
    const effectsUI = document.getElementById('effects-ui');

    tabSprite.addEventListener('click', () => this.switchTab('sprite'));
    tabUnits.addEventListener('click', () => this.switchTab('units'));
    tabEffects.addEventListener('click', () => this.switchTab('effects'));
  }

  setupUnitsTab() {
    const sel = document.getElementById('unit-select');
    sel.innerHTML = '<option value="">-- Select unit --</option>';
    for (const u of UNITS) {
      const opt = document.createElement('option');
      opt.value = JSON.stringify(u);
      opt.textContent = u.displayName;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => this.onUnitSelect());
  }

  switchTab(tab) {
    const tabSprite = document.getElementById('tab-sprite');
    const tabUnits = document.getElementById('tab-units');
    const tabEffects = document.getElementById('tab-effects');
    const spriteUI = document.getElementById('sprite-viewer-ui');
    const unitsUI = document.getElementById('units-ui');
    const effectsUI = document.getElementById('effects-ui');

    this.activeTab = tab;
    tabSprite.classList.toggle('active', tab === 'sprite');
    tabUnits.classList.toggle('active', tab === 'units');
    tabEffects.classList.toggle('active', tab === 'effects');
    spriteUI.classList.toggle('active', tab === 'sprite');
    unitsUI.classList.toggle('active', tab === 'units');
    effectsUI.classList.toggle('active', tab === 'effects');

    if (tab === 'sprite') {
      this.hideUnitGrid();
      this.hideEffectsGrid();
      if (this.sprite) this.sprite.setVisible(true);
    } else if (tab === 'units') {
      this.hideEffectsGrid();
      if (this.sprite) this.sprite.setVisible(false);
      const sel = document.getElementById('unit-select');
      if (sel.value) this.loadUnitGrid(JSON.parse(sel.value));
    } else {
      this.hideUnitGrid();
      if (this.sprite) this.sprite.setVisible(false);
      this.loadEffectsGrid();
    }
  }

  onUnitSelect() {
    const sel = document.getElementById('unit-select');
    const val = sel.value;
    if (!val) {
      this.hideUnitGrid();
      document.getElementById('units-status').textContent = 'Units — select a unit to view 25 animations at 8 FPS';
      return;
    }
    this.loadUnitGrid(JSON.parse(val));
  }

  async loadUnitGrid(unit) {
    if (this.unitGridLoadInProgress) return;

    this.unitGridLoadInProgress = true;
    this.destroyUnitGrid();
    document.getElementById('units-status').textContent = `Loading ${unit.displayName}...`;

    const { path, stem } = unit;

    try {
      const metaRes = await fetch(`/${path}/${stem}_frames.json`);
      if (!metaRes.ok) throw new Error(`Failed to fetch ${stem}_frames.json`);
      this.unitGridMeta = await metaRes.json();
      this.unitGridStem = stem;
    } catch (e) {
      console.error(e);
      document.getElementById('units-status').textContent = `Error: ${e.message}`;
      this.unitGridLoadInProgress = false;
      return;
    }

    const keyPrefix = `f-${stem}-`;
    const totalFrames = this.unitGridMeta.total_frames || this.unitGridMeta.frames.length;
    for (let i = 0; i < totalFrames; i++) {
      const pad = String(i).padStart(4, '0');
      this.load.image(`${keyPrefix}${i}`, `/${path}/${stem}_${pad}.png`);
    }

    this.load.once('complete', () => {
      this.unitGridLoadInProgress = false;
      const finish = () => {
        this.buildUnitGrid();
        document.getElementById('units-status').textContent = `${unit.displayName} — 25 animations at 8 FPS`;
      };
      if (unit.stem === 'SWAT') {
        this.loadExtrasForShootEffects(finish);
      } else {
        finish();
      }
    });
    this.load.once('loaderror', (file) => {
      document.getElementById('units-status').textContent = `Load error: ${file.key}`;
      this.unitGridLoadInProgress = false;
    });
    this.load.start();
  }

  async loadExtrasForShootEffects(callback) {
    if (this.effectsGridLoaded && this.effectsGridMeta) {
      callback();
      return;
    }
    const { path, stem } = EFFECTS_SPRITE;
    const keyPrefix = `f-${stem}-`;
    if (!this.effectsGridMeta) {
      try {
        const res = await fetch(`/${path}/${stem}_frames.json`);
        this.effectsGridMeta = await res.json();
      } catch (e) {
        callback();
        return;
      }
    }
    const totalFrames = this.effectsGridMeta.total_frames || 392;
    for (let i = 0; i < totalFrames; i++) {
      const pad = String(i).padStart(4, '0');
      this.load.image(`${keyPrefix}${i}`, `/${path}/${stem}_${pad}.png`);
    }
    this.load.once('complete', () => {
      this.effectsGridLoaded = true;
      callback();
    });
    this.load.once('loaderror', () => callback());
    this.load.start();
  }

  buildUnitGrid() {
    this.destroyUnitGrid();
    if (!this.unitGridMeta || !this.unitGridStem) return;

    const cols = 5;
    const rows = 5;
    const cellW = 800 / cols;
    const cellH = 600 / rows;
    const padding = 4;
    const maxSpriteSize = Math.min(cellW, cellH) - padding * 2;
    const keyPrefix = `f-${this.unitGridStem}-`;

    for (let idx = 0; idx < UNIT_ANIMATIONS.length; idx++) {
      const anim = UNIT_ANIMATIONS[idx];
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const cx = col * cellW + cellW / 2;
      const cy = row * cellH + cellH / 2;

      const frameI = anim.frames[0];
      const key = `${keyPrefix}${frameI}`;
      if (!this.textures.exists(key)) continue;

      const sprite = this.add.sprite(cx, cy, key);
      sprite.setDepth(1);
      sprite.setFlipX(anim.flipX);

      const frameData = this.unitGridMeta.frames.find((f) => f.i === frameI);
      if (frameData) {
        const tex = sprite.texture;
        const w = tex.getSourceImage().width || 1;
        const h = tex.getSourceImage().height || 1;
        const ox = Math.max(0, Math.min(1, frameData.ox / w));
        const oy = Math.max(0, Math.min(1, frameData.oy / h));
        sprite.setOrigin(ox, oy);
      }

      const scale = Math.min(maxSpriteSize / (sprite.width || 1), maxSpriteSize / (sprite.height || 1));
      sprite.setScale(Math.min(1, scale));

      const label = this.add.text(cx, cy + cellH / 2 - 14, anim.name, {
        fontSize: 10,
        color: '#ccc',
      }).setOrigin(0.5, 1).setDepth(2);

      let shootEffect = null;
      if (this.unitGridStem === 'SWAT' && ATTACK_TO_SHOOT_EFFECT[anim.name] && this.effectsGridLoaded) {
        const shoot = ATTACK_TO_SHOOT_EFFECT[anim.name];
        const effectKey = `f-Extras-${shoot.frames[0]}`;
        if (this.textures.exists(effectKey)) {
          const offsetScale = Math.min(1, scale);
          const effectSprite = this.add.sprite(
            cx + shoot.offsetX * offsetScale,
            cy + shoot.offsetY * offsetScale,
            effectKey
          );
          effectSprite.setDepth(1.5);
          effectSprite.setScale(scale * SHOOT_EFFECT_SCALE);
          const effectFrameData = this.effectsGridMeta?.frames?.find((f) => f.i === shoot.frames[0]);
          if (effectFrameData) {
            const tex = effectSprite.texture;
            const w = tex.getSourceImage().width || 1;
            const h = tex.getSourceImage().height || 1;
            effectSprite.setOrigin(
              Math.max(0, Math.min(1, effectFrameData.ox / w)),
              Math.max(0, Math.min(1, effectFrameData.oy / h))
            );
          }
          shootEffect = { sprite: effectSprite, shoot };
        }
      }

      this.unitGridSprites.push({
        sprite,
        label,
        anim,
        frameIndex: 0,
        lastAdvance: 0,
        shootEffect,
      });
    }
  }

  applyUnitGridFrame(cell) {
    const { sprite, anim, frameIndex, shootEffect } = cell;
    const frameI = anim.frames[frameIndex];
    const key = `f-${this.unitGridStem}-${frameI}`;
    if (!this.textures.exists(key)) return;

    sprite.setTexture(key);
    sprite.setFlipX(anim.flipX);

    const frameData = this.unitGridMeta.frames.find((f) => f.i === frameI);
    if (frameData) {
      const tex = sprite.texture;
      const w = tex.getSourceImage().width || 1;
      const h = tex.getSourceImage().height || 1;
      const ox = Math.max(0, Math.min(1, frameData.ox / w));
      const oy = Math.max(0, Math.min(1, frameData.oy / h));
      sprite.setOrigin(ox, oy);
    }

    if (shootEffect) {
      const { sprite: effectSprite, shoot } = shootEffect;
      const effectFrameIdx = Math.min(
        Math.floor((frameIndex / anim.frames.length) * shoot.frames.length),
        shoot.frames.length - 1
      );
      const effectFrameI = shoot.frames[effectFrameIdx];
      const effectKey = `f-Extras-${effectFrameI}`;
      if (this.textures.exists(effectKey)) {
        effectSprite.setTexture(effectKey);
        const effectFrameData = this.effectsGridMeta?.frames?.find((f) => f.i === effectFrameI);
        if (effectFrameData) {
          const tex = effectSprite.texture;
          const w = tex.getSourceImage().width || 1;
          const h = tex.getSourceImage().height || 1;
          effectSprite.setOrigin(
            Math.max(0, Math.min(1, effectFrameData.ox / w)),
            Math.max(0, Math.min(1, effectFrameData.oy / h))
          );
        }
      }
    }
  }

  destroyUnitGrid() {
    for (const cell of this.unitGridSprites) {
      cell.sprite.destroy();
      cell.label.destroy();
      if (cell.shootEffect) cell.shootEffect.sprite.destroy();
    }
    this.unitGridSprites = [];
  }

  hideUnitGrid() {
    this.destroyUnitGrid();
  }

  async loadEffectsGrid() {
    if (this.effectsGridLoadInProgress) return;
    if (this.effectsGridLoaded) {
      this.buildEffectsGrid();
      return;
    }

    this.effectsGridLoadInProgress = true;
    document.getElementById('effects-status').textContent = 'Loading Effects...';

    const { path, stem } = EFFECTS_SPRITE;

    try {
      const metaRes = await fetch(`/${path}/${stem}_frames.json`);
      if (!metaRes.ok) throw new Error(`Failed to fetch ${stem}_frames.json`);
      this.effectsGridMeta = await metaRes.json();
    } catch (e) {
      console.error(e);
      document.getElementById('effects-status').textContent = `Error: ${e.message}`;
      this.effectsGridLoadInProgress = false;
      return;
    }

    const keyPrefix = `f-${stem}-`;
    const totalFrames = this.effectsGridMeta.total_frames || this.effectsGridMeta.frames.length;
    for (let i = 0; i < totalFrames; i++) {
      const pad = String(i).padStart(4, '0');
      this.load.image(`${keyPrefix}${i}`, `/${path}/${stem}_${pad}.png`);
    }

    this.load.once('complete', () => {
      this.effectsGridLoadInProgress = false;
      this.effectsGridLoaded = true;
      this.buildEffectsGrid();
      document.getElementById('effects-status').textContent = 'Effects — 59 animations at 8 FPS';
    });
    this.load.once('loaderror', (file) => {
      document.getElementById('effects-status').textContent = `Load error: ${file.key}`;
      this.effectsGridLoadInProgress = false;
    });
    this.load.start();
  }

  buildEffectsGrid() {
    this.destroyEffectsGrid();
    if (!this.effectsGridMeta) return;

    const stem = EFFECTS_SPRITE.stem;
    const cols = 10;
    const rows = Math.ceil(EFFECTS_ANIMATIONS.length / cols);
    const cellW = 800 / cols;
    const cellH = 600 / rows;
    const padding = 4;
    const maxSpriteSize = Math.min(cellW, cellH) - padding * 2;
    const keyPrefix = `f-${stem}-`;

    for (let idx = 0; idx < EFFECTS_ANIMATIONS.length; idx++) {
      const anim = EFFECTS_ANIMATIONS[idx];
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const cx = col * cellW + cellW / 2;
      const cy = row * cellH + cellH / 2;

      const frameI = anim.frames[0];
      const key = `${keyPrefix}${frameI}`;
      if (!this.textures.exists(key)) continue;

      const sprite = this.add.sprite(cx, cy, key);
      sprite.setDepth(1);

      const frameData = this.effectsGridMeta.frames.find((f) => f.i === frameI);
      if (frameData) {
        const tex = sprite.texture;
        const w = tex.getSourceImage().width || 1;
        const h = tex.getSourceImage().height || 1;
        const ox = Math.max(0, Math.min(1, frameData.ox / w));
        const oy = Math.max(0, Math.min(1, frameData.oy / h));
        sprite.setOrigin(ox, oy);
      }

      const scale = Math.min(maxSpriteSize / (sprite.width || 1), maxSpriteSize / (sprite.height || 1));
      sprite.setScale(Math.min(1, scale));

      const label = this.add.text(cx, cy + cellH / 2 - 12, anim.name, {
        fontSize: 9,
        color: '#ccc',
      }).setOrigin(0.5, 1).setDepth(2);

      this.effectsGridSprites.push({
        sprite,
        label,
        anim,
        frameIndex: 0,
        lastAdvance: 0,
      });
    }
  }

  applyEffectsGridFrame(cell) {
    const { sprite, anim, frameIndex } = cell;
    const frameI = anim.frames[frameIndex];
    const stem = EFFECTS_SPRITE.stem;
    const key = `f-${stem}-${frameI}`;
    if (!this.textures.exists(key)) return;

    sprite.setTexture(key);

    const frameData = this.effectsGridMeta.frames.find((f) => f.i === frameI);
    if (frameData) {
      const tex = sprite.texture;
      const w = tex.getSourceImage().width || 1;
      const h = tex.getSourceImage().height || 1;
      const ox = Math.max(0, Math.min(1, frameData.ox / w));
      const oy = Math.max(0, Math.min(1, frameData.oy / h));
      sprite.setOrigin(ox, oy);
    }
  }

  destroyEffectsGrid() {
    for (const cell of this.effectsGridSprites) {
      cell.sprite.destroy();
      cell.label.destroy();
    }
    this.effectsGridSprites = [];
  }

  hideEffectsGrid() {
    this.destroyEffectsGrid();
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
    if (this.activeTab === 'effects' && this.effectsGridSprites.length > 0) {
      const msPerFrame = 125; // 8 FPS
      for (const cell of this.effectsGridSprites) {
        cell.lastAdvance += delta;
        while (cell.lastAdvance >= msPerFrame && cell.anim.frames.length > 0) {
          cell.lastAdvance -= msPerFrame;
          cell.frameIndex = (cell.frameIndex + 1) % cell.anim.frames.length;
          this.applyEffectsGridFrame(cell);
        }
      }
      return;
    }

    if (this.activeTab === 'units' && this.unitGridSprites.length > 0) {
      const msPerFrame = 125; // 8 FPS
      for (const cell of this.unitGridSprites) {
        cell.lastAdvance += delta;
        while (cell.lastAdvance >= msPerFrame && cell.anim.frames.length > 0) {
          cell.lastAdvance -= msPerFrame;
          cell.frameIndex = (cell.frameIndex + 1) % cell.anim.frames.length;
          this.applyUnitGridFrame(cell);
        }
      }
      return;
    }

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
