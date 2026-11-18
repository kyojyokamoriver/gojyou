// 宇宙人の読み込み・まばたき・ふわふわ・星の演出・床の影
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';

export const STAR_COLORS = ['#ffe869', '#ffb54a'];   // 黄 / 赤みのあるオレンジ
const STAR_PERIOD = 6000;                             // 約6秒周期
const STAR_LIFE = 1300;                               // 星が見えている時間(それ以外は見えない)

/* ---------- 目つぶりの絵(「目つぶり」PDFに合わせたまぶた) ---------- */
function makeLidTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 192;
  const g = c.getContext('2d');
  g.strokeStyle = '#1fa878'; g.lineCap = 'round';
  const cx = 128, cy = 62, r = 74;
  g.lineWidth = 22;
  g.beginPath(); g.arc(cx, cy, r, 0.04 * Math.PI, 0.96 * Math.PI, false); g.stroke();
  g.lineWidth = 14;
  for (const deg of [48, 90, 132]) {
    const a = deg * Math.PI / 180;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (r + 22), cy + Math.sin(a) * (r + 22));
    g.lineTo(cx + Math.cos(a) * (r + 48), cy + Math.sin(a) * (r + 48));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/* ---------- 五つ星 ---------- */
function makeStarTexture(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 66);
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + k * Math.PI / 5, rad = k % 2 === 0 ? 58 : 25;
    k === 0 ? g.moveTo(Math.cos(a) * rad, Math.sin(a) * rad) : g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  g.closePath();
  g.fillStyle = color; g.strokeStyle = color; g.lineJoin = 'round'; g.lineWidth = 8;
  g.fill(); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const starTextures = {};
function starTex(color) { return starTextures[color] ??= makeStarTexture(color); }

/* ---------- 床の影(やわらかい円) ---------- */
let shadowTex = null;
export function createShadow() {
  if (!shadowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,.55)'); grd.addColorStop(.55, 'rgba(0,0,0,.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    shadowTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 0;
  const g = new THREE.Group();
  g.add(m);
  g.visible = false;
  return g;
}

/* ---------- モデル ---------- */
let template = null;
export async function loadAlienTemplate(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  template = gltf.scene;
  return template;
}

/** 幅1に正規化した宇宙人。group の原点は体の中心。 */
export function createAlien(opts = {}) {
  const group = new THREE.Group();   // 位置・向き・大きさは外から決める
  const anim = new THREE.Group();    // ふわふわ・呼吸のつぶれ・ジャンプ
  const inner = new THREE.Group();   // 正規化
  group.add(anim); anim.add(inner);

  const root = template.clone(true);
  const meshes = [];
  root.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); meshes.push(o); } });
  const vol = m => { const s = new THREE.Vector3(); m.geometry.boundingBox.getSize(s); return s.x * s.y * s.z; };
  meshes.sort((a, b) => vol(b) - vol(a));
  const eyes = meshes.slice(1);

  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const s = 1 / size.x;
  inner.scale.setScalar(s);
  inner.position.set(-ctr.x * s, -ctr.y * s, -ctr.z * s);
  inner.add(root);

  const lidTex = makeLidTexture();
  const lids = eyes.map(eye => {
    const b = eye.geometry.boundingBox, ec = b.getCenter(new THREE.Vector3()), es = b.getSize(new THREE.Vector3());
    const w = Math.max(es.x, es.y) * 1.7;
    const lid = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.75),
      new THREE.MeshBasicMaterial({ map: lidTex, transparent: true, depthWrite: false, toneMapped: false }));
    lid.position.set(ec.x, ec.y - es.y * 0.12, b.max.z + 0.002);
    lid.visible = false; lid.renderOrder = 2;
    root.add(lid);
    return lid;
  });

  // 星(ビルボード)。体の上側に弧を描いて並べる。出現はひとつずつ少しずらす。
  const stars = [];
  const starGroup = new THREE.Group();
  anim.add(starGroup);
  const N = 7;
  for (let i = 0; i < N; i++) {
    const mat = new THREE.SpriteMaterial({ map: starTex(STAR_COLORS[i % 2]), transparent: true, depthTest: false, toneMapped: false });
    const sp = new THREE.Sprite(mat);
    const ang = THREE.MathUtils.degToRad(20 + i * (140 / (N - 1)));
    sp.userData = { base: new THREE.Vector3(Math.cos(ang) * 0.62, 0.30 + Math.sin(ang) * 0.42, 0.25), size: 0.16 + 0.05 * (i % 3), delay: i * 130, spin: (i % 2 ? 1 : -1) };
    sp.visible = false; sp.renderOrder = 3;
    starGroup.add(sp); stars.push(sp);
  }

  const halfH = size.y * s / 2;
  const api = {
    group, halfH, closedUntil: 0, nextBlink: performance.now() + 1200 + Math.random() * 2000,
    hopStart: -1, phase: Math.random() * 6, starPhase: opts.starPhase ?? 0, starsOn: true,
    hop() { api.hopStart = performance.now(); api.closedUntil = performance.now() + 900; },
    update(now, { sway = 0.0, face = true } = {}) {
      const t = now / 1000 + api.phase;
      // ふわふわ上下 + 呼吸のつぶれ
      let hop = 0;
      if (api.hopStart >= 0) {
        const u = (now - api.hopStart) / 600;
        if (u >= 1) api.hopStart = -1; else hop = Math.sin(u * Math.PI) * 0.35;
      }
      const sq = 1 + Math.sin(t * 4.4) * 0.025;
      anim.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      anim.position.y = Math.sin(t * 2.2) * 0.04 + hop;
      anim.rotation.y = sway ? Math.sin(t * 1.3) * sway : 0;

      // まばたき
      if (now > api.nextBlink) {
        api.closedUntil = Math.max(api.closedUntil, now + 150);
        api.nextBlink = now + 2200 + Math.random() * 3200;
        if (Math.random() < 0.2) api.nextBlink = now + 380;
      }
      const closed = now < api.closedUntil;
      for (const e of eyes) e.visible = !closed;
      for (const l of lids) l.visible = closed;

      // 星: 約6秒周期で短く出て消える
      const cyc = (now + api.starPhase) % STAR_PERIOD;
      for (const sp of stars) {
        const u = (cyc - 1500 - sp.userData.delay) / STAR_LIFE;
        if (!api.starsOn || u < 0 || u > 1) { sp.visible = false; continue; }
        const k = Math.sin(Math.PI * u);
        sp.visible = true;
        sp.material.opacity = Math.min(1, k * 1.6);
        sp.material.rotation = u * Math.PI * 0.8 * sp.userData.spin;
        const sz = sp.userData.size * (0.4 + 0.6 * k);
        sp.scale.set(sz, sz, 1);
        sp.position.copy(sp.userData.base).multiplyScalar(1 + u * 0.25);
      }
    },
    /** 星が出ている時の演出(撮影時に写り込む) */
    dispose() { /* geometry/materialはテンプレートと共有 */ },
  };
  return api;
}
