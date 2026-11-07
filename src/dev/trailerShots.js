// Trailer shot scripts (dev-only). Each stages real gameplay and records it via CAP.shot().
// Returns the number of frames captured.
const near = (g, p) => { let best = null, bd = 1e9; for (const e of g.enemies.list) { if (!e.targetable) continue; const d = e.distTo(p); if (d < bd) { bd = d; best = e; } } return [best, bd]; };

export const SHOTS = {
  async test(C) { const { g, V } = C; C.start('arkham'); return C.shot('test', 0.5, { cam: () => ({ pos: V(4, 3, 6), look: V(0, 1.6, 0), fov: 45 }) }); },

  // 1. slow fly-in over the fortress wall to the lone king
  async establish(C) {
    const { g, V, lerpV, ease } = C; C.start('arkham');
    g.player.position.set(0, 0, 0); g.player.yaw = 0; g.player.root.rotation.y = 0; g.player.anim.play('Idle', { fade: 0 });
    return C.shot('establish', 6, { cam: (k) => { const e = ease(k); return { pos: lerpV(V(24, 17, 44), V(3.5, 3.0, 9), e), look: lerpV(V(0, 0, 0), V(0, 1.9, 0), e), fov: 40 }; } });
  },

  // 2. push-in on Technoblade's face
  async hero(C) {
    const { g, V, lerpV, ease } = C; C.start('arkham');
    g.player.position.set(0, 0, 0); g.player.yaw = 0; g.player.root.rotation.y = 0; g.player.anim.play('2H_Melee_Idle', { fade: 0 });
    return C.shot('hero', 4, { cam: (k) => ({ pos: lerpV(V(1.2, 2.0, 5.2), V(0.35, 2.45, 3.0), ease(k)), look: V(0, 2.3, 0), fov: 38 }) });
  },

  // 3. skeletons claw out of the ground in front of him
  async rise(C) {
    const { g, V, lerpV, ease } = C; C.start('arkham');
    g.player.position.set(0, 0, 0); g.player.yaw = Math.PI; g.player.root.rotation.y = Math.PI; g.player.anim.play('2H_Melee_Idle', { fade: 0 });
    const spots = [[-3.5, -7], [0, -8.5], [3.5, -7], [-6.5, -10], [6.5, -10]];
    let i = 0;
    return C.shot('rise', 4.5, {
      step: (t) => { if (i < spots.length && t > i * 0.35) { const [x, z] = spots[i++]; C.spawn('grunt', x, z, { rise: true, calm: true, yaw: 0 }); } for (const e of g.enemies.list) e.globalCd = 99; },
      cam: (k) => ({ pos: lerpV(V(1.7, 0.9, 3.0), V(1.1, 1.2, 1.2), ease(k)), look: V(0, 1.1, -8), fov: 46 }),
    });
  },

  // 4. free-flow combo through a pack (orbiting camera)
  async combo(C) {
    const { g, V } = C; C.start('arkham');
    g.player.position.set(0, 0, 0);
    for (const [x, z] of [[-3, -3], [3, -3], [0, 3.5], [-3.5, 2], [3.5, 2]]) C.spawn('grunt', x, z, { hp: 70 });
    for (const e of g.enemies.list) e.globalCd = 1.5;
    let nextAtk = 0;
    return C.shot('combo', 5, {
      step: (t) => { if (t > nextAtk) { g.input.bufferAction(Math.random() < 0.2 ? 'heavy' : 'attack'); nextAtk = t + 0.3; } const [e] = near(g, g.player.position); if (e) g.cam.yaw = Math.atan2(-(e.position.x - g.player.position.x), -(e.position.z - g.player.position.z)); },
      cam: (k) => { const a = 0.6 + k * 1.2, p = g.player.position; return { pos: V(p.x + Math.sin(a) * 6.5, 3.0, p.z + Math.cos(a) * 6.5), look: V(p.x, 1.4, p.z), fov: 50 }; },
    });
  },

  // 5. counter: wait for an attack, parry it (slow-mo kicks in)
  async counter(C) {
    const { g, V } = C; C.start('arkham');
    g.player.position.set(0, 0, 0); g.player.yaw = Math.PI;
    const a = C.spawn('runner', 0, -3.2, { hp: 400 }); const b = C.spawn('grunt', 2.6, -2.2, { hp: 400 });
    a.globalCd = 0.2; b.globalCd = 0.5; let countered = 0;
    return C.shot('counter', 3.5, {
      step: () => { const th = g.enemies.counterableThreats(g.player, 9).filter(e => e.threat().impactIn < 0.22); if (th.length && countered < 2) { g.input.bufferAction('counter'); countered++; } },
      cam: (k) => ({ pos: V(-4.2 + k * 0.8, 1.9, -0.6), look: V(0.6, 1.3, -1.8), fov: 42 }),
    });
  },

  // 6. multi-target finisher (game's own cinematic camera)
  async finisher(C) {
    const { g } = C; C.start('arkham');
    g.player.position.set(0, 0, 0); g.player.yaw = Math.PI;
    for (const [x, z] of [[0, -3], [-3, -2], [3, -2.5]]) C.spawn('grunt', x, z, { calm: true });
    g.combat.combo = 16; g.cam.yaw = 0;
    return C.shot('finisher', 4, { step: (t, i) => { if (i === 3) g.input.bufferAction('finisher'); } });
  },

  // 7. Blood God awakens
  async bloodgod(C) {
    const { g } = C; C.start('arkham');
    g.player.position.set(0, 0, 0); g.player.yaw = Math.PI;
    for (const [x, z] of [[-4, -4], [4, -4], [0, -5.5], [-5, 1], [5, 1]]) C.spawn('grunt', x, z, { calm: true });
    g.abilities.meter = 100; g.cam.yaw = 0;
    return C.shot('bloodgod', 3.6, { step: (t, i) => { if (i === 4) g.input.bufferAction('ultimate'); } });
  },

  // 8. the Colossus marches in (low angle)
  async boss(C) {
    const { g, V, lerpV, ease } = C; C.start('arkham');
    g.player.position.set(0, 0, 4); g.player.yaw = Math.PI; g.player.root.rotation.y = Math.PI; g.player.anim.play('2H_Melee_Idle', { fade: 0 });
    const boss = C.spawn('giant', 0, -14, { hp: 99999 }); boss.setState('approach'); boss.globalCd = 2.2;
    return C.shot('boss', 5, { cam: (k) => ({ pos: lerpV(V(2.4, 0.7, 8.5), V(1.8, 0.9, 7.0), ease(k)), look: V(0, 4.2, -8 + k * 4), fov: 50 }) });
  },

  // 9. demon boss swinging its trident
  async demon(C) {
    const { g, V } = C; C.start('arkham');
    g.player.position.set(0, 0, 0); g.player.yaw = Math.PI;
    const d = C.spawn('demon', 0, -7, { hp: 99999 }); d.setState('approach'); d.globalCd = 0.3;
    return C.shot('demon', 3.5, {
      step: (t) => { const th = g.enemies.impactImminent(g.player, 0.2); if (th) g.input.bufferAction('dodge'); },
      cam: (k) => ({ pos: V(-6.5 + k * 1.5, 2.2, 3.5), look: V(0, 3.0, -4), fov: 48 }),
    });
  },

  // ---------------- Mode II ----------------
  // 10. first-person sprint into a slide slash that launches a pack
  async pk_slide(C) {
    const { g } = C; C.start('parkour'); const pm = g.parkour, pk = pm.pk, inp = g.input;
    pm.setView('fp'); pm.mover.reset(g.player.position.set(-2, 0, 12), 0); pm.look.yaw = 0; pm.look.pitch = -0.08;
    for (const [x, z] of [[-3, -4], [-1, -5], [1.5, -4.5]]) C.spawn('grunt', x, z, { calm: true });
    inp.keys.clear(); inp.keys.add('KeyW'); inp.keys.add('ShiftLeft'); let slid = false, hit = false;
    return C.shot('pk_slide', 3, { step: (t) => {
      if (!slid && pk.pos.z < 3.5) { slid = true; inp.bufferAction('slide'); inp.keys.add('ControlLeft'); }
      if (slid && !hit && pk.pos.z < -1.5) { hit = true; inp.bufferAction('attack'); }
      if (t > 2.2) inp.keys.delete('ControlLeft');
    } });
  },

  // 11. third-person chimney wall-run + wall-jump
  async pk_wallrun(C) {
    const { g, V } = C; C.start('parkour'); const pm = g.parkour, pk = pm.pk, inp = g.input;
    pm.setView('tp'); pm.mover.reset(g.player.position.set(-23.2, 0, -1.5), 0); pm.look.yaw = 0.25; pm.look.pitch = -0.12; pk.vel.set(0, 0, -15.5); pm.tpCam.snap();
    inp.keys.clear(); inp.keys.add('KeyW'); inp.keys.add('ShiftLeft'); let j = false, wj = 0;
    return C.shot('pk_wallrun', 3.4, { step: (t) => {
      if (!j && pk.pos.z < -7.6) { j = true; inp.bufferAction('jump'); }
      if (pk.state === 'wallrun' && pk.wall.t > 0.32 && wj < 2) { wj++; inp.bufferAction('jump'); }
      if (pk.state === 'air' && wj === 1) { inp.keys.add(pk.vel.x > 0 ? 'KeyD' : 'KeyA'); } else { inp.keys.delete('KeyA'); inp.keys.delete('KeyD'); }
    } });
  },

  // 12. first-person wall-run
  async pk_wallrun_fp(C) {
    const { g } = C; C.start('parkour'); const pm = g.parkour, pk = pm.pk, inp = g.input;
    pm.setView('fp'); pm.mover.reset(g.player.position.set(-23.2, 0, -3.5), 0); pm.look.yaw = 0.15; pm.look.pitch = -0.05; pk.vel.set(0, 0, -15.5);
    inp.keys.clear(); inp.keys.add('KeyW'); inp.keys.add('ShiftLeft'); let j = false;
    return C.shot('pk_wallrun_fp', 2.6, { step: () => { if (!j && pk.pos.z < -7.6) { j = true; inp.bufferAction('jump'); } } });
  },

  // 13. launch-and-slam shockwave into a crowd (wide cinematic angle)
  async pk_slam(C) {
    const { g, V } = C; C.start('parkour'); const pm = g.parkour, pk = pm.pk, inp = g.input;
    pm.setView('tp'); pm.mover.reset(g.player.position.set(-10, 0, 2), 0); pm.look.yaw = 0;
    for (const [x, z] of [[-12.5, 0], [-7.5, 0.5], [-10, -1.5], [-12, 4], [-8, 4.2]]) C.spawn('grunt', x, z, { calm: true });
    inp.keys.clear();
    return C.shot('pk_slam', 3.2, {
      step: (t, i) => { if (i === 6) inp.bufferAction('slam'); },
      cam: (k) => ({ pos: V(-10 + 9 * Math.sin(0.9 + k * 0.4), 3.4 + k * 0.6, 2 + 9 * Math.cos(0.9 + k * 0.4)), look: V(-10, 2.2, 2), fov: 52 }),
    });
  },

  // 14. first-person dash strike through a line of enemies
  async pk_dash(C) {
    const { g } = C; C.start('parkour'); const pm = g.parkour, pk = pm.pk, inp = g.input;
    pm.setView('fp'); pm.mover.reset(g.player.position.set(-10, 0, 10), 0); pm.look.yaw = 0; pm.look.pitch = -0.05;
    for (const z of [5, 2.5, 0]) C.spawn('grunt', -10 + (Math.random() - 0.5) * 0.8, z, { calm: true, hp: 60 });
    inp.keys.clear(); inp.keys.add('KeyW');
    return C.shot('pk_dash', 2.4, { step: (t, i) => { if (i === 8) inp.bufferAction('dash'); if (i === 10) inp.bufferAction('attack'); if (i === 30) inp.bufferAction('attack'); } });
  },

  // 15. airborne focus slow-mo headshot
  async pk_bow(C) {
    const { g } = C; C.start('parkour'); const pm = g.parkour, pk = pm.pk, inp = g.input;
    pm.setView('fp'); pm.mover.reset(g.player.position.set(-10, 0, 10), 0); pm.look.yaw = 0; pm.look.pitch = -0.02;
    const t1 = C.spawn('mage', -10, -8, { calm: true, frozen: true }); t1.anim.play(t1.A.idle, { fade: 0 });
    inp.keys.clear(); inp.keys.add('KeyW');
    return C.shot('pk_bow', 3.4, { step: (t, i) => {
      if (i === 2) inp.bufferAction('jump');
      if (i === 10) inp.bufferAction('jump');
      if (i >= 14 && t1.alive) { const hp = t1.headPos(); const eye = g.camera.position; pm.look.pitch += (Math.atan2(hp.y - eye.y, Math.hypot(hp.x - eye.x, hp.z - eye.z)) - pm.look.pitch) * 0.25; pm.look.yaw += (Math.atan2(-(hp.x - eye.x), -(hp.z - eye.z)) - pm.look.yaw) * 0.25; }
      if (i === 14) inp.mouse.right = true;
      if (i === 18) { inp.mouse.left = true; }
      if (i === 30) inp.mouse.left = false;
      if (i === 70) inp.mouse.right = false;
    } });
  },

  // 16. finale: Blood God aura, slow low orbit (title backdrop)
  async finale(C) {
    const { g, V, ease } = C; C.start('arkham');
    g.player.position.set(0, 0, 0); g.player.yaw = 0; g.player.root.rotation.y = 0;
    g.abilities.bloodGod = true; g.abilities.bgTime = 99; g.abilities.applyBloodGod(true); g.post.blood = 1;
    g.player.anim.play('2H_Melee_Idle', { fade: 0 });
    return C.shot('finale', 6, {
      step: (t, i) => { if (i === 20) g.player.anim.play('Taunt', { fade: 0.2, once: true }); g.player.setState('emote'); },
      cam: (k) => { const a = -0.7 + ease(k) * 1.1; return { pos: V(Math.sin(a) * 5.2, 1.1 + k * 0.5, Math.cos(a) * 5.2), look: V(0, 2.0, 0), fov: 40 }; },
    });
  },
};
