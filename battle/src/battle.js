import Phaser from 'phaser';
import { Airstrike } from './airstrike.js';
import { CONFIG } from './config.js';
import { centerSnapped } from './snap.js';
import { Hotspots } from './hotspots.js';
import { DEPTH, Effects } from './effects.js';
import { Grid } from './grid.js';
import { Roamer } from './roam.js';
import { Terrain } from './terrain.js';
import { SpatialHash } from './spatial.js';
import { fname, SpriteBank } from './sprites.js';
import { Unit } from './unit.js';
import { composeWorld, CORRIDOR } from './world.js';

const ASSETS = 'assets/';
// level of detail for units away from the screen
const LOD_MARGIN = 200;
const LOD_INTERVAL = 200;
// map objects are kept in the display list only within DECOR_MARGIN px of the view
const DECOR_CELL = 512;
const DECOR_MARGIN = 400;

/** Small deterministic PRNG (mulberry32) so a seed reproduces a battle. */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    this.load.json('db', `${ASSETS}units.json`);
    this.load.once('filecomplete-json-db', () => {
      const db = this.cache.json.get('db');
      for (const [stem, info] of Object.entries(db.sprites)) {
        this.load.atlas(stem, `${ASSETS}sprites/${stem}.png`, `${ASSETS}sprites/${stem}.json`);
        if (info.team) this.load.atlas(`${stem}_red`, `${ASSETS}sprites/${stem}_red.png`, `${ASSETS}sprites/${stem}_red.json`);
        this.load.json(`pts_${stem}`, `${ASSETS}sprites/${stem}.points.json`);
      }
    });
    const bar = this.add.graphics();
    this.load.on('progress', (p) => {
      const { width, height } = this.scale;
      bar.clear().fillStyle(0x8a6a3a).fillRect(width * 0.3, height / 2 - 3, width * 0.4 * p, 6);
    });
  }

  create() {
    this.scene.start('battle');
  }
}

export class BattleScene extends Phaser.Scene {
  constructor() {
    super('battle');
  }

  create() {
    this.db = this.cache.json.get('db');
    this.rng = makeRng(CONFIG.seed || (Math.random() * 2 ** 32) >>> 0);
    this.bank = new SpriteBank(this, this.db);
    this.effects = new Effects(this, this.db, this.bank, this.rng);
    this.hash = new SpatialHash(64);
    this.hotspots = new Hotspots(this);
    this.roamer = new Roamer(this);
    this.units = [];
    this.wrecks = [];
    this.airstrikes = [];
    this.mapObjects = [];
    this.animatedDecor = [];
    this.kills = [0, 0];
    this.exits = [0, 0];
    this.count = [0, 0];
    this.boost = [1, 1];
    this.progress = [0, 0];
    this.view = { x: 0, y: 0, w: 0, h: 0 };
    this.time.timeScale = CONFIG.speed;
    this.cameras.main.setBackgroundColor('#000000');

    this.rosters = this.buildRosters();
    this.scale.on('resize', () => {
      if (!this.world) return;
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.layoutCamera(), 200);
    });
    this.loadWorld();

