// WaveManager — composes each wave from the archetypes (counts, new types, elites, bosses
// every fifth wave), scales health/damage/aggression, streams spawns in batches so the
// arena never floods, and runs the announce → fight → complete → prep loop.
import { BOSS_ORDER, ENEMY_TYPES } from '../enemies/EnemyTypes.js';

export class WaveManager {
  constructor(game) { this.game = game; this.reset(); }

  reset() {
    this.wave = 0; this.state = 'idle'; this.t = 0;
    this.queue = []; this.total = 0; this.killed = 0; this.spawnT = 0;
    this.waveKills = 0; this.waveStart = 0; this.waveDamage = 0;
    this.boss = null;
  }

  enemyOpts() {
    const w = this.wave;
    const pk = this.game.mode === 'parkour';
    // Mode 2 enemies move faster to keep pace with the parkour player
    return { hpMult: 1 + (w - 1) * 0.11, dmgMult: 1 + (w - 1) * 0.06, aggr: Math.min(1, (w - 1) / 14 + (pk ? 0.15 : 0)), speedMult: pk ? 1.3 : 1 };
  }

  compose(w) {
    const q = [];
    const add = (type, n) => { for (let i = 0; i < n; i++) q.push(type); };
    const isBoss = w % 5 === 0;
    if (isBoss) {
      const bossType = BOSS_ORDER[((w / 5) - 1) % BOSS_ORDER.length];
      q.push('BOSS:' + bossType);
      add('grunt', 2 + Math.floor(w / 5));
      if (w >= 10) add('mage', 2);
      if (w >= 15) add('elite', 1);
      return q;
    }
    add('grunt', 3 + Math.floor(w * 1.1));
    if (w >= 2) add('runner', Math.floor(1 + (w - 1) * 0.6));
    if (w >= 3) add('mage', Math.floor(1 + (w - 3) * 0.4));
    if (w >= 4) add('brute', Math.floor(1 + (w - 4) / 3));
    if (w >= 6) add('marksman', Math.floor(1 + (w - 6) / 3));
    if (w >= 7) add('elite', Math.floor(1 + (w - 7) / 3));
    // shuffle but keep a couple of grunts first so each wave opens readable
    const head = q.splice(0, 2);
    for (let i = q.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [q[i], q[j]] = [q[j], q[i]]; }
    return [...head, ...q];
  }

  maxAlive() { return Math.min(14, 5 + Math.floor(this.wave * 0.8)); }

  start() { this.reset(); this.nextWave(); }

  nextWave() {
    const g = this.game;
    this.wave++;
    this.queue = this.compose(this.wave);
    this.total = this.queue.length; this.killed = 0; this.waveKills = 0;
    this.state = 'announce'; this.t = 0;
    g.enemies.director.configure(this.wave);
    const isBoss = this.wave % 5 === 0;
    const newTypes = this.newTypesThisWave();
    g.ui.waveAnnounce(this.wave, isBoss ? ENEMY_TYPES[this.queue[0].split(':')[1]].name : null, newTypes);
    g.audio.play('gong', { vol: 0.9 });
    if (isBoss) { g.audio.play('roar', { vol: 0.9, rate: 0.55, delay: 0.6 }); g.audio.playMusic('boss', { fade: 2.5 }); }
    else g.audio.playMusic(this.wave >= 7 ? 'intense' : 'battle', { fade: 2.5 });
  }

  newTypesThisWave() {
    const intro = { 2: 'Skeleton Rogues — fast, relentless', 3: 'Skeleton Mages — counter their fireballs to deflect', 4: 'Orc Brutes — dodge heavy swings, strike their back', 6: 'Skeleton Marksmen — close the distance', 7: 'Skeleton Champions — shields block: use heavy attacks (E)' };
    return intro[this.wave] ?? null;
  }

  extraSpawned(n) { this.total += n; }

  onEnemyKilled(e) {
    this.killed++; this.waveKills++;
    if (e === this.boss) { this.boss = null; this.game.ui.bossBar(null); this.game.ui.flash(`${e.def.name.toUpperCase()} HAS FALLEN`, 'gold', 2); this.game.time.slowmo(0.25, 1.4); }
  }

  get remaining() { return this.total - this.killed; }

  update(dt) {
    const g = this.game;
    this.t += dt;
    switch (this.state) {
      case 'announce':
        if (this.t > 2.4) { this.state = 'active'; this.t = 0; this.spawnT = 0; this.waveStart = g.time.elapsed; this.hpAtStart = g.player.hp; }
        break;
      case 'active': {
        this.spawnT -= dt;
        const alive = g.enemies.aliveCount;
        if (this.queue.length && this.spawnT <= 0 && alive < this.maxAlive()) {
          const type = this.queue.shift();
          const opts = this.enemyOpts();
          if (type.startsWith('BOSS:')) {
            const bt = type.split(':')[1];
            const boss = g.enemies.spawn(bt, { ...opts, hpMult: 1 + (this.wave - 5) * 0.08 });
            this.boss = boss; g.ui.bossBar(boss);
            this.spawnT = 2.5;
          } else {
            g.enemies.spawn(type, opts);
            this.spawnT = alive < 3 ? 0.35 : 0.9;
          }
        }
        if (!this.queue.length && this.remaining <= 0 && alive === 0) this.complete();
        break;
      }
      case 'complete':
        if (this.t > 4.2) { this.state = 'prep'; this.t = 0; g.ui.prep(true); g.audio.playMusic(null, { fade: 3 }); }
        break;
      case 'prep': {
        const left = Math.max(0, 7 - this.t);
        g.ui.prepCountdown(left);
        if (left <= 0) { g.ui.prep(false); this.nextWave(); }
        break;
      }
    }
  }

  complete() {
    const g = this.game;
    this.state = 'complete'; this.t = 0;
    const time = g.time.elapsed - this.waveStart;
    const bonus = Math.round(1000 * this.wave + Math.max(0, 90 - time) * 20 + (g.player.hp >= this.hpAtStart ? 1500 : 0));
    g.addScore(bonus);
    const heal = Math.round(g.player.maxHp * 0.3);
    g.player.heal(heal);
    g.bow.ammo = g.bow.maxAmmo;
    g.ui.waveComplete({ wave: this.wave, kills: this.waveKills, time, bonus, heal, flawless: g.player.hp >= this.hpAtStart, bestCombo: g.combat.bestCombo });
    g.audio.play('bell', { vol: 0.8 }); g.audio.play('gong', { vol: 0.4, rate: 1.4, delay: 0.3 });
    if (g.player.is('idle', 'move')) { g.player.anim.play('Cheer', { fade: 0.2, once: true, restart: true }); g.player.setState('emote'); }
  }
}
