// CombatController — Arkham/Insomniac-style free-flow melee for Technoblade.
//  * Intelligent target selection from stick/camera direction (never behind the player)
//  * Magnetic lunges so every strike makes contact, then impact-frame hit detection
//  * 5-hit light chains, heavy guard-breaks, charged, running, launcher + aerial juggles,
//    aerial takedown, ground finishers, multi-target executions, counters, perfect dodges
//  * Hit-stop, slow-mo, camera shake, sparks, slash decals, combo/flow multiplier
import * as THREE from 'three';
import { angleDiff } from './PlayerController.js';

const V = () => new THREE.Vector3();
const tmpA = V(), tmpB = V();

// Light chain. `imp` = normalized impact time (filled in from clip analysis at load).
export const LIGHT_CHAIN = [
  { anim: '2H_Melee_Attack_Slice', ts: 1.55, dmg: 12, reach: 2.7, arc: 100, kb: 1.6, stop: 0.045, cancel: 0.62, decalTilt: 0.2 },
  { anim: '1H_Melee_Attack_Slice_Diagonal', ts: 1.6, dmg: 12, reach: 2.6, arc: 100, kb: 1.6, stop: 0.045, cancel: 0.6, decalTilt: -0.6 },
  { anim: '1H_Melee_Attack_Slice_Horizontal', ts: 1.6, dmg: 13, reach: 2.6, arc: 120, kb: 1.8, stop: 0.05, cancel: 0.6, decalTilt: 0 },
  { anim: '2H_Melee_Attack_Chop', ts: 1.45, dmg: 17, reach: 2.8, arc: 80, kb: 2.6, stop: 0.06, cancel: 0.62, decalTilt: 1.3 },
  { anim: '2H_Melee_Attack_Spin', ts: 1.35, dmg: 22, reach: 3.3, arc: 360, kb: 6, stop: 0.09, cancel: 0.7, cleave: true, heavyFx: true, decalTilt: 0 },
];
export const MOVES = {
  heavy: { anim: '2H_Melee_Attack_Chop', ts: 1.05, dmg: 32, reach: 3.0, arc: 90, kb: 5, stop: 0.11, cancel: 0.72, guardBreak: true, heavyFx: true, stagger: 2, decalTilt: 1.4 },
  running: { anim: '2H_Melee_Attack_Stab', ts: 1.3, dmg: 22, reach: 3.2, arc: 70, kb: 7, stop: 0.08, cancel: 0.7, heavyFx: true, lungeRange: 14, decalTilt: 0.3 },
  launcher: { anim: 'Unarmed_Melee_Attack_Kick', ts: 1.35, dmg: 10, reach: 2.6, arc: 90, kb: 0.5, stop: 0.07, cancel: 0.8, launch: 11.5, decalTilt: -1.2 },
  aerial: { anim: '1H_Melee_Attack_Slice_Horizontal', ts: 1.8, dmg: 12, reach: 3.0, arc: 140, kb: 0.4, stop: 0.05, cancel: 0.55, juggle: true, decalTilt: 0.4 },
  aerial2: { anim: '1H_Melee_Attack_Slice_Diagonal', ts: 1.8, dmg: 12, reach: 3.0, arc: 140, kb: 0.4, stop: 0.05, cancel: 0.55, juggle: true, decalTilt: -0.5 },
  plunge: { anim: '1H_Melee_Attack_Jump_Chop', ts: 1.4, dmg: 30, reach: 3.6, arc: 360, kb: 5, stop: 0.12, cancel: 0.75, slam: 4.5, heavyFx: true, cleave: true, decalTilt: 1.5 },
  charged: { anim: '2H_Melee_Attack_Spinning', ts: 1.5, dmg: 44, reach: 4.6, arc: 360, kb: 9, stop: 0.14, cancel: 0.75, cleave: true, heavyFx: true, guardBreak: true, stagger: 3, slam: 4.6, decalTilt: 0 },
  chargedStab: { anim: '2H_Melee_Attack_Stab', ts: 1.6, dmg: 28, reach: 4.2, arc: 60, kb: 7, stop: 0.09, cancel: 0.7, heavyFx: true, guardBreak: true, stagger: 2, decalTilt: 0.2 },
  groundFinisher: { anim: '2H_Melee_Attack_Chop', ts: 0.9, dmg: 9999, reach: 3.2, arc: 180, kb: 0, stop: 0.16, cancel: 0.85, execution: true, heavyFx: true, decalTilt: 1.5 },
};
export const ALL_ATTACK_ANIMS = [...new Set([...LIGHT_CHAIN, ...Object.values(MOVES)].map(a => a.anim).concat(['Block_Attack', '2H_Melee_Attack_Slice', '1H_Melee_Attack_Stab']))];

