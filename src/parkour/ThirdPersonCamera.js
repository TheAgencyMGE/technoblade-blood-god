// ThirdPersonCamera (Mode 2) — over-the-shoulder, movement-aware: pulls back and widens
// with speed, lowers for slides, rolls slightly on wall-runs, tight shoulder zoom when
// aiming, never clips through walls (raycast against the collision world).
import * as THREE from 'three';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export class ThirdPersonCamera {
  constructor(camera, world) {
    this.camera = camera; this.world = world;
    this.pivot = new THREE.Vector3(); this.dist = 6; this.fov = 70; this.roll = 0; this.shake = 0;
    this.colDist = 6; this.inited = false;
  }
  addShake(v) { this.shake = Math.min(1, this.shake + v); }
  snap() { this.inited = false; }

  update(dt, pk, look, speed, aiming) {
    const cam = this.camera;
    const h = pk.state === 'slide' ? 1.3 : 2.4;
    const target = new THREE.Vector3(pk.pos.x, pk.pos.y + h, pk.pos.z);
    if (!this.inited) { this.pivot.copy(target); this.inited = true; }
    this.pivot.x = damp(this.pivot.x, target.x, 18, dt);
    this.pivot.z = damp(this.pivot.z, target.z, 18, dt);
    this.pivot.y = damp(this.pivot.y, target.y, 10, dt);
    const wantDist = aiming ? 3.6 : 5.8 + Math.min(4, Math.max(0, speed - 10) * 0.16);
    this.dist = damp(this.dist, wantDist, 6, dt);
    const cp = Math.cos(look.pitch), sp = Math.sin(look.pitch);
    const back = new THREE.Vector3(Math.sin(look.yaw) * cp, -sp, Math.cos(look.yaw) * cp);
    const right = new THREE.Vector3(Math.cos(look.yaw), 0, -Math.sin(look.yaw));
    // over the shoulder on the OPEN side: if wall-running along a wall on the right, swap to the left shoulder
    const wantSide = pk.state === 'wallrun' && right.dot(pk.wall.normal) < -0.3 ? -1 : 1;
    this.sideSign = damp(this.sideSign ?? 1, wantSide, 6, dt);
    right.multiplyScalar(this.sideSign);
    const pivot = this.pivot.clone().addScaledVector(right, aiming ? 1.5 : 1.0);
    const side = this.world.raycast(this.pivot, right, (aiming ? 1.5 : 1.0) + 0.3);
    if (side < (aiming ? 1.8 : 1.3)) pivot.copy(this.pivot).addScaledVector(right, Math.max(0, side - 0.35));
    const hit = this.world.raycast(pivot, back, this.dist + 0.4);
    const allowed = Math.max(0.6, hit - 0.4);
    this.colDist = allowed < this.colDist ? allowed : damp(this.colDist, allowed, 5, dt);
    cam.position.copy(pivot).addScaledVector(back, Math.min(this.dist, this.colDist));
    if (cam.position.y < pk.pos.y + 0.3) cam.position.y = pk.pos.y + 0.3;
    if (cam.position.y < 0.3) cam.position.y = 0.3;
    cam.lookAt(pivot.clone().addScaledVector(back, -10));
    this.roll = damp(this.roll, pk.state === 'wallrun' ? -pk.wall.side * 0.08 : 0, 8, dt);
    cam.rotateZ(this.roll);
    if (this.shake > 0) { const s = this.shake * this.shake, t = performance.now() * 0.05; cam.rotateX(Math.sin(t * 1.3) * 0.03 * s); cam.rotateY(Math.sin(t * 1.9) * 0.03 * s); this.shake = Math.max(0, this.shake - dt * 2); }
    const want = aiming ? 50 : 66 + Math.min(18, Math.max(0, speed - 10) * 0.6);
    this.fov = damp(this.fov, want, 6, dt);
    cam.fov = this.fov; cam.updateProjectionMatrix();
  }
}
