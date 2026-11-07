// MainMenu — overlay panels on top of the live 3D scene (Technoblade standing in the torch-lit
// courtyard while the camera slowly orbits). PLAY / HOW TO PLAY / SETTINGS / CREDITS.
import { ACTION_LABELS } from '../core/Input.js';
const $ = (s) => document.querySelector(s);

export const CREDITS = [
  ['Technoblade body, armour, cape, 2H sword', 'KayKit Character Pack: Adventurers (Knight) — Kay Lousberg', 'CC0', 'https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0'],
  ['Pig head', 'Pig (Animated Farm Animals) — Quaternius via Poly Pizza', 'CC0', 'https://poly.pizza/m/u35l6uP5vj'],
  ['Crown', 'Crown — Quaternius via Poly Pizza', 'CC0', 'https://poly.pizza/m/i0PZVuVlYv'],
  ['Bow', 'Wooden Bow — Quaternius via Poly Pizza', 'CC0', 'https://poly.pizza/m/QnpqjLSKFU'],
  ['Arrows, arrow bundle', 'KayKit Adventurers — Kay Lousberg', 'CC0', 'https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0'],
  ['Skeleton enemies, weapons, 95 animations', 'KayKit Character Pack: Skeletons — Kay Lousberg', 'CC0', 'https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0'],
  ['Orc, Demon, Frost Fiend, Colossus', 'Ultimate Monsters — Quaternius via Poly Pizza', 'CC0', 'https://poly.pizza/u/Quaternius'],
  ['Fortress walls, pillars, torches, banners, props, potion', 'KayKit Dungeon Remastered — Kay Lousberg', 'CC0', 'https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0'],
  ['Dead trees, rocks', 'Quaternius via Poly Pizza', 'CC0', 'https://poly.pizza/u/Quaternius'],
  ['Graves', 'Kay Lousberg via Poly Pizza', 'CC0', 'https://poly.pizza/u/Kay%20Lousberg'],
  ['Night sky HDRI, cobblestone & rocky ground PBR textures', 'Poly Haven (moonless_golf, cobblestone_floor_04, rocky_trail)', 'CC0', 'https://polyhaven.com'],
  ['Particle textures', 'Particle Pack — Kenney', 'CC0', 'https://kenney.nl/assets/particle-pack'],
  ['Impact, footstep, UI and RPG sounds', 'Impact Sounds / Interface Sounds / RPG Audio — Kenney', 'CC0', 'https://kenney.nl'],
  ['Sword swings & clashes', '20 Sword Sound Effects — StarNinjas (OpenGameArt)', 'CC0', 'https://opengameart.org/content/20-sword-sound-effects-attacks-and-clashes'],
  ['Swishes', 'Swishes Sound Pack — artisticdude (OpenGameArt)', 'CC0', 'https://opengameart.org/content/swishes-sound-pack'],
  ['Creature & RPG SFX', '80 CC0 creature SFX / 80 CC0 RPG SFX / 100 CC0 SFX — rubberduck (OpenGameArt)', 'CC0', 'https://opengameart.org/content/80-cc0-creature-sfx'],
  ['Bow release', 'Battle Sound Effects — Ogrebane (OpenGameArt)', 'CC0 (multi-licensed)', 'https://opengameart.org/content/battle-sound-effects'],
  ['Thunder', 'Thunder, Very Close, Rain, 01 — InspectorJ (OpenGameArt)', 'CC-BY 3.0', 'https://opengameart.org/content/thunder-very-close-rain-01'],
  ['Battle music', 'Battle Theme A — cynicmusic (OpenGameArt)', 'CC0', 'https://opengameart.org/content/battle-theme-a'],
  ['Intense battle music', 'Boss Battle Theme — CleytonRX (OpenGameArt)', 'CC0', 'https://opengameart.org/content/boss-battle-theme'],
  ['Boss music', 'Epic Boss Battle — migfus20 (OpenGameArt)', 'CC-BY 4.0', 'https://opengameart.org/content/epic-boss-battle'],
  ['Menu / death music', 'Heroic Demise (Updated) — Matthew Pablo (OpenGameArt)', 'CC-BY 3.0', 'https://opengameart.org/content/heroic-demise-updated-version'],
  ['UI icons', 'game-icons.net — Lorc, Delapouite', 'CC-BY 3.0', 'https://game-icons.net'],
  ['Fonts', 'Cinzel, Cinzel Decorative — Natanael Gama (Google Fonts)', 'OFL', 'https://fonts.google.com/specimen/Cinzel'],
];

