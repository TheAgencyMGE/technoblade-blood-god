// AssetManager — loads every downloaded asset (models, clips, textures, HDRI, audio)
// and hands out configured clones. No geometry or art is authored here: the only
// "adaptation" is hiding meshes, re-parenting, scaling and tinting existing assets.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const A = 'assets/';

export const MODEL_FILES = {
  knight: 'characters/Knight.glb',
  pig: 'characters/PigB.glb',
  skMinion: 'characters/Skeleton_Minion.glb',
  skWarrior: 'characters/Skeleton_Warrior.glb',
  skRogue: 'characters/Skeleton_Rogue.glb',
  skMage: 'characters/Skeleton_Mage.glb',
  orc: 'characters/Orc.glb',
  demon: 'characters/Demon.glb',
  blueDemon: 'characters/BlueDemon.glb',
  giant: 'characters/Giant.glb',
  crown: 'weapons/Crown.glb',
  bow: 'weapons/BowWooden.glb',
  arrow: 'weapons/arrow.gltf',
  arrowBundle: 'weapons/arrow_bundle.gltf',
  potion: 'env/potion.glb',
  skBlade: 'weapons/Skeleton_Blade.gltf',
  skAxe: 'weapons/Skeleton_Axe.gltf',
  skStaff: 'weapons/Skeleton_Staff.gltf',
  skCrossbow: 'weapons/Skeleton_Crossbow.gltf',
  skShield: 'weapons/Skeleton_Shield_Large_A.gltf',
  skShieldSmall: 'weapons/Skeleton_Shield_Small_A.gltf',
  skArrow: 'weapons/Skeleton_Arrow.gltf',
};

const ENV_PIECES = ['wall', 'wall_broken', 'wall_cracked', 'wall_half', 'wall_corner', 'wall_archedwindow_open', 'wall_pillar',
  'pillar', 'pillar_decorated', 'column', 'torch_lit', 'torch_mounted', 'banner_red', 'banner_patternA_red', 'banner_shield_red',
  'banner_triple_red', 'barrel_large', 'barrel_small_stack', 'crates_stacked', 'rubble_large', 'rubble_half', 'barrier',
  'barrier_column', 'sword_shield_broken', 'box_stacked', 'keg_decorated', 'candle_triple', 'floor_tile_large',
  'floor_dirt_large_rocky', 'dead_tree_2', 'dead_tree_5', 'rock_b', 'rock_medium', 'grave_a', 'grave_b', 'grave_destroyed',
  'stairs', 'floor_wood_large', 'wall_scaffold', 'floor_foundation_allsides', 'barrel_small', 'box_small', 'box_large'];
for (const e of ENV_PIECES) MODEL_FILES['env_' + e] = 'env/' + e + '.glb';

export const TEXTURE_FILES = {
  cobble_diff: 'textures/cobblestone_floor_04_diff_1k.jpg',
  cobble_nor: 'textures/cobblestone_floor_04_nor_gl_1k.jpg',
  cobble_rough: 'textures/cobblestone_floor_04_rough_1k.jpg',
  rocky_diff: 'textures/rocky_trail_diff_1k.jpg',
  rocky_nor: 'textures/rocky_trail_nor_gl_1k.jpg',
  rocky_rough: 'textures/rocky_trail_rough_1k.jpg',
};
const PARTICLES = ['slash_01', 'slash_02', 'slash_03', 'spark_01', 'spark_04', 'spark_05', 'smoke_01', 'smoke_04', 'flare_01',
  'light_01', 'light_02', 'magic_01', 'magic_03', 'circle_05', 'scorch_01', 'trace_01', 'twirl_01', 'fire_01', 'flame_03',
  'star_06', 'dirt_01', 'symbol_01'];
for (const p of PARTICLES) TEXTURE_FILES['p_' + p] = 'textures/particles/' + p + '.png';

export const HDRI_FILE = 'hdri/moonless_golf_1k.hdr';

