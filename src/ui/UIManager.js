// UIManager — HUD, world-projected indicators (counter warnings, enemy health, damage
// numbers), hit markers, damage direction arcs, combo, wave announcements, results.
import * as THREE from 'three';
import { ABILITIES } from '../player/AbilityManager.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const ICON = (name) => `assets/ui/${name}.svg`;

export class UIManager {
  constructor(game) {
    this.game = game;
    this.hud = $('#hud');
    this.world = $('#world-ui');
    this.indicators = new Map(); // enemy -> element
    this.bars = new Map();
    this.numbers = [];
    this.v = new THREE.Vector3();
    this.lastHp = 100; this.trailHp = 100;
    this.comboEl = $('#combo'); this.comboNum = $('#combo-num'); this.comboMult = $('#combo-mult');
    this.buildAbilities();
    this.flashQueue = [];
  }

  buildAbilities() {
    const wrap = $('#abilities'); wrap.innerHTML = '';
    this.abEls = {};
    let i = 1;
    for (const [k, a] of Object.entries(ABILITIES)) {
      const d = el('div', 'ability');
      d.innerHTML = `<div class="ab-icon" style="--icon:url(${ICON(a.icon)})"></div><div class="ab-cd"></div><div class="ab-key">${i++}</div><div class="ab-name">${a.name}</div><div class="ab-charges"></div>`;
      wrap.appendChild(d); this.abEls[k] = d;
    }
    const f = el('div', 'ability finisher');
    f.innerHTML = `<div class="ab-icon" style="--icon:url(${ICON('crowned-skull')})"></div><div class="ab-cd"></div><div class="ab-key">X</div><div class="ab-name">Finisher</div>`;
    wrap.appendChild(f); this.abEls.finisher = f;
  }

  show(on) { this.hud.classList.toggle('hidden', !on); this.world.classList.toggle('hidden', !on); }

  reset() {
    for (const e of this.indicators.values()) e.remove(); this.indicators.clear();
    for (const e of this.bars.values()) e.remove(); this.bars.clear();
    for (const n of this.numbers) n.el.remove(); this.numbers.length = 0;
    this.bossBar(null); this.bloodGod(false); this.lock(null); this.crosshair(false); this.prep(false);
    $('#wave-announce').className = ''; $('#wave-complete').className = '';
    this.combo(0);
  }

  // ------------------------------------------------------------- per-frame
  update(dt) {
    const g = this.game, p = g.player;
    // health with lagging damage trail
    const hp = p.hp / p.maxHp;
    this.trailHp += (hp - this.trailHp) * Math.min(1, dt * (this.trailHp > hp ? 2.2 : 10));
    $('#hp-fill').style.width = (hp * 100).toFixed(1) + '%';
    $('#hp-trail').style.width = (Math.max(hp, this.trailHp) * 100).toFixed(1) + '%';
    $('#hp-text').textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    document.body.classList.toggle('low-hp', hp < 0.3 && p.alive);
    // blood god meter
    const m = g.abilities.meter / 100;
    $('#bg-fill').style.width = (m * 100).toFixed(1) + '%';
    $('#bg-meter').classList.toggle('full', m >= 1 && !g.abilities.bloodGod);
    $('#bg-meter').classList.toggle('active', g.abilities.bloodGod);
    // ammo
    $('#ammo-count').textContent = `${g.bow.ammo}`;
    $('#ammo').classList.toggle('empty', g.bow.ammo === 0);
    // wave / score
    $('#wave-num').textContent = g.waves.wave;
    $('#enemies-left').textContent = Math.max(0, g.waves.remaining);
    $('#score').textContent = g.score.toLocaleString();
    $('#kills').textContent = g.kills;
    // abilities
    for (const [k, a] of Object.entries(ABILITIES)) {
      const cd = g.abilities.cd[k], e = this.abEls[k];
      e.querySelector('.ab-cd').style.height = (cd / a.cd * 100) + '%';
      e.classList.toggle('ready', cd <= 0);
      e.querySelector('.ab-charges').textContent = k === 'crit' && g.combat.critCharges > 0 ? g.combat.critCharges : '';
    }
    const fr = g.combat.combo >= g.combat.finisherReadyAt;
    this.abEls.finisher.classList.toggle('ready', fr);
    this.abEls.finisher.querySelector('.ab-cd').style.height = fr ? '0%' : ((1 - g.combat.combo / g.combat.finisherReadyAt) * 100) + '%';
    // combo decay bar
    $('#combo-decay').style.width = (Math.max(0, g.combat.comboTimer) / 2.6 * 100) + '%';
    this.comboMult.textContent = `x${g.combat.multiplier}`;
    // boss bar
    if (this.boss) { $('#boss-fill').style.width = (Math.max(0, this.boss.hp) / this.boss.maxHp * 100) + '%'; $('#boss-bar').classList.toggle('enraged', this.boss.phase === 2); }

    this.updateWorldUI(dt);
  }

