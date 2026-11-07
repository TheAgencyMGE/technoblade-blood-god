// MomentumController — Quake/Karlson-style velocity model: acceleration toward a wish
// direction that never removes speed you already have, gentle bleed of excess speed on
// the ground (so slides/dashes/wall-jumps carry over), slope acceleration on ramps,
// strong air control without a hard air speed cap.
import * as THREE from 'three';

export const TUNING = {
  walk: 10.5, sprint: 15.5, groundAccel: 120, airAccel: 38, airWish: 10,
  friction: 9, excessBleed: 9, excessBleedSprint: 4, turnRate: 7,
  gravity: 36, jump: 13.2, maxSpeed: 48,
};

const tmp = new THREE.Vector3();

export class MomentumController {
  constructor(pk) { this.pk = pk; }

  horizontalSpeed() { const v = this.pk.vel; return Math.hypot(v.x, v.z); }

  // Accelerate along wish only up to `max` — existing speed beyond it is preserved.
  accelerate(wish, max, accel, dt) {
    const v = this.pk.vel;
    const cur = v.x * wish.x + v.z * wish.z;
    const add = Math.max(0, Math.min(accel * dt, max - cur));
    v.x += wish.x * add; v.z += wish.z * add;
  }

  // Rotate horizontal velocity toward the wish direction (keeps magnitude) — carving turns.
  steer(wish, rate, dt) {
    const v = this.pk.vel; const sp = Math.hypot(v.x, v.z); if (sp < 0.5 || wish.lengthSq() < 0.01) return;
    const a = Math.atan2(v.x, v.z), b = Math.atan2(wish.x, wish.z);
    let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > Math.PI * 0.75) return; // pulling back = braking, not turning
    const na = a + Math.max(-rate * dt, Math.min(rate * dt, d));
    v.x = Math.sin(na) * sp; v.z = Math.cos(na) * sp;
  }

  ground(wish, sprint, dt, speedMult = 1) {
    const pk = this.pk, v = pk.vel;
    const max = (sprint ? TUNING.sprint : TUNING.walk) * speedMult;
    let sp = Math.hypot(v.x, v.z);
    if (wish.lengthSq() < 0.01) {
      const k = Math.max(0, 1 - TUNING.friction * dt); v.x *= k; v.z *= k;
    } else {
      if (sp > max) { // carry momentum: bleed only the excess, and slowly while sprinting
        const bleed = (sprint ? TUNING.excessBleedSprint : TUNING.excessBleed) * dt;
        const ns = Math.max(max, sp - bleed); v.x *= ns / sp; v.z *= ns / sp; sp = ns;
        this.steer(wish, TUNING.turnRate * 0.6, dt);
      } else {
        this.steer(wish, TUNING.turnRate, dt);
      }
      this.accelerate(wish, max, TUNING.groundAccel, dt);
    }
    this.slope(dt, 0.35);
  }

  air(wish, dt) {
    if (this.pk.steerLock > 0) this.pk.steerLock -= dt;
    if (wish.lengthSq() > 0.01) {
      this.accelerate(wish, TUNING.airWish, TUNING.airAccel, dt);
      // air strafing bends the path — but not right after a wall-jump kick
      if (!(this.pk.steerLock > 0)) this.steer(wish, 1.3, dt);
    }
    const k = Math.max(0, 1 - 0.08 * dt); this.pk.vel.x *= k; this.pk.vel.z *= k;
  }

  // Gravity component along a ramp surface.
  slope(dt, scale) {
    const pk = this.pk; const rp = pk.groundSurf;
    if (!rp || rp.axis === undefined) return;
    const len = rp.axis === 'x' ? rp.maxX - rp.minX : rp.maxZ - rp.minZ;
    const sin = (rp.y1 - rp.y0) / Math.hypot(len, rp.y1 - rp.y0);
    const downhill = (rp.lowAtMin ? -1 : 1);
    const a = TUNING.gravity * sin * scale * dt * downhill;
    if (rp.axis === 'x') pk.vel.x += a; else pk.vel.z += a;
  }

  clamp() {
    const v = this.pk.vel; const sp = Math.hypot(v.x, v.z);
    if (sp > TUNING.maxSpeed) { v.x *= TUNING.maxSpeed / sp; v.z *= TUNING.maxSpeed / sp; }
  }

  wishFromInput(input, yaw, out = tmp) {
    const m = input.moveVector();
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    out.set(fx * m.y + rx * m.x, 0, fz * m.y + rz * m.x);
    if (out.lengthSq() > 1e-4) out.normalize();
    return out;
  }
}
