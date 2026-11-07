// PostFX — bloom + a dark-fantasy colour grade (vignette, Blood God crimson grade,
// low-health pulse, impact chromatic aberration, death desaturation).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uBlood: { value: 0 }, uLow: { value: 0 }, uChroma: { value: 0 }, uDesat: { value: 0 }, uVignette: { value: 0.42 }, uSpeed: { value: 0 }, uDim: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uBlood, uLow, uChroma, uDesat, uVignette, uSpeed, uDim; varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c,c);
      vec2 off = c * uChroma * 0.03;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      // speed: radial streak blur toward the screen edges
      if (uSpeed > 0.01) {
        float edge = smoothstep(0.04, 0.3, r2) * uSpeed;
        vec3 acc = col;
        for (int i = 1; i <= 6; i++) acc += texture2D(tDiffuse, vUv - c * float(i) * 0.012 * edge).rgb;
        col = mix(col, acc / 7.0, clamp(edge * 1.4, 0.0, 1.0));
      }
      float l = dot(col, vec3(0.299,0.587,0.114));
      // Blood God: crush to crimson, keep highlights hot
      vec3 blood = mix(vec3(l*1.25, l*0.25, l*0.2), col*vec3(1.35,0.55,0.5), 0.45);
      col = mix(col, blood, uBlood);
      col = mix(col, vec3(l), uDesat);
      float vig = smoothstep(0.85, 0.15, r2 * (1.0 + uVignette*1.6));
      col *= mix(1.0, vig, 0.85);
      float pulse = (0.5 + 0.5*sin(uTime*6.0)) * uLow;
      col = mix(col, vec3(0.55,0.0,0.02), smoothstep(0.12, 0.5, r2) * (0.35*uLow + 0.25*pulse));
      col = mix(col, vec3(0.35,0.0,0.0), smoothstep(0.1, 0.55, r2) * uBlood * 0.45);
      col *= 1.0 - uDim;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.vmPass = null; // first-person viewmodel pass (inserted on demand)
    this.speed = 0; this.dim = 0; this.dimTarget = 0;
    const size = renderer.getSize(new THREE.Vector2());
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.5, 0.82);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.blood = 0; this.bloodTarget = 0; this.chroma = 0; this.desat = 0; this.desatTarget = 0;
    this.enabled = true;
    this.scene = scene; this.camera = camera;
  }
  setSize(w, h) { this.composer.setSize(w, h); this.bloom.resolution.set(w / 2, h / 2); }
  setViewModel(scene, camera) {
    const p = new RenderPass(scene, camera); p.clear = false; p.clearDepth = true; p.enabled = false;
    this.composer.insertPass(p, 1); this.vmPass = p;
  }
  showViewModel(on) { if (this.vmPass) this.vmPass.enabled = on; }
  setBloodGod(on) { this.bloodTarget = on ? 1 : 0; }
  hit(v = 1) { this.chroma = Math.max(this.chroma, v); }
  render(dt, { lowHp = 0, time = 0, dead = false } = {}) {
    this.blood += (this.bloodTarget - this.blood) * Math.min(1, dt * 3);
    this.chroma = Math.max(0, this.chroma - dt * 3);
    this.desat += ((dead ? 0.85 : 0) - this.desat) * Math.min(1, dt * 1.5);
    const u = this.grade.uniforms;
    this.dim += (this.dimTarget - this.dim) * Math.min(1, dt * 4);
    u.uTime.value = time; u.uBlood.value = this.blood; u.uLow.value = lowHp; u.uChroma.value = this.chroma + this.blood * 0.15; u.uDesat.value = this.desat;
    u.uSpeed.value = this.speed; u.uDim.value = this.dim;
    this.bloom.strength = 0.5 + this.blood * 0.5;
    if (this.enabled) this.composer.render(dt);
    else {
      this.renderer.render(this.scene, this.camera);
      if (this.vmPass?.enabled) { this.renderer.autoClear = false; this.renderer.clearDepth(); this.renderer.render(this.vmPass.scene, this.vmPass.camera); this.renderer.autoClear = true; }
    }
  }
}
