// 1本指ドラッグ: 向き(左右)と傾き(上下)  /  2本指: ピンチで拡大縮小、ひねりで回転  /  動かさずに離す: tap
export const SCALE_MIN = 0.35, SCALE_MAX = 3;
export function attachGestures(el, st, { onTap, enabled = () => true } = {}) {
  const ptrs = new Map();
  let g = null;
  const init = () => {
    const o = { scale: st.scale, yaw: st.yaw, multi: ptrs.size > 1 || g?.multi };
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      o.dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      o.ang = Math.atan2(b.y - a.y, b.x - a.x);
    }
    return o;
  };
  el.addEventListener('pointerdown', e => {
    if (!enabled()) return;
    el.setPointerCapture?.(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    g = init();
  });
  el.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 1) {
      st.yaw += dx * 0.012;
      st.tilt = Math.max(-0.6, Math.min(0.6, st.tilt + dy * 0.004));
    } else if (ptrs.size === 2 && g) {
      const [a, b] = [...ptrs.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      st.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, g.scale * dist / g.dist));
      st.yaw = g.yaw - (ang - g.ang);
    }
  });
  const end = e => {
    const p = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    if (p && ptrs.size === 0 && !g?.multi) {
      const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
      if (moved < 8 && performance.now() - p.t < 450) onTap?.(e.clientX, e.clientY);
    }
    g = ptrs.size ? init() : null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