export class CombatController {
  constructor(game) {
    this.game = game;
    this.combo = 0; this.comboTimer = 0; this.bestCombo = 0;
    this.chainIndex = 0; this.chainTimer = 0;
    this.atk = null;
    this.lockTarget = null;
    this.dodgeT = 0; this.dodgeDir = V(); this.iframes = 0;
    this.airHang = 0;
    this.charge = 0; this.charging = false;
    this.critCharges = 0;
    this.dodgeCounter = 0; // crit window after perfect dodge
    this.seq = null; // finisher / multi-enemy sequence
    this.inCombat = false; this.combatTimer = 0;
    this.whiff = 0;
    this.finisherReadyAt = 5;
    this.impacts = {}; // anim -> normalized impact time
  }

  reset() {
    this.combo = 0; this.comboTimer = 0; this.chainIndex = 0; this.atk = null; this.lockTarget = null; this.seq = null;
    this.charging = false; this.charge = 0; this.airHang = 0; this.critCharges = 0; this.iframes = 0; this.bestCombo = 0;
  }

  // Find when the blade is moving fastest in each attack clip -> impact frame.
  analyzeImpacts(assets) {
    const hero = assets.buildTechnoblade();
    const mixer = new THREE.AnimationMixer(hero.root);
    const hand = hero.handR;
    for (const name of ALL_ATTACK_ANIMS) {
      const clip = assets.clips.kaykit[name]; if (!clip) continue;
      const act = mixer.clipAction(clip); act.reset().play();
      const N = 40; let prev = null, best = 0, bestT = 0.45;
      for (let i = 0; i <= N; i++) {
        const t = clip.duration * i / N;
        mixer.setTime(t); hero.root.updateMatrixWorld(true);
        const p = hand.getWorldPosition(V());
        if (prev) { const sp = p.distanceTo(prev); const nt = i / N; if (nt > 0.15 && nt < 0.85 && sp > best) { best = sp; bestT = nt; } }
        prev = p;
      }
      act.stop();
      this.impacts[name] = bestT;
    }
  }

  get player() { return this.game.player; }

  isInvulnerable() { return this.iframes > 0 || !!this.seq || this.player.state === 'finisher' || this.game.abilities.activating; }

  addCombo(n = 1) {
    this.combo += n; this.comboTimer = 2.6;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.game.ui.combo(this.combo);
  }
  get multiplier() { return Math.min(8, 1 + Math.floor(this.combo / 5)); }

  onPlayerHit() { if (this.combo >= 3) this.game.ui.comboBroken(this.combo); this.combo = 0; this.comboTimer = 0; this.atk = null; this.charging = false; this.chainIndex = 0; this.game.weapon.trail(false); }

  onLand() {
    const p = this.player;
    if (this.atk && this.atk.def === MOVES.plunge) return;
    if (p.state === 'air' || p.is('idle', 'move')) { p.anim.play('Jump_Land', { fade: 0.05, once: true, timeScale: 1.6 }); p.setState('land'); }
    this.game.vfx.dust(p.position, 6, 2);
  }

  // ------------------------------------------------------------------ targeting
  selectTarget({ range = 11, needAlive = true, allowDown = false } = {}) {
    const g = this.game, p = this.player;
    if (this.lockTarget && this.lockTarget.targetable && p.position.distanceTo(this.lockTarget.position) < range + 2) return this.lockTarget;
    const move = p.moveInput;
    let dir;
    if (move.lengthSq() > 0.01) dir = tmpA.copy(move);
    else dir = g.cam.forward(tmpA);
    let best = null, bestScore = Infinity;
    for (const e of g.enemies.list) {
      if (needAlive && !e.targetable) continue;
      if (!allowDown && e.state === 'down' && !e.airborne) continue;
      const dx = e.position.x - p.position.x, dz = e.position.z - p.position.z;
      const d = Math.hypot(dx, dz) - e.radius;
      if (d > range) continue;
      const ang = Math.abs(angleDiff(Math.atan2(dir.x, dir.z), Math.atan2(dx, dz)));
      // Never select enemies behind the intended direction (unless hugging the player).
      if (ang > THREE.MathUtils.degToRad(move.lengthSq() > 0.01 ? 75 : 110) && d > 1.2) continue;
      if (g.world.segmentBlocked(p.position.x, p.position.z, e.position.x, e.position.z, 1.2)) continue;
      const score = d * (1 + ang * 1.4) + (e.state === 'down' ? 4 : 0);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  toggleLock() {
    if (this.lockTarget) { this.lockTarget = null; this.game.ui.lock(null); return; }
    const t = this.selectTarget({ range: 22 });
    if (t) { this.lockTarget = t; this.game.ui.lock(t); this.game.audio.play('uiSelect', { vol: 0.4 }); }
  }

  // ------------------------------------------------------------------ input entry point
  // Combo decay (shared by both modes).
  tickCombo(dt) {
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) { if (this.combo >= 3) this.game.ui.comboEnd(this.combo); this.combo = 0; } }
  }

