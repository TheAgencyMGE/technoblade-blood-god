// EnemyAI — one monster: perception, steering (direct seek when there is line of sight,
// flow-field pathfinding otherwise, separation, ring slots around the player), telegraphed
// attacks gated by the AttackDirector's tokens, hit reactions, stagger/poise, knockback,
// launch/juggle, knockdown + get-up, blocking (shield elites), death and despawn.
import * as THREE from 'three';
import { Animator } from '../core/Animator.js';
import { angleDiff } from '../player/PlayerController.js';

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
let NEXT_ID = 1;

export class Enemy {
  constructor(game, type, def, opts = {}) {
    this.game = game; this.type = type; this.def = def; this.id = NEXT_ID++;
    const am = game.assets;
    this.root = am.cloneCharacter(def.model);
    const norm = game.enemies.modelScale(def.model, def.height);
    this.scale = norm * (opts.scaleMult ?? 1);
    this.root.scale.setScalar(this.scale);
    for (const w of def.weapons ?? []) am.attachProp(this.root, w.key, w.bone);
    // Subtle hue for variants: tint the albedo slightly (keeps the texture readable).
    if (def.tint) this.root.traverse(o => { if (o.isMesh) o.material.color.setRGB(0.78 + def.tint[0] * 0.6, 0.78 + def.tint[1] * 0.6, 0.78 + def.tint[2] * 0.6); });
    // Quaternius monsters are flat-coloured and read too dark at night: lift them a little.
    if (def.rig !== 'kaykit') this.root.traverse(o => {
      if (!o.isMesh) return;
      const m = o.material;
      if (m.map) { m.emissiveMap = m.map; m.emissive = new THREE.Color(0.3, 0.3, 0.3); } // lift using its own texture
      else m.emissive = m.color.clone().multiplyScalar(0.35);
      m.emissiveIntensity = 1;
    });
    this.baseEmissive = [];
    this.root.traverse(o => { if (o.isMesh) this.baseEmissive.push([o.material, (o.material.emissive || new THREE.Color()).clone(), o.material.emissiveIntensity ?? 1]); });
    game.scene.add(this.root);
    this.anim = new Animator(this.root, am.clips[def.rig] ?? am.clips.kaykit);
    this.A = def.anims;

    this.position = this.root.position;
    this.velocity = new THREE.Vector3(); this.vy = 0;
    this.yaw = 0;
    this.radius = def.radius * (opts.scaleMult ?? 1);
    this.height = def.height * (opts.scaleMult ?? 1);
    this.maxHp = def.hp * (opts.hpMult ?? 1); this.hp = this.maxHp;
    this.dmgMult = opts.dmgMult ?? 1;
    this.aggr = opts.aggr ?? 0; // 0..1 scales telegraph/cooldowns
    this.speed = def.speed * (1 + this.aggr * 0.15) * (opts.speedMult ?? 1);
    this.runSpeed = def.runSpeed * (1 + this.aggr * 0.15) * (opts.speedMult ?? 1);
    this.boss = !!def.boss; this.elite = !!def.elite; this.heavyType = !!def.heavyType; this.fast = !!def.fast;
    this.bony = !!def.bony; this.ranged = !!def.ranged;
    this.poiseMax = def.poise ?? 0; this.poise = this.poiseMax;
    this.alive = true; this.state = 'idle'; this.stateTime = 0;
    this.cooldowns = def.attacks.map(() => 0.5 + Math.random() * 1.5);
    this.globalCd = 0.8 + Math.random();
    this.currentAttack = null;
    this.hasToken = false;
    this.slotAngle = Math.random() * Math.PI * 2;
    this.ringR = 5.5 + Math.random() * 2.5;
    this.flash = 0;
    this.stuckT = 0; this.forceFlow = 0; this.lastPos = new THREE.Vector3();
    this.repathT = 0;
    this.deadT = 0;
    this.holdT = 0;
    this.airborne = false;
    this.headBone = am.findBone(this.root, def.rig === 'kaykit' ? 'head' : 'Head');
    this.chestBone = am.findBone(this.root, def.rig === 'kaykit' ? 'chest' : 'Torso') || this.headBone;
    this.weak = (def.weakPoints ?? []).map(w => ({ ...w, boneObj: am.findBone(this.root, w.bone) }));
    this.phase = 1;
    this.summonT = 12;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = 0;
  }

