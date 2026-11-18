// Android Chrome など WebXR 対応ブラウザ用: 床の一点に宇宙人を固定して、歩いて近づいたり周りを回ったりできる
import * as THREE from 'three';

export const WIDTH_M = 0.44;     // 初期の幅 約44cm
export const FLOAT_M = 0.24;     // 床からの浮遊オフセット 約24cm
const STABLE_MS = 425;           // 候補位置が安定してから置くまでの時間

export async function isXRSupported() {
  try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch { return false; }
}

export class XRFloorSession {
  /**
   * @param {object} c { renderer, scene, alien, pivot, shadow, overlay, pose:{yaw,tilt,scale}, hint(msg), onEnd() }
   */
  constructor(c) {
    Object.assign(this, c);
    this.session = null; this.hitSource = null; this.placed = false;
    this.floor = new THREE.Vector3(); this.cand = new THREE.Vector3(); this.candValid = false;
    this.lastCand = new THREE.Vector3(); this.stableSince = 0; this.anchor = null; this.lost = false;
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.09, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .9, toneMapped: false }));
    this.reticle.visible = false; this.reticle.matrixAutoUpdate = false;
  }

  async start() {
    const { renderer } = this;
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test', 'dom-overlay'],
      optionalFeatures: ['anchors', 'local-floor'],
      domOverlay: { root: this.overlay },
    });
    this.session = session;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);
    const viewer = await session.requestReferenceSpace('viewer');
    this.hitSource = await session.requestHitTestSource({ space: viewer, entityTypes: ['plane'] });
    this.scene.add(this.reticle);
    session.addEventListener('select', () => { if (!this.placed && this.candValid) this._place(this._lastHit); });
    session.addEventListener('end', () => this._cleanup());
    // 参照座標の原点が動いた時は、取得できる変換で配置を補正する
    const ref = renderer.xr.getReferenceSpace();
    ref?.addEventListener?.('reset', ev => {
      if (!ev.transform || !this.placed) return;
      const inv = new THREE.Matrix4().fromArray(ev.transform.inverse.matrix);
      this.floor.applyMatrix4(inv);
    });
    this.hint('床をゆっくり映してください');
  }

  end() { this.session?.end(); }
  replace() { this.placed = false; this.anchor = null; this.shadow.visible = false; this.pivot.visible = false; this.stableSince = 0; this.hint('床に向けて、置き直したい場所を映してください'); }

  _cleanup() {
    this.renderer.xr.enabled = false;
    this.scene.remove(this.reticle);
    this.hitSource?.cancel?.();
    this.session = null; this.hitSource = null; this.anchor = null;
    this.onEnd?.();
  }

  _place(hit) {
    this.placed = true; this.floor.copy(this.cand); this.reticle.visible = false;
    this.pivot.visible = true; this.shadow.visible = true;
    if (this.viewerPos) this.pose.yaw = Math.atan2(this.viewerPos.x - this.floor.x, this.viewerPos.z - this.floor.z);   // こちらを向いて置く
    this.pose.tilt = 0; this.pose.scale = 1;
    this.hint('');
    if (hit?.createAnchor) hit.createAnchor().then(a => { this.anchor = a; }).catch(() => {});
  }

  /** 毎フレーム呼ぶ(XR中のみ) */
  update(now, frame) {
    if (!frame || !this.session) return;
    const ref = this.renderer.xr.getReferenceSpace();
    const vp = frame.getViewerPose(ref);
    if (!vp) { if (!this.lost) { this.lost = true; this.hint('位置を見失いました。周囲をゆっくり映して再認識してください'); } return; }
    this.viewerPos = vp.transform.position;
    if (this.lost) { this.lost = false; this.hint(this.placed ? '' : '床をゆっくり映してください'); }

    if (this.placed && this.anchor) {
      const p = frame.getPose(this.anchor.anchorSpace, ref);
      if (p) this.floor.set(p.transform.position.x, p.transform.position.y, p.transform.position.z);
    }

    if (!this.placed) {
      this.candValid = false;
      const hits = frame.getHitTestResults(this.hitSource);
      for (const h of hits) {
        const pose = h.getPose(ref);
        if (!pose) continue;
        const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
        const up = new THREE.Vector3(0, 1, 0).transformDirection(m);
        if (up.y < 0.9) continue;                       // 水平面だけ
        this.cand.setFromMatrixPosition(m);
        this.reticle.matrix.copy(m); this.reticle.visible = true;
        this.candValid = true; this._lastHit = h; break;
      }
      if (!this.candValid) { this.reticle.visible = false; this.stableSince = 0; return; }
      if (this.cand.distanceTo(this.lastCand) > 0.03) { this.stableSince = now; this.lastCand.copy(this.cand); }
      else if (this.stableSince && now - this.stableSince > STABLE_MS) this._place(this._lastHit);
      if (!this.stableSince) this.stableSince = now;
    }

    if (this.placed) {
      const w = WIDTH_M * this.pose.scale;
      this.pivot.scale.setScalar(w);
      this.pivot.position.set(this.floor.x, this.floor.y + FLOAT_M * this.pose.scale + this.alien.halfH * w, this.floor.z);
      this.pivot.rotation.set(this.pose.tilt, this.pose.yaw, 0, 'YXZ');
      this.shadow.position.set(this.floor.x, this.floor.y + 0.002, this.floor.z);
      this.shadow.scale.setScalar(w * 1.15);
    }
  }
}
