// PlayerController — Technoblade's body: locomotion relative to the camera, jumping,
// gravity, collision, health/damage, hit reactions and the top-level state machine.
// Combat moves are delegated to CombatController, bow to BowController.
import * as THREE from 'three';
import { Animator } from '../core/Animator.js';

const tmp = new THREE.Vector3();
export const angleDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

export class PlayerController {
  constructor(game) {
    this.game = game;
    const hero = game.assets.buildTechnoblade();
    this.hero = hero;
    this.root = hero.root;
    game.scene.add(this.root);
    this.anim = new Animator(this.root, game.assets.clips.kaykit);
    this.position = this.root.position;
    this.velocity = new THREE.Vector3();
    this.vy = 0; this.grounded = true;
    this.yaw = 0; this.targetYaw = 0;
    this.radius = 0.75; this.height = 2.6;
    this.maxHp = 100; this.hp = 100;
    this.state = 'idle'; this.stateTime = 0;
    this.invuln = 0;
    this.hitStun = 0;
    this.alive = true;
    this.moveInput = new THREE.Vector3();
    this.lastStep = 0;
    this.damageTakenMult = 1;
    this.speedMult = 1;
    this.headPos = new THREE.Vector3();
  }

  reset(pos, yaw) {
    this.position.copy(pos); this.velocity.set(0, 0, 0); this.vy = 0; this.grounded = true;
    this.yaw = this.targetYaw = yaw; this.root.rotation.y = yaw;
    this.hp = this.maxHp; this.alive = true; this.invuln = 0; this.hitStun = 0;
    this.setState('idle');
    this.anim.play('2H_Melee_Idle', { fade: 0 });
    this.root.visible = true;
  }

  setState(s) { this.state = s; this.stateTime = 0; }
  is(...s) { return s.includes(this.state); }
  get busy() { return !this.is('idle', 'move'); }

  facing(out = tmp) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  // World-space move direction from WASD relative to the camera.
  computeMoveInput() {
    const inp = this.game.input.moveVector();
    const cam = this.game.cam;
    const f = cam.forward(new THREE.Vector3()), r = cam.right(new THREE.Vector3());
    this.moveInput.set(0, 0, 0).addScaledVector(f, inp.y).addScaledVector(r, inp.x);
    if (this.moveInput.lengthSq() > 1e-4) this.moveInput.normalize();
    return this.moveInput;
  }

  faceTowards(x, z, rate, dt) {
    const want = Math.atan2(x - this.position.x, z - this.position.z);
    this.turnTo(want, rate, dt);
  }
  turnTo(want, rate, dt) {
    const d = angleDiff(this.yaw, want);
    this.yaw += rate === Infinity ? d : d * (1 - Math.exp(-rate * dt));
  }

  update(dt) {
    const g = this.game;
    this.stateTime += dt;
    if (this.invuln > 0) this.invuln -= dt;
    // Mode 2: the ParkourController owns movement; we only run timers + animation here.
    if (g.mode === 'parkour') {
      this.anim.update(dt);
      this.headPos.set(this.position.x, this.position.y + 2.3, this.position.z);
      return;
    }
    const move = this.computeMoveInput();

    if (this.state === 'dead') { this.anim.update(dt); return; }

    if (this.state === 'hit') {
      this.hitStun -= dt;
      this.velocity.multiplyScalar(Math.max(0, 1 - 8 * dt));
      if (this.hitStun <= 0) this.setState('idle');
    }

    if (!this.is('idle', 'move', 'air', 'dodge', 'hit')) this.velocity.multiplyScalar(Math.max(0, 1 - 10 * dt));
    if (this.state === 'air' && this.grounded && this.stateTime > 0.1) this.setState('idle');
    if (this.state === 'emote' && (this.stateTime > 2 || move.lengthSq() > 0.01 || this.game.input.peek('attack') || this.game.input.peek('dodge'))) this.setState('idle');

    if (this.is('idle', 'move', 'air')) {
      const aiming = g.bow.aiming;
      const sprint = g.input.down('sprint') && !aiming;
      const speed = (aiming ? 4.2 : sprint ? 12.5 : 8.6) * this.speedMult;
      const wantV = tmp.copy(move).multiplyScalar(speed);
      const accel = this.grounded ? 14 : 4;
      this.velocity.x += (wantV.x - this.velocity.x) * (1 - Math.exp(-accel * dt));
      this.velocity.z += (wantV.z - this.velocity.z) * (1 - Math.exp(-accel * dt));
      const moving = move.lengthSq() > 0.01;
      if (aiming) this.turnTo(g.cam.yaw + Math.PI, 20, dt);
      else if (g.combat.lockTarget && moving) this.faceTowards(g.combat.lockTarget.position.x, g.combat.lockTarget.position.z, 12, dt);
      else if (moving) this.turnTo(Math.atan2(move.x, move.z), 12, dt);
      this.setLocomotionState(moving, sprint, aiming);
      if (moving && this.grounded) {
        this.lastStep -= dt * (sprint ? 1.5 : 1);
        if (this.lastStep <= 0) { this.lastStep = 0.3; g.audio.play('step', { vol: 0.25, jitter: 0.15 }); }
      }
    }

    // gravity / jump arc
    if (!this.grounded || this.vy > 0) {
      const grav = g.combat.airHang > 0 ? 6 : 30;
      this.vy -= grav * dt;
      this.position.y += this.vy * dt;
      if (this.position.y <= 0) {
        this.position.y = 0; this.vy = 0;
        if (!this.grounded) { this.grounded = true; g.combat.onLand(); }
      } else this.grounded = false;
    }

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    g.world.resolve(this.position, this.radius, this.position.y);

    this.root.rotation.y = this.yaw;
    this.anim.update(dt);
    this.headPos.set(this.position.x, this.position.y + 2.3, this.position.z);
  }