  update(dt) {
    const g = this.game, p = this.player, input = g.input;
    this.tickCombo(dt);
    if (this.chainTimer > 0) { this.chainTimer -= dt; if (this.chainTimer <= 0) this.chainIndex = 0; }
    if (this.iframes > 0) this.iframes -= dt;
    if (this.airHang > 0) this.airHang -= dt;
    if (this.dodgeCounter > 0) this.dodgeCounter -= dt;
    if (this.whiff > 0) this.whiff -= dt;
    const near = g.enemies.countNear(p.position, 12);
    if (near > 0) { this.inCombat = true; this.combatTimer = 3; } else if (this.combatTimer > 0) { this.combatTimer -= dt; if (this.combatTimer <= 0) this.inCombat = false; }
    if (this.lockTarget && !this.lockTarget.targetable) { this.lockTarget = null; g.ui.lock(null); }
    if (!p.alive) return;

    if (input.take('lock')) this.toggleLock();

    if (this.seq) { this.updateSequence(dt); return; }

    switch (p.state) {
      case 'attack': this.updateAttack(dt); break;
      case 'dodge': this.updateDodge(dt); break;
      case 'counter': this.updateCounter(dt); break;
      case 'charge': this.updateCharge(dt); break;
      case 'block': if (p.stateTime > 0.4) p.setState('idle'); break;
      case 'land': if (p.stateTime > 0.18) p.setState('idle'); break;
    }

    const canAct = p.is('idle', 'move', 'land') || (p.state === 'air') || (p.state === 'attack' && this.atk && this.atk.t >= this.atk.cancelT);
    const canDefend = canAct || p.state === 'charge' || (p.state === 'attack' && this.atk && (this.atk.t >= this.atk.impactT || this.atk.t < 0.06)) || p.state === 'hit' && p.stateTime > 0.2;

    if (g.bow.aiming) return; // bow owns LMB while aiming

    // Defensive actions have priority (and can cancel recovery frames).
    if (canDefend && input.take('counter')) { this.tryCounter(); return; }
    if (canDefend && input.take('dodge')) { this.dodge(); return; }
    if (!canAct) return;
    if (input.take('jump')) { if (p.grounded) { this.endAttack(); p.jump(); p.setState('air'); } return; }
    if (input.take('finisher')) { this.tryFinisher(); return; }
    if (input.take('heavy')) {
      if (!p.grounded) { this.startAttack(MOVES.plunge, this.selectTarget({ range: 9 }), { takedown: true }); return; }
      const down = this.selectTarget({ range: 6, allowDown: true });
      if (down && down.state === 'down' && !down.boss) { this.groundFinisher(down); return; }
      this.startAttack(MOVES.heavy, this.selectTarget()); return;
    }
    if (input.take('launch')) { this.startAttack(MOVES.launcher, this.selectTarget({ range: 8 })); return; }
    if (input.take('attack')) {
      if (!p.grounded) {
        const t = this.selectTarget({ range: 7 });
        if (t && t.airborne) { this.startAttack(this.chainIndex % 2 ? MOVES.aerial2 : MOVES.aerial, t); this.chainIndex++; }
        else this.startAttack(MOVES.plunge, t);
        return;
      }
      const sprinting = input.down('sprint') && p.moveInput.lengthSq() > 0.01;
      if (sprinting && p.state === 'move') { this.startAttack(MOVES.running, this.selectTarget({ range: MOVES.running.lungeRange })); return; }
      const def = LIGHT_CHAIN[this.chainIndex % LIGHT_CHAIN.length];
      this.chainIndex++; this.chainTimer = 1.0;
      this.startAttack(def, this.selectTarget());
      return;
    }
    // Hold LMB while idle (or after a strike) to charge.
    if (input.mouse.left && input.leftHeldTime() > 0.3 && p.is('idle', 'move', 'attack') && p.grounded) this.beginCharge();
  }

