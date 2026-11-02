// The video + drawing surface.
// - <video> is positioned/zoomed with a CSS transform (GPU-composited, cheap).
// - A full-size Konva stage sits on top; its content group gets the *same* transform
//   mathematically, so strokes stay razor sharp at any zoom.
// - All pointer input (mouse, touch, Apple Pencil) is handled here: drawing, erasing,
//   select-mode panning, two-finger pinch zoom, wheel/trackpad zoom.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer as KLayer, Stage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { useEditor } from '../store/editorStore';
import { attachVideo, getVideo, pause, usePlayer, type View } from '../store/playerStore';
import { computeTransform, toScreen, toVideo, zoomAt, type ViewTransform } from '../lib/view';
import { isPath, shapeOpacity, thinPoints, translateShape, uid } from '../lib/util';
import type { PathShape, Shape, ShapeKind } from '../types';
import { ShapeNode } from './ShapeNode';

type Gesture =
  | { kind: 'none' }
  | { kind: 'draw' }
  | { kind: 'erase' }
  | { kind: 'pan'; startX: number; startY: number; view: View }
  | { kind: 'pinch'; dist: number; midX: number; midY: number; view: View };

const DRAW_TOOLS = new Set(['pen', 'line', 'arrow', 'curve', 'ellipse', 'rect']);

