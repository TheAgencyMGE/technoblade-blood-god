// MovementAttackController — attacks that come out of movement states. Each picks an
// existing KayKit clip, a hit volume and its own momentum behaviour.
import * as THREE from 'three';

// imp = fraction of the clip where the blade connects (overridden by measured impacts)
export const PK_ATTACKS = {
  combo1: { anim: '2H_Melee_Attack_Slice', ts: 2.0, dmg: 13, reach: 3.4, arc: 120, vert: 2.2, kb: 1.1, name: null },
  combo2: { anim: '1H_Melee_Attack_Slice_Diagonal', ts: 2.1, dmg: 13, reach: 3.4, arc: 120, vert: 2.2, kb: 1.1, name: null },
  combo3: { anim: '2H_Melee_Attack_Spin', ts: 1.9, dmg: 20, reach: 3.6, arc: 360, vert: 2.4, kb: 7, name: null, heavy: true },
  running: { anim: '1H_Melee_Attack_Slice_Horizontal', ts: 1.9, dmg: 22, reach: 3.8, arc: 150, vert: 2.2, kb: 9, name: 'RUNNING SLASH', heavy: true },
  slide: { anim: '2H_Melee_Attack_Slice', ts: 2.2, dmg: 16, reach: 3.4, arc: 170, vert: 1.6, low: true, kb: 3, launch: 10, name: 'SLIDE SLASH' },
  aerial: { anim: '1H_Melee_Attack_Slice_Diagonal', ts: 2.2, dmg: 15, reach: 3.6, arc: 170, vert: 4.5, kb: 4, juggle: true, name: null },
  wallrun: { anim: '2H_Melee_Attack_Stab', ts: 1.8, dmg: 28, reach: 3.6, arc: 120, vert: 3, kb: 9, name: 'WALL-RUN STRIKE', heavy: true },
  dash: { anim: '2H_Melee_Attack_Stab', ts: 2.4, dmg: 26, reach: 2.6, arc: 360, vert: 2.4, kb: 8, name: 'DASH STRIKE', heavy: true, pierce: true },
  dive: { anim: '1H_Melee_Attack_Jump_Chop', ts: 1.6, dmg: 34, reach: 4.2, arc: 360, vert: 3, kb: 10, name: 'DIVE ATTACK', heavy: true },
};

export class MovementAttackController {
  constructor(combat) { this.c = combat; this.special = null; }
  get pk() { return this.c.pk; }
  get game() { return this.c.game; }

  // Pick the attack for the current movement state.
  choose(look) {
    const pk = this.pk, sp = this.c.mode.mover.speed;
    if (pk.state === 'slide') return 'slide';
    if (pk.state === 'wallrun') return 'wallrun';
    if (pk.state === 'dash' || pk.time - pk.lastDashEnd < 0.25) return 'dash';
    if (!pk.grounded && look.pitch < -0.55 && pk.pos.y - pk.groundY > 1.2) return 'dive';
    if (!pk.grounded) return 'aerial';
    if (sp > 13) return 'running';
    return null; // standing combo
  }

  // Behaviours that change movement when the attack starts.
  begin(kind, look) {
    const pk = this.pk, g = this.game;
    if (kind === 'wallrun') {
      // launch off the wall toward the best target in view
      const t = this.c.findTarget(look, 16, 0.55);
      const to = t ? t.chestPos(new THREE.Vector3()).sub(pk.pos).setY(0).normalize() : new THREE.Vector3(-Math.sin(look.yaw), 0, -Math.cos(look.yaw));
      this.c.mode.mover.wallrun.detach(true);
      pk.vel.set(to.x * 28, 5, to.z * 28); pk.state = 'air';
      this.special = { kind, t: 0, target: t };
    } else if (kind === 'dive') {
      const dir = this.c.lookDir(look);
      pk.vel.set(dir.x * 26, Math.min(-30, dir.y * 40), dir.z * 26);
      this.special = { kind, t: 0 };
    } else if (kind === 'dash') {
      // extend the dash and turn it into a piercing strike along the path
      if (pk.state === 'dash') pk.dashT = Math.max(pk.dashT, 0.14);
      else { const d = new THREE.Vector3(-Math.sin(look.yaw), 0, -Math.cos(look.yaw)); pk.vel.x = d.x * 30; pk.vel.z = d.z * 30; }
      this.special = { kind, t: 0, hit: new Set() };
      pk.iframes = Math.max(pk.iframes, 0.25);
    } else if (kind === 'running') {
      const sp = this.c.mode.mover.speed; const f = new THREE.Vector3(pk.vel.x, 0, pk.vel.z).normalize();
      pk.vel.x = f.x * (sp + 3); pk.vel.z = f.z * (sp + 3); // lunge keeps momentum
    }
    void g;
  }

  // Per-frame for attacks with travel (wall-run launch, dive, dash strike).
  update(dt) {
    const s = this.special; if (!s) return;
    const pk = this.pk; s.t += dt;
    if (s.kind === 'dash') {
      for (const e of this.game.enemies.list) {
        if (!e.hittable || s.hit.has(e)) continue;
        if (e.position.distanceTo(pk.pos) - e.radius < 2.4 && Math.abs(e.position.y - pk.pos.y) < 2.5) { s.hit.add(e); this.c.hit(e, PK_ATTACKS.dash, null); }
      }
      if (s.t > 0.3) this.special = null;
    } else if (s.kind === 'wallrun') {
      if (s.target && s.target.alive && s.target.position.distanceTo(pk.pos) < s.target.radius + 2.2) { this.c.strikeNow(); this.special = null; }
      if (s.t > 0.55 || pk.grounded) this.special = null;
    } else if (s.kind === 'dive') {
      if (pk.grounded || s.t > 1.2) { this.c.shockwave(pk.pos, 4.5, 1.2, 'dive'); this.special = null; }
    }
  }
}
