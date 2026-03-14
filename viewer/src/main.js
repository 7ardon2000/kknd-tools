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

    this.activeTab = 'sprite';
    this.unitGridSprites = [];
    this.unitGridMeta = null;
    this.unitGridStem = null;
    this.unitGridLoadInProgress = false;
    this.unitGridComposites = {};

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

    this.spritesheetTesterZoom = 1;
    this.spritesheetTesterMapLoaded = false;
    this.spritesheetTesterSprite = null;
    this.spritesheetTesterFrameIndex = 0;
    this.spritesheetTesterLastAdvance = 0;
    this.spritesheetTesterConfig = null;
    this.spritesheetTesterMapSprites = [];

    await this.loadCompositions();
    this.setupUI();
    this.loadManifest();
    this.setupTabs();
    this.setupUnitsTab();
    this.setupConfigureTab();
    this.setupSpritesheetTesterTab();
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

  setupTabs() {
    const tabSprite = document.getElementById('tab-sprite');
    const tabUnits = document.getElementById('tab-units');
    const tabEffects = document.getElementById('tab-effects');
    const tabConfigure = document.getElementById('tab-configure');
    const tabSpritesheet = document.getElementById('tab-spritesheet');
    const spriteUI = document.getElementById('sprite-viewer-ui');
    const unitsUI = document.getElementById('units-ui');
    const effectsUI = document.getElementById('effects-ui');
    const configureUI = document.getElementById('configure-ui');
    const spritesheetUI = document.getElementById('spritesheet-tester-ui');

    tabSprite.addEventListener('click', () => this.switchTab('sprite'));
    tabUnits.addEventListener('click', () => this.switchTab('units'));
    tabEffects.addEventListener('click', () => this.switchTab('effects'));
    tabConfigure.addEventListener('click', () => this.switchTab('configure'));
    tabSpritesheet.addEventListener('click', () => this.switchTab('spritesheet'));
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

    const canvas = this.game.canvas;
    canvas.addEventListener('wheel', (e) => {
      if (this.activeTab === 'configure') {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.15 : 0.15;
        this.configureZoom = Math.max(0.5, Math.min(3, this.configureZoom + delta));
        if (this.configureGridContainer) {
          this.configureGridContainer.setScale(this.configureZoom);
        }
        const statusEl = document.getElementById('configure-status');
        if (statusEl) statusEl.textContent = `Zoom ${Math.round(this.configureZoom * 100)}% — drag sprites, then Save`;
      } else if (this.activeTab === 'spritesheet') {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.15 : 0.15;
        this.spritesheetTesterZoom = Math.max(0.5, Math.min(3, this.spritesheetTesterZoom + delta));
        this.cameras.main.setZoom(this.spritesheetTesterZoom);
        const statusEl = document.getElementById('spritesheet-tester-status');
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

    this.input.on('pointermove', (pointer) => {
      if (this.activeTab !== 'configure' || !this.configureDragState) return;
      const { slotIndex, sprite } = this.configureDragState;
      const centerX = 400;
      const centerY = 300;
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
      if (this.activeTab !== 'configure') return;
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

  setupSpritesheetTesterTab() {
    this.loadSpritesheetTesterManifest();
    const sel = document.getElementById('spritesheet-tester-select');
    if (sel) sel.addEventListener('change', () => this.onSpritesheetTesterSelect());
    const layer0Toggle = document.getElementById('spritesheet-layer0-toggle');
    const layer1Toggle = document.getElementById('spritesheet-layer1-toggle');
    if (layer0Toggle) layer0Toggle.addEventListener('change', () => this.updateSpritesheetTesterLayerVisibility());
    if (layer1Toggle) layer1Toggle.addEventListener('change', () => this.updateSpritesheetTesterLayerVisibility());
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
      document.getElementById('spritesheet-tester-status').textContent = 'Map not found — add map_layer0.png and map_layer1.png to maps/';
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

  buildSpritesheetTesterMap() {
    this.destroySpritesheetTesterMap();
    if (!this.textures.exists('map-layer0')) return;
    const w = this.scale.width;
    const h = this.scale.height;
    const centerX = w / 2;
    const centerY = h / 2;
    const img0 = this.textures.get('map-layer0').getSourceImage();
    const img1 = this.textures.exists('map-layer1') ? this.textures.get('map-layer1').getSourceImage() : null;
    const scale0 = Math.min(w / (img0?.width || 1), h / (img0?.height || 1), 1);
    const sprite0 = this.add.image(centerX, centerY, 'map-layer0').setDepth(0);
    sprite0.setScale(scale0);
    sprite0.setData('layerIndex', 0);
    this.spritesheetTesterMapSprites.push(sprite0);
    if (img1) {
      const scale1 = Math.min(w / (img1.width || 1), h / (img1.height || 1), 1);
      const sprite1 = this.add.image(centerX, centerY, 'map-layer1').setDepth(1);
      sprite1.setScale(scale1);
      sprite1.setData('layerIndex', 1);
      this.spritesheetTesterMapSprites.push(sprite1);
    }
    this.updateSpritesheetTesterLayerVisibility();
  }

  updateSpritesheetTesterLayerVisibility() {
    const showLayer0 = document.getElementById('spritesheet-layer0-toggle')?.checked !== false;
    const showLayer1 = document.getElementById('spritesheet-layer1-toggle')?.checked !== false;
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
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;
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
      const centerX = this.scale.width / 2;
      const centerY = this.scale.height / 2;
      this.spritesheetTesterSprite = this.add.sprite(centerX, centerY, 'spritesheet-test', 0);
      this.spritesheetTesterSprite.setDepth(100);
      this.spritesheetTesterSprite.setOrigin(0.5, 0.5);
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
    const centerX = 400;
    const centerY = 300;
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
      sprite.on('pointerdown', () => {
        this.configureDragState = { slotIndex, sprite };
        const statusEl = document.getElementById('configure-status');
        if (statusEl) statusEl.textContent = `Dragging Slot ${slotIndex} — release to drop`;
      });

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
    document.getElementById('configure-status').textContent = statusMsg + 'Switch to Units tab to see updates.';
  }

  async exportCompositionToSpritesheet() {
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

    document.getElementById('configure-status').textContent = `Exported ${name}.png and ${name}.json to Downloads`;
  }

  switchTab(tab) {
    const tabSprite = document.getElementById('tab-sprite');
    const tabUnits = document.getElementById('tab-units');
    const tabEffects = document.getElementById('tab-effects');
    const tabConfigure = document.getElementById('tab-configure');
    const tabSpritesheet = document.getElementById('tab-spritesheet');
    const spriteUI = document.getElementById('sprite-viewer-ui');
    const unitsUI = document.getElementById('units-ui');
    const effectsUI = document.getElementById('effects-ui');
    const configureUI = document.getElementById('configure-ui');
    const spritesheetUI = document.getElementById('spritesheet-tester-ui');

    this.activeTab = tab;
    tabSprite.classList.toggle('active', tab === 'sprite');
    tabUnits.classList.toggle('active', tab === 'units');
    tabEffects.classList.toggle('active', tab === 'effects');
    tabConfigure.classList.toggle('active', tab === 'configure');
    tabSpritesheet.classList.toggle('active', tab === 'spritesheet');
    spriteUI.classList.toggle('active', tab === 'sprite');
    unitsUI.classList.toggle('active', tab === 'units');
    effectsUI.classList.toggle('active', tab === 'effects');
    configureUI.classList.toggle('active', tab === 'configure');
    spritesheetUI.classList.toggle('active', tab === 'spritesheet');

    if (tab === 'sprite') {
      document.getElementById('spritesheet-tester-bar')?.style.setProperty('display', 'none');
      document.getElementById('canvas-wrapper')?.classList.remove('with-spritesheet-bar');
      this.hideUnitGrid();
      this.hideEffectsGrid();
      this.hideConfigureGrid();
      this.hideSpritesheetTester();
      if (this.sprite) this.sprite.setVisible(true);
      this.cameras.main.setZoom(1);
    } else if (tab === 'spritesheet') {
      this.hideUnitGrid();
      this.hideEffectsGrid();
      this.hideConfigureGrid();
      if (this.sprite) this.sprite.setVisible(false);
      const bar = document.getElementById('spritesheet-tester-bar');
      const canvasWrap = document.getElementById('canvas-wrapper');
      if (bar) bar.style.display = 'flex';
      if (canvasWrap) canvasWrap.classList.add('with-spritesheet-bar');
      this.loadSpritesheetTesterMap();
      this.cameras.main.setZoom(this.spritesheetTesterZoom);
    } else if (tab === 'units') {
      document.getElementById('spritesheet-tester-bar')?.style.setProperty('display', 'none');
      document.getElementById('canvas-wrapper')?.classList.remove('with-spritesheet-bar');
      this.hideEffectsGrid();
      this.hideConfigureGrid();
      this.hideSpritesheetTester();
      if (this.sprite) this.sprite.setVisible(false);
      this.cameras.main.setZoom(1);
      const sel = document.getElementById('unit-select');
      if (sel.value) this.loadUnitGrid(JSON.parse(sel.value));
    } else if (tab === 'configure') {
      document.getElementById('spritesheet-tester-bar')?.style.setProperty('display', 'none');
      document.getElementById('canvas-wrapper')?.classList.remove('with-spritesheet-bar');
      this.hideUnitGrid();
      this.hideEffectsGrid();
      this.hideSpritesheetTester();
      if (this.sprite) this.sprite.setVisible(false);
      this.cameras.main.setZoom(1);
      this.buildConfigureCompositionSelector();
      this.buildConfigureSlotsDropdowns();
      this.scheduleConfigureLoad();
    } else {
      document.getElementById('spritesheet-tester-bar')?.style.setProperty('display', 'none');
      document.getElementById('canvas-wrapper')?.classList.remove('with-spritesheet-bar');
      this.hideUnitGrid();
      this.hideConfigureGrid();
      this.hideSpritesheetTester();
      if (this.sprite) this.sprite.setVisible(false);
      this.cameras.main.setZoom(1);
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
            const effectScale = layer.scale != null
              ? scale * (layer.scale / unitLayerScale)
              : scale * SHOOT_EFFECT_SCALE;
            effectSprite.setScale(effectScale);
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
            overlaySprites.push({ sprite: effectSprite, layer, effectAnim });
          }
          if (overlaySprites.length > 0) shootEffect = { overlaySprites };
        }
      }
      if (!shootEffect && this.unitGridStem === 'SWAT' && ATTACK_TO_SHOOT_EFFECT[anim.name] && this.effectsGridLoaded) {
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
      }

      this.unitGridSprites.push({
        sprite,
        label,
        anim,
        frameIndex: 0,
        lastAdvance: 0,
        shootEffect,
        compositeKey: useComposite ? compositeKey : null,
        compositeFrameCount: useComposite ? (compositeMeta?.frameCount ?? 0) : null,
      });
    }
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
      if (shootEffect.overlaySprites) {
        for (const { sprite: effectSprite, layer, effectAnim } of shootEffect.overlaySprites) {
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
  }

  destroyUnitGrid() {
    for (const cell of this.unitGridSprites) {
      cell.sprite.destroy();
      cell.label.destroy();
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
    if (this.activeTab === 'spritesheet' && this.spritesheetTesterSprite && this.spritesheetTesterConfig) {
      const frameCount = this.spritesheetTesterConfig.frameCount;
      const tex = this.textures.exists('spritesheet-test') ? this.textures.get('spritesheet-test') : null;
      const hasFrames = tex && tex.frameTotal > 0;
      if (frameCount > 0 && hasFrames) {
        this.spritesheetTesterLastAdvance += delta;
        const msPerFrame = 125;
        while (this.spritesheetTesterLastAdvance >= msPerFrame) {
          this.spritesheetTesterLastAdvance -= msPerFrame;
          this.spritesheetTesterFrameIndex = (this.spritesheetTesterFrameIndex + 1) % frameCount;
          if (this.spritesheetTesterFrameIndex < tex.frameTotal) {
            this.spritesheetTesterSprite.setFrame(this.spritesheetTesterFrameIndex);
          }
        }
      }
      return;
    }

    if (this.activeTab === 'configure' && this.configurePlaying && this.configureGridSprites.length > 0) {
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
      return;
    }

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
        const frameCount = cell.compositeFrameCount ?? cell.anim.frames.length;
        while (cell.lastAdvance >= msPerFrame && frameCount > 0) {
          cell.lastAdvance -= msPerFrame;
          cell.frameIndex = (cell.frameIndex + 1) % frameCount;
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