export function VideoStage({ src }: { src: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const { videoW, videoH, view, currentTime } = usePlayer();
  const shapes = useEditor((s) => s.shapes);
  const layers = useEditor((s) => s.layers);
  const tool = useEditor((s) => s.tool);
  const selectedId = useEditor((s) => s.selectedId);
  const pencilOnly = useEditor((s) => s.pencilOnly);

  const T = computeTransform(size.w, size.h, videoW, videoH, view);
  const tRef = useRef<ViewTransform>(T);
  tRef.current = T;

  // ---------- setup ----------
  useLayoutEffect(() => {
    const el = containerRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => attachVideo(videoRef.current!), []);

  /** Keep the video covering the viewport when zoomed in; centered at 1x. */
  const clampView = useCallback(
    (v: View): View => {
      if (v.zoom <= 1) return { zoom: 1, x: 0, y: 0 };
      const fit = Math.min(size.w / videoW, size.h / videoH) || 1;
      const s = fit * v.zoom;
      const mx = Math.max(0, (videoW * s - size.w) / 2);
      const my = Math.max(0, (videoH * s - size.h) / 2);
      return { zoom: v.zoom, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) };
    },
    [size.w, size.h, videoW, videoH],
  );
  const setView = (v: View) => usePlayer.getState().set({ view: clampView(v) });

  // ---------- which shapes are on screen right now ----------
  const visible = useMemo(() => {
    const layerOk = new Map(layers.map((l) => [l.id, l]));
    const out: { shape: Shape; opacity: number; locked: boolean }[] = [];
    for (const s of shapes) {
      const l = layerOk.get(s.layerId);
      if (l && !l.visible) continue;
      const o = shapeOpacity(s, currentTime);
      if (o > 0.001) out.push({ shape: s, opacity: o, locked: !!l?.locked });
    }
    return out;
  }, [shapes, layers, currentTime]);

  // ---------- live draft (shape being drawn) ----------
  const [draft, setDraft] = useState<Shape | null>(null);
  const draftRef = useRef<{ shape: Shape; raw: number[]; start: { x: number; y: number } } | null>(null);
  const rafRef = useRef(0);
  const flushDraft = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setDraft(draftRef.current ? { ...draftRef.current.shape } : null);
    });
  };

  // ---------- pointer handling ----------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture>({ kind: 'none' });

  const local = (e: { clientX: number; clientY: number }) => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const hitShape = (sx: number, sy: number): Konva.Node | null => {
    const n = stageRef.current?.getIntersection({ x: sx, y: sy });
    return n ? n.findAncestor('.shape', true) ?? n : null;
  };

  const eraseAt = (sx: number, sy: number) => {
    const n = hitShape(sx, sy);
    if (n && n.name() === 'shape') {
      const s = useEditor.getState().shapes.find((x) => x.id === n.id());
      const l = useEditor.getState().layers.find((x) => x.id === s?.layerId);
      if (s && !l?.locked) useEditor.getState().deleteShape(s.id);
    }
  };

  const stopKonvaDrags = () => {
    stageRef.current?.find((n: Konva.Node) => n.isDragging()).forEach((n) => n.stopDrag());
  };

  const startDraw = (kind: ShapeKind, sx: number, sy: number) => {
    const ed = useEditor.getState();
    const video = getVideo();
    if (video && !video.paused) pause(); // drawing always freezes the frame
    const p = toVideo(tRef.current, sx, sy);
    const base = {
      id: uid(),
      layerId: ed.activeLayerId,
      ...ed.style,
      ...ed.timing,
      t: video?.currentTime ?? 0,
    };
    let shape: Shape;
    if (kind === 'ellipse') shape = { ...base, kind, x: p.x, y: p.y, rx: 0, ry: 0 };
    else if (kind === 'rect') shape = { ...base, kind, x: p.x, y: p.y, w: 0, h: 0 };
    else shape = { ...base, kind: kind as PathShape['kind'], points: [p.x, p.y, p.x, p.y] };
    draftRef.current = { shape, raw: [p.x, p.y], start: p };
    flushDraft();
  };

  const moveDraw = (pts: { x: number; y: number }[], shift: boolean) => {
    const d = draftRef.current;
    if (!d) return;
    const s = d.shape;
    const { start } = d;
    for (const pt of pts) {
      const p = toVideo(tRef.current, pt.x, pt.y);
      d.raw.push(p.x, p.y);
    }
    const last = { x: d.raw[d.raw.length - 2], y: d.raw[d.raw.length - 1] };
    if (s.kind === 'pen') {
      s.points = d.raw.slice();
    } else if (s.kind === 'line' || s.kind === 'arrow') {
      const e = shift ? snapAngle(start, last) : last;
      s.points = [start.x, start.y, e.x, e.y];
    } else if (s.kind === 'curve') {
      s.points = fitCurve(d.raw);
    } else if (s.kind === 'rect') {
      let w = last.x - start.x, h = last.y - start.y;
      if (shift) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w) * m; h = Math.sign(h) * m; }
      Object.assign(s, { x: Math.min(start.x, start.x + w), y: Math.min(start.y, start.y + h), w: Math.abs(w), h: Math.abs(h) });
    } else if (s.kind === 'ellipse') {
      let w = last.x - start.x, h = last.y - start.y;
      if (shift) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w) * m; h = Math.sign(h) * m; }
      Object.assign(s, { x: start.x + w / 2, y: start.y + h / 2, rx: Math.abs(w / 2), ry: Math.abs(h / 2) });
    }
    flushDraft();
  };

  const endDraw = (cancel = false) => {
    const d = draftRef.current;
    draftRef.current = null;
    flushDraft();
    if (!d || cancel) return;
    const s = d.shape;
    const minLen = 4 / tRef.current.scale; // ignore accidental taps (except pen dots)
    if (s.kind === 'pen') {
      s.points = d.raw.length <= 2 ? [d.raw[0], d.raw[1], d.raw[0] + 0.1, d.raw[1]] : thinPoints(d.raw, 1.5 / tRef.current.scale);
    } else if (s.kind === 'line' || s.kind === 'arrow' || s.kind === 'curve') {
      const [x1, y1] = s.points, x2 = s.points[s.points.length - 2], y2 = s.points[s.points.length - 1];
      if (Math.hypot(x2 - x1, y2 - y1) < minLen) return;
    } else if (s.kind === 'rect' && (s.w < minLen || s.h < minLen)) return;
    else if (s.kind === 'ellipse' && (s.rx < minLen / 2 || s.ry < minLen / 2)) return;
    useEditor.getState().addShape(s);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (textEdit) return; // a tap outside the text box just commits it (via blur)
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    // Capture so strokes keep tracking outside the stage. Not when Konva owns the drag.
    const capture = () => {
      try {
        containerRef.current!.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
    };

    // Second finger down => pinch/pan, cancel whatever the first finger started.
    if (pointers.current.size === 2) {
      capture();
      endDraw(true);
      stopKonvaDrags();
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        kind: 'pinch',
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        view: usePlayer.getState().view,
      };
      return;
    }
    if (pointers.current.size > 2) return;

    const ed = useEditor.getState();
    const panOnly = e.button === 1 || ed.tool === 'hand' || (ed.pencilOnly && e.pointerType === 'touch');
    if (panOnly) {
      capture();
      gesture.current = { kind: 'pan', startX: p.x, startY: p.y, view: usePlayer.getState().view };
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    switch (ed.tool) {
      case 'select': {
        if (hitShape(p.x, p.y)) return; // Konva handles select/drag/transform
        ed.select(null);
        capture();
        gesture.current = { kind: 'pan', startX: p.x, startY: p.y, view: usePlayer.getState().view };
        return;
      }
      case 'eraser':
        capture();
        gesture.current = { kind: 'erase' };
        eraseAt(p.x, p.y);
        return;
      case 'text':
        return; // handled on pointerup (iOS only shows the keyboard from a tap)
      default:
        if (DRAW_TOOLS.has(ed.tool)) {
          capture();
          gesture.current = { kind: 'draw' };
          startDraw(ed.tool as ShapeKind, p.x, p.y);
        }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (g.kind === 'draw') {
      // Coalesced events give us every Apple Pencil sample (up to 240Hz) for smooth ink.
      const evs = (e.nativeEvent.getCoalescedEvents?.() ?? []) as PointerEvent[];
      moveDraw(evs.length ? evs.map(local) : [p], e.shiftKey);
    } else if (g.kind === 'erase') {
      eraseAt(p.x, p.y);
    } else if (g.kind === 'pan') {
      setView({ ...g.view, x: g.view.x + p.x - g.startX, y: g.view.y + p.y - g.startY });
    } else if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      setView(
        zoomAt(size.w, size.h, videoW, videoH, g.view, g.midX, g.midY, g.view.zoom * (dist / g.dist), mid.x - g.midX, mid.y - g.midY),
      );
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g.kind === 'draw') endDraw();
    if (g.kind === 'pinch') {
      gesture.current = { kind: 'none' }; // don't let the remaining finger start drawing
      return;
    }
    if (pointers.current.size === 0) {
      const ed = useEditor.getState();
      if (g.kind === 'none' && ed.tool === 'text' && e.type === 'pointerup' && !(ed.pencilOnly && e.pointerType === 'touch')) {
        const v = getVideo();
        if (v && !v.paused) pause();
        const vp = toVideo(tRef.current, p.x, p.y);
        openTextEditor(vp.x, vp.y, null);
      }
      gesture.current = { kind: 'none' };
    }
  };

  // Wheel: trackpad pinch (ctrlKey) or mouse wheel => zoom at cursor; two-finger scroll => pan.
  useEffect(() => {
    const el = containerRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const v = usePlayer.getState().view;
      const isMouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50);
      if (e.ctrlKey || isMouseWheel) {
        const k = e.ctrlKey ? 0.01 : 0.0015;
        setView(zoomAt(r.width, r.height, videoW, videoH, v, px, py, v.zoom * Math.exp(-e.deltaY * k)));
      } else {
        setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // ---------- text labels ----------
  const [textEdit, setTextEdit] = useState<{ x: number; y: number; id: string | null } | null>(null);
  // Ref mirror: Enter commits and then blur fires — the ref makes sure we only commit once.
  const textEditRef = useRef(textEdit);

  /** Must run synchronously inside a user gesture so iPad shows the keyboard. */
  const openTextEditor = (vx: number, vy: number, id: string | null) => {
    const inp = textRef.current!;
    const ed = useEditor.getState();
    const existing = id ? (ed.shapes.find((s) => s.id === id) as Extract<Shape, { kind: 'text' }>) : null;
    const sp = toScreen(tRef.current, vx, vy);
    inp.value = existing?.text ?? '';
    inp.style.left = `${sp.x}px`;
    inp.style.top = `${sp.y}px`;
    inp.style.fontSize = `${Math.max(14, (existing?.fontSize ?? ed.fontSize) * tRef.current.scale)}px`;
    inp.style.color = existing?.color ?? ed.style.color;
    textEditRef.current = { x: vx, y: vy, id };
    inp.focus();
    setTextEdit(textEditRef.current);
  };

  const commitText = () => {
    const textEdit = textEditRef.current;
    if (!textEdit) return;
    textEditRef.current = null;
    const val = textRef.current!.value.trim();
    const ed = useEditor.getState();
    if (textEdit.id) {
      if (val) ed.updateShape(textEdit.id, { text: val } as Partial<Shape>);
      else ed.deleteShape(textEdit.id);
    } else if (val) {
      ed.addShape({
        id: uid(),
        kind: 'text',
        layerId: ed.activeLayerId,
        ...ed.style,
        ...ed.timing,
        t: getVideo()?.currentTime ?? 0,
        x: textEdit.x,
        y: textEdit.y,
        text: val,
        fontSize: ed.fontSize,
      });
    }
    setTextEdit(null);
    textRef.current!.blur();
  };

  const editTextShape = (id: string) => {
    const s = useEditor.getState().shapes.find((x) => x.id === id);
    if (s?.kind === 'text') openTextEditor(s.x, s.y, id);
  };

  // ---------- select-mode editing: move, transform, endpoint handles ----------
  const selected = selectedId ? shapes.find((s) => s.id === selectedId) : undefined;
  const selectedVisible = !!selected && visible.some((v) => v.shape.id === selected.id);

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const useTr = tool === 'select' && selected && selectedVisible && ['rect', 'ellipse', 'text', 'pen'].includes(selected.kind);
    const node = useTr ? stageRef.current?.findOne((n: Konva.Node) => n.id() === selected!.id) : null;
    tr.nodes(node ? [node] : []);
    tr.keepRatio(selected?.kind === 'text');
    tr.getLayer()?.batchDraw();
  }, [selected, selectedVisible, tool]);

  const onShapeDragEnd = (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const s = useEditor.getState().shapes.find((x) => x.id === id);
    if (!s) return;
    let next: Shape;
    if (isPath(s)) {
      next = translateShape(s, node.x(), node.y());
      node.position({ x: 0, y: 0 }); // react-konva won't reset this for us (prop stays 0)
    } else {
      next = { ...s, x: node.x(), y: node.y() };
    }
    useEditor.getState().updateShape(id, next, { history: false });
  };

  const onTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const s = useEditor.getState().shapes.find((x) => x.id === node.id());
    if (!s) return;
    const sx = node.scaleX(), sy = node.scaleY();
    node.scale({ x: 1, y: 1 });
    let patch: Partial<Shape> = {};
    if (s.kind === 'rect') patch = { x: node.x(), y: node.y(), w: Math.max(2, s.w * sx), h: Math.max(2, s.h * sy) };
    else if (s.kind === 'ellipse') patch = { x: node.x(), y: node.y(), rx: Math.max(1, s.rx * sx), ry: Math.max(1, s.ry * sy) };
    else if (s.kind === 'text') patch = { x: node.x(), y: node.y(), fontSize: Math.max(8, s.fontSize * sy) };
    else if (s.kind === 'pen') {
      const ox = node.x(), oy = node.y();
      node.position({ x: 0, y: 0 });
      patch = { points: s.points.map((v, i) => (i % 2 === 0 ? v * sx + ox : v * sy + oy)) };
    }
    useEditor.getState().updateShape(s.id, patch, { history: false });
  };

  const handles =
    tool === 'select' && selected && selectedVisible && (selected.kind === 'line' || selected.kind === 'arrow' || selected.kind === 'curve')
      ? selected
      : null;

  const ed = useEditor.getState();
  const shapesListening = tool === 'select' || tool === 'eraser';
  const cursor =
    tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : tool === 'eraser' ? 'cell' : tool === 'text' ? 'text' : 'crosshair';

  return (
    <div
      ref={containerRef}
      className="stage"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <video
        ref={videoRef}
        src={src}
        playsInline
        preload="auto"
        className="stage-video"
        style={{
          width: videoW,
          height: videoH,
          transform: `translate(${T.tx}px, ${T.ty}px) scale(${T.scale})`,
        }}
      />
      {size.w > 0 && (
        <Stage ref={stageRef} width={size.w} height={size.h} className="stage-canvas">
          <KLayer listening={shapesListening || !!handles}>
            <Group x={T.tx} y={T.ty} scaleX={T.scale} scaleY={T.scale}>
              {visible.map(({ shape, opacity, locked }) => (
                <ShapeNode
                  key={shape.id}
                  shape={shape}
                  opacity={opacity}
                  viewScale={T.scale}
                  draggable={tool === 'select' && !locked}
                  onSelect={tool === 'select' && !locked ? ed.select : undefined}
                  onDragStart={ed.beginChange}
                  onDragEnd={onShapeDragEnd}
                  onTextEdit={tool === 'select' ? editTextShape : undefined}
                />
              ))}
              {draft && <ShapeNode shape={draft} opacity={1} viewScale={T.scale} />}
              {handles &&
                pointIndexes(handles).map((i) => (
                  <Circle
                    key={i}
                    x={handles.points[i]}
                    y={handles.points[i + 1]}
                    radius={11 / T.scale}
                    fill={i === 2 && handles.kind === 'curve' ? '#fff' : handles.color}
                    stroke="#fff"
                    strokeWidth={2 / T.scale}
                    shadowColor="black"
                    shadowBlur={4 / T.scale}
                    hitStrokeWidth={20 / T.scale}
                    draggable
                    onDragStart={ed.beginChange}
                    onDragMove={(e) => {
                      const pts = handles.points.slice();
                      pts[i] = e.target.x();
                      pts[i + 1] = e.target.y();
                      useEditor.getState().updateShape(handles.id, { points: pts }, { history: false });
                    }}
                  />
                ))}
            </Group>
          </KLayer>
          <KLayer>
            <Transformer
              ref={trRef}
              rotateEnabled={false}
              flipEnabled={false}
              anchorSize={16}
              anchorCornerRadius={8}
              anchorStroke="#2f81f7"
              borderStroke="#2f81f7"
              padding={4}
              ignoreStroke
              onTransformStart={ed.beginChange}
              onTransformEnd={onTransformEnd}
            />
          </KLayer>
        </Stage>
      )}
      <textarea
        ref={textRef}
        className={'text-editor' + (textEdit ? ' open' : '')}
        rows={1}
        placeholder="Label…"
        onBlur={commitText}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commitText();
          } else if (e.key === 'Escape') {
            textRef.current!.value = '';
            commitText();
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
      {view.zoom > 1 && (
        <button className="zoom-badge" onPointerDown={(e) => e.stopPropagation()} onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>
          {view.zoom.toFixed(1)}× · reset
        </button>
      )}
      {pencilOnly && <div className="pencil-badge">✎ Pencil draws · fingers pan</div>}
    </div>
  );
}

