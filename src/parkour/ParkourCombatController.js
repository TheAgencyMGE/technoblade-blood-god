// ParkourCombatController — Mode 2's own combat: fast 3-hit combos that never root you,
// movement attacks (via MovementAttackController), 3D cone hit detection from the camera
// (first-person) or body (third-person), damage/knockback that scale with your speed,
// high-speed body slams, ground-slam shockwaves that also smash props, and a bow you can
// fire while jumping, wall-running, sliding or dashing (with airborne focus slow-mo).
import * as THREE from 'three';
import { PK_ATTACKS, MovementAttackController } from './MovementAttackController.js';

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

export class ParkourCombatController {
  constructor(mode) {
    this.mode = mode; this.game = mode.game; this.pk = mode.mover.pk;
    this.moves = new MovementAttackController(this);
    this.atk = null; this.chain = 0; this.chainT = 0;
    this.aiming = false; this.drawing = false; this.draw = 0; this.focus = 1; this.focusing = false;
    this.bodySlamCd = new Map();
  }

  reset() { this.atk = null; this.chain = 0; this.aiming = false; this.drawing = false; this.focus = 1; this.moves.special = null; }

  lookDir(look, out = new THREE.Vector3()) {
    const cp = Math.cos(look.pitch);
    return out.set(-Math.sin(look.yaw) * cp, Math.sin(look.pitch), -Math.cos(look.yaw) * cp).normalize();
  }

  findTarget(look, range, minDot) {
    const g = this.game, pk = this.pk; const dir = this.lookDir(look);
    let best = null, bs = -1;
    for (const e of g.enemies.list) {
      if (!e.targetable) continue;
      const to = e.chestPos(tmp).sub(tmp2.set(pk.pos.x, pk.pos.y + 1.5, pk.pos.z));
      const d = to.length(); if (d > range) continue;
      const dot = to.normalize().dot(dir); if (dot < minDot) continue;
      const s = dot * 2 - d / range; if (s > bs) { bs = s; best = e; }
    }
    return best;
  }

  update(dt, look, input) {
    const g = this.game, pk = this.pk;
    if (this.chainT > 0) { this.chainT -= dt; if (this.chainT <= 0) this.chain = 0; }
    this.moves.update(dt);
    this.updateBow(dt, look, input);
    if (!this.aiming && input.take('attack')) this.startAttack(look);
    if (this.atk) {
      const a = this.atk; a.t += dt;
      if (!a.hit && a.t >= a.impactT) this.strikeNow();
      if (a.t >= a.dur) { this.atk = null; this.mode.weapon.trail(false); }
    }
    this.bodySlams(dt);
  }

  startAttack(look) {
    const kind = this.moves.choose(look);
    if (this.atk && this.atk.t < this.atk.cancelT) { this.game.input.bufferAction('attack', 0.2); return; }
    let def;
    if (kind) def = PK_ATTACKS[kind];
    else { def = PK_ATTACKS['combo' + (this.chain % 3 + 1)]; this.chain++; this.chainT = 0.7; }
    const g = this.game;
    const ts = def.ts * (g.abilities.bloodGod ? 1.3 : 1);
    const clip = g.assets.clips.kaykit[def.anim];
    const dur = clip.duration / ts;
    const imp = (g.combat.impacts[def.anim] ?? 0.45) * dur;
    this.atk = { def, kind, t: 0, dur: dur * 0.85, impactT: imp, cancelT: imp + 0.05, hit: false, look: { ...look } };
    this.moves.begin(kind, look);
    // animations: full-body clip on the viewmodel, upper-body layer on the third-person body
    this.mode.viewModel.attack(def.anim, ts);
    if (this.pk.state === 'slide' || this.pk.grounded === false || this.mode.mover.speed > 2) g.player.anim.playUpper(def.anim, { timeScale: ts });
    else g.player.anim.play(def.anim, { fade: 0.05, once: true, restart: true, timeScale: ts });
    this.mode.weapon.trail(true, !!def.heavy);
    g.audio.play('swing', { vol: 0.6, rate: def.heavy ? 0.85 : 1.1, delay: Math.max(0, imp - 0.1) });
    if (def.name) g.ui.flash(def.name, 'gold', 0.6);
  }

