// What's on screen at time t: tracks applied, gap lines attached, hidden layers and faded-out
// shapes dropped. Shared by the editor stage and the read-only players (compare / presentation).
import type Konva from 'konva';
import type { Layer, Shape } from '../types';
import { resolveGap, shapeAt } from './track';
import { shapeOpacity } from './util';

export interface Visible {
  shape: Shape; // time-resolved (track applied, gap ends attached)
  raw: Shape; // as stored
  opacity: number;
  locked: boolean;
}

export function resolveScene(shapes: Shape[], layers: Layer[], t: number, forceVisibleId?: string | null): Visible[] {
  const resolved = new Map<string, Shape>();
  for (const s of shapes) if (s.kind !== 'gap') resolved.set(s.id, shapeAt(s, t));
  for (const s of shapes) if (s.kind === 'gap') resolved.set(s.id, resolveGap(shapeAt(s, t) as typeof s, resolved));
  const layerById = new Map(layers.map((l) => [l.id, l]));
  const out: Visible[] = [];
  for (const raw of shapes) {
    const l = layerById.get(raw.layerId);
    if (l && !l.visible) continue;
    let o = shapeOpacity(raw, t);
    if (forceVisibleId && raw.id === forceVisibleId) o = 1;
    if (o > 0.001) out.push({ shape: resolved.get(raw.id)!, raw, opacity: o, locked: !!l?.locked });
  }
  return out;
}

/**
 * Spotlight dimming: darken the frame, then punch soft-edged holes (destination-out) for each spotlight.
 * `spots` rows are [x, y, rx, ry, dim, opacity]. Drawn on its own Konva layer so compositing stays contained.
 */
export function drawSpotlights(kctx: Konva.Context, spots: number[][], vw: number, vh: number) {
  const c = (kctx as unknown as { _context: CanvasRenderingContext2D })._context;
  let dark = 0;
  for (const [, , , , dim, op] of spots) dark = Math.max(dark, dim * op);
  if (dark <= 0) return;
  c.save();
  c.fillStyle = `rgba(0,0,0,${dark})`;
  c.fillRect(0, 0, vw, vh);
  c.globalCompositeOperation = 'destination-out';
  for (const [x, y, rx, ry, , op] of spots) {
    if (rx < 1 || ry < 1) continue;
    c.save();
    c.translate(x, y);
    c.scale(rx, ry);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 1.18);
    g.addColorStop(0, `rgba(0,0,0,${op})`);
    g.addColorStop(0.82, `rgba(0,0,0,${op})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, 1.18, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  c.restore();
}

export const spotRows = (vis: Visible[]) =>
  vis
    .filter((v) => v.shape.kind === 'spotlight')
    .map((v) => {
      const s = v.shape as Extract<Shape, { kind: 'spotlight' }>;
      return [s.x, s.y, s.rx, s.ry, s.dim, v.opacity];
    });
