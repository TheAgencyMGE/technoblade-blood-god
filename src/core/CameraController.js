// CameraController — over-the-shoulder orbit camera with spring smoothing, collision
// (never clips walls/ground), combat framing (pulls back when surrounded), lock-on
// framing, a tight bow-aim mode, cinematic finisher shots, trauma-based shake and FOV kicks.
import * as THREE from 'three';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const dampAngle = (a, b, k, dt) => { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * (1 - Math.exp(-k * dt)); };

export class CameraController {
  constructor(camera, world) {
    this.camera = camera; this.world = world;
    this.yaw = Math.PI; this.pitch = 0.32;
    this.dist = 7.5; this.curDist = 7.5;
    this.shoulder = 1.1; this.curShoulder = 1.1;
    this.pivotH = 2.7; this.curPivotH = 2.7;
    this.fov = 62; this.curFov = 62; this.fovKick = 0;
    this.pivot = new THREE.Vector3();
    this.trauma = 0; this.time = 0;
    this.mode = 'follow'; // follow | aim | cinematic | menu
    this.cine = null;
    this.lockTarget = null;
    this.aimBlend = 0;
    this.collisionDist = 7.5;
    this._tmp = new THREE.Vector3(); this._dir = new THREE.Vector3();
  }

  addTrauma(t) { this.trauma = Math.min(1, this.trauma + t * (this.shakeMult ?? 1)); }
  kickFov(v) { this.fovKick = Math.max(this.fovKick, v); }

  // Cinematic finisher: orbit a focus point from a side angle for `duration` seconds.
  startCinematic(focus, faceYaw, { duration = 1.4, side = 1, dist = 5, height = 1.8, orbit = 0.6 } = {}) {
    this.cine = { focus: focus.clone(), yaw: faceYaw + side * Math.PI * 0.55, dist, height, t: 0, duration, orbit: orbit * side };
    this.mode = 'cinematic';
  }
  endCinematic() { this.cine = null; this.mode = 'follow'; }

  forward(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  right(out) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }

