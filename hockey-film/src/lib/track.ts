// Tracking: shapes that move over time.
// A shape's `track` is a list of (t, dx, dy) offsets from where it was drawn. At any video time we
// interpolate the offset and shift the whole shape by it. That one mechanism makes spotlights,
// markers, labels, arrows and zones ride along with a player or a camera pan.
import type { GapShape, Keyframe, Shape } from '../types';
import { isPath, translateShape } from './util';

export interface Pt {
  x: number;
  y: number;
}
const ZERO = { dx: 0, dy: 0 };

/** Interpolated offset at time t (binary search; clamps before the first / after the last keyframe). */
export function offsetAt(track: Keyframe[] | undefined, t: number): { dx: number; dy: number } {
  if (!track || track.length === 0) return ZERO;
  if (t <= track[0].t) return track[0];
  const last = track[track.length - 1];
  if (t >= last.t) return last;
  let lo = 0, hi = track.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = track[lo], b = track[hi];
  const k = (t - a.t) / (b.t - a.t || 1);
  return { dx: a.dx + (b.dx - a.dx) * k, dy: a.dy + (b.dy - a.dy) * k };
}

export const hasTrack = (s: Shape) => !!s.track && s.track.length > 0;

/** The point that "is" the player for this shape: what snaps under the Pencil when following. */
export function anchorOf(s: Shape): Pt {
  switch (s.kind) {
    case 'spotlight':
    case 'marker':
    case 'ellipse':
    case 'text':
      return { x: s.x, y: s.y };
    case 'rect':
      return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
    case 'zone': {
      let x = 0, y = 0;
      const n = s.points.length / 2;
      for (let i = 0; i < s.points.length; i += 2) { x += s.points[i]; y += s.points[i + 1]; }
      return { x: x / n, y: y / n };
    }
    case 'gap':
      return { x: (s.points[0] + s.points[2]) / 2, y: (s.points[1] + s.points[3]) / 2 };
    default:
      return { x: s.points[0], y: s.points[1] };
  }
}

/** Player-type shapes snap their center under the Pencil; everything else moves relative to where you grab. */
export const snapsToPointer = (s: Shape) => s.kind === 'spotlight' || s.kind === 'marker' || s.kind === 'ellipse';

/** The shape as it should appear at time t (track applied). */
export function shapeAt(s: Shape, t: number): Shape {
  if (!hasTrack(s)) return s;
  const o = offsetAt(s.track, t);
  return o.dx || o.dy ? translateShape(s, o.dx, o.dy) : s;
}

/** Resolve gap-line ends attached to other (already time-resolved) shapes. */
export function resolveGap(g: GapShape, byId: Map<string, Shape>): GapShape {
  const pa = g.a ? byId.get(g.a) : undefined;
  const pb = g.b ? byId.get(g.b) : undefined;
  if (!pa && !pb) return g;
  const p = g.points.slice();
  if (pa) { const a = anchorOf(pa); p[0] = a.x; p[1] = a.y; }
  if (pb) { const b = anchorOf(pb); p[2] = b.x; p[3] = b.y; }
  return { ...g, points: p };
}

/** Replace keyframes in [t0, t1] with `recorded` (used while recording a follow). */
export function spliceTrack(base: Keyframe[] | undefined, t0: number, t1: number, recorded: Keyframe[]): Keyframe[] {
  const keep = (base ?? []).filter((k) => k.t < t0 - 1e-3 || k.t > t1 + 1e-3);
  return [...keep, ...recorded].sort((a, b) => a.t - b.t);
}

/** Set (or replace) one keyframe at time t. */
export function setKeyframe(base: Keyframe[] | undefined, k: Keyframe): Keyframe[] {
  const out = (base ?? []).filter((x) => Math.abs(x.t - k.t) > 0.01);
  out.push(k);
  return out.sort((a, b) => a.t - b.t);
}

/** Anchor positions along the track up to time t: the path the player has skated so far. */
export function trailPoints(s: Shape, upTo: number): number[] {
  if (!s.track || s.track.length < 2) return [];
  const a = anchorOf(s);
  const pts: number[] = [];
  for (const k of s.track) {
    if (k.t > upTo) break;
    pts.push(a.x + k.dx, a.y + k.dy);
  }
  const now = offsetAt(s.track, upTo);
  pts.push(a.x + now.dx, a.y + now.dy);
  return pts;
}

/** First `frac` (0..1) of a polyline by length. Used by Trail to draw itself on over time. */
export function partialPath(points: number[], frac: number): number[] {
  if (frac >= 1) return points;
  if (frac <= 0 || points.length < 4) return points.slice(0, 2).concat(points.slice(0, 2));
  let total = 0;
  for (let i = 2; i < points.length; i += 2) total += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
  let want = total * frac;
  const out = [points[0], points[1]];
  for (let i = 2; i < points.length; i += 2) {
    const seg = Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
    if (seg >= want) {
      const k = seg ? want / seg : 0;
      out.push(points[i - 2] + (points[i] - points[i - 2]) * k, points[i - 1] + (points[i + 1] - points[i - 1]) * k);
      return out;
    }
    want -= seg;
    out.push(points[i], points[i + 1]);
  }
  return out;
}

/** Shapes that are "players": gap lines can attach to them. */
export const isAttachable = (s: Shape) => s.kind === 'marker' || s.kind === 'spotlight';

export { isPath };
