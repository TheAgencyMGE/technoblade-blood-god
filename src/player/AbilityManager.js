// AbilityManager — the Blood God ultimate (charged by hits, counters, kills, perfect dodges)
// plus four cooldown abilities: Critical Strike, Sword Slam, Whirlwind (multi-enemy),
// Precision Shot.
import * as THREE from 'three';

export const ABILITIES = {
  crit: { key: 'ab1', name: 'Critical Strike', cd: 12, icon: 'dripping-blade' },
  slam: { key: 'ab2', name: 'Sword Slam', cd: 10, icon: 'hammer-drop' },
  whirl: { key: 'ab3', name: 'Whirlwind', cd: 16, icon: 'spinning-sword' },
  shot: { key: 'ab4', name: 'Precision Shot', cd: 8, icon: 'high-shot' },
};

export class AbilityManager {
  constructor(game) {
    this.game = game;
    this.meter = 0; this.bloodGod = false; this.bgTime = 0; this.bgDuration = 16;
    this.activating = false; this.actT = 0;
    this.cd = { crit: 0, slam: 0, whirl: 0, shot: 0 };
    this.slamState = null;
    this.auraT = 0;
  }

  reset() { this.meter = 0; this.bloodGod = false; this.activating = false; for (const k in this.cd) this.cd[k] = 0; this.slamState = null; this.applyBloodGod(false); }

  addMeter(n) { if (this.bloodGod) return; this.meter = Math.min(100, this.meter + n); if (this.meter >= 100 && !this.readyAnnounced) { this.readyAnnounced = true; this.game.ui.flash('BLOOD GOD READY — PRESS Q', 'red', 1.6); this.game.audio.play('gong', { vol: 0.35, rate: 1.3 }); } }

  update(dt) {
    const g = this.game, p = g.player, input = g.input;
    for (const k in this.cd) if (this.cd[k] > 0) this.cd[k] = Math.max(0, this.cd[k] - dt);

    if (this.activating) {
      this.actT += dt;
      if (this.actT > 0.55 && !this.burst) {
        this.burst = true;
        g.vfx.groundSlam(p.position, 8, [1, 0.05, 0.05]);
        g.vfx.ring(p.position, 12, [1, 0.1, 0.05], 0.8);
        g.cam.addTrauma(0.9);
        g.audio.play('thunder', { vol: 1 }); g.audio.play('roar', { vol: 0.6, rate: 0.6 }); g.audio.play('explosion', { vol: 0.6, rate: 0.7 });
        // shockwave knocks nearby enemies down
        for (const e of g.enemies.list) {
          if (!e.hittable) continue;
          const d = e.position.distanceTo(p.position);
          if (d < 9) e.receiveHit({ dmg: 25, dir: e.position.clone().sub(p.position).setY(0).normalize(), kb: 10, heavy: true, stagger: 3, guardBreak: true, source: 'ability' });
        }
      }
      if (this.actT > 1.3) { this.activating = false; this.burst = false; p.setState('idle'); g.cam.endCinematic(); }
    }

    if (this.bloodGod) {
      this.bgTime -= dt;
      this.meter = Math.max(0, (this.bgTime / this.bgDuration) * 100);
      this.auraT -= dt;
      if (this.auraT <= 0) {
        this.auraT = 0.03;
        const pos = new THREE.Vector3(p.position.x + (Math.random() - 0.5) * 1.4, p.position.y + Math.random() * 2.6, p.position.z + (Math.random() - 0.5) * 1.4);
        g.vfx.sys.fire.emit(pos, { count: 1, speed: 0.6, up: 2, life: 0.55, size: 1.2, sizeEnd: 0.1, color: [1, 0.08, 0.04], drag: 1 });
        if (Math.random() < 0.3) g.vfx.sys.ember.emit(pos, { count: 1, speed: 1.5, up: 1.6, life: 1, size: 0.3, color: [1, 0.15, 0.1], gravity: -1 });
      }
      if (this.bgTime <= 0) this.endBloodGod();
    }

    if (this.slamState) this.updateSlam(dt);

    // Mode 2: F = special (Blood God), no movement lock / cinematic; no Arkham ability keys.
    if (g.mode === 'parkour') {
      if (!p.alive) return;
      if (input.take('special')) {
        if (this.meter >= 100 && !this.bloodGod) this.activateBloodGodParkour();
        else if (!this.bloodGod) { g.ui.flash('BLOOD GOD NOT READY', 'grey'); g.audio.play('uiError', { vol: 0.35 }); }
      }
      return;
    }

    if (!p.alive || g.combat.seq || this.activating) return;
    const free = p.is('idle', 'move', 'land') || (p.state === 'attack' && g.combat.atk && g.combat.atk.t >= g.combat.atk.cancelT);
    if (input.take('ultimate')) {
      if (this.meter >= 100 && !this.bloodGod && free) this.activateBloodGod();
      else if (!this.bloodGod) { g.ui.flash('BLOOD GOD NOT READY', 'grey'); g.audio.play('uiError', { vol: 0.35 }); }
    }
    if (!free) return;
    if (input.take('ab1')) this.useCrit();
    if (input.take('ab2')) this.useSlam();
    if (input.take('ab3')) this.useWhirl();
    if (input.take('ab4')) this.useShot();
  }

