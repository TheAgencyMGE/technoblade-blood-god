// ViewModel — first-person arms + weapons. A second instance of the Technoblade model with
// only its arms, diamond sword and bow visible, animated by the same KayKit clips (attack
// swings, bow stance), rendered in its own scene/pass so the blade never clips into walls.
// Code adds sway (mouse), bob (running) and landing/attack kick on top of the animation.
import * as THREE from 'three';
import { Animator } from '../core/Animator.js';

export class ViewModel {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.02, 30);
    this.scene.add(new THREE.HemisphereLight(0xc8b8ff, 0x3a1810, 1.1));
    const key = new THREE.DirectionalLight(0xffd0a0, 1.6); key.position.set(1, 2, 1); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff4a2a, 0.6); rim.position.set(-1, 0.5, -1); this.scene.add(rim);
    this.scene.environment = game.scene.environment; this.scene.environmentIntensity = 0.4;
    const hero = game.assets.buildTechnoblade();
    this.hero = hero;
    // keep only the weapons: KayKit's chunky arms filled the screen in first person (checked by image),
    // so the sword/bow are shown alone, still moved by the real hand-bone animations.
    const keep = new Set(['2H_Sword']);
    hero.root.traverse(o => { if (o.isMesh && !keep.has(o.name) && !this.isUnder(o, hero.bow)) o.visible = false; });
    hero.headGroup.visible = false;
    hero.root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
    this.rig = new THREE.Group(); this.rig.add(hero.root); this.scene.add(this.rig);
    hero.root.rotation.y = Math.PI; // model faces -Z (camera forward)
    this.anim = new Animator(hero.root, game.assets.clips.kaykit);
    this.anim.play('2H_Melee_Idle', { fade: 0 });
    // rig offset so the chest sits just below/behind the eye (tuned by image)
    this.offset = new THREE.Vector3(0.42, -1.32, -0.85);
    this.yawOff = -0.55; this.pitchOff = 0;
    this.sway = new THREE.Vector2(); this.bobT = 0; this.kick = 0; this.drop = 0;
    this.bowOn = false;
    addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); });
  }

  isUnder(o, parent) { let p = o; while (p) { if (p === parent) return true; p = p.parent; } return false; }

  showBow(on) {
    if (this.bowOn === on) return;
    this.bowOn = on;
    this.hero.bow.visible = on; this.hero.sword.visible = !on;
    this.anim.play(on ? 'Blocking' : '2H_Melee_Idle', { fade: 0.12 });
  }

  attack(anim, timeScale) { this.anim.play(anim, { fade: 0.04, once: true, restart: true, timeScale }); this.kick = 1; }
  slam() { this.anim.play('1H_Melee_Attack_Jump_Chop', { fade: 0.05, once: true, restart: true, timeScale: 1.3 }); }
  fire() { this.kick = 0.6; }
  land(impact) { this.drop = Math.min(0.25, impact * 0.012); }

  update(dt, pk, mouse, speed) {
    // return to idle stance after one-shots
    if (this.anim.finished() && this.anim.current?.loop === THREE.LoopOnce) this.anim.play(this.bowOn ? 'Blocking' : '2H_Melee_Idle', { fade: 0.15 });
    this.anim.update(dt);
    // sway lags behind mouse motion
    this.sway.x += (-(mouse?.dx ?? 0) * 0.0009 - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += ((mouse?.dy ?? 0) * 0.0009 - this.sway.y) * Math.min(1, dt * 10);
    let bx = 0, by = 0;
    if (pk.grounded && pk.state === 'ground' && speed > 1) { this.bobT += dt * (6 + speed * 0.55); bx = Math.cos(this.bobT) * 0.035; by = -Math.abs(Math.sin(this.bobT)) * 0.04; }
    this.kick = Math.max(0, this.kick - dt * 5); this.drop = Math.max(0, this.drop - dt * 1.5);
    const slide = pk.state === 'slide' ? 0.12 : 0;
    this.rig.position.set(this.offset.x + this.sway.x + bx, this.offset.y + this.sway.y + by - this.drop - slide, this.offset.z + this.kick * 0.08);
    this.rig.rotation.set(slide * 1.2 + this.pitchOff, this.sway.x * 2 + this.yawOff, pk.state === 'wallrun' ? -pk.wall.side * 0.15 : 0);
  }
}