/** Indexes (into points) of draggable handles: endpoints, plus the bend point on curves. */
const pointIndexes = (s: PathShape) => (s.kind === 'curve' ? [0, 2, 4] : [0, 2]);

/** Snap a line end to 15° increments (hold Shift). */
function snapAngle(a: { x: number; y: number }, b: { x: number; y: number }) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const step = Math.PI / 12;
  const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / step) * step;
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}

/**
 * Curved arrow: you sketch the bend you want, we turn it into a clean 3-point curve
 * through start, the halfway point along your stroke, and end.
 */
function fitCurve(raw: number[]): number[] {
  const n = raw.length / 2;
  const x1 = raw[0], y1 = raw[1], x2 = raw[raw.length - 2], y2 = raw[raw.length - 1];
  let total = 0;
  const cum = [0];
  for (let i = 1; i < n; i++) {
    total += Math.hypot(raw[i * 2] - raw[i * 2 - 2], raw[i * 2 + 1] - raw[i * 2 - 1]);
    cum.push(total);
  }
  let mid = Math.floor(n / 2);
  for (let i = 0; i < n; i++) if (cum[i] >= total / 2) { mid = i; break; }
  let mx = raw[mid * 2], my = raw[mid * 2 + 1];
  // Nearly straight sketch? Use the straight midpoint so it doesn't wobble.
  const chord = Math.hypot(x2 - x1, y2 - y1) || 1;
  const dev = Math.abs((x2 - x1) * (y1 - my) - (x1 - mx) * (y2 - y1)) / chord;
  if (dev < chord * 0.03) { mx = (x1 + x2) / 2; my = (y1 + y2) / 2; }
  return [x1, y1, mx, my, x2, y2];
}
