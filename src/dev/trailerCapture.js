// Dev-only trailer shot director (loaded with ?capture=1). Stages scripted shots in the real
// game, simulates at 30 fps, optionally drives a cinematic camera, and streams 1920x1080
// JPEG frames to the local frame server (trailer/public/footage/<shot>/NNNN.jpg).
import * as THREE from 'three';
import { SHOTS } from './trailerShots.js';

const FPS = 30, W = 1920, H = 1080;
const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const lerpV = (a, b, t) => new THREE.Vector3().lerpVectors(a, b, t);

export function installCapture(g) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const C = {
    async ready() { await new Promise(r => { const c = () => g.state === 'menu' ? r() : setTimeout(c, 200); c(); }); },
    hi() {
      g.renderer.setPixelRatio(1); g.renderer.setSize(W, H, false);
      g.camera.aspect = W / H; g.camera.updateProjectionMatrix();
      g.post.setSize(W, H); g.vfx.pixelRatioScale(g.renderer);
      const vm = g.parkour.viewModel.camera; vm.aspect = W / H; vm.updateProjectionMatrix();
      // silent capture: mute and fully suspend the game's audio engine (no sound at all while recording)
      g.audio.master.gain.value = 0; g.audio.volumes.master = 0; g.audio.ctx.suspend?.();
      g.audio.resume = () => {}; g.audio.applyVolumes = () => {};
      g.input.requestLock = () => {};
      g.renderer.setAnimationLoop(null); // we drive every frame ourselves
      for (const id of ['loading', 'main-menu', 'hud', 'world-ui']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    },
    start(mode) {
      document.getElementById('intro-card').style.display = 'none';
      document.getElementById('wave-announce').style.display = 'none';
      g.startGame(mode); g.simulate(3.6); g.state = 'playing';
      g.waves.update = () => {}; g.enemies.reset(); g.player.hp = 100; g.player.maxHp = 100000; g.player.hp = 100000;
    },
    spawn(type, x, z, o = {}) {
      const e = g.enemies.spawn(type, { at: V(x, 0, z), noRise: !o.rise });
      if (o.frozen) { e.holdT = 999; }
      if (o.calm) e.globalCd = 99;
      if (o.hp) e.maxHp = e.hp = o.hp;
      if (o.yaw !== undefined) { e.yaw = o.yaw; e.root.rotation.y = o.yaw; }
      return e;
    },
    async grab(shot, i) {
      const blob = await new Promise(r => g.renderer.domElement.toBlob(r, 'image/jpeg', 0.9));
      await fetch(`http://localhost:5299/frame?shot=${shot}&i=${i}`, { method: 'POST', body: blob });
    },
    // run a shot: step(t, i) drives inputs, cam(t) returns {pos, look, fov} for cinematic shots
    async shot(name, seconds, { step, cam, render = true } = {}) {
      const n = Math.round(seconds * FPS);
      for (let i = 0; i < n; i++) {
        const t = i / FPS;
        step?.(t, i);
        g.tick(1 / FPS, false);
        if (cam) {
          const c = cam(t / seconds, t);
          g.camera.position.copy(c.pos); g.camera.up.set(0, 1, 0); g.camera.lookAt(c.look);
          if (c.roll) g.camera.rotateZ(c.roll);
          if (c.fov) { g.camera.fov = c.fov; g.camera.updateProjectionMatrix(); }
        }
        if (render) { g.post.render(1 / FPS, { time: performance.now() / 1000 }); await C.grab(name, i); }
      }
      return n;
    },
    V, lerpV, ease, g,
  };
  window.CAP = C;
  window.SHOTS = SHOTS;
  return C;
}
