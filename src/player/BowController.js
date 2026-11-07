// BowController — hold RMB to aim (tight camera), hold LMB to draw, release to fire.
// Arrows are physical projectiles (gravity, travel time) tested with swept segments
// against head spheres, weak points, body capsules and the world, so they never tunnel.
// Arrows stick where they land and can be recovered; kills drop arrows; slow regen.
import * as THREE from 'three';

const GRAV = 14;
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

export class BowController {
  constructor(game) {
    this.game = game;
    this.maxAmmo = 20; this.ammo = 20;
    this.aiming = false; this.drawing = false; this.draw = 0;
    this.arrows = []; // in flight
    this.stuck = [];  // in world, recoverable
    this.pool = [];
    this.regen = 0;
    this.cooldown = 0;
    this.precisionNext = false;
    this.aimPoint = new THREE.Vector3();
  }

  reset() {
    this.ammo = this.maxAmmo; this.cancel();
    for (const a of [...this.arrows, ...this.stuck]) this.release(a);
    this.arrows.length = 0; this.stuck.length = 0;
  }

  getMesh() {
    let m = this.pool.pop();
    if (!m) { m = this.game.assets.makeArrowMesh(); this.game.scene.add(m); }
    m.visible = true;
    return m;
  }
  release(a) { a.mesh.visible = false; if (a.mesh.parent !== this.game.scene) this.game.scene.attach(a.mesh); this.pool.push(a.mesh); }

  cancel() {
    if (this.aiming) { this.aiming = false; this.game.weapon?.showBow(false); this.game.ui?.crosshair(false); }
    this.drawing = false; this.draw = 0;
  }

  canAim() { const p = this.game.player; return p.alive && p.is('idle', 'move') && p.grounded && !this.game.combat.seq; }

  update(dt) {
    const g = this.game, input = g.input, p = g.player;
    if (this.cooldown > 0) this.cooldown -= dt;
    // passive regen so the player is never fully dry
    if (this.ammo < 6) { this.regen += dt; if (this.regen > 3.5) { this.regen = 0; this.ammo++; } } else this.regen = 0;

    // Mode 2 aims/fires through ParkourCombatController; here we only fly arrows + pickups.
    const wantAim = g.mode !== 'parkour' && input.mouse.right && this.canAim();
    if (wantAim && !this.aiming) {
      this.aiming = true; g.weapon.showBow(true); g.ui.crosshair(true);
      g.audio.play('bowDraw', { vol: 0.25, rate: 1.4 });
      input.take('attack');
    } else if (!wantAim && this.aiming) this.cancel();

    if (this.aiming) {
      this.computeAimPoint();
      if (input.mouse.left && this.ammo > 0 && this.cooldown <= 0) {
        if (!this.drawing) { this.drawing = true; this.draw = 0; g.audio.play('bowDraw', { vol: 0.6 }); p.anim.play('Blocking', { fade: 0.08 }); }
        this.draw = Math.min(1, this.draw + dt / 0.55);
      } else if (input.mouse.left && this.ammo <= 0 && input.leftPressed) { g.ui.flash('NO ARROWS', 'grey'); g.audio.play('uiError', { vol: 0.4 }); }
      if (this.drawing && !input.mouse.left) { this.fire(this.draw); this.drawing = false; this.draw = 0; }
      g.ui.drawMeter(this.drawing ? this.draw : 0);
    }

    this.updateArrows(dt);
    // recover stuck arrows by walking over them
    for (let i = this.stuck.length - 1; i >= 0; i--) {
      const a = this.stuck[i]; a.life -= dt;
      const d = Math.hypot(a.mesh.position.x - p.position.x, a.mesh.position.z - p.position.z) + Math.max(0, Math.abs(a.mesh.position.y - p.position.y) - 1.5);
      const pickable = a.mesh.parent === g.scene;
      if (pickable && d < 1.6 && this.ammo < this.maxAmmo) { this.ammo++; g.audio.play('pickup', { vol: 0.35, rate: 1.4 }); this.release(a); this.stuck.splice(i, 1); continue; }
      if (a.life <= 0) { this.release(a); this.stuck.splice(i, 1); }
    }
  }

