// Core data model for Film Room.
// All shape coordinates are in *video pixel space* (0..videoWidth, 0..videoHeight),
// so annotations stay locked to the picture no matter how the view is zoomed or resized.

export type Tool =
  | 'select'
  | 'hand'
  | 'pen'
  | 'line'
  | 'arrow'
  | 'curve'
  | 'ellipse'
  | 'rect'
  | 'text'
  | 'eraser';

export type ShapeKind = 'pen' | 'line' | 'arrow' | 'curve' | 'ellipse' | 'rect' | 'text';

/** Style shared by every shape. */
export interface ShapeStyle {
  color: string;
  /** Stroke width in video pixels. */
  width: number;
  dashed: boolean;
}

/**
 * When a shape is visible on the video timeline.
 * Fully visible from `t` to `t + hold`. Fades in during the `fadeIn` seconds *before* t
 * (so it is solid on the exact frame you drew it), fades out over `fadeOut` after the hold.
 * `hold === null` means "pinned": stays up for the rest of the video.
 */
export interface ShapeTiming {
  t: number;
  hold: number | null;
  fadeIn: number;
  fadeOut: number;
}

interface ShapeBase extends ShapeStyle, ShapeTiming {
  id: string;
  layerId: string;
}

/** pen: freehand points; line/arrow: [x1,y1,x2,y2]; curve: [x1,y1,midX,midY,x2,y2] (curve passes through mid). */
export interface PathShape extends ShapeBase {
  kind: 'pen' | 'line' | 'arrow' | 'curve';
  points: number[];
}

/** Ellipse stored by center + radii. */
export interface EllipseShape extends ShapeBase {
  kind: 'ellipse';
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export interface RectShape extends ShapeBase {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextShape extends ShapeBase {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

export type Shape = PathShape | EllipseShape | RectShape | TextShape;

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

export interface LoopRange {
  in: number | null;
  out: number | null;
  enabled: boolean;
}

/** Info about the source video. The file itself is never copied or uploaded. */
export interface VideoMeta {
  name: string;
  size: number;
  type: string;
  duration: number;
  width: number;
  height: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  video: VideoMeta;
  /** Small JPEG data URL for the library card. */
  thumb?: string;
  fps: number;
  /** True once the user picks an fps manually; stops auto-detect from overriding it. */
  fpsLocked?: boolean;
  shapes: Shape[];
  layers: Layer[];
  activeLayerId: string;
  loop: LoopRange;
  lastTime: number;
}
