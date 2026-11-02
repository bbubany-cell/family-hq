// Core data model for IQ Film Room.
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
  | 'eraser'
  // Phase 2 hockey tools
  | 'spotlight'
  | 'marker'
  | 'trail'
  | 'zone'
  | 'gap';

export type ShapeKind =
  | 'pen' | 'line' | 'arrow' | 'curve' | 'ellipse' | 'rect' | 'text'
  | 'spotlight' | 'marker' | 'trail' | 'zone' | 'gap';

/**
 * One point of a shape's movement over time: at video time `t` the shape is shifted by (dx, dy)
 * from where it was drawn. Recorded by "Follow with Pencil" or set by dragging while paused.
 * Between keyframes the offset is interpolated, so anything can ride along with a player
 * (or with the camera pan) during playback.
 */
export interface Keyframe {
  t: number;
  dx: number;
  dy: number;
}

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
  /** Movement over time (sorted by t). Empty/undefined = the shape stays where it was drawn. */
  track?: Keyframe[];
  /** Draw the path this shape has travelled so far (tracked shapes only). */
  showTrail?: boolean;
}

/**
 * pen: freehand points; line/arrow: [x1,y1,x2,y2]; curve: [x1,y1,midX,midY,x2,y2] (curve passes through mid).
 * trail: a freehand route that draws itself on over `reveal` seconds, ending in an arrowhead.
 */
export interface PathShape extends ShapeBase {
  kind: 'pen' | 'line' | 'arrow' | 'curve' | 'trail';
  points: number[];
  /** Seconds the path takes to draw itself on (trail). */
  reveal?: number;
}

/** Dims the whole frame except a soft-edged ellipse. Track it to follow a player. */
export interface SpotlightShape extends ShapeBase {
  kind: 'spotlight';
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** How dark the rest of the frame gets, 0..1. */
  dim: number;
}

export type Team = 'us' | 'them';

/** Player marker: a ring under the skates or a numbered dot, with an optional name/number tag. */
export interface MarkerShape extends ShapeBase {
  kind: 'marker';
  x: number;
  y: number;
  r: number;
  team: Team;
  variant: 'ring' | 'dot';
  label: string;
}

export type ZonePreset = 'slot' | 'danger' | 'neutral' | 'blueline' | 'lane' | 'box';

/** Shaded area (polygon). Vertices are editable; track it to ride along with a camera pan. */
export interface ZoneShape extends ShapeBase {
  kind: 'zone';
  preset: ZonePreset;
  points: number[];
}

/** Gap/distance line between two points. Each end can be attached to a marker/spotlight so it follows them. */
export interface GapShape extends ShapeBase {
  kind: 'gap';
  points: number[]; // [x1,y1,x2,y2] used when an end isn't attached
  a: string | null;
  b: string | null;
  label: string;
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

export type Shape = PathShape | EllipseShape | RectShape | TextShape | SpotlightShape | MarkerShape | ZoneShape | GapShape;

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
  /** Teaching stops: playback auto-pauses here when Teach mode is on. */
  stops?: number[];
  teach?: { on: boolean; atDrawings: boolean };
}

// ---------------- Phase 3 ----------------

export const CLIP_TAGS = ['Breakout', 'Forecheck', 'PP', 'PK', 'D-zone', 'Neutral zone', 'O-zone', 'Turnover', 'Goal', 'Good', 'Fix'] as const;

/** A saved stretch of a project's video. Its drawings are the project's drawings in that time range. */
export interface Clip {
  id: string;
  projectId: string;
  name: string;
  start: number;
  end: number;
  tags: string[];
  notes: string;
  createdAt: number;
  updatedAt: number;
  thumb?: string;
}

export interface Playlist {
  id: string;
  name: string;
  clipIds: string[];
  createdAt: number;
  updatedAt: number;
}

// ----- Rink whiteboard. All positions are in feet on a 200 × 85 ft rink (x: 0 = left end boards). -----

export type BoardView = 'full' | 'half' | 'zone';
export type PieceKind = 'O' | 'X' | 'G' | 'puck' | 'cone' | 'net' | 'coach';
export type RouteKind = 'skate' | 'carry' | 'pass' | 'shot' | 'backward' | 'line';

export interface Piece {
  id: string;
  kind: PieceKind;
  color: string;
  label: string;
}

export interface Route {
  id: string;
  kind: RouteKind;
  color: string;
  /** Freehand points in feet. */
  points: number[];
}

/** One step of a play: where every piece is, and the routes drawn during this step. */
export interface Step {
  id: string;
  pos: Record<string, { x: number; y: number }>;
  routes: Route[];
  note: string;
}

export interface Drill {
  id: string;
  name: string;
  notes: string;
  view: BoardView;
  pieces: Piece[];
  steps: Step[];
  /** Seconds per step during playback. */
  stepTime: number;
  thumb?: string;
  createdAt: number;
  updatedAt: number;
}
