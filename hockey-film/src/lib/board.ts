// Rink whiteboard model + animation.
// Coordinates are feet on a 200 × 85 ft rink, x = 0 at the left end boards, y = 0 at the top boards.
//
// A drill is a list of steps. Each step stores where every piece is and the routes drawn in that step.
// Routes drawn starting on a piece *move* that piece: its position in the next step becomes the
// route's end, and playback skates it along the route. Pass/shot routes move the puck.
import type { BoardView, Drill, Piece, PieceKind, Route, RouteKind, Step } from '../types';
import { partialPath } from './track';
import { uid } from './util';

export const RINK = { L: 200, W: 85, corner: 28, goal: 11, blue: 75, center: 100 };

/** Visible x-range per view (y is always the full 85 ft width). */
export const VIEWS: Record<BoardView, { x0: number; x1: number; label: string }> = {
  full: { x0: 0, x1: 200, label: 'Full rink' },
  half: { x0: 100, x1: 200, label: 'Half rink' },
  zone: { x0: 120, x1: 200, label: 'Zone' },
};

export const PIECE_DEFAULTS: Record<PieceKind, { color: string; label: string; name: string }> = {
  O: { color: '#1d4ed8', label: '', name: 'Offense (O)' },
  X: { color: '#d62828', label: '', name: 'Defense (X)' },
  G: { color: '#111827', label: 'G', name: 'Goalie' },
  puck: { color: '#000000', label: '', name: 'Puck' },
  cone: { color: '#f97316', label: '', name: 'Cone' },
  net: { color: '#d62828', label: '', name: 'Net' },
  coach: { color: '#15803d', label: 'C', name: 'Coach' },
};

export const ROUTE_INFO: Record<RouteKind, { name: string; moves: 'piece' | 'puck' | 'none' }> = {
  skate: { name: 'Skate', moves: 'piece' },
  carry: { name: 'Carry puck', moves: 'piece' },
  backward: { name: 'Skate backward', moves: 'piece' },
  pass: { name: 'Pass', moves: 'puck' },
  shot: { name: 'Shot', moves: 'puck' },
  line: { name: 'Line', moves: 'none' },
};

export const PIECE_R = 2.6; // ft

