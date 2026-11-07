// ParkourController — Mode 2 movement state machine. Composes Momentum / Slide / WallRun /
// AirMovement controllers and owns collision integration (lateral push-out with wall
// scraping, landing, stairs/ramps, ledges, ceilings) plus the third-person body animation.
//   states: ground · slide · air · wallrun · dash · slamRise · slam
import * as THREE from 'three';
import { MomentumController, TUNING } from './MomentumController.js';
import { SlideController, SLIDE } from './SlideController.js';
import { WallRunController } from './WallRunController.js';
import { AirMovementController } from './AirMovementController.js';

const tmp = new THREE.Vector3(), pre = new THREE.Vector3();

export class ParkourController {
  constructor(game) {
    this.game = game;
    const p = game.player;
    this.pk = {
      pos: p.position, vel: new THREE.Vector3(), state: 'ground', grounded: true, groundY: 0, groundSurf: null,
      radius: 0.7, height: 2.5, jumpsLeft: 1, dashCharges: 2, dashCd: 0, dashT: 0, dashDir: new THREE.Vector3(),
      iframes: 0, coyote: 0, wall: null, slideT: 0, time: 0, lastDashEnd: -9, landImpact: 0, landT: 9,
      airT: 0, events: [], yaw: 0,
    };
    this.momentum = new MomentumController(this.pk);
    this.slide = new SlideController(this.pk, this.momentum);
    this.wallrun = new WallRunController(this.pk);
    this.air = new AirMovementController(this.pk);
    this.leanX = 0; this.leanZ = 0;
  }

  reset(pos, yaw) {
    const pk = this.pk;
    pk.pos.copy(pos); pk.vel.set(0, 0, 0); pk.state = 'ground'; pk.grounded = true; pk.height = 2.5;
    pk.jumpsLeft = 1; pk.dashCharges = 2; pk.iframes = 0; pk.yaw = yaw; pk.events.length = 0;
    this.air.slamCd = 0; this.slide.cd = 0;
  }

  get speed() { return this.momentum.horizontalSpeed(); }
  emit(type, data) { this.pk.events.push({ type, ...data }); }