  update(dt, target, { mouse, aiming, combat = 0, surrounded = 0, lock = null, inputActive = false } = {}) {
    this.time += dt;
    const cam = this.camera;
    if (mouse) {
      const k = aiming ? 0.0016 : 0.0024;
      this.yaw -= mouse.dx * k; this.pitch += mouse.dy * k;
      this.pitch = Math.max(-0.6, Math.min(1.15, this.pitch));
    }

    if (this.mode === 'cinematic' && this.cine) {
      const c = this.cine; c.t += dt;
      const yaw = c.yaw + c.orbit * (c.t / c.duration);
      const pos = this._tmp.set(c.focus.x + Math.sin(yaw) * c.dist, c.focus.y + c.height, c.focus.z + Math.cos(yaw) * c.dist);
      // keep cinematic camera inside the arena / out of walls
      const dir = this._dir.copy(pos).sub(c.focus); const len = dir.length(); dir.normalize();
      const hit = this.world.raycast(c.focus.clone().setY(c.focus.y + 1), dir, len);
      if (hit < len) pos.copy(c.focus).addScaledVector(dir, Math.max(1.5, hit - 0.4)).setY(c.focus.y + c.height);
      cam.position.lerp(pos, 1 - Math.exp(-10 * dt));
      cam.lookAt(c.focus.x, c.focus.y + 1.1, c.focus.z);
      this.curFov = damp(this.curFov, 50, 6, dt); cam.fov = this.curFov; cam.updateProjectionMatrix();
      this.applyShake(dt);
      if (c.t >= c.duration) this.endCinematic();
      return;
    }

    this.aimBlend = damp(this.aimBlend, aiming ? 1 : 0, 12, dt);
    // Combat framing: pull back and lift when many enemies close by.
    const baseDist = 7.2 + combat * 1.6 + surrounded * 2.6;
    this.dist = THREE.MathUtils.lerp(baseDist, 4.6, this.aimBlend);
    this.shoulder = THREE.MathUtils.lerp(1.0 - surrounded * 0.5, 1.75, this.aimBlend);
    this.pivotH = THREE.MathUtils.lerp(2.6 + surrounded * 0.5, 3.0, this.aimBlend);
    this.fov = THREE.MathUtils.lerp(62 + surrounded * 4, 48, this.aimBlend);

    // Lock-on: steer yaw so the target stays in frame beyond the player.
    if (lock && !aiming) {
      const dx = lock.x - target.x, dz = lock.z - target.z;
      const want = Math.atan2(-dx, -dz);
      this.yaw = dampAngle(this.yaw, want, 4, dt);
      const d = Math.hypot(dx, dz);
      this.pitch = damp(this.pitch, 0.32 + Math.min(0.25, d * 0.01), 3, dt);
    }

    this.curDist = damp(this.curDist, this.dist, 5, dt);
    this.curShoulder = damp(this.curShoulder, this.shoulder, 8, dt);
    this.curPivotH = damp(this.curPivotH, this.pivotH, 8, dt);
    this.pivot.x = damp(this.pivot.x, target.x, 14, dt);
    this.pivot.z = damp(this.pivot.z, target.z, 14, dt);
    this.pivot.y = damp(this.pivot.y, target.y + this.curPivotH, 9, dt);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const back = this._dir.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const pivot = this.pivot.clone().addScaledVector(right, this.curShoulder);
    // shoulder offset itself must not push the camera into a wall
    const sideHit = this.world.raycast(this.pivot, right, this.curShoulder + 0.3);
    if (sideHit < this.curShoulder + 0.3) pivot.copy(this.pivot).addScaledVector(right, Math.max(0, sideHit - 0.35));

    // Camera collision: ray from pivot back toward desired position.
    const want = this.curDist;
    const hit = this.world.raycast(pivot, back, want + 0.4);
    const allowed = Math.max(0.8, hit - 0.45);
    // snap in instantly, ease back out
    this.collisionDist = allowed < this.collisionDist ? allowed : damp(this.collisionDist, allowed, 4, dt);
    const d = Math.min(want, this.collisionDist);
    cam.position.copy(pivot).addScaledVector(back, d);
    if (cam.position.y < 0.4) cam.position.y = 0.4;
    const look = pivot.clone().addScaledVector(back, -10);
    cam.lookAt(look);

    this.fovKick = damp(this.fovKick, 0, 6, dt);
    this.curFov = damp(this.curFov, this.fov + this.fovKick, 8, dt);
    cam.fov = this.curFov; cam.updateProjectionMatrix();
    this.applyShake(dt);
  }

  applyShake(dt) {
    if (this.trauma <= 0) return;
    const s = this.trauma * this.trauma;
    const t = this.time * 38;
    const cam = this.camera;
    cam.rotateX((Math.sin(t * 1.1) * 0.5 + Math.sin(t * 2.3) * 0.5) * 0.035 * s);
    cam.rotateY((Math.sin(t * 1.7 + 3) * 0.5 + Math.sin(t * 3.1) * 0.5) * 0.035 * s);
    cam.rotateZ(Math.sin(t * 1.3 + 7) * 0.03 * s);
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
  }

  // Slow, sweeping orbit used behind the main menu.
  updateMenu(dt, focus) {
    this.time += dt;
    // Sweep slowly in front of the hero, keeping him on the right third of the frame.
    const a = Math.sin(this.time * 0.09) * 0.55 + 0.25;
    const cam = this.camera;
    const r = 6.4;
    cam.position.set(focus.x + Math.sin(a) * r, focus.y + 1.7 + Math.sin(this.time * 0.2) * 0.15, focus.z + Math.cos(a) * r);
    const rx = Math.cos(a), rz = -Math.sin(a); // camera right vector
    cam.lookAt(focus.x - rx * 2.0, focus.y + 1.75, focus.z - rz * 2.0);
    cam.fov = 42; cam.updateProjectionMatrix();
  }
}