  // ------------------------------------------------------------------ attacks
  startAttack(def, target, opts = {}) {
    const g = this.game, p = this.player;
    this.charging = false;
    const bg = g.abilities.bloodGod;
    const flow = Math.min(0.35, this.combo * 0.012);
    const ts = def.ts * (1 + flow) * (bg ? 1.35 : 1);
    const clipDur = p.anim.duration(def.anim);
    const imp = def.imp ?? this.impacts[def.anim] ?? 0.45;
    const dur = clipDur / ts;
    const a = { def, target, t: 0, impactT: imp * dur, cancelT: Math.max(imp * dur + 0.04, def.cancel * dur), endT: dur * 0.94, hitDone: false, opts };
    // Magnetic lunge toward the chosen target so the blade actually connects.
    if (target) {
      const dx = target.position.x - p.position.x, dz = target.position.z - p.position.z;
      const d = Math.hypot(dx, dz);
      const stopAt = target.radius + Math.min(1.7, def.reach * 0.6);
      const travel = Math.max(0, d - stopAt);
      const maxRange = def.lungeRange ?? (p.grounded ? 9 : 7);
      if (travel > 0.05 && d < maxRange + target.radius) {
        const lungeTime = Math.max(0.12, Math.min(a.impactT * 0.9, 0.32));
        a.lunge = { from: p.position.clone(), dir: new THREE.Vector3(dx / d, 0, dz / d), dist: travel, t: 0, dur: lungeTime };
        if (travel > 4) { g.vfx.dust(p.position, 4, 1.6); g.audio.play('dodge', { vol: 0.35, rate: 1.3 }); }
        // Long-range lunges get compressed so attacks still land on time.
        if (travel > 3) { a.impactT += 0.06; a.cancelT += 0.06; a.endT += 0.06; }
      }
      this.inCombat = true; this.combatTimer = 3;
    }
    p.setState('attack');
    p.velocity.set(0, 0, 0);
    if (!p.grounded) {
      if (def === MOVES.plunge) { p.vy = Math.min(p.vy, 4); }
      else { p.vy = Math.max(p.vy, 2.5); this.airHang = 0.7; }
    }
    p.anim.play(def.anim, { fade: 0.06, once: true, restart: true, timeScale: ts });
    g.weapon.trail(true, def.heavyFx);
    this.atk = a;
    g.audio.play('swing', { vol: 0.55, rate: def.heavyFx ? 0.8 : 1.05, delay: Math.max(0, a.impactT - 0.12) });
  }

  updateAttack(dt) {
    const g = this.game, p = this.player, a = this.atk;
    if (!a) { p.setState('idle'); return; }
    a.t += dt;
    const tgt = a.target && a.target.alive ? a.target : null;
    if (a.lunge && a.lunge.t < a.lunge.dur) {
      a.lunge.t += dt;
      const k = Math.min(1, a.lunge.t / a.lunge.dur); const e = 1 - Math.pow(1 - k, 2.2);
      // retarget lunge end if the target keeps moving
      if (tgt) {
        const dx = tgt.position.x - a.lunge.from.x, dz = tgt.position.z - a.lunge.from.z; const d = Math.hypot(dx, dz) || 1;
        a.lunge.dir.set(dx / d, 0, dz / d); a.lunge.dist = Math.max(0, d - (tgt.radius + Math.min(1.7, a.def.reach * 0.6)));
      }
      const nx = a.lunge.from.x + a.lunge.dir.x * a.lunge.dist * e, nz = a.lunge.from.z + a.lunge.dir.z * a.lunge.dist * e;
      p.position.x = nx; p.position.z = nz;
      if (k >= 1 && a.def === MOVES.running) g.vfx.dust(p.position, 5, 2);
    }
    if (tgt) p.faceTowards(tgt.position.x, tgt.position.z, a.t < a.impactT ? 26 : 8, dt);
    if (a.def === MOVES.plunge && !p.grounded && a.t > a.impactT * 0.55) { p.vy = -30; }

    if (!a.hitDone && a.t >= a.impactT && (a.def !== MOVES.plunge || p.grounded || p.position.y < 0.4)) {
      a.hitDone = true;
      this.resolveHit(a);
    }
    if (a.t >= a.cancelT) g.weapon.trail(false);
    if (a.t >= a.endT) this.endAttack();
    // Holding LMB through a light attack flows into a charge.
    if (a.hitDone && g.input.mouse.left && g.input.leftHeldTime() > 0.3 && a.t >= a.cancelT && LIGHT_CHAIN.includes(a.def)) this.beginCharge();
  }

  endAttack() {
    const p = this.player;
    this.atk = null; this.game.weapon.trail(false);
    if (p.state === 'attack') p.setState(p.grounded ? 'idle' : 'air');
  }

