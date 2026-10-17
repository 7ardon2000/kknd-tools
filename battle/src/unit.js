import { CONFIG } from './config.js';
import { DEPTH } from './effects.js';
import { FACINGS, facingDelta, facingFromVector, fname, frameIndex } from './sprites.js';

let nextId = 1;
const NO_POINT = [0, 0, 0];
const DEFAULT_MUZZLE = [0, 0, -8];
const OFFSCREEN_HASTE = 2.5;
const AGGRO_RANGE = 420;

export class Unit {
  constructor(battle, def, team, x, y) {
    this.id = nextId++;
    this.battle = battle;
    this.def = def;
    this.team = team;
    this.red = team === 1;
    this.x = x;
    this.y = y;
    this.hp = def.hp;
    this.alive = true;
    this.kind = def.kind;
    this.seq = def.seq;
    this.weapon = def.weapon;
    this.hasTurret = !!def.seq.turret;

    const startFacing = team === 0 ? 4 : 12; // face the enemy side
    this.facing = startFacing;
    this.turretFacing = startFacing;
    this.target = null;
    this.retargetT = battle.rng() * 400;
    this.cooldown = battle.rng() * this.weapon.reload;
    this.burstLeft = this.weapon.burst;
    this.moving = false;
    this.moveT = battle.rng() * 1000;
    this.shootT = Infinity;
    this.stuckT = 0;
    this.exited = false;
    this.wander = (battle.rng() - 0.5) * 0.4; // marching heading offset (radians)
    // time accumulated while updated at reduced rate off-screen (see BattleScene LOD)
    this.lodT = battle.rng() * 200;
    // scratch storage reused every frame (no per-frame allocations)
    this.dirv = [0, 0];
    this.sepX = 0;
    this.sepY = 0;
    this.bf = { sprite: '', frame: 0, seq: null };
    this.muzzle = [0, 0];

    const bank = battle.bank;
    const idle = frameIndex(this.seq.idle, Math.round(this.facing));
    this.body = battle.add.sprite(x, y, bank.textureKey(this.seq.idle.sprite, this.red), String(idle));
    if (this.hasTurret) {
      this.turret = battle.add.sprite(x, y, bank.textureKey(this.seq.turret.sprite, this.red), String(frameIndex(this.seq.turret, startFacing)));
    }
    const [w, h] = bank.frameSize(this.seq.idle.sprite, idle);
    this.radius = this.kind === 'infantry' ? 7 : Math.max(8, Math.min(22, Math.max(w, h) * 0.32));
    this.vision = Math.max(this.weapon.range * 1.5, 190);
    // marching units notice enemies from further away and turn to engage them
    this.aggro = Math.max(this.vision, AGGRO_RANGE);
    this.hitOffsetY = this.kind === 'infantry' ? -7 : -2;
    this.render();
  }

  get dir() {
    return Math.round(this.facing) % FACINGS;
  }

  get aimDir() {
    return Math.round(this.hasTurret ? this.turretFacing : this.facing) % FACINGS;
  }

  distTo(u) {
    return Math.hypot(u.x - this.x, u.y - this.y);
  }

  inRange(u) {
    return this.distTo(u) <= this.weapon.range + u.radius * 0.5;
  }

  pickTarget() {
    let best = null;
    let bestScore = Infinity;
    const range = this.target ? this.vision : this.aggro;
    const near = this.battle.hash.near(this.x, this.y, range);
    for (let i = 0; i < near.length; i++) {
      const u = near[i];
      if (!u.alive || u.team === this.team) continue;
      const d = this.distTo(u);
      if (d > range) continue;
      // prefer things we can hurt, and the current target (avoid jitter)
      const dmg = this.weapon.damage[u.kind] ?? 100;
      // prefer enemies roughly ahead so the front stays spread out instead of collapsing into one brawl
      const lane = Math.abs(u.y - this.y) * 1.1;
      const score = (d + lane) / Math.max(0.2, dmg / 100) * (u === this.target ? 0.7 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = u;
      }
    }
    this.target = best;
  }

