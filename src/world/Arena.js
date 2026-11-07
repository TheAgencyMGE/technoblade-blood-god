// Arena — a ruined fortress courtyard assembled from the KayKit Dungeon Remastered pieces,
// Quaternius dead trees/rocks and KayKit graves, lit by torches under a night HDRI.
import * as THREE from 'three';
import { CollisionWorld, FlowField } from './Collision.js';
import { ParkourArena } from './ParkourArena.js';

export const ARENA_HALF = 32; // inner wall line
const WALL = 4;

export class Arena {
  constructor(scene, assets, vfx) {
    this.scene = scene; this.assets = assets; this.vfx = vfx;
    this.root = new THREE.Group(); this.root.name = 'arena';
    scene.add(this.root);
    this.collision = new CollisionWorld(44);
    this.torches = [];
    this.spawnGates = [];
    this.emberTimer = 0;
    this.build();
    this.parkour = new ParkourArena(this);
    this.flow = new FlowField(this.collision, { size: 1, half: 44, agentRadius: 0.75 });
    this.mode = 'arkham';
  }

  // Mode 1 = flat courtyard; Mode 2 adds the tagged parkour structures.
  setMode(mode) {
    this.mode = mode;
    this.collision.activeTag = mode === 'parkour' ? 'parkour' : null;
    this.parkour.setActive(mode === 'parkour');
    this.flow.rebuildBlocked(); this.flow.lastCell = -1;
  }

  place(key, x, z, rotY = 0, scale = 1, y = 0) {
    const o = this.assets.cloneStatic('env_' + key);
    o.position.set(x, y, z); o.rotation.y = rotY; o.scale.setScalar(scale);
    this.root.add(o);
    return o;
  }