  // --------------------------------------------------------------- queries
  get targetable() { return this.alive && this.state !== 'spawning'; }
  get hittable() { return this.alive && this.state !== 'spawning'; }
  // head bone sits at the neck: lift to the centre of the skull
  headPos(out = new THREE.Vector3()) { if (this.headBone) { this.headBone.getWorldPosition(out); out.y += this.height * (this.def.rig === 'kaykit' ? 0.24 : 0.1); return out; } return out.set(this.position.x, this.position.y + this.height * 0.85, this.position.z); }
  chestPos(out = new THREE.Vector3()) { if (this.chestBone) { this.chestBone.getWorldPosition(out); out.y = Math.max(out.y, this.position.y + this.height * 0.35); return out; } return out.set(this.position.x, this.position.y + this.height * 0.55, this.position.z); }
  facing(out = tmp) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  distTo(p) { return Math.hypot(p.x - this.position.x, p.z - this.position.z); }

  // Threat info used by counters / perfect dodge.
  threat() {
    if (!this.currentAttack || !['telegraph', 'windup'].includes(this.state)) return null;
    const a = this.currentAttack;
    const impactIn = this.state === 'telegraph' ? (a.teleT - this.stateTime) + a.impactT : a.impactT - this.stateTime;
    return { kind: a.kind, impactIn, counterable: a.kind !== 'unblockable' && a.kind !== 'ranged' };
  }

  setState(s) { this.state = s; this.stateTime = 0; }

  // --------------------------------------------------------------- spawn
  spawnAt(pos, { rise = true, yaw = 0 } = {}) {
    this.position.copy(pos); this.yaw = yaw; this.root.rotation.y = yaw;
    if (rise && this.A.spawn && this.anim.has(this.A.spawn)) {
      this.setState('spawning');
      this.anim.play(this.A.spawn, { fade: 0, once: true });
      this.spawnDur = this.anim.duration(this.A.spawn) * 0.95;
      this.game.vfx.dust(pos, 12, 2.4);
      this.game.vfx.sys.dirt.emit(pos, { count: 16, speed: 4, up: 1, life: 0.8, size: 0.8, color: [0.45, 0.4, 0.35], gravity: 12, radius: 0.6 });
      this.game.audio.play('slam', { vol: 0.25, rate: 1.4, minGap: 0.1 });
    } else {
      this.setState('approach');
      this.anim.play(this.A.idle, { fade: 0 });
    }
    if (this.boss) { this.setState('intro'); this.anim.play(this.A.taunt || this.A.idle, { fade: 0, once: true }); }
  }

