// Zone presets. Each is a polygon in a unit box (0..1) that gets stretched into the box you drag.
// Camera angles vary a lot, so these are starting shapes: drag the corner handles to fit the ice.
import type { ZonePreset } from '../types';

export const ZONES: Record<ZonePreset, { label: string; color: string; unit: number[] }> = {
  // Narrow end = the net side. Drag your box from the far end toward the net.
  slot: { label: 'Slot', color: '#ff9500', unit: [0, 0, 1, 0, 0.7, 1, 0.3, 1] },
  danger: { label: 'High danger', color: '#ff3b30', unit: [0, 0, 1, 0, 1, 0.6, 0.5, 1, 0, 0.6] },
  neutral: { label: 'Neutral zone', color: '#2f81f7', unit: [0, 0, 1, 0, 1, 1, 0, 1] },
  blueline: { label: 'Blue line', color: '#0a84ff', unit: [0.4, 0, 0.6, 0, 0.6, 1, 0.4, 1] },
  lane: { label: 'Passing lane', color: '#ffd60a', unit: [] }, // built from start→end instead (see laneFrom)
  box: { label: 'Area', color: '#34c759', unit: [0, 0, 1, 0, 1, 1, 0, 1] },
};

/** Fit a preset polygon into the box from (x1,y1) to (x2,y2). */
export function zoneFromBox(preset: ZonePreset, x1: number, y1: number, x2: number, y2: number): number[] {
  if (preset === 'lane') return laneFrom(x1, y1, x2, y2, 40);
  const u = ZONES[preset].unit;
  const out: number[] = [];
  for (let i = 0; i < u.length; i += 2) out.push(x1 + (x2 - x1) * u[i], y1 + (y2 - y1) * u[i + 1]);
  return out;
}

/** A passing lane: a band of `width` px from passer to target. */
export function laneFrom(x1: number, y1: number, x2: number, y2: number, width: number): number[] {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = (-(y2 - y1) / len) * (width / 2);
  const ny = ((x2 - x1) / len) * (width / 2);
  return [x1 + nx, y1 + ny, x2 + nx * 1.6, y2 + ny * 1.6, x2 - nx * 1.6, y2 - ny * 1.6, x1 - nx, y1 - ny];
}