function stripClipName(name) {
  // Quaternius exports: "CharacterArmature|Run" / "EnemyArmature|EnemyArmature|EnemyArmature|Attack"
  const parts = name.split('|');
  return parts[parts.length - 1];
}

export class AssetManager {
  constructor() {
    this.shirtHalfWidth = 0.13; // front shirt column (tuned by image)
    this.shirtSplitY = 0.86;    // shirt above, red belly panel below
    this.gltf = {};
    this.textures = {};
    this.hdri = null;
    this.clips = {}; // rigName -> { clipName: AnimationClip }
    this.manager = new THREE.LoadingManager();
    this.loader = new GLTFLoader(this.manager);
    this.texLoader = new THREE.TextureLoader(this.manager);
  }

  async loadAll(onProgress, audio) {
    const jobs = [];
    let done = 0;
    const total = Object.keys(MODEL_FILES).length + Object.keys(TEXTURE_FILES).length + 1 + (audio ? audio.fileCount() : 0);
    const tick = (label) => { done++; onProgress?.(done / total, label); };

    for (const [key, file] of Object.entries(MODEL_FILES)) {
      jobs.push(this.loader.loadAsync(A + file).then(g => { this.gltf[key] = g; tick(file); }));
    }
    for (const [key, file] of Object.entries(TEXTURE_FILES)) {
      jobs.push(this.texLoader.loadAsync(A + file).then(t => {
        if (key.endsWith('_diff') || key.startsWith('p_')) t.colorSpace = THREE.SRGBColorSpace;
        this.textures[key] = t; tick(file);
      }));
    }
    jobs.push(new RGBELoader().loadAsync(A + HDRI_FILE).then(t => { t.mapping = THREE.EquirectangularReflectionMapping; this.hdri = t; tick(HDRI_FILE); }));
    if (audio) jobs.push(audio.loadAll(A, tick));
    await Promise.all(jobs);
    this.buildClipLibraries();
  }

  buildClipLibraries() {
    // All KayKit characters share the same "Rig_Medium" skeleton with identical bone names,
    // so clips from the Skeleton pack (jump chop, taunt, spawn...) also drive the Knight.
    const kay = {};
    for (const k of ['knight', 'skWarrior', 'skMinion', 'skRogue', 'skMage']) {
      for (const c of this.gltf[k].animations) if (!kay[c.name]) kay[c.name] = c;
    }
    this.clips.kaykit = kay;
    for (const k of ['orc', 'demon', 'blueDemon', 'giant', 'pig']) {
      const lib = {};
      for (const c of this.gltf[k].animations) { const n = stripClipName(c.name); const cc = c.clone(); cc.name = n; lib[n] = cc; }
      this.clips[k] = lib;
    }
  }

