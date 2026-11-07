// Enemy projectiles — mage/demon fireballs (particle-rendered using the Kenney flame/flare
// textures) and crossbow bolts (KayKit Skeleton_Arrow mesh). Swept collision against the
// player capsule and the world; the player can counter to deflect them back at enemies.
import * as THREE from 'three';

export class Projectiles {
  constructor(game) { this.game = game; this.list = []; this.boltPool = []; }

  reset() { for (const p of this.list) if (p.mesh) { p.mesh.visible = false; this.boltPool.push(p.mesh); } this.list.length = 0; }

  spawn(type, owner, spread, dmg) {
    const g = this.game, p = g.player;
    const start = owner.chestPos(new THREE.Vector3()).add(owner.facing(new THREE.Vector3()).multiplyScalar(owner.radius + 0.4));
    start.y = Math.max(start.y, owner.position.y + owner.height * 0.55);
    const speed = type === 'bolt' ? 30 : 15;
    // lead the target slightly
    const target = p.position.clone().setY(p.position.y + 1.3);
    const t = start.distanceTo(target) / speed;
    target.addScaledVector(p.velocity, t * 0.5);
    const dir = target.sub(start).normalize();
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
    const pr = { type, pos: start, vel: dir.multiplyScalar(speed), dmg, owner, life: 5, reflected: false };
    if (type === 'bolt') {
      let m = this.boltPool.pop();
      if (!m) { m = g.assets.makeArrowMesh(); m.scale.multiplyScalar(0.8); g.scene.add(m); }
      m.visible = true; pr.mesh = m;
      g.audio.play('bowRelease', { vol: 0.5, rate: 1.3 });
    } else g.audio.play('fire', { vol: 0.5, rate: 1.1 });
    this.list.push(pr);
  }

  incoming(player, range) {
    return this.list.filter(pr => !pr.reflected && pr.pos.distanceTo(player.position.clone().setY(1.3)) < range &&
      pr.vel.clone().normalize().dot(player.position.clone().setY(1.3).sub(pr.pos).normalize()) > 0.3);
  }

  reflect(pr) {
    pr.reflected = true; pr.life = 4;
    const tgt = pr.owner && pr.owner.alive ? pr.owner : this.game.enemies.nearestVisible(this.game.player.position, 30);
    pr.homing = tgt;
    const sp = pr.vel.length() * 1.6;
    const aim = tgt ? tgt.chestPos(new THREE.Vector3()) : pr.pos.clone().sub(pr.vel);
    pr.vel.copy(aim.sub(pr.pos).normalize().multiplyScalar(sp));
    pr.dmg *= 3;
    this.game.vfx.hitSparks(pr.pos, pr.vel.clone().normalize(), { heavy: true, color: [1, 0.8, 0.3], blood: false });
  }

  update(dt) {
    const g = this.game, p = g.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const pr = this.list[i];
      pr.life -= dt;
      if (pr.homing && pr.homing.alive) {
        const want = pr.homing.chestPos(new THREE.Vector3()).sub(pr.pos).normalize().multiplyScalar(pr.vel.length());
        pr.vel.lerp(want, Math.min(1, dt * 6));
      }
      const prev = pr.pos.clone();
      const step = pr.vel.clone().multiplyScalar(dt); const len = step.length(); const dir = step.clone().normalize();
      let done = false;
      const wd = g.world.raycast(prev, dir, len);
      if (!pr.reflected) {
        // player capsule (segment-vs-segment closest approach)
        const a = new THREE.Vector3(p.position.x, p.position.y + 0.4, p.position.z), b = new THREE.Vector3(p.position.x, p.position.y + 2.3, p.position.z);
        const d = segSegDist(prev, prev.clone().add(step), a, b);
        if (d < 0.75 && wd >= len * segParamGuess(prev, step, p.position)) {
          if (p.takeHit(pr.dmg, prev, { heavy: false, knock: 3 })) { this.explode(pr); done = true; }
        }
      } else {
        const eh = g.enemies.raycast(prev, dir, Math.min(len, wd));
        if (eh) {
          const res = eh.enemy.receiveHit({ dmg: pr.dmg, dir: dir.clone().setY(0).normalize(), kb: 5, heavy: true, stagger: 3, guardBreak: true, source: 'reflect' });
          if (res.hit) { g.ui.damageNumber(pr.pos, Math.round(res.dealt), true); g.combat.addCombo(1); g.addScore(Math.round(pr.dmg * 3)); if (res.killed) g.onKill(eh.enemy, {}); }
          this.explode(pr); done = true;
        }
      }
      if (!done && wd < len) { this.explode(pr); done = true; }
      if (done || pr.life <= 0) { this.remove(i); continue; }
      pr.pos.add(step);
      if (pr.mesh) { pr.mesh.position.copy(pr.pos); pr.mesh.lookAt(pr.pos.clone().add(pr.vel)); }
      else {
        const col = pr.reflected ? [1, 0.85, 0.3] : [1, 0.35, 0.1];
        g.vfx.sys.fire.emit(pr.pos, { count: 2, speed: 0.6, life: 0.3, size: 1.6, sizeEnd: 0.2, color: col, radius: 0.1 });
        g.vfx.sys.flare.emit(pr.pos, { count: 1, speed: 0, life: 0.06, size: 2.6, sizeEnd: 2, color: col, spin: 0 });
      }
    }
  }

  explode(pr) {
    const g = this.game;
    if (pr.type === 'bolt') { g.audio.play('arrowHit', { vol: 0.5 }); g.vfx.sys.spark.emit(pr.pos, { count: 8, speed: 4, life: 0.25, size: 0.5, color: [1, 0.8, 0.5], gravity: 8 }); }
    else { g.audio.play('fire', { vol: 0.6, rate: 0.8 }); g.vfx.sys.fire.emit(pr.pos, { count: 18, speed: 5, life: 0.45, size: 1.8, color: [1, 0.4, 0.1], drag: 3 }); g.vfx.sys.smoke.emit(pr.pos, { count: 5, speed: 1.5, life: 0.9, size: 2.5, color: [0.2, 0.15, 0.12], alpha: 0.5 }); }
  }

  remove(i) { const pr = this.list[i]; if (pr.mesh) { pr.mesh.visible = false; this.boltPool.push(pr.mesh); } this.list.splice(i, 1); }
}

function segParamGuess() { return 0; }

// closest distance between segments p1-q1 and p2-q2
function segSegDist(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) return p1.distanceTo(p2);
  if (a <= 1e-9) { s = 0; t = THREE.MathUtils.clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e <= 1e-9) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
    else {
      const b = d1.dot(d2), denom = a * e - b * b;
      s = denom !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s), c2 = p2.clone().addScaledVector(d2, t);
  return c1.distanceTo(c2);
}
