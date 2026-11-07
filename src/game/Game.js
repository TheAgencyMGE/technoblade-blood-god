// Game — boots every system, owns the main loop, time control (hit-stop / slow-mo),
// game-flow states (menu → intro → playing ⇄ paused → dead → restart), scoring.
import * as THREE from 'three';
import { AssetManager } from '../core/AssetManager.js';
import { AudioManager } from '../core/AudioManager.js';
import { Input } from '../core/Input.js';
import { VFX } from '../core/VFX.js';
import { CameraController } from '../core/CameraController.js';
import { PostFX } from '../core/PostFX.js';
import { Arena } from '../world/Arena.js';
import { PlayerController } from '../player/PlayerController.js';
import { CombatController } from '../player/CombatController.js';
import { WeaponController } from '../player/WeaponController.js';
import { BowController } from '../player/BowController.js';
import { AbilityManager } from '../player/AbilityManager.js';
import { EnemyManager } from '../enemies/EnemyManager.js';
import { Projectiles } from '../enemies/Projectiles.js';
import { Pickups } from './Pickups.js';
import { WaveManager } from './WaveManager.js';
import { UIManager } from '../ui/UIManager.js';
import { MainMenu } from '../ui/MainMenu.js';
import { ParkourMode } from '../parkour/ParkourMode.js';
import { ModeManager } from './ModeManager.js';

