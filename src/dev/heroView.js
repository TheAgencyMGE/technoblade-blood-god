// Dev-only: render Technoblade exactly as the game builds him, for visual checks.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AssetManager } from '../core/AssetManager.js';

const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(innerWidth, innerHeight); document.body.appendChild(r.domElement);
const s = new THREE.Scene(); s.background = new THREE.Color(0x2a2a33);
s.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2)); const d = new THREE.DirectionalLight(0xffffff, 2); d.position.set(3, 5, 4); s.add(d);
s.add(new THREE.GridHelper(10, 10));
const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 100);
const view = new URLSearchParams(location.search).get('view') || 'front';
const views = { front: [0, 1.8, 6], side: [6, 1.8, 0], side2: [-6, 1.8, 0], back: [0, 1.8, -6], three: [4, 2.4, 4.5], back3: [-4, 2.6, -4.5] };
cam.position.set(...views[view]);
const oc = new OrbitControls(cam, r.domElement); oc.target.set(0, 1.4, 0); oc.update();
const am = new AssetManager();
await am.loadAll();
const hero = am.buildTechnoblade();
s.add(hero.root);
const mixer = new THREE.AnimationMixer(hero.root);
const clip = new URLSearchParams(location.search).get('anim') || 'Idle';
mixer.clipAction(am.clips.kaykit[clip]).play();
if (new URLSearchParams(location.search).get('bow')) { hero.bow.visible = true; hero.sword.visible = false; }
window.hero = hero; window.ready = true; window.THREE = THREE; window.am = am;
const clk = new THREE.Clock();
r.setAnimationLoop(() => { mixer.update(clk.getDelta()); oc.update(); r.render(s, cam); });