  // Impact frame: who gets hit?
  resolveHit(a) {
    const g = this.game, p = this.player, def = a.def;
    const face = p.facing(V());
    const victims = [];
    for (const e of g.enemies.list) {
      if (!e.hittable) continue;
      const dx = e.position.x - p.position.x, dz = e.position.z - p.position.z;
      const dy = Math.abs((e.position.y) - p.position.y);
      if (dy > 3.2 && !def.juggle) continue;
      const d = Math.hypot(dx, dz) - e.radius;
      const isPrimary = e === a.target;
      const reach = def.reach + (isPrimary ? 0.9 : 0);
      if (d > reach) continue;
      if (def.arc < 360) {
        const ang = Math.abs(angleDiff(Math.atan2(face.x, face.z), Math.atan2(dx, dz)));
        if (ang > THREE.MathUtils.degToRad(def.arc / 2) && d > 0.6) continue;
      }
      // no hits through walls
      if (g.world.segmentBlocked(p.position.x, p.position.z, e.position.x, e.position.z, 1.0)) continue;
      if (!def.cleave && !isPrimary && victims.length >= 2) continue;
      victims.push(e);
    }
    if (def.slam) {
      g.vfx.groundSlam(p.position, def.slam, g.abilities.bloodGod ? [1, 0.1, 0.05] : [1, 0.45, 0.15]);
      g.audio.play('slam', { vol: 0.9 }); g.audio.play('explosion', { vol: 0.35, rate: 1.3 });
      g.cam.addTrauma(0.55);
    }
    if (!victims.length) { if (!def.slam) g.audio.play('blade', { vol: 0.15 }); return; }
    let anyKill = false, anyHit = false;
    for (const e of victims) {
      const res = this.applyDamage(e, def, { takedown: a.opts.takedown });
      if (res.hit) anyHit = true; if (res.killed) anyKill = true;
    }
    if (anyHit) {
      const bg = g.abilities.bloodGod;
      g.time.hitstop(def.stop * (anyKill ? 1.6 : 1) * (bg ? 1.2 : 1));
      g.cam.addTrauma(def.heavyFx ? 0.42 : 0.2);
      if (def.heavyFx) g.cam.kickFov(3);
    }
    if (def.launch && victims[0] && victims[0].alive) {
      // follow the launched enemy into the air
      p.vy = 12.5; p.grounded = false; p.position.y += 0.05; this.airHang = 1.4;
      p.anim.play('Jump_Full_Short', { fade: 0.1, once: true, timeScale: 1.1 });
      this.atk.endT = Math.min(this.atk.endT, this.atk.t + 0.1);
      this.game.ui.flash('LAUNCH!', 'gold');
    }
    if (def.juggle) { p.vy = Math.max(p.vy, 2.2); this.airHang = Math.max(this.airHang, 0.6); }
  }

  // Shared damage path for melee strikes.
  applyDamage(e, def, { takedown = false, forceKill = false, dirOverride = null } = {}) {
    const g = this.game, p = this.player;
    const bg = g.abilities.bloodGod;
    let dmg = def.dmg * (bg ? 2 : 1) * (1 + Math.min(0.5, this.combo * 0.015));
    let crit = false;
    if (this.critCharges > 0) { crit = true; this.critCharges--; dmg *= 2.5; g.ui.abilityUsed('crit', this.critCharges); }
    else if (this.dodgeCounter > 0) { crit = true; this.dodgeCounter = 0; dmg *= 2; }
    else if (Math.random() < 0.08) { crit = true; dmg *= 1.6; }
    if (forceKill) dmg = 99999;
    const dir = dirOverride ?? tmpB.set(e.position.x - p.position.x, 0, e.position.z - p.position.z).normalize();
    const res = e.receiveHit({
      dmg, dir: dir.clone(), kb: def.kb, heavy: !!def.heavyFx, guardBreak: !!def.guardBreak || bg, stagger: def.stagger ?? 1,
      launch: def.launch ?? 0, juggle: !!def.juggle, slamDown: takedown, execution: !!def.execution || forceKill, crit, source: 'melee',
    });
    if (!res.hit) {
      if (res.blocked) { g.audio.play('clash', { vol: 0.8 }); g.vfx.hitSparks(e.chestPos(), dir.clone().negate(), { color: [0.7, 0.8, 1], blood: false }); g.ui.flash('BLOCKED', 'grey'); this.chainIndex = 0; }
      return res;
    }
    const hp = e.chestPos();
    g.vfx.hitSparks(hp, dir, { heavy: !!def.heavyFx || crit, color: crit ? [1, 0.85, 0.2] : bg ? [1, 0.2, 0.1] : [1, 0.7, 0.4], blood: true });
    g.vfx.slash(hp, Math.atan2(dir.x, dir.z) + Math.PI / 2, { scale: def.heavyFx ? 4.4 : 3.4, tilt: def.decalTilt ?? 0, color: bg ? [1, 0.25, 0.2] : crit ? [1, 0.85, 0.4] : [1, 0.9, 0.8] });
    if (e.bony) g.vfx.boneBurst(hp);
    g.audio.play('swordHit', { vol: 0.7 });
    g.audio.play(e.bony ? 'boneHit' : 'fleshHit', { vol: 0.6 });
    if (def.heavyFx) g.audio.play('metalHeavy', { vol: 0.35, rate: 0.8 });
    g.ui.damageNumber(hp, Math.round(Math.min(res.dealt ?? dmg, 9999)), crit);
    this.addCombo(1);
    g.abilities.addMeter(res.killed ? 8 : 2.2);
    g.addScore(Math.round((res.dealt ?? dmg) * this.multiplier));
    if (res.killed) g.onKill(e, { execution: !!def.execution || forceKill });
    return res;
  }