  // Clone a skinned character, enabling shadows.
  cloneCharacter(key) {
    const src = this.gltf[key].scene;
    const root = SkeletonUtils.clone(src);
    root.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        if (o.material) o.material = o.material.clone(); }
    });
    return root;
  }

  cloneStatic(key, { shadows = true, receive = true } = {}) {
    const root = this.gltf[key].scene.clone(true);
    root.traverse(o => { if (o.isMesh) { o.castShadow = shadows; o.receiveShadow = receive; } });
    return root;
  }

  findBone(root, name) {
    const want = name.replace(/\./g, '');
    let b = null; root.traverse(o => { if (!b && (o.name === name || o.name === want)) b = o; }); return b;
  }

  // Extract the head portion of the downloaded blocky pig model (triangles skinned to its
  // Head bone), expressed in head-bone space so it can be mounted on a humanoid head bone.
  buildPigHeadGeometry() {
    if (this._pigHead) return this._pigHead;
    let sm = null;
    this.gltf.pig.scene.traverse(o => { if (o.isSkinnedMesh) sm = o; });
    const sk = sm.skeleton;
    const names = sk.bones.map(b => b.name);
    const headIdx = names.indexOf('Head');
    const headSet = names.map((n, i) => (/^Head/.test(n) ? i : -1)).filter(i => i >= 0);
    const g = sm.geometry;
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, idx = g.index;
    const dominant = (v) => { let best = -1, bw = -1; for (let c = 0; c < 4; c++) { const w = sw.getComponent(v, c); if (w > bw) { bw = w; best = si.getComponent(v, c); } } return best; };
    const keep = [];
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      if (headSet.includes(dominant(a)) && headSet.includes(dominant(b)) && headSet.includes(dominant(c))) keep.push(a, b, c);
    }
    const ng = g.clone();
    ng.setIndex(keep);
    ng.deleteAttribute('skinIndex'); ng.deleteAttribute('skinWeight');
    ng.applyMatrix4(new THREE.Matrix4().multiplyMatrices(sk.boneInverses[headIdx], sm.bindMatrix));
    ng.computeBoundingBox();
    const c = new THREE.Vector3(); ng.boundingBox.getCenter(c);
    ng.translate(-c.x, -c.y, -c.z);
    ng.computeBoundingBox();
    this._pigHead = { geometry: ng, material: sm.material };
    return this._pigHead;
  }

  // Palette remaps of the KayKit knight texture (a material adjustment of the existing asset).
  technoTextures(src) {
    if (this._technoTex) return this._technoTex;
    const img = src.image;
    const w = img.width, h = img.height;
    const base = document.createElement('canvas'); base.width = w; base.height = h;
    const bctx = base.getContext('2d'); bctx.drawImage(img, 0, 0);
    const srcData = bctx.getImageData(0, 0, w, h).data;
    // The atlas is 8 columns x 4 bands of vertical gradient swatches (128 x 256 px each).
    // `map` assigns a target colour (taken from Technoblade's actual skin) to a swatch
    // "col,band"; the swatch's own light->dark gradient is preserved as shading.
    const SW = 128, SH = 256;
    const make = (map) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); const out = ctx.createImageData(w, h); const d = out.data;
      const topLum = {};
      for (let i = 0; i < d.length; i += 4) {
        const px = (i / 4) % w, py = Math.floor(i / 4 / w);
        const key = Math.floor(px / SW) + ',' + Math.floor(py / SH);
        const target = map[key];
        const r = srcData[i], g = srcData[i + 1], b = srcData[i + 2];
        if (!target) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = srcData[i + 3]; continue; }
        if (topLum[key] === undefined) { const o = ((Math.floor(py / SH) * SH) * w + Math.floor(px / SW) * SW + 64) * 4; topLum[key] = Math.max(1, (srcData[o] + srcData[o + 1] + srcData[o + 2]) / 3); }
        const shade = Math.min(1.05, ((r + g + b) / 3) / topLum[key]);
        d[i] = target[0] * shade; d[i + 1] = target[1] * shade; d[i + 2] = target[2] * shade; d[i + 3] = srcData[i + 3];
      }
      ctx.putImageData(out, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.flipY = src.flipY; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = src.wrapS; t.wrapT = src.wrapT;
      t.magFilter = src.magFilter; t.minFilter = src.minFilter;
      return t;
    };
    // Colours sampled from Technoblade's skin (sRGB 0-255), whites kept soft so they don't blow out.
    const ROBE = [179, 0, 0], ROBE_DK = [140, 0, 0], PANEL = [225, 26, 26], SHIRT = [196, 196, 196], FUR = [178, 178, 178],
      GOLD = [230, 200, 0], SKIN = [232, 150, 150], TROUSER = [71, 71, 71], TROUSER_LT = [110, 110, 110], BOOT = [22, 22, 22], BOOT_BAND = [42, 42, 42],
      DIAMOND = [74, 237, 217], HANDLE = [107, 74, 42], DIAMOND_DK = [20, 120, 110];
    this._technoTex = {
      // torso: red robe body, white shirt front plate, bright red belly panel (belt), yellow buttons, fur trim
      // (5,3 / 4,3 are spare swatches used for the front shirt column and belly panel)
      body: make({ '3,0': ROBE, '7,0': ROBE, '7,1': ROBE_DK, '6,0': PANEL, '2,1': GOLD, '0,1': GOLD, '1,1': FUR }),
      // arms (T-pose order shoulder -> hand): red upper sleeve, white fur cuff, pink pig forearm/hand
      arms: make({ '3,0': ROBE, '6,0': FUR, '7,0': SKIN, '4,0': SKIN }),
      // legs: dark grey trousers, lighter patches at the knee, black boots, robe hem at the waist
      legs: make({ '3,0': BOOT, '7,0': BOOT_BAND, '7,1': TROUSER, '6,0': ROBE_DK }),
      // back of the robe
      cape: make({ '0,1': ROBE }),
      // Minecraft diamond sword: cyan blade, wooden handle, dark teal pommel
      diamond: make({ '3,1': DIAMOND, '5,1': HANDLE, '2,2': DIAMOND_DK }),
    };
    void TROUSER_LT;
    return this._technoTex;
  }

  // Build Technoblade from existing assets: KayKit Knight body/armour/cape/2H sword,
  // Quaternius blocky pig head, Quaternius crown, wooden bow.
  buildTechnoblade() {
    const root = this.cloneCharacter('knight');
    const hide = ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', 'Knight_Helmet', 'Knight_Head'];
    const parts = {};
    root.traverse(o => { if (hide.includes(o.name)) o.visible = false; parts[o.name] = o; });
    // Recolour the knight's palette texture per body part to Technoblade's skin:
    // white shirt + red sash (torso/arms), dark trousers (legs), red royal cape, diamond sword.
    const cape = parts['Knight_Cape'];
    const tex = this.technoTextures(parts['Knight_Body'].material.map);
    const use = (name, t) => parts[name]?.traverse(o => { if (o.isMesh) { o.material.map = t; o.material.color.set(0xffffff); o.material.needsUpdate = true; } });
    use('Knight_Body', tex.body); use('Knight_ArmLeft', tex.arms); use('Knight_ArmRight', tex.arms);
    // Front shirt column painted in the body material's shader from the rest-pose position, so its
    // edges are perfectly straight (a per-triangle UV remap followed the notched plate and looked jagged).
    const bm = parts['Knight_Body']?.material;
    if (bm) {
      const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
      const U = { uShirt: { value: lin(0xd6d6d6) }, uFur: { value: lin(0xa8a8a8) }, uPanel: { value: lin(0xe11a1a) }, uButton: { value: lin(0xffe600) },
        uHalfW: { value: this.shirtHalfWidth }, uTrim: { value: 0.035 }, uTop: { value: 1.3 }, uSplit: { value: this.shirtSplitY }, uBottom: { value: 0.62 } };
      bm.userData.shirtUniforms = U;
      bm.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRestPos; varying vec3 vRestN;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRestPos = position; vRestN = normal;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
          varying vec3 vRestPos; varying vec3 vRestN;
          uniform vec3 uShirt, uFur, uPanel, uButton; uniform float uHalfW, uTrim, uTop, uSplit, uBottom;`)
          .replace('#include <map_fragment>', `#include <map_fragment>
          if (vRestN.z > -0.3 && vRestPos.z > 0.12 && vRestPos.y > uBottom && vRestPos.y < uTop) {
            float ax = abs(vRestPos.x);
            float shade = 1.0;
            if (ax < uHalfW) {
              vec3 c = vRestPos.y > uSplit ? uShirt : uPanel;
              // three yellow buttons down the shirt
              if (vRestPos.y > uSplit && ax < 0.022) {
                float t = fract((vRestPos.y - uSplit) / 0.12);
                if (t > 0.35 && t < 0.65) c = uButton;
              }
              diffuseColor.rgb = c * shade;
            } else if (ax < uHalfW + uTrim) {
              diffuseColor.rgb = uFur * shade;   // fur edging beside the shirt
            }
          }`);
      };
      bm.customProgramCacheKey = () => 'techno-shirt';
      bm.needsUpdate = true;
    }
    const bodyMesh = parts['Knight_Body'];
    if (false && bodyMesh?.isMesh) {
      if (!this._technoBodyGeo) {
        let geo = bodyMesh.geometry.clone(); if (geo.index) geo = geo.toNonIndexed();
        const pos = geo.attributes.position, uv = geo.attributes.uv;
        const slot = (col, band) => [(col * 128 + 64) / 1024, (band * 256 + 40) / 1024];
        const SHIRT_UV = slot(5, 3), PANEL_UV = slot(4, 3);
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
        for (let t = 0; t < pos.count; t += 3) {
          a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t + 1); c.fromBufferAttribute(pos, t + 2);
          n.subVectors(c, b).cross(a.clone().sub(b)).normalize();
          const cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3;
          // whole triangle inside the column, on the front, facing forward
          if (cz < 0.16 || Math.abs(n.z) < 0.55 || [a, b, c].some(v => Math.abs(v.x) > this.shirtHalfWidth)) continue;
          const target = cy >= this.shirtSplitY ? SHIRT_UV : (cy >= 0.62 ? PANEL_UV : null);
          if (!target) continue;
          for (let k = 0; k < 3; k++) uv.setXY(t + k, target[0], target[1]);
        }
        this._technoBodyGeo = geo;
      }
      bodyMesh.geometry = this._technoBodyGeo;
    }
    use('Knight_LegLeft', tex.legs); use('Knight_LegRight', tex.legs);
    use('Knight_Cape', tex.cape);
    use('2H_Sword', tex.diamond);
    parts['2H_Sword']?.traverse(o => { if (o.isMesh) { o.material.metalness = 0.3; o.material.roughness = 0.35; } });

    const headBone = this.findBone(root, 'head');
    const ph = this.buildPigHeadGeometry();
    const pigMat = ph.material.clone();
    // "TechnobladeHead" group = pig head + crown as one unit, mounted on the head bone.
    // The group carries the placement/orientation; children carry only their own size.
    const headGroup = new THREE.Group();
    headGroup.name = 'TechnobladeHead';
    // Pig head geometry is authored snout-along-bone; stand it upright facing +Z.
    headGroup.rotation.set(Math.PI / 2, Math.PI, 0);
    headGroup.position.set(0, -0.05, -0.42); // tuned visually (side views) so the head sits centred on the collar
    headBone.add(headGroup);
    const pigHead = new THREE.Mesh(ph.geometry, pigMat);
    pigHead.name = 'PigHead';
    pigHead.castShadow = true;
    const HEAD_SCALE = 75;
    pigHead.scale.setScalar(HEAD_SCALE);
    headGroup.add(pigHead);
    const hbb = ph.geometry.boundingBox;

    const crownSrc = this.gltf.crown.scene.clone(true);
    const cb = new THREE.Box3().setFromObject(crownSrc); const cc = new THREE.Vector3(); cb.getCenter(cc);
    const cs = new THREE.Vector3(); cb.getSize(cs);
    crownSrc.position.sub(cc);
    const crown = new THREE.Group(); crown.add(crownSrc);
    crown.name = 'Crown';
    crown.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.material = o.material.clone(); o.material.metalness = 0.8; o.material.roughness = 0.3;
      // Technoblade's crown: bright yellow gold set with blue, dark-blue, purple, red and lime gems
      if (o.material.name === 'Gold') { o.material.color.set(0xe8cc10); o.material.metalness = 0.6; o.material.roughness = 0.35; }
      // this crown model has a single gem: make it the skin's sapphire blue
      if (o.material.name === 'Red') { o.material.color.set(0x4f70f5); o.material.metalness = 0.15; o.material.roughness = 0.2; }
    });
    // Crown is a sibling of the pig head inside the TechnobladeHead group, sitting on the head top.
    const hW = (hbb.max.x - hbb.min.x) * HEAD_SCALE;           // head width (world units)
    const crownScale = hW * 0.82 / Math.max(cs.x, cs.z);       // slightly narrower than the head
    headGroup.add(crown);
    crown.quaternion.copy(headGroup.quaternion).invert();      // undo the group's rotation -> upright
    crown.scale.setScalar(crownScale);
    const sink = cs.y * crownScale * 0.25;                     // base rests just into the head top
    // group-local +Z is the top of the head; +Y shifts toward the snout (values verified by side-view image)
    crown.position.set(0, 0.0056 * HEAD_SCALE, hbb.max.z * HEAD_SCALE + sink);

    // Bow mounted on the left hand slot, hidden until the bow is drawn.
    const bowSrc = this.gltf.bow.scene.clone(true);
    const bb = new THREE.Box3().setFromObject(bowSrc); const bc = new THREE.Vector3(); bb.getCenter(bc); const bs = new THREE.Vector3(); bb.getSize(bs);
    bowSrc.position.sub(bc);
    const bow = new THREE.Group(); bow.add(bowSrc);
    bow.scale.setScalar(1.7 / Math.max(bs.x, bs.y, bs.z));
    bow.traverse(o => { if (o.isMesh) o.castShadow = true; });
    const lh = this.findBone(root, 'handslot.l');
    lh.add(bow);
    // Orient the bow from the actual aiming pose: limbs vertical, belly toward the target.
    const aimClip = this.clips.kaykit?.['Blocking']; // left arm out, right hand drawn back: a bow stance
    if (aimClip) {
      const mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(aimClip).play(); mixer.setTime(aimClip.duration * 0.5);
      root.updateMatrixWorld(true);
      const handQ = lh.getWorldQuaternion(new THREE.Quaternion());
      const rootQ = root.getWorldQuaternion(new THREE.Quaternion());
      const desired = rootQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.bowYaw ?? Math.PI / 2));
      bow.quaternion.copy(handQ.invert().multiply(desired));
      mixer.stopAllAction(); mixer.uncacheRoot(root);
    }
    bow.visible = false;

    return { root, sword: parts['2H_Sword'], bow, crown, pigHead, headGroup, cape, headBone,
      handR: this.findBone(root, 'handslot.r'), handL: lh, chest: this.findBone(root, 'chest') };
  }

  // A KayKit hand-held prop (separate .gltf) attached to a hand slot.
  attachProp(root, key, boneName, { scale = 1, rot = [0, 0, 0], pos = [0, 0, 0] } = {}) {
    const bone = this.findBone(root, boneName);
    const p = this.gltf[key].scene.clone(true);
    p.traverse(o => { if (o.isMesh) o.castShadow = true; });
    p.scale.setScalar(scale); p.rotation.set(...rot); p.position.set(...pos);
    bone.add(p);
    return p;
  }

  makeArrowMesh() {
    const a = this.gltf.arrow.scene.clone(true);
    const b = new THREE.Box3().setFromObject(a); const s = new THREE.Vector3(); b.getSize(s); const c = new THREE.Vector3(); b.getCenter(c);
    a.position.sub(c);
    const rot = new THREE.Group(); rot.add(a);
    // the model's arrowhead points along its -long-axis: flip so the tip leads (verified side-on by image)
    const flip = new THREE.Group(); flip.rotation.y = Math.PI; flip.add(rot);
    const g = new THREE.Group(); g.add(flip);
    // orient the long axis along +Z
    const long = s.x > s.y && s.x > s.z ? 'x' : (s.y > s.z ? 'y' : 'z');
    if (long === 'x') rot.rotation.y = -Math.PI / 2;
    if (long === 'y') rot.rotation.x = Math.PI / 2;
    g.userData.longAxis = long;
    const L = Math.max(s.x, s.y, s.z);
    g.scale.setScalar(1.4 / L);
    return g;
  }
}
