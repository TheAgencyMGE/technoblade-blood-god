// ModeManager — the two combat experiences. Shows the cinematic mode-select screen (two
// large cards, each with a live 3D render of Technoblade performing that mode's style),
// applies a mode cleanly (arena layout, key bindings, HUD, camera rig) so one mode can never
// leak the other's controls, and keeps separate high scores / stats per mode.
import * as THREE from 'three';
import { Animator } from '../core/Animator.js';

export const MODES = {
  arkham: { key: 'arkham', title: 'Arkham Combat', sub: 'Free-flow · Counters · Finishers' },
  parkour: { key: 'parkour', title: 'Parkour Combat', sub: 'Momentum · Wall-runs · Slides' },
};

const $ = (s) => document.querySelector(s);

export class ModeManager {
  constructor(game) {
    this.game = game;
    this.el = $('#mode-select');
    this.previews = {};
    this.buildPreview('arkham');
    this.buildPreview('parkour');
    for (const card of this.el.querySelectorAll('.mode-card')) {
      card.addEventListener('mouseenter', () => { game.audio.play('uiSelect', { vol: 0.3 }); this.hover = card.dataset.mode; });
      card.addEventListener('mouseleave', () => { this.hover = null; });
      card.addEventListener('click', () => this.choose(card.dataset.mode));
    }
    this.el.querySelector('.back').addEventListener('click', () => { game.audio.play('uiBack', { vol: 0.5 }); this.close(); game.menu.show(); });
    // Leaving mid-run (e.g. Ctrl+W while sliding in windowed mode) asks first.
    addEventListener('beforeunload', (e) => { if (['playing', 'paused', 'intro'].includes(game.state)) { e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('fullscreenchange', () => this.lockKeys());
    try { const old = localStorage.getItem('tbg-best'); if (old && !localStorage.getItem('tbg-best-arkham')) localStorage.setItem('tbg-best-arkham', old); } catch { /* ignore */ }
    this.refreshBests();
  }

  // --- live 3D previews -------------------------------------------------------
  buildPreview(mode) {
    const g = this.game;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0x8a7aa8, 0x2a1210, 1.1));
    const key = new THREE.DirectionalLight(mode === 'arkham' ? 0xff8a5a : 0x9ad8ff, 2.2); key.position.set(2, 4, 3); scene.add(key);
    const rim = new THREE.DirectionalLight(mode === 'arkham' ? 0xff2a1a : 0x4ac8ff, 1.6); rim.position.set(-3, 2, -2); scene.add(rim);
    scene.environment = g.scene.environment; scene.environmentIntensity = 0.3;
    const hero = g.assets.buildTechnoblade();
    scene.add(hero.root);
    const anim = new Animator(hero.root, g.assets.clips.kaykit);
    const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    if (mode === 'arkham') { cam.position.set(2.2, 2.2, 5.2); anim.play('2H_Melee_Idle', { fade: 0 }); }
    else { cam.position.set(-3.2, 2.0, 4.4); anim.play('Running_B', { fade: 0, timeScale: 1.35 }); hero.root.rotation.order = 'YXZ'; }
    cam.lookAt(0, 1.35, 0);
    this.previews[mode] = { scene, hero, anim, cam, t: 0, step: 0, el: this.el.querySelector(`.mode-card[data-mode="${mode}"] .mode-view`) };
  }

  updatePreviews(dt) {
    for (const [mode, p] of Object.entries(this.previews)) {
      p.t += dt;
      const hovered = this.hover === mode;
      if (mode === 'arkham') {
        // idle stance, then a combo string: slice, counter, spin
        if (p.anim.finished() || p.anim.currentName === '2H_Melee_Idle') {
          if (p.t > (hovered ? 0.6 : 1.6)) {
            const seq = ['2H_Melee_Attack_Slice', 'Block_Attack', '1H_Melee_Attack_Slice_Diagonal', '2H_Melee_Attack_Spin'];
            p.anim.play(seq[p.step++ % seq.length], { fade: 0.08, once: true, restart: true, timeScale: 1.25 }); p.t = 0;
          } else if (p.anim.finished()) p.anim.play('2H_Melee_Idle', { fade: 0.2 });
        }
        p.hero.root.rotation.y = 0.35 + Math.sin(performance.now() * 0.0004) * 0.15;
      } else {
        // sprinting with a wall-run lean, punctuated by slide + dash poses
        const cyc = (p.t % 4.2);
        if (cyc < 2.6) { p.anim.play('Running_B', { fade: 0.15, timeScale: 1.35 }); p.hero.root.rotation.z = Math.sin(p.t * 1.4) * 0.3; p.hero.root.rotation.x = 0.15; }
        else if (cyc < 3.4) { p.anim.play('Sit_Floor_Pose', { fade: 0.1 }); p.hero.root.rotation.x = -0.28; p.hero.root.rotation.z = 0; }
        else { p.anim.play('2H_Melee_Attack_Stab', { fade: 0.06, once: true, timeScale: 1.6 }); p.hero.root.rotation.x = 0.3; }
        p.hero.root.rotation.y = 0.9;
      }
      p.anim.update(dt * (hovered ? 1.3 : 1));
    }
  }

  renderPreviews() {
    const r = this.game.renderer;
    r.autoClear = false;
    r.setScissorTest(true);
    for (const p of Object.values(this.previews)) {
      const b = p.el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      const y = innerHeight - b.bottom;
      r.setViewport(b.left, y, b.width, b.height); r.setScissor(b.left, y, b.width, b.height);
      p.cam.aspect = b.width / b.height; p.cam.updateProjectionMatrix();
      r.clearDepth();
      r.render(p.scene, p.cam);
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, innerWidth, innerHeight);
    r.autoClear = true;
  }

  // --- flow -----------------------------------------------------------------
  open() {
    const g = this.game;
    g.state = 'modeselect';
    g.menu.hide();
    this.refreshBests();
    this.el.className = 'show';
    g.post.dimTarget = 0.55;
    g.player.root.visible = false; // the cards carry their own 3D heroes
    g.audio.play('uiOpen', { vol: 0.5 });
  }
  close() { this.el.className = ''; this.game.post.dimTarget = 0; this.game.player.root.visible = true; if (this.game.state === 'modeselect') this.game.state = 'menu'; }

  choose(mode) {
    const g = this.game;
    g.audio.play('uiConfirm', { vol: 0.6 }); g.audio.play('gong', { vol: 0.4 });
    this.close();
    g.startGame(mode);
  }

  // Apply everything a mode owns. Called on start/restart.
  apply(mode) {
    const g = this.game;
    if (g.mode === 'parkour' && mode !== 'parkour') g.parkour.stop();
    g.mode = mode;
    g.input.setMode(mode);
    g.arena.setMode(mode);
    document.body.classList.toggle('mode-parkour', mode === 'parkour');
    document.body.classList.toggle('mode-arkham', mode === 'arkham');
    if (mode !== 'parkour') document.body.classList.remove('pk-tp');
    g.ui.keyLabels();
    g.post.showViewModel(false);
    g.player.root.visible = true;
    g.player.root.rotation.set(0, g.player.root.rotation.y, 0);
    this.lockKeys();
  }

  // In fullscreen, capture browser-reserved shortcuts (Ctrl+W etc.) so Ctrl can be the slide key.
  lockKeys() {
    try {
      if (document.fullscreenElement && navigator.keyboard?.lock) navigator.keyboard.lock();
      else if (navigator.keyboard?.unlock) navigator.keyboard.unlock();
    } catch { /* not supported */ }
  }

  // --- per-mode records -----------------------------------------------------
  best(mode) { return +(localStorage.getItem('tbg-best-' + mode) || 0); }
  stats(mode) { try { return JSON.parse(localStorage.getItem('tbg-stats-' + mode) || '{}'); } catch { return {}; } }
  record(mode, run) {
    const best = Math.max(this.best(mode), run.score);
    const s = this.stats(mode);
    s.runs = (s.runs || 0) + 1; s.kills = (s.kills || 0) + run.kills; s.bestWave = Math.max(s.bestWave || 0, run.wave); s.bestCombo = Math.max(s.bestCombo || 0, run.combo);
    try { localStorage.setItem('tbg-best-' + mode, String(best)); localStorage.setItem('tbg-stats-' + mode, JSON.stringify(s)); } catch { /* ignore */ }
    return { best, stats: s };
  }
  refreshBests() {
    for (const m of Object.keys(MODES)) {
      const el = this.el.querySelector(`.mode-card[data-mode="${m}"] .mode-best`);
      const s = this.stats(m);
      if (el) el.innerHTML = `Best <b>${this.best(m).toLocaleString()}</b> · Wave <b>${s.bestWave || 0}</b> · Runs <b>${s.runs || 0}</b>`;
    }
    const mb = document.getElementById('menu-best');
    if (mb) mb.innerHTML = `Arkham <b>${this.best('arkham').toLocaleString()}</b> &nbsp;·&nbsp; Parkour <b>${this.best('parkour').toLocaleString()}</b>`;
  }
}