  // ------------------------------------------------------------------ charge
  beginCharge() {
    const p = this.player, g = this.game;
    if (this.charging) return;
    this.atk = null; this.charging = true; this.charge = 0;
    p.setState('charge');
    p.anim.play('2H_Melee_Idle', { fade: 0.1, timeScale: 0.4 });
    g.weapon.setGlow(0.2);
    g.audio.play('chain', { vol: 0.4 });
  }
  updateCharge(dt) {
    const g = this.game, p = this.player;
    this.charge = Math.min(1, this.charge + dt / 0.75);
    g.weapon.setGlow(0.2 + this.charge * 1.4);
    const tip = g.weapon.tipWorld(V());
    if (Math.random() < 0.6) g.vfx.sys.magic.emit(tip, { count: 1, speed: 1.2, life: 0.35, size: 0.6 + this.charge, color: this.charge >= 1 ? [1, 0.25, 0.1] : [1, 0.6, 0.3], sizeEnd: 0 });
    if (this.charge >= 1 && !this.chargeFull) { this.chargeFull = true; g.audio.play('spell', { vol: 0.6 }); g.vfx.ring(p.position, 2.5, [1, 0.3, 0.1], 0.3); }
    const t = this.selectTarget({ range: 6 });
    if (t) p.faceTowards(t.position.x, t.position.z, 8, dt);
    if (!g.input.mouse.left) {
      this.charging = false; g.weapon.setGlow(0);
      const full = this.charge >= 1; this.chargeFull = false;
      g.input.take('attack');
      this.startAttack(full ? MOVES.charged : MOVES.chargedStab, this.selectTarget({ range: full ? 6 : 9 }));
    }
  }

  // ------------------------------------------------------------------ dodge
  dodge() {
    const g = this.game, p = this.player;
    this.endAttack(); this.charging = false; g.weapon.setGlow(0);
    const mv = p.moveInput.lengthSq() > 0.01 ? p.moveInput.clone() : p.facing(V()).negate();
    this.dodgeDir.copy(mv).normalize();
    // pick directional animation relative to facing (keep facing in combat for readability)
    const f = p.facing(V());
    const fwd = this.dodgeDir.dot(f); const side = this.dodgeDir.x * f.z - this.dodgeDir.z * f.x; // +: left of facing
    let anim;
    if (Math.abs(fwd) >= Math.abs(side)) anim = fwd > 0 ? 'Dodge_Forward' : 'Dodge_Backward';
    else anim = side > 0 ? 'Dodge_Left' : 'Dodge_Right';
    if (!this.inCombat && fwd > 0.2) { p.yaw = Math.atan2(this.dodgeDir.x, this.dodgeDir.z); anim = 'Dodge_Forward'; }
    p.setState('dodge');
    p.anim.play(anim, { fade: 0.05, once: true, restart: true, timeScale: 1.55 });
    this.dodgeT = 0; this.iframes = 0.34;
    g.audio.play('dodge', { vol: 0.6 });
    g.vfx.dust(p.position, 5, 1.6);
    // Perfect dodge: an attack was about to connect.
    const threat = g.enemies.impactImminent(p, 0.3);
    if (threat) {
      g.time.slowmo(0.28, 0.55);
      g.ui.flash('PERFECT DODGE', 'gold');
      g.audio.play('spell', { vol: 0.5, rate: 1.4 });
      this.dodgeCounter = 1.3;
      g.abilities.addMeter(8);
      g.addScore(150 * this.multiplier);
      this.addCombo(1);
      threat.onPerfectDodged?.();
    }
  }
  updateDodge(dt) {
    const p = this.player, g = this.game;
    this.dodgeT += dt;
    const T = 0.42;
    const k = Math.min(1, this.dodgeT / T);
    const speed = 15 * (1 - k * k);
    p.velocity.copy(this.dodgeDir).multiplyScalar(speed);
    if (this.dodgeT >= T) { p.setState('idle'); p.velocity.multiplyScalar(0.3); }
    // dodge -> counter transition happens via buffered F in update()
    if (this.dodgeT > 0.2 && g.input.peek('attack') && this.dodgeCounter > 0) { p.setState('idle'); }
  }