  computeAimPoint() {
    const cam = this.game.camera;
    const dir = cam.getWorldDirection(tmp);
    const dist = this.game.world.raycast(cam.position, dir, 120);
    let best = Math.min(dist, 120);
    // aim assists nothing; but report what's under the crosshair for the hit marker colour
    this.aimPoint.copy(cam.position).addScaledVector(dir, best);
    return this.aimPoint;
  }

  fire(draw, { precision = false, target = null } = {}) {
    const g = this.game, p = g.player;
    if (this.ammo <= 0) return;
    this.ammo--; this.cooldown = 0.18;
    precision = precision || this.precisionNext; this.precisionNext = false;
    const start = new THREE.Vector3();
    g.player.hero.handL.getWorldPosition(start);
    start.y = Math.max(start.y, 1.6);
    let aim;
    if (target) aim = target.headPos().clone();
    else aim = this.computeAimPoint().clone();
    const dir = aim.sub(start).normalize();
    const speed = precision ? 95 : 32 + 48 * draw;
    const a = {
      mesh: this.getMesh(), pos: start.clone(), vel: dir.multiplyScalar(speed), life: 4,
      dmg: (precision ? 60 : 9 + 26 * draw) * (g.abilities.bloodGod ? 1.6 : 1), draw, precision, pierce: precision ? 6 : 0, hitSet: new Set(),
    };
    a.mesh.position.copy(a.pos);
    a.mesh.scale.setScalar(precision ? 1.3 : 1);
    this.arrows.push(a);
    g.audio.play('bowRelease', { vol: 0.8, rate: precision ? 0.8 : 1 });
    p.anim.play('Blocking', { fade: 0.04, once: true, restart: true, timeScale: 1.6 });
    g.cam.addTrauma(precision ? 0.25 : 0.08);
    g.cam.kickFov(precision ? -4 : -1.5);
    if (precision) g.vfx.sys.light.emit(start, { count: 3, speed: 0.5, life: 0.25, size: 3, color: [1, 0.3, 0.2] });
  }

  // Mode 2: fire from an explicit origin/direction (camera eye in first-person).
  fireFrom(origin, dir, draw) {
    const g = this.game;
    if (this.ammo <= 0 || this.cooldown > 0) return false;
    this.ammo--; this.cooldown = 0.14;
    const a = {
      mesh: this.getMesh(), pos: origin.clone(), vel: dir.clone().normalize().multiplyScalar(40 + 50 * draw), life: 4,
      dmg: (10 + 26 * draw) * (g.abilities.bloodGod ? 1.6 : 1), draw, precision: false, pierce: 0, hitSet: new Set(),
    };
    a.mesh.position.copy(a.pos); a.mesh.scale.setScalar(1);
    a.mesh.lookAt(a.pos.clone().add(a.vel));
    this.arrows.push(a);
    g.audio.play('bowRelease', { vol: 0.8 });
    return true;
  }