  project(pos) {
    const cam = this.game.camera;
    this.v.copy(pos).project(cam);
    const behind = this.v.z > 1;
    return { x: (this.v.x * 0.5 + 0.5) * innerWidth, y: (-this.v.y * 0.5 + 0.5) * innerHeight, behind };
  }

  updateWorldUI(dt) {
    const g = this.game;
    // counter indicators above attacking enemies
    for (const e of g.enemies.list) {
      const t = e.alive ? e.threat() : null;
      let ind = this.indicators.get(e);
      if (t && t.kind) {
        if (!ind) { ind = el('div', 'tele'); this.world.appendChild(ind); this.indicators.set(e, ind); }
        ind.dataset.kind = t.kind;
        const s = this.project(e.headPos().setY(e.position.y + e.height + 0.5));
        ind.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%,-50%) scale(${t.impactIn < 0.25 ? 1.25 : 1})`;
        ind.style.display = s.behind ? 'none' : '';
        ind.classList.toggle('imminent', t.impactIn < 0.3);
      } else if (ind) { ind.remove(); this.indicators.delete(e); }
      // health bars on damaged non-boss enemies
      let bar = this.bars.get(e);
      const show = e.alive && e.hp < e.maxHp && !e.boss && e.state !== 'spawning';
      if (show) {
        if (!bar) { bar = el('div', 'ebar', '<div class="ebar-fill"></div>'); this.world.appendChild(bar); this.bars.set(e, bar); }
        const s = this.project(this.v.set(e.position.x, e.position.y + e.height + 0.15, e.position.z));
        bar.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%,-50%)`;
        bar.style.display = s.behind ? 'none' : '';
        bar.firstChild.style.width = (e.hp / e.maxHp * 100) + '%';
        bar.classList.toggle('elite', !!(e.elite || e.heavyType));
      } else if (bar) { bar.remove(); this.bars.delete(e); }
    }
    for (const [e, ind] of this.indicators) if (!g.enemies.list.includes(e)) { ind.remove(); this.indicators.delete(e); }
    for (const [e, b] of this.bars) if (!g.enemies.list.includes(e)) { b.remove(); this.bars.delete(e); }
    // lock reticle
    if (this.lockTarget) {
      const t = this.lockTarget;
      const s = this.project(this.v.set(t.position.x, t.position.y + t.height * 0.55, t.position.z));
      const r = $('#lock-reticle'); r.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%,-50%)`; r.style.display = s.behind ? 'none' : 'block';
    }
    // floating damage numbers
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i]; n.t += dt;
      n.pos.y += dt * 1.4;
      const s = this.project(n.pos);
      const k = n.t / 0.9;
      n.el.style.transform = `translate(${s.x + n.dx * n.t * 40}px, ${s.y}px) translate(-50%,-50%) scale(${(n.crit ? 1.35 : 1) * (k < 0.15 ? 1.6 - k * 4 : 1)})`;
      n.el.style.opacity = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      n.el.style.display = s.behind ? 'none' : '';
      if (k >= 1) { n.el.remove(); this.numbers.splice(i, 1); }
    }
  }

  // ------------------------------------------------------------- events
  damageNumber(pos, value, crit) {
    if (this.numbers.length > 40) { const n = this.numbers.shift(); n.el.remove(); }
    const e = el('div', 'dmg' + (crit ? ' crit' : ''), String(value));
    this.world.appendChild(e);
    this.numbers.push({ el: e, pos: pos.clone().add(new THREE.Vector3(0, 0.4, 0)), t: 0, crit, dx: (Math.random() - 0.5) * 2 });
  }

  combo(n) {
    const c = this.comboEl;
    if (n < 2) { c.classList.remove('show'); return; }
    c.classList.add('show');
    this.comboNum.textContent = n;
    c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
    const praise = { 10: 'BRUTAL', 20: 'SAVAGE', 30: 'UNSTOPPABLE', 50: 'BLOOD GOD', 75: 'TECHNOBLADE NEVER DIES', 100: 'LEGENDARY' };
    if (praise[n]) this.flash(praise[n] + '!', n >= 50 ? 'red' : 'gold', 1.2);
  }
  comboEnd(n) { /* combo timed out */ }
  comboBroken(n) { this.flash(`COMBO BROKEN (${n})`, 'grey', 0.8); }

  flash(text, color = 'white', dur = 1) {
    const box = $('#flashes');
    const e = el('div', 'flash ' + color, text);
    box.appendChild(e);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => e.classList.add('out'), dur * 1000);
    setTimeout(() => e.remove(), dur * 1000 + 400);
  }

  hitMarker(crit, kill) {
    const h = $('#hitmarker');
    h.className = ''; void h.offsetWidth; h.className = 'show' + (crit ? ' crit' : '') + (kill ? ' kill' : '');
  }

  damageDirection(from) {
    const g = this.game, p = g.player;
    const dx = from.x - p.position.x, dz = from.z - p.position.z;
    const ang = Math.atan2(dx, dz) - Math.atan2(-Math.sin(g.cam.yaw), -Math.cos(g.cam.yaw));
    const d = el('div', 'dmg-dir');
    d.style.transform = `translate(-50%,-50%) rotate(${-ang}rad)`;
    $('#dmg-dirs').appendChild(d);
    setTimeout(() => d.remove(), 900);
    const v = $('#hurt-vignette'); v.classList.remove('hit'); void v.offsetWidth; v.classList.add('hit');
  }

  telegraph(enemy, kind) { /* indicators are driven per-frame from threat() */ }

  crosshair(on) { $('#crosshair').classList.toggle('show', on); }
  drawMeter(v) { $('#draw-ring').style.setProperty('--draw', v); $('#crosshair').classList.toggle('drawn', v >= 1); }

  lock(t) { this.lockTarget = t; $('#lock-reticle').classList.toggle('show', !!t); }

  bossBar(boss) {
    this.boss = boss;
    $('#boss-bar').classList.toggle('show', !!boss);
    if (boss) $('#boss-name').textContent = boss.def.name;
  }
  bossHit() { const b = $('#boss-bar'); b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit'); }

  bloodGod(on) {
    document.body.classList.toggle('blood-god', on);
    if (on) { const b = $('#bg-banner'); b.className = ''; void b.offsetWidth; b.className = 'show'; }
  }

  abilityUsed() {}

  waveAnnounce(n, bossName, newTypes) {
    const a = $('#wave-announce');
    $('#wa-num').textContent = n;
    $('#wa-sub').textContent = bossName ? `BOSS — ${bossName}` : n === 1 ? 'Blood for the Blood God' : ['The dead stir again', 'They will not stop', 'More rise from the earth', 'The horde grows hungrier'][n % 4];
    $('#wa-new').textContent = newTypes ? 'NEW: ' + newTypes : '';
    a.className = ''; void a.offsetWidth; a.className = 'show' + (bossName ? ' boss' : '');
  }

  waveComplete(s) {
    const w = $('#wave-complete');
    $('#wc-title').textContent = `WAVE ${s.wave} CLEARED`;
    $('#wc-stats').innerHTML = `
      <div><span>Kills</span><b>${s.kills}</b></div>
      <div><span>Time</span><b>${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')}</b></div>
      <div><span>Best Combo</span><b>${s.bestCombo}</b></div>
      <div><span>Wave Bonus</span><b>+${s.bonus.toLocaleString()}</b></div>
      ${s.flawless ? '<div class="flawless"><span>Flawless</span><b>+1,500</b></div>' : ''}
      <div class="heal"><span>Restored</span><b>+${s.heal} HP · Arrows refilled</b></div>`;
    w.className = ''; void w.offsetWidth; w.className = 'show';
    setTimeout(() => { w.className = 'out'; }, 3900);
  }

  // Key hints in the HUD follow the active mode's (rebindable) bindings.
  keyLabels() {
    const g = this.game, b = g.input.bindings(g.mode);
    const pretty = (c) => (c || '?').replace(/^Key/, '').replace(/^Digit/, '').replace('ControlLeft', 'Ctrl').replace('ControlRight', 'Ctrl').replace('ShiftLeft', 'Shift').replace('Left', '').replace('Right', '');
    const map = { bloodgod: g.mode === 'parkour' ? 'special' : 'ultimate' };
    document.querySelectorAll('[data-bind]').forEach(el => { const act = map[el.dataset.bind] ?? el.dataset.bind; if (b[act]) el.textContent = pretty(b[act][0]); });
    const view = b.view ? pretty(b.view[0]) : 'C';
    this.viewKey = view;
    if (g.mode === 'parkour') this.parkourView(g.parkour.view);
  }

  // ---------------- Mode 2 HUD ----------------
  parkourView(v) {
    document.body.classList.toggle('pk-tp', v === 'tp');
    $('#pk-view').innerHTML = (v === 'fp' ? '1ST PERSON' : '3RD PERSON') + ` <kbd>${this.viewKey ?? 'C'}</kbd>`;
  }

  parkourHud(mode) {
    const sp = mode.mover.speed;
    const ms = sp * 0.75; // world units -> metres (character is ~1.8 m)
    $('#pk-speed-val').textContent = Math.round(ms);
    $('#pk-speed-fill').style.width = Math.min(100, sp / 40 * 100) + '%';
    $('#pk-speed').classList.toggle('fast', sp > 12);
    const ab = mode.abilities();
    const set = (id, ready, cd) => {
      const el = $(id); const was = el.classList.contains('ready');
      el.classList.toggle('ready', ready);
      if (ready && !was) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } // "available" pulse
      const c = el.querySelector('.pk-cd'); if (c) c.style.height = (ready ? 0 : (cd ?? 1) * 100) + '%';
    };
    set('#pk-ab-dash', ab.dash.charges > 0);
    $('#pk-ab-dash').querySelectorAll('.pk-pips b').forEach((b, i) => b.classList.toggle('on', i < ab.dash.charges));
    set('#pk-ab-jump', ab.jump.ready, 1);
    set('#pk-ab-slide', ab.slide.cd <= 0, ab.slide.cd);
    set('#pk-ab-slam', ab.slam.cd <= 0, ab.slam.cd);
    set('#pk-ab-special', ab.special.ready, 1 - this.game.abilities.meter / 100);
    $('#pk-ab-special').classList.toggle('active', ab.special.active);
    this.crosshair(mode.combat.aiming);
    $('#pk-focus').classList.toggle('show', mode.combat.aiming && !mode.pk.grounded);
    $('#pk-focus-fill').style.width = (mode.combat.focus * 100) + '%';
  }

  prep(on) { $('#prep').classList.toggle('show', on); }
  prepCountdown(t) { $('#prep-time').textContent = Math.ceil(t); }
}