  // ------------------------------------------------------------------ counter
  tryCounter() {
    const g = this.game, p = this.player;
    this.endAttack(); this.charging = false; g.weapon.setGlow(0);
    // Reflect incoming projectiles first.
    const proj = g.projectiles.incoming(p, 4.5);
    const threats = g.enemies.counterableThreats(p, 9);
    if (!threats.length && !proj.length) {
      // whiffed counter: brief vulnerable guard (discourages spamming)
      p.setState('block'); p.anim.play('Block', { fade: 0.05, once: true, restart: true, timeScale: 1.6 });
      this.whiff = 0.4; g.audio.play('blade', { vol: 0.2 });
      return;
    }
    if (proj.length && !threats.length) {
      p.setState('block'); p.anim.play('Block', { fade: 0.04, once: true, restart: true, timeScale: 1.8 });
      for (const pr of proj) { g.projectiles.reflect(pr); }
      g.audio.play('clash', { vol: 0.9 }); g.time.hitstop(0.06); g.ui.flash('DEFLECTED!', 'gold');
      this.addCombo(1); g.abilities.addMeter(5); g.addScore(120 * this.multiplier);
      return;
    }
    const primary = threats[0];
    const heavy = primary.currentAttack?.kind === 'heavy';
    // warp next to the primary attacker
    const dx = p.position.x - primary.position.x, dz = p.position.z - primary.position.z; const d = Math.hypot(dx, dz) || 1;
    const stand = primary.radius + 1.3;
    this.counterWarp = { from: p.position.clone(), to: new THREE.Vector3(primary.position.x + dx / d * stand, p.position.y, primary.position.z + dz / d * stand), t: 0 };
    p.setState('counter');
    p.anim.play(heavy ? '2H_Melee_Attack_Stab' : 'Block_Attack', { fade: 0.04, once: true, restart: true, timeScale: heavy ? 1.5 : 1.7 });
    this.counterTargets = threats.slice(0, 4);
    this.counterHeavy = heavy;
    this.counterHitDone = false;
    this.iframes = 0.5;
    g.audio.play('clash', { vol: 1 }); g.audio.play('metalHeavy', { vol: 0.5 });
    g.vfx.hitSparks(primary.chestPos(), new THREE.Vector3(dx / d, 0, dz / d), { heavy: true, color: [0.75, 0.85, 1], blood: false });
    g.time.hitstop(0.07); g.time.slowmo(0.35, 0.3);
    if (threats.length > 1) g.ui.flash(`${threats.length}x COUNTER`, 'gold'); else g.ui.flash(heavy ? 'HEAVY COUNTER' : 'COUNTER', 'white');
    for (const t of this.counterTargets) t.interruptByCounter();
    // counterattack execution once the flow is high
    this.counterExecute = this.combo >= 12 && !primary.boss && !primary.elite;
  }
  updateCounter(dt) {
    const g = this.game, p = this.player;
    const w = this.counterWarp;
    if (w && w.t < 1) { w.t = Math.min(1, w.t + dt / 0.09); p.position.lerpVectors(w.from, w.to, w.t); }
    const primary = this.counterTargets?.[0];
    if (primary) p.faceTowards(primary.position.x, primary.position.z, 30, dt);
    if (!this.counterHitDone && p.stateTime > 0.16) {
      this.counterHitDone = true;
      for (const t of this.counterTargets) {
        if (!t.alive) continue;
        const def = { dmg: this.counterHeavy ? 30 : 16, kb: this.counterHeavy ? 6 : 3.5, heavyFx: true, stagger: this.counterHeavy ? 3 : 2, decalTilt: 0.5, guardBreak: true };
        const kill = this.counterExecute && t === primary;
        if (kill) { g.cam.startCinematic(t.position, p.yaw, { duration: 0.9, side: Math.random() < 0.5 ? -1 : 1, dist: 4.5 }); g.ui.flash('COUNTER EXECUTION', 'red'); }
        this.applyDamage(t, def, { forceKill: kill });
      }
      g.abilities.addMeter(6);
      g.addScore(100 * this.counterTargets.length * this.multiplier);
    }
    if (p.stateTime > 0.5) { p.setState('idle'); this.counterTargets = null; }
  }

  // ------------------------------------------------------------------ finishers
  groundFinisher(target) {
    const g = this.game;
    const p = this.player;
    p.setState('finisher');
    g.cam.startCinematic(target.position, p.yaw, { duration: 1.1, side: 1, dist: 4.2, height: 2.4 });
    g.ui.flash('EXECUTION', 'red');
    this.seq = { targets: [target], idx: 0, phase: 'go', t: 0, kind: 'ground' };
  }

  tryFinisher() {
    const g = this.game, p = this.player;
    if (this.combo < this.finisherReadyAt) { g.ui.flash(`FINISHER NEEDS ${this.finisherReadyAt}x COMBO`, 'grey'); g.audio.play('uiError', { vol: 0.4 }); return; }
    const cands = g.enemies.list.filter(e => e.targetable && e.position.distanceTo(p.position) < 13 &&
      !g.world.segmentBlocked(p.position.x, p.position.z, e.position.x, e.position.z, 1.2))
      .sort((a, b) => a.position.distanceTo(p.position) - b.position.distanceTo(p.position));
    if (!cands.length) return;
    const tier = this.combo >= 15 ? 3 : this.combo >= 10 ? 2 : 1;
    const targets = cands.slice(0, tier);
    this.combo = Math.max(0, this.combo - this.finisherReadyAt * targets.length);
    g.ui.combo(this.combo);
    p.setState('finisher');
    g.ui.flash(targets.length > 1 ? `${targets.length}x TAKEDOWN` : 'TAKEDOWN', 'red');
    g.audio.play('roar', { vol: 0.3, rate: 0.7 });
    this.seq = { targets, idx: 0, phase: 'go', t: 0, kind: 'finisher' };
  }

  // Multi-enemy dash sequence (ability 3) reuses the sequence runner.
  startWhirlwind(targets) {
    const p = this.player;
    p.setState('finisher');
    this.seq = { targets, idx: 0, phase: 'go', t: 0, kind: 'whirl' };
  }