  updateArrows(dt) {
    const g = this.game;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.life -= dt;
      const prev = tmp2.copy(a.pos);
      if (!a.precision) a.vel.y -= GRAV * dt;
      const step = a.vel.clone().multiplyScalar(dt);
      const len = step.length(); const dir = step.clone().divideScalar(len || 1);
      // world hit along the swept segment
      const wd = g.world.raycast(prev, dir, len);
      // enemy hit along the swept segment (nearest first)
      const eh = g.enemies.raycast(prev, dir, Math.min(len, wd), a.hitSet);
      if (a.precision) g.vfx.sys.spark.emit(a.pos, { count: 2, speed: 0.4, life: 0.3, size: 0.6, color: [1, 0.3, 0.15], sizeEnd: 0 });
      else if (Math.random() < 0.5) g.vfx.sys.spark.emit(a.pos, { count: 1, speed: 0.2, life: 0.18, size: 0.3, color: [1, 0.85, 0.6], sizeEnd: 0 });
      if (eh) {
        a.pos.copy(prev).addScaledVector(dir, eh.dist);
        this.hitEnemy(a, eh);
        if (a.pierce > 0) { a.pierce--; a.hitSet.add(eh.enemy); a.pos.addScaledVector(dir, 0.3); }
        else { this.stickToEnemy(a, eh.enemy); this.arrows.splice(i, 1); continue; }
      } else if (wd < len) {
        a.pos.copy(prev).addScaledVector(dir, Math.max(0, wd - 0.25));
        a.mesh.position.copy(a.pos); a.mesh.lookAt(a.pos.clone().add(dir));
        g.audio.play('arrowHit', { vol: 0.5 });
        g.vfx.sys.dirt.emit(a.pos, { count: 6, speed: 3, life: 0.4, size: 0.5, color: [0.6, 0.55, 0.5], gravity: 10 });
        this.arrows.splice(i, 1); a.life = 25; this.stuck.push(a);
        continue;
      } else a.pos.add(step);
      a.mesh.position.copy(a.pos);
      a.mesh.lookAt(a.pos.clone().add(a.vel));
      if (a.life <= 0 || a.pos.y < -2) { this.release(a); this.arrows.splice(i, 1); }
    }
  }

  hitEnemy(a, eh) {
    const g = this.game, e = eh.enemy;
    let mult = 1, label = null;
    if (eh.part === 'head') { mult = e.boss ? 1.8 : 2.5; label = 'HEADSHOT'; }
    else if (eh.part === 'weak') { mult = 2.2; label = 'WEAK POINT'; }
    const dmg = a.dmg * mult;
    const res = e.receiveHit({ dmg, dir: a.vel.clone().setY(0).normalize(), kb: 1 + a.draw * 2, heavy: a.precision, stagger: a.precision || mult > 1 ? 2 : a.draw > 0.8 ? 1 : 0.5, source: 'arrow', crit: mult > 1 });
    g.audio.play('arrowHit', { vol: 0.7 }); g.audio.play(e.bony ? 'boneHit' : 'fleshHit', { vol: 0.5 });
    g.vfx.hitSparks(a.pos, a.vel.clone().normalize().negate(), { color: mult > 1 ? [1, 0.85, 0.2] : [1, 0.6, 0.4] });
    g.ui.hitMarker(mult > 1, res.killed);
    if (res.hit) {
      g.ui.damageNumber(a.pos, Math.round(res.dealt ?? dmg), mult > 1);
      if (label) g.ui.flash(label, 'gold', 0.7);
      g.combat.addCombo(1);
      g.abilities.addMeter(res.killed ? 8 : 2);
      g.addScore(Math.round(dmg * g.combat.multiplier * (mult > 1 ? 1.5 : 1)));
      if (res.killed) g.onKill(e, { headshot: eh.part === 'head' });
      if (mult > 1) g.time.hitstop(0.05);
    }
  }

  stickToEnemy(a, e) {
    // parent arrow to the enemy so it rides along; it drops when the enemy dies
    a.mesh.position.copy(a.pos);
    e.root.attach(a.mesh);
    a.life = 30; a.enemy = e;
    this.stuck.push(a);
  }

  // Called by EnemyManager when an enemy dies: arrows fall to the ground to be recovered.
  dropArrowsFrom(e) {
    for (const a of this.stuck) {
      if (a.enemy !== e) continue;
      this.game.scene.attach(a.mesh);
      a.mesh.position.y = 0.15; a.mesh.rotation.set(Math.PI / 2, 0, Math.random() * 6);
      a.enemy = null; a.life = 25;
    }
  }
}
