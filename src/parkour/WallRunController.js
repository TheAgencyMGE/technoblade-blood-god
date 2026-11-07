// WallRunController — physics wall-running: probes for a vertical surface beside the
// player while airborne, attaches when moving fast enough roughly parallel to it, runs
// along the wall tangent with reduced gravity (momentum preserved), follows wall ends,
// supports both sides, and wall-jumps off with an outward + upward kick. A short per-wall
// cooldown lets you chain between facing walls (chimneys) but not re-grab the same one.
import * as THREE from 'three';

export const WALL = { minSpeed: 7, runSpeed: 14, gravity: 6.5, maxFall: -4.5, maxTime: 1.9, reach: 0.65, kickOut: 10.5, kickUp: 12.5 };

export class WallRunController {
  constructor(pk) { this.pk = pk; this.cooldownBox = null; this.cooldownT = 0; }

  tick(dt) { if (this.cooldownT > 0) { this.cooldownT -= dt; if (this.cooldownT <= 0) this.cooldownBox = null; } }

  // Try to start a wall run (called while airborne).
  tryAttach(world, wish) {
    const pk = this.pk, v = pk.vel;
    const sp = Math.hypot(v.x, v.z);
    if (sp < WALL.minSpeed || pk.pos.y < pk.groundY + 0.5) return false;
    const hit = world.wallProbe(pk.pos, pk.radius, pk.pos.y, 2.5, WALL.reach);
    if (!hit || hit.box === this.cooldownBox) return false;
    const n = hit.normal;
    const dir = new THREE.Vector3(v.x / sp, 0, v.z / sp);
    if (Math.abs(dir.dot(n)) > 0.82) return false;                      // running straight into it
    if (wish.lengthSq() > 0.01 && wish.dot(n) > 0.6) return false;      // steering away from it
    const t = new THREE.Vector3(-n.z, 0, n.x); if (t.dot(dir) < 0) t.negate();
    const speed = Math.max(sp, WALL.runSpeed);
    v.x = t.x * speed; v.z = t.z * speed; v.y = Math.max(v.y * 0.35, 1.8);
    pk.state = 'wallrun';
    pk.wall = { normal: n.clone(), tangent: t, box: hit.box, t: 0, side: Math.sign(t.x * n.z - t.z * n.x) || 1 };
    pk.jumpsLeft = 1; pk.dashCharges = Math.max(pk.dashCharges, 1);
    return true;
  }

  update(dt, world, wish) {
    const pk = this.pk, v = pk.vel, w = pk.wall;
    w.t += dt;
    v.y = Math.max(WALL.maxFall, v.y - WALL.gravity * dt);
    const hit = world.wallProbe(pk.pos, pk.radius, pk.pos.y, 2.5, WALL.reach + 0.3);
    if (!hit || Math.abs(hit.normal.dot(w.normal)) < 0.7) return this.detach(false);
    w.normal.copy(hit.normal); w.box = hit.box;
    const t = new THREE.Vector3(-w.normal.z, 0, w.normal.x); if (t.dot(w.tangent) < 0) t.negate(); w.tangent.copy(t);
    let sp = Math.hypot(v.x, v.z);
    const fwd = wish.lengthSq() > 0.01 ? wish.dot(t) : 0;
    if (fwd > 0.2) sp = Math.max(sp, WALL.runSpeed); else if (fwd < -0.2) sp = Math.max(0, sp - 18 * dt); else sp = Math.max(0, sp - 3 * dt);
    v.x = t.x * sp; v.z = t.z * sp;
    const gap = hit.dist - pk.radius - 0.05;
    if (gap > 0.02) { pk.pos.x -= w.normal.x * Math.min(gap, 6 * dt); pk.pos.z -= w.normal.z * Math.min(gap, 6 * dt); }
    if (w.t > WALL.maxTime || sp < 4 || (wish.lengthSq() > 0.01 && wish.dot(w.normal) > 0.75)) return this.detach(false);
    return true;
  }

  detach(fromJump) {
    const pk = this.pk;
    this.cooldownBox = pk.wall?.box ?? null; this.cooldownT = fromJump ? 0.35 : 0.6;
    if (!fromJump && pk.wall) { pk.vel.x += pk.wall.normal.x * 1.5; pk.vel.z += pk.wall.normal.z * 1.5; }
    pk.state = 'air';
    return false;
  }

  wallJump(wish) {
    const pk = this.pk, w = pk.wall, v = pk.vel;
    const sp = Math.max(Math.hypot(v.x, v.z), 12);
    const along = wish.lengthSq() > 0.01 ? Math.max(0.35, wish.dot(w.tangent)) : 0.85;
    v.x = w.tangent.x * sp * along + w.normal.x * WALL.kickOut;
    v.z = w.tangent.z * sp * along + w.normal.z * WALL.kickOut;
    v.y = WALL.kickUp;
    this.detach(true);
    pk.jumpsLeft = 1;
    pk.steerLock = 0.45;
  }

  touchJump(world) {
    const pk = this.pk;
    const hit = world.wallProbe(pk.pos, pk.radius, pk.pos.y, 2.5, 0.4);
    if (!hit || hit.box === this.cooldownBox) return false;
    pk.wall = { normal: hit.normal.clone(), tangent: new THREE.Vector3(-hit.normal.z, 0, hit.normal.x), box: hit.box, t: 0, side: 1 };
    if (pk.wall.tangent.dot(pk.vel) < 0) pk.wall.tangent.negate();
    this.wallJump(new THREE.Vector3());
    return true;
  }
}