  update(dt, look, input, { allowMove = true } = {}) {
    const pk = this.pk, g = this.game, world = g.world;
    pk.time += dt;
    this.slide.tick(dt); this.wallrun.tick(dt); this.air.tick(dt);
    if (pk.iframes > 0) pk.iframes -= dt;
    if (pk.coyote > 0) pk.coyote -= dt;
    pk.landT += dt;
    const wish = allowMove ? this.momentum.wishFromInput(input, look.yaw, new THREE.Vector3()) : new THREE.Vector3();
    const sprint = input.down('sprint') || this.speed > TUNING.walk + 1; // momentum keeps you "sprinting"
    const speedMult = g.abilities.bloodGod ? 1.15 : 1;

    // ---------- abilities (buffered presses) ----------
    if (allowMove && input.take('dash')) {
      const dir = wish.lengthSq() > 0.01 ? wish.clone() : tmp.set(-Math.sin(look.yaw), 0, -Math.cos(look.yaw)).clone();
      if (pk.state === 'wallrun') this.wallrun.detach(true);
      if (this.air.dash(dir)) this.emit('dash', { dir });
    }
    if (allowMove && input.take('slam') && !['slam', 'slamRise'].includes(pk.state)) {
      if (pk.state === 'wallrun') this.wallrun.detach(true);
      if (this.air.startSlam()) this.emit('slamStart', {});
    }
    const jumpPressed = allowMove && input.take('jump');
    const slideHeld = allowMove && input.down('slide');
    const slidePressed = allowMove && input.take('slide');

    // ---------- state logic ----------
    switch (pk.state) {
      case 'ground':
        if (jumpPressed) this.jump();
        else if ((slidePressed || (slideHeld && pk.landT < 0.15)) && this.slide.canStart()) { this.slide.start(); this.emit('slide', {}); }
        else this.momentum.ground(wish, sprint, dt, speedMult);
        break;
      case 'slide':
        if (jumpPressed) { this.slide.jump(); this.emit('slideJump', {}); }
        else if (!this.slide.update(dt, wish, slideHeld, world)) { /* back to ground */ }
        break;
      case 'air':
        pk.airT += dt;
        if (jumpPressed) {
          if (pk.coyote > 0) this.jump();
          else if (this.wallrun.touchJump(world)) this.emit('wallJump', {});
          else if (this.air.doubleJump(wish)) this.emit('doubleJump', {});
        }
        if (pk.state === 'air' && pk.vel.y < 9 && pk.airT > 0.08 && this.wallrun.tryAttach(world, wish)) this.emit('wallrun', { side: pk.wall.side });
        if (pk.state === 'air') this.momentum.air(wish, dt);
        break;
      case 'wallrun':
        if (jumpPressed) { this.wallrun.wallJump(wish); this.emit('wallJump', {}); }
        else this.wallrun.update(dt, world, wish);
        break;
      case 'dash': this.air.updateDash(dt); break;
      case 'slamRise': this.air.updateRise(dt); break;
      case 'slam': break;
    }

    // ---------- gravity ----------
    if (['air', 'slamRise'].includes(pk.state) || (pk.state === 'dash' && false)) pk.vel.y -= TUNING.gravity * dt;
    if (pk.state === 'slam') pk.vel.y = Math.min(pk.vel.y, -52);
    this.momentum.clamp();

    // ---------- integrate + collide ----------
    pre.copy(pk.pos);
    pk.pos.x += pk.vel.x * dt; pk.pos.z += pk.vel.z * dt;
    const wantX = pk.pos.x, wantZ = pk.pos.z;
    world.resolve(pk.pos, pk.radius, pk.pos.y, pk.height, pk.grounded ? 0.8 : 0.35); // step up stairs / ledges when grounded
    const pushX = pk.pos.x - wantX, pushZ = pk.pos.z - wantZ, pl = Math.hypot(pushX, pushZ);
    if (pl > 1e-4) { // scrape along walls: remove the into-wall velocity component
      const nx = pushX / pl, nz = pushZ / pl; const vn = pk.vel.x * nx + pk.vel.z * nz;
      if (vn < 0) { pk.vel.x -= nx * vn; pk.vel.z -= nz * vn; }
      if (pk.state === 'dash' && -vn > 20) { pk.dashT = 0; }
    }
    // vertical
    pk.pos.y += pk.vel.y * dt;
    const ceil = world.ceilingAt(pk.pos.x, pk.pos.z, pk.radius * 0.8, pre.y + 0.1);
    if (pk.pos.y + pk.height > ceil) { pk.pos.y = Math.max(pre.y, ceil - pk.height); if (pk.vel.y > 0) pk.vel.y = 0; }
    const ground = world.groundAt(pk.pos.x, pk.pos.z, pk.radius, Math.max(pk.pos.y, pre.y), pk.grounded ? 0.8 : 0.15);
    pk.groundY = ground.y;
    if (pk.grounded) {
      if (ground.y < pk.pos.y - 0.75 || pk.vel.y > 0.1) { pk.grounded = false; pk.coyote = 0.12; if (pk.state === 'ground') { pk.state = 'air'; pk.airT = 0; } }
      else { pk.pos.y = ground.y; pk.vel.y = 0; pk.groundSurf = ground.surf; }
    } else if (pk.vel.y <= 0 && pk.pos.y <= ground.y + 0.02) {
      this.land(ground, slideHeld);
    }
    if (pk.pos.y < 0) pk.pos.y = 0;
    pk.yaw = look.yaw;
  }