  // Resolve the current attack's hit volume right now.
  strikeNow() {
    const a = this.atk; if (!a || a.hit) return; a.hit = true;
    const g = this.game, pk = this.pk;
    const look = this.mode.look;
    const fp = this.mode.view === 'fp';
    const origin = new THREE.Vector3(pk.pos.x, pk.pos.y + (a.def.low ? 0.8 : 1.5), pk.pos.z);
    const fwd = fp ? this.lookDir(look) : new THREE.Vector3(-Math.sin(look.yaw), 0, -Math.cos(look.yaw));
    let n = 0;
    for (const e of g.enemies.list) {
      if (!e.hittable) continue;
      const c = e.chestPos(tmp);
      const dy = c.y - origin.y;
      if (Math.abs(dy) > a.def.vert + e.height * 0.4) continue;
      const to = tmp2.set(c.x - origin.x, 0, c.z - origin.z);
      const d = to.length() - e.radius;
      if (d > a.def.reach) continue;
      if (a.def.arc < 360) {
        const fh = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
        if (to.lengthSq() > 0.01 && to.normalize().dot(fh) < Math.cos(THREE.MathUtils.degToRad(a.def.arc / 2)) && d > 0.6) continue;
      }
      if (g.world.segmentBlocked(origin.x, origin.z, c.x, c.z, 1.0, 0, Math.min(pk.pos.y, e.position.y))) continue;
      this.hit(e, a.def, fwd); n++;
    }
    if (n) {
      g.time.hitstop(a.def.heavy ? 0.06 : 0.035);
      this.mode.fpCam.hitPunch((Math.random() - 0.5) * 0.02, 0.025);
      this.mode.tpCam.addShake(a.def.heavy ? 0.3 : 0.12);
      if (a.def.juggle && !pk.grounded) pk.vel.y = Math.max(pk.vel.y, 3); // hang in the air while juggling
    } else g.audio.play('blade', { vol: 0.12 });
  }

  // Apply one hit; damage and knockback scale with current speed.
  hit(e, def, fwd) {
    const g = this.game, pk = this.pk;
    const speed = this.mode.mover.speed;
    const speedK = 1 + Math.min(0.9, Math.max(0, speed - 10) / 22);
    const bg = g.abilities.bloodGod;
    let dmg = def.dmg * speedK * (bg ? 2 : 1) * (1 + Math.min(0.5, g.combat.combo * 0.015));
    const crit = Math.random() < 0.1; if (crit) dmg *= 1.6;
    const dir = new THREE.Vector3(e.position.x - pk.pos.x, 0, e.position.z - pk.pos.z).normalize();
    if (fwd && def.arc >= 360 && dir.lengthSq() < 0.01) dir.copy(fwd).setY(0).normalize();
    const res = e.receiveHit({
      dmg, dir, kb: def.kb * (0.7 + speedK * 0.5), heavy: !!def.heavy, guardBreak: !!def.heavy || bg, stagger: def.heavy ? 2 : 1,
      launch: def.launch ?? (speed > 24 && !def.low ? 7 : 0), juggle: !!def.juggle, crit, source: 'melee',
    });
    if (!res.hit) { if (res.blocked) { g.audio.play('clash', { vol: 0.7 }); g.ui.flash('BLOCKED — USE A MOVEMENT ATTACK', 'grey', 0.8); } return res; }
    const hp = e.chestPos();
    g.vfx.hitSparks(hp, dir, { heavy: !!def.heavy || crit, color: bg ? [1, 0.2, 0.1] : crit ? [1, 0.85, 0.2] : [1, 0.7, 0.4] });
    g.vfx.slash(hp, Math.atan2(dir.x, dir.z) + Math.PI / 2, { scale: def.heavy ? 4.2 : 3.2, tilt: def.low ? 1.4 : 0.3, color: bg ? [1, 0.25, 0.2] : [1, 0.9, 0.8] });
    if (e.bony) g.vfx.boneBurst(hp);
    g.audio.play('swordHit', { vol: 0.7 }); g.audio.play(e.bony ? 'boneHit' : 'fleshHit', { vol: 0.55 });
    g.ui.damageNumber(hp, Math.round(res.dealt ?? dmg), crit);
    g.combat.addCombo(1);
    g.abilities.addMeter(res.killed ? 8 : 2.4);
    g.addScore(Math.round((res.dealt ?? dmg) * g.combat.multiplier * speedK));
    if (res.killed) g.onKill(e, {});
    return res;
  }

