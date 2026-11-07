// WeaponController — the sword: blade-space sample points, motion trail ribbon,
// emissive glow (charge / Blood God), and swapping visibility with the bow.
import * as THREE from 'three';

export class WeaponController {
  constructor(game) {
    this.game = game;
    const hero = game.player.hero;
    this.sword = hero.sword; this.bow = hero.bow;
    // Blade axis from the sword mesh's own geometry bounds.
    const mesh = this.findMesh(this.sword);
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox; const size = new THREE.Vector3(); bb.getSize(size);
    const axis = size.x > size.y && size.x > size.z ? 'x' : size.y > size.z ? 'y' : 'z';
    const lo = bb.min[axis], hi = bb.max[axis];
    // Blade end is the far end from the grip (handslot origin is the grip).
    const tipAtMax = Math.abs(hi) > Math.abs(lo);
    const tip = new THREE.Vector3(), base = new THREE.Vector3();
    const tv = tipAtMax ? hi : lo; const bv = tipAtMax ? lo + (hi - lo) * 0.35 : hi - (hi - lo) * 0.35;
    tip[axis] = tv; base[axis] = bv;
    this.mesh = mesh; this.localTip = tip; this.localBase = base;
    this.materials = [];
    this.sword.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); this.materials.push(o.material); } });
    this.glow = 0; this.glowTarget = 0;
    this.glowColor = new THREE.Color(1, 0.35, 0.12);
    this.trailObj = game.vfx.createTrail(0xffc8a0, 12);
    this.trailOn = false;
    this.bloodTrailColor = new THREE.Color(1, 0.12, 0.08);
    this.normalTrailColor = new THREE.Color(1, 0.8, 0.6);
  }

  findMesh(o) { let m = null; o.traverse(c => { if (!m && c.isMesh) m = c; }); return m; }

  tipWorld(out) { return this.mesh.localToWorld(out.copy(this.localTip)); }
  baseWorld(out) { return this.mesh.localToWorld(out.copy(this.localBase)); }

  trail(on, heavy = false) { this.trailOn = on; this.trailObj.target = on ? (heavy ? 1 : 0.75) : 0; }
  setGlow(v) { this.glowTarget = v; }

  showBow(on) { this.bow.visible = on; this.sword.visible = !on; }

  update(dt) {
    const bg = this.game.abilities.bloodGod;
    const target = Math.max(this.glowTarget, bg ? 1.2 : 0);
    this.glow += (target - this.glow) * Math.min(1, dt * 10);
    for (const m of this.materials) {
      m.emissive = m.emissive || new THREE.Color();
      m.emissive.copy(this.glowColor).multiplyScalar(this.glow);
    }
    this.trailObj.mesh.material.uniforms.color.value.copy(bg ? this.bloodTrailColor : this.normalTrailColor);
    this.trailObj.mesh.visible = this.game.player.root.visible; // hidden in first-person
    if (this.sword.visible) {
      const a = this.baseWorld(new THREE.Vector3()), b = this.tipWorld(new THREE.Vector3());
      this.game.vfx.pushTrail(this.trailObj, a, b);
    }
  }
}