  update(dt) {
    if (!this.alive) return;
    const b = this.battle;
    this.cooldown -= dt;
    this.shootT += dt;
    this.retargetT -= dt;
    if (this.target && (!this.target.alive || this.distTo(this.target) > this.aggro * 1.2)) this.target = null;
    if (this.retargetT <= 0) {
      this.retargetT = 350 + b.rng() * 250;
      this.pickTarget();
    }

    const t = this.target;
    let wantMove = null;
    if (t && this.inRange(t)) {
      this.aimAt(t, dt);
    } else {
      if (t) {
        // close in: straight if possible, otherwise follow the team's flow field
        if (b.grid.lineOfSight(this.x, this.y, t.x, t.y)) {
          const dx = t.x - this.x;
          const dy = t.y - this.y;
          const l = Math.hypot(dx, dy) || 1;
          let vx = dx / l;
          let vy = dy / l;
          // far away and ahead: keep advancing in the unit's own lane and angle in gradually, instead of
          // every unit near a fight beelining for it in a line
          const ahead = this.team === 0 ? dx > 0 : dx < 0;
          const fwd = ahead ? Math.max(0, Math.min(1, (l - this.weapon.range * 1.3) / 300)) * 0.75 : 0;
          if (fwd > 0) {
            vx = vx * (1 - fwd) + (this.team === 0 ? 1 : -1) * fwd;
            vy *= 1 - fwd;
            const n = Math.hypot(vx, vy) || 1;
            vx /= n;
            vy /= n;
          }
          this.dirv[0] = vx;
          this.dirv[1] = vy;
          wantMove = this.dirv;
        } else {
          wantMove = b.grid.flowDir(b.flow[this.team], this.x, this.y, this.dirv);
        }
      } else {
        // nobody to fight: keep marching; at the far edge of the world the unit leaves the battle
        const T = b.grid.tile;
        if (b.flow[this.team][Math.floor(this.y / T) * b.grid.w + Math.floor(this.x / T)] <= 1.5) this.exited = true;
        wantMove = b.grid.flowDir(b.flow[this.team], this.x, this.y, this.dirv);
        if (wantMove) {
          // a slowly wandering heading offset (up to ~13 degrees) so columns fan out naturally
          this.wander += (b.rng() - 0.5) * 0.004 * dt - this.wander * 0.0004 * dt;
          this.wander = Math.max(-0.23, Math.min(0.23, this.wander));
          const c = Math.cos(this.wander);
          const s = Math.sin(this.wander);
          const vx = wantMove[0] * c - wantMove[1] * s;
          wantMove[1] = wantMove[0] * s + wantMove[1] * c;
          wantMove[0] = vx;
        }
      }
      if (this.hasTurret) this.turnTurret(this.facing, dt);
    }

    this.moving = false;
    if (wantMove) this.moveAlong(wantMove, dt);
    else this.separate(dt);
    if (this.moving) this.moveT += dt;

    if (t && this.inRange(t) && this.cooldown <= 0 && this.isAimed(t)) this.fire(t);
    this.render();
  }

  aimAt(t, dt) {
    const want = facingFromVector(t.x - this.x, t.y + t.hitOffsetY - this.y);
    if (this.hasTurret) this.turnTurret(want, dt);
    else if (this.kind === 'infantry') this.facing = Math.round(want) % FACINGS;
    else this.turnBody(want, dt);
  }

  isAimed(t) {
    const want = facingFromVector(t.x - this.x, t.y - this.y);
    const cur = this.hasTurret ? this.turretFacing : this.facing;
    return Math.abs(facingDelta(cur, want)) <= 0.75;
  }

  turnBody(want, dt) {
    const d = facingDelta(this.facing, want);
    const maxStep = (this.def.turnSpeed * dt) / 1000;
    this.facing = (this.facing + Math.max(-maxStep, Math.min(maxStep, d)) + FACINGS) % FACINGS;
  }

