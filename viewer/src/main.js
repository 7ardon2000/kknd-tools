import Phaser from 'phaser';
import manifest from './sprites.json';
import { UNIT_ANIMATIONS, UNITS, ATTACK_TO_SHOOT_EFFECT, SHOOT_EFFECT_SCALE } from './unit-config.js';
import { EFFECTS_ANIMATIONS, EFFECTS_SPRITE } from './effects-config.js';
import { getAllAnimations, SWAT_ATTACK_COMPOSITIONS } from './configure-config.js';

class ViewerScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Viewer' });
  }

  async create() {
    this.sprite = null;
    this.meta = null;
    this.filteredFrames = [];
    this.frameIndex = 0;
    this.playing = false;
    this.lastAdvance = 0;
    this.frameSpeed = 15; // frames per second

    this.unitGridSprites = [];
    this.unitGridMeta = null;
    this.unitGridStem = null;
    this.unitGridLoadInProgress = false;
    this.unitGridComposites = {};
    this.selectedUnitGridAnim = null;
    this.unitShootEffectByAnim = {}; // animName -> { scale, offsetX, offsetY, shootFrame, useModbPoints }
    this.unitShootEffectScale = SHOOT_EFFECT_SCALE;
    this.unitShootOffsetX = 0;
    this.unitShootOffsetY = 0;
    this.unitUseModbPoints = true;
    this.unitShootFrame = 2; // fallback when no selection

    this.effectsGridSprites = [];
    this.effectsGridMeta = null;
    this.effectsGridLoadInProgress = false;
    this.effectsGridLoaded = false;

    this.animationCompositions = { compositions: [] };
    this.configureSlots = [null, null, null]; // { animEntry, layer, offsetX, offsetY } per slot
    this.configureEditingId = null; // composition id when editing existing (e.g. SWAT/attack north)
    this.configureGridSprites = [];
    this.configureGridGraphics = null;
    this.configureGridContainer = null;
    this.configureZoom = 1;
    this.configureMoveSlot = 1; // which slot (1-3) is selected for move/arrow keys
    this.configureDragState = null; // { slotIndex, sprite } when dragging
    this.configureGridMeta = {}; // stem -> meta for each loaded sprite
    this.configurePlaying = false;
    this.configureLastAdvance = 0;
    this.configureLoadInProgress = false;
    this.configureOutputFrameIndex = 0;
    this.configureOutputFrameList = [];

    this.section1Zoom = 1;
    this.section2Zoom = 1;
    this.section2AnimStripSprites = [];
    this.section2Meta = null;
    this.section2Stem = null;
    this.spritesheetTesterZoom = 1;
    this.spritesheetTesterMapLoaded = false;
    this.spritesheetTesterSprite = null;
    this.spritesheetTesterFrameIndex = 0;
    this.spritesheetTesterLastAdvance = 0;
    this.spritesheetTesterConfig = null;
    this.spritesheetTesterMapSprites = [];

    await this.loadCompositions();
    this.setupMultiCamera();
    this.setupUI();
    this.loadManifest();
    this.setupPresets();
    this.setupSection2Animations();
    this.setupConfigureTab();
    this.buildConfigureCompositionSelector();
    this.buildConfigureSlotsDropdowns();
    this.scheduleConfigureLoad();
    this.setupSpritesheetTester();
    window.addEventListener('resize', () => {
      this.layoutCameras();
      if (this.spritesheetTesterMapLoaded) this.buildSpritesheetTesterMap();
    });
    this.layoutCameras();
  }

  setupMultiCamera() {
    this.SECTION_BANDS = [
      { y: 0, h: 80 },
      { y: 80, h: 90 },
      { y: 170, h: 210 },
      { y: 380, h: 220 },
    ];
    const ids = ['section-1-canvas', 'section-2-canvas', 'section-3-canvas', 'section-4-canvas'];
    this.sectionCameras = [];
    for (let i = 0; i < 4; i++) {
      const band = this.SECTION_BANDS[i];
      const cam = this.cameras.add(0, 0, 800, band.h);
      cam.setBackgroundColor('#111111');
      cam.setScroll(0, band.y);
      cam.setName(ids[i]);
      if (i === 0) cam.setZoom(this.section1Zoom);
      if (i === 1) cam.setZoom(this.section2Zoom);
      if (i === 3) cam.setZoom(this.spritesheetTesterZoom);
      this.sectionCameras.push({ id: ids[i], camera: cam });
    }
    this.mainCamera = this.cameras.main;
    this.mainCamera.visible = false;
    this.updateSectionCameraIgnores();
  }

  updateSectionCameraIgnores() {
    if (this.configureGridContainer && this.sectionCameras?.length >= 4) {
      const others = [this.sectionCameras[0].camera, this.sectionCameras[1].camera, this.sectionCameras[3].camera];
      for (const cam of others) {
        cam.ignore(this.configureGridContainer);
      }
    }
  }

  layoutCameras() {
    const ids = ['section-1-canvas', 'section-2-canvas', 'section-3-canvas', 'section-4-canvas'];
    for (let i = 0; i < ids.length && i < this.sectionCameras.length; i++) {
      const el = document.getElementById(ids[i]);
      const cam = this.sectionCameras[i].camera;
      if (el && cam) {
        const r = el.getBoundingClientRect();
        const canvasRect = this.game.canvas?.getBoundingClientRect?.();
        if (canvasRect) {
          const x = r.left - canvasRect.left;
          const y = r.top - canvasRect.top;
          const w = r.width;
          const h = r.height;
          const scaleX = (this.game.canvas.width || 800) / (canvasRect.width || 1);
          const scaleY = (this.game.canvas.height || 600) / (canvasRect.height || 1);
          cam.setViewport(
            Math.round(x * scaleX),
            Math.round(y * scaleY),
            Math.round(w * scaleX),
            Math.round(h * scaleY)
          );
        }
      }
    }
  }

  async loadCompositions() {
    try {
      const stored = localStorage.getItem('kknd-animation-compositions');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed?.compositions) {
            this.animationCompositions = parsed;
            return;
          }
        } catch {}
      }
      const res = await fetch('/src/animation-compositions.json');
      if (res.ok) {
        const storedNow = localStorage.getItem('kknd-animation-compositions');
        if (storedNow) {
          try {
            this.animationCompositions = JSON.parse(storedNow);
            return;
          } catch {}
        }
        this.animationCompositions = await res.json();
      }
    } catch {
      // Keep default { compositions: [] }
    }
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


  setupPresets() {
    const presetSel = document.getElementById('preset-select');
    const frameStart = document.getElementById('frame-start');
    const frameEnd = document.getElementById('frame-end');
    if (!presetSel || !frameStart || !frameEnd) return;
    presetSel.addEventListener('change', () => this.onPresetChange());
    frameStart.addEventListener('change', () => this.onFrameRangeChange());
    frameEnd.addEventListener('change', () => this.onFrameRangeChange());
  }

  onPresetChange() {
    const presetSel = document.getElementById('preset-select');
    const val = presetSel?.value;
    if (!val || val === 'custom') return;
    try {
      const anim = JSON.parse(val);
      const frames = anim.frames || [];
      const start = frames.length > 0 ? Math.min(...frames) : 0;
      const end = frames.length > 0 ? Math.max(...frames) : 0;
      const frameStart = document.getElementById('frame-start');
      const frameEnd = document.getElementById('frame-end');
      if (frameStart) frameStart.value = String(start);
      if (frameEnd) frameEnd.value = String(end);
      this.rebuildFilteredFrames();
      this.refreshSection2Animations();
    } catch {}
  }

  onFrameRangeChange() {
    const presetSel = document.getElementById('preset-select');
    if (presetSel) presetSel.value = 'custom';
    this.rebuildFilteredFrames();
    this.refreshSection2Animations();
  }

  setupSection2Animations() {
    const unitSel = document.getElementById('anim-unit-select');
    if (unitSel) {
      unitSel.innerHTML = '<option value="">-- Select unit --</option>';
      for (const u of UNITS) {
        const opt = document.createElement('option');
        opt.value = JSON.stringify(u);
        opt.textContent = u.displayName;
        unitSel.appendChild(opt);
      }
      const effectsOpt = document.createElement('option');
      effectsOpt.value = JSON.stringify({ ...EFFECTS_SPRITE, displayName: 'Effects (Extras)' });
      effectsOpt.textContent = 'Effects (Extras)';
      unitSel.appendChild(effectsOpt);
      const customOpt = document.createElement('option');
      customOpt.value = '__custom__';
      customOpt.textContent = 'Custom...';
      unitSel.appendChild(customOpt);
      unitSel.addEventListener('change', () => this.onAnimUnitSelect());
    }
    document.getElementById('anim-custom-load-btn')?.addEventListener('click', () => this.loadCustomAnimation());
    document.getElementById('anim-export-btn')?.addEventListener('click', () => this.exportSelectedAnimation());
    document.getElementById('anim-export-all-btn')?.addEventListener('click', () => this.exportAllAnimations());
    document.getElementById('anim-test-btn')?.addEventListener('click', () => this.testSelectedAnimation());
    document.getElementById('anim-test-all-btn')?.addEventListener('click', () => this.testAllAnimations());
    const scrollEl = document.getElementById('section-2-scrollbar');
    if (scrollEl) {
      scrollEl.addEventListener('scroll', () => {
        if (this.sectionCameras?.[1]?.camera) {
          const band = this.SECTION_BANDS?.[1];
          this.sectionCameras[1].camera.setScroll(scrollEl.scrollLeft, band?.y ?? 80);
        }
      });
    }
  }

  onAnimUnitSelect() {
    const sel = document.getElementById('anim-unit-select');
    const val = sel?.value;
    const customSpriteLabel = document.getElementById('anim-custom-sprite-label');
    const customStartLabel = document.getElementById('anim-custom-start-label');
    const customEndLabel = document.getElementById('anim-custom-end-label');
    const customLoadBtn = document.getElementById('anim-custom-load-btn');
    if (val === '__custom__') {
      customSpriteLabel.style.display = customStartLabel.style.display = customEndLabel.style.display = customLoadBtn.style.display = '';
      this.populateAnimCustomSpriteDropdown();
      document.getElementById('anim-status').textContent = 'Select sprite, start/end frames, then Load';
      this.updateAnimStripButtons();
      return;
    }
    customSpriteLabel.style.display = customStartLabel.style.display = customEndLabel.style.display = customLoadBtn.style.display = 'none';
    if (!val) {
      this.destroySection2AnimStrip();
      document.getElementById('anim-status').textContent = 'Select unit to view 25 animations';
      this.updateAnimStripButtons();
      return;
    }
    this.loadSection2Unit(JSON.parse(val));
  }

  populateAnimCustomSpriteDropdown() {
    const sel = document.getElementById('anim-custom-sprite');
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">-- Select sprite --</option>';
    for (const entry of manifest) {
      const opt = document.createElement('option');
      opt.value = JSON.stringify(entry);
      opt.textContent = `${entry.path} (${entry.stem})`;
      sel.appendChild(opt);
    }
    if (currentVal) sel.value = currentVal;
  }

  async loadCustomAnimation() {
    const spriteSel = document.getElementById('anim-custom-sprite');
    const startEl = document.getElementById('anim-custom-start');
    const endEl = document.getElementById('anim-custom-end');
    const val = spriteSel?.value;
    if (!val) {
      document.getElementById('anim-status').textContent = 'Select a sprite first';
      return;
    }
    const entry = JSON.parse(val);
    const frameStart = Math.max(0, parseInt(startEl?.value || '0', 10));
    const frameEnd = Math.max(frameStart, parseInt(endEl?.value || '0', 10));
    if (this.section2LoadInProgress) return;
    this.section2LoadInProgress = true;
    this.destroySection2AnimStrip();
    document.getElementById('anim-status').textContent = `Loading custom ${entry.stem} frames ${frameStart}-${frameEnd}...`;
    const { path, stem } = entry;
    try {
      const metaRes = await fetch(`/${path}/${stem}_frames.json`);
      if (!metaRes.ok) throw new Error(`Failed to fetch ${stem}_frames.json`);
      this.section2Meta = await metaRes.json();
      this.section2Stem = stem;
    } catch (e) {
      console.error(e);
      document.getElementById('anim-status').textContent = `Error: ${e.message}`;
      this.section2LoadInProgress = false;
      return;
    }
    const keyPrefix = `f-${stem}-`;
    for (let i = frameStart; i <= frameEnd; i++) {
      const pad = String(i).padStart(4, '0');
      this.load.image(`${keyPrefix}${i}`, `/${path}/${stem}_${pad}.png`);
    }
    const frames = Array.from({ length: frameEnd - frameStart + 1 }, (_, k) => frameStart + k);
    const customAnims = frames.map((fi) => ({ name: `Frame ${fi}`, frames: [fi], flipX: false }));
    this.load.once('complete', () => {
      this.section2LoadInProgress = false;
      this.buildSection2AnimStrip(customAnims);
      this.section2Animations = customAnims;
      this.unitGridMeta = null;
      this.unitGridStem = null;
      document.getElementById('anim-status').textContent = `Custom: ${frames.length} frames (scroll to pan, wheel to zoom)`;
      this.updateAnimStripButtons();
      const track = document.getElementById('section-2-scroll-track');
      if (track) track.style.width = `${this.section2Animations.length * 96}px`;
    });
    this.load.once('loaderror', () => {
      this.section2LoadInProgress = false;
      document.getElementById('anim-status').textContent = 'Load error';
    });
    this.load.start();
  }

  async loadSection2Unit(unit) {
    if (this.section2LoadInProgress) return;
    this.section2LoadInProgress = true;
    this.destroySection2AnimStrip();
    document.getElementById('anim-status').textContent = `Loading ${unit.displayName}...`;

    const { path, stem } = unit;
    try {
      const metaRes = await fetch(`/${path}/${stem}_frames.json`);
      if (!metaRes.ok) throw new Error(`Failed to fetch ${stem}_frames.json`);
      this.section2Meta = await metaRes.json();
      this.section2Stem = stem;
    } catch (e) {
      console.error(e);
      document.getElementById('anim-status').textContent = `Error: ${e.message}`;
      this.section2LoadInProgress = false;
      return;
    }

    const keyPrefix = `f-${stem}-`;
    const totalFrames = this.section2Meta.total_frames || this.section2Meta.frames?.length || 0;
    for (let i = 0; i < totalFrames; i++) {
      const pad = String(i).padStart(4, '0');
      this.load.image(`${keyPrefix}${i}`, `/${path}/${stem}_${pad}.png`);
    }

    this.load.once('complete', async () => {
      this.section2LoadInProgress = false;
      const isEffects = unit.stem === EFFECTS_SPRITE?.stem;
      this.buildSection2AnimStrip(isEffects ? EFFECTS_ANIMATIONS : UNIT_ANIMATIONS);
      const count = isEffects ? EFFECTS_ANIMATIONS.length : 25;
      document.getElementById('anim-status').textContent = `${unit.displayName || unit.stem} — ${count} animations (scroll to pan, wheel to zoom)`;
      this.section2Animations = isEffects ? EFFECTS_ANIMATIONS : UNIT_ANIMATIONS;
      if (!isEffects) {
        this.unitGridMeta = this.section2Meta;
        this.unitGridStem = this.section2Stem;
        if (unit.stem === 'SWAT') {
          await new Promise((r) => this.loadExtrasForShootEffects(r));
        }
      }
      this.updateAnimStripButtons();
      const track = document.getElementById('section-2-scroll-track');
      if (track) track.style.width = `${this.section2Animations.length * 96}px`;
    });
    this.load.once('loaderror', (file) => {
      this.section2LoadInProgress = false;
      document.getElementById('anim-status').textContent = `Load error: ${file?.key || 'unknown'}`;
    });
    this.load.start();
  }

  buildSection2AnimStrip(animations = UNIT_ANIMATIONS) {
    this.section2AnimStripSprites = [];
    if (!this.section2Meta || !this.section2Stem) return;

    const cellW = 96;
    const cellH = 90;
    const band = this.SECTION_BANDS?.[1];
    const centerY = band ? band.y + band.h / 2 : 105;
    const keyPrefix = `f-${this.section2Stem}-`;

    for (let idx = 0; idx < animations.length; idx++) {
      const anim = animations[idx];
      const cx = idx * cellW + cellW / 2;
      const cy = centerY;

      const frameI = anim.frames[0];
      const key = `${keyPrefix}${frameI}`;
      if (!this.textures.exists(key)) continue;

      const sprite = this.add.sprite(cx, cy, key);
      sprite.setDepth(1);
      sprite.setFlipX(anim.flipX);

      const frameData = this.section2Meta.frames?.find((f) => f.i === frameI);
      if (frameData) {
        const tex = sprite.texture;
        const w = tex.getSourceImage()?.width || 1;
        const h = tex.getSourceImage()?.height || 1;
        sprite.setOrigin(
          Math.max(0, Math.min(1, (frameData.ox || 0) / w)),
          Math.max(0, Math.min(1, (frameData.oy || 0) / h))
        );
      }

      const maxSize = Math.min(cellW, cellH) - 8;
      const scale = Math.min(1, maxSize / (sprite.width || 1), maxSize / (sprite.height || 1));
      sprite.setScale(scale);

      const label = this.add.text(cx, cy + cellH / 2 - 4, anim.name, {
        fontSize: 9,
        color: '#aaa',
      }).setOrigin(0.5, 1).setDepth(2);

      const highlightRect = this.add.rectangle(cx, cy, cellW - 2, cellH - 2);
      highlightRect.setStrokeStyle(2, 0x3a7bd5);
      highlightRect.setOrigin(0.5, 0.5);
      highlightRect.setVisible(false);
      highlightRect.setDepth(3);

      const hitArea = this.add.rectangle(cx, cy, cellW - 4, cellH - 4).setInteractive({ useHandCursor: true }).setDepth(0);
      hitArea.on('pointerdown', () => {
        this.section2SelectedIndex = idx;
        this.section2AnimStripSprites.forEach((c) => {
          if (c.highlightRect) c.highlightRect.setVisible(false);
        });
        highlightRect.setVisible(true);
      });

      const cell = { sprite, label, anim, frameIndex: 0, lastAdvance: 0, hitArea, highlightRect };
      this.section2AnimStripSprites.push(cell);
    }
  }

  destroySection2AnimStrip() {
    if (!this.section2AnimStripSprites) return;
    for (const cell of this.section2AnimStripSprites) {
      cell.sprite.destroy();
      cell.label.destroy();
      if (cell.hitArea) cell.hitArea.destroy();
      if (cell.highlightRect) cell.highlightRect.destroy();
    }
    this.section2AnimStripSprites = [];
  }

  applySection2AnimFrame(cell) {
    const frameI = cell.anim.frames[cell.frameIndex];
    const key = `f-${this.section2Stem}-${frameI}`;
    if (!this.textures.exists(key)) return;
    cell.sprite.setTexture(key);
    const frameData = this.section2Meta?.frames?.find((f) => f.i === frameI);
    if (frameData) {
      const tex = cell.sprite.texture;
      const w = tex.getSourceImage()?.width || 1;
      const h = tex.getSourceImage()?.height || 1;
      cell.sprite.setOrigin(
        Math.max(0, Math.min(1, (frameData.ox || 0) / w)),
        Math.max(0, Math.min(1, (frameData.oy || 0) / h))
      );
    }
  }

  refreshSection2Animations() {
    const unitVal = document.getElementById('anim-unit-select')?.value;
    if (unitVal) this.onAnimUnitSelect();
    else this.buildAnimStripFromSpritePreset();
  }

  buildAnimStripFromSpritePreset() {
    const anims = this.getSection2AnimationsFromSprite();
    if (anims.length === 0) return;
    this.section2Animations = anims;
    this.updateAnimStripButtons();
  }

  getSection2Animations() {
    if (this.section2AnimStripSprites?.length > 0) return this.section2Animations || UNIT_ANIMATIONS;
    return this.getSection2AnimationsFromSprite();
  }

  getSection2AnimationsFromSprite() {
    const spriteVal = document.getElementById('sprite-select')?.value;
    if (!spriteVal) return [];
    try {
      const entry = JSON.parse(spriteVal);
      const presetVal = document.getElementById('preset-select')?.value;
      const frameStart = parseInt(document.getElementById('frame-start')?.value, 10) || 0;
      const frameEnd = parseInt(document.getElementById('frame-end')?.value, 10) || 0;
      const unit = UNITS.find((u) => u.stem === entry.stem || u.path === entry.path);
      const effectStem = (EFFECTS_SPRITE && entry.stem === EFFECTS_SPRITE.stem);
      if (unit && (!presetVal || presetVal === 'custom')) return UNIT_ANIMATIONS;
      if (unit && presetVal) {
        try { return [JSON.parse(presetVal)]; } catch {}
      }
      if (effectStem && (!presetVal || presetVal === 'custom')) return EFFECTS_ANIMATIONS;
      if (effectStem && presetVal) {
        try { return [JSON.parse(presetVal)]; } catch {}
      }
      return [{ name: 'Custom', frames: Array.from({ length: Math.max(0, frameEnd - frameStart + 1) }, (_, i) => frameStart + i) }];
    } catch { return []; }
  }

  updateAnimStripButtons() {
    const anims = this.section2Animations || [];
    const hasAnims = anims.length > 0;
    document.getElementById('anim-export-btn')?.toggleAttribute('disabled', !hasAnims);
    document.getElementById('anim-export-all-btn')?.toggleAttribute('disabled', !hasAnims);
    document.getElementById('anim-test-btn')?.toggleAttribute('disabled', !hasAnims);
    document.getElementById('anim-test-all-btn')?.toggleAttribute('disabled', !hasAnims);
  }

  async generateAnimSpritesheet(anim, stem, sendToTester = false) {
    const meta = this.section2Stem === stem ? this.section2Meta : this.meta;
    if (!anim?.frames?.length || !stem || !meta) return;
    const keyPrefix = `f-${stem}-`;
    const frames = anim.frames;
    let maxW = 0, maxH = 0;
    for (const fi of frames) {
      const key = `${keyPrefix}${fi}`;
      if (!this.textures.exists(key)) return;
      const tex = this.textures.get(key);
      const img = tex.getSourceImage();
      const fd = meta?.frames?.find((f) => f.i === fi);
      const w = fd && fd.w != null ? fd.w : (img?.width ?? 0);
      const h = fd && fd.h != null ? fd.h : (img?.height ?? 0);
      if (w > 0 || h > 0) { maxW = Math.max(maxW, w); maxH = Math.max(maxH, h); }
    }
    if (maxW <= 0) maxW = 64;
    if (maxH <= 0) maxH = 64;
    const pad = 1;
    const canvas = document.createElement('canvas');
    canvas.width = (maxW + pad * 2) * frames.length;
    canvas.height = maxH + pad * 2;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < frames.length; i++) {
      const fi = frames[i];
      const key = `${keyPrefix}${fi}`;
      const tex = this.textures.get(key);
      const img = tex.getSourceImage();
      if (!img) continue;
        const fd = meta.frames?.find((f) => f.i === fi);
      const ox = fd ? (fd.ox / (img.width || 1)) : 0.5;
      const oy = fd ? (fd.oy / (img.height || 1)) : 0.5;
      const x = i * (maxW + pad * 2) + pad - img.width * ox;
      const y = pad - img.height * oy;
      if (anim.flipX) {
        ctx.save();
        ctx.translate(x + img.width, y);
        ctx.scale(-1, 1);
        ctx.translate(-x - img.width, -y);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      } else ctx.drawImage(img, x, y);
    }
    const fw = maxW + pad * 2;
    const fh = maxH + pad * 2;
    const json = { frameWidth: fw, frameHeight: fh, frameCount: frames.length };
    const blob = await new Promise((res, rej) => {
      canvas.toBlob((b) => (b ? res(b) : rej()), 'image/png', 1);
    });
    if (sendToTester) this.loadSpritesheetToTester(blob, json);
    else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${stem}_${(anim.name || 'anim').replace(/\s+/g, '_')}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
    return { blob, json };
  }

  async exportSelectedAnimation() {
    const anims = this.section2Animations || [];
    const idx = this.section2SelectedIndex ?? 0;
    const anim = anims[idx];
    const entry = this.getCurrentSpriteEntry();
    if (!anim || !entry) return;
    if (this.unitGridMeta && this.unitGridStem) {
      this.selectedUnitGridAnim = anim.name;
      await this.exportUnitGridAnimationToSpritesheet(false, 'anim-status', true);
      return;
    }
    await this.generateAnimSpritesheet(anim, entry.stem, false);
    document.getElementById('anim-status').textContent = `Exported ${anim.name || 'animation'}`;
  }

  async exportAllAnimations() {
    const anims = this.section2Animations || [];
    const entry = this.getCurrentSpriteEntry();
    if (!anims.length || !entry) return;
    if (this.unitGridMeta && this.unitGridStem) {
      await this.exportAllUnitGridAnimationsToSpritesheet(false, 'anim-status');
      return;
    }
    for (const anim of anims) {
      await this.generateAnimSpritesheet(anim, entry.stem, false);
    }
    document.getElementById('anim-status').textContent = `Exported ${anims.length} animations`;
  }

  async testSelectedAnimation() {
    const anims = this.section2Animations || [];
    const idx = this.section2SelectedIndex ?? 0;
    const anim = anims[idx];
    const entry = this.getCurrentSpriteEntry();
    if (!anim || !entry) return;
    if (this.unitGridMeta && this.unitGridStem) {
      this.selectedUnitGridAnim = anim.name;
      await this.exportUnitGridAnimationToSpritesheet(true, 'anim-status', true);
      return;
    }
    await this.testAllAnimations();
  }

  async testAllAnimations() {
    const anims = this.section2Animations || [];
    const entry = this.getCurrentSpriteEntry();
    if (!anims.length || !entry) return;
    if (this.unitGridMeta && this.unitGridStem) {
      await this.exportAllUnitGridAnimationsToSpritesheet(true, 'anim-status', true);
      return;
    }
    const allFrames = [];
    let maxW = 0, maxH = 0;
    const keyPrefix = `f-${entry.stem}-`;
    const meta = this.section2Stem === entry.stem ? this.section2Meta : this.meta;
    for (const anim of anims) {
      for (const fi of anim.frames || []) {
        allFrames.push({ fi, flipX: anim.flipX });
        const key = `${keyPrefix}${fi}`;
        if (this.textures.exists(key)) {
          const img = this.textures.get(key).getSourceImage();
          const fd = meta?.frames?.find((f) => f.i === fi);
          const w = fd && fd.w != null ? fd.w : (img?.width ?? 0);
          const h = fd && fd.h != null ? fd.h : (img?.height ?? 0);
          if (w > 0 || h > 0) { maxW = Math.max(maxW, w); maxH = Math.max(maxH, h); }
        }
      }
    }
    if (allFrames.length === 0) return;
    if (maxW <= 0) maxW = 64;
    if (maxH <= 0) maxH = 64;
    const pad = 1;
    const fw = maxW + pad * 2;
    const fh = maxH + pad * 2;
    const canvas = document.createElement('canvas');
    canvas.width = fw * allFrames.length;
    canvas.height = fh;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < allFrames.length; i++) {
      const { fi, flipX } = allFrames[i];
      const key = `${keyPrefix}${fi}`;
      if (!this.textures.exists(key)) continue;
      const img = this.textures.get(key).getSourceImage();
      const meta = this.section2Stem === entry.stem ? this.section2Meta : this.meta;
      const fd = meta?.frames?.find((f) => f.i === fi);
      const ox = fd ? (fd.ox / (img.width || 1)) : 0.5;
      const oy = fd ? (fd.oy / (img.height || 1)) : 0.5;
      const x = i * fw + pad - img.width * ox;
      const y = pad - img.height * oy;
      if (flipX) {
        ctx.save();
        ctx.translate(x + img.width, y);
        ctx.scale(-1, 1);
        ctx.translate(-x - img.width, -y);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      } else ctx.drawImage(img, x, y);
    }
    const json = { frameWidth: fw, frameHeight: fh, frameCount: allFrames.length };
    const blob = await new Promise((res, rej) => {
      canvas.toBlob((b) => (b ? res(b) : rej()), 'image/png', 1);
    });
    this.loadSpritesheetToTester(blob, json);
    document.getElementById('anim-status').textContent = `Sent ${allFrames.length} frames to tester`;
  }

  getCurrentSpriteEntry() {
    if (this.section2Stem && this.section2AnimStripSprites?.length > 0) {
      const unitVal = document.getElementById('anim-unit-select')?.value;
      if (unitVal === '__custom__') {
        const customVal = document.getElementById('anim-custom-sprite')?.value;
        if (customVal) try { return JSON.parse(customVal); } catch {}
        return null;
      }
      if (unitVal) {
        try { return JSON.parse(unitVal); } catch {}
      }
    }
    const val = document.getElementById('sprite-select')?.value;
    if (!val) return null;
    try { return JSON.parse(val); } catch { return null; }
  }

  setupUnitsShootControls() {
    const scaleIn = document.getElementById('units-shoot-scale');
    const scaleVal = document.getElementById('units-shoot-scale-val');
    const offsetXIn = document.getElementById('units-shoot-offset-x');
    const offsetYIn = document.getElementById('units-shoot-offset-y');
    const frameIn = document.getElementById('units-shoot-frame');
    const modbCheck = document.getElementById('units-use-modb-points');
    const resetBtn = document.getElementById('units-shoot-reset-btn');
    const writeToSelection = () => {
      if (!this.selectedUnitGridAnim) return;
      if (!this.unitShootEffectByAnim[this.selectedUnitGridAnim]) {
        this.unitShootEffectByAnim[this.selectedUnitGridAnim] = {};
      }
      const entry = this.unitShootEffectByAnim[this.selectedUnitGridAnim];
      if (scaleIn) entry.scale = parseFloat(scaleIn.value) || SHOOT_EFFECT_SCALE;
      if (offsetXIn) entry.offsetX = parseFloat(offsetXIn.value) || 0;
      if (offsetYIn) entry.offsetY = parseFloat(offsetYIn.value) || 0;
      if (frameIn) {
        const v = parseInt(frameIn.value, 10);
        entry.shootFrame = Number.isFinite(v) ? Math.max(0, v) : 2;
      }
      if (modbCheck) entry.useModbPoints = modbCheck.checked;
    };
    if (scaleIn) {
      scaleIn.addEventListener('input', () => {
        writeToSelection();
        if (scaleVal) scaleVal.textContent = (parseFloat(scaleIn.value) || SHOOT_EFFECT_SCALE).toFixed(2);
      });
    }
    if (offsetXIn) offsetXIn.addEventListener('input', () => { writeToSelection(); });
    if (offsetYIn) offsetYIn.addEventListener('input', () => { writeToSelection(); });
    if (frameIn) frameIn.addEventListener('input', () => { writeToSelection(); });
    if (modbCheck) modbCheck.addEventListener('change', () => { writeToSelection(); });
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (this.selectedUnitGridAnim) {
          const shoot = ATTACK_TO_SHOOT_EFFECT[this.selectedUnitGridAnim];
          const comp = this.animationCompositions?.compositions?.find((c) => c.id === `${this.unitGridStem}/${this.selectedUnitGridAnim}`);
          const overlay = comp?.layers?.find((l) => l.stem === 'Extras');
          this.unitShootEffectByAnim[this.selectedUnitGridAnim] = {
            scale: overlay?.scale ?? 0.3,
            offsetX: overlay?.offsetX ?? shoot?.offsetX ?? 0,
            offsetY: overlay?.offsetY ?? shoot?.offsetY ?? 0,
            shootFrame: 2,
            useModbPoints: true,
          };
        } else {
          this.unitShootEffectScale = SHOOT_EFFECT_SCALE;
          this.unitShootOffsetX = 0;
          this.unitShootOffsetY = 0;
          this.unitShootFrame = 2;
          this.unitUseModbPoints = true;
        }
        this.syncUnitsControlsToSelection();
      });
    }
    if (scaleVal && this.selectedUnitGridAnim) {
      const s = this.getUnitShootSettings(this.selectedUnitGridAnim);
      scaleVal.textContent = s.scale.toFixed(2);
    }
  }

  setupConfigureTab() {
    const allAnims = getAllAnimations();
    const compSel = document.getElementById('configure-composition-select');
    if (compSel) {
      this.buildConfigureCompositionSelector();
      compSel.addEventListener('change', () => this.onConfigureCompositionSelect());
    }
    for (let i = 1; i <= 3; i++) {
      const sel = document.getElementById(`configure-slot-${i}`);
      sel.innerHTML = '<option value="">-- None --</option>';
      for (const a of allAnims) {
        const opt = document.createElement('option');
        opt.value = JSON.stringify(a);
        opt.textContent = a.displayName;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => this.onConfigureSlotChange(i));
      document.getElementById(`configure-layer-${i}`).addEventListener('change', () => this.onConfigureSlotChange(i));
      const scaleIn = document.getElementById(`configure-scale-${i}`);
      const fpsIn = document.getElementById(`configure-fps-${i}`);
      if (scaleIn) {
        scaleIn.addEventListener('input', () => this.onConfigureScaleChange(i));
      }
      if (fpsIn) {
        fpsIn.addEventListener('change', () => this.onConfigureSlotChange(i));
      }
    }
    document.getElementById('configure-play-btn').addEventListener('click', () => this.toggleConfigurePlay());
    document.getElementById('configure-step-btn').addEventListener('click', () => this.stepConfigureFrame());
    document.getElementById('configure-save-btn').addEventListener('click', () => this.saveConfigureComposition());
    document.getElementById('configure-export-btn').addEventListener('click', () => this.exportCompositionToSpritesheet());
    document.getElementById('configure-test-btn').addEventListener('click', () => this.exportCompositionToSpritesheet(true));
    document.getElementById('configure-zoom-in')?.addEventListener('click', () => {
      this.configureZoom = Math.min(5, this.configureZoom + 0.25);
      if (this.configureGridContainer) this.configureGridContainer.setScale(this.configureZoom);
      const el = document.getElementById('configure-zoom-level');
      if (el) el.textContent = `${Math.round(this.configureZoom * 100)}%`;
    });
    document.getElementById('configure-zoom-out')?.addEventListener('click', () => {
      this.configureZoom = Math.max(0.5, this.configureZoom - 0.25);
      if (this.configureGridContainer) this.configureGridContainer.setScale(this.configureZoom);
      const el = document.getElementById('configure-zoom-level');
      if (el) el.textContent = `${Math.round(this.configureZoom * 100)}%`;
    });

    const canvas = this.game.canvas;
    canvas.addEventListener('wheel', (e) => {
      const rect = canvas.getBoundingClientRect();
      const py = e.clientY - rect.top;
      const sh = rect.height;
      const section = py < sh * 0.2 ? 1 : py < sh * 0.4 ? 2 : py < sh * 0.65 ? 3 : 4;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      if (section === 1) {
        this.section1Zoom = Math.max(0.5, Math.min(5, this.section1Zoom + delta));
        this.sectionCameras[0].camera.setZoom(this.section1Zoom);
      } else if (section === 2) {
        this.section2Zoom = Math.max(0.5, Math.min(5, this.section2Zoom + delta));
        this.sectionCameras[1].camera.setZoom(this.section2Zoom);
      } else if (section === 3) {
        this.configureZoom = Math.max(0.5, Math.min(5, this.configureZoom + delta));
        if (this.configureGridContainer) {
          this.configureGridContainer.setScale(this.configureZoom);
        }
        const zoomEl = document.getElementById('configure-zoom-level');
        if (zoomEl) zoomEl.textContent = `${Math.round(this.configureZoom * 100)}%`;
        const statusEl = document.getElementById('configure-status');
        if (statusEl) statusEl.textContent = `Zoom ${Math.round(this.configureZoom * 100)}% — scroll to zoom, drag sprites`;
      } else if (section === 4) {
        this.spritesheetTesterZoom = Math.max(0.5, Math.min(5, this.spritesheetTesterZoom + delta));
        this.sectionCameras[3].camera.setZoom(this.spritesheetTesterZoom);
        const zoomEl = document.getElementById('tester-zoom-level');
        if (zoomEl) zoomEl.textContent = `${Math.round(this.spritesheetTesterZoom * 100)}%`;
        const statusEl = document.getElementById('tester-status');
        if (statusEl) statusEl.textContent = `Zoom ${Math.round(this.spritesheetTesterZoom * 100)}% — scroll to zoom`;
      }
    }, { passive: false });

    const moveSlotEl = document.getElementById('configure-move-slot');
    if (moveSlotEl) {
      moveSlotEl.addEventListener('change', () => {
        this.configureMoveSlot = Math.max(1, Math.min(3, parseInt(moveSlotEl.value, 10) || 1));
        this.updateConfigureMoveSlotDropdown();
      });
    }

    this.input.on('pointerdown', (pointer) => {
      const el = document.getElementById('section-3-canvas');
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const event = pointer.event;
      if (event && rect.left <= event.clientX && event.clientX <= rect.right && rect.top <= event.clientY && event.clientY <= rect.bottom) {
        const slotIndex = this.configureMoveSlot;
        const cell = this.configureGridSprites.find((c) => c.slot?.slotIndex === slotIndex);
        if (cell) {
          this.configureDragState = { slotIndex, sprite: cell.sprite };
          const statusEl = document.getElementById('configure-status');
          if (statusEl) statusEl.textContent = `Dragging Slot ${slotIndex} — release to drop`;
        }
      }
    });

    this.input.on('pointermove', (pointer) => {
      if (!this.configureDragState) return;
      const { slotIndex, sprite } = this.configureDragState;
      const band = this.SECTION_BANDS?.[2];
      const centerX = 400;
      const centerY = band ? band.y + band.h / 2 : 250;
      if (pointer.isDown) {
        const localX = (pointer.worldX - centerX) / this.configureZoom;
        const localY = (pointer.worldY - centerY) / this.configureZoom;
        sprite.setPosition(localX, localY);
        if (this.configureSlots[slotIndex - 1]) {
          this.configureSlots[slotIndex - 1].offsetX = Math.round(localX);
          this.configureSlots[slotIndex - 1].offsetY = Math.round(localY);
        }
      }
    });

    this.input.on('pointerup', () => {
      if (this.configureDragState) {
        const { slotIndex, sprite } = this.configureDragState;
        if (this.configureSlots[slotIndex - 1]) {
          this.configureSlots[slotIndex - 1].offsetX = Math.round(sprite.x);
          this.configureSlots[slotIndex - 1].offsetY = Math.round(sprite.y);
        }
        this.configureDragState = null;
        const statusEl = document.getElementById('configure-status');
        if (statusEl) statusEl.textContent = 'Drag or use arrow keys to move selected layer, then Save';
      }
    });

    document.addEventListener('keydown', (e) => {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
      const slot = this.configureSlots[this.configureMoveSlot - 1];
      if (!slot) return;
      const step = e.shiftKey ? 5 : 1;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else return;
      e.preventDefault();
      slot.offsetX += dx;
      slot.offsetY += dy;
      const cell = this.configureGridSprites.find((c) => c.slot.slotIndex === this.configureMoveSlot);
      if (cell) {
        cell.sprite.setPosition(slot.offsetX, slot.offsetY);
      }
      const statusEl = document.getElementById('configure-status');
      if (statusEl) statusEl.textContent = `Slot ${this.configureMoveSlot}: (${slot.offsetX}, ${slot.offsetY}) — arrow keys or drag`;
    });
  }

  setupSpritesheetTester() {
    this.loadSpritesheetTesterMap();
    const fpsEl = document.getElementById('tester-fps');
    if (fpsEl) fpsEl.addEventListener('change', () => {
      this.spritesheetTesterFps = Math.max(1, Math.min(60, parseInt(fpsEl.value, 10) || 8));
    });
    this.spritesheetTesterFps = 8;
    document.getElementById('tester-zoom-in')?.addEventListener('click', () => {
      this.spritesheetTesterZoom = Math.min(5, this.spritesheetTesterZoom + 0.25);
      this.sectionCameras[3].camera.setZoom(this.spritesheetTesterZoom);
      const el = document.getElementById('tester-zoom-level');
      if (el) el.textContent = `${Math.round(this.spritesheetTesterZoom * 100)}%`;
    });
    document.getElementById('tester-zoom-out')?.addEventListener('click', () => {
      this.spritesheetTesterZoom = Math.max(0.5, this.spritesheetTesterZoom - 0.25);
      this.sectionCameras[3].camera.setZoom(this.spritesheetTesterZoom);
      const el = document.getElementById('tester-zoom-level');
      if (el) el.textContent = `${Math.round(this.spritesheetTesterZoom * 100)}%`;
    });
  }

  async loadSpritesheetTesterManifest() {
    const sel = document.getElementById('spritesheet-tester-select');
    if (!sel) return;
    try {
      const res = await fetch('/spritesheets-test/spritesheets.json');
      if (!res.ok) throw new Error('Manifest not found');
      const list = await res.json();
      sel.innerHTML = '<option value="">-- Select spritesheet --</option>';
      for (const item of list) {
        const opt = document.createElement('option');
        opt.value = JSON.stringify(item);
        opt.textContent = item.label || item.png || item.id;
        sel.appendChild(opt);
      }
    } catch {
      sel.innerHTML = '<option value="">-- No spritesheets (add to spritesheets-test/) --</option>';
    }
  }

  async loadSpritesheetTesterMap() {
    if (this.spritesheetTesterMapLoaded) {
      this.buildSpritesheetTesterMap();
      this.restoreSpritesheetTesterSprite();
      return;
    }
    this.load.image('map-layer0', '/maps/map_layer0.png');
    this.load.image('map-layer1-raw', '/maps/map_layer1.png');
    this.load.once('complete', () => {
      this.processMapLayer1Transparency();
      this.spritesheetTesterMapLoaded = true;
      this.buildSpritesheetTesterMap();
    });
    this.load.once('loaderror', () => {
      document.getElementById('tester-status').textContent = 'Map not found — add map_layer0.png and map_layer1.png to maps/';
    });
    this.load.start();
  }

  /** Makes black/dark pixels in layer 1 transparent so it overlays layer 0 correctly. */
  processMapLayer1Transparency() {
    if (!this.textures.exists('map-layer1-raw')) return;
    const img = this.textures.get('map-layer1-raw').getSourceImage();
    if (!img || !img.complete) return;
    const w = img.width;
    const h = img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const BLACK_THRESHOLD = 30;
    for (let i = 0; i < data.data.length; i += 4) {
      const r = data.data[i];
      const g = data.data[i + 1];
      const b = data.data[i + 2];
      if (r <= BLACK_THRESHOLD && g <= BLACK_THRESHOLD && b <= BLACK_THRESHOLD) {
        data.data[i + 3] = 0;
      }
    }
    ctx.putImageData(data, 0, 0);
    this.textures.remove('map-layer1-raw');
    this.textures.addCanvas('map-layer1', canvas);
  }

  loadSpritesheetToTester(pngBlob, jsonConfig) {
    const { frameWidth, frameHeight, frameCount } = jsonConfig;
    const url = URL.createObjectURL(pngBlob);
    if (this.spritesheetTesterSprite) {
      this.spritesheetTesterSprite.destroy();
      this.spritesheetTesterSprite = null;
    }
    if (this.textures.exists('spritesheet-test')) this.textures.remove('spritesheet-test');
    this.spritesheetTesterConfig = { frameWidth, frameHeight, frameCount };
    this.load.reset();
    this.load.spritesheet('spritesheet-test', url, { frameWidth, frameHeight });
    this.load.once('complete', () => {
      URL.revokeObjectURL(url);
      this.spritesheetTesterFrameIndex = 0;
      const { x: cx, y: cy } = this.getSection4Center();
      this.spritesheetTesterSprite = this.add.sprite(cx, cy, 'spritesheet-test', 0);
      this.spritesheetTesterSprite.setDepth(100);
      this.spritesheetTesterSprite.setOrigin(0.5, 0.5);
      this.spritesheetTesterSprite.setInteractive({ draggable: true });
      this.spritesheetTesterSprite.on('drag', (ptr, dx, dy) => {
        this.spritesheetTesterSprite.x += dx;
        this.spritesheetTesterSprite.y += dy;
      });
      const statusEl = document.getElementById('tester-status');
      if (statusEl) statusEl.textContent = `Loaded — ${frameCount} frames (drag to move)`;
    });
    this.load.once('loaderror', () => {
      URL.revokeObjectURL(url);
      const statusEl = document.getElementById('tester-status');
      if (statusEl) statusEl.textContent = 'Failed to load spritesheet';
    });
    this.load.start();
  }

  getSection4Center() {
    const cam = this.sectionCameras?.[3]?.camera;
    if (cam) {
      return { x: cam.scrollX + cam.width / 2, y: cam.scrollY + cam.height / 2 };
    }
    const band = this.SECTION_BANDS?.[3];
    return { x: 400, y: (band?.y ?? 380) + (band?.h ?? 220) / 2 };
  }

  buildSpritesheetTesterMap() {
    this.destroySpritesheetTesterMap();
    if (!this.textures.exists('map-layer0')) return;
    const { x: centerX, y: centerY } = this.getSection4Center();
    const cam = this.sectionCameras?.[3]?.camera;
    const w = cam?.width ?? 800;
    const h = cam?.height ?? this.SECTION_BANDS?.[3]?.h ?? 310;
    const img0 = this.textures.get('map-layer0').getSourceImage();
    const img1 = this.textures.exists('map-layer1') ? this.textures.get('map-layer1').getSourceImage() : null;
    const scale0 = Math.max(w / (img0?.width || 1), h / (img0?.height || 1));
    const sprite0 = this.add.image(centerX, centerY, 'map-layer0').setDepth(0);
    sprite0.setScale(scale0);
    sprite0.setData('layerIndex', 0);
    this.spritesheetTesterMapSprites.push(sprite0);
    if (img1) {
      const scale1 = Math.max(w / (img1.width || 1), h / (img1.height || 1));
      const sprite1 = this.add.image(centerX, centerY, 'map-layer1').setDepth(1);
      sprite1.setScale(scale1);
      sprite1.setData('layerIndex', 1);
      this.spritesheetTesterMapSprites.push(sprite1);
    }
    this.updateSpritesheetTesterLayerVisibility();
  }

  updateSpritesheetTesterLayerVisibility() {
    const showLayer0 = true;
    const showLayer1 = true;
    for (const s of this.spritesheetTesterMapSprites) {
      const idx = s.getData?.('layerIndex') ?? -1;
      if (idx === 0) s.setVisible(showLayer0);
      else if (idx === 1) s.setVisible(showLayer1);
    }
  }

  destroySpritesheetTesterMap() {
    for (const s of this.spritesheetTesterMapSprites) {
      s.destroy();
    }
    this.spritesheetTesterMapSprites = [];
  }

  hideSpritesheetTester() {
    if (this.spritesheetTesterSprite) {
      this.spritesheetTesterSprite.destroy();
      this.spritesheetTesterSprite = null;
    }
    this.destroySpritesheetTesterMap();
  }

  restoreSpritesheetTesterSprite() {
    if (!this.textures.exists('spritesheet-test') || !this.spritesheetTesterConfig) return;
    const { x: centerX, y: centerY } = this.getSection4Center();
    const frameIndex = Math.min(this.spritesheetTesterFrameIndex, this.textures.get('spritesheet-test').frameTotal - 1);
    this.spritesheetTesterSprite = this.add.sprite(centerX, centerY, 'spritesheet-test', Math.max(0, frameIndex));
    this.spritesheetTesterSprite.setDepth(100);
    this.spritesheetTesterSprite.setOrigin(0.5, 0.5);
    this.spritesheetTesterSprite.setVisible(true);
  }

  onSpritesheetTesterSelect() {
    const sel = document.getElementById('spritesheet-tester-select');
    const val = sel?.value;
    if (!val) {
      if (this.spritesheetTesterSprite) {
        this.spritesheetTesterSprite.destroy();
        this.spritesheetTesterSprite = null;
      }
      if (this.textures.exists('spritesheet-test')) this.textures.remove('spritesheet-test');
      this.spritesheetTesterConfig = null;
      document.getElementById('spritesheet-tester-status').textContent = 'Select a spritesheet from the dropdown';
      return;
    }

    let config;
    try {
      config = JSON.parse(val);
    } catch {
      document.getElementById('spritesheet-tester-status').textContent = 'Invalid selection';
      return;
    }

    const { png, frameWidth = 64, frameHeight = 64, frameCount = 5 } = config;
    if (!png) {
      document.getElementById('spritesheet-tester-status').textContent = 'Missing PNG path';
      return;
    }

    this.spritesheetTesterConfig = { frameWidth, frameHeight, frameCount };
    document.getElementById('spritesheet-tester-status').textContent = 'Loading...';

    if (this.spritesheetTesterSprite) {
      this.spritesheetTesterSprite.destroy();
      this.spritesheetTesterSprite = null;
    }
    if (this.textures.exists('spritesheet-test')) {
      this.textures.remove('spritesheet-test');
    }

    const url = `/spritesheets-test/${png}`;
    this.load.reset();
    this.load.spritesheet('spritesheet-test', url, { frameWidth, frameHeight });
    this.load.once('complete', () => {
      this.spritesheetTesterFrameIndex = 0;
      const { x: centerX, y: centerY } = this.getSection4Center();
      this.spritesheetTesterSprite = this.add.sprite(centerX, centerY, 'spritesheet-test', 0);
      this.spritesheetTesterSprite.setDepth(100);
      this.spritesheetTesterSprite.setOrigin(0.5, 0.5);
      this.spritesheetTesterSprite.setInteractive({ draggable: true });
      this.spritesheetTesterSprite.on('drag', (ptr, dx, dy) => {
        this.spritesheetTesterSprite.x += dx;
        this.spritesheetTesterSprite.y += dy;
      });
      this.spritesheetTesterSprite.setVisible(true);
      document.getElementById('spritesheet-tester-status').textContent = `Loaded — ${frameCount} frames at 8 FPS`;
    });
    this.load.once('loaderror', () => {
      document.getElementById('spritesheet-tester-status').textContent = 'Failed to load spritesheet';
    });
    this.load.start();
  }

  buildConfigureCompositionSelector() {
    const compSel = document.getElementById('configure-composition-select');
    if (!compSel) return;
    const currentVal = compSel.value;
    compSel.innerHTML = '<option value="">-- Select animation --</option>';
    for (const c of SWAT_ATTACK_COMPOSITIONS) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.label;
      compSel.appendChild(opt);
    }
    const existing = this.animationCompositions?.compositions ?? [];
    const swatIds = new Set(SWAT_ATTACK_COMPOSITIONS.map((c) => c.id));
    for (const comp of existing) {
      if (!swatIds.has(comp.id)) {
        const opt = document.createElement('option');
        opt.value = comp.id;
        opt.textContent = comp.id;
        compSel.appendChild(opt);
      }
    }
    const optNew = document.createElement('option');
    optNew.value = '__new__';
    optNew.textContent = 'New composition…';
    compSel.appendChild(optNew);
    if (currentVal) compSel.value = currentVal;
  }

  onConfigureCompositionSelect() {
    const compSel = document.getElementById('configure-composition-select');
    const val = compSel?.value;
    const allAnims = getAllAnimations();
    this.configureEditingId = val === '__new__' ? null : (val || null);

    document.getElementById('configure-id-label').style.display = val && val !== '__new__' ? 'inline' : 'none';
    document.getElementById('configure-id-input-label').style.display = val === '__new__' ? 'inline' : 'none';
    if (val && val !== '__new__') {
      document.getElementById('configure-id-display').textContent = val;
    }

    this.configureSlots = [null, null, null];
    if (!val || val === '__new__') {
      this.buildConfigureSlotsUI();
      this.loadConfigureTextures();
      return;
    }

    const comp = this.animationCompositions?.compositions?.find((c) => c.id === val);
    const swatDef = SWAT_ATTACK_COMPOSITIONS.find((c) => c.id === val);

    if (swatDef) {
      const animName = swatDef.id.replace('SWAT/', '');
      const unitEntry = allAnims.find((a) => a.stem === 'SWAT' && a.anim?.name === animName);
      const effectEntry = allAnims.find((a) => a.stem === 'Extras' && a.anim?.name === swatDef.shootAnim);
      if (!unitEntry || !effectEntry) return;
      const unitLayer = comp?.layers?.find((l) => l.stem === 'SWAT');
      const effectLayer = comp?.layers?.find((l) => l.stem === 'Extras');
      this.configureSlots = [
        {
          animEntry: unitEntry,
          layer: unitLayer?.layer ?? 0,
          offsetX: unitLayer?.offsetX ?? 0,
          offsetY: unitLayer?.offsetY ?? 3,
          scale: unitLayer?.scale ?? 0.5,
          fps: unitLayer?.fps ?? 8,
          slotIndex: 1,
          timelineBlocks: [],
        },
        {
          animEntry: effectEntry,
          layer: effectLayer?.layer ?? 1,
          offsetX: effectLayer?.offsetX ?? (ATTACK_TO_SHOOT_EFFECT[animName]?.offsetX ?? 0),
          offsetY: effectLayer?.offsetY ?? (ATTACK_TO_SHOOT_EFFECT[animName]?.offsetY ?? 0),
          scale: effectLayer?.scale ?? 0.3,
          fps: effectLayer?.fps ?? 4,
          slotIndex: 2,
          timelineBlocks: effectLayer?.timelineBlocks ?? [{ baseFrame: 2 }],
        },
        null,
      ];
    } else if (comp?.layers?.length) {
      const slots = [];
      for (let i = 0; i < Math.min(3, comp.layers.length); i++) {
        const layer = comp.layers[i];
        const entry = allAnims.find((a) => a.path === layer.source && a.stem === layer.stem && a.anim?.name === layer.anim);
        if (entry) {
          slots.push({
            animEntry: entry,
            layer: layer.layer ?? i,
            offsetX: layer.offsetX ?? 0,
            offsetY: layer.offsetY ?? 0,
            scale: layer.scale ?? (layer.stem === 'Extras' ? 0.2 : 0.5),
            fps: layer.fps ?? 8,
            slotIndex: slots.length + 1,
            timelineBlocks: layer.timelineBlocks ?? [],
          });
        }
      }
      while (slots.length < 3) slots.push(null);
      this.configureSlots = slots.slice(0, 3);
    }
    this.buildConfigureSlotsUI();
    this.loadConfigureTextures();
  }

  buildConfigureSlotsUI() {
    for (let i = 1; i <= 3; i++) {
      const slot = this.configureSlots[i - 1];
      const layerSel = document.getElementById(`configure-layer-${i}`);
      const scaleIn = document.getElementById(`configure-scale-${i}`);
      const scaleVal = document.getElementById(`configure-scale-val-${i}`);
      const fpsIn = document.getElementById(`configure-fps-${i}`);
      const slotSel = document.getElementById(`configure-slot-${i}`);
      if (!slotSel) continue;
      if (slot) {
        const match = Array.from(slotSel.options).find((o) => {
          try {
            const j = JSON.parse(o.value);
            return j?.stem === slot.animEntry?.stem && j?.anim?.name === slot.animEntry?.anim?.name;
          } catch {
            return false;
          }
        });
        if (match) slotSel.value = match.value;
        if (layerSel) layerSel.value = String(slot.layer);
        if (scaleIn) {
          scaleIn.value = String(slot.scale ?? 0.5);
          if (scaleVal) scaleVal.textContent = String(slot.scale ?? 0.5);
        }
        if (fpsIn) fpsIn.value = String(slot.fps ?? 8);
      } else {
        slotSel.value = '';
        if (layerSel) layerSel.value = i === 1 ? '0' : i === 2 ? '1' : '2';
        if (scaleIn) {
          scaleIn.value = i === 1 ? '0.5' : '0.3';
          if (scaleVal) scaleVal.textContent = i === 1 ? '0.5' : '0.3';
        }
        if (fpsIn) fpsIn.value = '8';
      }
    }
    this.updateConfigureMoveSlotDropdown();
  }

  updateConfigureMoveSlotDropdown() {
    const sel = document.getElementById('configure-move-slot');
    if (!sel) return;
    const filled = [];
    for (let i = 1; i <= 3; i++) {
      const slot = this.configureSlots[i - 1];
      if (slot) {
        const name = slot.animEntry?.displayName || `Slot ${i}`;
        filled.push({ value: String(i), label: `Slot ${i}: ${name}` });
      }
    }
    sel.innerHTML = '';
    for (const { value, label } of filled) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label.length > 40 ? label.slice(0, 37) + '…' : label;
      sel.appendChild(opt);
    }
    if (filled.length > 0 && !filled.find((f) => f.value === String(this.configureMoveSlot))) {
      this.configureMoveSlot = parseInt(filled[0].value, 10);
    }
    if (filled.length > 0) sel.value = String(this.configureMoveSlot);
  }

  onConfigureSlotChange(slotIndex) {
    const sel = document.getElementById(`configure-slot-${slotIndex}`);
    const layerSel = document.getElementById(`configure-layer-${slotIndex}`);
    const scaleIn = document.getElementById(`configure-scale-${slotIndex}`);
    const fpsIn = document.getElementById(`configure-fps-${slotIndex}`);
    const val = sel.value;
    if (!val) {
      this.configureSlots[slotIndex - 1] = null;
    } else {
      const animEntry = JSON.parse(val);
      const layer = parseInt(layerSel.value, 10);
      const existing = this.configureSlots[slotIndex - 1];
      const scale = scaleIn ? parseFloat(scaleIn.value) || 0.5 : (existing?.animEntry?.stem === 'Extras' ? 0.2 : 0.5);
      const fps = fpsIn ? Math.max(1, Math.min(60, parseInt(fpsIn.value, 10) || 8)) : (existing?.fps ?? 8);
      this.configureSlots[slotIndex - 1] = {
        animEntry,
        layer,
        offsetX: existing?.offsetX ?? 0,
        offsetY: existing?.offsetY ?? 0,
        scale,
        fps,
        slotIndex,
        timelineBlocks: existing?.timelineBlocks ?? [],
      };
    }
    this.loadConfigureTextures();
  }

  onConfigureScaleChange(slotIndex) {
    const scaleIn = document.getElementById(`configure-scale-${slotIndex}`);
    const valSpan = document.getElementById(`configure-scale-val-${slotIndex}`);
    const v = parseFloat(scaleIn?.value) || 0.5;
    if (valSpan) valSpan.textContent = String(v);
    const slot = this.configureSlots[slotIndex - 1];
    if (slot) slot.scale = v;
    const cell = this.configureGridSprites.find((c) => c.slot.slotIndex === slotIndex);
    if (cell) cell.sprite.setScale(v);
  }

  async loadConfigureTextures() {
    const slots = this.configureSlots.filter(Boolean);
    if (slots.length === 0) {
      this.destroyConfigureGrid();
      document.getElementById('configure-status').textContent = 'Configure — select animations, drag to position, save';
      return;
    }
    if (this.configureLoadInProgress) return;

    const toLoad = new Map(); // path -> { path, stem, meta }
    for (const slot of slots) {
      const { path, stem } = slot.animEntry;
      const key = `${path}:${stem}`;
      if (!toLoad.has(key)) toLoad.set(key, { path, stem });
    }

    for (const { path, stem } of toLoad.values()) {
      if (this.configureGridMeta[stem]) continue;
      try {
        const res = await fetch(`/${path}/${stem}_frames.json`);
        if (res.ok) this.configureGridMeta[stem] = await res.json();
      } catch {
        // ignore
      }
    }

    this.configureLoadInProgress = true;
    document.getElementById('configure-status').textContent = 'Loading...';

    const keyPrefixes = new Set();
    for (const slot of slots) {
      const { path, stem } = slot.animEntry;
      keyPrefixes.add(`${path}:${stem}`);
    }

    for (const key of keyPrefixes) {
      const [path, stem] = key.split(':');
      const meta = this.configureGridMeta[stem];
      if (!meta) continue;
      const totalFrames = meta.total_frames || meta.frames?.length || 0;
      const loadKeyPrefix = `f-${stem}-`;
      for (let i = 0; i < totalFrames; i++) {
        const pad = String(i).padStart(4, '0');
        this.load.image(`${loadKeyPrefix}${i}`, `/${path}/${stem}_${pad}.png`);
      }
    }

    this.load.once('complete', () => {
      this.configureLoadInProgress = false;
      this.buildConfigureGrid();
      document.getElementById('configure-status').textContent = 'Drag sprites to position, then Save';
    });
    this.load.once('loaderror', () => {
      this.configureLoadInProgress = false;
      document.getElementById('configure-status').textContent = 'Load error';
    });
    this.load.start();
  }

  buildConfigureGrid() {
    this.destroyConfigureGrid();
    for (let i = 0; i < this.configureSlots.length; i++) {
      const s = this.configureSlots[i];
      if (s) s.slotIndex = i + 1;
    }
    const band = this.SECTION_BANDS?.[2];
    const centerX = 400;
    const centerY = band ? band.y + band.h / 2 : 250;
    const gridSize = 400;
    const half = gridSize / 2;

    // Container for zoom: center at (400,300), origin at center, content in local coords
    this.configureGridContainer = this.add.container(centerX, centerY);
    this.configureGridContainer.setScale(this.configureZoom);
    this.configureGridContainer.setDepth(0);

    // Grid graphics in local coords (-200 to 200)
    this.configureGridGraphics = this.add.graphics();
    this.configureGridGraphics.lineStyle(1, 0x333333);
    for (let i = 0; i <= 10; i++) {
      const off = -half + (gridSize / 10) * i;
      this.configureGridGraphics.lineBetween(-half, off, half, off);
      this.configureGridGraphics.lineBetween(off, -half, off, half);
    }
    this.configureGridGraphics.lineStyle(2, 0x555555);
    this.configureGridGraphics.lineBetween(-10, 0, 10, 0);
    this.configureGridGraphics.lineBetween(0, -10, 0, 10);
    this.configureGridContainer.add(this.configureGridGraphics);

    const slots = this.configureSlots
      .map((s, i) => (s ? { ...s, slotIndex: i + 1 } : null))
      .filter(Boolean)
      .sort((a, b) => a.layer - b.layer);

    for (const slot of slots) {
      const { animEntry, layer, offsetX, offsetY, slotIndex } = slot;
      const { path, stem, anim } = animEntry;
      const frameI = anim.frames[0];
      const key = `f-${stem}-${frameI}`;
      if (!this.textures.exists(key)) continue;

      const scale = slot.scale ?? (stem === 'Extras' ? 0.2 : 0.5);

      const sprite = this.add.sprite(offsetX, offsetY, key);
      sprite.setScale(scale);
      sprite.setDepth(10 + layer);
      if (anim.flipX) sprite.setFlipX(true);

      const meta = this.configureGridMeta[stem];
      const frameData = meta?.frames?.find((f) => f.i === frameI);
      if (frameData) {
        const tex = sprite.texture;
        const w = tex.getSourceImage().width || 1;
        const h = tex.getSourceImage().height || 1;
        sprite.setOrigin(
          Math.max(0, Math.min(1, frameData.ox / w)),
          Math.max(0, Math.min(1, frameData.oy / h))
        );
      }

      sprite.setInteractive({ useHandCursor: true });
      sprite.setData('slotIndex', slotIndex);

      this.configureGridContainer.add(sprite);
      this.configureGridSprites.push({
        sprite,
        slot,
        frameIndex: 0,
        lastAdvance: 0,
      });
    }
    this.updateConfigureMoveSlotDropdown();
    this.computeConfigureOutputFrameList();
    this.buildConfigureTimeline();
    this.updateSectionCameraIgnores();
    this.applyConfigureOutputFrame();
  }

  destroyConfigureGrid() {
    if (this.configureGridContainer) {
      this.configureGridContainer.destroy();
      this.configureGridContainer = null;
    }
    this.configureGridGraphics = null;
    this.configureGridSprites = [];
  }

  /** Compute output frame list from slots + timelineBlocks. Each output frame = which layer frames to show. */
  computeConfigureOutputFrameList() {
    const slots = this.configureSlots.filter(Boolean).sort((a, b) => a.layer - b.layer);
    if (slots.length === 0) {
      this.configureOutputFrameList = [];
      return;
    }
    const baseSlot = slots[0];
    const baseFrames = baseSlot.animEntry?.anim?.frames ?? [];
    const list = [];
    for (let baseIdx = 0; baseIdx < baseFrames.length; baseIdx++) {
      const overlaySlots = slots.filter((s) => s.layer > 0 && (s.timelineBlocks ?? []).some((b) => b.baseFrame === baseIdx));
      if (overlaySlots.length === 0) {
        list.push({ layers: [{ slotIndex: baseSlot.slotIndex ?? 1, frameI: baseFrames[baseIdx] }] });
      } else {
        const n = Math.max(1, ...overlaySlots.map((s) => (s.animEntry?.anim?.frames?.length ?? 1)));
        for (let i = 0; i < n; i++) {
          const layers = [{ slotIndex: baseSlot.slotIndex ?? 1, frameI: baseFrames[baseIdx] }];
          for (const ov of overlaySlots) {
            const frames = ov.animEntry?.anim?.frames ?? [];
            const fi = frames[i % frames.length];
            if (fi != null) layers.push({ slotIndex: ov.slotIndex ?? 0, frameI: fi });
          }
          list.push({ layers });
        }
      }
    }
    this.configureOutputFrameList = list;
    this.configureOutputFrameIndex = Math.min(this.configureOutputFrameIndex, Math.max(0, list.length - 1));
  }

  buildConfigureTimeline() {
    const gridEl = document.getElementById('timeline-grid');
    if (!gridEl) return;
    const slots = this.configureSlots.filter(Boolean).sort((a, b) => a.layer - b.layer);
    if (slots.length === 0) {
      gridEl.innerHTML = '';
      return;
    }
    const baseSlot = slots[0];
    const baseFrames = baseSlot.animEntry?.anim?.frames ?? [];
    const baseFrameCount = baseFrames.length;
    gridEl.innerHTML = '';

    for (let si = 0; si < slots.length; si++) {
      const slot = slots[si];
      const row = document.createElement('div');
      row.className = 'timeline-row';
      const label = document.createElement('span');
      label.className = 'timeline-layer-label';
      label.textContent = slot.animEntry?.displayName ?? `Layer ${slot.layer}`;
      row.appendChild(label);

      const cellsEl = document.createElement('div');
      cellsEl.className = 'timeline-cells';

      if (slot.layer === 0) {
        for (let i = 0; i < baseFrameCount; i++) {
          const cell = document.createElement('div');
          cell.className = 'timeline-cell base';
          cell.dataset.layerIndex = String(si);
          cell.dataset.baseFrame = String(i);
          cell.textContent = String(i);
          cellsEl.appendChild(cell);
        }
      } else {
        for (let i = 0; i < baseFrameCount; i++) {
          const cell = document.createElement('div');
          cell.className = 'timeline-cell overlay';
          cell.dataset.slotIndex = String(slot.slotIndex ?? si + 1);
          cell.dataset.baseFrame = String(i);
          const blocks = slot.timelineBlocks ?? [];
          const hasBlock = blocks.some((b) => b.baseFrame === i);
          if (hasBlock) cell.classList.add('has-block');
          cell.textContent = hasBlock ? '●' : '○';
          cell.addEventListener('click', () => {
            this.toggleTimelineBlock(parseInt(cell.dataset.slotIndex, 10), parseInt(cell.dataset.baseFrame, 10));
          });
          cellsEl.appendChild(cell);
        }
      }
      row.appendChild(cellsEl);
      gridEl.appendChild(row);
    }
  }

  toggleTimelineBlock(slotIndex, baseFrame) {
    const slot = this.configureSlots[slotIndex - 1];
    if (!slot || slot.layer === 0) return;
    let blocks = slot.timelineBlocks ?? [];
    const idx = blocks.findIndex((b) => b.baseFrame === baseFrame);
    if (idx >= 0) {
      blocks = blocks.filter((_, i) => i !== idx);
    } else {
      blocks = [...blocks, { baseFrame, startFrame: baseFrame, endFrame: baseFrame + 1 }];
      blocks.sort((a, b) => a.baseFrame - b.baseFrame);
    }
    slot.timelineBlocks = blocks;
    this.computeConfigureOutputFrameList();
    this.buildConfigureTimeline();
    this.applyConfigureOutputFrame();
    document.getElementById('configure-status').textContent =
      blocks.length > 0 ? `Timeline: overlay on frames [${blocks.map((b) => b.baseFrame).join(', ')}]` : 'Timeline: click cells to place overlay';
  }

  applyConfigureOutputFrame() {
    const list = this.configureOutputFrameList;
    if (list.length === 0) return;
    const spec = list[this.configureOutputFrameIndex % list.length];
    for (const { sprite, slot } of this.configureGridSprites) {
      const layerSpec = spec.layers.find((l) => l.slotIndex === slot.slotIndex);
      if (!layerSpec) {
        sprite.setVisible(false);
        continue;
      }
      sprite.setVisible(true);
      const frameI = layerSpec.frameI;
      const key = `f-${slot.animEntry.stem}-${frameI}`;
      if (!this.textures.exists(key)) continue;
      sprite.setTexture(key);
      sprite.setFlipX(slot.animEntry?.anim?.flipX ?? false);
      const meta = this.configureGridMeta[slot.animEntry.stem];
      const frameData = meta?.frames?.find((f) => f.i === frameI);
      if (frameData) {
        const tex = sprite.texture;
        const w = tex.getSourceImage().width || 1;
        const h = tex.getSourceImage().height || 1;
        sprite.setOrigin(
          Math.max(0, Math.min(1, frameData.ox / w)),
          Math.max(0, Math.min(1, frameData.oy / h))
        );
      }
    }
  }

  hideConfigureGrid() {
    this.destroyConfigureGrid();
  }

  buildConfigureSlotsDropdowns() {
    this.buildConfigureSlotsUI();
  }

  scheduleConfigureLoad() {
    this.loadConfigureTextures();
  }

  toggleConfigurePlay() {
    this.configurePlaying = !this.configurePlaying;
    document.getElementById('configure-play-btn').textContent = this.configurePlaying ? 'Pause' : 'Play';
  }

  stepConfigureFrame() {
    this.configurePlaying = false;
    document.getElementById('configure-play-btn').textContent = 'Play';
    if (this.configureOutputFrameList.length > 0) {
      this.configureOutputFrameIndex =
        (this.configureOutputFrameIndex + 1) % this.configureOutputFrameList.length;
      this.applyConfigureOutputFrame();
    }
  }

  async saveConfigureComposition() {
    const slots = this.configureSlots.filter(Boolean);
    if (slots.length === 0) {
      document.getElementById('configure-status').textContent = 'Add at least one animation to save';
      return;
    }
    let compId = this.configureEditingId;
    if (!compId) {
      const idInput = document.getElementById('composition-id');
      compId = idInput?.value?.trim();
    }
    if (!compId && slots[0]) compId = slots[0].animEntry.id;
    if (!compId) {
      document.getElementById('configure-status').textContent = 'Enter a composition ID (e.g. SWAT/attack north)';
      return;
    }

    const layers = slots
      .sort((a, b) => a.layer - b.layer)
      .map((s) => ({
        source: s.animEntry.path,
        stem: s.animEntry.stem,
        anim: s.animEntry.anim.name,
        layer: s.layer,
        offsetX: s.offsetX,
        offsetY: s.offsetY,
        scale: s.scale ?? (s.animEntry?.stem === 'Extras' ? 0.2 : 0.5),
        fps: s.fps ?? 8,
        timelineBlocks: s.timelineBlocks ?? [],
      }));

    const comp = { id: compId, layers };
    const existing = this.animationCompositions.compositions.filter((c) => c.id !== compId);
    existing.push(comp);
    this.animationCompositions = { compositions: existing };
    try {
      localStorage.setItem('kknd-animation-compositions', JSON.stringify(this.animationCompositions));
    } catch {}

    const json = JSON.stringify(this.animationCompositions, null, 2);
    let statusMsg = 'Saved! ';
    try {
      const res = await fetch('/api/save-compositions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
      });
      if (res.ok) {
        statusMsg += 'Written to viewer/src/ (old file backed up). ';
      }
    } catch {}

    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'animation-compositions.json';
    a.click();
    URL.revokeObjectURL(a.href);
    document.getElementById('configure-status').textContent = statusMsg + 'Saved.';
  }

  async exportCompositionToSpritesheet(sendToTester = false) {
    const slots = this.configureSlots.filter(Boolean);
    if (slots.length === 0) {
      document.getElementById('configure-status').textContent = 'Add at least one animation to export';
      return;
    }
    let compId = this.configureEditingId;
    if (!compId) {
      compId = document.getElementById('composition-id')?.value?.trim();
    }
    if (!compId && slots[0]) compId = slots[0].animEntry.id;
    if (!compId) {
      document.getElementById('configure-status').textContent = 'Enter a composition ID to export';
      return;
    }

    this.computeConfigureOutputFrameList();
    const list = this.configureOutputFrameList;
    if (list.length === 0) {
      document.getElementById('configure-status').textContent = 'No output frames to export';
      return;
    }

    const PADDING = 1;
    const EXPORT_SCALE = 2;

    const computeFrameBounds = (spec) => {
      let minLeft = Infinity, maxRight = -Infinity, minTop = Infinity, maxBottom = -Infinity;
      for (const layerSpec of spec.layers) {
        const slot = this.configureSlots[layerSpec.slotIndex - 1];
        if (!slot) continue;
        const key = `f-${slot.animEntry.stem}-${layerSpec.frameI}`;
        if (!this.textures.exists(key)) continue;
        const tex = this.textures.get(key);
        const img = tex.getSourceImage();
        if (!img || !img.complete) continue;
        const meta = this.configureGridMeta[slot.animEntry.stem];
        const frameData = meta?.frames?.find((f) => f.i === layerSpec.frameI);
        const w = img.width || 1;
        const h = img.height || 1;
        const ox = frameData ? Math.max(0, Math.min(1, frameData.ox / w)) : 0.5;
        const oy = frameData ? Math.max(0, Math.min(1, frameData.oy / h)) : 0.5;
        const scale = slot.scale ?? 0.5;
        const x = slot.offsetX ?? 0;
        const y = slot.offsetY ?? 0;
        const drawW = w * scale;
        const drawH = h * scale;
        const left = x - drawW * ox;
        const right = x + drawW * (1 - ox);
        const top = y - drawH * oy;
        const bottom = y + drawH * (1 - oy);
        minLeft = Math.min(minLeft, left);
        maxRight = Math.max(maxRight, right);
        minTop = Math.min(minTop, top);
        maxBottom = Math.max(maxBottom, bottom);
      }
      return { minLeft, maxRight, minTop, maxBottom };
    };

    let maxContentW = 0;
    let maxContentH = 0;
    const frameBoundsList = [];
    for (const spec of list) {
      const b = computeFrameBounds(spec);
      frameBoundsList.push(b);
      const w = b.maxRight - b.minLeft;
      const h = b.maxBottom - b.minTop;
      if (w > 0 && h > 0) {
        maxContentW = Math.max(maxContentW, w);
        maxContentH = Math.max(maxContentH, h);
      }
    }
    if (maxContentW <= 0) maxContentW = 1;
    if (maxContentH <= 0) maxContentH = 1;

    const frameW = Math.ceil(maxContentW) + PADDING * 2;
    const frameH = Math.ceil(maxContentH) + PADDING * 2;
    const exportFrameW = frameW * EXPORT_SCALE;
    const exportFrameH = frameH * EXPORT_SCALE;

    const canvas = document.createElement('canvas');
    canvas.width = exportFrameW * list.length;
    canvas.height = exportFrameH;
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < list.length; i++) {
      const spec = list[i];
      const b = frameBoundsList[i];
      const offsetX = PADDING - b.minLeft;
      const offsetY = PADDING - b.minTop;

      for (const layerSpec of spec.layers) {
        const slot = this.configureSlots[layerSpec.slotIndex - 1];
        if (!slot) continue;
        const key = `f-${slot.animEntry.stem}-${layerSpec.frameI}`;
        if (!this.textures.exists(key)) continue;

        const tex = this.textures.get(key);
        const img = tex.getSourceImage();
        if (!img || !img.complete) continue;

        const meta = this.configureGridMeta[slot.animEntry.stem];
        const frameData = meta?.frames?.find((f) => f.i === layerSpec.frameI);
        const w = img.width || 1;
        const h = img.height || 1;
        const ox = frameData ? Math.max(0, Math.min(1, frameData.ox / w)) : 0.5;
        const oy = frameData ? Math.max(0, Math.min(1, frameData.oy / h)) : 0.5;
        const scale = slot.scale ?? 0.5;
        const x = slot.offsetX ?? 0;
        const y = slot.offsetY ?? 0;

        const drawW = w * scale * EXPORT_SCALE;
        const drawH = h * scale * EXPORT_SCALE;
        const drawX = (i * frameW + offsetX + x - (w * scale) * ox) * EXPORT_SCALE;
        const drawY = (offsetY + y - (h * scale) * oy) * EXPORT_SCALE;

        ctx.save();
        if (slot.animEntry?.anim?.flipX) {
          ctx.translate(drawX + drawW, drawY);
          ctx.scale(-1, 1);
          ctx.translate(-drawX - drawW, -drawY);
        }
        ctx.drawImage(img, 0, 0, w, h, drawX, drawY, drawW, drawH);
        ctx.restore();
      }
    }

    const name = compId.replace(/\//g, '_').replace(/\s+/g, '_');

    const json = {
      frameWidth: exportFrameW,
      frameHeight: exportFrameH,
      frameCount: list.length,
      frames: list.map((_, i) => ({ x: i * exportFrameW, y: 0, w: exportFrameW, h: exportFrameH })),
    };
    const jsonBlob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const a2 = document.createElement('a');
    a2.href = URL.createObjectURL(jsonBlob);
    a2.download = `${name}.json`;
    a2.click();
    URL.revokeObjectURL(a2.href);

    await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Canvas toBlob failed'));
            return;
          }
          if (sendToTester) {
            this.loadSpritesheetToTester(blob, json);
          } else {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${name}.png`;
            a.click();
            URL.revokeObjectURL(a.href);
          }
          resolve();
        },
        'image/png',
        1
      );
    });

    const statusEl = document.getElementById('configure-status');
    if (sendToTester) {
      if (statusEl) statusEl.textContent = `Sent to Spritesheet Tester`;
    } else {
      if (statusEl) statusEl.textContent = `Exported ${name}.png and ${name}.json to Downloads`;
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

    this.unitGridComposites = {};
    for (const anim of UNIT_ANIMATIONS) {
      const compId = `${stem}/${anim.name}`;
      const comp = this.animationCompositions?.compositions?.find((c) => c.id === compId);
      if (!comp) continue;
      const name = compId.replace(/\//g, '_').replace(/\s+/g, '_');
      try {
        const res = await fetch(`/${path}/composite/${name}.json`);
        if (res.ok) {
          const json = await res.json();
          this.unitGridComposites[compId] = { frameCount: json.frameCount ?? json.frames?.length ?? 0 };
          this.load.spritesheet(`composite-${name}`, `/${path}/composite/${name}.png`, {
            frameWidth: json.frameWidth ?? 128,
            frameHeight: json.frameHeight ?? 128,
          });
        }
      } catch {}
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

  getUnitShootSettings(animName) {
    const def = this.unitShootEffectByAnim[animName];
    return def ?? {
      scale: this.unitShootEffectScale,
      offsetX: this.unitShootOffsetX,
      offsetY: this.unitShootOffsetY,
      shootFrame: this.unitShootFrame,
      useModbPoints: this.unitUseModbPoints,
    };
  }

  initUnitShootEffectFromCompositions() {
    if (this.unitGridStem !== 'SWAT') return;
    for (const comp of this.animationCompositions?.compositions ?? []) {
      if (!comp.id?.startsWith('SWAT/')) continue;
      const animName = comp.id.replace('SWAT/', '');
      const overlay = comp.layers?.find((l) => l.stem === 'Extras');
      const shoot = ATTACK_TO_SHOOT_EFFECT[animName];
      if (!shoot) continue;
      const blk = overlay?.timelineBlocks?.[0];
      this.unitShootEffectByAnim[animName] = {
        scale: overlay?.scale ?? 0.3,
        offsetX: overlay?.offsetX ?? shoot.offsetX,
        offsetY: overlay?.offsetY ?? shoot.offsetY,
        shootFrame: blk?.baseFrame ?? 2,
        useModbPoints: true,
      };
    }
  }

  updateUnitsSelectionUI() {
    const label = document.getElementById('units-selected-label');
    if (label) label.textContent = this.selectedUnitGridAnim ? `Selected: ${this.selectedUnitGridAnim}` : 'Selected: none';
    this.syncUnitsControlsToSelection();
    this.updateUnitsSaveExportButtons();
    this.updateUnitGridHighlights();
  }

  syncUnitsControlsToSelection() {
    const scaleIn = document.getElementById('units-shoot-scale');
    const scaleVal = document.getElementById('units-shoot-scale-val');
    const offsetXIn = document.getElementById('units-shoot-offset-x');
    const offsetYIn = document.getElementById('units-shoot-offset-y');
    const frameIn = document.getElementById('units-shoot-frame');
    const modbCheck = document.getElementById('units-use-modb-points');
    if (!this.selectedUnitGridAnim) return;
    const s = this.getUnitShootSettings(this.selectedUnitGridAnim);
    if (scaleIn) { scaleIn.value = String(s.scale); }
    if (scaleVal) scaleVal.textContent = s.scale.toFixed(2);
    if (offsetXIn) offsetXIn.value = String(s.offsetX);
    if (offsetYIn) offsetYIn.value = String(s.offsetY);
    if (frameIn) frameIn.value = String(s.shootFrame);
    if (modbCheck) modbCheck.checked = s.useModbPoints;
  }

  updateUnitGridHighlights() {
    for (const cell of this.unitGridSprites) {
      if (cell.highlightRect) {
        cell.highlightRect.setVisible(cell.anim.name === this.selectedUnitGridAnim);
      }
    }
  }

  updateUnitsSaveExportButtons() {
    const saveBtn = document.getElementById('units-save-btn');
    const saveAllBtn = document.getElementById('units-save-all-btn');
    const exportBtn = document.getElementById('units-export-btn');
    const exportAllBtn = document.getElementById('units-export-all-btn');
    const isSwat = this.unitGridStem === 'SWAT';
    const hasSelection = !!this.selectedUnitGridAnim;
    const canSave = isSwat && hasSelection && ATTACK_TO_SHOOT_EFFECT[this.selectedUnitGridAnim];
    if (saveBtn) saveBtn.disabled = !canSave;
    if (saveAllBtn) saveAllBtn.disabled = !isSwat;
    if (exportBtn) exportBtn.disabled = !hasSelection;
    if (exportAllBtn) exportAllBtn.disabled = this.unitGridSprites.length === 0;
  }

  setupUnitsSaveExportButtons() {
    document.getElementById('units-save-btn')?.addEventListener('click', () => this.saveUnitGridComposition());
    document.getElementById('units-save-all-btn')?.addEventListener('click', () => this.saveAllUnitGridCompositions());
    document.getElementById('units-export-btn')?.addEventListener('click', () => this.exportUnitGridAnimationToSpritesheet());
    document.getElementById('units-export-all-btn')?.addEventListener('click', () => this.exportAllUnitGridAnimationsToSpritesheet());
    const loadInput = document.getElementById('units-load-compositions');
    document.getElementById('units-load-btn')?.addEventListener('click', () => loadInput?.click());
    loadInput?.addEventListener('change', (e) => this.loadUnitGridCompositionsFile(e));
  }

  async loadUnitGridCompositionsFile(e) {
    const file = e.target?.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data?.compositions) {
        document.getElementById('units-status').textContent = 'Invalid file: missing compositions array';
        return;
      }
      this.animationCompositions = { compositions: data.compositions };
      try {
        localStorage.setItem('kknd-animation-compositions', JSON.stringify(this.animationCompositions));
      } catch {}
      this.unitShootEffectByAnim = {};
      this.initUnitShootEffectFromCompositions();
      if (this.unitGridMeta && this.unitGridStem) {
        this.buildUnitGrid();
      }
      this.updateUnitsSelectionUI();
      document.getElementById('units-status').textContent = `Loaded ${data.compositions.length} compositions from ${file.name}`;
    } catch (err) {
      document.getElementById('units-status').textContent = `Load failed: ${err.message}`;
    }
  }

  async saveUnitGridComposition() {
    const animName = this.selectedUnitGridAnim;
    if (!animName || this.unitGridStem !== 'SWAT' || !ATTACK_TO_SHOOT_EFFECT[animName]) {
      document.getElementById('units-status').textContent = 'Select an attack animation (SWAT) to save';
      return;
    }
    const s = this.getUnitShootSettings(animName);
    const compId = `${this.unitGridStem}/${animName}`;
    const mapAnim = {
      'attack north': 'shootNorth1', 'attack northeast': 'shootNorthEast1', 'attack east': 'shootEast1',
      'attack southeast': 'shootSouthEast1', 'attack south': 'shootSouth1', 'attack southwest': 'shootSouthWest1',
      'attack west': 'shootWest1', 'attack northwest': 'shootNorthWest1',
    };
    const effectAnimName = mapAnim[animName] ?? 'shootNorth1';
    const baseLayer = {
      source: 'units/swat',
      stem: this.unitGridStem,
      anim: animName,
      layer: 0,
      offsetX: 0,
      offsetY: 3,
      scale: 0.5,
      fps: 8,
    };
    const overlayLayer = {
      source: 'effects/extras',
      stem: 'Extras',
      anim: effectAnimName,
      layer: 1,
      offsetX: s.offsetX,
      offsetY: s.offsetY,
      scale: s.scale,
      fps: 4,
      timelineBlocks: [{ baseFrame: s.shootFrame }],
    };
    overlayLayer.anim = effectAnimName;
    const layers = [baseLayer, overlayLayer];
    const newComp = { id: compId, layers };
    const existing = this.animationCompositions.compositions.filter((c) => c.id !== compId);
    existing.push(newComp);
    this.animationCompositions = { compositions: existing };
    try {
      localStorage.setItem('kknd-animation-compositions', JSON.stringify(this.animationCompositions));
    } catch {}
    const json = JSON.stringify(this.animationCompositions, null, 2);
    try {
      const res = await fetch('/api/save-compositions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
      });
      if (res.ok) {
        document.getElementById('units-status').textContent = `Saved ${animName}. Switch to Configure tab to see updates.`;
      } else {
        document.getElementById('units-status').textContent = `Saved ${animName} (localStorage).`;
      }
    } catch {
      document.getElementById('units-status').textContent = `Saved ${animName} (localStorage).`;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'animation-compositions.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async saveAllUnitGridCompositions() {
    if (this.unitGridStem !== 'SWAT') {
      document.getElementById('units-status').textContent = 'Save All requires SWAT unit';
      return;
    }
    const attackAnims = Object.keys(ATTACK_TO_SHOOT_EFFECT);
    const mapAnim = {
      'attack north': 'shootNorth1', 'attack northeast': 'shootNorthEast1', 'attack east': 'shootEast1',
      'attack southeast': 'shootSouthEast1', 'attack south': 'shootSouth1', 'attack southwest': 'shootSouthWest1',
      'attack west': 'shootWest1', 'attack northwest': 'shootNorthWest1',
    };
    const existingComps = this.animationCompositions.compositions.filter((c) => !c.id?.startsWith('SWAT/'));
    for (const animName of attackAnims) {
      const s = this.getUnitShootSettings(animName);
      const compId = `${this.unitGridStem}/${animName}`;
      const baseLayer = {
        source: 'units/swat',
        stem: this.unitGridStem,
        anim: animName,
        layer: 0,
        offsetX: 0,
        offsetY: 3,
        scale: 0.5,
        fps: 8,
      };
      const overlayLayer = {
        source: 'effects/extras',
        stem: 'Extras',
        anim: mapAnim[animName],
        layer: 1,
        offsetX: s.offsetX,
        offsetY: s.offsetY,
        scale: s.scale,
        fps: 4,
        timelineBlocks: [{ baseFrame: s.shootFrame }],
      };
      existingComps.push({ id: compId, layers: [baseLayer, overlayLayer] });
    }
    this.animationCompositions = { compositions: existingComps };
    try {
      localStorage.setItem('kknd-animation-compositions', JSON.stringify(this.animationCompositions));
    } catch {}
    const json = JSON.stringify(this.animationCompositions, null, 2);
    try {
      const res = await fetch('/api/save-compositions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
      });
      if (res.ok) {
        document.getElementById('units-status').textContent = 'Saved all 8 attack compositions.';
      } else {
        document.getElementById('units-status').textContent = 'Saved all (localStorage).';
      }
    } catch {
      document.getElementById('units-status').textContent = 'Saved all (localStorage).';
    }
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'animation-compositions.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  computeUnitGridOutputFrameList(animName, baseOnly = false) {
    const anim = UNIT_ANIMATIONS.find((a) => a.name === animName);
    if (!anim) return [];
    const list = [];
    const baseFrames = anim.frames;
    const hasShoot = !baseOnly && this.unitGridStem === 'SWAT' && ATTACK_TO_SHOOT_EFFECT[animName] && this.effectsGridLoaded;
    const s = hasShoot ? this.getUnitShootSettings(animName) : null;
    const shootFrame = hasShoot ? Math.min(s.shootFrame, baseFrames.length - 1) : -1;
    const unitOffsetX = 0;
    const unitOffsetY = 3;
    for (let baseIdx = 0; baseIdx < baseFrames.length; baseIdx++) {
      if (hasShoot && baseIdx === shootFrame) {
        const shoot = ATTACK_TO_SHOOT_EFFECT[animName];
        const n = shoot.frames.length;
        for (let i = 0; i < n; i++) {
          list.push({
            unitFrameI: baseFrames[baseIdx],
            effectFrameI: shoot.frames[i],
            flipX: anim.flipX,
            unitScale: 1,
            unitOffsetX,
            unitOffsetY,
            effectScale: s.scale,
            effectOffsetX: s.offsetX,
            effectOffsetY: s.offsetY,
          });
        }
      } else {
        list.push({
          unitFrameI: baseFrames[baseIdx],
          effectFrameI: null,
          flipX: anim.flipX,
          unitScale: 1,
          unitOffsetX: 0,
          unitOffsetY: 3,
        });
      }
    }
    return list;
  }

  async exportUnitGridAnimationToSpritesheet(sendToTester = false, statusElId = 'units-status', baseOnly = false) {
    const statusEl = document.getElementById(statusElId) || document.getElementById('anim-status');
    const animName = this.selectedUnitGridAnim;
    if (!animName || !this.unitGridMeta || !this.unitGridStem) {
      if (statusEl) statusEl.textContent = 'Select an animation to export';
      return;
    }
    if (!baseOnly && this.unitGridStem === 'SWAT' && !this.effectsGridLoaded) {
      if (statusEl) statusEl.textContent = 'Loading effects...';
      await new Promise((r) => this.loadExtrasForShootEffects(r));
    }
    const list = this.computeUnitGridOutputFrameList(animName, baseOnly);
    if (list.length === 0) {
      if (statusEl) statusEl.textContent = 'No frames to export';
      return;
    }
    const PADDING = 1;
    const EXPORT_SCALE = 1;
    const unitMeta = this.unitGridMeta;
    const effectMeta = this.effectsGridMeta;
    const unitOffX = 0;
    const unitOffY = 3;
    const computeFrameBounds = (spec) => {
      let minLeft = Infinity, maxRight = -Infinity, minTop = Infinity, maxBottom = -Infinity;
      const unitKey = `f-${this.unitGridStem}-${spec.unitFrameI}`;
      if (!this.textures.exists(unitKey)) return { minLeft: 0, maxRight: 1, minTop: 0, maxBottom: 1 };
      const unitTex = this.textures.get(unitKey);
      const unitImg = unitTex.getSourceImage();
      if (!unitImg || !unitImg.complete) return { minLeft: 0, maxRight: 1, minTop: 0, maxBottom: 1 };
      const unitFrameData = unitMeta?.frames?.find((f) => f.i === spec.unitFrameI);
      const uw = unitImg.width || 1;
      const uh = unitImg.height || 1;
      const uox = unitFrameData ? Math.max(0, Math.min(1, unitFrameData.ox / uw)) : 0.5;
      const uoy = unitFrameData ? Math.max(0, Math.min(1, unitFrameData.oy / uh)) : 0.5;
      const uscale = spec.unitScale ?? 0.5;
      const drawW = uw * uscale;
      const drawH = uh * uscale;
      minLeft = Math.min(minLeft, unitOffX - drawW * uox);
      maxRight = Math.max(maxRight, unitOffX + drawW * (1 - uox));
      minTop = Math.min(minTop, unitOffY - drawH * uoy);
      maxBottom = Math.max(maxBottom, unitOffY + drawH * (1 - uoy));
      if (spec.effectFrameI != null && spec.effectScale != null) {
        const effectKey = `f-Extras-${spec.effectFrameI}`;
        if (this.textures.exists(effectKey)) {
          const effectTex = this.textures.get(effectKey);
          const effectImg = effectTex.getSourceImage();
          if (effectImg?.complete && effectMeta) {
            const effData = effectMeta.frames?.find((f) => f.i === spec.effectFrameI);
            const ew = effectImg.width || 1;
            const eh = effectImg.height || 1;
            const eox = effData ? Math.max(0, Math.min(1, effData.ox / ew)) : 0.5;
            const eoy = effData ? Math.max(0, Math.min(1, effData.oy / eh)) : 0.5;
            const escale = spec.effectScale;
            const ex = spec.effectOffsetX ?? 0;
            const ey = spec.effectOffsetY ?? 0;
            const edrawW = ew * escale;
            const edrawH = eh * escale;
            minLeft = Math.min(minLeft, ex - edrawW * eox);
            maxRight = Math.max(maxRight, ex + edrawW * (1 - eox));
            minTop = Math.min(minTop, ey - edrawH * eoy);
            maxBottom = Math.max(maxBottom, ey + edrawH * (1 - eoy));
          }
        }
      }
      return { minLeft, maxRight, minTop, maxBottom };
    };
    let maxContentW = 0;
    let maxContentH = 0;
    const frameBoundsList = [];
    for (const spec of list) {
      const b = computeFrameBounds(spec);
      frameBoundsList.push(b);
      const w = b.maxRight - b.minLeft;
      const h = b.maxBottom - b.minTop;
      if (w > 0 && h > 0) {
        maxContentW = Math.max(maxContentW, w);
        maxContentH = Math.max(maxContentH, h);
      }
    }
    if (maxContentW <= 0) maxContentW = 1;
    if (maxContentH <= 0) maxContentH = 1;
    const frameW = Math.ceil(maxContentW) + PADDING * 2;
    const frameH = Math.ceil(maxContentH) + PADDING * 2;
    const exportFrameW = frameW * EXPORT_SCALE;
    const exportFrameH = frameH * EXPORT_SCALE;
    const canvas = document.createElement('canvas');
    canvas.width = exportFrameW * list.length;
    canvas.height = exportFrameH;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < list.length; i++) {
      const spec = list[i];
      const b = frameBoundsList[i];
      const baseX = i * exportFrameW;
      const baseY = 0;
      ctx.save();
      ctx.beginPath();
      ctx.rect(baseX, baseY, exportFrameW, exportFrameH);
      ctx.clip();
      ctx.clearRect(baseX, baseY, exportFrameW, exportFrameH);
      const offsetX = PADDING - b.minLeft;
      const offsetY = PADDING - b.minTop;
      const unitKey = `f-${this.unitGridStem}-${spec.unitFrameI}`;
      if (this.textures.exists(unitKey)) {
        const unitTex = this.textures.get(unitKey);
        const img = unitTex.getSourceImage();
        if (img?.complete) {
          const unitFrameData = unitMeta?.frames?.find((f) => f.i === spec.unitFrameI);
          const w = img.width || 1;
          const h = img.height || 1;
          const ox = unitFrameData ? Math.max(0, Math.min(1, unitFrameData.ox / w)) : 0.5;
          const oy = unitFrameData ? Math.max(0, Math.min(1, unitFrameData.oy / h)) : 0.5;
          const scale = spec.unitScale ?? 0.5;
          const drawW = w * scale * EXPORT_SCALE;
          const drawH = h * scale * EXPORT_SCALE;
          const drawX = (i * frameW + offsetX + unitOffX - (w * scale) * ox) * EXPORT_SCALE;
          const drawY = (offsetY + unitOffY - (h * scale) * oy) * EXPORT_SCALE;
          ctx.save();
          if (spec.flipX) {
            ctx.translate(drawX + drawW, drawY);
            ctx.scale(-1, 1);
            ctx.translate(-drawX - drawW, -drawY);
          }
          ctx.drawImage(img, 0, 0, w, h, drawX, drawY, drawW, drawH);
          ctx.restore();
        }
      }
      if (spec.effectFrameI != null && spec.effectScale != null) {
        const effectKey = `f-Extras-${spec.effectFrameI}`;
        if (this.textures.exists(effectKey)) {
          const effectTex = this.textures.get(effectKey);
          const img = effectTex.getSourceImage();
          if (img?.complete && effectMeta) {
            const effData = effectMeta.frames?.find((f) => f.i === spec.effectFrameI);
            const w = img.width || 1;
            const h = img.height || 1;
            const ox = effData ? Math.max(0, Math.min(1, effData.ox / w)) : 0.5;
            const oy = effData ? Math.max(0, Math.min(1, effData.oy / h)) : 0.5;
            const scale = spec.effectScale;
            const drawW = w * scale * EXPORT_SCALE;
            const drawH = h * scale * EXPORT_SCALE;
            const drawX = (i * frameW + offsetX + (spec.effectOffsetX ?? 0) - (w * scale) * ox) * EXPORT_SCALE;
            const drawY = (offsetY + (spec.effectOffsetY ?? 0) - (h * scale) * oy) * EXPORT_SCALE;
            ctx.drawImage(img, 0, 0, w, h, drawX, drawY, drawW, drawH);
          }
        }
      }
      ctx.restore();
    }
    const nameSnake = animName.replace(/\s+/g, '_');
    const name = `${this.unitGridStem}_${nameSnake}`;
    const json = {
      frameWidth: exportFrameW,
      frameHeight: exportFrameH,
      frameCount: list.length,
      frames: list.map((_, i) => ({ x: i * exportFrameW, y: 0, w: exportFrameW, h: exportFrameH })),
    };
    if (!sendToTester) {
      const jsonBlob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
      const a2 = document.createElement('a');
      a2.href = URL.createObjectURL(jsonBlob);
      a2.download = `${name}.json`;
      a2.click();
      URL.revokeObjectURL(a2.href);
    }
    await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('Canvas toBlob failed')); return; }
          if (sendToTester) {
            this.loadSpritesheetToTester(blob, json);
            if (statusEl) statusEl.textContent = `Sent to tester: ${animName}`;
          } else {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${name}.png`;
            a.click();
            URL.revokeObjectURL(a.href);
            if (statusEl) statusEl.textContent = `Exported ${name}.png and ${name}.json`;
          }
          resolve();
        },
        'image/png',
        1
      );
    });
  }

  _computeUnitFrameBoundsForExport(spec, unitMeta, effectMeta) {
    let minLeft = Infinity, maxRight = -Infinity, minTop = Infinity, maxBottom = -Infinity;
    const unitOffX = spec.unitOffsetX ?? 0;
    const unitOffY = spec.unitOffsetY ?? 3;
    const unitKey = `f-${this.unitGridStem}-${spec.unitFrameI}`;
    if (!this.textures.exists(unitKey)) return { minLeft: 0, maxRight: 1, minTop: 0, maxBottom: 1 };
    const unitTex = this.textures.get(unitKey);
    const unitImg = unitTex.getSourceImage();
    if (!unitImg?.complete) return { minLeft: 0, maxRight: 1, minTop: 0, maxBottom: 1 };
    const unitFrameData = unitMeta?.frames?.find((f) => f.i === spec.unitFrameI);
    const uw = unitImg.width || 1;
    const uh = unitImg.height || 1;
    const uox = unitFrameData ? Math.max(0, Math.min(1, unitFrameData.ox / uw)) : 0.5;
    const uoy = unitFrameData ? Math.max(0, Math.min(1, unitFrameData.oy / uh)) : 0.5;
    const uscale = spec.unitScale ?? 0.5;
    const drawW = uw * uscale;
    const drawH = uh * uscale;
    minLeft = Math.min(minLeft, unitOffX - drawW * uox);
    maxRight = Math.max(maxRight, unitOffX + drawW * (1 - uox));
    minTop = Math.min(minTop, unitOffY - drawH * uoy);
    maxBottom = Math.max(maxBottom, unitOffY + drawH * (1 - uoy));
    if (spec.effectFrameI != null && spec.effectScale != null) {
      const effectKey = `f-Extras-${spec.effectFrameI}`;
      if (this.textures.exists(effectKey)) {
        const effectTex = this.textures.get(effectKey);
        const effectImg = effectTex.getSourceImage();
        if (effectImg?.complete && effectMeta) {
          const effData = effectMeta.frames?.find((f) => f.i === spec.effectFrameI);
          const ew = effectImg.width || 1;
          const eh = effectImg.height || 1;
          const eox = effData ? Math.max(0, Math.min(1, effData.ox / ew)) : 0.5;
          const eoy = effData ? Math.max(0, Math.min(1, effData.oy / eh)) : 0.5;
          const ex = spec.effectOffsetX ?? 0;
          const ey = spec.effectOffsetY ?? 0;
          const edrawW = ew * spec.effectScale;
          const edrawH = eh * spec.effectScale;
          minLeft = Math.min(minLeft, ex - edrawW * eox);
          maxRight = Math.max(maxRight, ex + edrawW * (1 - eox));
          minTop = Math.min(minTop, ey - edrawH * eoy);
          maxBottom = Math.max(maxBottom, ey + edrawH * (1 - eoy));
        }
      }
    }
    return { minLeft, maxRight, minTop, maxBottom };
  }

  async exportAllUnitGridAnimationsToSpritesheet(sendToTester = false, statusElId = 'units-status', baseOnly = false) {
    const statusEl = document.getElementById(statusElId) || document.getElementById('anim-status');
    if (!this.unitGridMeta || !this.unitGridStem) {
      if (statusEl) statusEl.textContent = 'Load a unit first';
      return;
    }
    if (!baseOnly && this.unitGridStem === 'SWAT' && !this.effectsGridLoaded) {
      if (statusEl) statusEl.textContent = 'Loading effects...';
      await new Promise((r) => this.loadExtrasForShootEffects(r));
    }
    const GAP = 1;
    const PADDING = 1;
    const EXPORT_SCALE = 1;
    const unitMeta = this.unitGridMeta;
    const effectMeta = this.effectsGridMeta;
    const allLists = [];
    let globalMaxW = 0;
    let globalMaxH = 0;
    for (const anim of UNIT_ANIMATIONS) {
      const list = this.computeUnitGridOutputFrameList(anim.name, baseOnly);
      allLists.push({ anim, list });
      for (const spec of list) {
        const b = this._computeUnitFrameBoundsForExport(spec, unitMeta, effectMeta);
        const w = b.maxRight - b.minLeft;
        const h = b.maxBottom - b.minTop;
        if (w > 0 && h > 0) {
          globalMaxW = Math.max(globalMaxW, w);
          globalMaxH = Math.max(globalMaxH, h);
        }
      }
    }
    const cellW = Math.ceil(globalMaxW) + PADDING * 2;
    const cellH = Math.ceil(globalMaxH) + PADDING * 2;
    const exportCellW = cellW * EXPORT_SCALE;
    const exportCellH = cellH * EXPORT_SCALE;
    const maxFrames = Math.max(...allLists.map(({ list }) => list.length), 1);
    const canvasW = maxFrames * (exportCellW + GAP) - GAP;
    const canvasH = 25 * (exportCellH + GAP) - GAP;
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    for (let row = 0; row < 25; row++) {
      const { anim, list } = allLists[row];
      for (let col = 0; col < list.length; col++) {
        const spec = list[col];
        const baseX = col * (exportCellW + GAP);
        const baseY = row * (exportCellH + GAP);
        ctx.save();
        ctx.beginPath();
        ctx.rect(baseX, baseY, exportCellW, exportCellH);
        ctx.clip();
        ctx.clearRect(baseX, baseY, exportCellW, exportCellH);
        const b = this._computeUnitFrameBoundsForExport(spec, unitMeta, effectMeta);
        const offsetX = PADDING - b.minLeft;
        const offsetY = PADDING - b.minTop;
        const unitOffX = spec.unitOffsetX ?? 0;
        const unitOffY = spec.unitOffsetY ?? 3;
        const unitKey = `f-${this.unitGridStem}-${spec.unitFrameI}`;
        if (this.textures.exists(unitKey)) {
          const unitTex = this.textures.get(unitKey);
          const img = unitTex.getSourceImage();
          if (img?.complete) {
            const unitFrameData = unitMeta?.frames?.find((f) => f.i === spec.unitFrameI);
            const w = img.width || 1;
            const h = img.height || 1;
            const ox = unitFrameData ? Math.max(0, Math.min(1, unitFrameData.ox / w)) : 0.5;
            const oy = unitFrameData ? Math.max(0, Math.min(1, unitFrameData.oy / h)) : 0.5;
            const scale = spec.unitScale ?? 0.5;
            const drawW = w * scale * EXPORT_SCALE;
            const drawH = h * scale * EXPORT_SCALE;
            const drawX = baseX + (offsetX + unitOffX - (w * scale) * ox) * EXPORT_SCALE;
            const drawY = baseY + (offsetY + unitOffY - (h * scale) * oy) * EXPORT_SCALE;
            ctx.save();
            if (spec.flipX) {
              ctx.translate(drawX + drawW, drawY);
              ctx.scale(-1, 1);
              ctx.translate(-drawX - drawW, -drawY);
            }
            ctx.drawImage(img, 0, 0, w, h, drawX, drawY, drawW, drawH);
            ctx.restore();
          }
        }
        if (spec.effectFrameI != null && spec.effectScale != null) {
          const effectKey = `f-Extras-${spec.effectFrameI}`;
          if (this.textures.exists(effectKey)) {
            const effectTex = this.textures.get(effectKey);
            const img = effectTex.getSourceImage();
            if (img?.complete && effectMeta) {
              const effData = effectMeta.frames?.find((f) => f.i === spec.effectFrameI);
              const w = img.width || 1;
              const h = img.height || 1;
              const ox = effData ? Math.max(0, Math.min(1, effData.ox / w)) : 0.5;
              const oy = effData ? Math.max(0, Math.min(1, effData.oy / h)) : 0.5;
              const scale = spec.effectScale;
              const drawW = w * scale * EXPORT_SCALE;
              const drawH = h * scale * EXPORT_SCALE;
              const drawX = baseX + (offsetX + (spec.effectOffsetX ?? 0) - (w * scale) * ox) * EXPORT_SCALE;
              const drawY = baseY + (offsetY + (spec.effectOffsetY ?? 0) - (h * scale) * oy) * EXPORT_SCALE;
              ctx.drawImage(img, 0, 0, w, h, drawX, drawY, drawW, drawH);
            }
          }
        }
        ctx.restore();
      }
    }
    const name = `${this.unitGridStem}_all`;
    const json = {
      frameWidth: exportCellW,
      frameHeight: exportCellH,
      animations: allLists.map(({ anim, list }, row) => ({
        name: anim.name,
        frameCount: list.length,
        frames: list.map((_, col) => ({
          x: col * (exportCellW + GAP),
          y: row * (exportCellH + GAP),
          w: exportCellW,
          h: exportCellH,
        })),
      })),
    };

    if (sendToTester) {
      const firstAnim = allLists[0];
      const firstRowCanvas = document.createElement('canvas');
      firstRowCanvas.width = maxFrames * (exportCellW + GAP) - GAP;
      firstRowCanvas.height = exportCellH;
      firstRowCanvas.getContext('2d').drawImage(canvas, 0, 0, firstRowCanvas.width, exportCellH, 0, 0, firstRowCanvas.width, exportCellH);
      await new Promise((resolve, reject) => {
        firstRowCanvas.toBlob(
          (blob) => {
            if (!blob) { reject(new Error('Canvas toBlob failed')); return; }
            const testerJson = { frameWidth: exportCellW, frameHeight: exportCellH, frameCount: firstAnim.list.length };
            this.loadSpritesheetToTester(blob, testerJson);
            if (statusEl) statusEl.textContent = `Sent first anim (${firstAnim.anim.name}) to tester`;
            resolve();
          },
          'image/png',
          1
        );
      });
      return;
    }

    const jsonBlob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const a2 = document.createElement('a');
    a2.href = URL.createObjectURL(jsonBlob);
    a2.download = `${name}.json`;
    a2.click();
    URL.revokeObjectURL(a2.href);
    await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('Canvas toBlob failed')); return; }
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${name}.png`;
          a.click();
          URL.revokeObjectURL(a.href);
          resolve();
        },
        'image/png',
        1
      );
    });
    if (statusEl) statusEl.textContent = `Exported ${name}.png and ${name}.json`;
  }

  buildUnitGrid() {
    this.destroyUnitGrid();
    if (!this.unitGridMeta || !this.unitGridStem) return;

    this.selectedUnitGridAnim = null;
    this.initUnitShootEffectFromCompositions();
    this.updateUnitsSelectionUI();

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
      const compId = `${this.unitGridStem}/${anim.name}`;
      const compositeName = compId.replace(/\//g, '_').replace(/\s+/g, '_');
      const compositeKey = `composite-${compositeName}`;
      const compositeMeta = this.unitGridComposites[compId];

      let sprite;
      let shootEffect = null;
      let useComposite = compositeMeta && this.textures.exists(compositeKey);

      if (useComposite) {
        sprite = this.add.sprite(cx, cy, compositeKey, 0);
        sprite.setDepth(1);
        sprite.setOrigin(0.5, 0.5);
      } else {
        const frameI = anim.frames[0];
        const key = `${keyPrefix}${frameI}`;
        if (!this.textures.exists(key)) continue;

        sprite = this.add.sprite(cx, cy, key);
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
      }

      const scale = Math.min(maxSpriteSize / (sprite.width || 1), maxSpriteSize / (sprite.height || 1));
      sprite.setScale(Math.min(1, scale));

      const label = this.add.text(cx, cy + cellH / 2 - 14, anim.name, {
        fontSize: 10,
        color: '#ccc',
      }).setOrigin(0.5, 1).setDepth(2);

      if (!useComposite) {
      const comp = this.animationCompositions?.compositions?.find((c) => c.id === compId);
      if (comp && comp.layers?.length > 0 && this.effectsGridLoaded) {
        const overlayLayers = comp.layers.filter((l) => l.stem !== this.unitGridStem);
        if (overlayLayers.length > 0) {
          const overlaySprites = [];
          const unitLayer = comp.layers?.find((l) => l.stem === this.unitGridStem);
          const unitLayerScale = unitLayer?.scale ?? 0.5;
          const unitOffsetX = unitLayer?.offsetX ?? 0;
          const unitOffsetY = unitLayer?.offsetY ?? 0;
          // Configure uses unit scale 0.5; convert offset from Configure space to Units cell space
          // Use effect position relative to unit so placement matches Configure
          const offsetScale = scale / unitLayerScale;
          for (const layer of overlayLayers) {
            const effectAnim = EFFECTS_ANIMATIONS.find((a) => a.name === layer.anim);
            if (!effectAnim?.frames?.length) continue;
            const frameI = effectAnim.frames[0];
            const effectKey = `f-${layer.stem}-${frameI}`;
            if (!this.textures.exists(effectKey)) continue;
            const relX = (layer.offsetX ?? 0) - unitOffsetX;
            const relY = (layer.offsetY ?? 0) - unitOffsetY;
            const effectSprite = this.add.sprite(
              cx + relX * offsetScale,
              cy + relY * offsetScale,
              effectKey
            );
            effectSprite.setDepth(1 + layer.layer * 0.5);
            const baseEffectScale = layer.scale != null
              ? scale * (layer.scale / unitLayerScale)
              : scale * SHOOT_EFFECT_SCALE;
            effectSprite.setScale(baseEffectScale);
            const effectFrameData = this.effectsGridMeta?.frames?.find((f) => f.i === frameI);
            if (effectFrameData) {
              const tex = effectSprite.texture;
              const w = tex.getSourceImage().width || 1;
              const h = tex.getSourceImage().height || 1;
              effectSprite.setOrigin(
                Math.max(0, Math.min(1, effectFrameData.ox / w)),
                Math.max(0, Math.min(1, effectFrameData.oy / h))
              );
            }
            overlaySprites.push({
              sprite: effectSprite,
              layer,
              effectAnim,
              baseEffectScale,
            });
          }
          if (overlaySprites.length > 0) shootEffect = { overlaySprites, cx, cy, offsetScale, unitOffsetX, unitOffsetY };
        }
      }
      if (!shootEffect && this.unitGridStem === 'SWAT' && ATTACK_TO_SHOOT_EFFECT[anim.name] && this.effectsGridLoaded) {
        const shoot = ATTACK_TO_SHOOT_EFFECT[anim.name];
        const effectKey = `f-Extras-${shoot.frames[0]}`;
        if (this.textures.exists(effectKey)) {
          const shootS = this.getUnitShootSettings(anim.name);
          const offsetScale = Math.min(1, scale);
          const effectSprite = this.add.sprite(cx, cy, effectKey);
          effectSprite.setDepth(1.5);
          effectSprite.setScale(scale * shootS.scale);
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
          const initFrameI = anim.frames[0];
          const initFrameData = this.unitGridMeta.frames.find((f) => f.i === initFrameI);
          let initOffX = shoot.offsetX;
          let initOffY = shoot.offsetY;
          if (shootS.useModbPoints && initFrameData?.points?.length) {
            const pt = initFrameData.points.find((p) => p.type === 1) ?? initFrameData.points[0];
            initOffX = pt.x - (initFrameData.ox ?? 0);
            initOffY = pt.y - (initFrameData.oy ?? 0);
          }
          initOffX += shootS.offsetX;
          initOffY += shootS.offsetY;
          effectSprite.x = cx + initOffX * offsetScale;
          effectSprite.y = cy + initOffY * offsetScale;
          shootEffect = { sprite: effectSprite, shoot, cx, cy, scale: offsetScale, unitScale: scale };
        }
      }
      }

      const cellLeft = col * cellW;
      const cellTop = row * cellH;
      const hitArea = this.add.rectangle(cellLeft + cellW / 2, cellTop + cellH / 2, cellW, cellH);
      hitArea.setInteractive({ useHandCursor: true });
      hitArea.on('pointerdown', () => {
        this.selectedUnitGridAnim = anim.name;
        this.updateUnitsSelectionUI();
      });

      const highlightRect = this.add.rectangle(cellLeft + 2, cellTop + 2, cellW - 4, cellH - 4);
      highlightRect.setOrigin(0, 0); // use top-left as anchor so x,y is cell corner
      highlightRect.setStrokeStyle(2, 0x00aaff);
      highlightRect.setFillStyle(0, 0);
      highlightRect.setDepth(3);
      highlightRect.setVisible(false);

      this.unitGridSprites.push({
        sprite,
        label,
        anim,
        frameIndex: 0,
        lastAdvance: 0,
        shootEffect,
        compositeKey: useComposite ? compositeKey : null,
        compositeFrameCount: useComposite ? (compositeMeta?.frameCount ?? 0) : null,
        hitArea,
        highlightRect,
      });
    }
    for (const cell of this.unitGridSprites) this.applyUnitGridFrame(cell);
    this.updateUnitGridHighlights();
    this.updateUnitsSaveExportButtons();
  }

  applyUnitGridFrame(cell) {
    const { sprite, anim, frameIndex, shootEffect, compositeKey, compositeFrameCount } = cell;

    if (compositeKey && compositeFrameCount) {
      const fi = frameIndex % compositeFrameCount;
      if (this.textures.exists(compositeKey)) {
        sprite.setTexture(compositeKey, fi);
      }
      return;
    }

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
      const s = this.getUnitShootSettings(anim.name);
      const shootFrame = Math.min(s.shootFrame, anim.frames.length - 1);
      const showShoot = frameIndex === shootFrame;
      if (shootEffect.overlaySprites) {
        const { cx, cy, offsetScale, unitOffsetX = 0, unitOffsetY = 0 } = shootEffect;
        for (const { sprite: effectSprite, layer, effectAnim, baseEffectScale } of shootEffect.overlaySprites) {
          effectSprite.setVisible(showShoot);
          effectSprite.setScale(baseEffectScale * s.scale);
          effectSprite.x = cx + (s.offsetX - unitOffsetX) * (offsetScale ?? 1);
          effectSprite.y = cy + (s.offsetY - unitOffsetY) * (offsetScale ?? 1);
          const effectFrameIdx = Math.min(
            Math.floor((frameIndex / anim.frames.length) * effectAnim.frames.length),
            effectAnim.frames.length - 1
          );
          const effectFrameI = effectAnim.frames[effectFrameIdx];
          const effectKey = `f-${layer.stem}-${effectFrameI}`;
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
      } else {
        const { sprite: effectSprite, shoot, cx, cy, scale, unitScale } = shootEffect;
        const cellScale = unitScale ?? 1;
        effectSprite.setVisible(showShoot);
        effectSprite.setScale(cellScale * s.scale);
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
        if (cx != null && cy != null) {
          const unitFrameData = this.unitGridMeta.frames.find((f) => f.i === frameI);
          let offsetX = shoot.offsetX;
          let offsetY = shoot.offsetY;
          if (s.useModbPoints && unitFrameData?.points?.length) {
            const pt = unitFrameData.points.find((p) => p.type === 1) ?? unitFrameData.points[0];
            offsetX = pt.x - (unitFrameData.ox ?? 0);
            offsetY = pt.y - (unitFrameData.oy ?? 0);
          }
          offsetX += s.offsetX;
          offsetY += s.offsetY;
          const scaleFactor = scale ?? 1;
          effectSprite.x = cx + offsetX * scaleFactor;
          effectSprite.y = cy + offsetY * scaleFactor;
        }
      }
    }
  }

  destroyUnitGrid() {
    for (const cell of this.unitGridSprites) {
      cell.sprite.destroy();
      cell.label.destroy();
      if (cell.hitArea) cell.hitArea.destroy();
      if (cell.highlightRect) cell.highlightRect.destroy();
      if (cell.shootEffect) {
        if (cell.shootEffect.overlaySprites) {
          for (const { sprite } of cell.shootEffect.overlaySprites) sprite.destroy();
        } else {
          cell.shootEffect.sprite.destroy();
        }
      }
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
    document.getElementById('frame-start')?.addEventListener('change', () => this.rebuildFilteredFrames());
    document.getElementById('frame-end')?.addEventListener('change', () => this.rebuildFilteredFrames());
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
    this.populatePresetDropdown();

    document.getElementById('frame-info').textContent = 'Loading...';

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

    const band1 = this.SECTION_BANDS?.[0];
    const centerY1 = band1 ? band1.y + band1.h / 2 : 40;
    this.sprite = this.add.sprite(400, centerY1, firstKey);
    this.sprite.setDepth(1);

    const total = this.meta?.total_frames ?? this.meta?.frames?.length ?? 0;
    const frameEndEl = document.getElementById('frame-end');
    if (frameEndEl) frameEndEl.value = String(Math.max(0, total - 1));
    this.populatePresetDropdown();
    this.rebuildFilteredFrames();
    this.refreshSection2Animations();
    this.applyFrame(0);
    document.getElementById('frame-info').textContent = `${this.filteredFrames.length} frames`;
  }

  populatePresetDropdown() {
    const presetSel = document.getElementById('preset-select');
    if (!presetSel) return;
    const spriteVal = document.getElementById('sprite-select')?.value;
    presetSel.innerHTML = '<option value="custom">Custom</option>';
    if (!spriteVal) return;
    try {
      const entry = JSON.parse(spriteVal);
      const unit = UNITS.find((u) => u.stem === entry.stem || u.path === entry.path);
      const effectStem = EFFECTS_SPRITE && entry.stem === EFFECTS_SPRITE.stem;
      const presets = unit ? UNIT_ANIMATIONS : effectStem ? EFFECTS_ANIMATIONS : [];
      for (const anim of presets) {
        const opt = document.createElement('option');
        opt.value = JSON.stringify(anim);
        opt.textContent = anim.name || '';
        presetSel.appendChild(opt);
      }
    } catch {}
  }

  rebuildFilteredFrames() {
    const frames = this.meta?.frames || [];
    const start = parseInt(document.getElementById('frame-start')?.value, 10) || 0;
    const end = parseInt(document.getElementById('frame-end')?.value, 10) || Math.max(0, frames.length - 1);
    this.filteredFrames = frames.filter((f, idx) => {
      const i = f.i ?? f.idx ?? idx;
      return i >= start && i <= end;
    });
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
    if (this.spritesheetTesterSprite && this.spritesheetTesterConfig) {
      const frameCount = this.spritesheetTesterConfig.frameCount;
      const tex = this.textures.exists('spritesheet-test') ? this.textures.get('spritesheet-test') : null;
      const hasFrames = tex && tex.frameTotal > 0;
      if (frameCount > 0 && hasFrames) {
        this.spritesheetTesterLastAdvance += delta;
        const fps = this.spritesheetTesterFps ?? 8;
        const msPerFrame = 1000 / fps;
        while (this.spritesheetTesterLastAdvance >= msPerFrame) {
          this.spritesheetTesterLastAdvance -= msPerFrame;
          this.spritesheetTesterFrameIndex = (this.spritesheetTesterFrameIndex + 1) % frameCount;
          if (this.spritesheetTesterFrameIndex < tex.frameTotal) {
            this.spritesheetTesterSprite.setFrame(this.spritesheetTesterFrameIndex);
          }
        }
      }
    }

    if (this.configurePlaying && this.configureGridSprites.length > 0) {
      const baseSlot = this.configureSlots.find((s) => s && s.layer === 0);
      const msPerFrame = baseSlot ? 1000 / (baseSlot.fps ?? 8) : 125;
      this.configureLastAdvance += delta;
      if (this.configureOutputFrameList.length > 0) {
        while (this.configureLastAdvance >= msPerFrame) {
          this.configureLastAdvance -= msPerFrame;
          this.configureOutputFrameIndex =
            (this.configureOutputFrameIndex + 1) % this.configureOutputFrameList.length;
          this.applyConfigureOutputFrame();
        }
      }
    }

    if (this.effectsGridSprites.length > 0) {
      const msPerFrame = 125; // 8 FPS
      for (const cell of this.effectsGridSprites) {
        cell.lastAdvance += delta;
        while (cell.lastAdvance >= msPerFrame && cell.anim.frames.length > 0) {
          cell.lastAdvance -= msPerFrame;
          cell.frameIndex = (cell.frameIndex + 1) % cell.anim.frames.length;
          this.applyEffectsGridFrame(cell);
        }
      }
    }

    if (this.section2AnimStripSprites?.length > 0) {
      const msPerFrame = 125; // 8 FPS
      for (const cell of this.section2AnimStripSprites) {
        cell.lastAdvance += delta;
        const frameCount = cell.anim.frames.length;
        while (cell.lastAdvance >= msPerFrame && frameCount > 0) {
          cell.lastAdvance -= msPerFrame;
          cell.frameIndex = (cell.frameIndex + 1) % frameCount;
          this.applySection2AnimFrame(cell);
        }
      }
    }

    if (this.unitGridSprites.length > 0) {
      const msPerFrame = 125; // 8 FPS
      for (const cell of this.unitGridSprites) {
        cell.lastAdvance += delta;
        const frameCount = cell.compositeFrameCount ?? cell.anim.frames.length;
        while (cell.lastAdvance >= msPerFrame && frameCount > 0) {
          cell.lastAdvance -= msPerFrame;
          cell.frameIndex = (cell.frameIndex + 1) % frameCount;
          this.applyUnitGridFrame(cell);
        }
      }
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
    document.getElementById('frame-info').textContent = '';
    this.populatePresetDropdown();
    this.refreshSection2Animations();
  }
}

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: 800,
  height: 600,
  backgroundColor: '#111111',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: ViewerScene,
};

new Phaser.Game(config);
