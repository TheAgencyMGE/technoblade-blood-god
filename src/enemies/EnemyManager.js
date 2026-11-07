// EnemyManager — owns all enemies, the AttackDirector (limits how many may engage and
// attack at once while the rest circle and reposition), safe spawning (never inside the
// player, walls or other enemies), LOS caching, arrow raycasts, threat queries.
import * as THREE from 'three';
import { Enemy } from './EnemyAI.js';
import { ENEMY_TYPES } from './EnemyTypes.js';
import { ARENA_HALF } from '../world/Arena.js';

class AttackDirector {
  constructor(mgr) { this.mgr = mgr; this.engagers = new Set(); this.maxEngage = 1; this.maxRanged = 1; this.gap = 1; this.gapT = 0; this.rangedT = 0; this.refreshT = 0; this.attacking = 0; this.rangedActive = 0; }
  configure(wave) {
    this.maxEngage = Math.min(4, 1 + Math.floor((wave + 1) / 3));
    this.maxRanged = Math.min(3, 1 + Math.floor(wave / 4));
    this.gap = Math.max(0.35, 1.05 - wave * 0.05);
  }
  update(dt) {
    this.gapT -= dt; this.rangedT -= dt; this.refreshT -= dt;
    if (this.refreshT > 0) return;
    this.refreshT = 0.4;
    const p = this.mgr.game.player.position;
    for (const e of [...this.engagers]) if (!e.alive || e.distTo(p) > 16) this.engagers.delete(e);
    const cands = this.mgr.list.filter(e => e.alive && !e.boss && !e.ranged && e.state !== 'spawning' && !this.engagers.has(e))
      .sort((a, b) => a.distTo(p) - b.distTo(p));
    while (this.engagers.size < this.maxEngage && cands.length) this.engagers.add(cands.shift());
  }
  wouldGrant(e) { return this.engagers.has(e) || e.ranged; }
  request(e, kind, probe = false) {
    if (probe) return false;
    if (e.hasToken) return true;
    if (kind === 'ranged') {
      if (this.rangedActive >= this.maxRanged || this.rangedT > 0) return false;
      this.rangedActive++; this.rangedT = this.gap * 1.2; e.hasToken = 'ranged'; return true;
    }
    if (!this.engagers.has(e) || this.gapT > 0 || this.attacking >= this.maxEngage) return false;
    this.attacking++; this.gapT = this.gap * (0.7 + Math.random() * 0.6); e.hasToken = 'melee'; return true;
  }
  release(e) {
    if (e.hasToken === 'ranged') this.rangedActive = Math.max(0, this.rangedActive - 1);
    else if (e.hasToken === 'melee') this.attacking = Math.max(0, this.attacking - 1);
    e.hasToken = false;
  }
  reset() { this.engagers.clear(); this.attacking = 0; this.rangedActive = 0; }
}

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.director = new AttackDirector(this);
    this.scaleCache = {}; this.impactCache = {};
    this.losCache = new Map(); this.losFrame = 0;
    this.frame = 0;
  }

  reset() { for (const e of this.list) e.dispose(); this.list.length = 0; this.director.reset(); }

  modelScale(model, height) {
    const k = model + ':' + height;
    if (!this.scaleCache[k]) {
      const g = this.game.assets.gltf[model].scene;
      const box = new THREE.Box3().setFromObject(g, true);
      const h = box.max.y - box.min.y;
      this.scaleCache[k] = height / h;
    }
    return this.scaleCache[k];
  }

  // Impact frame of an enemy attack clip: the moment the striking arm moves fastest.
  impactFor(def, anim) {
    const k = def.model + ':' + anim;
    if (this.impactCache[k] !== undefined) return this.impactCache[k];
    const am = this.game.assets;
    const root = am.cloneCharacter(def.model);
    const clip = (am.clips[def.rig] ?? am.clips.kaykit)[anim];
    let best = 0.5;
    if (clip) {
      let bone = def.rig === 'kaykit' ? am.findBone(root, 'handslot.r') : null;
      if (!bone) root.traverse(o => { if (!bone && /^(LowerArmR|LowerArm\.R|ArmR|Arm\.R|HandR)$/.test(o.name)) bone = o; });
      if (!bone) root.traverse(o => { if (!bone && /Arm.*R/.test(o.name)) bone = o; });
      const mixer = new THREE.AnimationMixer(root); mixer.clipAction(clip).play();
      let prev = null, bs = 0;
      for (let i = 0; i <= 40; i++) {
        mixer.setTime(clip.duration * i / 40); root.updateMatrixWorld(true);
        const p = bone.getWorldPosition(new THREE.Vector3());
        if (prev && i / 40 > 0.2 && i / 40 < 0.85) { const s = p.distanceTo(prev); if (s > bs) { bs = s; best = i / 40; } }
        prev = p;
      }
    }
    this.impactCache[k] = best;
    return best;
  }

  // ------------------------------------------------------------ spawning
  spawn(type, opts = {}) {
    const def = ENEMY_TYPES[type];
    const e = new Enemy(this.game, type, def, opts);
    const p = this.game.player.position;
    let pos = null;
    const quaternius = def.rig !== 'kaykit';
    if (opts.at) pos = opts.at.clone();
    else if (quaternius) {
      // big monsters stride in through the wall breaches
      const gates = [...this.game.arena.spawnGates].sort((a, b) => b.outside.distanceTo(p) - a.outside.distanceTo(p));
      pos = this.findFree(gates[0].outside, e.radius, 4) || this.findFree(gates[1].outside, e.radius, 4);
    }
    if (!pos) {
      // skeletons claw out of the ground somewhere away from Technoblade
      for (let i = 0; i < 40 && !pos; i++) {
        const a = Math.random() * Math.PI * 2, r = 11 + Math.random() * 12;
        const c = new THREE.Vector3(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
        if (Math.abs(c.x) > ARENA_HALF - 2 || Math.abs(c.z) > ARENA_HALF - 2) continue;
        pos = this.findFree(c, e.radius, 0);
      }
      if (!pos) pos = this.findFree(new THREE.Vector3(-p.x * 0.5, 0, -p.z * 0.5), e.radius, 10) || new THREE.Vector3(0, 0, -20);
    }
    const yaw = Math.atan2(p.x - pos.x, p.z - pos.z);
    e.spawnAt(pos, { rise: !quaternius && !opts.noRise, yaw });
    this.list.push(e);
    return e;
  }

  // A spot with room for the enemy: no walls, no other enemies, not near the player.
  findFree(center, r, jitter) {
    const world = this.game.world, p = this.game.player.position;
    for (let i = 0; i < 24; i++) {
      const c = new THREE.Vector3(center.x + (Math.random() * 2 - 1) * jitter * (i > 0 ? 1 : 0), 0, center.z + (Math.random() * 2 - 1) * jitter * (i > 0 ? 1 : 0));
      if (world.pointBlocked(c.x, c.z, r + 0.3)) continue;
      if (Math.hypot(c.x - p.x, c.z - p.z) < 7 + r) continue;
      if (!this.game.arena.flow.isOpen(c.x, c.z)) continue;
      let clash = false;
      for (const o of this.list) if (o.alive && Math.hypot(o.position.x - c.x, o.position.z - c.z) < o.radius + r + 0.6) { clash = true; break; }
      if (!clash) return c;
    }
    return null;
  }

  summonAround(boss, type, n) {
    this.game.ui.flash(`${boss.def.name.toUpperCase()} SUMMONS THE DEAD`, 'red');
    this.game.audio.play('roar', { vol: 0.8, rate: 0.7 });
    const opts = this.game.waves.enemyOpts();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const c = new THREE.Vector3(boss.position.x + Math.cos(a) * 5, 0, boss.position.z + Math.sin(a) * 5);
      const pos = this.findFree(c, 0.8, 3);
      if (pos) { this.spawn(type, { ...opts, at: pos }); this.game.waves.extraSpawned(1); }
    }
  }

  // ------------------------------------------------------------ queries
  hasLOS(e) {
    let v = this.losCache.get(e.id);
    if (v && v.frame >= this.frame - 6) return v.los;
    const p = this.game.player.position;
    const los = !this.game.world.segmentBlocked(e.position.x, e.position.z, p.x, p.z, 1.5, 0, Math.min(e.position.y, p.y));
    this.losCache.set(e.id, { los, frame: this.frame });
    return los;
  }
  countNear(pos, r) { let n = 0; for (const e of this.list) if (e.alive && e.state !== 'spawning' && e.position.distanceTo(pos) < r) n++; return n; }
  get aliveCount() { let n = 0; for (const e of this.list) if (e.alive) n++; return n; }

  impactImminent(player, window) {
    for (const e of this.list) {
      const t = e.alive && e.threat();
      if (!t || t.kind === 'ranged') continue;
      if (t.impactIn < 0 || t.impactIn > window) continue;
      const a = e.currentAttack;
      const d = e.distTo(player.position) - e.radius - player.radius;
      if (d < (a.range ?? 3) + 1.5 || a.aoe) return e;
    }
    for (const pr of this.game.projectiles.list) if (!pr.reflected && pr.pos.distanceTo(player.position) < 4) return pr;
    return null;
  }

  counterableThreats(player, range) {
    const out = [];
    for (const e of this.list) {
      const t = e.alive && e.threat();
      if (!t || !t.counterable) continue;
      if (e.distTo(player.position) > range + e.radius) continue;
      out.push(e);
    }
    return out.sort((a, b) => a.distTo(player.position) - b.distTo(player.position));
  }

  nearestVisible(pos, range) {
    let best = null, bd = range;
    for (const e of this.list) { if (!e.targetable) continue; const d = e.position.distanceTo(pos); if (d < bd && this.hasLOS(e)) { bd = d; best = e; } }
    return best;
  }

  // Swept test for arrows: head sphere, weak points, body capsule.
  raycast(origin, dir, maxDist, exclude) {
    let best = null;
    const ray = new THREE.Ray(origin, dir);
    const sph = new THREE.Sphere(); const hit = new THREE.Vector3();
    for (const e of this.list) {
      if (!e.hittable || exclude?.has(e)) continue;
      if (e.position.distanceTo(origin) > maxDist + e.height + 3) continue;
      // head
      e.headPos(sph.center); sph.radius = Math.max(0.35, e.height * 0.13);
      if (ray.intersectSphere(sph, hit)) { const d = hit.distanceTo(origin); if (d <= maxDist && (!best || d < best.dist)) best = { enemy: e, dist: d, part: 'head' }; }
      for (const w of e.weak) {
        if (!w.boneObj) continue;
        sph.center.set(...w.offset).multiplyScalar(e.height / 3); w.boneObj.getWorldPosition(hit); sph.center.add(hit);
        if (w.back) { const f = e.facing(new THREE.Vector3()); sph.center.addScaledVector(f, -e.radius * 0.5); if (f.dot(dir) < 0.2) continue; }
        sph.radius = w.r * e.scale * (e.def.rig === 'kaykit' ? 1 : 1) * 0 + w.r * (e.height / 3.4);
        if (ray.intersectSphere(sph, hit)) { const d = hit.distanceTo(origin); if (d <= maxDist && (!best || d < best.dist - 0.05)) best = { enemy: e, dist: d, part: 'weak' }; }
      }
      // body: capsule approximated with 3 stacked spheres
      const r = e.radius * 0.85;
      for (let k = 0; k < 3; k++) {
        sph.center.set(e.position.x, e.position.y + e.height * (0.2 + k * 0.25), e.position.z); sph.radius = r;
        if (ray.intersectSphere(sph, hit)) { const d = hit.distanceTo(origin); if (d <= maxDist && (!best || d < best.dist - 0.1)) best = { enemy: e, dist: d, part: 'body' }; }
      }
    }
    return best;
  }

  onTelegraph(e, a) {
    const kind = a.kind;
    this.game.ui.telegraph(e, kind);
    if (kind === 'unblockable') this.game.audio.play('roar', { vol: e.boss ? 0.9 : 0.4, rate: e.boss ? 0.7 : 1.3, minGap: 0.2 });
  }

  onEnemyDeath(e, h) {
    this.director.release(e); this.director.engagers.delete(e);
    this.game.bow.dropArrowsFrom(e);
    this.game.waves.onEnemyKilled(e);
    // fallen enemies sometimes leave arrows behind
    if (Math.random() < 0.35) this.game.pickups.spawnArrows(e.position.clone(), 2 + ((Math.random() * 3) | 0));
    if (Math.random() < (e.boss ? 1 : e.elite || e.heavyType ? 0.6 : 0.08)) this.game.pickups.spawnHealth(e.position.clone().add(new THREE.Vector3(0.8, 0, 0.5)), e.boss ? 50 : 15);
  }

  update(dt) {
    this.frame++;
    this.director.update(dt);
    const p = this.game.player;
    this.game.arena.flow.update(p.position.x, p.position.z);
    // spread ring slots so waiting enemies surround the player evenly
    const waiting = this.list.filter(e => e.alive && !e.ranged && !e.boss && !this.director.engagers.has(e));
    if (waiting.length) {
      waiting.sort((a, b) => Math.atan2(a.position.x - p.position.x, a.position.z - p.position.z) - Math.atan2(b.position.x - p.position.x, b.position.z - p.position.z));
      const base = Math.atan2(waiting[0].position.x - p.position.x, waiting[0].position.z - p.position.z);
      waiting.forEach((e, i) => { const target = base + (i / waiting.length) * Math.PI * 2; e.slotAngle += Math.atan2(Math.sin(target - e.slotAngle), Math.cos(target - e.slotAngle)) * Math.min(1, dt * 0.8); });
    }
    for (const e of this.list) e.update(dt);
    // player <-> enemy body collision (no overlapping)
    for (const e of this.list) {
      if (!e.alive || e.state === 'spawning') continue;
      const dx = p.position.x - e.position.x, dz = p.position.z - e.position.z;
      const r = p.radius + e.radius; const d2 = dx * dx + dz * dz;
      if (d2 < r * r && d2 > 1e-6 && Math.abs(p.position.y - e.position.y) < 2) {
        const d = Math.sqrt(d2); const push = r - d;
        const pw = e.heavyType || e.boss ? 1 : 0.5;
        p.position.x += dx / d * push * pw; p.position.z += dz / d * push * pw;
        e.position.x -= dx / d * push * (1 - pw); e.position.z -= dz / d * push * (1 - pw);
      }
    }
    // cleanup sunk corpses
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e.alive && e.deadT > 4.2) { e.dispose(); this.list.splice(i, 1); this.losCache.delete(e.id); }
    }
  }
}
