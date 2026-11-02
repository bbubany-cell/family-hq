// Maps between screen (container) pixels and video pixels for the current zoom/pan.
import type { View } from '../store/playerStore';

export interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

/** Fit the video in the container, then apply zoom (around center) and pan. */
export function computeTransform(cw: number, ch: number, vw: number, vh: number, view: View): ViewTransform {
  const fit = Math.min(cw / vw, ch / vh) || 1;
  const scale = fit * view.zoom;
  return {
    scale,
    tx: cw / 2 - (vw * scale) / 2 + view.x,
    ty: ch / 2 - (vh * scale) / 2 + view.y,
  };
}

export const toVideo = (t: ViewTransform, sx: number, sy: number) => ({
  x: (sx - t.tx) / t.scale,
  y: (sy - t.ty) / t.scale,
});

export const toScreen = (t: ViewTransform, vx: number, vy: number) => ({
  x: vx * t.scale + t.tx,
  y: vy * t.scale + t.ty,
});

/**
 * New view so that the video point under screen point (px,py) stays put while zoom changes,
 * then shifted by (dx,dy) screen px (used for two-finger pan during a pinch).
 */
export function zoomAt(
  cw: number,
  ch: number,
  vw: number,
  vh: number,
  view: View,
  px: number,
  py: number,
  newZoom: number,
  dx = 0,
  dy = 0,
): View {
  const zoom = Math.min(12, Math.max(1, newZoom));
  const t = computeTransform(cw, ch, vw, vh, view);
  const v = toVideo(t, px, py);
  const fit = Math.min(cw / vw, ch / vh) || 1;
  const scale = fit * zoom;
  const tx = px + dx - v.x * scale;
  const ty = py + dy - v.y * scale;
  if (zoom === 1) return { zoom: 1, x: 0, y: 0 }; // snap back to centered at 1x
  return { zoom, x: tx - (cw / 2 - (vw * scale) / 2), y: ty - (ch / 2 - (vh * scale) / 2) };
}