  setLocomotionState(moving, sprint, aiming) {
    if (!this.grounded) return;
    const a = this.anim;
    if (aiming) {
      this.state = moving ? 'move' : 'idle';
      if (!moving) { a.play(this.game.bow.drawing ? 'Blocking' : 'Blocking', { fade: 0.15 }); return; }
      // strafe animation by local direction
      const f = this.facing(new THREE.Vector3()); const r = new THREE.Vector3(f.z, 0, -f.x);
      const fwd = this.moveInput.dot(f), side = this.moveInput.dot(r);
      if (Math.abs(side) > Math.abs(fwd)) a.play(side > 0 ? 'Running_Strafe_Left' : 'Running_Strafe_Right', { fade: 0.15, timeScale: 0.7 });
      else a.play(fwd > 0 ? 'Walking_A' : 'Walking_Backwards', { fade: 0.15 });
      return;
    }
    if (moving) { this.state = 'move'; a.play(sprint ? 'Running_B' : 'Running_A', { fade: 0.15, timeScale: sprint ? 1.15 : 1.05 }); }
    else { this.state = 'idle'; a.play(this.game.combat.inCombat ? '2H_Melee_Idle' : 'Idle', { fade: 0.25 }); }
  }

  jump() {
    if (!this.grounded || this.busy) return false;
    this.vy = 11.5; this.grounded = false; this.position.y += 0.01;
    this.anim.play('Jump_Full_Short', { fade: 0.08, once: true, timeScale: 1.2 });
    this.game.audio.play('dodge', { vol: 0.4 });
    return true;
  }

  // Returns true if the hit landed.
  takeHit(dmg, from, { heavy = false, knock = 4, source = null } = {}) {
    const g = this.game;
    if (!this.alive || this.invuln > 0) return false;
    if (g.mode === 'parkour') {
      const pm = g.parkour, pk = pm.pk;
      if (pk.iframes > 0) return false; // dash i-frames
      dmg *= this.damageTakenMult;
      this.hp = Math.max(0, this.hp - dmg);
      g.onPlayerDamaged(dmg, from);
      const away = tmp.set(this.position.x - from.x, 0, this.position.z - from.z).normalize();
      pm.mover.knock(away, knock * (heavy ? 1.6 : 1));
      g.vfx.hitSparks(new THREE.Vector3(this.position.x, this.position.y + 1.6, this.position.z), away, { color: [1, 0.3, 0.2] });
      g.audio.play('fleshHit', { vol: 0.8 }); g.audio.play('hurt', { vol: 0.35, rate: 0.75 });
      pm.fpCam.addShake(heavy ? 0.5 : 0.3); pm.tpCam.addShake(heavy ? 0.5 : 0.3);
      g.combat.onPlayerHit();
      if (this.hp <= 0) { this.die(); return true; }
      this.invuln = heavy ? 0.7 : 0.45;
      this.anim.playUpper(Math.random() < 0.5 ? 'Hit_A' : 'Hit_B', { timeScale: 1.4 });
      return true;
    }
    if (this.state === 'finisher' || g.combat.isInvulnerable()) return false;
    dmg *= this.damageTakenMult;
    this.hp = Math.max(0, this.hp - dmg);
    g.onPlayerDamaged(dmg, from);
    const away = tmp.set(this.position.x - from.x, 0, this.position.z - from.z).normalize();
    this.velocity.copy(away).multiplyScalar(knock * (heavy ? 2.2 : 1.2));
    g.vfx.hitSparks(new THREE.Vector3(this.position.x, 1.6, this.position.z), away, { color: [1, 0.3, 0.2] });
    g.audio.play('fleshHit', { vol: 0.8 }); g.audio.play('hurt', { vol: 0.35, rate: 0.75 });
    g.cam.addTrauma(heavy ? 0.6 : 0.35);
    g.combat.onPlayerHit();
    g.bow.cancel();
    if (this.hp <= 0) { this.die(); return true; }
    this.setState('hit');
    this.hitStun = heavy ? 0.65 : 0.38;
    this.invuln = heavy ? 0.9 : 0.55;
    this.anim.play(Math.random() < 0.5 ? 'Hit_A' : 'Hit_B', { fade: 0.05, once: true, restart: true, timeScale: 1.3 });
    return true;
  }

  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }

  die() {
    this.alive = false; this.setState('dead');
    this.velocity.set(0, 0, 0);
    this.anim.stopUpper?.(0.05);
    this.anim.play('Death_A', { fade: 0.1, once: true });
    this.game.onPlayerDeath();
  }
}