    if (CONFIG.debug) {
      // DOM overlay: unaffected by camera zoom
      this.debugText = document.createElement('div');
      this.debugText.style.cssText = 'position:fixed;left:8px;top:8px;font:12px monospace;color:#ffe080;background:#000a;padding:2px 6px;z-index:10;white-space:pre';
      document.body.appendChild(this.debugText);
    }
  }

  // ------------------------------------------------------------------ world

  worldLayout() {
    const m = /^(\d+)x(\d+)$/.exec(CONFIG.world);
    const cols = m ? Math.max(1, Math.min(5, +m[1])) : 3;
    const rows = m ? Math.max(1, Math.min(4, +m[2])) : 2;
    return [cols, rows];
  }

  /** Choose a tileset and the maps to stitch together. */
  pickMaps() {
    const [cols, rows] = this.worldLayout();
    const n = cols * rows;
    const all = this.db.maps.filter((m) => m.id !== 'shellmap');
    const pool = all.filter((m) => CONFIG.maps === 'all' || m.category === CONFIG.maps);
    const chosen = CONFIG.map !== 'random' ? all.find((m) => m.id === CONFIG.map) : null;
    let tileset;
    if (chosen) {
      tileset = chosen.tileset;
    } else {
      // a different tileset from the current world when rotating
      const src = pool.length ? pool : all;
      const options = src.filter((m) => m.tileset !== this.world?.tileset);
      const from = options.length ? options : src;
      tileset = from[Math.floor(this.rng() * from.length)].tileset;
    }
    let candidates = (pool.length ? pool : all).filter((m) => m.tileset === tileset && m.id !== chosen?.id);
    if (!candidates.length) candidates = all.filter((m) => m.tileset === tileset);
    // shuffle, then repeat maps if the tileset has fewer than we need
    const shuffled = [...candidates];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const ids = [];
    for (let i = 0; ids.length < n; i++) ids.push(shuffled[i % shuffled.length].id);
    if (chosen) ids[Math.floor(n / 2)] = chosen.id; // the chosen map sits in the middle
    return { cols, rows, ids, tileset };
  }

  loadWorld() {
    const pick = this.pickMaps();
    this.pendingWorld = pick;
    let queued = 0;
    for (const id of new Set(pick.ids)) {
      const key = `map_${id}`;
      if (this.cache.json.exists(key)) continue;
      queued++;
      this.load.json(key, `${ASSETS}maps/${id}.json`);
      this.load.once(`filecomplete-json-${key}`, () => {
        const m = this.cache.json.get(key);
        if (m.decorAtlas && !this.textures.exists(m.decorAtlas)) {
          this.load.atlas(m.decorAtlas, `${ASSETS}maps/${m.decorAtlas}.png`, `${ASSETS}maps/${m.decorAtlas}.json`);
        }
      });
    }
    if (!this.textures.exists(`tiles_${pick.tileset}`)) {
      queued++;
      this.load.image(`tiles_${pick.tileset}`, `${ASSETS}maps/tiles_${pick.tileset}.png`);
    }
    if (!queued) {
      this.buildWorld();
      return;
    }
    this.load.once('complete', () => this.buildWorld());
    this.load.start();
  }

  buildWorld() {
    const { cols, rows, ids, tileset } = this.pendingWorld;
    const maps = ids.map((id) => ({ id, ...this.cache.json.get(`map_${id}`) }));
    const tsInfo = this.db.tilesets?.[tileset] || {};
    const fill = tsInfo.fill || [maps[0].tiles[0]];
    const W = composeWorld(maps, cols, rows, fill, tsInfo.groups || [], this.rng);
    this.world = W;
    this.grid = new Grid(W);
    const T = W.tile;
    this.worldW = W.width * T;
    this.worldH = W.height * T;

    // terrain
    const data = [];
    for (let y = 0; y < W.height; y++) data.push(W.tiles.slice(y * W.width, (y + 1) * W.width));
    this.tilemap?.destroy();
    this.tilemap = this.make.tilemap({ data, tileWidth: T, tileHeight: T });
    const ts = this.tilemap.addTilesetImage(`tiles_${tileset}`, `tiles_${tileset}`, T, T, 0, 0);
    this.groundLayer = this.tilemap.createLayer(0, ts, 0, 0).setDepth(DEPTH.ground - 1000);
    // soft seams: feathered ground chunks drawn over the tilemap near the camera
    this.terrain?.destroy();
    this.terrain = new Terrain(this, W, `tiles_${tileset}`);

    // decor
    for (const o of this.mapObjects) o.destroy();
    this.mapObjects = [];
    this.animatedDecor = [];
    this.decorCells = new Map();
    this.decorActive = new Set();
    for (const d of W.decor) {
      let obj;
      if (d.f !== undefined) {
        obj = this.add.image(d.x, d.y, d.atlas, d.f).setDepth(d.z);
      } else if (d.seq) {
        obj = this.add.sprite(d.x, d.y, d.seq.sprite, String(d.seq.start)).setDepth(d.z < 0 ? DEPTH.ground + d.y : d.z);
        if (d.seq.length > 1) this.animatedDecor.push({ spr: obj, seq: d.seq, t: this.rng() * 1000 });
      }
      if (!obj) continue;
      this.mapObjects.push(obj);
      // off-screen decor lives outside the display list (see cullDecor)
      this.children.remove(obj);
      const k = this.decorKey(Math.floor(d.x / DECOR_CELL), Math.floor(d.y / DECOR_CELL));
      let cell = this.decorCells.get(k);
      if (!cell) this.decorCells.set(k, (cell = []));
      cell.push(obj);
    }
    this.cullDecor();

    // each side marches to the far edge of the world
    const leftEdge = [];
    const rightEdge = [];
    for (let y = 0; y < W.height; y++) {
      leftEdge.push([0, y]);
      rightEdge.push([W.width - 1, y]);
    }
    this.flow = [this.grid.flowField(rightEdge), this.grid.flowField(leftEdge)];
    this.buildSpawnZones();

    this.startBattle();
    this.layoutCamera();
    this.cullDecor();
    this.unloadUnused(new Set(ids), tileset);
    if (CONFIG.debug) this.drawDebugGrid();
  }

  decorKey(cx, cy) {
    return cx * 65536 + cy;
  }

  /**
   * Keep only map objects near the view in Phaser's display list. Hidden objects that stay in the list
   * still cost a little every frame, and the list is depth-sorted whenever units move, so a world with
   * thousands of trees would be re-sorted every frame for nothing.
   */
  cullDecor() {
    if (!this.decorCells) return;
    const v = this.view;
    const m = DECOR_MARGIN;
    const x0 = Math.floor((v.x - m) / DECOR_CELL);
    const x1 = Math.floor((v.x + v.w + m) / DECOR_CELL);
    const y0 = Math.floor((v.y - m) / DECOR_CELL);
    const y1 = Math.floor((v.y + v.h + m) / DECOR_CELL);
    const want = this.decorWant || (this.decorWant = new Set());
    want.clear();
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const cell = this.decorCells.get(this.decorKey(cx, cy));
        if (cell) for (const o of cell) want.add(o);
      }
    }
    for (const o of this.decorActive) {
      if (!want.has(o)) {
        this.children.remove(o);
        this.decorActive.delete(o);
      }
    }
    for (const o of want) {
      if (!this.decorActive.has(o)) {
        this.children.add(o);
        this.decorActive.add(o);
      }
    }
  }

  /** Free map data, decor atlases and tilesets the current world does not use (long runs). */
  unloadUnused(keepIds, tileset) {
    for (const m of this.db.maps) {
      if (keepIds.has(m.id)) continue;
      const key = `map_${m.id}`;
      if (!this.cache.json.exists(key)) continue;
      const decor = this.cache.json.get(key).decorAtlas;
      this.cache.json.remove(key);
      if (decor && this.textures.exists(decor)) this.textures.remove(decor);
    }
    for (const ts of Object.keys(this.db.tilesets || {})) {
      if (ts !== tileset && this.textures.exists(`tiles_${ts}`)) this.textures.remove(`tiles_${ts}`);
    }
  }

  /** Several entry zones along each side's edge of the world. */
  buildSpawnZones() {
    const T = this.world.tile;
    const [, rows] = this.worldLayout();
    const count = Math.max(2, rows + 1);
    this.zones = [[], []];
    for (let team = 0; team < 2; team++) {
      for (let k = 0; k < count; k++) {
        const yc = ((k + 0.5) / count) * this.worldH;
        const x0 = team === 0 ? T * 0.5 : this.worldW - T * (CORRIDOR - 0.5);
        const x1 = team === 0 ? T * (CORRIDOR - 0.5) : this.worldW - T * 0.5;
        const half = (this.worldH / count) * 0.35;
        this.zones[team].push({ x0, x1, y0: yc - half, y1: yc + half });
      }
    }
  }

  /**
   * Wide view: whole-number zoom only, so every world pixel covers the same number of screen pixels
   * (a fractional zoom makes objects jiggle while panning). 1x up to 1440p, 2x from 4K.
   */
  computeZoom() {
    if (CONFIG.zoom > 0) return CONFIG.zoom;
    return Math.max(1, Math.floor(Math.min(this.scale.width / 1600, this.scale.height / 900)));
  }

  /** Place the camera; `jump` starts it on the biggest fight (new world). */
  layoutCamera(jump = true) {
    const cam = this.cameras.main;
    cam.setZoom(this.computeZoom());
    cam.setRoundPixels(true);
    if (jump) {
      const h = this.hotspots.best();
      centerSnapped(cam, h ? h[0] : this.worldW / 2, h ? h[1] : this.worldH / 2);
    }
    this.roamer.reset();
    this.updateView();
  }

  // ------------------------------------------------------------------ battle

  buildRosters() {
    const all = Object.values(this.db.units).filter((u) => CONFIG.vehicles || u.kind === 'infantry');
    return CONFIG.teams.slice(0, 2).map((f, team) => {
      const only = CONFIG.roster[team];
      const units = only.length
        ? Object.values(this.db.units).filter((u) => only.some((w) => u.id.includes(w)))
        : all.filter((u) => f === 'mixed' || u.faction === f.trim());
      const list = units.length ? units : all;
      // cheaper units appear more often; heroes are rare
      const weights = list.map((u) => (u.cost >= 1000 ? 0.15 : 1) / Math.pow(Math.max(40, u.cost), 0.75));
      const total = weights.reduce((a, b) => a + b, 0);
      return { list, weights, total };
    });
  }

  pickUnit(team) {
    const r = this.rosters[team] || this.rosters[0];
    let x = this.rng() * r.total;
    for (let i = 0; i < r.list.length; i++) {
      x -= r.weights[i];
      if (x <= 0) return r.list[i];
    }
    return r.list[r.list.length - 1];
  }

  startBattle() {
    for (const u of this.units) if (u.alive) u.remove();
    this.units = [];
    this.hash.reset();
    this.effects.clear();
    for (const w of this.wrecks) w.spr.destroy();
    this.wrecks = [];
    for (const s of this.airstrikes) s.destroy();
    this.airstrikes = [];
    this.time.removeAllEvents();
    this.resetAirTimer(true);
    this.resetRotateTimer();
    this.kills = [0, 0];
    this.exits = [0, 0];
    this.boost = [1, 1];

    const [cols, rows] = this.worldLayout();
    this.baseCap = CONFIG.units || Math.round(36 * Math.sqrt(cols * rows));
    this.cap = [this.baseCap, this.baseCap];
    this.waveTimer = [800, 1600];
    this.balanceT = 0;
    this.front = 0.5;
    this.offensive = null;
    this.offensiveT = (30 + this.rng() * 30) * 1000;

    // open mid-battle: both sides already facing each other across the middle, on every route
    for (let team = 0; team < 2; team++) {
      const n = Math.ceil(this.baseCap * 0.8);
      for (let i = 0; i < n; i++) this.spawn(team, true);
    }
  }

  /**
   * Where a reinforcement wave enters. Most waves feed the fight on screen (arriving from just beyond the
   * screen edge, behind their own side), the rest go to a random route elsewhere in the world.
   */
  waveZone(team) {
    const zones = this.zones[team];
    if (this.rng() < 0.75) {
      const v = this.view;
      // the camera keeps drifting: aim for where it will be in a few seconds
      const ahead = 10;
      const cx = Math.max(v.w / 2, Math.min(this.worldW - v.w / 2, v.x + v.w / 2 + (this.roamer.vx * ahead)));
      const cy = Math.max(v.h / 2, Math.min(this.worldH - v.h / 2, v.y + v.h / 2 + (this.roamer.vy * ahead)));
      return { y0: cy - v.h / 2 + 40, y1: cy + v.h / 2 - 40, front: cx };
    }
    return zones[Math.floor(this.rng() * zones.length)];
  }

  /** A passable spawn point: an entry zone on the team's edge, or (opening) anywhere on its half. */
  spawnPoint(team, deploy, zone) {
    const g = this.grid;
    for (let tries = 0; tries < 50; tries++) {
      let x;
      let y;
      if (deploy) {
        const frac = 0.34 + this.rng() * 0.14;
        x = team === 0 ? this.worldW * frac : this.worldW * (1 - frac);
        y = this.worldH * (0.04 + this.rng() * 0.92);
      } else {
        // reinforcements arrive behind their own side's front on this route, from off-screen
        y = zone.y0 + this.rng() * (zone.y1 - zone.y0);
        const back = 600 + this.rng() * 500;
        const front = zone.front ?? this.worldW / 2;
        const margin = this.world.tile * 0.5;
        x = team === 0 ? front - back : front + back;
        if (this.inView(x, y, 80)) x = team === 0 ? this.view.x - 80 - this.rng() * 200 : this.view.x + this.view.w + 80 + this.rng() * 200;
        x = Math.max(margin, Math.min(this.worldW - margin, x));
      }
      const [cx, cy] = g.cellOf(x, y);
      if (g.isBlockedCell(cx, cy)) continue;
      if (!Number.isFinite(this.flow[team][cy * g.w + cx])) continue;
      let crowded = false;
      this.hash.query(x, y, 14, (u) => {
        if (u.alive && Math.hypot(u.x - x, u.y - y) < 14) crowded = true;
      });
      if (crowded) continue;
      return [x, y];
    }
    return null;
  }

  spawn(team, deploy = false, zone = null) {
    const def = this.pickUnit(team);
    const p = this.spawnPoint(team, deploy, zone);
    if (!p) return null;
    const u = new Unit(this, def, team, p[0], p[1]);
    if (CONFIG.debug) u.hpBar = new HpBar(this);
    this.units.push(u);
    this.hash.rebuild(this.units);
    return u;
  }

  damage(target, amount, source) {
    if (!target.alive) return;
    target.hp -= amount * CONFIG.lethality;
    if (target.hp <= 0) {
      target.die(source);
      this.hotspots.note(target.x, target.y, target.kind === 'vehicle' ? 3 : 1);
      if (source && source.team >= 0) this.kills[source.team]++;
    }
  }

  /** Visual impact of a weapon (no damage). */
  impact(weapon, x, y) {
    const list = weapon.impacts;
    if (!list.length) return;
    const name = list[Math.floor(this.rng() * list.length)];
    this.effects.play(name, x, y, { depth: y + 3 });
  }

  /** Projectile arrival: area damage around the impact point plus effects. */
  explode(weapon, x, y, source) {
    const radius = Math.max(weapon.spread, 3);
    const hit = this.hitScratch || (this.hitScratch = []);
    hit.length = 0;
    const near = this.hash.near(x, y, radius + 24);
    for (let i = 0; i < near.length; i++) {
      const u = near[i];
      if (!u.alive || u.team === source.team) continue;
      if (Math.hypot(u.x - x, u.y + u.hitOffsetY - y) <= radius + u.radius) hit.push(u);
    }
    // damage after collecting: a death can trigger effects that query the hash again
    for (let i = 0; i < hit.length; i++) this.damage(hit[i], weapon.damage[hit[i].kind] ?? 100, source);
    this.impact(weapon, x, y);
    if (weapon.smudge) {
      this.hotspots.note(x, y, 0.5);
      if (this.rng() < 0.35 && !this.grid.isBlockedAt(x, y)) {
        this.effects.decal(`crater_${'abcdefghi'[Math.floor(this.rng() * 9)]}`, x, y + 4);
      }
    }
  }

  /** Push apart units whose footprints overlap (steering alone lets vehicles stack). */
  resolveOverlaps() {
    const units = this.units;
    for (let i = 0; i < units.length; i++) {
      const a = units[i];
      if (!a.alive) continue;
      const near = this.hash.near(a.x, a.y, a.radius + 24);
      for (let j = 0; j < near.length; j++) {
        const b = near[j];
        if (b === a || !b.alive || b.id < a.id) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const nx = d2 ? dx / d : this.rng() - 0.5;
        const ny = d2 ? dy / d : this.rng() - 0.5;
        const push = (min - d) * 0.25;
        // heavier units yield less
        const wa = b.radius / (a.radius + b.radius);
        a.tryStep(-nx * push * wa * 2, -ny * push * wa * 2);
        b.tryStep(nx * push * (1 - wa) * 2, ny * push * (1 - wa) * 2);
      }
    }
  }

  addWreck(spr, life) {
    this.wrecks.push({ spr, life });
  }

  /** World rectangle currently on screen. */
  updateView() {
    const cam = this.cameras.main;
    const w = cam.width / cam.zoom;
    const h = cam.height / cam.zoom;
    this.view = { x: cam.scrollX + cam.width / 2 - w / 2, y: cam.scrollY + cam.height / 2 - h / 2, w, h };
  }

  inView(x, y, margin = 64) {
    const v = this.view;
    return x > v.x - margin && x < v.x + v.w + margin && y > v.y - margin && y < v.y + v.h + margin;
  }

  /**
   * Tug of war: the side that has been pushed back toward its own edge reinforces faster,
   * with bigger waves and a higher unit cap, so the front swings back and forth.
   */
  updateBalance() {
    const prog = [0, 0];
    const count = [0, 0];
    for (const u of this.units) {
      prog[u.team] += u.team === 0 ? u.x / this.worldW : 1 - u.x / this.worldW;
      count[u.team]++;
    }
    for (let t = 0; t < 2; t++) prog[t] = count[t] ? prog[t] / count[t] : 0;
    this.progress = prog;

    // where the two sides meet on each route (between the lead units of both sides)
    let frontSum = 0;
    let frontN = 0;
    for (const zs of this.zones) {
      for (const z of zs) {
        const xs = [[], []];
        for (const u of this.units) if (u.y >= z.y0 - 400 && u.y <= z.y1 + 400) xs[u.team].push(u.x);
        xs[0].sort((a, c) => a - c);
        xs[1].sort((a, c) => a - c);
        const lead0 = xs[0].length ? xs[0][Math.floor(xs[0].length * 0.8)] : null;
        const lead1 = xs[1].length ? xs[1][Math.floor(xs[1].length * 0.2)] : null;
        let front = this.worldW / 2;
        if (lead0 !== null && lead1 !== null) front = (lead0 + lead1) / 2;
        else if (lead0 !== null) front = lead0 + 600;
        else if (lead1 !== null) front = lead1 - 600;
        z.front = z.front === undefined ? front : z.front * 0.7 + front * 0.3;
        frontSum += z.front;
        frontN++;
      }
    }
    // 0.5 = even; above 0.5 the right-hand side (team 1) has been pushed back
    this.front = frontN ? frontSum / frontN / this.worldW : 0.5;

    // offensives: every so often one side surges forward, usually the one that is losing ground
    this.offensiveT -= 1000;
    if (this.offensiveT <= 0) {
      if (this.offensive) {
        this.offensive = null;
        this.offensiveT = (45 + this.rng() * 45) * 1000;
      } else {
        const behind = this.front > 0.5 ? 1 : 0;
        const p = 0.5 + Math.min(0.4, Math.abs(this.front - 0.5) * 3);
        this.offensive = { team: this.rng() < p ? behind : 1 - behind };
        this.offensiveT = 25000;
      }
    }

    for (let t = 0; t < 2; t++) {
      const o = 1 - t;
      const lost = Math.max(0, t === 0 ? 0.5 - this.front : this.front - 0.5);
      const outnumbered = count[t] < count[o] ? Math.min(0.5, (count[o] - count[t]) / Math.max(6, count[o])) : 0;
      this.boost[t] = 1 + Math.min(1.2, lost * 5) + outnumbered + (this.offensive?.team === t ? 1 : 0);
      this.cap[t] = Math.round(this.baseCap * Math.min(1.6, 0.85 + 0.25 * this.boost[t]));
    }
  }

  update(time, delta) {
    if (!this.world || !this.flow) return;
    const t0 = performance.now();
    this.step(delta);
    // frame-cost statistics (read by tests and the debug overlay)
    const ms = performance.now() - t0;
    const p = (this.perf ||= { n: 0, sum: 0, max: 0 });
    p.n++;
    p.sum += ms;
    if (ms > p.max) p.max = ms;
  }

  step(delta) {
    const dt = Math.min(delta, 100) * CONFIG.speed;
    this.updateView();

    const units = this.units;
    this.hash.rebuild(units);
    // level of detail: units near the screen update every frame; the rest every ~200 ms (staggered,
    // with the elapsed time), which is plenty for a battle nobody is looking at
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (CONFIG.lod && !this.inView(u.x, u.y, LOD_MARGIN)) {
        u.lodT += dt;
        if (u.lodT < LOD_INTERVAL) continue;
        const step = u.lodT;
        u.lodT = 0;
        u.update(step);
      } else {
        if (u.lodT > 0) {
          // catch up on time accumulated off-screen before resuming per-frame updates
          const step = u.lodT;
          u.lodT = 0;
          u.update(step);
        }
        u.update(dt);
      }
    }
    // drop dead / departed units in place and count each side
    let w = 0;
    this.count[0] = 0;
    this.count[1] = 0;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.alive && u.exited) {
        this.exits[u.team]++;
        u.remove();
      }
      if (!u.alive) continue;
      this.count[u.team]++;
      units[w++] = u;
    }
    units.length = w;
    this.hash.rebuild(units);
    this.resolveOverlaps();
    this.effects.update(dt);

    const wrecks = this.wrecks;
    w = 0;
    for (let i = 0; i < wrecks.length; i++) {
      const wr = wrecks[i];
      wr.life -= dt;
      if (wr.life <= 0) {
        wr.spr.destroy();
        continue;
      }
      if (wr.life < 3000) wr.spr.setAlpha(wr.life / 3000);
      wrecks[w++] = wr;
    }
    wrecks.length = w;

    // only draw what is near the screen
    this.cullT = (this.cullT || 0) - dt;
    if (this.cullT <= 0) {
      this.cullT = 250;
      this.cullDecor();
      for (const d of this.effects.decals) d.spr.setVisible(this.inView(d.spr.x, d.spr.y, 64));
      for (const w of this.wrecks) w.spr.setVisible(this.inView(w.spr.x, w.spr.y, 64));
    }
    for (const d of this.animatedDecor) {
      d.t += dt;
      if (d.spr.displayList) d.spr.setFrame(fname(d.seq.start + (Math.floor(d.t / d.seq.tick) % d.seq.length)));
    }

    this.balanceT -= dt;
    if (this.balanceT <= 0) {
      this.balanceT = 1000;
      this.updateBalance();
    }

    // reinforcement waves from a random entry zone
    for (let team = 0; team < 2; team++) {
      this.waveTimer[team] -= dt * this.boost[team];
      if (this.waveTimer[team] > 0) continue;
      this.waveTimer[team] = CONFIG.waveInterval * 1000 * (0.6 + this.rng() * 0.8);
      const room = this.cap[team] - this.count[team];
      if (room <= 0) continue;
      const size = 6 + Math.floor(this.rng() * 6) + (this.boost[team] > 1.5 ? 4 : 0);
      const zone = this.waveZone(team);
      for (let i = 0; i < Math.min(room, size); i++) this.spawn(team, false, zone);
    }

    this.airTimer -= dt;
    if (this.airTimer <= 0) {
      this.resetAirTimer();
      this.callAirstrike();
    }
    if (this.airstrikes.length) {
      for (const s of this.airstrikes) s.update(dt);
      this.airstrikes = this.airstrikes.filter((s) => !s.done);
    }

    this.roamer.update(dt);
    this.hotspots.tick(dt);

    this.updateView();
    this.terrain?.update(this.view);

    this.mapTimer -= dt;
    if (this.mapTimer <= 0) this.rotateWorld();

    if (this.debugText) {
      const c = [0, 1].map((t) => this.units.filter((u) => u.team === t).length);
      const titles = this.world.parts.map((p) => p.title).join(', ');
      if (!this.gpuInfo) {
        const gl = this.game.renderer.gl;
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        this.gpuInfo = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown GPU';
      }
      const cam = this.cameras.main;
      this.debugText.textContent =
        `${this.gpuInfo} | dpr ${window.devicePixelRatio} canvas ${this.game.canvas.width}x${this.game.canvas.height} ` +
        `css ${this.game.canvas.clientWidth}x${this.game.canvas.clientHeight} zoom ${cam.zoom} scroll ${cam.scrollX.toFixed(2)},${cam.scrollY.toFixed(2)}
` +
        `${this.world.tileset} ${this.world.width}x${this.world.height}: ${titles}\n` +
        `fps ${Math.round(this.game.loop.actualFps)}  update ${this.perf ? (this.perf.sum / Math.max(1, this.perf.n)).toFixed(2) : '?'} ms  units ${c[0]} vs ${c[1]} (cap ${this.cap[0]}/${this.cap[1]})  ` +
        `front ${this.front.toFixed(2)}${this.offensive ? ` OFFENSIVE ${this.offensive.team}` : ''}  boost ${this.boost[0].toFixed(2)}/${this.boost[1].toFixed(2)}  ` +
        `kills ${this.kills[0]}:${this.kills[1]}  exits ${this.exits[0]}:${this.exits[1]}  fx ${this.effects.items.length}`;
    }
  }

  /** Re-apply settings: optionally build a new world, otherwise restart the fight. */
  restart(newWorld) {
    this.time.timeScale = CONFIG.speed;
    this.rosters = this.buildRosters();
    if (newWorld) {
      this.loadWorld();
    } else {
      this.startBattle();
      this.layoutCamera();
    }
  }

  resetAirTimer(first = false) {
    const m = CONFIG.airstrike;
    this.airTimer = m > 0 ? m * 60000 * (first ? 0.4 + this.rng() * 0.3 : 0.6 + this.rng() * 0.8) : Infinity;
  }

  /** The side being pushed back calls in its aircraft on the thickest group of enemies on screen. */
  callAirstrike() {
    const count = [0, 1].map((t) => this.units.filter((u) => u.team === t).length);
    let team = count[0] === count[1] ? (this.rng() < 0.5 ? 0 : 1) : count[0] < count[1] ? 0 : 1;
    if (this.boost[0] !== this.boost[1]) team = this.boost[0] > this.boost[1] ? 0 : 1;
    const own = this.units.filter((u) => u.team === team);
    const evolved = own.filter((u) => u.def.faction === 'evolved').length;
    const faction = own.length ? (evolved > own.length / 2 ? 'evolved' : 'survivors') : (CONFIG.teams[team] === 'evolved' ? 'evolved' : 'survivors');
    const def = this.db.aircraft?.[faction];
    if (!def) return;
    let best = null;
    let bestN = 0;
    for (const e of this.units) {
      if (e.team === team || !this.inView(e.x, e.y, -40)) continue;
      let n = 0;
      this.hash.query(e.x, e.y, 70, (u) => {
        if (u.alive && u.team !== team && Math.hypot(u.x - e.x, u.y - e.y) < 70) n++;
      });
      if (n > bestN) {
        bestN = n;
        best = e;
      }
    }
    if (!best || bestN < 2) return;
    this.airstrikes.push(new Airstrike(this, team, def, [best.x, best.y]));
  }

  resetRotateTimer() {
    this.mapTimer = CONFIG.rotate > 0 ? CONFIG.rotate * 60000 : Infinity;
  }

  rotateWorld() {
    this.mapTimer = Infinity;
    const cam = this.cameras.main;
    cam.fadeOut(1500, 0, 0, 0);
    cam.once('camerafadeoutcomplete', () => {
      this.loadWorld();
      cam.fadeIn(1500, 0, 0, 0);
    });
  }

  drawDebugGrid() {
    this.debugGfx?.destroy();
    const g = this.add.graphics().setDepth(DEPTH.top);
    const T = this.world.tile;
    g.fillStyle(0xff0000, 0.18);
    for (let y = 0; y < this.grid.h; y++) {
      for (let x = 0; x < this.grid.w; x++) if (this.grid.isBlockedCell(x, y)) g.fillRect(x * T, y * T, T, T);
    }
    g.lineStyle(2, 0x00ff00, 0.7);
    for (const p of this.world.parts) g.strokeRect(p.x * T, p.y * T, p.w * T, p.h * T);
    g.lineStyle(2, 0xffff00, 0.8);
    for (const zs of this.zones) for (const z of zs) g.strokeRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
    this.debugGfx = g;
  }
}

class HpBar {
  constructor(scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.top);
  }

  update(u) {
    const w = 14;
    const f = Math.max(0, u.hp / u.def.hp);
    this.g.clear().fillStyle(0x000000, 0.7).fillRect(u.x - w / 2, u.y - 26, w, 3);
    this.g.fillStyle(u.team === 0 ? 0x40a0ff : 0xff4040).fillRect(u.x - w / 2, u.y - 26, w * f, 3);
  }

  destroy() {
    this.g.destroy();
  }
}