  ready(k) { if (this.cd[k] > 0) { this.game.ui.flash(`${ABILITIES[k].name.toUpperCase()} ON COOLDOWN`, 'grey', 0.6); this.game.audio.play('uiError', { vol: 0.3 }); return false; } return true; }

  activateBloodGod() {
    const g = this.game, p = g.player;
    g.combat.endAttack();
    this.readyAnnounced = false;
    this.activating = true; this.actT = 0; this.burst = false;
    this.bloodGod = true; this.bgTime = this.bgDuration;
    p.setState('finisher');
    p.anim.play('Spellcast_Raise', { fade: 0.1, once: true, restart: true, timeScale: 1.2 });
    g.cam.startCinematic(p.position, p.yaw + Math.PI, { duration: 1.3, side: 0.6, dist: 5.5, height: 1.4, orbit: 0.5 });
    g.time.slowmo(0.5, 0.9);
    g.ui.bloodGod(true);
    g.audio.play('fire', { vol: 0.8 }); g.audio.play('gong', { vol: 0.6, rate: 0.7 });
    this.applyBloodGod(true);
  }

  activateBloodGodParkour() {
    const g = this.game, p = g.player, pm = g.parkour;
    this.readyAnnounced = false;
    this.bloodGod = true; this.bgTime = this.bgDuration;
    p.anim.playUpper('Spellcast_Raise', { timeScale: 1.6 });
    g.time.slowmo(0.4, 0.6);
    g.ui.bloodGod(true);
    g.audio.play('thunder', { vol: 1 }); g.audio.play('roar', { vol: 0.6, rate: 0.6 }); g.audio.play('gong', { vol: 0.6, rate: 0.7 });
    pm.fpCam.addShake(0.8); pm.tpCam.addShake(0.8);
    pm.combat.shockwave(p.position.clone(), 8, 1.2, 'bloodgod');
    this.applyBloodGod(true);
  }

  applyBloodGod(on) {
    const g = this.game, p = g.player;
    p.damageTakenMult = on ? 0.4 : 1;
    p.speedMult = on ? 1.18 : 1;
    g.post?.setBloodGod(on);
    g.audio.setMusicRate(on ? 1.06 : 1);
    if (g.player?.hero) {
      g.player.hero.crown.traverse(o => { if (o.isMesh) { o.material.emissive = o.material.emissive || new THREE.Color(); o.material.emissive.setRGB(on ? 0.9 : 0, on ? 0.15 : 0, on ? 0.05 : 0); } });
      g.player.hero.pigHead.material.emissive = g.player.hero.pigHead.material.emissive || new THREE.Color();
      g.player.hero.pigHead.material.emissive.setRGB(on ? 0.35 : 0, 0, 0);
    }
    g.bloodLight.intensity = on ? 40 : 0;
  }

  endBloodGod() {
    this.bloodGod = false; this.meter = 0; this.applyBloodGod(false);
    this.game.ui.bloodGod(false);
    this.game.ui.flash('BLOOD GOD FADES', 'grey');
  }

  useCrit() {
    if (!this.ready('crit')) return;
    const g = this.game, p = g.player;
    this.cd.crit = ABILITIES.crit.cd;
    g.combat.endAttack();
    g.combat.critCharges = 3;
    p.setState('block');
    p.anim.play('Use_Item', { fade: 0.06, once: true, restart: true, timeScale: 2.2 });
    g.weapon.setGlow(1.5); setTimeout(() => g.weapon.setGlow(0), 600);
    g.vfx.sys.star.emit(g.weapon.tipWorld(new THREE.Vector3()), { count: 10, speed: 3, life: 0.5, size: 1, color: [1, 0.85, 0.3] });
    g.audio.play('spell', { vol: 0.7, rate: 1.2 });
    g.ui.flash('CRITICAL STRIKE x3', 'gold'); g.ui.abilityUsed('crit', 3);
  }

