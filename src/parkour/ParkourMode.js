// ParkourMode — runtime for Mode 2 (Karlson-style movement combat). Owns the movement
// controller, first/third-person cameras, the first-person viewmodel and the parkour
// combat controller; turns movement events into camera/audio/VFX feedback; C toggles view.
import * as THREE from 'three';
import { ParkourController } from './ParkourController.js';
import { FirstPersonCamera } from './FirstPersonCamera.js';
import { ThirdPersonCamera } from './ThirdPersonCamera.js';
import { ViewModel } from './ViewModel.js';
import { ParkourCombatController } from './ParkourCombatController.js';
import { AIR } from './AirMovementController.js';

export class ParkourMode {
  constructor(game) {
    this.game = game;
    this.mover = new ParkourController(game);
    this.look = { yaw: 0, pitch: 0 };
    this.fpCam = new FirstPersonCamera(game.camera);
    this.tpCam = new ThirdPersonCamera(game.camera, game.world);
    this.viewModel = new ViewModel(game);
    game.post.setViewModel(this.viewModel.scene, this.viewModel.camera);
    this.weapon = game.weapon;
    this.combat = new ParkourCombatController(this);
    this.view = 'fp';
    this.active = false;
    this.wallSoundT = 0;
  }

  get pk() { return this.mover.pk; }

  start() {
    const g = this.game;
    this.active = true;
    this.mover.reset(this.game.player.position.clone(), Math.PI); // stay where the intro placed you (Game.resetRun spawn)
    this.look.yaw = 0; this.look.pitch = 0;
    this.combat.reset();
    this.setView(this.view, true);
    this.tpCam.snap();
  }

  stop() {
    this.active = false;
    this.game.post.showViewModel(false);
    this.game.player.root.visible = true;
    this.game.player.root.rotation.set(0, this.game.player.root.rotation.y, 0);
    this.combat.setFocus(false);
    this.game.time.focus = 1;
  }

  setView(v, silent = false) {
    this.view = v;
    const fp = v === 'fp';
    this.game.player.root.visible = !fp;
    this.game.post.showViewModel(fp && this.game.player.alive);
    this.game.ui.parkourView?.(v);
    if (!silent) { this.game.audio.play('uiSwitch', { vol: 0.35 }); this.tpCam.snap(); }
  }

  showBow(on) {
    this.viewModel.showBow(on);
    this.game.weapon.showBow(on);
  }

  // Called from Game.updateGame while Mode 2 is active.
  update(dt, realDt) {
    const g = this.game, input = g.input, p = g.player, pk = this.pk;
    const playing = g.state === 'playing' && p.alive;
    // mouse look (uses real time so slow-mo doesn't slow your aim)
    const mouse = input.consumeMouse();
    if (playing) {
      const k = this.combat.aiming ? 0.0017 : 0.0024;
      this.look.yaw -= mouse.dx * k; this.look.pitch -= mouse.dy * k;
      this.look.pitch = Math.max(-1.45, Math.min(1.45, this.look.pitch));
      if (input.take('view')) this.setView(this.view === 'fp' ? 'tp' : 'fp');
      if (input.take('pause')) { input.releaseLock(); g.pause(); return; }
    }

    this.mover.update(dt, this.look, input, { allowMove: playing });
    if (playing) this.combat.update(dt, this.look, input);
    this.handleEvents();
    g.combat.tickCombo(dt);
    g.abilities.update(dt);
    // body & animation (third-person body is also used for shadows / death)
    const facing = (this.combat.aiming || this.combat.atk) ? this.look.yaw + Math.PI : undefined;
    if (p.alive) this.mover.animate(dt, p.anim, p.root, { aiming: this.combat.aiming, facingYaw: facing });
    p.update(dt); // timers + animation mixer (movement is driven by the parkour controller)
    p.velocity.copy(pk.vel);

    // cameras (death always uses a slow third-person orbit, without changing your chosen view)
    const speed = this.mover.speed;
    if (!p.alive) {
      this.look.yaw += realDt * 0.3; this.look.pitch = -0.35;
      p.root.visible = true; g.post.showViewModel(false);
    }
    if (this.view === 'fp' && p.alive) this.fpCam.update(realDt, pk, this.look, speed, this.combat.aiming);
    else this.tpCam.update(realDt, pk, this.look, speed, this.combat.aiming);
    // if walls force the third-person camera right up to the head, hide the head instead of clipping into it
    if (this.view === 'tp') { const hp = p.headPos; p.hero.headGroup.visible = g.camera.position.distanceTo(hp) > 1.25; }
    else p.hero.headGroup.visible = true;
    this.viewModel.update(dt, pk, mouse, speed);
    g.post.speed += (Math.min(1, Math.max(0, (speed - 16) / 20)) - g.post.speed) * Math.min(1, realDt * 4);
    g.ui.parkourHud(this);
  }

