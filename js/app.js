// うちゅうじんカメラ: 画面の状態、カメラ起動と切替、外カメ(簡易/空間AR/Quick Look)、内カメ(最大3人)、撮影と保存
import * as THREE from 'three';
import { loadAlienTemplate, createAlien, createShadow } from './alien.js';
import { attachGestures } from './gestures.js';
import { isXRSupported, XRFloorSession, WIDTH_M, FLOAT_M } from './xr.js';
import { loadFaceDetector, FaceTracker } from './faces.js';

const $ = id => document.getElementById(id);
const FOV = 55, CAM_H = 1.4, FACE_DEPTH = 3, MAX_FACES = 3;

/* ---------- 環境判定 ---------- */
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// アプリ内ブラウザ(WebView)だと AR Quick Look が「オブジェクト」表示だけになり「AR」が灰色になる
const inAppBrowser = isIOS && (!/Safari\//.test(ua) || /FBAN|FBAV|Instagram|Line\/|MicroMessenger|Twitter|ChatGPT|OpenAI|GSA\//i.test(ua));
const quickLookOK = isIOS && !inAppBrowser && !!document.createElement('a').relList?.supports?.('ar');

/* ---------- Three.js ---------- */
const canvas = $('gl'), video = $('cam');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 60);
function resize() {
  if (renderer.xr.isPresenting) return;
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

/* ---------- 状態 ---------- */
const S = {
  facing: 'environment',
  mode: 'rear',            // 'rear' | 'front'
  placed: false, floor: new THREE.Vector3(),
  pose: { yaw: 0, tilt: 0, scale: 1 },
  gyro: false, xrOK: false, xr: null,
  ready: false,
};
let rearAlien = null, rearShadow = null;
const faceAliens = []; const faceTracker = new FaceTracker(MAX_FACES);
let facesReady = false, lastDetect = 0;

/* ---------- UI ---------- */
let toastT;
function toast(msg, ms = 2600) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), ms); }
function hint(msg) { const el = $('hint'); if (msg) { el.textContent = msg; el.classList.add('show'); } else el.classList.remove('show'); }
function refreshUI() {
  const rear = S.mode === 'rear';
  $('arWrap').style.display = rear && quickLookOK ? 'flex' : 'none';
  $('arBtn').style.display = rear && S.xrOK ? 'inline-block' : 'none';
  $('replaceBtn').style.display = rear && S.placed && !S.xr ? 'inline-block' : 'none';
  $('safariBtn').style.display = rear && isIOS ? 'inline-block' : 'none';
  if (rear) hint(S.placed ? '' : (inAppBrowser ? 'このブラウザでは床に置くARが使えません。右上の「Safari用リンク」からSafariで開いてください。\n(このまま床をタップすると簡易モードで撮影できます)' : '床に向けて画面をタップ'));
  else hint(faceTracker.tracks.length ? '' : '顔を映してください');
}
$('reload').addEventListener('click', () => location.reload());

/* ---------- カメラ ---------- */
let stream = null;
async function startCamera(facing) {
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  const get = c => navigator.mediaDevices.getUserMedia({ video: c, audio: false });
  try { stream = await get({ facingMode: { exact: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }); }
  catch { stream = await get({ facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }); }
  video.srcObject = stream; await video.play().catch(() => {});
  S.facing = facing; video.classList.toggle('mirror', facing === 'user');
}

/* ---------- ジャイロ(外カメ簡易モードの向き) ---------- */
let gyroP = null, lastOri = null;
function enableGyro() {
  if (gyroP) return gyroP;
  gyroP = (async () => {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return false;
      }
      addEventListener('deviceorientation', e => { if (e.beta !== null && e.gamma !== null) { lastOri = e; S.gyro = true; } }, true);
      await new Promise(r => setTimeout(r, 250));
      return true;
    } catch { return false; }
  })();
  return gyroP;
}
const _e = new THREE.Euler(), _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)), Z = new THREE.Vector3(0, 0, 1);
function camTarget(out) {
  if (S.mode === 'rear' && lastOri) {
    const o = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * Math.PI / 180;
    _e.set(THREE.MathUtils.degToRad(lastOri.beta), THREE.MathUtils.degToRad(lastOri.alpha || 0), -THREE.MathUtils.degToRad(lastOri.gamma), 'YXZ');
    out.setFromEuler(_e).multiply(_q1).multiply(_q0.setFromAxisAngle(Z, -o));
    return out;
  }
  return out.identity();
}

