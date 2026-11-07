// AudioManager — WebAudio playback of the downloaded SFX/music. Dynamic music:
// tracks crossfade with combat intensity, a low-pass filter ducks on death/pause,
// and Blood God mode drives a filter sweep + layered stingers.
const range = (pre, n, ext = 'ogg', start = 1) => Array.from({ length: n }, (_, i) => `sfx/${pre}${i + start}.${ext}`);

export const SFX = {
  swing: range('swish_', 6, 'wav').map((_, i) => `sfx/swish_${[1, 3, 5, 7, 9, 11][i]}.wav`),
  swordHit: range('sword_', 6),
  clash: range('clash_', 6),
  fleshHit: range('punch_heavy_', 5, 'ogg', 0),
  boneHit: range('bone_', 5, 'ogg', 0),
  metalHeavy: range('metal_heavy_', 5, 'ogg', 0),
  step: range('step_', 5, 'ogg', 0),
  arrowHit: range('arrow_hit_', 5, 'ogg', 0),
  slam: range('slam_', 7),
  explosion: ['sfx/explosion.ogg'],
  gong: ['sfx/gong.ogg', 'sfx/gong_2.ogg'],
  bell: ['sfx/bell.ogg'],
  bowRelease: ['sfx/bow_release.wav'],
  bowDraw: ['sfx/bow_draw.ogg'],
  dodge: ['sfx/dodge.ogg', 'sfx/dodge_2.ogg'],
  slice: ['sfx/slice.ogg', 'sfx/slice_2.ogg', 'sfx/chop.ogg'],
  pickup: ['sfx/pickup.ogg'],
  grunt: range('grunt_', 5),
  hurt: range('hurt_', 5),
  roar: [...range('roar_', 3), ...range('creature_roar_', 3)],
  monster: range('monster_', 3),
  death: ['sfx/die_1.ogg', 'sfx/scream_1.ogg', 'sfx/hurt_4.ogg'],
  fire: ['sfx/fire_1.ogg', 'sfx/fire_2.ogg'],
  spell: ['sfx/spell_1.ogg', 'sfx/spell_2.ogg'],
  blade: ['sfx/blade_1.ogg', 'sfx/blade_2.ogg', 'sfx/rpg_metal_1.ogg'],
  chain: ['sfx/chain.ogg'],
  thunder: ['sfx/thunder.mp3'],
  uiClick: ['sfx/ui_click_002.ogg'], uiConfirm: ['sfx/ui_confirmation_002.ogg'], uiBack: ['sfx/ui_back_002.ogg'],
  uiOpen: ['sfx/ui_maximize_001.ogg'], uiError: ['sfx/ui_error_004.ogg'], uiSelect: ['sfx/ui_select_001.ogg'], uiSwitch: ['sfx/ui_switch_002.ogg'],
};

export const MUSIC = {
  menu: 'music/heroic_demise.mp3',
  battle: 'music/battle_theme_a.mp3',
  intense: 'music/battle_rpg_theme.mp3',
  boss: 'music/colossal_boss.mp3',
};

export class AudioManager {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.filter = this.ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 20000;
    this.master.connect(this.filter); this.filter.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain(); this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain(); this.musicBus.connect(this.master);
    this.buffers = {};
    this.tracks = {}; // name -> {src, gain}
    this.volumes = { master: 0.9, music: 0.55, sfx: 0.9 };
    this.applyVolumes();
    this.lastPlay = {};
    this.current = null;
  }

  fileCount() { return new Set([...Object.values(SFX).flat(), ...Object.values(MUSIC)]).size; }

  async loadAll(base, tick) {
    const files = [...new Set([...Object.values(SFX).flat(), ...Object.values(MUSIC)])];
    await Promise.all(files.map(async f => {
      try {
        const res = await fetch(base + 'audio/' + f);
        const ab = await res.arrayBuffer();
        this.buffers[f] = await this.ctx.decodeAudioData(ab);
      } catch (e) { console.warn('audio failed', f, e); }
      tick?.(f);
    }));
  }

  applyVolumes() {
    this.master.gain.value = this.volumes.master;
    this.musicBus.gain.value = this.volumes.music;
    this.sfxBus.gain.value = this.volumes.sfx;
  }

  resume() { if (this.ctx.state !== 'running') this.ctx.resume(); }

  // play('swordHit', {vol, rate, pan})
  play(name, { vol = 1, rate = 1, jitter = 0.08, pan = 0, minGap = 0.03, delay = 0 } = {}) {
    const list = SFX[name]; if (!list) return;
    const now = this.ctx.currentTime;
    if (this.lastPlay[name] && now - this.lastPlay[name] < minGap) return;
    this.lastPlay[name] = now;
    const file = list[(Math.random() * list.length) | 0];
    const buf = this.buffers[file]; if (!buf) return;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);
    const g = this.ctx.createGain(); g.gain.value = vol;
    let node = src.connect(g);
    if (pan && this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); node = p; } else node = g;
    node.connect(this.sfxBus);
    src.start(now + delay);
    return src;
  }

  playMusic(name, { fade = 2, vol = 1 } = {}) {
    if (this.current === name) return;
    const now = this.ctx.currentTime;
    for (const [n, t] of Object.entries(this.tracks)) {
      if (n === 'ambience') continue;
      t.gain.gain.cancelScheduledValues(now);
      t.gain.gain.setValueAtTime(t.gain.gain.value, now);
      t.gain.gain.linearRampToValueAtTime(0, now + fade);
      t.src.stop(now + fade + 0.1);
      delete this.tracks[n];
    }
    this.current = name;
    if (!name) return;
    const buf = this.buffers[MUSIC[name]]; if (!buf) return;
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const g = this.ctx.createGain(); g.gain.value = 0;
    src.connect(g); g.connect(this.musicBus);
    src.start();
    g.gain.linearRampToValueAtTime(vol, now + fade);
    this.tracks[name] = { src, gain: g };
  }

  setAmbience(on, vol = 0.5) {
    const now = this.ctx.currentTime;
    if (on && !this.tracks.ambience) {
      const buf = this.buffers[MUSIC.ambience]; if (!buf) return;
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const g = this.ctx.createGain(); g.gain.value = 0; src.connect(g); g.connect(this.musicBus); src.start();
      g.gain.linearRampToValueAtTime(vol, now + 3);
      this.tracks.ambience = { src, gain: g };
    } else if (this.tracks.ambience) {
      const t = this.tracks.ambience; t.gain.gain.cancelScheduledValues(now); t.gain.gain.setValueAtTime(t.gain.gain.value, now);
      t.gain.gain.linearRampToValueAtTime(on ? vol : 0, now + 2);
    }
  }

  // Muffle everything (pause / death / slow-mo).
  setMuffle(amount, time = 0.4) {
    const now = this.ctx.currentTime;
    const f = amount <= 0 ? 20000 : 20000 * Math.pow(0.02, amount);
    this.filter.frequency.cancelScheduledValues(now);
    this.filter.frequency.setValueAtTime(this.filter.frequency.value, now);
    this.filter.frequency.exponentialRampToValueAtTime(Math.max(200, f), now + time);
  }

  setMusicRate(rate) { for (const t of Object.values(this.tracks)) t.src.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.2); }
}
