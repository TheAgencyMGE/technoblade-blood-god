// Pickups — arrow bundles (KayKit arrow_bundle) and healing potions (KayKit bottle) dropped
// by fallen monsters. Bob + glow, collected by walking over them.
import * as THREE from 'three';

export class Pickups {
  constructor(game) { this.game = game; this.list = []; }

  reset() { for (const p of this.list) this.game.scene.remove(p.obj); this.list.length = 0; }

  make(key, scale) {
    const o = this.game.assets.cloneStatic(key);
    const box = new THREE.Box3().setFromObject(o); const s = new THREE.Vector3(); box.getSize(s); const c = new THREE.Vector3(); box.getCenter(c);
    o.position.sub(c);
    const g = new THREE.Group(); g.add(o); g.scale.setScalar(scale / Math.max(s.x, s.y, s.z));
    this.game.scene.add(g);
    return g;
  }

  spawnArrows(pos, n) {
    const obj = this.make('arrowBundle', 1.1);
    obj.position.copy(pos).setY(0.6);
    this.list.push({ obj, kind: 'arrows', n, t: 0, life: 30 });
  }
  spawnHealth(pos, n) {
    const obj = this.make('potion', 0.9);
    obj.position.copy(pos).setY(0.7);
    this.list.push({ obj, kind: 'health', n, t: 0, life: 40 });
  }

  update(dt) {
    const g = this.game, p = g.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const k = this.list[i];
      k.t += dt; k.life -= dt;
      k.obj.rotation.y += dt * 1.8;
      k.obj.position.y = 0.7 + Math.sin(k.t * 3) * 0.15;
      if (Math.random() < 0.15) g.vfx.sys.light.emit(k.obj.position, { count: 1, speed: 0.3, life: 0.5, size: 1.4, color: k.kind === 'health' ? [0.3, 1, 0.4] : [1, 0.8, 0.4], sizeEnd: 0.5 });
      const d = Math.hypot(k.obj.position.x - p.position.x, k.obj.position.z - p.position.z);
      let take = d < 1.7 && p.alive;
      if (take && k.kind === 'arrows' && g.bow.ammo >= g.bow.maxAmmo) take = false;
      if (take && k.kind === 'health' && p.hp >= p.maxHp) take = false;
      if (take) {
        if (k.kind === 'arrows') { g.bow.ammo = Math.min(g.bow.maxAmmo, g.bow.ammo + k.n); g.ui.flash(`+${k.n} ARROWS`, 'gold', 0.7); }
        else { p.heal(k.n); g.ui.flash(`+${k.n} HEALTH`, 'green', 0.7); }
        g.audio.play('pickup', { vol: 0.6 });
        g.scene.remove(k.obj); this.list.splice(i, 1); continue;
      }
      if (k.life <= 0) { g.scene.remove(k.obj); this.list.splice(i, 1); }
    }
  }
}