  useSlam() {
    if (!this.ready('slam')) return;
    const g = this.game, p = g.player;
    this.cd.slam = ABILITIES.slam.cd;
    g.combat.endAttack();
    const t = g.combat.selectTarget({ range: 10 });
    p.setState('finisher');
    p.anim.play('1H_Melee_Attack_Jump_Chop', { fade: 0.06, once: true, restart: true, timeScale: 1.25 });
    const dur = p.anim.duration('1H_Melee_Attack_Jump_Chop') / 1.25;
    const imp = (g.combat.impacts['1H_Melee_Attack_Jump_Chop'] ?? 0.5) * dur;
    p.vy = 9; p.grounded = false;
    const to = t ? t.position.clone().add(p.position.clone().sub(t.position).setY(0).normalize().multiplyScalar(t.radius + 1.4)) : p.position.clone().add(p.facing(new THREE.Vector3()).multiplyScalar(3));
    this.slamState = { t: 0, imp, dur, from: p.position.clone(), to, hit: false };
    g.weapon.trail(true, true);
    g.audio.play('swing', { vol: 0.8, rate: 0.7 });
  }
  updateSlam(dt) {
    const g = this.game, p = g.player, s = this.slamState;
    s.t += dt;
    const k = Math.min(1, s.t / s.imp);
    p.position.x = s.from.x + (s.to.x - s.from.x) * k; p.position.z = s.from.z + (s.to.z - s.from.z) * k;
    if (s.t > s.imp * 0.5) p.vy = Math.min(p.vy, -20);
    if (!s.hit && s.t >= s.imp) {
      s.hit = true;
      p.position.y = 0; p.vy = 0; p.grounded = true;
      g.vfx.groundSlam(p.position, 6.5, this.bloodGod ? [1, 0.05, 0.05] : [1, 0.5, 0.15]);
      g.audio.play('slam', { vol: 1 }); g.audio.play('explosion', { vol: 0.6 });
      g.cam.addTrauma(0.8); g.time.hitstop(0.12);
      for (const e of g.enemies.list) {
        if (!e.hittable) continue;
        const d = Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z);
        if (d < 6.5 + e.radius && !g.world.segmentBlocked(p.position.x, p.position.z, e.position.x, e.position.z, 1)) {
          g.combat.applyDamage(e, { dmg: 40 * (1 - d / 10), kb: 9, heavyFx: true, stagger: 3, guardBreak: true, decalTilt: 1.5 }, {});
          if (e.alive && !e.boss) e.knockDown?.(1.4);
        }
      }
    }
    if (s.t >= s.dur * 0.85) { this.slamState = null; g.weapon.trail(false); if (p.state === 'finisher') p.setState('idle'); }
  }

  useWhirl() {
    const g = this.game, p = g.player;
    const targets = g.enemies.list.filter(e => e.targetable && e.position.distanceTo(p.position) < 14 && !g.world.segmentBlocked(p.position.x, p.position.z, e.position.x, e.position.z, 1.2))
      .sort((a, b) => a.position.distanceTo(p.position) - b.position.distanceTo(p.position)).slice(0, 5);
    if (!targets.length) { g.ui.flash('NO TARGETS IN RANGE', 'grey'); return; }
    if (!this.ready('whirl')) return;
    this.cd.whirl = ABILITIES.whirl.cd;
    g.combat.endAttack();
    g.ui.flash(`WHIRLWIND x${targets.length}`, 'red');
    g.audio.play('fire', { vol: 0.6 });
    g.time.slowmo(0.55, 0.3 + targets.length * 0.45);
    g.combat.startWhirlwind(targets);
  }

  useShot() {
    const g = this.game, p = g.player;
    if (g.bow.ammo <= 0) { g.ui.flash('NO ARROWS', 'grey'); return; }
    if (!this.ready('shot')) return;
    this.cd.shot = ABILITIES.shot.cd;
    g.combat.endAttack();
    const t = g.combat.lockTarget || g.combat.selectTarget({ range: 40 }) || g.enemies.nearestVisible(p.position, 40);
    if (t) p.faceTowards(t.position.x, t.position.z, Infinity, 0);
    g.weapon.showBow(true);
    p.setState('block');
    setTimeout(() => { g.bow.fire(1, { precision: true, target: t }); setTimeout(() => { if (!g.bow.aiming) g.weapon.showBow(false); }, 350); }, 120);
    p.anim.play('Blocking', { fade: 0.05, once: true, restart: true, timeScale: 2 });
    g.time.slowmo(0.4, 0.35);
    g.ui.flash('PRECISION SHOT', 'gold');
  }
}
