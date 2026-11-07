// VFX — pooled GPU particle systems driven by the downloaded Kenney particle textures,
// slash decals, ground shockwaves and a sword trail ribbon. All visuals use existing
// texture assets; the code only animates/billboards them.
import * as THREE from 'three';

const vert = /* glsl */`
attribute float size; attribute vec4 pcolor; attribute float rot;
varying vec4 vColor; varying float vRot;
uniform float uScale;
void main(){
  vColor = pcolor; vRot = rot;
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_PointSize = size * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const frag = /* glsl */`
uniform sampler2D map; varying vec4 vColor; varying float vRot;
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  uv = vec2(c*uv.x - s*uv.y, s*uv.x + c*uv.y) + 0.5;
  vec4 t = texture2D(map, uv);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * t.rgb, a);
}`;

class ParticleSystem {
  constructor(scene, texture, { capacity = 600, additive = true } = {}) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.s0 = new Float32Array(capacity); this.s1 = new Float32Array(capacity);
    this.a0 = new Float32Array(capacity);
    this.rgb = new Float32Array(capacity * 3);
    this.grav = new Float32Array(capacity); this.drag = new Float32Array(capacity); this.rs = new Float32Array(capacity);
    this.alive = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('rot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, uScale: { value: 500 } },
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  emit(p, o = {}) {
    const n = o.count ?? 10;
    for (let k = 0; k < n; k++) {
      if (this.alive >= this.cap) return;
      const i = this.alive++;
      const sp = (o.speed ?? 4) * (0.4 + Math.random() * 0.8);
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
      if (o.dir) { const sp2 = o.spread ?? 0.5; dx = o.dir.x + dx * sp2; dy = o.dir.y + dy * sp2; dz = o.dir.z + dz * sp2; }
      dy += o.up ?? 0;
      const r = o.radius ?? 0;
      this.pos[i * 3] = p.x + (Math.random() * 2 - 1) * r; this.pos[i * 3 + 1] = p.y + (Math.random() * 2 - 1) * r * (o.flat ? 0 : 1); this.pos[i * 3 + 2] = p.z + (Math.random() * 2 - 1) * r;
      this.vel[i * 3] = dx * sp; this.vel[i * 3 + 1] = dy * sp; this.vel[i * 3 + 2] = dz * sp;
      const life = (o.life ?? 0.6) * (0.7 + Math.random() * 0.6);
      this.life[i] = life; this.maxLife[i] = life;
      const sz = (o.size ?? 1) * (0.7 + Math.random() * 0.6);
      this.s0[i] = sz; this.s1[i] = sz * (o.sizeEnd ?? 0.2);
      const c = o.color ?? [1, 1, 1];
      const cv = o.colorVar ?? 0;
      this.rgb[i * 3] = c[0] * (1 - Math.random() * cv); this.rgb[i * 3 + 1] = c[1] * (1 - Math.random() * cv); this.rgb[i * 3 + 2] = c[2] * (1 - Math.random() * cv);
      this.a0[i] = o.alpha ?? 1;
      this.grav[i] = o.gravity ?? 0; this.drag[i] = o.drag ?? 1.5;
      this.rot[i] = Math.random() * Math.PI * 2; this.rs[i] = (Math.random() * 2 - 1) * (o.spin ?? 2);
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.alive) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); continue; }
      const t = 1 - this.life[i] / this.maxLife[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      this.col[i * 4] = this.rgb[i * 3]; this.col[i * 4 + 1] = this.rgb[i * 3 + 1]; this.col[i * 4 + 2] = this.rgb[i * 3 + 2];
      this.col[i * 4 + 3] = this.a0[i] * fade;
      this.rot[i] += this.rs[i] * dt;
      i++;
    }
    const g = this.geo;
    g.setDrawRange(0, this.alive);
    g.attributes.position.needsUpdate = true; g.attributes.pcolor.needsUpdate = true; g.attributes.size.needsUpdate = true; g.attributes.rot.needsUpdate = true;
  }

  kill(i) {
    const j = --this.alive;
    if (i === j) return;
    const c3 = (a) => { a[i * 3] = a[j * 3]; a[i * 3 + 1] = a[j * 3 + 1]; a[i * 3 + 2] = a[j * 3 + 2]; };
    c3(this.pos); c3(this.vel); c3(this.rgb);
    for (let k = 0; k < 4; k++) this.col[i * 4 + k] = this.col[j * 4 + k];
    for (const a of [this.size, this.rot, this.life, this.maxLife, this.s0, this.s1, this.a0, this.grav, this.drag, this.rs]) a[i] = a[j];
  }
}

export class VFX {
  constructor(scene, assets, renderer) {
    this.scene = scene;
    this.assets = assets;
    const T = assets.textures;
    this.sys = {
      spark: new ParticleSystem(scene, T.p_spark_01, { capacity: 900 }),
      spark2: new ParticleSystem(scene, T.p_spark_04, { capacity: 400 }),
      flare: new ParticleSystem(scene, T.p_flare_01, { capacity: 300 }),
      light: new ParticleSystem(scene, T.p_light_01, { capacity: 300 }),
      smoke: new ParticleSystem(scene, T.p_smoke_01, { capacity: 500, additive: false }),
      dirt: new ParticleSystem(scene, T.p_dirt_01, { capacity: 300, additive: false }),
      fire: new ParticleSystem(scene, T.p_fire_01, { capacity: 600 }),
      magic: new ParticleSystem(scene, T.p_magic_01, { capacity: 300 }),
      star: new ParticleSystem(scene, T.p_star_06, { capacity: 200 }),
      ember: new ParticleSystem(scene, T.p_spark_05, { capacity: 500 }),
    };
    this.pixelRatioScale(renderer);
    this.decals = [];
    this.rings = [];
    this.slashTex = [T.p_slash_01, T.p_slash_02, T.p_slash_03];
    this.trails = [];
  }

  pixelRatioScale(renderer) {
    const h = renderer.domElement.height;
    for (const s of Object.values(this.sys)) s.mat.uniforms.uScale.value = h * 0.9;
  }

  hitSparks(p, dir, { heavy = false, color = [1, 0.75, 0.4], blood = true } = {}) {
    this.sys.spark.emit(p, { count: heavy ? 40 : 18, speed: heavy ? 14 : 9, dir, spread: 0.9, life: 0.35, size: heavy ? 1.1 : 0.7, color, gravity: 9, drag: 3, sizeEnd: 0.1 });
    this.sys.flare.emit(p, { count: 1, speed: 0, life: heavy ? 0.22 : 0.14, size: heavy ? 7 : 4, color: [1, 0.6, 0.3], sizeEnd: 1.6, spin: 0 });
    this.sys.light.emit(p, { count: 2, speed: 0.5, life: 0.18, size: heavy ? 5 : 3, color: [1, 0.85, 0.6], sizeEnd: 2 });
    if (blood) this.sys.spark2.emit(p, { count: heavy ? 24 : 12, speed: 7, dir, spread: 0.7, life: 0.5, size: 0.9, color: [0.9, 0.05, 0.08], gravity: 14, drag: 2 });
  }

  boneBurst(p) {
    this.sys.dirt.emit(p, { count: 18, speed: 6, up: 0.6, life: 0.8, size: 1.1, color: [0.85, 0.82, 0.72], gravity: 12, drag: 1.2, sizeEnd: 0.6, alpha: 0.9 });
    this.sys.smoke.emit(p, { count: 10, speed: 2.5, life: 1.1, size: 3.5, color: [0.5, 0.45, 0.42], sizeEnd: 1.8, alpha: 0.45, drag: 2, radius: 0.4 });
  }

  deathBurst(p, color = [1, 0.15, 0.1]) {
    this.sys.magic.emit(p, { count: 14, speed: 4, up: 0.5, life: 0.9, size: 1.8, color, sizeEnd: 0, drag: 2 });
    this.sys.smoke.emit(p, { count: 16, speed: 3, up: 0.2, life: 1.4, size: 4, color: [0.18, 0.12, 0.12], sizeEnd: 2, alpha: 0.6, drag: 2, radius: 0.6 });
    this.sys.ember.emit(p, { count: 30, speed: 6, up: 0.8, life: 1.2, size: 0.5, color: [1, 0.4, 0.15], gravity: -1, drag: 1.5 });
  }

  dust(p, n = 10, size = 2.5) {
    this.sys.smoke.emit(p, { count: n, speed: 2.2, life: 0.9, size, color: [0.42, 0.38, 0.35], sizeEnd: 2.2, alpha: 0.5, drag: 2.5, radius: 0.3, flat: true });
  }

  groundSlam(p, radius = 6, color = [1, 0.35, 0.15]) {
    this.ring(p, radius, color, 0.45);
    this.sys.dirt.emit(p, { count: 40, speed: 10, up: 0.9, life: 0.9, size: 1.2, color: [0.6, 0.55, 0.5], gravity: 18, drag: 1, radius: 1 });
    this.sys.smoke.emit(p, { count: 30, speed: 7, life: 1.2, size: 4, color: [0.35, 0.3, 0.28], sizeEnd: 2.5, alpha: 0.6, drag: 2.5, radius: 1, flat: true });
    this.sys.fire.emit(p, { count: 30, speed: 9, life: 0.5, size: 2.2, color, drag: 3, radius: 0.6, flat: true });
  }

  ring(p, radius, color = [1, 0.4, 0.2], life = 0.4, tex = 'p_circle_05') {
    let r = this.rings.find(x => !x.active);
    if (!r) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.assets.textures[tex], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.rotation.x = -Math.PI / 2; m.renderOrder = 9; this.scene.add(m);
      r = { mesh: m }; this.rings.push(r);
    }
    r.active = true; r.t = 0; r.life = life; r.radius = radius;
    r.mesh.visible = true; r.mesh.position.set(p.x, p.y + 0.08, p.z);
    r.mesh.material.color.setRGB(...color);
    return r;
  }

  slash(p, yaw, { scale = 3.4, color = [1, 0.85, 0.75], tilt = 0, life = 0.18 } = {}) {
    let d = this.decals.find(x => !x.active);
    if (!d) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      m.renderOrder = 11; this.scene.add(m);
      d = { mesh: m }; this.decals.push(d);
    }
    d.active = true; d.t = 0; d.life = life;
    const m = d.mesh; m.visible = true;
    m.material.map = this.slashTex[(Math.random() * 3) | 0]; m.material.needsUpdate = true;
    m.material.color.setRGB(...color);
    m.position.copy(p);
    m.rotation.set(-Math.PI / 2 + tilt, 0, 0);
    m.rotation.order = 'YXZ';
    m.rotation.y = yaw;
    m.scale.setScalar(scale);
    d.baseScale = scale;
  }

  // Sword trail ribbon (follows two points on the blade).
  createTrail(color = 0xffd2b0, length = 14) {
    const n = length;
    const pos = new Float32Array(n * 2 * 3);
    const alpha = new Float32Array(n * 2);
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) }, intensity: { value: 0 } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform vec3 color; uniform float intensity; varying float vA; void main(){ gl_FragColor = vec4(color*1.6, vA*vA*intensity); }',
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 12;
    this.scene.add(mesh);
    const trail = { mesh, n, pts: [], intensity: 0, target: 0 };
    this.trails.push(trail);
    return trail;
  }

  pushTrail(trail, a, b) {
    trail.pts.unshift([a.clone(), b.clone()]);
    if (trail.pts.length > trail.n) trail.pts.pop();
  }

  update(dt) {
    for (const s of Object.values(this.sys)) s.update(dt);
    for (const d of this.decals) {
      if (!d.active) continue;
      d.t += dt; const k = d.t / d.life;
      if (k >= 1) { d.active = false; d.mesh.visible = false; continue; }
      d.mesh.material.opacity = 1 - k * k;
      d.mesh.scale.setScalar(d.baseScale * (1 + k * 0.35));
    }
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt; const k = r.t / r.life;
      if (k >= 1) { r.active = false; r.mesh.visible = false; continue; }
      const e = 1 - Math.pow(1 - k, 3);
      r.mesh.scale.setScalar(r.radius * 2 * (0.2 + 0.8 * e));
      r.mesh.material.opacity = 1 - k;
    }
    for (const t of this.trails) {
      t.intensity += (t.target - t.intensity) * Math.min(1, dt * (t.target > t.intensity ? 30 : 8));
      t.mesh.material.uniforms.intensity.value = t.intensity;
      const pos = t.mesh.geometry.attributes.position.array, al = t.mesh.geometry.attributes.alpha.array;
      for (let i = 0; i < t.n; i++) {
        const p = t.pts[Math.min(i, t.pts.length - 1)];
        if (!p) continue;
        pos.set([p[0].x, p[0].y, p[0].z], i * 6); pos.set([p[1].x, p[1].y, p[1].z], i * 6 + 3);
        const a = 1 - i / (t.n - 1);
        al[i * 2] = a * 0.2; al[i * 2 + 1] = a;
      }
      t.mesh.geometry.attributes.position.needsUpdate = true; t.mesh.geometry.attributes.alpha.needsUpdate = true;
    }
  }
}
