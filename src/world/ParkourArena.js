// ParkourArena — extra traversal structures for Mode 2, assembled from existing KayKit
// Dungeon pieces (walls, scaffold walls, foundation blocks, wooden floor slabs, stairs,
// columns, barrels, crates). Everything is tagged 'parkour' so Mode 1's arena is unchanged.
import * as THREE from 'three';

const TAG = { tag: 'parkour' };

export class ParkourArena {
  constructor(arena) {
    this.arena = arena; this.assets = arena.assets; this.col = arena.collision;
    this.root = new THREE.Group(); this.root.name = 'parkour-structures'; this.root.visible = false;
    arena.root.add(this.root);
    this.destructibles = [];
    this.build();
  }

  put(key, x, y, z, rotY = 0, scale = 1) {
    const o = this.assets.cloneStatic('env_' + key);
    o.position.set(x, y, z); o.rotation.y = rotY; o.scale.setScalar(scale);
    this.root.add(o); return o;
  }

  // A straight wall run of n 4-wide pieces, centred at (cx,cz), along 'x' or 'z'.
  wallRun(cx, cz, axis, n, kinds = ['wall', 'wall_cracked', 'wall_scaffold']) {
    const len = n * 4;
    for (let i = 0; i < n; i++) {
      const o = -len / 2 + 2 + i * 4;
      const x = axis === 'x' ? cx + o : cx, z = axis === 'x' ? cz : cz + o;
      this.put(kinds[i % kinds.length], x, 0, z, axis === 'x' ? 0 : Math.PI / 2);
    }
    if (axis === 'x') this.col.addBox(cx, cz, len, 1.0, 4, TAG); else this.col.addBox(cx, cz, 1.0, len, 4, TAG);
  }

  // Stack of 2-high foundation blocks; returns top height.
  block(x, z, levels = 1) {
    for (let i = 0; i < levels; i++) this.put('floor_foundation_allsides', x, i * 2, z);
    this.col.addBox(x, z, 2.2, 2.2, levels * 2, TAG);
    return levels * 2;
  }

  // 4x4 wooden slab whose top surface is at height `top` (walk on it; walk/slide under it).
  slab(x, z, top) {
    this.put('floor_wood_large', x, top - 0.05, z);
    this.col.addBox(x, z, 4, 4, top, { ...TAG, minY: top - 0.16 });
  }

  build() {
    // 1) wall-jump chimney (north-west): two parallel 12-long walls 4.5 apart
    // (16 long, 3.5 between faces: verified that chained wall-jumps connect at full speed)
    this.wallRun(-25, -15, 'z', 4);
    this.wallRun(-20.5, -15, 'z', 4, ['wall_scaffold', 'wall', 'wall_cracked']);
    // 2) long wall-run lanes
    this.wallRun(16, -6, 'x', 3, ['wall_scaffold', 'wall_cracked', 'wall']);
    this.wallRun(12, 20, 'z', 3, ['wall', 'wall_scaffold', 'wall']);

    // 3) raised deck (top at 4) on stacked foundation pillars, walkable underneath
    for (const [x, z] of [[-2.9, 13.1], [2.9, 13.1], [-2.9, 18.9], [2.9, 18.9]]) this.block(x, z, 2);
    for (const [x, z] of [[-2, 14], [2, 14], [-2, 18], [2, 18]]) this.slab(x, z, 4.05);
    // stairs climbing to the deck from the north (rise 4 over 4 deep)
    this.put('stairs', 0, 0, 12, Math.PI); // model climbs toward its -z after this flip: low at z=8, top at the deck (z=12)
    this.col.addRamp(-2.5, 2.5, 8, 12, 'z', true, 0, 4.05, TAG);

    // 4) stepping blocks to a tall tower (west): 2 -> 4 -> 6 high, with gaps between
    this.block(-24, -5.5, 1); this.block(-24, -1, 2); this.block(-24, 3.5, 3);

    // 5) north-east stepping blocks
    this.block(14, -18, 1); this.block(18.5, -18, 2);

    // 6) slide gate: a slab at 1.45 on four short columns — too low to walk under, slide under it
    const gx = 6, gz = -15;
    for (const [dx, dz] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) {
      this.put('column', gx + dx, 0, gz + dz);
      this.col.addCircle(gx + dx, gz + dz, 0.36, 1.4, TAG);
    }
    this.slab(gx, gz, 1.5);

    // 7) destructible barrels and crates (break with slams / dash strikes)
    const props = [['barrel_small', -6, 6], ['barrel_small', 7, 5], ['barrel_small', -10, -12], ['barrel_small', 9, 11],
      ['box_large', 5, -6], ['box_large', -14, 13], ['box_small', -8, -4], ['box_small', 18, 6], ['barrel_small', -4, -24], ['box_large', 22, 16]];
    for (const [k, x, z] of props) {
      const obj = this.put(k, x, 0, z, Math.random() * 6);
      const r = k === 'box_large' ? 0.8 : 0.55, h = k === 'box_large' ? 1.5 : 1.0;
      const c = this.col.addCircle(x, z, r, h, TAG);
      this.destructibles.push({ obj, collider: c, pos: new THREE.Vector3(x, h * 0.5, z), r, alive: true, kind: k });
    }
  }

  setActive(on) {
    this.root.visible = on;
    if (on) for (const d of this.destructibles) { d.alive = true; d.obj.visible = true; d.collider.off = false; }
  }

  // Break props within radius of a point; returns how many broke.
  smash(center, radius, vfx, audio) {
    let n = 0;
    for (const d of this.destructibles) {
      if (!d.alive || d.pos.distanceTo(center) > radius + d.r) continue;
      d.alive = false; d.obj.visible = false; d.collider.off = true; n++;
      vfx.sys.dirt.emit(d.pos, { count: 26, speed: 7, up: 0.9, life: 0.9, size: 1, color: [0.55, 0.38, 0.22], gravity: 16, radius: 0.4 });
      vfx.dust(d.pos, 8, 2);
      audio.play('slam', { vol: 0.5, rate: 1.6 });
    }
    return n;
  }
}
