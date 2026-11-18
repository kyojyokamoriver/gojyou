// 内カメ用: 最大3人の顔を検出して、フレームをまたいで同じ人を追う(端末内で処理。外部送信なし)
let faceapi = null;
let opts = null;

export async function loadFaceDetector(onStatus = () => {}) {
  onStatus('顔検出モデルを読み込み中…');
  faceapi = await import('../vendor/face-api.esm.js');
  try { await faceapi.tf.setBackend('webgl'); } catch { await faceapi.tf.setBackend('cpu'); }
  await faceapi.tf.ready();
  await faceapi.nets.tinyFaceDetector.loadFromUri('./assets/face');
  opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 });
  onStatus('');
}

export class FaceTracker {
  constructor(max = 3) {
    this.max = max;
    this.tracks = [];      // {id, x, y, w, h, last}  元の映像のピクセル座標
    this.nextId = 1;
    this.busy = false;
  }
  async detect(source, now) {
    if (!faceapi || this.busy) return;
    this.busy = true;
    try {
      const res = await faceapi.detectAllFaces(source, opts);
      this._assign(res.map(r => r.box).sort((a, b) => b.width * b.height - a.width * a.height).slice(0, this.max), now);
    } catch (e) { console.warn('face detect', e); }
    this.busy = false;
  }
  _assign(boxes, now) {
    const used = new Set();
    for (const b of boxes) {
      const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      let best = null, bd = Infinity;
      for (const t of this.tracks) {
        if (used.has(t.id)) continue;
        const d = Math.hypot(cx - (t.x + t.w / 2), cy - (t.y + t.h / 2));
        if (d < bd && d < Math.max(t.w, b.width) * 1.2) { bd = d; best = t; }
      }
      if (best) {
        const k = 0.5;     // 検出ノイズをならす
        best.x += (b.x - best.x) * k; best.y += (b.y - best.y) * k;
        best.w += (b.width - best.w) * k; best.h += (b.height - best.h) * k;
        best.last = now; used.add(best.id);
      } else if (this.tracks.length < this.max + 1) {
        const t = { id: this.nextId++, x: b.x, y: b.y, w: b.width, h: b.height, last: now };
        this.tracks.push(t); used.add(t.id);
      }
    }
    // 0.7秒見えなければ消す
    this.tracks = this.tracks.filter(t => now - t.last < 700);
    this.tracks.sort((a, b) => b.w * b.h - a.w * a.h);
    this.tracks.length = Math.min(this.tracks.length, this.max);
  }
}