class TimeControl {
  constructor() { this.scale = 1; this.stopT = 0; this.slowT = 0; this.slowScale = 1; this.elapsed = 0; this.paused = false; this.focus = 1; }
  hitstop(d) { this.stopT = Math.max(this.stopT, d); }
  slowmo(scale, dur) { this.slowScale = Math.min(this.slowScale === 1 ? scale : this.slowScale, scale); this.slowT = Math.max(this.slowT, dur); }
  step(realDt) {
    if (this.stopT > 0) { this.stopT -= realDt; return realDt * 0.03; }
    if (this.slowT > 0) { this.slowT -= realDt; if (this.slowT <= 0) this.slowScale = 1; return realDt * this.slowScale * this.focus; }
    return realDt * this.focus; // focus = Mode 2 airborne-aim slow-mo
  }
  reset() { this.stopT = 0; this.slowT = 0; this.slowScale = 1; this.elapsed = 0; this.focus = 1; }
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'loading';
    this.settings = this.loadSettings();
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, this.settings.quality === 'high' ? 2 : 1.25));
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 400);
    this.time = new TimeControl();
    this.assets = new AssetManager();
    this.audio = new AudioManager();
    this.input = new Input(canvas);
    this.input.gameActive = () => this.state === 'playing' || this.state === 'intro' || this.state === 'dead';
    // all UI buttons: no focus ring/keyboard re-activation
    for (const b of document.querySelectorAll('button')) b.setAttribute('tabindex', '-1');
    this.score = 0; this.kills = 0;
    addEventListener('resize', () => this.onResize());
  }

  loadSettings() {
    const def = { master: 0.9, music: 0.55, sfx: 0.9, sensitivity: 1, invertY: false, quality: 'high', shake: 1 };
    try { return { ...def, ...JSON.parse(localStorage.getItem('tbg-settings') || '{}') }; } catch { return def; }
  }
  saveSettings() {
    try { localStorage.setItem('tbg-settings', JSON.stringify(this.settings)); } catch { /* storage unavailable */ }
    this.applySettings();
  }
  applySettings() {
    const s = this.settings;
    this.audio.volumes = { master: s.master, music: s.music, sfx: s.sfx }; this.audio.applyVolumes();
    this.input.sensitivity = s.sensitivity; this.input.invertY = s.invertY;
    if (this.post) this.post.enabled = s.quality !== 'low';
    if (this.cam) this.cam.shakeMult = s.shake;
    if (this.moon) { this.moon.shadow.mapSize.setScalar(s.quality === 'high' ? 2048 : 1024); if (this.moon.shadow.map) { this.moon.shadow.map.dispose(); this.moon.shadow.map = null; } }
  }

  async boot(onProgress) {
    await this.assets.loadAll(onProgress, this.audio);
    this.setupScene();
    this.vfx = new VFX(this.scene, this.assets, this.renderer);
    this.arena = new Arena(this.scene, this.assets, this.vfx);
    this.world = this.arena.collision;
    this.cam = new CameraController(this.camera, this.world);
    this.player = new PlayerController(this);
    this.combat = new CombatController(this);
    this.combat.analyzeImpacts(this.assets);
    this.weapon = new WeaponController(this);
    this.bow = new BowController(this);
    this.abilities = new AbilityManager(this);
    this.enemies = new EnemyManager(this);
    this.projectiles = new Projectiles(this);
    this.pickups = new Pickups(this);
    this.waves = new WaveManager(this);
    this.ui = new UIManager(this);
    this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.mode = 'arkham';
    this.parkour = new ParkourMode(this);
    this.applySettings();
    this.menu = new MainMenu(this);
    this.modes = new ModeManager(this);
    this.input.onLockChange(locked => { if (!locked && this.state === 'playing') this.pause(); });
    this.player.reset(new THREE.Vector3(0, 0, 0), 0);
    this.enterMenu();
    this.prewarm();
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
    window.__game = this; // exposed for automated play-testing
  }

  setupScene() {
    const s = this.scene;
    const pm = new THREE.PMREMGenerator(this.renderer);
    const env = pm.fromEquirectangular(this.assets.hdri).texture;
    s.environment = env; s.environmentIntensity = 0.32;
    // The HDRI only lights the scene; its baked lamp blew out under bloom, so the visible
    // sky is the fog colour (silhouetted dead trees read better against it anyway).
    // Misty night sky: background and fog share a hazy grey so the dead forest fades into fog.
    s.background = new THREE.Color(0x3a3e42);
    s.fog = new THREE.FogExp2(0x3a3e42, 0.0145);
    s.add(new THREE.HemisphereLight(0x6f6390, 0x2a1210, 0.75));
    const moon = this.moon = new THREE.DirectionalLight(0xa9b8ff, 1.5);
    moon.position.set(-30, 50, -20); moon.castShadow = true;
    moon.shadow.mapSize.setScalar(2048);
    const sc = moon.shadow.camera; sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 1; sc.far = 140;
    moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.03;
    s.add(moon); s.add(moon.target);
    const rim = new THREE.DirectionalLight(0xff7a4a, 0.3); rim.position.set(30, 12, 40); s.add(rim);
    this.bloodLight = new THREE.PointLight(0xff1a0a, 0, 14, 1.5); s.add(this.bloodLight);
    // warm key + cold rim on the hero for the menu shot
    this.menuKey = new THREE.SpotLight(0xffb070, 0, 20, 0.5, 0.6, 1.2); s.add(this.menuKey); s.add(this.menuKey.target);
    this.menuRim = new THREE.PointLight(0x9ab0ff, 0, 10, 1.5); s.add(this.menuRim);
  }

  // Compile shaders / upload textures up front so the first fight doesn't hitch.
  prewarm() {
    const types = ['grunt', 'runner', 'mage', 'marksman', 'brute', 'elite', 'giant', 'demon', 'blueDemon'];
    const tmp = [];
    for (const t of types) { const e = this.enemies.spawn(t, { at: new THREE.Vector3(0, -50, 0), noRise: true }); tmp.push(e); }
    this.renderer.compile(this.scene, this.camera);
    for (const e of tmp) { e.dispose(); }
    this.enemies.list.length = 0;
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.post?.setSize(innerWidth, innerHeight);
    this.vfx?.pixelRatioScale(this.renderer);
  }

  // ------------------------------------------------------------- flow
  enterMenu() {
    if (this.mode === 'parkour') this.parkour.stop();
    this.modes?.apply('arkham'); // the menu backdrop is the classic courtyard
    this.time.reset();
    this.post.dimTarget = 0; this.post.speed = 0;
    this.state = 'menu';
    this.ui.show(false); this.ui.reset();
    this.enemies.reset(); this.projectiles.reset(); this.pickups.reset(); this.bow.reset();
    this.player.reset(new THREE.Vector3(0, 0, 4), 0);
    this.player.anim.play('Idle', { fade: 0 });
    this.input.releaseLock();
    this.menu.show();
    this.audio.playMusic('menu', { fade: 2 });
    this.post.setBloodGod(false);
  }

  startGame(mode = this.mode) {
    document.activeElement?.blur?.();
    this.audio.resume();
    this.menuKey.intensity = 0; this.menuRim.intensity = 0;
    this.menu.hide();
    this.modes.apply(mode);
    this.resetRun();
    this.state = 'intro'; this.introT = 0;
    this.ui.show(true);
    document.body.classList.add('intro');
    this.player.anim.play('Taunt', { fade: 0.3, once: true });
    this.player.setState('emote');
    this.cam.yaw = this.player.yaw + Math.PI; this.cam.pitch = 0.3;
    this.cam.startCinematic(this.player.position, this.player.yaw, { duration: 3.2, side: 1, dist: 4.5, height: 1.5, orbit: 1.6 });
    this.audio.playMusic(null, { fade: 1.5 });
    this.audio.play('thunder', { vol: 0.7 }); this.audio.play('gong', { vol: 0.6, delay: 0.4 });
    document.getElementById('intro-card').className = 'show';
    this.input.requestLock();
  }

  resetRun() {
    this.time.reset();
    this.score = 0; this.kills = 0;
    this.enemies.reset(); this.projectiles.reset(); this.pickups.reset();
    this.ui.reset();
    this.combat.reset(); this.abilities.reset(); this.bow.reset();
    // per-mode spawn: Mode 2's stairs occupy z 8..12, so it spawns in the open centre instead
    const spawn = this.mode === 'parkour' ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(0, 0, 8);
    this.player.reset(spawn, Math.PI);
    this.cam.yaw = 0; this.cam.endCinematic();
    this.waves.reset();
    this.post.desat = 0; this.post.speed = 0; this.post.dimTarget = 0;
    if (this.mode === 'parkour') this.parkour.combat.reset();
    document.body.classList.remove('dead');
    this.audio.setMuffle(0);
  }

  restart() {
    document.getElementById('death-screen').className = '';
    document.getElementById('pause-menu').className = '';
    this.startGame(this.mode); // restart the SAME mode
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    document.getElementById('pause-menu').className = 'show';
    this.audio.setMuffle(0.6);
  }
  resume() {
    if (this.state !== 'paused') return;
    document.getElementById('pause-menu').className = '';
    this.state = 'playing';
    this.audio.setMuffle(0);
    this.input.requestLock();
    this.last = performance.now();
  }

  // ------------------------------------------------------------- events
  addScore(n) { this.score += Math.max(0, Math.round(n)); }

  onKill(e, { execution = false, headshot = false } = {}) {
    this.kills++;
    this.addScore((e.def.score ?? 100) * this.combat.multiplier * (execution ? 2 : 1) * (headshot ? 1.5 : 1));
    if (this.abilities.bloodGod) this.player.heal(3);
    if (e.boss) { this.cam.addTrauma(1); if (this.mode === 'parkour') this.parkour.fpCam.addShake(1); this.audio.play('roar', { vol: 1, rate: 0.5 }); }
  }

  onPlayerDamaged(dmg, from) {
    this.ui.damageDirection(from);
    this.post.hit(0.8);
    this.time.hitstop(0.05);
  }

  onPlayerDeath() {
    this.state = 'dead';
    this.time.slowmo(0.25, 2.2);
    this.audio.setMuffle(0.75, 1.5);
    this.audio.playMusic('menu', { fade: 3, vol: 0.8 });
    this.ui.flash('TECHNOBLADE HAS FALLEN', 'red', 2.5);
    document.body.classList.add('dead');
    this.input.releaseLock();
    if (this.mode === 'parkour') this.parkour.combat.setFocus(false);
    else this.cam.startCinematic(this.player.position, this.player.yaw, { duration: 99, side: 1, dist: 6, height: 3.5, orbit: 3 });
    setTimeout(() => this.showDeathScreen(), 2600);
  }

  showDeathScreen() {
    if (this.state !== 'dead') return;
    const { best } = this.modes.record(this.mode, { score: this.score, kills: this.kills, wave: this.waves.wave, combo: this.combat.bestCombo });
    const d = document.getElementById('death-screen');
    document.getElementById('ds-mode').textContent = this.mode === 'parkour' ? 'Parkour Combat' : 'Arkham Combat';
    document.getElementById('ds-stats').innerHTML = `
      <div><span>Wave Reached</span><b>${this.waves.wave}</b></div>
      <div><span>Monsters Slain</span><b>${this.kills}</b></div>
      <div><span>Best Combo</span><b>${this.combat.bestCombo}</b></div>
      <div><span>Time Survived</span><b>${Math.floor(this.time.elapsed / 60)}:${String(Math.floor(this.time.elapsed % 60)).padStart(2, '0')}</b></div>
      <div class="big"><span>Final Score</span><b>${this.score.toLocaleString()}</b></div>
      <div><span>Best Score</span><b>${best.toLocaleString()}</b></div>`;
    d.className = 'show';
  }

  // ------------------------------------------------------------- loop
  frame() {
    const now = performance.now();
    const realDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.tick(realDt, true);
  }

  tick(realDt, render) {
    const now = performance.now();
    if (this.state === 'paused' || this.state === 'loading') { if (render) this.post.render(realDt, { time: now / 1000 }); this.input.endFrame(realDt); return; }
    const dt = this.time.step(realDt);
    const inMenu = this.state === 'menu' || this.state === 'modeselect';
    if (inMenu) this.updateMenu(dt, realDt);
    else this.updateGame(dt, realDt);
    if (this.state === 'modeselect') this.modes.updatePreviews(realDt);
    this.vfx.update(dt);
    if (render) {
      const lowHp = this.player.alive && !inMenu ? Math.max(0, 1 - this.player.hp / (this.player.maxHp * 0.35)) : 0;
      this.post.render(realDt, { lowHp, time: now / 1000, dead: this.state === 'dead' });
      if (this.state === 'modeselect') this.modes.renderPreviews();
    }
    this.input.endFrame(realDt);
  }

  // Play-testing hook: advance the simulation deterministically at 60 Hz (independent of the
  // browser's frame rate), optionally running a per-step callback to drive inputs.
  simulate(seconds, onStep) {
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) { onStep?.(i / 60); this.tick(1 / 60, i === steps - 1); }
    this.last = performance.now();
  }

  updateMenu(dt, realDt) {
    this.player.anim.update(dt);
    if (this.player.anim.finished()) this.player.anim.play(Math.random() < 0.3 ? 'Taunt' : 'Idle', { fade: 0.4, once: Math.random() < 0.3 });
    this.arena.update(dt, this.time.elapsed += dt, this.player);
    this.cam.updateMenu(dt, this.player.position);
    const P = this.player.position;
    this.menuKey.intensity = 40; this.menuKey.position.set(P.x + 3, 5, P.z + 5); this.menuKey.target.position.set(P.x, 1.4, P.z);
    this.menuRim.intensity = 30; this.menuRim.position.set(P.x - 1.5, 3, P.z - 2.2);
    this.moon.target.position.copy(this.player.position); this.moon.position.copy(this.player.position).add(new THREE.Vector3(-30, 50, -20));
    this.weapon.update(dt);
  }

  updateGame(dt, realDt) {
    const g = this;
    this.time.elapsed += dt;
    if (this.state === 'intro') {
      this.introT += realDt;
      this.player.update(dt);
      if (this.introT > 3.3) {
        this.state = 'playing';
        document.body.classList.remove('intro');
        document.getElementById('intro-card').className = 'out';
        this.cam.endCinematic(); this.cam.yaw = this.player.yaw + Math.PI;
        if (this.mode === 'parkour') this.parkour.start();
        this.waves.start();
        this.input.clearBuffer();
      }
    }
    // ---- Mode 2: parkour runtime owns movement, combat and camera
    if (this.mode === 'parkour' && (this.state === 'playing' || this.state === 'dead')) {
      this.bow.update(dt);
      this.parkour.update(dt, realDt);
      if (this.state === 'paused') return;
      this.enemies.update(dt);
      this.projectiles.update(dt);
      this.pickups.update(dt);
      if (this.state === 'playing') this.waves.update(dt);
      this.weapon.update(dt);
      this.arena.update(dt, this.time.elapsed, this.player);
      this.moon.target.position.copy(this.player.position); this.moon.position.copy(this.player.position).add(new THREE.Vector3(-30, 50, -20));
      this.bloodLight.position.set(this.player.position.x, this.player.position.y + 3, this.player.position.z);
      this.ui.update(realDt);
      return;
    }
    if (this.state === 'playing' || this.state === 'dead') {
      if (this.state === 'playing' && this.input.take('pause')) { this.input.releaseLock(); this.pause(); return; }
      this.bow.update(dt);
      this.combat.update(dt);
      this.abilities.update(dt);
      this.player.update(dt);
      this.enemies.update(dt);
      this.projectiles.update(dt);
      this.pickups.update(dt);
      if (this.state === 'playing') this.waves.update(dt);
    }
    this.weapon.update(dt);
    this.arena.update(dt, this.time.elapsed, this.player);
    // camera
    const near = this.enemies.countNear(this.player.position, 10);
    const mouse = this.input.consumeMouse();
    this.cam.update(realDt * (this.time.stopT > 0 ? 0.3 : 1), this.player.position, {
      mouse: this.state === 'playing' ? mouse : null,
      aiming: this.bow.aiming,
      combat: this.combat.inCombat ? 1 : 0,
      surrounded: Math.min(1, Math.max(0, (near - 3) / 4)),
      lock: this.combat.lockTarget ? this.combat.lockTarget.position : null,
    });
    this.moon.target.position.copy(this.player.position); this.moon.position.copy(this.player.position).add(new THREE.Vector3(-30, 50, -20));
    this.bloodLight.position.set(this.player.position.x, 3, this.player.position.z);
    this.ui.update(realDt);
  }
}
