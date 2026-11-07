// Dev-only play-testing helpers (loaded with ?test=1). Drives the game deterministically.
export function installTestKit(g) {
  const V = (x, y, z) => g.player.position.clone().set(x, y, z);
  const T = {
    async ready() { await new Promise(r => { const c = () => g.state === 'menu' ? r() : setTimeout(c, 200); c(); }); },
    start({ mute = true, waves = false, mode = 'arkham' } = {}) {
      if (mute) g.audio.master.gain.value = 0;
      g.input.requestLock = () => {};
      for (const id of ['loading', 'wave-announce', 'intro-card']) document.getElementById(id).style.display = 'none';
      g.startGame(mode); g.simulate(3.6);
      if (!waves) { g.waves.update = () => {}; g.enemies.reset(); }
    },
    spawn(type, x, z, { frozen = false } = {}) {
      const e = g.enemies.spawn(type, { at: V(x, 0, z), noRise: true });
      if (frozen) { e.holdT = 999; e.anim.play(e.A.idle, { fade: 0 }); }
      return e;
    },
    place(x, z, yaw) { g.player.position.set(x, 0, z); g.player.yaw = yaw; },
    // run until predicate true (or timeout), keeping the camera behind the player
    until(pred, max = 5, camYaw = null) {
      for (let i = 0; i < max * 60; i++) { if (camYaw !== null) g.cam.yaw = camYaw; g.tick(1 / 60, false); if (pred()) break; }
      g.tick(1 / 60, true); g.last = performance.now();
    },
    press(act) { g.input.bufferAction(act); },
    V,
  };
  window.T = T;
  return T;
}