  build() {
    const T = this.assets.textures;
    // --- Ground: outer rocky field + inner cobbled courtyard (Poly Haven PBR textures)
    const setRep = (t, r) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(r, r); t.anisotropy = 8; return t; };
    const outerMat = new THREE.MeshStandardMaterial({
      map: setRep(T.rocky_diff.clone(), 40), normalMap: setRep(T.rocky_nor.clone(), 40), roughnessMap: setRep(T.rocky_rough.clone(), 40),
      color: 0x8a7a72, roughness: 1,
    });
    for (const t of [outerMat.map, outerMat.normalMap, outerMat.roughnessMap]) t.needsUpdate = true;
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), outerMat);
    outer.rotation.x = -Math.PI / 2; outer.receiveShadow = true; this.root.add(outer);
    const innerMat = new THREE.MeshStandardMaterial({
      map: setRep(T.cobble_diff, 14), normalMap: setRep(T.cobble_nor, 14), roughnessMap: setRep(T.cobble_rough, 14),
      color: 0x9a8f88, roughness: 1, normalScale: new THREE.Vector2(1.2, 1.2),
    });
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2), innerMat);
    inner.rotation.x = -Math.PI / 2; inner.position.y = 0.02; inner.receiveShadow = true; this.root.add(inner);

    // --- Perimeter walls with two breaches (north & south) where monsters pour in.
    const H = ARENA_HALF;
    const variants = ['wall', 'wall', 'wall_cracked', 'wall', 'wall_archedwindow_open', 'wall', 'wall_cracked', 'wall_broken'];
    const sides = [
      { axis: 'x', fixed: -H - 0.5, rot: 0 },          // north (z = -H)
      { axis: 'x', fixed: H + 0.5, rot: Math.PI },     // south
      { axis: 'z', fixed: H + 0.5, rot: -Math.PI / 2 }, // east (x = +H)
      { axis: 'z', fixed: -H - 0.5, rot: Math.PI / 2 }, // west
    ];
    let vi = 0;
    for (let s = 0; s < 4; s++) {
      const side = sides[s];
      const gap = s < 2; // breaches on north/south
      const segs = [];
      for (let i = -H / WALL; i < H / WALL; i++) {
        const c = i * WALL + WALL / 2;
        if (gap && (c === -2 || c === 2)) { segs.push(null); continue; }
        segs.push(c);
        const isPillar = (i + 8) % 4 === 0;
        const key = isPillar ? 'wall_pillar' : variants[(vi++) % variants.length];
        const x = side.axis === 'x' ? c : side.fixed, z = side.axis === 'x' ? side.fixed : c;
        this.place(key, x, z, side.rot);
        if (isPillar) this.addTorch(x, z, side.rot);
        else if ((i + 8) % 4 === 2) {
          const bk = ['banner_red', 'banner_patternA_red', 'banner_shield_red'][(i + 8 + s) % 3];
          const b = this.place(bk, x, z, side.rot);
          b.position.y = 0.15;
        }
      }
      // colliders: contiguous runs
      let runStart = null;
      const flush = (endC) => {
        if (runStart === null) return;
        const a = runStart - WALL / 2, b = endC + WALL / 2; const mid = (a + b) / 2, len = b - a;
        if (side.axis === 'x') this.collision.addBox(mid, side.fixed, len, 1.2, 4); else this.collision.addBox(side.fixed, mid, 1.2, len, 4);
        runStart = null;
      };
      let last = null;
      for (const c of segs) { if (c === null) { flush(last); } else { if (runStart === null) runStart = c; last = c; } }
      flush(last);
      if (gap) {
        const z = side.fixed; const sign = Math.sign(z);
        // rubble flanking the breach
        this.place('rubble_half', 4.0, z + sign * 0.2, 0, 0.9);
        this.place('rubble_half', -4.0, z + sign * 0.2, Math.PI, 0.9);
        this.collision.addBox(5.8, z, 3.6, 2.8, 3.2);
        this.collision.addBox(-5.8, z, 3.6, 2.8, 3.2);
        this.spawnGates.push({ outside: new THREE.Vector3(0, 0, z + sign * 7), inside: new THREE.Vector3(0, 0, z - sign * 4) });
      }
    }
    // corner pillars
    for (const [x, z] of [[-H - 0.5, -H - 0.5], [H + 0.5, -H - 0.5], [-H - 0.5, H + 0.5], [H + 0.5, H + 0.5]]) {
      this.place('pillar', x, z); this.collision.addBox(x, z, 1.6, 1.6, 4);
    }

    // --- Interior: pillars, cover, debris. Centre (r<13) kept open for combat.
    const pillars = [[-15, -15], [15, -15], [-15, 15], [15, 15]];
    for (const [x, z] of pillars) { this.place('pillar_decorated', x, z, Math.atan2(-x, -z)); this.collision.addBox(x, z, 1.6, 1.6, 4); }
    const prop = (key, x, z, rot, col) => { this.place(key, x, z, rot); if (col) col(); };
    prop('barrel_large', -26, -24, 0, () => this.collision.addCircle(-26, -24, 0.95, 2));
    prop('barrel_small_stack', -23.5, -27, 0, () => this.collision.addBox(-23.5, -27, 1.9, 1.1, 1.8));
    prop('crates_stacked', 26, -26, 0.3, () => this.collision.addBox(26, -26, 2.3, 2.3, 2.2));
    prop('box_stacked', 25, 25, 0, () => this.collision.addBox(25, 25, 3.6, 3.7, 3.3));
    prop('keg_decorated', -27, 9, Math.PI / 2, () => this.collision.addBox(-27, 9, 2.1, 3.6, 2));
    prop('barrier', 0, -22, 0, () => this.collision.addBox(0, -22, 4, 0.6, 1.1));
    prop('barrier', 0, 22, 0, () => this.collision.addBox(0, 22, 4, 0.6, 1.1));
    prop('barrier_column', -22, 0, Math.PI / 2, () => this.collision.addBox(-22, 0, 0.8, 4, 1.4));
    prop('barrier_column', 22, 0, Math.PI / 2, () => this.collision.addBox(22, 0, 0.8, 4, 1.4));
    prop('rubble_large', 27, 6, Math.PI / 2, () => this.collision.addBox(27, 6, 3.2, 8.1, 3.5));
    prop('column', -9, 24, 0, () => this.collision.addCircle(-9, 24, 0.45, 1.4));
    prop('column', 9, -24, 0, () => this.collision.addCircle(9, -24, 0.45, 1.4));
    prop('sword_shield_broken', 4, 18, 0.4);
    prop('sword_shield_broken', -18, -6, 2.1);
    prop('candle_triple', -25, -21, 0); prop('candle_triple', 23, 27, 0);
    // graveyard corner (south-west)
    const graves = [['grave_a', -26, 22], ['grave_b', -22, 26], ['grave_destroyed', -26, 27], ['grave_a', -21, 21]];
    for (const [k, x, z] of graves) { this.place(k, x, z, 0.4); this.collision.addBox(x, z, 2, 1, 2.1); }
    // a dead tree inside, rocks
    this.place('dead_tree_2', 20, 15, 1.2, 0.8); this.collision.addCircle(20, 15, 0.8, 9);
    this.place('rock_medium', -16, -26, 0.7, 0.9); this.collision.addCircle(-16, -26, 1.5, 1.8);
    this.place('rock_b', 16, 26, 2.0, 0.9); this.collision.addCircle(16, 26, 1.0, 2.7);

    // --- Outside the walls: dead forest, rocks and graves for the silhouette.
    const rng = mulberry(7);
    for (let i = 0; i < 46; i++) {
      const a = rng() * Math.PI * 2; const r = 40 + rng() * 45;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < 9 && Math.abs(z) > 30) continue; // keep breach approaches clear
      const k = rng() < 0.5 ? 'dead_tree_2' : 'dead_tree_5';
      this.place(k, x, z, rng() * 6, 0.7 + rng() * 0.6);
    }
    for (let i = 0; i < 30; i++) {
      const a = rng() * Math.PI * 2; const r = 37 + rng() * 30;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < 9 && Math.abs(z) > 30) continue;
      this.place(rng() < 0.5 ? 'rock_b' : 'rock_medium', x, z, rng() * 6, 0.6 + rng() * 1.2);
    }
    for (let i = 0; i < 14; i++) {
      const x = -60 + rng() * 25, z = 38 + rng() * 20;
      this.place(['grave_a', 'grave_b', 'grave_destroyed'][i % 3], x, z, rng() * 0.6 - 0.3);
    }
  }

  addTorch(x, z, rot) {
    const t = this.place('torch_mounted', x, z, rot, 1.1);
    t.position.y = 2.3;
    // flame position: torch tip sits ~0.65 out from the wall face, 0.7 up.
    const out = new THREE.Vector3(0, 0, 1.25).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    const flame = new THREE.Vector3(x + out.x, 3.15, z + out.z);
    // only every other torch gets a dynamic light (keeps the light count GPU-friendly)
    let light = null;
    if (this.torches.length % 2 === 0) {
      light = new THREE.PointLight(0xff7a2a, 30, 18, 1.5);
      light.position.copy(flame);
      this.root.add(light);
    }
    this.torches.push({ flame, light, phase: Math.random() * 10 });
  }

  update(dt, time, player) {
    for (const t of this.torches) {
      const f = 0.82 + Math.sin(time * 11 + t.phase) * 0.08 + Math.sin(time * 23.7 + t.phase * 2) * 0.06 + Math.random() * 0.06;
      if (t.light) t.light.intensity = 30 * f;
      if (Math.random() < 0.7) this.vfx.sys.fire.emit(t.flame, { count: 1, speed: 0.6, up: 1.4, life: 0.45, size: 1.3, sizeEnd: 0.3, color: [1, 0.55, 0.2], drag: 1, radius: 0.08, spin: 1 });
      if (Math.random() < 0.08) this.vfx.sys.ember.emit(t.flame, { count: 1, speed: 1.2, up: 2, life: 1.5, size: 0.25, color: [1, 0.5, 0.15], gravity: -0.5, drag: 0.5 });
    }
    // ambient embers drifting over the battlefield
    this.emberTimer -= dt;
    if (this.emberTimer <= 0) {
      this.emberTimer = 0.05;
      const p = player ? player.position : new THREE.Vector3();
      const pos = new THREE.Vector3(p.x + (Math.random() - 0.5) * 50, 0.3 + Math.random() * 3, p.z + (Math.random() - 0.5) * 50);
      this.vfx.sys.ember.emit(pos, { count: 1, speed: 0.6, up: 1.2, life: 4, size: 0.22, sizeEnd: 0.1, color: [1, 0.35, 0.12], gravity: -0.15, drag: 0.2 });
    }
  }
}

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
