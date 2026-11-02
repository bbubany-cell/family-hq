// Renders one annotation shape with Konva. Shared by committed shapes and the live draft.
// Each shape is a Group: a dark, slightly wider "underlay" (so yellow/white lines still read
// on bright ice) + the colored stroke on top. Cheaper than blurred shadows and looks cleaner.
import { memo } from 'react';
import { Arrow, Circle, Ellipse, Group, Label, Line, Rect, Tag, Text } from 'react-konva';
import type Konva from 'konva';
import type { Shape } from '../types';
import { partialPath } from '../lib/track';
import { clamp } from '../lib/util';

interface Props {
  shape: Shape;
  opacity: number;
  /** Current view scale; used to keep hit areas a usable size on screen. */
  viewScale: number;
  /** Current video time (only trails use it, to draw themselves on). */
  now?: number;
  draggable?: boolean;
  onSelect?: (id: string) => void;
  onDragStart?: () => void;
  onDragEnd?: (id: string, e: Konva.KonvaEventObject<DragEvent>) => void;
  onTextEdit?: (id: string) => void;
}

const UNDERLAY = 'rgba(0,0,0,0.55)';

function ShapeNodeImpl({ shape: s, opacity, viewScale, now = Infinity, draggable, onSelect, onDragStart, onDragEnd, onTextEdit }: Props) {
  const dash = s.dashed ? [s.width * 2.5, s.width * 2] : undefined;
  const group = {
    id: s.id,
    name: 'shape',
    opacity,
    draggable,
    onPointerDown: () => onSelect?.(s.id),
    onDragStart: () => onDragStart?.(),
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => onDragEnd?.(s.id, e),
    // Double-tap edits the words on text labels, player markers and gap lines.
    onDblClick: () => onTextEdit?.(s.id),
    onDblTap: () => onTextEdit?.(s.id),
  };
  const pad = Math.max(3, s.width * 0.6);
  const base = {
    lineCap: 'round' as const,
    lineJoin: 'round' as const,
    perfectDrawEnabled: false,
    // Thin lines are hard to grab with a finger: widen the invisible hit area.
    hitStrokeWidth: Math.max(s.width + pad, 24 / viewScale),
  };
  const under = { ...base, stroke: UNDERLAY, strokeWidth: s.width + pad, dash, listening: false };
  const over = { ...base, stroke: s.color, strokeWidth: s.width, dash };
  const head = s.width * 3 + 10;

  switch (s.kind) {
    case 'pen':
    case 'line': {
      const tension = s.kind === 'pen' ? 0.3 : 0;
      return (
        <Group {...group} x={0} y={0}>
          <Line {...under} points={s.points} tension={tension} />
          <Line {...over} points={s.points} tension={tension} />
        </Group>
      );
    }
    case 'arrow':
    case 'curve': {
      const tension = s.kind === 'curve' ? 0.5 : 0;
      return (
        <Group {...group} x={0} y={0}>
          <Arrow {...under} fill={UNDERLAY} points={s.points} tension={tension} pointerLength={head} pointerWidth={head} />
          <Arrow {...over} fill={s.color} points={s.points} tension={tension} pointerLength={head} pointerWidth={head} />
        </Group>
      );
    }
    case 'ellipse':
      return (
        <Group {...group} x={s.x} y={s.y}>
          <Ellipse {...under} radiusX={s.rx} radiusY={s.ry} />
          <Ellipse {...over} radiusX={s.rx} radiusY={s.ry} />
        </Group>
      );
    case 'rect':
      return (
        <Group {...group} x={s.x} y={s.y}>
          <Rect {...under} width={s.w} height={s.h} />
          <Rect {...over} width={s.w} height={s.h} />
        </Group>
      );
    case 'trail': {
      // Draws itself on over `reveal` seconds starting at t, like the player skating the route.
      const frac = s.reveal ? clamp((now - s.t) / s.reveal, 0, 1) : 1;
      const pts = partialPath(s.points, frac);
      return (
        <Group {...group} x={0} y={0}>
          <Arrow {...under} fill={UNDERLAY} points={pts} tension={0.3} pointerLength={head} pointerWidth={head} />
          <Arrow {...over} fill={s.color} points={pts} tension={0.3} pointerLength={head} pointerWidth={head} />
        </Group>
      );
    }
    case 'spotlight':
      // The dimming itself is drawn by SpotlightOverlay; this is the grabbable ring.
      return (
        <Group {...group} x={s.x} y={s.y}>
          <Ellipse {...over} radiusX={s.rx} radiusY={s.ry} strokeWidth={Math.max(2, s.width * 0.5)} opacity={0.9} />
        </Group>
      );
    case 'marker': {
      const ry = s.r * 0.38;
      const font = Math.max(28, s.r * 0.9);
      const tag = s.label ? (
        <Label x={0} y={s.variant === 'ring' ? ry + 4 : s.r * 0.6 + 4} listening={false}>
          <Tag fill={s.color} pointerDirection="up" pointerWidth={font * 0.6} pointerHeight={font * 0.35} cornerRadius={font * 0.25} />
          <Text text={s.label} fontSize={font} fontStyle="bold" fill="#fff" padding={font * 0.25} fontFamily="system-ui, -apple-system, sans-serif" />
        </Label>
      ) : null;
      if (s.variant === 'dot') {
        const rad = s.r * 0.6;
        const short = s.label.length <= 3;
        return (
          <Group {...group} x={s.x} y={s.y}>
            <Circle radius={rad + pad / 2} fill={UNDERLAY} listening={false} />
            <Circle radius={rad} fill={s.color} stroke="#fff" strokeWidth={Math.max(2, rad * 0.12)} hitStrokeWidth={24 / viewScale} />
            {short && s.label && (
              <Text text={s.label} width={rad * 2} height={rad * 2} offsetX={rad} offsetY={rad} align="center" verticalAlign="middle" fontSize={rad * 1.05} fontStyle="bold" fill="#fff" listening={false} />
            )}
            {!short && tag}
          </Group>
        );
      }
      return (
        <Group {...group} x={s.x} y={s.y}>
          <Ellipse radiusX={s.r} radiusY={ry} fill={s.color} opacity={0.22} />
          <Ellipse {...under} radiusX={s.r} radiusY={ry} />
          <Ellipse {...over} radiusX={s.r} radiusY={ry} strokeWidth={Math.max(3, s.width)} />
          {tag}
        </Group>
      );
    }
    case 'zone':
      return (
        <Group {...group} x={0} y={0}>
          <Line points={s.points} closed fill={s.color} opacity={0.28} />
          <Line {...over} points={s.points} closed strokeWidth={Math.max(2, s.width * 0.5)} opacity={0.9} listening={false} />
        </Group>
      );
    case 'gap': {
      const [x1, y1, x2, y2] = s.points;
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const cap = Math.max(10, s.width * 2.5);
      const nx = (-(y2 - y1) / len) * cap, ny = ((x2 - x1) / len) * cap;
      const font = Math.max(18, s.width * 4);
      return (
        <Group {...group} x={0} y={0}>
          {[ [x1, y1, x2, y2], [x1 - nx, y1 - ny, x1 + nx, y1 + ny], [x2 - nx, y2 - ny, x2 + nx, y2 + ny] ].map((p, i) => (
            <Group key={i}>
              <Line {...under} points={p} dash={i === 0 ? dash : undefined} />
              <Line {...over} points={p} dash={i === 0 ? dash : undefined} />
            </Group>
          ))}
          {s.label && (
            <Label x={(x1 + x2) / 2} y={(y1 + y2) / 2 - cap} listening={false}>
              <Tag fill="rgba(0,0,0,0.7)" pointerDirection="down" pointerWidth={font * 0.5} pointerHeight={font * 0.3} cornerRadius={font * 0.25} />
              <Text text={s.label} fontSize={font} fontStyle="bold" fill={s.color} padding={font * 0.25} fontFamily="system-ui, -apple-system, sans-serif" />
            </Label>
          )}
        </Group>
      );
    }
    case 'text': {
      const dark = isDark(s.color);
      return (
        <Label {...group} x={s.x} y={s.y}>
          <Tag fill={dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.65)'} cornerRadius={s.fontSize * 0.2} />
          <Text
            text={s.text}
            fontSize={s.fontSize}
            fontStyle="bold"
            fill={s.color}
            padding={s.fontSize * 0.3}
            fontFamily="system-ui, -apple-system, sans-serif"
          />
        </Label>
      );
    }
  }
}

function isDark(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 70;
}

export const ShapeNode = memo(ShapeNodeImpl);