  finisherAnimFor(e, kind) {
    if (kind === 'ground') return { anim: '2H_Melee_Attack_Chop', ts: 1.0 };
    if (kind === 'whirl') return { anim: ['2H_Melee_Attack_Slice', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal'][this.seq.idx % 3], ts: 1.9 };
    if (e.airborne) return { anim: '1H_Melee_Attack_Jump_Chop', ts: 1.3 };       // aerial takedown
    if (e.heavyType || e.boss) return { anim: '1H_Melee_Attack_Jump_Chop', ts: 1.1 }; // jumping execution
    if (e.fast) return { anim: '2H_Melee_Attack_Stab', ts: 1.3 };
    return { anim: ['2H_Melee_Attack_Slice', '2H_Melee_Attack_Spin', '1H_Melee_Attack_Stab'][(Math.random() * 3) | 0], ts: 1.2 };
  }

  updateSequence(dt) {
    const g = this.game, p = this.player, s = this.seq;
    s.t += dt;
    const target = s.targets[s.idx];
    if (!target || (!target.alive && s.phase === 'go')) { return this.nextInSequence(); }
    if (s.phase === 'go') {
      // dash to the target
      const fa = this.finisherAnimFor(target, s.kind);
      s.anim = fa;
      s.from = p.position.clone();
      const dx = p.position.x - target.position.x, dz = p.position.z - target.position.z; const d = Math.hypot(dx, dz) || 1;
      const stand = target.radius + 1.5;
      s.to = new THREE.Vector3(target.position.x + dx / d * stand, 0, target.position.z + dz / d * stand);
      g.world.resolve(s.to, p.radius, 0);
      s.phase = 'dash'; s.t = 0;
      target.holdForFinisher?.(1.6);
      if (s.kind !== 'whirl' || s.idx === 0) g.cam.startCinematic(target.position, Math.atan2(-dx, -dz), { duration: s.kind === 'whirl' ? 0.6 * s.targets.length + 0.4 : 1.15, side: s.idx % 2 ? -1 : 1, dist: s.kind === 'whirl' ? 7 : 4.6, height: 2.2, orbit: 0.8 });
      g.audio.play('dodge', { vol: 0.5 });
    }
    if (s.phase === 'dash') {
      const k = Math.min(1, s.t / (s.kind === 'whirl' ? 0.1 : 0.14));
      p.position.lerpVectors(s.from, s.to, k);
      p.faceTowards(target.position.x, target.position.z, Infinity, dt);
      if (k >= 1) {
        s.phase = 'strike'; s.t = 0;
        p.anim.play(s.anim.anim, { fade: 0.05, once: true, restart: true, timeScale: s.anim.ts });
        s.dur = p.anim.duration(s.anim.anim) / s.anim.ts;
        s.imp = (this.impacts[s.anim.anim] ?? 0.45) * s.dur;
        s.hit = false;
        g.weapon.trail(true, true);
        g.audio.play('swing', { vol: 0.7, rate: 0.85 });
        if (s.anim.anim === '1H_Melee_Attack_Jump_Chop') { p.vy = 7; p.grounded = false; }
        if (s.kind !== 'whirl') g.time.slowmo(0.45, Math.min(0.9, s.imp + 0.1));
      }
    }
    if (s.phase === 'strike') {
      p.faceTowards(target.position.x, target.position.z, 20, dt);
      if (!s.hit && s.t >= s.imp) {
        s.hit = true;
        if (s.kind === 'whirl') {
          this.applyDamage(target, { dmg: 26, kb: 4, heavyFx: true, stagger: 2, decalTilt: 0.3 });
        } else if (target.boss) {
          this.applyDamage(target, { dmg: target.maxHp * 0.12, kb: 2, heavyFx: true, stagger: 3, decalTilt: 1.4, guardBreak: true });
        } else {
          this.applyDamage(target, { dmg: 9999, kb: 6, heavyFx: true, decalTilt: 1.4, execution: true }, { forceKill: true });
        }
        g.time.hitstop(0.13);
        g.cam.addTrauma(0.6);
        g.vfx.groundSlam(target.position, 3, [1, 0.15, 0.1]);
        g.audio.play('slam', { vol: 0.7 });
        g.addScore(500 * this.multiplier);
      }
      if (s.t >= Math.max(s.imp + 0.12, s.dur * (s.kind === 'whirl' ? 0.55 : 0.85))) this.nextInSequence();
    }
  }

  nextInSequence() {
    const s = this.seq, p = this.player, g = this.game;
    s.idx++; s.phase = 'go'; s.t = 0;
    if (s.idx >= s.targets.length) {
      this.seq = null; g.weapon.trail(false);
      p.setState('idle'); this.iframes = 0.4;
      if (g.cam.mode === 'cinematic') g.cam.endCinematic();
    }
  }
}