  // Radial shockwave (ground slam / dive): damage falls off, knocks away and up, smashes props.
  shockwave(center, radius, power, kind = 'slam') {
    const g = this.game, pk = this.pk;
    g.vfx.groundSlam(center, radius, g.abilities.bloodGod ? [1, 0.05, 0.05] : [1, 0.5, 0.15]);
    g.audio.play('slam', { vol: 1 }); g.audio.play('explosion', { vol: 0.5 * power });
    this.mode.fpCam.slam(power); this.mode.tpCam.addShake(0.7 * power);
    g.time.hitstop(0.07);
    for (const e of g.enemies.list) {
      if (!e.hittable) continue;
      const d = Math.hypot(e.position.x - center.x, e.position.z - center.z);
      if (d > radius + e.radius || Math.abs(e.position.y - center.y) > 3) continue;
      const k = 1 - Math.min(1, d / (radius + e.radius));
      this.hit(e, { dmg: 30 * power * (0.4 + 0.6 * k), kb: 10 * power, heavy: true, arc: 360, launch: e.heavyType ? 0 : 7 + 4 * k, low: false }, null);
    }
    const broke = g.arena.parkour.smash(center, radius * 0.7, g.vfx, g.audio);
    if (broke) g.addScore(50 * broke);
    void pk; void kind;
  }

  // Running into enemies at high speed bowls them over.
  bodySlams(dt) {
    const g = this.game, pk = this.pk, sp = this.mode.mover.speed;
    for (const [e, t] of this.bodySlamCd) { if (t - dt <= 0) this.bodySlamCd.delete(e); else this.bodySlamCd.set(e, t - dt); }
    if (sp < 18) return;
    for (const e of g.enemies.list) {
      if (!e.hittable || this.bodySlamCd.has(e)) continue;
      if (e.position.distanceTo(pk.pos) < e.radius + pk.radius + 0.4 && Math.abs(e.position.y - pk.pos.y) < 2) {
        this.bodySlamCd.set(e, 0.6);
        this.hit(e, { dmg: 6 + sp * 0.4, kb: 6 + sp * 0.35, heavy: e.heavyType ? false : true, arc: 360, launch: e.heavyType ? 0 : 6 }, null);
        if (e.heavyType) { pk.vel.multiplyScalar(0.4); } // bouncing off a brute costs speed
        g.ui.flash('BODY SLAM', 'gold', 0.5);
      }
    }
  }

  // ---------- bow ----------
  updateBow(dt, look, input) {
    const g = this.game, pk = this.pk, bow = g.bow;
    const want = input.mouse.right && g.player.alive;
    if (want && !this.aiming) { this.aiming = true; this.mode.showBow(true); g.audio.play('bowDraw', { vol: 0.25, rate: 1.5 }); input.take('attack'); }
    else if (!want && this.aiming) { this.aiming = false; this.drawing = false; this.draw = 0; this.mode.showBow(false); this.setFocus(false); }
    if (!this.aiming) { if (pk.grounded) this.focus = Math.min(1, this.focus + dt * 0.5); g.ui.drawMeter(0); return; }
    // airborne precision focus: brief slow-mo while aiming in the air
    const canFocus = !pk.grounded && this.focus > 0;
    this.setFocus(canFocus);
    if (canFocus) this.focus = Math.max(0, this.focus - dt / 1.4);
    else if (pk.grounded) this.focus = Math.min(1, this.focus + dt * 0.5);
    if (input.mouse.left && bow.ammo > 0) {
      if (!this.drawing) { this.drawing = true; this.draw = 0; g.audio.play('bowDraw', { vol: 0.5, rate: 1.3 }); }
      this.draw = Math.min(1, this.draw + dt / 0.35);
    } else if (input.leftPressed && bow.ammo <= 0) { g.ui.flash('NO ARROWS', 'grey'); }
    if (this.drawing && !input.mouse.left) { this.fire(look, Math.max(0.35, this.draw)); this.drawing = false; this.draw = 0; }
    g.ui.drawMeter(this.drawing ? this.draw : 0);
  }

  setFocus(on) {
    if (on === this.focusing) return;
    this.focusing = on;
    this.game.time.focus = on ? 0.45 : 1;
    this.game.audio.setMuffle(on ? 0.25 : 0, 0.2);
  }

  fire(look, draw) {
    const g = this.game, pk = this.pk;
    const dir = this.lookDir(look);
    let origin;
    if (this.mode.view === 'fp') origin = g.camera.position.clone().addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.12, 0));
    else {
      origin = new THREE.Vector3(); g.player.hero.handL.getWorldPosition(origin); origin.y = Math.max(origin.y, pk.pos.y + 1.5);
      // aim through the crosshair: ray from the camera
      const cam = g.camera; const cd = cam.getWorldDirection(new THREE.Vector3());
      const dist = Math.min(80, g.world.raycast(cam.position, cd, 80));
      const aimPt = cam.position.clone().addScaledVector(cd, dist);
      dir.copy(aimPt.sub(origin).normalize());
    }
    g.bow.fireFrom(origin, dir, draw);
    this.mode.viewModel.fire();
    this.mode.fpCam.hitPunch(0, 0.02);
    g.player.anim.playUpper('Block_Attack', { timeScale: 2.2 });
  }
}
