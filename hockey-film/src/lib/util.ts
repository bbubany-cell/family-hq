import type { GapShape, PathShape, Shape, ShapeTiming, ZoneShape } from '../types';

/** Points-based shapes (pen/line/arrow/curve/trail/zone/gap) store a points array instead of x/y. */
export const isPath = (s: Shape): s is PathShape | ZoneShape | GapShape => 'points' in s;
/** Line-like shapes drawn as strokes (not zones or gaps). */
export const isStroke = (s: Shape): s is PathShape =>
  s.kind === 'pen' || s.kind === 'line' || s.kind === 'arrow' || s.kind === 'curve' || s.kind === 'trail';

export const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 12);

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 83.4 -> "1:23.4" ; with hours when needed. */
export function fmtTime(sec: number, tenths = true): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = tenths ? s.toFixed(1).padStart(4, '0') : Math.floor(s).toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export const fmtBytes = (b: number) =>
  b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : (b / 1e3).toFixed(0) + ' KB';

/** Seek tolerance: frame seeking isn't exact, so treat "close enough" as on the frame. */
const EPS = 0.02;

/** Opacity (0..1) of a shape at time `now` based on its timing. */
export function shapeOpacity(s: ShapeTiming & { reveal?: number }, now: number): number {
  const start = s.t;
  // A trail is solid while it draws itself on, then holds.
  const end = s.hold === null ? Infinity : s.t + (s.reveal ?? 0) + s.hold;
  if (now < start - EPS) {
    if (s.fadeIn <= 0) return 0;
    const into = now - (start - s.fadeIn);
    return into <= 0 ? 0 : clamp(into / s.fadeIn, 0, 1);
  }
  if (now <= end + EPS) return 1;
  if (s.fadeOut <= 0) return 0;
  const out = (now - end) / s.fadeOut;
  return out >= 1 ? 0 : 1 - out;
}

/** Snap a detected fps to the nearest common broadcast rate. */
export function snapFps(fps: number): number {
  const common = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120];
  return common.reduce((a, b) => (Math.abs(b - fps) < Math.abs(a - fps) ? b : a));
}

/** Translate any shape by dx/dy (video px). Returns a new shape. */
export function translateShape(s: Shape, dx: number, dy: number): Shape {
  if (isPath(s)) {
    return { ...s, points: s.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) };
  }
  return { ...s, x: s.x + dx, y: s.y + dy };
}

/** Light smoothing for freehand strokes: drop points closer than minDist. */
export function thinPoints(points: number[], minDist: number): number[] {
  if (points.length <= 4) return points;
  const out = [points[0], points[1]];
  for (let i = 2; i < points.length - 2; i += 2) {
    const dx = points[i] - out[out.length - 2];
    const dy = points[i + 1] - out[out.length - 1];
    if (dx * dx + dy * dy >= minDist * minDist) out.push(points[i], points[i + 1]);
  }
  out.push(points[points.length - 2], points[points.length - 1]);
  return out;
}

export const isTypingTarget = (el: EventTarget | null) => {
  const e = el as HTMLElement | null;
  if (!e) return false;
  const tag = e.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.isContentEditable;
};
