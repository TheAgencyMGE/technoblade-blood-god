// Animator — thin layer over AnimationMixer: cross-faded state changes, one-shot actions
// with normalized-time queries (used for impact frames), per-action time scale, and an
// optional UPPER-BODY layer (attack swings over running legs) built by splitting existing
// clips into disjoint upper / lower bone sets.
import * as THREE from 'three';

// KayKit rig bones that belong to the upper body (track names are "<bone>.<prop>")
const UPPER = /^(spine|chest|head|neck|upperarm|lowerarm|wrist|hand|handslot|elbowIK|handIK)/i;

export class Animator {
  constructor(root, clipLib) {
    this.mixer = new THREE.AnimationMixer(root);
    this.lib = clipLib;
    this.actions = {};
    this.current = null; this.currentName = '';
    this.speed = 1;
    this.split = {}; // name -> {upper, lower}
    this.upperAction = null; this.upperName = '';
  }

  has(name) { return !!this.lib[name]; }

  splitClip(name) {
    if (this.split[name]) return this.split[name];
    const c = this.lib[name]; if (!c) return null;
    const isUpper = (t) => UPPER.test(t.name.split('.')[0]);
    const upper = new THREE.AnimationClip(name + '#upper', c.duration, c.tracks.filter(isUpper));
    const lower = new THREE.AnimationClip(name + '#lower', c.duration, c.tracks.filter(t => !isUpper(t)));
    return (this.split[name] = { upper, lower });
  }

  action(name) {
    if (!this.actions[name]) {
      let clip = this.lib[name];
      if (!clip && name.includes('#')) { const [base, part] = name.split('#'); clip = this.splitClip(base)?.[part]; }
      if (!clip) { console.warn('missing clip', name); return null; }
      this.actions[name] = this.mixer.clipAction(clip);
    }
    return this.actions[name];
  }

  // Play a looping/base animation. While an upper-body action runs, the base plays legs only.
  play(name, { fade = 0.18, timeScale = 1, once = false, restart = false, clampEnd = true } = {}) {
    const key = this.upperAction ? name + '#lower' : name;
    const a = this.action(key); if (!a) return null;
    if (this.current === a && !restart) { a.timeScale = timeScale; return a; }
    a.reset();
    a.enabled = true;
    a.setEffectiveWeight(1);
    a.timeScale = timeScale;
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    a.clampWhenFinished = once && clampEnd;
    if (this.current && this.current !== a) { a.crossFadeFrom(this.current, fade, false); }
    a.play();
    this.current = a; this.currentName = name;
    return a;
  }

  // Swap the current base action between its full and legs-only variant, keeping its time.
  _rebase(toLower) {
    if (!this.current) return;
    const name = this.currentName;
    const want = toLower ? name + '#lower' : name;
    const a = this.action(want); if (!a || a === this.current) return;
    const t = this.current.time, ts = this.current.timeScale, loop = this.current.loop, clamp = this.current.clampWhenFinished;
    this.current.stop();
    a.reset(); a.time = t; a.timeScale = ts; a.setLoop(loop, loop === THREE.LoopOnce ? 1 : Infinity); a.clampWhenFinished = clamp; a.setEffectiveWeight(1); a.play();
    this.current = a;
  }

  // One-shot upper-body animation layered over whatever the legs are doing.
  playUpper(name, { timeScale = 1, fade = 0.06 } = {}) {
    const a = this.action(name + '#upper'); if (!a) return null;
    if (!this.upperAction) this._rebase(true);
    else if (this.upperAction !== a) this.upperAction.fadeOut(fade);
    a.reset(); a.enabled = true; a.setEffectiveWeight(1); a.timeScale = timeScale;
    a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true;
    a.fadeIn(fade).play();
    this.upperAction = a; this.upperName = name;
    return a;
  }
  stopUpper(fade = 0.12) {
    if (!this.upperAction) return;
    this.upperAction.fadeOut(fade);
    const a = this.upperAction; this.upperAction = null; this.upperName = '';
    setTimeout(() => a.stop(), fade * 1000);
    this._rebase(false);
  }
  upperProgress() { const a = this.upperAction; return a ? Math.min(1, a.time / a.getClip().duration) : 1; }

  // Normalized progress (0..1) of the current action.
  progress() {
    const a = this.current; if (!a) return 0;
    return Math.min(1, a.time / a.getClip().duration);
  }
  duration(name) { return this.lib[name]?.duration ?? 1; }
  finished() { const a = this.current; return !a || (a.loop === THREE.LoopOnce && a.time >= a.getClip().duration - 1e-3); }

  update(dt) {
    this.mixer.update(dt * this.speed);
    if (this.upperAction && this.upperAction.time >= this.upperAction.getClip().duration - 1e-3) this.stopUpper();
  }
}