/* ---------- 外カメ: 簡易モードの配置(床の一点をタップ) ---------- */
function placeAt(x, y) {
  const q = camTarget(new THREE.Quaternion());
  camera.quaternion.copy(q);
  const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const dir = new THREE.Vector3((x / innerWidth * 2 - 1) * t * camera.aspect, -(y / innerHeight * 2 - 1) * t, -1).normalize().applyQuaternion(q);
  const p = new THREE.Vector3();
  if (dir.y < -0.05) {
    const k = Math.min(Math.max(CAM_H / -dir.y, 0.8), 6);
    p.copy(dir).multiplyScalar(k); p.y = -CAM_H;
  } else {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q); fwd.y = 0; fwd.normalize();
    p.copy(fwd).multiplyScalar(2); p.y = -CAM_H;
  }
  S.floor.copy(p); S.placed = true;
  S.pose.yaw = Math.atan2(-p.x, -p.z); S.pose.tilt = 0; S.pose.scale = 1;
  refreshUI();
}
let pendingTap = null;
function onRearTap(x, y) {
  if (S.mode !== 'rear' || S.xr) return;
  if (!S.placed) {
    pendingTap = { x, y };
    enableGyro().then(() => { if (pendingTap) { placeAt(pendingTap.x, pendingTap.y); pendingTap = null; } });
  } else if (rearAlien) {
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
    if (ray.intersectObject(rearAlien.group, true).length) rearAlien.hop();
  }
}
canvas.addEventListener('click', () => { if (S.mode === 'rear') enableGyro(); });
attachGestures(canvas, S.pose, { onTap: onRearTap, enabled: () => S.mode === 'rear' && S.placed && !S.xr });
// 未配置のときのタップを拾うため、ジェスチャー無効時用に別でタップだけ見る
{ let d = null;
  canvas.addEventListener('pointerdown', e => { d = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', e => { if (d && !S.placed && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8 && performance.now() - d.t < 450) onRearTap(e.clientX, e.clientY); d = null; });
}
$('replaceBtn').addEventListener('click', () => { S.placed = false; refreshUI(); });

/* ---------- 外カメ: WebXR(Android) ---------- */
const xrOverlay = $('xrOverlay');
function xrHint(msg) { const el = $('xrHint'); el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
$('arBtn').addEventListener('click', async () => {
  try {
    xrOverlay.style.display = 'block';
    const xr = new XRFloorSession({
      renderer, scene, alien: rearAlien, pivot: rearAlien.group, shadow: rearShadow, overlay: xrOverlay, pose: S.pose, hint: xrHint,
      onEnd: () => { S.xr = null; S.placed = false; xrOverlay.style.display = 'none'; rearAlien.group.visible = false; rearShadow.visible = false; resize(); refreshUI(); },
    });
    S.xr = xr; S.pose.scale = 1; S.pose.tilt = 0; S.pose.yaw = 0;
    rearAlien.group.visible = false; rearShadow.visible = false; S.placed = false;
    await xr.start();
  } catch (e) {
    console.warn('xr', e);
    S.xr = null; xrOverlay.style.display = 'none';
    toast('この端末ではARを開始できませんでした。簡易モードで撮影できます。');
  }
});
$('xrExit').addEventListener('click', () => S.xr?.end());
$('xrReplace').addEventListener('click', () => S.xr?.replace());
for (const id of ['xrExit', 'xrReplace']) $(id).addEventListener('beforexrselect', e => e.preventDefault());
attachGestures($('xrTouch'), S.pose, { enabled: () => !!S.xr?.placed });
$('xrTouch').addEventListener('beforexrselect', e => { if (S.xr?.placed) e.preventDefault(); });

/* ---------- iPhone: Safari用リンク ---------- */
$('safariBtn').addEventListener('click', () => { $('linkIn').value = location.href.split('#')[0]; $('linkDlg').classList.add('open'); });
$('linkClose').addEventListener('click', () => $('linkDlg').classList.remove('open'));
$('copyBtn').addEventListener('click', async () => {
  const el = $('linkIn');
  try { await navigator.clipboard.writeText(el.value); toast('コピーしました'); }
  catch { el.focus(); el.select(); el.setSelectionRange(0, 9999); toast('URL欄を選択しました。長押しでコピーしてください'); }
});

/* ---------- 内カメ: 顔の位置 → 画面 → 3D ---------- */
function videoToScreen(vx, vy) {
  const vw = video.videoWidth, vh = video.videoHeight, sw = innerWidth, sh = innerHeight;
  const s = Math.max(sw / vw, sh / vh), ox = (sw - vw * s) / 2, oy = (sh - vh * s) / 2;
  let x = ox + vx * s; const y = oy + vy * s;
  if (S.facing === 'user') x = sw - x;
  return { x, y, s };
}
function updateFaces(now) {
  if (!video.videoWidth) return;
  if (facesReady && now - lastDetect > 70 && !faceTracker.busy) { lastDetect = now; faceTracker.detect(video, now); }
  const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2)), sw = innerWidth, sh = innerHeight;
  const worldPerPx = (2 * FACE_DEPTH * t) / sh;
  const used = new Set();
  for (const tr of faceTracker.tracks) {
    let a = faceAliens.find(f => f.trackId === tr.id);
    if (!a) { a = faceAliens.find(f => f.trackId === null); if (!a) continue; a.trackId = tr.id; a.first = true; }
    used.add(a);
    const tl = videoToScreen(tr.x, tr.y), br = videoToScreen(tr.x + tr.w, tr.y + tr.h);
    const fw = Math.abs(br.x - tl.x), fh = Math.abs(br.y - tl.y), cx = (tl.x + br.x) / 2, top = Math.min(tl.y, br.y);
    const aw = fw * 1.0, ah = aw * 2 * a.alien.halfH;           // 画面上の宇宙人の幅・高さ(px)
    const cy = top - fh * 0.15 - ah / 2;                          // 頭のすぐ上
    const tx = (cx / sw * 2 - 1) * t * camera.aspect * FACE_DEPTH, ty = (1 - cy / sh * 2) * t * FACE_DEPTH, tw = aw * worldPerPx;
    const g = a.alien.group;
    if (a.first) { g.position.set(tx, ty, -FACE_DEPTH); g.scale.setScalar(tw); a.first = false; }
    else { g.position.x += (tx - g.position.x) * 0.4; g.position.y += (ty - g.position.y) * 0.4; g.scale.setScalar(g.scale.x + (tw - g.scale.x) * 0.4); }
    g.visible = true;
  }
  for (const a of faceAliens) if (!used.has(a)) { a.trackId = null; a.alien.group.visible = false; }
  const n = faceTracker.tracks.length;
  if (S.mode === 'front' && facesReady) hint(n ? '' : '顔を映してください');
}

/* ---------- モード切替 ---------- */
async function setMode(mode) {
  S.mode = mode;
  const front = mode === 'front';
  rearAlien.group.visible = !front && S.placed; rearShadow.visible = !front && S.placed;
  for (const a of faceAliens) a.alien.group.visible = false;
  if (front && !facesReady) {
    try { await loadFaceDetector(m => m && toast(m, 6000)); facesReady = true; }
    catch (e) { console.warn(e); toast('顔検出を読み込めませんでした'); }
  }
  refreshUI();
}
$('flip').addEventListener('click', async () => {
  const next = S.facing === 'environment' ? 'user' : 'environment';
  try { await startCamera(next); await setMode(next === 'user' ? 'front' : 'rear'); }
  catch { toast('カメラを切り替えられませんでした'); }
});

/* ---------- 撮影 ---------- */
let lastBlob = null;
async function capture() {
  const f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  const W = canvas.width, H = canvas.height, out = document.createElement('canvas'); out.width = W; out.height = H;
  const g = out.getContext('2d');
  if (video.videoWidth) {
    const s = Math.max(W / video.videoWidth, H / video.videoHeight), dw = video.videoWidth * s, dh = video.videoHeight * s;
    g.save(); if (S.facing === 'user') { g.translate(W, 0); g.scale(-1, 1); }   // 内カメはプレビューと同じ鏡像
    g.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh); g.restore();
  } else { g.fillStyle = '#222'; g.fillRect(0, 0, W, H); }
  renderer.render(scene, camera);          // 同じタスク内で描いてすぐ読む(影・星・宇宙人が入る)
  g.drawImage(canvas, 0, 0);
  lastBlob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.92));
  setPhoto(lastBlob); openPreview();
}
function setPhoto(blob) {
  const url = URL.createObjectURL(blob), old = $('pvImg').src;
  $('pvImg').src = url; $('thumb').style.backgroundImage = `url(${url})`;
  if (old.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(old), 1000);
}
const openPreview = () => $('preview').classList.add('open');
$('shutter').addEventListener('click', capture);
$('thumb').addEventListener('click', () => { if (lastBlob) openPreview(); });
$('backBtn').addEventListener('click', () => $('preview').classList.remove('open'));
$('saveBtn').addEventListener('click', async () => {
  if (!lastBlob) return;
  const file = new File([lastBlob], `uchujin-${Date.now()}.jpg`, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(lastBlob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
});

/* ---------- メインループ ---------- */
const tmpQ = new THREE.Quaternion();
function loop(time, frame) {
  const now = performance.now();
  if (S.xr) { S.xr.update(now, frame); rearAlien.update(now, {}); }
  else {
    camTarget(tmpQ); camera.quaternion.slerp(tmpQ, S.gyro && S.mode === 'rear' ? 0.4 : 1);
    if (S.mode === 'rear' && S.placed) {
      const w = WIDTH_M * S.pose.scale, g = rearAlien.group;
      g.visible = true; g.scale.setScalar(w);
      g.position.set(S.floor.x, S.floor.y + FLOAT_M * S.pose.scale + rearAlien.halfH * w, S.floor.z);
      g.rotation.set(S.pose.tilt, S.pose.yaw, 0, 'YXZ');
      rearShadow.visible = true; rearShadow.position.set(S.floor.x, S.floor.y + 0.002, S.floor.z); rearShadow.scale.setScalar(w * 1.15);
      rearAlien.update(now, { sway: 0.08 });
    } else { rearAlien.group.visible = false; rearShadow.visible = false; }
    if (S.mode === 'front') { updateFaces(now); for (const a of faceAliens) if (a.alien.group.visible) a.alien.update(now, { sway: 0.15 }); }
  }
  renderer.render(scene, camera);
}

/* ---------- 起動 ---------- */
(async function init() {
  $('flash').style.pointerEvents = 'none';
  try { await loadAlienTemplate('./assets/alien.glb'); } catch (e) { console.error(e); toast('モデルを読み込めませんでした'); return; }
  rearAlien = createAlien(); rearAlien.group.visible = false; scene.add(rearAlien.group);
  rearShadow = createShadow(); scene.add(rearShadow);
  for (let i = 0; i < MAX_FACES; i++) {
    const alien = createAlien({ starPhase: i * 1700 }); alien.group.visible = false; scene.add(alien.group);
    faceAliens.push({ alien, trackId: null, first: true });
  }
  S.xrOK = quickLookOK ? false : await isXRSupported();
  S.ready = true;
  renderer.setAnimationLoop(loop);
  refreshUI();
  if (inAppBrowser) toast('Safariで開くと床に置くARが使えます', 5000);
  try { await startCamera('environment'); }
  catch (e) { console.warn('camera', e); toast('カメラを使えません。ブラウザのカメラ許可を確認してください', 6000); }
})();