  jump() {
    const pk = this.pk;
    pk.vel.y = TUNING.jump; pk.grounded = false; pk.state = 'air'; pk.airT = 0; pk.coyote = 0; pk.jumpsLeft = 1; pk.height = 2.5;
    this.emit('jump', {});
  }

  land(ground, slideHeld) {
    const pk = this.pk;
    const impact = -pk.vel.y;
    pk.pos.y = ground.y; pk.vel.y = 0; pk.grounded = true; pk.groundSurf = ground.surf;
    pk.jumpsLeft = 1; pk.landImpact = impact; pk.landT = 0;
    const wasSlam = pk.state === 'slam';
    if (wasSlam) { this.emit('slamImpact', this.air.impact()); pk.state = 'ground'; }
    else if (slideHeld && this.slide.canStart()) { this.slide.start(); this.emit('slide', { fromLanding: true }); }
    else if (pk.state !== 'dash') pk.state = 'ground';
    this.emit('land', { impact });
  }

  // Knockback from enemy hits.
  knock(dir, force) { this.pk.vel.x += dir.x * force; this.pk.vel.z += dir.z * force; this.pk.vel.y = Math.max(this.pk.vel.y, 4); this.pk.grounded = false; if (this.pk.state !== 'wallrun') this.pk.state = 'air'; }

  // ---------- third-person body animation ----------
  animate(dt, anim, hero, { aiming, facingYaw }) {
    const pk = this.pk, sp = this.speed;
    let leanX = 0, leanZ = 0;
    switch (pk.state) {
      case 'ground':
        if (pk.landT < 0.12 && pk.landImpact > 14) anim.play('Jump_Land', { fade: 0.05, once: true, timeScale: 1.6 });
        else if (aiming && sp < 2) anim.play('Blocking', { fade: 0.15 });
        else if (sp < 1) anim.play('2H_Melee_Idle', { fade: 0.2 });
        else if (sp < 12) anim.play('Running_A', { fade: 0.15, timeScale: Math.max(0.7, sp / 9) });
        else anim.play('Running_B', { fade: 0.15, timeScale: Math.min(1.8, sp / 12) });
        leanX = Math.min(0.18, sp * 0.008);
        break;
      case 'slide':
        // existing floor-sit pose, tilted back = low power slide
        anim.play('Sit_Floor_Pose', { fade: 0.08 }); leanX = -0.28; break;
      case 'wallrun':
        anim.play('Running_B', { fade: 0.1, timeScale: 1.35 }); leanZ = pk.wall.side * 0.42; leanX = 0.12; break; // feet on the wall, body leans AWAY from it
      case 'dash':
        anim.play('Dodge_Forward', { fade: 0.04, once: true, timeScale: 1.8 }); leanX = 0.35; break;
      case 'slamRise': case 'slam':
        anim.play('1H_Melee_Attack_Jump_Chop', { fade: 0.06, once: true, timeScale: 1.2 }); break;
      case 'air':
        if (pk.airT < 0.2 && pk.jumpsLeft === 0) anim.play('Dodge_Forward', { fade: 0.05, once: true, timeScale: 1.5 }); // double-jump flip
        else anim.play(pk.vel.y > 0 ? 'Jump_Start' : 'Jump_Idle', { fade: 0.15, once: pk.vel.y > 0 });
        break;
    }
    this.leanX += (leanX - this.leanX) * Math.min(1, dt * 10);
    this.leanZ += (leanZ - this.leanZ) * Math.min(1, dt * 10);
    // body faces velocity (or the camera when aiming / attacking)
    let yaw = facingYaw;
    if (yaw === undefined) yaw = sp > 1 ? Math.atan2(pk.vel.x, pk.vel.z) : hero.rotation.y;
    let d = yaw - hero.rotation.y; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    hero.rotation.order = 'YXZ';
    hero.rotation.y += d * Math.min(1, dt * 14);
    hero.rotation.x = this.leanX; hero.rotation.z = this.leanZ;
  }

  slideHeight() { return SLIDE.height; }
}
