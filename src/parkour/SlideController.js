// SlideController — low-profile power slide: speed boost on entry (with cooldown so it
// can't be spammed), very low friction, accelerates downhill, steerable, collision height
// drops so you fit under slabs, slide-jump keeps (and slightly boosts) the momentum.
import { TUNING } from './MomentumController.js';

export const SLIDE = { minEnter: 6.5, boost: 6.5, maxBoosted: 34, cooldown: 0.8, decay: 0.45, linear: 2.5, steer: 1.6, exitSpeed: 4.5, height: 1.0 };

export class SlideController {
  constructor(pk, momentum) { this.pk = pk; this.m = momentum; this.cd = 0; }

  canStart() { const pk = this.pk; return pk.grounded && this.m.horizontalSpeed() > SLIDE.minEnter; }

  start() {
    const pk = this.pk, v = pk.vel;
    const sp = Math.hypot(v.x, v.z);
    if (this.cd <= 0) {
      const ns = Math.min(SLIDE.maxBoosted, Math.max(sp, sp + SLIDE.boost));
      v.x *= ns / sp; v.z *= ns / sp; this.cd = SLIDE.cooldown;
    }
    pk.state = 'slide'; pk.slideT = 0; pk.height = SLIDE.height;
  }

  update(dt, wish, held, world) {
    const pk = this.pk, v = pk.vel;
    pk.slideT += dt;
    let sp = Math.hypot(v.x, v.z);
    // natural deceleration on the flat, acceleration downhill
    const ns = Math.max(0, sp * Math.exp(-SLIDE.decay * dt) - SLIDE.linear * dt);
    if (sp > 1e-3) { v.x *= ns / sp; v.z *= ns / sp; }
    this.m.slope(dt, 1.4);
    this.m.steer(wish, SLIDE.steer, dt);
    sp = Math.hypot(v.x, v.z);
    // headroom: can't stand up under a low slab, keep sliding through
    const ceil = world.ceilingAt(pk.pos.x, pk.pos.z, pk.radius * 0.9, pk.pos.y);
    const blocked = ceil < pk.pos.y + 2.5;
    if (blocked && sp < 5) { const k = 5 / Math.max(sp, 0.1); v.x *= k; v.z *= k; }
    if (!blocked && (sp < SLIDE.exitSpeed || (!held && pk.slideT > 0.25))) return this.end();
    return true;
  }

  end() { this.pk.state = 'ground'; this.pk.height = 2.5; return false; }

  // Slide jump: keep horizontal momentum, add a little extra.
  jump() {
    const pk = this.pk; pk.vel.x *= 1.08; pk.vel.z *= 1.08; pk.vel.y = TUNING.jump * 0.95;
    pk.state = 'air'; pk.height = 2.5; pk.grounded = false;
  }

  tick(dt) { if (this.cd > 0) this.cd -= dt; }
}