export function newDrill(): Drill {
  return {
    id: uid(),
    name: 'New drill',
    notes: '',
    view: 'half',
    pieces: [],
    steps: [{ id: uid(), pos: {}, routes: [], note: '' }],
    stepTime: 1.6,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** The piece (not puck/cone/net) nearest to p within reach, in a given step. */
export function pieceAt(d: Drill, stepIdx: number, p: { x: number; y: number }, reach = 4, kinds?: PieceKind[]): Piece | null {
  let best: Piece | null = null;
  let bd = reach;
  for (const pc of d.pieces) {
    if (kinds && !kinds.includes(pc.kind)) continue;
    const pos = d.steps[stepIdx].pos[pc.id];
    if (!pos) continue;
    const dd = dist(pos, p);
    if (dd < bd) { bd = dd; best = pc; }
  }
  return best;
}

/** Make sure step k+1 exists (copy of step k's positions). */
export function ensureNextStep(d: Drill, k: number): Drill {
  if (d.steps[k + 1]) return d;
  const steps = [...d.steps];
  steps.splice(k + 1, 0, { id: uid(), pos: structuredClone(d.steps[k].pos), routes: [], note: '' });
  return { ...d, steps };
}

/** Move a piece in step k, carrying the change forward through later steps that hadn't moved it. */
export function movePiece(d: Drill, k: number, id: string, to: { x: number; y: number }): Drill {
  const from = d.steps[k].pos[id];
  const steps = d.steps.map((s, j) => {
    if (j < k) return s;
    if (j === k) return { ...s, pos: { ...s.pos, [id]: to } };
    const cur = s.pos[id];
    if (from && cur && dist(cur, from) < 0.01) return { ...s, pos: { ...s.pos, [id]: to } };
    return s;
  });
  return { ...d, steps };
}

/**
 * Add a route to step k. If it starts on a piece (skate/carry/backward) or near the puck (pass/shot),
 * that piece moves to the route's end in step k+1 (created if needed). Carrying brings the puck along.
 */
export function addRoute(d: Drill, k: number, kind: RouteKind, color: string, points: number[]): Drill {
  const start = { x: points[0], y: points[1] };
  const end = { x: points[points.length - 2], y: points[points.length - 1] };
  const route: Route = { id: uid(), kind, color, points };
  let out: Drill = { ...d, steps: d.steps.map((s, j) => (j === k ? { ...s, routes: [...s.routes, route] } : s)) };
  const mode = ROUTE_INFO[kind].moves;
  if (mode === 'none') return out;

  const puck = out.pieces.find((p) => p.kind === 'puck' && out.steps[k].pos[p.id] && dist(out.steps[k].pos[p.id], start) < 6);
  let mover: Piece | null = null;
  if (mode === 'piece') mover = pieceAt(out, k, start, 4, ['O', 'X', 'G', 'coach']);
  else mover = puck ?? null;
  if (!mover) return out;

  out = ensureNextStep(out, k);
  out = movePiece(out, k + 1, mover.id, end);
  if (kind === 'carry' && puck) out = movePiece(out, k + 1, puck.id, { x: end.x + 1.8, y: end.y + 1.2 });
  return out;
}

/** Position along a polyline at fraction u (0..1) by length. */
function along(points: number[], u: number) {
  const p = partialPath(points, u);
  return { x: p[p.length - 2], y: p[p.length - 1] };
}

const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

/** Find the route in step k that moved this piece (starts at its step-k spot, ends at its step-k+1 spot). */
function routeFor(d: Drill, k: number, id: string): Route | null {
  const a = d.steps[k]?.pos[id], b = d.steps[k + 1]?.pos[id];
  if (!a || !b || dist(a, b) < 0.01) return null;
  const pc = d.pieces.find((p) => p.id === id);
  for (const r of d.steps[k].routes) {
    const info = ROUTE_INFO[r.kind];
    if (info.moves === 'none') continue;
    if (pc?.kind === 'puck' && r.kind === 'carry') {
      // Puck rides along with the carrier's route (slightly offset).
      if (dist({ x: r.points[r.points.length - 2] + 1.8, y: r.points[r.points.length - 1] + 1.2 }, b) < 0.5) return r;
      continue;
    }
    const s = { x: r.points[0], y: r.points[1] };
    const e = { x: r.points[r.points.length - 2], y: r.points[r.points.length - 1] };
    if (dist(s, a) < 6 && dist(e, b) < 0.5) return r;
  }
  return null;
}

/**
 * Where everything is at playback time tau (seconds), plus which step's routes to show and how far
 * they've drawn on. Pieces skate along their routes; anything else glides straight.
 */
export function frameAt(d: Drill, tau: number) {
  const n = d.steps.length;
  const total = Math.max(0, (n - 1) * d.stepTime);
  const t = Math.max(0, Math.min(total, tau));
  const k = n <= 1 ? 0 : Math.min(n - 2, Math.floor(t / d.stepTime));
  const u = n <= 1 ? 1 : ease(Math.min(1, (t - k * d.stepTime) / d.stepTime));
  const pos: Record<string, { x: number; y: number }> = {};
  for (const pc of d.pieces) {
    const a = d.steps[k].pos[pc.id];
    const b = d.steps[k + 1]?.pos[pc.id] ?? a;
    if (!a) continue;
    const r = routeFor(d, k, pc.id);
    if (r) {
      const p = along(r.points, u);
      if (pc.kind === 'puck' && r.kind === 'carry') {
        // Carried puck rides with the carrier: from where it sat to just off his stick.
        const ox = a.x - r.points[0], oy = a.y - r.points[1];
        pos[pc.id] = { x: p.x + ox * (1 - u) + 1.8 * u, y: p.y + oy * (1 - u) + 1.2 * u };
      } else pos[pc.id] = p;
    } else pos[pc.id] = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  }
  return { pos, step: k, u, total, done: t >= total };
}

/** Wavy line for "carry the puck" routes. */
export function wavy(points: number[], amp = 0.9, wave = 3.2): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < points.length - 2; i += 2) {
    const x1 = points[i], y1 = points[i + 1], x2 = points[i + 2], y2 = points[i + 3];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1e-6) continue;
    const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
    const steps = Math.max(1, Math.ceil(len / 0.5));
    for (let sI = 0; sI < steps; sI++) {
      const f = sI / steps;
      const off = Math.sin(((acc + f * len) / wave) * Math.PI * 2) * amp;
      out.push(x1 + (x2 - x1) * f + nx * off, y1 + (y2 - y1) * f + ny * off);
    }
    acc += len;
  }
  out.push(points[points.length - 2], points[points.length - 1]);
  return out;
}

/** Smooth a freehand stroke a little (moving average) so routes look drawn, not jittery. */
export function smooth(points: number[], passes = 2): number[] {
  let p = points;
  for (let k = 0; k < passes; k++) {
    if (p.length < 6) return p;
    const out = [p[0], p[1]];
    for (let i = 2; i < p.length - 2; i += 2) out.push((p[i - 2] + p[i] * 2 + p[i + 2]) / 4, (p[i - 1] + p[i + 1] * 2 + p[i + 3]) / 4);
    out.push(p[p.length - 2], p[p.length - 1]);
    p = out;
  }
  return p;
}

/** Copy of steps with a piece removed everywhere. */
export function removePiece(d: Drill, id: string): Drill {
  return {
    ...d,
    pieces: d.pieces.filter((p) => p.id !== id),
    steps: d.steps.map((s) => {
      const pos = { ...s.pos };
      delete pos[id];
      return { ...s, pos };
    }),
  };
}

export type { Step };