  handleEvents() {
    const g = this.game, pk = this.pk;
    for (const ev of pk.events) {
      switch (ev.type) {
        case 'jump': g.audio.play('dodge', { vol: 0.3, rate: 1.2 }); break;
        case 'doubleJump': g.audio.play('dodge', { vol: 0.45, rate: 1.5 }); g.vfx.sys.smoke.emit(pk.pos, { count: 8, speed: 3, life: 0.5, size: 1.6, color: [0.6, 0.6, 0.65], alpha: 0.5, flat: true }); g.vfx.ring(pk.pos, 1.8, [0.7, 0.8, 1], 0.25); break;
        case 'wallJump': g.audio.play('step', { vol: 0.6, rate: 0.8 }); g.audio.play('dodge', { vol: 0.4 }); break;
        case 'wallrun': g.audio.play('step', { vol: 0.5 }); break;
        case 'slide': g.audio.play('dodge', { vol: 0.5, rate: 0.7 }); g.vfx.dust(pk.pos, 6, 1.6); break;
        case 'slideJump': g.audio.play('dodge', { vol: 0.45, rate: 1.3 }); break;
        case 'dash': g.audio.play('swing', { vol: 0.6, rate: 0.7 }); this.fpCam.dash(); g.vfx.sys.light.emit(pk.pos.clone().setY(pk.pos.y + 1.3), { count: 3, speed: 0.5, life: 0.2, size: 3, color: [0.7, 0.85, 1] }); break;
        case 'slamStart': g.audio.play('swing', { vol: 0.7, rate: 0.6 }); this.viewModel.slam(); break;
        case 'slamImpact': this.combat.shockwave(pk.pos.clone(), ev.radius, ev.power, 'slam'); break;
        case 'land':
          if (ev.impact > 10) { this.fpCam.land(ev.impact); this.viewModel.land(ev.impact); g.audio.play('step', { vol: Math.min(0.9, ev.impact * 0.03), rate: 0.8 }); if (ev.impact > 22) g.vfx.dust(pk.pos, 8, 2.2); }
          break;
      }
    }
    pk.events.length = 0;
    // wall-run footsteps & sparks
    if (pk.state === 'wallrun') {
      this.wallSoundT -= 1 / 60;
      if (this.wallSoundT <= 0) { this.wallSoundT = 0.16; g.audio.play('step', { vol: 0.3, rate: 1.2 }); }
      if (Math.random() < 0.4) g.vfx.sys.dirt.emit(pk.pos.clone().addScaledVector(pk.wall.normal, -0.6).setY(pk.pos.y + 0.3), { count: 1, speed: 1.5, life: 0.4, size: 0.4, color: [0.6, 0.55, 0.5], gravity: 8 });
    }
    if (pk.state === 'slide' && Math.random() < 0.6) g.vfx.sys.spark.emit(pk.pos.clone().setY(pk.pos.y + 0.1), { count: 1, speed: 2, life: 0.25, size: 0.35, color: [1, 0.8, 0.5], gravity: 6 });
  }

  // Ability readiness for the HUD.
  abilities() {
    const pk = this.pk, air = this.mover.air, sl = this.mover.slide;
    return {
      dash: { charges: pk.dashCharges, max: AIR.dashCharges },
      slam: { cd: Math.max(0, air.slamCd) / AIR.slamCd },
      jump: { ready: pk.grounded || pk.jumpsLeft > 0 || pk.state === 'wallrun' },
      slide: { cd: Math.max(0, sl.cd) / 0.8 },
      special: { ready: this.game.abilities.meter >= 100 && !this.game.abilities.bloodGod, active: this.game.abilities.bloodGod },
    };
  }
}