  // --------------------------------------------------------------- update
  update(dt) {
    const g = this.game, p = g.player;
    this.stateTime += dt;
    if (this.flash > 0) { this.flash -= dt; this.applyFlash(Math.max(0, this.flash) / 0.12); }
    for (let i = 0; i < this.cooldowns.length; i++) if (this.cooldowns[i] > 0) this.cooldowns[i] -= dt;
    if (this.globalCd > 0) this.globalCd -= dt;
    if (this.holdT > 0) { this.holdT -= dt; this.anim.update(dt * 0.25); this.root.rotation.y = this.yaw; return; }

    const toP = tmp.set(p.position.x - this.position.x, 0, p.position.z - this.position.z);
    const dist = toP.length();
    const wantYaw = Math.atan2(toP.x, toP.z);

    switch (this.state) {
      case 'spawning':
        if (this.stateTime >= this.spawnDur) { this.setState('approach'); this.anim.play(this.A.idle, { fade: 0.2 }); }
        break;
      case 'intro':
        this.turnTo(wantYaw, 4, dt);
        if (this.stateTime > 1.8) { this.setState('approach'); }
        break;
      case 'idle': case 'approach': case 'circle': case 'reposition':
        this.think(dt, dist, wantYaw);
        break;
      case 'telegraph': this.updateTelegraph(dt, dist, wantYaw); break;
      case 'windup': this.updateWindup(dt, dist, wantYaw); break;
      case 'recover':
        this.velocity.multiplyScalar(Math.max(0, 1 - 8 * dt));
        if (this.stateTime > (this.recoverT ?? 0.4)) this.setState('approach');
        break;
      case 'stagger':
        this.velocity.multiplyScalar(Math.max(0, 1 - 5 * dt));
        if (this.stateTime > this.staggerT) { this.setState('approach'); }
        break;
      case 'launched': break;
      case 'leap': break; // ballistic jump onto the player's platform (Mode 2)
      case 'down':
        this.velocity.multiplyScalar(Math.max(0, 1 - 6 * dt));
        if (this.stateTime > this.downT) {
          this.setState('getup');
          if (this.A.getup && this.anim.has(this.A.getup)) this.anim.play(this.A.getup, { fade: 0.15, once: true, timeScale: 1.4 });
        }
        break;
      case 'getup':
        if (this.stateTime > 0.9) { this.setState('approach'); this.anim.play(this.A.idle, { fade: 0.2 }); }
        break;
      case 'dead':
        this.deadT += dt;
        this.velocity.multiplyScalar(Math.max(0, 1 - 4 * dt));
        if (this.deadT > 2.6) this.position.y -= dt * 0.9;
        break;
    }

    // vertical motion (launch / juggle / leap / walking off ledges, stairs)
    const world = this.game.world;
    const gnd = this.state === 'dead' && this.deadT > 2.6 ? -5 : world.groundAt(this.position.x, this.position.z, this.radius, this.position.y, this.vy > 0 ? 0.1 : 0.6).y;
    if (this.position.y > gnd + 0.02 || this.vy > 0) {
      const grav = this.airborne ? (this.juggleT > 0 ? 7 : 24) : 30;
      if (this.juggleT > 0) this.juggleT -= dt;
      this.vy -= grav * dt;
      this.position.y += this.vy * dt;
      if (this.position.y <= gnd && this.state !== 'dead') {
        this.position.y = gnd;
        const hard = this.vy < -12 || this.slammed;
        this.vy = 0;
        if (this.airborne) this.land(hard);
        if (this.state === 'leap') { this.setState('approach'); this.velocity.multiplyScalar(0.2); }
      } else if (this.position.y <= gnd) { this.position.y = gnd; this.vy = 0; }
    } else if (this.state !== 'dead') this.position.y = gnd; // follow stairs / ramps

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    if (this.state !== 'dead') world.resolve(this.position, this.radius, this.position.y, this.height * 0.8, 0.45);
    this.root.rotation.y = this.yaw;
    this.anim.update(dt);
  }

  turnTo(want, rate, dt) { this.yaw += angleDiff(this.yaw, want) * (1 - Math.exp(-rate * dt)); }