  turnTurret(want, dt) {
    const d = facingDelta(this.turretFacing, want);
    const maxStep = ((this.def.turretTurnSpeed || 8) * dt) / 1000;
    this.turretFacing = (this.turretFacing + Math.max(-maxStep, Math.min(maxStep, d)) + FACINGS) % FACINGS;
  }

  /** Neighbour push so units do not stack on one spot. */
  /** Sets this.sepX / this.sepY. */
  separationVector() {
    let sx = 0;
    let sy = 0;
    const near = this.battle.hash.near(this.x, this.y, this.radius + 26);
    for (let i = 0; i < near.length; i++) {
      const u = near[i];
      if (u === this || !u.alive) continue;
      const dx = this.x - u.x;
      const dy = this.y - u.y;
      const min = this.radius + u.radius + 2;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) / min;
      sx += (dx / d) * push;
      sy += (dy / d) * push;
    }
    this.sepX = sx;
    this.sepY = sy;
  }

  separate(dt) {
    this.separationVector();
    const sx = this.sepX;
    const sy = this.sepY;
    if (Math.abs(sx) + Math.abs(sy) < 0.05) return;
    this.tryStep(sx * this.def.speed * 0.5 * dt / 1000, sy * this.def.speed * 0.5 * dt / 1000);
  }

  moveAlong(dir, dt) {
    this.separationVector();
    const sx = this.sepX;
    const sy = this.sepY;
    let vx = dir[0] + sx * 1.2;
    let vy = dir[1] + sy * 1.2;
    const l = Math.hypot(vx, vy) || 1;
    vx /= l;
    vy /= l;
    let speed = this.def.speed;
    // reinforcements marching off-screen hurry to the front; nobody sees it, the front stays busy
    if (!this.target && !this.battle.inView(this.x, this.y, 120)) speed *= OFFSCREEN_HASTE;
    const want = facingFromVector(vx, vy);
    if (this.kind === 'infantry') {
      this.facing = Math.round(want) % FACINGS;
    } else {
      this.turnBody(want, dt);
      // vehicles slow down while turning hard
      const misalign = Math.abs(facingDelta(this.facing, want));
      speed *= misalign > 3 ? 0.15 : misalign > 1.5 ? 0.5 : 1;
    }
    const step = (speed * dt) / 1000;
    // long steps (reduced-rate updates off-screen) are split so units never skip over a wall cell
    const parts = Math.max(1, Math.ceil(step / 10));
    let moved = 0;
    for (let k = 0; k < parts; k++) moved += this.tryStep((vx * step) / parts, (vy * step) / parts);
    this.moving = moved > step * 0.2;
    this.stuckT = this.moving ? 0 : this.stuckT + dt;
  }

  tryStep(dx, dy) {
    const g = this.battle.grid;
    if (!g.isBlockedAt(this.x + dx, this.y + dy)) {
      this.x += dx;
      this.y += dy;
      return Math.hypot(dx, dy);
    }
    if (!g.isBlockedAt(this.x + dx, this.y)) {
      this.x += dx;
      return Math.abs(dx);
    }
    if (!g.isBlockedAt(this.x, this.y + dy)) {
      this.y += dy;
      return Math.abs(dy);
    }
    return 0;
  }

  /** World position of the weapon muzzle for the current aim, from the MOBD points. */
  muzzlePos() {
    const bank = this.battle.bank;
    const dir = this.aimDir;
    if (this.hasTurret) {
      const bf = this.bodyFrame();
      const bp = bank.point(bf.sprite, bf.frame, 0) || NO_POINT;
      const tseq = this.seq.turret;
      const tp = bank.point(tseq.sprite, frameIndex(tseq, dir), 0) || NO_POINT;
      this.muzzle[0] = this.x + bp[1] + tp[1];
      this.muzzle[1] = this.y + bp[2] + tp[2];
      return this.muzzle;
    }
    const sseq = this.seq.shoot || this.seq.aim || this.seq.idle;
    const p = bank.point(sseq.sprite, frameIndex(sseq, dir, 0), 0)
      || bank.point(this.seq.idle.sprite, frameIndex(this.seq.idle, dir), 0) || DEFAULT_MUZZLE;
    this.muzzle[0] = this.x + p[1];
    this.muzzle[1] = this.y + p[2];
    return this.muzzle;
  }

  fire(t) {
    const b = this.battle;
    const w = this.weapon;
    const dir = this.aimDir;
    const [mx, my] = this.muzzlePos();
    this.shootT = 0;

    if (this.def.muzzle) {
      const self = this;
      const m = this.def.muzzle;
      b.effects.play(m, mx, my, {
        dir,
        depth: this.y + 0.5 + (dir >= 3 && dir <= 13 ? 0 : -1), // flashes pointing north tuck behind the body
        follow: () => (self.alive ? self.muzzlePos() : null),
      });
    }

    const tx = t.x;
    const ty = t.y + t.hitOffsetY;
    if (w.projectile.type === 'instant') {
      b.time.delayedCall(40, () => {
        const jx = (b.rng() - 0.5) * 8;
        const jy = (b.rng() - 0.5) * 6;
        if (t.alive) b.damage(t, w.damage[t.kind] ?? 100, this);
        b.impact(w, t.x + jx, t.y + t.hitOffsetY + jy, false);
      });
    } else {
      const p = w.projectile;
      const d = Math.hypot(tx - mx, ty - my);
      const inacc = p.inaccuracy * Math.min(1, d / w.range);
      const ang = b.rng() * Math.PI * 2;
      const r = b.rng() * inacc;
      const ax = tx + Math.cos(ang) * r;
      const ay = ty + Math.sin(ang) * r * 0.75;
      b.effects.projectile(p, this.red, mx, my, ax, ay, (hx, hy) => b.explode(w, hx, hy, this));
    }

    this.burstLeft--;
    if (this.burstLeft > 0) {
      this.cooldown = w.burstDelay;
    } else {
      this.burstLeft = w.burst;
      this.cooldown = w.reload * (0.9 + b.rng() * 0.2);
    }
  }

  bodyFrame() {
    const s = this.seq;
    const dir = this.dir;
    if (this.moving) {
      const steps = Math.floor(this.moveT / s.move.tick);
      return this.setBf(s.move, frameIndex(s.move, dir, steps));
    }
    if (!this.hasTurret && s.shoot && this.shootT < s.shoot.length * s.shoot.tick) {
      return this.setBf(s.shoot, frameIndex(s.shoot, dir, Math.floor(this.shootT / s.shoot.tick)));
    }
    if (!this.hasTurret && this.target && s.aim && this.inRange(this.target)) {
      return this.setBf(s.aim, frameIndex(s.aim, dir, 0));
    }
    return this.setBf(s.idle, frameIndex(s.idle, dir, 0));
  }

  setBf(seq, frame) {
    this.bf.sprite = seq.sprite;
    this.bf.frame = frame;
    this.bf.seq = seq;
    return this.bf;
  }

  render() {
    const bank = this.battle.bank;
    // off-screen units keep fighting but are not drawn
    const visible = this.battle.inView(this.x, this.y, 48);
    this.body.setVisible(visible);
    this.turret?.setVisible(visible);
    if (this.hpBar) this.hpBar.g.setVisible(visible);
    if (!visible) return;
    const bf = this.bodyFrame();
    const key = bank.textureKey(bf.sprite, this.red);
    if (this.body.texture.key !== key) this.body.setTexture(key, fname(bf.frame));
    else if (this.body.frame.name !== fname(bf.frame)) this.body.setFrame(fname(bf.frame));
    this.body.setPosition(this.x, this.y);
    // any depth change makes Phaser re-sort the display list: only set it when it really changed
    if (this.body.depth !== this.y) this.body.setDepth(this.y);
    if (this.turret) {
      const bp = bank.point(bf.sprite, bf.frame, 0) || NO_POINT;
      const s = this.seq;
      const dir = Math.round(this.turretFacing) % FACINGS;
      let tseq = s.turret;
      let step = 0;
      if (s.shoot && this.shootT < s.shoot.length * s.shoot.tick) {
        tseq = s.shoot;
        step = Math.floor(this.shootT / s.shoot.tick);
      }
      const tkey = bank.textureKey(tseq.sprite, this.red);
      if (this.turret.texture.key !== tkey) this.turret.setTexture(tkey);
      const tf = fname(frameIndex(tseq, dir, step));
      if (this.turret.frame.name !== tf) this.turret.setFrame(tf);
      this.turret.setPosition(this.x + bp[1], this.y + bp[2]);
      if (this.turret.depth !== this.y + 0.2) this.turret.setDepth(this.y + 0.2);
    }
    if (this.hpBar) this.hpBar.update(this);
  }

  /** Remove without death effects (map change). */
  remove() {
    this.alive = false;
    this.body.destroy();
    this.turret?.destroy();
    this.hpBar?.destroy();
  }

  die(killer) {
    if (!this.alive) return;
    this.alive = false;
    const b = this.battle;
    const fx = b.effects;
    const corpseMs = CONFIG.corpseTime * 1000;
    if (this.kind === 'infantry') {
      // flamethrowers burn, explosives blow apart (OpenKrush DeathTypes), everything else falls over
      const special = killer?.weapon?.deathType && fx.effectSeq(`${killer.weapon.deathType}_${this.def.faction}`);
      const seq = special || this.def.die || fx.effectSeq(this.def.faction === 'evolved' ? 'die_evolved' : 'die_survivors');
      fx.play(seq, this.x, this.y, { depth: DEPTH.corpse + this.y, hold: corpseMs, fade: 3000 });
      const n = 1 + Math.floor(b.rng() * 2);
      for (let i = 0; i < n; i++) {
        fx.debris(`blood${1 + Math.floor(b.rng() * 5)}`, this.x, this.y - 6, 6 + b.rng() * 14, 8 + b.rng() * 10, 350 + b.rng() * 250);
      }
    } else if (this.def.die) {
      // beasts with their own death animation (Dire Wolf) bleed instead of exploding
      fx.play(this.def.die, this.x, this.y, { depth: DEPTH.corpse + this.y, hold: corpseMs, fade: 3000 });
      for (let i = 0; i < 3; i++) {
        fx.debris(`blood${1 + Math.floor(b.rng() * 5)}`, this.x, this.y - 6, 8 + b.rng() * 18, 8 + b.rng() * 12, 400 + b.rng() * 300);
      }
    } else {
      const big = this.radius > 14;
      fx.play(big ? 'explosion_l' : 'explosion_m', this.x, this.y - 4, { depth: this.y + 5 });
      fx.decal(`crater_${'abcdefghi'[Math.floor(b.rng() * 9)]}`, this.x, this.y);
      const pieces = 3 + Math.floor(b.rng() * 4);
      for (let i = 0; i < pieces; i++) {
        const name = b.rng() < 0.6 ? `debris${1 + Math.floor(b.rng() * 3)}` : `spark${1 + Math.floor(b.rng() * 2)}`;
        fx.debris(name, this.x, this.y - 6, 15 + b.rng() * 35, 15 + b.rng() * 30, 500 + b.rng() * 500);
      }
      // smoking wreck that burns out
      const wreck = b.add.sprite(Math.round(this.x), Math.round(this.y), this.body.texture.key, this.body.frame.name)
        .setTint(0x705848).setDepth(DEPTH.corpse + this.y);
      b.addWreck(wreck, Math.min(corpseMs, 12000));
      fx.play('flamethrower', this.x + (b.rng() - 0.5) * 6, this.y - 2, { depth: this.y + 2, loops: 3 });
    }
    this.body.destroy();
    this.turret?.destroy();
    this.hpBar?.destroy();
  }
}
