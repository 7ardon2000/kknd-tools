import { DEPTH } from './effects.js';
import { frameIndex } from './sprites.js';

const ALTITUDE = 46; // px between an aircraft and its shadow on the ground
const KILL_RADIUS = 46;
const HURT_RADIUS = 90;

/**
 * A Survivors bomber or Evolved wasp crosses the screen and drops a parachute bomb
 * on the densest group of enemies (the OpenKrush "nuke" superweapon, scaled down).
 */
export class Airstrike {
  constructor(battle, team, def, target) {
    this.b = battle;
    this.team = team;
    this.def = def;
    this.red = team === 1;
    this.dir = team === 0 ? 1 : -1;
    this.facing = team === 0 ? 4 : 12;
    this.tx = target[0];
    this.ty = target[1];
    const v = battle.view; // fly across the screen so the strike is seen
    this.x = team === 0 ? v.x - 90 : v.x + v.w + 90;
    this.endX = team === 0 ? v.x + v.w + 90 : v.x - 90;
    this.y = this.ty;
    this.t = 0;
    this.dropped = false;
    this.done = false;

    const bank = battle.bank;
    const seq = def.seq;
    // the frames before the flight frames are the dithered ground shadows, one per facing
    this.shadowSeq = { ...seq, start: seq.start - 16, length: 1, stride: 1 };
    this.shadow = battle.add.sprite(this.x, this.y, bank.textureKey(seq.sprite, this.red), String(frameIndex(this.shadowSeq, this.facing)))
      .setTint(0x000000).setAlpha(0.4).setDepth(DEPTH.ground + 50000);
    this.sprite = battle.add.sprite(this.x, this.y - ALTITUDE, bank.textureKey(seq.sprite, this.red), String(frameIndex(seq, this.facing)))
      .setDepth(DEPTH.top - 10);
  }

  update(dt) {
    if (this.done) return;
    const b = this.b;
    this.t += dt;
    this.x += this.dir * this.def.speed * dt / 1000;
    const seq = this.def.seq;
    this.sprite.setFrame(String(frameIndex(seq, this.facing, Math.floor(this.t / seq.tick))));
    this.sprite.setPosition(this.x, this.y - ALTITUDE);
    this.shadow.setPosition(this.x + 10, this.y + 6);

    if (!this.dropped && (this.x - this.tx) * this.dir >= 0) {
      this.dropped = true;
      this.dropBomb(this.x, this.y);
    }
    if ((this.x - this.endX) * this.dir >= 0) {
      this.sprite.destroy();
      this.shadow.destroy();
      this.done = !this.bombActive;
      this.flown = true;
    }
  }

  dropBomb(x, groundY) {
    const b = this.b;
    const seq = this.def.bomb;
    const fall = seq.length * seq.tick;
    this.bombActive = true;
    const bomb = b.add.sprite(x, groundY - ALTITUDE, b.bank.textureKey(seq.sprite, this.red), String(seq.start)).setDepth(DEPTH.top - 11);
    let t = 0;
    const ev = b.time.addEvent({
      delay: 16,
      loop: true,
      callback: () => {
        t += 16 * b.time.timeScale;
        const p = Math.min(1, t / fall);
        bomb.setPosition(x, groundY - ALTITUDE * (1 - p));
        bomb.setFrame(String(seq.start + Math.min(seq.length - 1, Math.floor(t / seq.tick))));
        if (p >= 1) {
          ev.remove();
          bomb.destroy();
          this.detonate(x, groundY);
          this.bombActive = false;
          if (this.flown) this.done = true;
        }
      },
    });
  }

  detonate(x, y) {
    const b = this.b;
    const fx = b.effects;
    fx.play('explosion_xl', x, y - 10, { depth: y + 20 });
    b.cameras.main.shake(350, 0.003);
    for (let i = 0; i < 9; i++) {
      const ang = b.rng() * Math.PI * 2;
      const r = 12 + b.rng() * (HURT_RADIUS - 20);
      b.time.delayedCall(150 + i * 90 + b.rng() * 100, () => {
        const ex = x + Math.cos(ang) * r;
        const ey = y + Math.sin(ang) * r * 0.75;
        fx.play(b.rng() < 0.5 ? 'explosion_s' : 'explosion_xs', ex, ey, { depth: ey + 10 });
        if (b.rng() < 0.5 && !b.grid.isBlockedAt(ex, ey)) fx.decal(`crater_${'abcdefghi'[Math.floor(b.rng() * 9)]}`, ex, ey + 4);
      });
    }
    fx.decal('crater_a', x, y + 4);
    // a bomb does not care whose side you are on
    const source = { team: -1, weapon: { deathType: 'explode' } };
    for (const u of b.units) {
      if (!u.alive) continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (d <= KILL_RADIUS) b.damage(u, u.def.hp * 2, source);
      else if (d <= HURT_RADIUS) b.damage(u, u.def.hp * 0.6 * (1 - (d - KILL_RADIUS) / (HURT_RADIUS - KILL_RADIUS)), source);
    }
  }

  destroy() {
    this.sprite?.destroy();
    this.shadow?.destroy();
    this.done = true;
  }
}