  // --------------------------------------------------------------- decision making
  think(dt, dist, wantYaw) {
    const g = this.game, p = g.player, mgr = g.enemies;
    if (!p.alive) { this.wander(dt); return; }
    // Mode 2: the player is up on a structure — jump up after them instead of waiting below.
    this.leapCd = (this.leapCd ?? 1) - dt;
    if (g.mode === 'parkour' && !this.boss && !this.ranged && this.leapCd <= 0 && g.parkour.pk.grounded) {
      const dy = p.position.y - this.position.y;
      if (dy > 1.2 && dy < 7 && dist < 9) { this.leapTo(p.position); return; }
    }
    // Boss summons adds.
    if (this.boss && this.def.summons) {
      this.summonT -= dt;
      if (this.summonT <= 0) { this.summonT = this.phase === 2 ? 10 : 16; mgr.summonAround(this, this.def.summons, this.phase === 2 ? 3 : 2); }
    }
    // Pick an attack if allowed.
    const atkIdx = this.chooseAttack(dist);
    const wantsMelee = !this.ranged || dist < 6;
    if (atkIdx >= 0) {
      const a = this.def.attacks[atkIdx];
      // ranged shots are coordinated by the director too; a ranged enemy's close-range swat isn't
      const needToken = !this.boss && !a.close;
      if (!needToken || mgr.director.request(this, a.kind === 'ranged' ? 'ranged' : 'melee')) { this.beginAttack(atkIdx); return; }
    }

    // Movement target.
    let tx, tz, speed, face = true;
    const engaging = this.boss || this.hasToken || mgr.director.wouldGrant(this);
    if (this.ranged && !wantsMelee) {
      const [lo, hi] = this.def.keepDist;
      const awayX = (this.position.x - p.position.x) / (dist || 1), awayZ = (this.position.z - p.position.z) / (dist || 1);
      // backing off only makes sense if there is room behind us (no walls/corners)
      const roomBehind = !g.world.pointBlocked(this.position.x + awayX * 3, this.position.z + awayZ * 3, this.radius + 0.4);
      if (!mgr.hasLOS(this) || dist > hi) { tx = p.position.x; tz = p.position.z; speed = this.runSpeed; }
      else if (dist < lo && roomBehind) { tx = this.position.x + awayX * 4; tz = this.position.z + awayZ * 4; speed = this.speed; }
      else { // strafe around the player at range
        this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeT = 1.5 + Math.random() * 2; this.strafeDir *= -1; }
        const ang = Math.atan2(this.position.x - p.position.x, this.position.z - p.position.z) + this.strafeDir * 0.5;
        tx = p.position.x + Math.sin(ang) * dist; tz = p.position.z + Math.cos(ang) * dist; speed = this.speed * 0.7;
      }
    } else if (engaging) {
      tx = p.position.x; tz = p.position.z; speed = dist > 8 ? this.runSpeed : this.speed;
    } else {
      // hold a slot on the ring around the player, waiting for a token
      const a = this.slotAngle;
      tx = p.position.x + Math.sin(a) * this.ringR; tz = p.position.z + Math.cos(a) * this.ringR;
      const dd = Math.hypot(tx - this.position.x, tz - this.position.z);
      speed = dd > 6 ? this.runSpeed : this.speed * (dd > 1 ? 0.8 : 0);
      if (dist < 3.2) { tx = this.position.x - (p.position.x - this.position.x); tz = this.position.z - (p.position.z - this.position.z); speed = this.speed * 0.7; }
    }
    const stopDist = engaging && !this.ranged ? this.radius + p.radius + 1.1 : 0.6;
    this.steer(dt, tx, tz, speed, stopDist);
    if (face && dist < 14) this.turnTo(wantYaw, 6, dt);
    else if (this.velocity.lengthSq() > 0.5) this.turnTo(Math.atan2(this.velocity.x, this.velocity.z), 8, dt);
    this.playLocomotion(dist, wantYaw);
  }

  // Ballistic leap that lands next to a target point (used to reach elevated players).
  leapTo(target) {
    const T = 0.85, g = 30;
    const dir = new THREE.Vector3(target.x - this.position.x, 0, target.z - this.position.z);
    const d = dir.length(); dir.normalize();
    const land = new THREE.Vector3(target.x - dir.x * (this.radius + 0.9), 0, target.z - dir.z * (this.radius + 0.9));
    const dy = target.y - this.position.y;
    this.velocity.set((land.x - this.position.x) / T, 0, (land.z - this.position.z) / T);
    this.vy = (dy + 0.5 * g * T * T) / T;
    this.setState('leap'); this.leapCd = 3 + Math.random() * 2;
    this.yaw = Math.atan2(dir.x, dir.z);
    this.anim.play(this.anim.has('Jump_Full_Long') ? 'Jump_Full_Long' : this.A.air, { fade: 0.1, once: true });
    this.game.audio.play('grunt', { vol: 0.3, rate: 1.2, minGap: 0.2 });
    void d;
  }

  wander(dt) { this.velocity.multiplyScalar(0.9); this.anim.play(this.A.taunt && this.state !== 'dead' ? this.A.idle : this.A.idle, { fade: 0.3 }); }

  playLocomotion() {
    const v = Math.hypot(this.velocity.x, this.velocity.z);
    if (v < 0.4) { this.anim.play(this.A.idle, { fade: 0.25 }); return; }
    // relative motion -> walk / run / strafe / backpedal
    const f = this.facing(tmp2);
    const fwd = (this.velocity.x * f.x + this.velocity.z * f.z) / v;
    const ts = v / (v > this.speed * 1.05 ? this.runSpeed : this.speed);
    if (fwd < -0.5 && this.A.back) this.anim.play(this.A.back, { fade: 0.2, timeScale: Math.max(0.6, ts) });
    else if (fwd < 0.5 && this.def.rig === 'kaykit') {
      const side = this.velocity.x * f.z - this.velocity.z * f.x;
      this.anim.play(side > 0 ? this.A.strafeL : this.A.strafeR, { fade: 0.2, timeScale: Math.max(0.6, ts * 0.8) });
    } else if (v > this.speed * 1.05) this.anim.play(this.A.run, { fade: 0.2, timeScale: Math.max(0.7, ts) });
    else this.anim.play(this.A.walk, { fade: 0.2, timeScale: Math.max(0.6, ts) });
  }

  // Seek target point: direct when there's clear line of sight, otherwise flow-field.
  steer(dt, tx, tz, speed, stopDist) {
    const g = this.game, world = g.world;
    let dx = tx - this.position.x, dz = tz - this.position.z;
    const d = Math.hypot(dx, dz);
    const want = tmp2.set(0, 0, 0);
    if (d > stopDist && speed > 0) {
      const clear = this.forceFlow <= 0 && !world.segmentBlocked(this.position.x, this.position.z, tx, tz, 0.3, this.radius * 0.9, this.position.y);
      if (clear) want.set(dx / d, 0, dz / d);
      else {
        const dir = g.arena.flow.direction(this.position.x, this.position.z, { x: 0, z: 0 });
        if (dir) want.set(dir.x, 0, dir.z); else want.set(dx / d, 0, dz / d);
      }
      // slow down on arrival
      const arrive = Math.min(1, (d - stopDist) / 1.5);
      want.multiplyScalar(speed * Math.max(0.25, arrive));
    }
    // separation from other enemies and the player
    for (const o of g.enemies.list) {
      if (o === this || !o.alive || o.state === 'spawning') continue;
      const ox = this.position.x - o.position.x, oz = this.position.z - o.position.z;
      const r = this.radius + o.radius + 0.5; const d2 = ox * ox + oz * oz;
      if (d2 < r * r && d2 > 1e-6) { const dd = Math.sqrt(d2); const push = (r - dd) / r * 6; want.x += ox / dd * push; want.z += oz / dd * push; }
    }
    this.velocity.x += (want.x - this.velocity.x) * (1 - Math.exp(-8 * dt));
    this.velocity.z += (want.z - this.velocity.z) * (1 - Math.exp(-8 * dt));
    // stuck detection -> force flow-field navigation for a while
    this.repathT -= dt;
    if (this.repathT <= 0) {
      this.repathT = 0.6;
      const moved = this.position.distanceTo(this.lastPos);
      if (speed > 0.5 && d > stopDist + 1 && moved < 0.35) { this.stuckT += 0.6; if (this.stuckT > 1.2) { this.forceFlow = 2.5; this.stuckT = 0; } }
      else this.stuckT = 0;
      this.lastPos.copy(this.position);
    }
    if (this.forceFlow > 0) this.forceFlow -= dt;
  }

  chooseAttack(dist) {
    if (this.globalCd > 0) return -1;
    const g = this.game, p = g.player;
    if (p.state === 'finisher' || g.combat.seq) return -1;
    const atks = this.def.attacks;
    const opts = [];
    for (let i = 0; i < atks.length; i++) {
      const a = atks[i];
      if (this.cooldowns[i] > 0) continue;
      if (a.minWave && g.waves.wave < a.minWave) continue;
      if (dist > a.range + this.radius + p.radius || dist < (a.minRange ?? 0)) continue;
      if (a.close && dist > 3.5) continue;
      if (a.kind === 'ranged' && !g.enemies.hasLOS(this)) continue;
      if (!g.enemies.hasLOS(this) && a.kind !== 'ranged' && !a.leap) continue;
      // melee needs the player roughly in front to start (ranged turns while aiming)
      opts.push(i);
    }
    if (!opts.length) return -1;
    // bosses favour leaps at range, melee up close
    return opts[(Math.random() * opts.length) | 0];
  }

  beginAttack(idx, comboAnim = null) {
    const base = this.def.attacks[idx];
    const a = { ...base, idx, anim: comboAnim ?? base.anim };
    const tele = comboAnim ? 0.12 : Math.max(0.28, base.tele * (1 - this.aggr * 0.35) * (this.phase === 2 ? 0.8 : 1));
    const ts = base.ts * (1 + this.aggr * 0.2) * (this.phase === 2 ? 1.15 : 1);
    const dur = this.anim.duration(a.anim) / ts;
    const imp = base.imp ?? this.game.enemies.impactFor(this.def, a.anim);
    a.ts = ts; a.dur = dur; a.impactT = imp * dur; a.teleT = tele; a.hitDone = false; a.fired = 0;
    this.currentAttack = a;
    this.cooldowns[idx] = base.cd * (1 - this.aggr * 0.3);
    this.setState('telegraph');
    this.velocity.multiplyScalar(0.3);
    // brief anticipation pose (also gives the counter window)
    this.anim.play(base.aimAnim && this.anim.has(base.aimAnim) ? base.aimAnim : this.A.idle, { fade: 0.12 });
    this.game.enemies.onTelegraph(this, a);
  }

  updateTelegraph(dt, dist, wantYaw) {
    this.turnTo(wantYaw, 10, dt);
    this.velocity.multiplyScalar(Math.max(0, 1 - 10 * dt));
    if (this.stateTime >= this.currentAttack.teleT) {
      const a = this.currentAttack;
      this.setState('windup');
      this.anim.play(a.anim, { fade: 0.08, once: true, restart: true, timeScale: a.ts });
      if (a.kind !== 'ranged') this.game.audio.play('grunt', { vol: this.boss ? 0.7 : 0.35, rate: this.boss ? 0.6 : this.fast ? 1.3 : 1, minGap: 0.15 });
      if (a.leap) { // jump toward the player's current position
        const p = this.game.player;
        const T = Math.max(0.3, a.impactT);
        const tx = p.position.x - Math.sin(wantYaw) * (this.radius + 0.5), tz = p.position.z - Math.cos(wantYaw) * (this.radius + 0.5);
        this.velocity.set((tx - this.position.x) / T, 0, (tz - this.position.z) / T);
        this.vy = 0.5 * 30 * T; this.leaping = true;
      }
      if (a.lunge) { const f = this.facing(new THREE.Vector3()); this.velocity.copy(f.multiplyScalar(a.lunge)); }
    }
  }

  updateWindup(dt, dist, wantYaw) {
    const a = this.currentAttack, g = this.game;
    // tracking: strong early, locked near impact so dodges work
    const k = this.stateTime / Math.max(0.01, a.impactT);
    if (!a.leap) this.turnTo(wantYaw, k < 0.65 ? 7 : 0.5, dt);
    if (!a.leap && !a.lunge) this.velocity.multiplyScalar(Math.max(0, 1 - 10 * dt));
    if (a.lunge && k > 0.9) this.velocity.multiplyScalar(Math.max(0, 1 - 10 * dt));
    if (!a.hitDone && this.stateTime >= a.impactT) {
      a.hitDone = true;
      this.leaping = false;
      if (a.leap) { this.velocity.set(0, 0, 0); this.position.y = 0; this.vy = 0; }
      this.performImpact(a);
    }
    if (this.stateTime >= a.dur * 0.95) {
      // chain into combo follow-ups
      const combo = this.def.attacks[a.idx].combo;
      const step = (a.comboStep ?? 0);
      if (combo && step < combo.length && this.game.player.alive && dist < a.range + 2 && Math.random() < 0.75 + this.aggr * 0.2) {
        const next = combo[step];
        this.beginAttack(a.idx, next); this.currentAttack.comboStep = step + 1;
        return;
      }
      this.finishAttack();
    }
  }

  performImpact(a) {
    const g = this.game, p = g.player;
    if (a.kind === 'ranged') {
      const n = a.burst ?? 1;
      for (let i = 0; i < n; i++) {
        const spread = n > 1 ? (i - (n - 1) / 2) * 0.18 : 0;
        g.projectiles.spawn(a.proj, this, spread, a.dmg * this.dmgMult);
      }
      return;
    }
    if (a.aoe) {
      const c = this.position;
      g.vfx.groundSlam(c, a.aoe, [1, 0.3, 0.1]);
      g.audio.play('slam', { vol: 1, rate: 0.7 }); g.audio.play('explosion', { vol: 0.5, rate: 0.8 });
      const d = Math.hypot(p.position.x - c.x, p.position.z - c.z);
      g.cam.addTrauma(Math.max(0.15, 0.8 - d * 0.04));
      if (d < a.aoe + p.radius && p.position.y - c.y < 1.5 && p.position.y >= c.y - 0.5) p.takeHit(a.dmg * this.dmgMult, c, { heavy: true, knock: a.kb });
      return;
    }
    const dx = p.position.x - this.position.x, dz = p.position.z - this.position.z;
    const d = Math.hypot(dx, dz) - p.radius - this.radius;
    const ang = Math.abs(angleDiff(this.yaw, Math.atan2(dx, dz)));
    g.audio.play('swing', { vol: 0.45, rate: this.boss ? 0.6 : 0.9 });
    if (d <= a.range && (a.arc >= 360 || ang <= THREE.MathUtils.degToRad(a.arc / 2)) && Math.abs(p.position.y - this.position.y) < 2.5 &&
      !g.world.segmentBlocked(this.position.x, this.position.z, p.position.x, p.position.z, 1.0, 0, Math.min(this.position.y, p.position.y))) {
      p.takeHit(a.dmg * this.dmgMult, this.position, { heavy: a.kind !== 'melee', knock: a.kb ?? 3, source: this });
    }
    if (this.boss || this.heavyType) { g.cam.addTrauma(0.2); g.vfx.dust(this.position.clone().add(this.facing(new THREE.Vector3()).multiplyScalar(this.radius + 1.5)), 8, 3); }
  }

  finishAttack() {
    this.currentAttack = null;
    this.game.enemies.director.release(this);
    this.globalCd = (this.boss ? 0.6 : 1.1 + Math.random() * 1.2) * (1 - this.aggr * 0.4);
    this.setState('recover'); this.recoverT = this.boss ? 0.3 : 0.35 + Math.random() * 0.3;
    this.anim.play(this.A.idle, { fade: 0.2 });
    this.slotAngle = Math.atan2(this.position.x - this.game.player.position.x, this.position.z - this.game.player.position.z);
  }

  cancelAttack() {
    if (this.currentAttack) { this.currentAttack = null; this.game.enemies.director.release(this); }
    this.leaping = false;
  }

  // Player countered us.
  interruptByCounter() {
    if (!this.alive) return;
    const was = this.currentAttack;
    this.cancelAttack();
    if (was && was.leap && this.position.y > 0) { this.vy = Math.min(this.vy, 0); this.velocity.set(0, 0, 0); }
    this.velocity.set(0, 0, 0);
    this.stagger(this.heavyType ? 1.0 : 0.85, true);
    this.globalCd = 1.2;
  }
  onPerfectDodged() { /* attack already tracking-locked; nothing else */ }
  holdForFinisher(t) { this.cancelAttack(); this.velocity.set(0, 0, 0); this.holdT = t; this.setState('stagger'); this.staggerT = t; }

  // --------------------------------------------------------------- damage
  receiveHit(h) {
    if (!this.alive) return { hit: false };
    const g = this.game, p = g.player;
    // Shield block: frontal non-guard-breaking melee/arrow attacks bounce off.
    if (this.def.shield && !h.guardBreak && ['approach', 'circle', 'recover', 'idle', 'telegraph'].includes(this.state)) {
      const toP = Math.atan2(p.position.x - this.position.x, p.position.z - this.position.z);
      if (Math.abs(angleDiff(this.yaw, toP)) < 1.2 && !h.execution && !(h.source === 'arrow' && h.crit)) {
        this.anim.play(this.A.block, { fade: 0.05, once: true, restart: true, timeScale: 1.4 });
        this.setState('stagger'); this.staggerT = 0.3;
        this.cancelAttack();
        if (h.source === 'arrow') g.audio.play('clash', { vol: 0.5 });
        return { hit: false, blocked: true };
      }
    }
    let dmg = h.dmg;
    if (this.boss && h.execution) dmg = Math.min(dmg, this.maxHp * 0.12);
    const dealt = Math.min(this.hp, dmg);
    this.hp -= dmg;
    this.flash = 0.12; this.applyFlash(1);
    if (this.boss && this.phase === 1 && this.hp < this.maxHp * 0.5) { this.phase = 2; g.ui.flash(`${this.def.name.toUpperCase()} IS ENRAGED`, 'red', 1.4); g.audio.play('roar', { vol: 1, rate: 0.6 }); this.aggr = Math.min(1, this.aggr + 0.3); }
    if (this.hp <= 0) { this.die(h); return { hit: true, killed: true, dealt }; }
    if (this.boss || this.heavyType) g.ui.bossHit?.(this);

    // Launch / juggle / slam
    if (h.launch && !this.heavyType) { this.cancelAttack(); this.airborne = true; this.vy = h.launch; this.juggleT = 1.2; this.setState('launched'); this.velocity.multiplyScalar(0); this.anim.play(this.A.hit[0], { fade: 0.05, once: true, restart: true }); return { hit: true, dealt }; }
    if (this.airborne) {
      if (h.slamDown) { this.vy = -28; this.slammed = true; this.juggleT = 0; }
      else { this.vy = Math.max(this.vy, h.juggle ? 3.5 : 2); this.juggleT = 0.9; }
      this.anim.play(this.A.hit[(Math.random() * this.A.hit.length) | 0], { fade: 0.03, once: true, restart: true, timeScale: 1.4 });
      return { hit: true, dealt };
    }
    // Poise: heavies shrug off light hits until poise breaks.
    let react = true;
    if (this.def.superArmor) {
      this.poise -= dmg * (h.stagger ?? 1) * 0.6 + (h.stagger >= 3 ? 20 : 0);
      if (this.poise > 0 && !(h.stagger >= 3 && !this.boss)) react = false;
      else { this.poise = this.poiseMax; g.ui.flash('STAGGERED!', 'gold'); }
    }
    if (!react) {
      // still pushed a little, attack continues (cannot be interrupted)
      this.velocity.addScaledVector(h.dir, h.kb * 0.15);
      return { hit: true, dealt };
    }
    this.cancelAttack();
    const kb = h.kb ?? 2;
    this.velocity.copy(h.dir).multiplyScalar(kb * (this.heavyType ? 0.5 : 1.4));
    if (kb >= 6 && !this.heavyType && !this.boss) { this.knockDown(1.2); return { hit: true, dealt }; }
    this.stagger(h.stagger >= 2 ? 0.75 : h.stagger <= 0.5 ? 0.25 : 0.42);
    return { hit: true, dealt };
  }

  stagger(t, big = false) {
    this.setState('stagger'); this.staggerT = t * (this.boss ? 0.6 : 1);
    const hit = this.A.hit[(Math.random() * this.A.hit.length) | 0];
    this.anim.play(hit, { fade: 0.04, once: true, restart: true, timeScale: big ? 1 : 1.5 });
  }

  knockDown(t = 1.2) {
    if (this.boss || !this.alive) return;
    this.cancelAttack();
    this.setState('down'); this.downT = t;
    this.anim.play(this.A.down, { fade: 0.08, once: true, restart: true, timeScale: 1.6 });
    this.game.vfx.dust(this.position, 6, 2);
  }

  land(hard) {
    this.airborne = false; this.slammed = false;
    if (this.state === 'launched' || hard) {
      this.game.vfx.dust(this.position, 8, 2.4);
      this.game.audio.play('slam', { vol: 0.4, rate: 1.3 });
      if (hard) this.game.cam.addTrauma(0.3);
      this.knockDown(hard ? 1.6 : 1.0);
    }
  }

  die(h = {}) {
    const g = this.game;
    this.alive = false; this.cancelAttack();
    this.setState('dead'); this.deadT = 0;
    const deaths = this.A.death;
    const anim = h.execution && deaths.length > 1 ? deaths[1] : deaths[(Math.random() * deaths.length) | 0];
    this.anim.play(anim, { fade: 0.06, once: true, restart: true });
    if (h.dir) this.velocity.copy(h.dir).multiplyScalar((h.kb ?? 3) * 1.8 + (h.execution ? 4 : 0));
    if (this.airborne) { this.vy = Math.min(this.vy, 0); }
    this.airborne = false;
    g.vfx.deathBurst(this.chestPos(), this.boss ? [1, 0.3, 0.05] : [1, 0.15, 0.1]);
    if (this.bony) g.vfx.boneBurst(this.chestPos());
    g.audio.play('death', { vol: this.boss ? 1 : 0.45, rate: this.boss ? 0.6 : 0.9 + Math.random() * 0.3 });
    g.enemies.onEnemyDeath(this, h);
  }

  applyFlash(k) {
    for (const [m, base, baseI] of this.baseEmissive) {
      if (!m.emissive) continue;
      m.emissiveIntensity = baseI + (1 - baseI) * k;
      m.emissive.setRGB(base.r + (1 - base.r) * k * 0.9, base.g + (0.55 - base.g) * k * 0.9, base.b + (0.45 - base.b) * k * 0.9);
    }
  }

  dispose() {
    this.game.scene.remove(this.root);
    this.anim.mixer.stopAllAction();
  }
}
