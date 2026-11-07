// FirstPersonCamera — eye at the head (drops when sliding), speed-scaled FOV, run bob,
// landing dip spring, wall-run roll away from the wall, dash FOV kick, slam shake.
import * as THREE from 'three';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export class FirstPersonCamera {
  constructor(camera) {
    this.camera = camera;
    this.eye = 2.25; this.fov = 80; this.roll = 0; this.bobT = 0;
    this.dip = 0; this.dipV = 0; this.kick = 0; this.shake = 0; this.punch = new THREE.Vector2();
    this.base = new THREE.Vector3();
  }

  land(impact) { this.dipV -= Math.min(10, impact * 0.28); }
  dash() { this.kick = Math.max(this.kick, 12); }
  slam(power) { this.shake = Math.min(1, this.shake + 0.5 * power); this.dipV -= 8 * power; }
  hitPunch(x, y) { this.punch.x += x; this.punch.y += y; }
  addShake(v) { this.shake = Math.min(1, this.shake + v); }

  update(dt, pk, look, speed, aiming) {
    const cam = this.camera;
    const targetEye = pk.state === 'slide' ? 1.05 : 2.25;
    this.eye = damp(this.eye, targetEye, 14, dt);
    // landing dip spring
    this.dipV += (-this.dip * 120 - this.dipV * 14) * dt; this.dip += this.dipV * dt;
    // run bob
    let bobY = 0, bobX = 0;
    if (pk.grounded && pk.state === 'ground' && speed > 1) {
      this.bobT += dt * (6 + speed * 0.55);
      const amp = Math.min(0.09, speed * 0.005);
      bobY = Math.abs(Math.sin(this.bobT)) * amp; bobX = Math.cos(this.bobT) * amp * 0.6;
    }
    const fx = Math.cos(look.yaw), fz = -Math.sin(look.yaw);
    this.base.set(pk.pos.x + fx * bobX, pk.pos.y + this.eye + bobY + this.dip, pk.pos.z + fz * bobX);
    cam.position.copy(this.base);
    // roll: lean away from the wall while wall-running, slight strafe roll otherwise
    const wantRoll = pk.state === 'wallrun' ? -pk.wall.side * 0.2 : (pk.state === 'slide' ? 0.06 : 0); // head tilts away from the wall
    this.roll = damp(this.roll, wantRoll, 9, dt);
    this.punch.multiplyScalar(Math.max(0, 1 - 14 * dt));
    let sx = 0, sy = 0;
    if (this.shake > 0) { const s = this.shake * this.shake; const t = performance.now() * 0.05; sx = Math.sin(t * 1.7) * 0.03 * s; sy = Math.sin(t * 2.3 + 1) * 0.03 * s; this.shake = Math.max(0, this.shake - dt * 2); }
    cam.rotation.order = 'YXZ';
    cam.rotation.set(look.pitch + this.punch.y + sy, look.yaw + this.punch.x + sx, this.roll);
    // FOV: faster = wider
    const want = aiming ? 52 : 80 + Math.min(22, Math.max(0, speed - 10) * 0.75);
    this.kick = damp(this.kick, 0, 7, dt);
    this.fov = damp(this.fov, want + this.kick, aiming ? 14 : 6, dt);
    cam.fov = this.fov; cam.updateProjectionMatrix();
  }
}