export class MainMenu {
  constructor(game) {
    this.game = game;
    this.root = $('#main-menu');
    this.panel = null;
    this.root.querySelectorAll('[data-action]').forEach(b => {
      b.addEventListener('mouseenter', () => game.audio.play('uiSelect', { vol: 0.25 }));
      b.addEventListener('click', () => this.action(b.dataset.action));
    });
    document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => { game.audio.play('uiBack', { vol: 0.5 }); this.open(null); }));
    // pause / death buttons
    $('#pm-resume').onclick = () => { game.audio.play('uiConfirm', { vol: 0.5 }); game.resume(); };
    $('#pm-restart').onclick = () => { game.audio.play('uiConfirm', { vol: 0.5 }); game.restart(); };
    $('#pm-settings').onclick = () => { game.audio.play('uiClick', { vol: 0.5 }); this.open('settings'); $('#settings-panel').classList.add('over-pause'); };
    $('#pm-quit').onclick = () => { game.audio.play('uiBack', { vol: 0.5 }); $('#pause-menu').className = ''; game.enterMenu(); };
    $('#ds-restart').onclick = () => { game.audio.play('uiConfirm', { vol: 0.5 }); game.restart(); };
    $('#ds-menu').onclick = () => { game.audio.play('uiBack', { vol: 0.5 }); $('#death-screen').className = ''; game.enterMenu(); };
    this.buildCredits();
    this.bindSettings();
  }

  show() { this.root.classList.add('show'); this.open(null); this.game.modes?.refreshBests(); }
  hide() { this.root.classList.remove('show'); this.open(null); }

  action(a) {
    const g = this.game;
    g.audio.resume();
    if (a === 'play') { g.audio.play('uiConfirm', { vol: 0.6 }); g.modes.open(); return; } // -> mode select
    g.audio.play('uiOpen', { vol: 0.5 });
    this.open(a);
  }

  open(name) {
    for (const p of document.querySelectorAll('.menu-panel')) p.classList.toggle('show', p.id === name + '-panel');
    this.root.classList.toggle('panel-open', !!name);
    if (!name) $('#settings-panel').classList.remove('over-pause');
  }

  buildCredits() {
    $('#credits-list').innerHTML = CREDITS.map(([what, who, lic, url]) =>
      `<div class="credit"><div class="c-what">${what}</div><div class="c-who"><a href="${url}" target="_blank" rel="noopener">${who}</a></div><div class="c-lic">${lic}</div></div>`).join('');
  }

  bindSettings() {
    const g = this.game, s = g.settings;
    const bindRange = (id, key) => {
      const i = $(id); i.value = s[key];
      const out = i.parentElement.querySelector('output');
      const upd = () => { s[key] = +i.value; if (out) out.textContent = Math.round(+i.value * 100) + '%'; g.saveSettings(); };
      i.addEventListener('input', upd); upd();
    };
    bindRange('#set-master', 'master'); bindRange('#set-music', 'music'); bindRange('#set-sfx', 'sfx'); bindRange('#set-sens', 'sensitivity');
    const inv = $('#set-invert'); inv.checked = s.invertY; inv.onchange = () => { s.invertY = inv.checked; g.saveSettings(); };
    const q = $('#set-quality'); q.value = s.quality; q.onchange = () => { s.quality = q.value; g.saveSettings(); };
    const sh = $('#set-shake'); sh.checked = s.shake > 0; sh.onchange = () => { s.shake = sh.checked ? 1 : 0; g.saveSettings(); };
    const fs = $('#set-fullscreen'); fs.checked = !!document.fullscreenElement;
    fs.onchange = () => { try { if (fs.checked) document.documentElement.requestFullscreen(); else if (document.fullscreenElement) document.exitFullscreen(); } catch { /* ignore */ } };
    document.addEventListener('fullscreenchange', () => { fs.checked = !!document.fullscreenElement; });
    // key rebinding, per mode
    this.bindMode = 'arkham';
    document.querySelectorAll('[data-bind-mode]').forEach(b => b.onclick = () => {
      this.bindMode = b.dataset.bindMode;
      document.querySelectorAll('[data-bind-mode]').forEach(x => x.classList.toggle('on', x === b));
      this.renderBindings();
    });
    $('.bind-reset').onclick = () => { g.input.resetBindings(this.bindMode); this.renderBindings(); g.ui.keyLabels(); g.audio.play('uiConfirm', { vol: 0.4 }); };
    this.renderBindings();
  }

  renderBindings() {
    const g = this.game, mode = this.bindMode;
    const set = g.input.bindings(mode);
    const pretty = (c) => (c || '—').replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' L').replace('Right', ' R').replace('Control', 'Ctrl').replace('Arrow', '↑ ').replace('Escape', 'Esc');
    const list = $('#bind-list'); list.innerHTML = '';
    for (const [action, codes] of Object.entries(set)) {
      const row = document.createElement('div'); row.className = 'bind-row';
      row.innerHTML = `<span>${ACTION_LABELS[action] || action}</span><button tabindex="-1">${pretty(codes[0])}${codes[1] ? ' / ' + pretty(codes[1]) : ''}</button>`;
      const btn = row.querySelector('button');
      btn.onclick = () => {
        btn.textContent = 'Press a key…'; btn.classList.add('listening');
        g.input.rebind(mode, action, () => { g.audio.play('uiConfirm', { vol: 0.4 }); this.renderBindings(); g.ui.keyLabels(); });
      };
      list.appendChild(row);
    }
  }
}
