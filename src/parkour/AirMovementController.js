// AirMovementController — double jump, directional air/ground dash (2 charges), and the
// ground slam (launch up first if grounded, then drive down; impact strength scales with
// fall height).
import * as THREE from 'three';
import { TUNING } from './MomentumController.js';

export const AIR = { doubleJump: 12.6, dashSpeed: 34, dashTime: 0.17, dashExit: 21, dashCharges: 2, dashRecharge: 1.1, slamDown: -52, slamLaunch: 15, slamCd: 1.2 };

export class AirMovementController {
  constructor(pk) { this.pk = pk; this.rechargeT = 0; this.slamCd = 0; }

  tick(dt) {
    const pk = this.pk;
    if (this.slamCd > 0) this.slamCd -= dt;
    if (pk.dashCd > 0) pk.dashCd -= dt;
    if (pk.dashCharges < AIR.dashCharges && (pk.grounded || pk.state === 'wallrun')) {
      this.rechargeT += dt;
      if (this.rechargeT >= AIR.dashRecharge) { this.rechargeT = 0; pk.dashCharges++; }
    }
  }

  doubleJump(wish) {
    const pk = this.pk; if (pk.jumpsLeft <= 0) return false;
    pk.jumpsLeft--;
    pk.vel.y = AIR.doubleJump;
    // redirect part of the momentum toward input (air control burst)
    if (wish.lengthSq() > 0.01) {
      const sp = Math.hypot(pk.vel.x, pk.vel.z);
      const nx = pk.vel.x * 0.5 + wish.x * sp * 0.5, nz = pk.vel.z * 0.5 + wish.z * sp * 0.5;
      const l = Math.hypot(nx, nz) || 1; pk.vel.x = nx / l * sp; pk.vel.z = nz / l * sp;
    }
    return true;
  }

  dash(dir) {
    const pk = this.pk; if (pk.dashCharges <= 0 || pk.dashCd > 0) return false;
    pk.dashCharges--; pk.dashCd = 0.25;
    pk.dashDir = dir.clone().setY(0).normalize();
    pk.preDashSpeed = Math.hypot(pk.vel.x, pk.vel.z);
    pk.dashT = AIR.dashTime; pk.prevState = pk.state === 'slide' ? 'ground' : pk.state === 'wallrun' ? 'air' : pk.state;
    pk.state = 'dash'; pk.height = 2.5;
    pk.iframes = Math.max(pk.iframes, AIR.dashTime + 0.08);
    return true;
  }

  updateDash(dt) {
    const pk = this.pk;
    pk.dashT -= dt;
    pk.vel.x = pk.dashDir.x * AIR.dashSpeed; pk.vel.z = pk.dashDir.z * AIR.dashSpeed; pk.vel.y = 0;
    if (pk.dashT <= 0) {
      const exit = Math.max(AIR.dashExit, pk.preDashSpeed);
      pk.vel.x = pk.dashDir.x * exit; pk.vel.z = pk.dashDir.z * exit;
      pk.state = pk.grounded ? 'ground' : 'air';
      pk.lastDashEnd = pk.time;
    }
  }

  // Q: if grounded, launch up first; then slam down.
  startSlam() {
    const pk = this.pk; if (this.slamCd > 0) return false;
    this.slamCd = AIR.slamCd;
    pk.slamStartY = pk.pos.y;
    if (pk.grounded) { pk.vel.y = AIR.slamLaunch; pk.grounded = false; pk.state = 'slamRise'; pk.slamT = 0; }
    else { this.beginDrop(); }
    pk.height = 2.5;
    return true;
  }
  beginDrop() {
    const pk = this.pk;
    pk.state = 'slam'; pk.slamPeakY = pk.pos.y;
    pk.vel.x *= 0.25; pk.vel.z *= 0.25; pk.vel.y = AIR.slamDown;
  }
  updateRise(dt) {
    const pk = this.pk; pk.slamT += dt;
    if (pk.vel.y <= 2 || pk.slamT > 0.42) this.beginDrop();
  }
  // Strength of the shockwave on landing.
  impact() { const pk = this.pk; const h = Math.max(0, (pk.slamPeakY ?? pk.pos.y) - pk.pos.y); return { radius: 4.5 + Math.min(5, h * 0.75), power: 1 + Math.min(1.5, h * 0.18) }; }

  static jumpVelocity() { return TUNING.jump; }
}
void THREE;
