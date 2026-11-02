// Renders one annotation shape with Konva. Shared by committed shapes and the live draft.
// Each shape is a Group: a dark, slightly wider "underlay" (so yellow/white lines still read
// on bright ice) + the colored stroke on top. Cheaper than blurred shadows and looks cleaner.
import { memo } from 'react';
import { Arrow, Ellipse, Group, Label, Line, Rect, Tag, Text } from 'react-konva';
import type Konva from 'konva';
import type { Shape } from '../types';

interface Props {
  shape: Shape;
  opacity: number;
  /** Current view scale; used to keep hit areas a usable size on screen. */
  viewScale: number;
  draggable?: boolean;
  onSelect?: (id: string) => void;
  onDragStart?: () => void;
  onDragEnd?: (id: string, e: Konva.KonvaEventObject<DragEvent>) => void;
  onTextEdit?: (id: string) => void;
}

const UNDERLAY = 'rgba(0,0,0,0.55)';

function ShapeNodeImpl({ shape: s, opacity, viewScale, draggable, onSelect, onDragStart, onDragEnd, onTextEdit }: Props) {
  const dash = s.dashed ? [s.width * 2.5, s.width * 2] : undefined;
  const group = {
    id: s.id,
    name: 'shape',
    opacity,
    draggable,
    onPointerDown: () => onSelect?.(s.id),
    onDragStart: () => onDragStart?.(),
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => onDragEnd?.(s.id, e),
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
    case 'text': {
      const dark = isDark(s.color);
      return (
        <Label {...group} x={s.x} y={s.y} onDblClick={() => onTextEdit?.(s.id)} onDblTap={() => onTextEdit?.(s.id)}>
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
