// The video + drawing surface.
// - <video> is positioned/zoomed with a CSS transform (GPU-composited, cheap).
// - A full-size Konva stage sits on top; its content groups get the *same* transform
//   mathematically, so strokes stay razor sharp at any zoom.
// - All pointer input (mouse, touch, Apple Pencil) is handled here: drawing, erasing,
//   select-mode panning, two-finger pinch zoom, wheel/trackpad zoom, and "Follow with Pencil"
//   recording (video plays in slow-mo while you keep the Pencil on the player).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer as KLayer, Line, Shape as KShape, Stage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { useEditor } from '../store/editorStore';
import { attachVideo, getVideo, pause, play, setRate, usePlayer, type View } from '../store/playerStore';
import { computeTransform, toScreen, toVideo, zoomAt, type ViewTransform } from '../lib/view';
import { isPath, isStroke, thinPoints, uid } from '../lib/util';
import { drawSpotlights, resolveScene, spotRows } from '../lib/scene';
import {
  anchorOf,
  hasTrack,
  isAttachable,
  offsetAt,
  setKeyframe,
  snapsToPointer,
  spliceTrack,
  trailPoints,
  type Pt,
} from '../lib/track';
import { ZONES, zoneFromBox } from '../lib/zones';
import type { Keyframe, PathShape, Shape } from '../types';
import { ShapeNode } from './ShapeNode';
import { Icon } from './Icon';

type Gesture =
  | { kind: 'none' }
  | { kind: 'draw' }
  | { kind: 'erase' }
  | { kind: 'follow' }
  | { kind: 'pan'; startX: number; startY: number; view: View }
  | { kind: 'pinch'; dist: number; midX: number; midY: number; view: View };

/** Tools that create a shape by pressing/dragging on the video. */
const DRAW_TOOLS = new Set(['pen', 'line', 'arrow', 'curve', 'ellipse', 'rect', 'spotlight', 'marker', 'trail', 'zone', 'gap']);
/** Tools that make sense as a single tap (default size). */
const TAP_TOOLS = new Set(['marker', 'spotlight']);
/** Shapes that get the resize box in Select mode (others use point handles). */
const TRANSFORMABLE = new Set(['rect', 'ellipse', 'text', 'pen', 'trail', 'spotlight', 'marker']);


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
  const followArmed = useEditor((s) => s.followArmed);
  const followRate = useEditor((s) => s.followRate);

  const T = computeTransform(size.w, size.h, videoW, videoH, view);
  const tRef = useRef<ViewTransform>(T);
  tRef.current = T;
  /** Video px per 1080p px — default sizes scale with resolution. */
  const unit = videoH / 1080;

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

  // ---------- where everything is right now ----------
  const visible = useMemo(
    // While recording a follow, always show the shape being tracked.
    () => resolveScene(shapes, layers, currentTime, followArmed ? selectedId : null),
    [shapes, layers, currentTime, followArmed, selectedId],
  );
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // ---------- live draft (shape being drawn) ----------
  const [draft, setDraft] = useState<Shape | null>(null);
  const draftRef = useRef<{ shape: Shape; raw: number[]; start: Pt } | null>(null);
  const rafRef = useRef(0);
  const flushDraft = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setDraft(draftRef.current ? ({ ...draftRef.current.shape } as Shape) : null);
    });
  };

  // ---------- pointer handling ----------
  const pointers = useRef(new Map<number, Pt>());
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

  /** Nearest visible player (marker/spotlight) under a video point, for attaching gap lines. */
  const findPlayer = (p: Pt): Shape | null => {
    let best: Shape | null = null;
    let bestD = Infinity;
    for (const v of visibleRef.current) {
      const s = v.shape;
      if (!isAttachable(s)) continue;
      const a = anchorOf(s);
      const reach = Math.max(s.kind === 'marker' ? s.r : Math.max(s.rx, s.ry), 40 / tRef.current.scale);
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d < reach && d < bestD) { best = s; bestD = d; }
    }
    return best;
  };

  const startDraw = (sx: number, sy: number) => {
    const ed = useEditor.getState();
    const kind = ed.tool;
    const video = getVideo();
    if (video && !video.paused) pause(); // drawing always freezes the frame
    const p = toVideo(tRef.current, sx, sy);
    const base = { id: uid(), layerId: ed.activeLayerId, ...ed.style, ...ed.timing, t: video?.currentTime ?? 0 };
    let shape: Shape;
    switch (kind) {
      case 'ellipse': shape = { ...base, kind, x: p.x, y: p.y, rx: 0, ry: 0 }; break;
      case 'rect': shape = { ...base, kind, x: p.x, y: p.y, w: 0, h: 0 }; break;
      case 'spotlight': shape = { ...base, kind, x: p.x, y: p.y, rx: 0, ry: 0, dim: ed.spotlightDim }; break;
      case 'marker':
        shape = {
          ...base, kind, x: p.x, y: p.y, r: 0, team: ed.markerTeam, variant: ed.markerVariant, label: '',
          color: ed.teamColors[ed.markerTeam],
        };
        break;
      case 'zone': shape = { ...base, kind, preset: ed.zonePreset, points: [], color: ZONES[ed.zonePreset].color }; break;
      case 'gap': {
        const pl = findPlayer(p);
        const a = pl ? anchorOf(pl) : p;
        shape = { ...base, kind, points: [a.x, a.y, a.x, a.y], a: pl?.id ?? null, b: null, label: '' };
        break;
      }
      case 'trail': shape = { ...base, kind, points: [p.x, p.y, p.x, p.y], reveal: ed.trailReveal, dashed: true }; break;
      default: shape = { ...base, kind: kind as PathShape['kind'], points: [p.x, p.y, p.x, p.y] };
    }
    draftRef.current = { shape, raw: [p.x, p.y], start: p };
    flushDraft();
  };

  const moveDraw = (pts: Pt[], shift: boolean) => {
    const d = draftRef.current;
    if (!d) return;
    const s = d.shape;
    const { start } = d;
    for (const pt of pts) {
      const p = toVideo(tRef.current, pt.x, pt.y);
      d.raw.push(p.x, p.y);
    }
    const last = { x: d.raw[d.raw.length - 2], y: d.raw[d.raw.length - 1] };
    const box = () => {
      let w = last.x - start.x, h = last.y - start.y;
      if (shift) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w) * m; h = Math.sign(h) * m; }
      return { w, h };
    };
    switch (s.kind) {
      case 'pen':
      case 'trail':
        s.points = d.raw.slice();
        break;
      case 'line':
      case 'arrow': {
        const e = shift ? snapAngle(start, last) : last;
        s.points = [start.x, start.y, e.x, e.y];
        break;
      }
      case 'curve':
        s.points = fitCurve(d.raw);
        break;
      case 'rect': {
        const { w, h } = box();
        Object.assign(s, { x: Math.min(start.x, start.x + w), y: Math.min(start.y, start.y + h), w: Math.abs(w), h: Math.abs(h) });
        break;
      }
      case 'ellipse':
      case 'spotlight': {
        const { w, h } = box();
        Object.assign(s, { x: start.x + w / 2, y: start.y + h / 2, rx: Math.abs(w / 2), ry: Math.abs(h / 2) });
        break;
      }
      case 'marker':
        s.r = Math.hypot(last.x - start.x, last.y - start.y);
        break;
      case 'zone':
        s.points = zoneFromBox(s.preset, start.x, start.y, last.x, last.y);
        break;
      case 'gap': {
        const pl = findPlayer(last);
        const b = pl && pl.id !== s.a ? anchorOf(pl) : shift ? snapAngle({ x: s.points[0], y: s.points[1] }, last) : last;
        s.points = [s.points[0], s.points[1], b.x, b.y];
        s.b = pl && pl.id !== s.a ? pl.id : null;
        break;
      }
    }
    flushDraft();
  };

  const endDraw = (cancel = false) => {
    const d = draftRef.current;
    draftRef.current = null;
    flushDraft();
    if (!d || cancel) return;
    const s = d.shape;
    const minLen = 4 / tRef.current.scale; // ignore accidental taps (except pen dots / tap tools)
    const tapped = Math.hypot(d.raw[d.raw.length - 2] - d.start.x, d.raw[d.raw.length - 1] - d.start.y) < 8 / tRef.current.scale;
    switch (s.kind) {
      case 'pen':
        s.points = d.raw.length <= 2 ? [d.raw[0], d.raw[1], d.raw[0] + 0.1, d.raw[1]] : thinPoints(d.raw, 1.5 / tRef.current.scale);
        break;
      case 'trail':
        if (tapped) return;
        s.points = thinPoints(d.raw, 3 / tRef.current.scale);
        break;
      case 'line': case 'arrow': case 'curve': case 'gap': {
        const [x1, y1] = s.points, x2 = s.points[s.points.length - 2], y2 = s.points[s.points.length - 1];
        if (Math.hypot(x2 - x1, y2 - y1) < minLen) return;
        break;
      }
      case 'rect': if (s.w < minLen || s.h < minLen) return; break;
      case 'ellipse': if (s.rx < minLen / 2 || s.ry < minLen / 2) return; break;
      case 'zone': if (tapped) return; break;
      case 'spotlight':
        if (tapped) Object.assign(s, { x: d.start.x, y: d.start.y, rx: 60 * unit, ry: 85 * unit }); // ~one player
        break;
      case 'marker':
        if (tapped || s.r < 10 * unit) s.r = 32 * unit;
        break;
    }
    const ed = useEditor.getState();
    ed.addShape(s);
    // The drawing you just made is the panel's target: tap "1s", a color, etc. and it changes this drawing
    // (and your next ones). Also puts "Follow with Pencil" one tap away for player tools.
    ed.select(s.id, { justDrawn: true });
  };

  // ---------- Follow with Pencil (record a track) ----------
  const followRef = useRef<{
    id: string;
    t0: number;
    snap: boolean;
    base: Keyframe[] | undefined;
    anchor: Pt; // base (untracked) anchor
    grab: Pt; // pointer at press (relative mode)
    grabOff: { dx: number; dy: number };
    ptr: Pt; // latest pointer (video px)
    recorded: Keyframe[];
    prevRate: number;
    unsub: () => void;
  } | null>(null);

  const followOffset = (f: NonNullable<typeof followRef.current>) =>
    f.snap
      ? { dx: f.ptr.x - f.anchor.x, dy: f.ptr.y - f.anchor.y }
      : { dx: f.grabOff.dx + f.ptr.x - f.grab.x, dy: f.grabOff.dy + f.ptr.y - f.grab.y };

  const recordFollowSample = (t: number) => {
    const f = followRef.current;
    if (!f) return;
    const o = followOffset(f);
    const last = f.recorded[f.recorded.length - 1];
    if (last && t <= last.t + 1e-4) last.dx = o.dx, last.dy = o.dy;
    else f.recorded.push({ t, ...o });
    useEditor.getState().updateShape(f.id, { track: spliceTrack(f.base, f.t0, t, f.recorded) }, { history: false });
  };

  const startFollow = (sx: number, sy: number) => {
    const ed = useEditor.getState();
    const s = ed.shapes.find((x) => x.id === ed.selectedId);
    const video = getVideo();
    if (!s || !video) return false;
    const t0 = video.currentTime;
    const p = toVideo(tRef.current, sx, sy);
    ed.beginChange();
    followRef.current = {
      id: s.id,
      t0,
      snap: snapsToPointer(s),
      base: s.track,
      anchor: anchorOf(s),
      grab: p,
      grabOff: offsetAt(s.track, t0),
      ptr: p,
      recorded: [],
      prevRate: usePlayer.getState().rate,
      // Each new video frame = one keyframe at wherever the Pencil is.
      unsub: usePlayer.subscribe((st, prev) => {
        if (st.currentTime !== prev.currentTime) recordFollowSample(st.currentTime);
      }),
    };
    recordFollowSample(t0);
    usePlayer.getState().set({ following: true });
    setRate(ed.followRate);
    play();
    return true;
  };

  const endFollow = () => {
    const f = followRef.current;
    if (!f) return;
    followRef.current = null;
    f.unsub();
    pause();
    setRate(f.prevRate);
    usePlayer.getState().set({ following: false });
    const v = getVideo();
    if (v) recordFollowSample(v.currentTime);
    // Make sure the shape is on screen for the whole tracked stretch.
    const ed = useEditor.getState();
    const s = ed.shapes.find((x) => x.id === f.id);
    if (s?.track?.length) {
      const first = s.track[0].t, last = s.track[s.track.length - 1].t;
      const t = Math.min(s.t, first);
      const hold = s.hold === null ? null : Math.max(s.hold + (s.t - t), last - t + 0.5);
      ed.updateShape(s.id, { t, hold }, { history: false });
    }
  };

  // ---------- pointer events ----------
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
      endFollow();
      stopKonvaDrags();
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2, view: usePlayer.getState().view };
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

    if (ed.followArmed && ed.selectedId) {
      capture();
      if (startFollow(p.x, p.y)) gesture.current = { kind: 'follow' };
      return;
    }

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
          // Spotlight/marker tool: pressing an existing one of the same kind grabs it instead of making a new one.
          if (TAP_TOOLS.has(ed.tool)) {
            const n = hitShape(p.x, p.y);
            if (n && ed.shapes.find((x) => x.id === n.id())?.kind === ed.tool) return; // Konva drags it
          }
          capture();
          gesture.current = { kind: 'draw' };
          startDraw(p.x, p.y);
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
    } else if (g.kind === 'follow') {
      if (followRef.current) followRef.current.ptr = toVideo(tRef.current, p.x, p.y);
    } else if (g.kind === 'erase') {
      eraseAt(p.x, p.y);
    } else if (g.kind === 'pan') {
      setView({ ...g.view, x: g.view.x + p.x - g.startX, y: g.view.y + p.y - g.startY });
    } else if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      setView(zoomAt(size.w, size.h, videoW, videoH, g.view, g.midX, g.midY, g.view.zoom * (dist / g.dist), mid.x - g.midX, mid.y - g.midY));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g.kind === 'draw') endDraw();
    if (g.kind === 'follow') endFollow();
    if (g.kind === 'pinch') {
      gesture.current = { kind: 'none' }; // don't let the remaining finger start drawing
      return;
    }
    if (pointers.current.size === 0) {
      const ed = useEditor.getState();
      if (g.kind === 'none' && ed.tool === 'text' && !ed.followArmed && e.type === 'pointerup' && !(ed.pencilOnly && e.pointerType === 'touch')) {
        const v = getVideo();
        if (v && !v.paused) pause();
        const vp = toVideo(tRef.current, p.x, p.y);
        openTextEditor(vp.x, vp.y, null);
      }
      gesture.current = { kind: 'none' };
    }
  };

  // Stop recording if the component goes away mid-follow.
  useEffect(() => () => endFollow(), []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ---------- text labels (also marker / gap labels) ----------
  const [textEdit, setTextEdit] = useState<{ x: number; y: number; id: string | null } | null>(null);
  // Ref mirror: Enter commits and then blur fires — the ref makes sure we only commit once.
  const textEditRef = useRef(textEdit);

  /** Must run synchronously inside a user gesture so iPad shows the keyboard. */
  const openTextEditor = (vx: number, vy: number, id: string | null) => {
    const inp = textRef.current!;
    const ed = useEditor.getState();
    const existing = id ? ed.shapes.find((s) => s.id === id) : null;
    const sp = toScreen(tRef.current, vx, vy);
    inp.value = existing?.kind === 'text' ? existing.text : existing && 'label' in existing ? existing.label : '';
    inp.placeholder = existing && existing.kind !== 'text' ? 'Name / #' : 'Label…';
    inp.style.left = `${sp.x}px`;
    inp.style.top = `${sp.y}px`;
    inp.style.fontSize = `${Math.max(16, (existing?.kind === 'text' ? existing.fontSize : ed.fontSize) * tRef.current.scale)}px`;
    inp.style.color = existing?.color ?? ed.style.color;
    textEditRef.current = { x: vx, y: vy, id };
    inp.focus();
    setTextEdit(textEditRef.current);
  };

  const commitText = () => {
    const te = textEditRef.current;
    if (!te) return;
    textEditRef.current = null;
    const val = textRef.current!.value.trim();
    const ed = useEditor.getState();
    const existing = te.id ? ed.shapes.find((s) => s.id === te.id) : null;
    if (existing && existing.kind !== 'text') {
      ed.updateShape(existing.id, { label: val } as Partial<Shape>);
    } else if (existing) {
      if (val) ed.updateShape(existing.id, { text: val } as Partial<Shape>);
      else ed.deleteShape(existing.id);
    } else if (val) {
      const id = uid();
      ed.addShape({
        id, kind: 'text', layerId: ed.activeLayerId, ...ed.style, ...ed.timing,
        t: getVideo()?.currentTime ?? 0, x: te.x, y: te.y, text: val, fontSize: ed.fontSize,
      });
      ed.select(id, { justDrawn: true });
    }
    setTextEdit(null);
    textRef.current!.blur();
  };

  const editLabel = (id: string) => {
    const v = visibleRef.current.find((x) => x.raw.id === id);
    if (!v) return;
    const s = v.shape;
    if (s.kind === 'text') openTextEditor(s.x, s.y, id);
    else if (s.kind === 'marker') openTextEditor(s.x - 40 * unit, s.y + s.r * 0.5, id);
    else if (s.kind === 'gap') openTextEditor((s.points[0] + s.points[2]) / 2, (s.points[1] + s.points[3]) / 2, id);
  };

  // ---------- select-mode editing: move, transform, point handles ----------
  const selVis = selectedId ? visible.find((v) => v.raw.id === selectedId) : undefined;

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const useTr = tool === 'select' && !followArmed && selVis && TRANSFORMABLE.has(selVis.raw.kind);
    const node = useTr ? stageRef.current?.findOne((n: Konva.Node) => n.id() === selVis!.raw.id) : null;
    tr.nodes(node ? [node] : []);
    tr.keepRatio(selVis?.raw.kind === 'text' || selVis?.raw.kind === 'marker');
    tr.getLayer()?.batchDraw();
  }, [selVis?.raw, selVis?.shape, tool, followArmed]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Current track offset of a shape (0,0 if untracked). */
  const offNow = (s: Shape) => offsetAt(s.track, getVideo()?.currentTime ?? usePlayer.getState().currentTime);

  /** Moving a shape: tracked shapes get a keyframe at this moment; untracked shapes just move. */
  const moveShapeBy = (s: Shape, dx: number, dy: number) => {
    const ed = useEditor.getState();
    if (hasTrack(s)) {
      const o = offNow(s);
      const t = getVideo()?.currentTime ?? 0;
      ed.updateShape(s.id, { track: setKeyframe(s.track, { t, dx: o.dx + dx, dy: o.dy + dy }) }, { history: false });
    } else {
      const moved = isPath(s)
        ? { points: s.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) }
        : { x: (s as { x: number }).x + dx, y: (s as { y: number }).y + dy };
      ed.updateShape(s.id, moved as Partial<Shape>, { history: false });
    }
  };

  const onShapeDragEnd = (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const s = useEditor.getState().shapes.find((x) => x.id === id);
    const v = visibleRef.current.find((x) => x.raw.id === id);
    if (!s || !v) return;
    let dx: number, dy: number;
    if (isPath(s)) {
      dx = node.x(); dy = node.y();
      node.position({ x: 0, y: 0 }); // react-konva won't reset this for us (prop stays 0)
    } else {
      const eff = v.shape as { x: number; y: number };
      dx = node.x() - eff.x; dy = node.y() - eff.y;
    }
    // A gap line dragged as a whole detaches from its players.
    if (s.kind === 'gap' && (s.a || s.b)) {
      const g = v.shape as typeof s;
      useEditor.getState().updateShape(id, { a: null, b: null, points: g.points.map((p, i) => p + (i % 2 ? dy : dx)) } as Partial<Shape>, { history: false });
      return;
    }
    moveShapeBy(s, dx, dy);
  };

  const onTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const s = useEditor.getState().shapes.find((x) => x.id === node.id());
    if (!s) return;
    const sx = node.scaleX(), sy = node.scaleY();
    node.scale({ x: 1, y: 1 });
    const o = offNow(s);
    // Node position is where the shape is *now* (track applied); store it back in drawn coordinates.
    const bx = node.x() - o.dx, by = node.y() - o.dy;
    let patch: Partial<Shape> = {};
    if (s.kind === 'rect') patch = { x: bx, y: by, w: Math.max(2, s.w * sx), h: Math.max(2, s.h * sy) };
    else if (s.kind === 'ellipse' || s.kind === 'spotlight') patch = { x: bx, y: by, rx: Math.max(1, s.rx * sx), ry: Math.max(1, s.ry * sy) };
    else if (s.kind === 'text') patch = { x: bx, y: by, fontSize: Math.max(8, s.fontSize * sy) };
    else if (s.kind === 'marker') patch = { x: bx, y: by, r: Math.max(4, s.r * sx) } as Partial<Shape>;
    else if (s.kind === 'pen' || s.kind === 'trail') {
      const ox = node.x(), oy = node.y();
      node.position({ x: 0, y: 0 });
      patch = { points: s.points.map((v, i) => (i % 2 === 0 ? (v + o.dx) * sx + ox - o.dx : (v + o.dy) * sy + oy - o.dy)) };
    }
    useEditor.getState().updateShape(s.id, patch, { history: false });
  };

  /** Which points get draggable handles in Select mode. */
  const handleShape =
    tool === 'select' && !followArmed && selVis && !selVis.locked && isPath(selVis.raw) && !isStroke(selVis.raw) ? selVis
      : tool === 'select' && !followArmed && selVis && !selVis.locked && (selVis.raw.kind === 'line' || selVis.raw.kind === 'arrow' || selVis.raw.kind === 'curve') ? selVis
      : null;
  const handleIdx = handleShape
    ? handleShape.raw.kind === 'curve' ? [0, 2, 4]
      : handleShape.raw.kind === 'zone' ? (handleShape.shape as { points: number[] }).points.map((_, i) => i).filter((i) => i % 2 === 0)
      : [0, 2]
    : [];

  const onHandleMove = (i: number, x: number, y: number) => {
    const s = useEditor.getState().shapes.find((q) => q.id === handleShape!.raw.id);
    if (!s || !isPath(s)) return;
    const o = offNow(s);
    const pts = (handleShape!.shape as { points: number[] }).points.map((v, j) => v - (j % 2 ? o.dy : o.dx));
    pts[i] = x - o.dx;
    pts[i + 1] = y - o.dy;
    const patch: Partial<Shape> = { points: pts };
    // Dragging an attached gap end detaches it (or re-attaches to a player you drop it on).
    if (s.kind === 'gap') {
      const pl = findPlayer({ x, y });
      const end = i === 0 ? 'a' : 'b';
      const other = end === 'a' ? s.b : s.a;
      Object.assign(patch, { [end]: pl && pl.id !== other ? pl.id : null });
    }
    useEditor.getState().updateShape(s.id, patch, { history: false });
  };

  // ---------- spotlights + trails ----------
  const spots = spotRows(visible);
  const trails = visible.filter((v) => v.raw.showTrail && hasTrack(v.raw));

  const ed = useEditor.getState();
  const shapesListening = (tool === 'select' || tool === 'eraser' || TAP_TOOLS.has(tool)) && !followArmed;
  /** Select moves anything; the spotlight/marker tools can also grab their own kind. */
  const canGrab = (s: Shape) => !followArmed && (tool === 'select' || (TAP_TOOLS.has(tool) && s.kind === tool));
  const cursor = followArmed ? 'crosshair'
    : tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : tool === 'eraser' ? 'cell' : tool === 'text' ? 'text' : 'crosshair';

  return (
    <div
      ref={containerRef}
      className={'stage' + (followArmed ? ' following' : '')}
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
        style={{ width: videoW, height: videoH, transform: `translate(${T.tx}px, ${T.ty}px) scale(${T.scale})` }}
      />
      {size.w > 0 && (
        <Stage ref={stageRef} width={size.w} height={size.h} className="stage-canvas">
          {spots.length > 0 && (
            <KLayer listening={false}>
              <Group x={T.tx} y={T.ty} scaleX={T.scale} scaleY={T.scale}>
                <KShape
                  spots={spots}
                  sceneFunc={(kctx, node) => drawSpotlights(kctx, node.getAttr('spots'), videoW, videoH)}
                />
              </Group>
            </KLayer>
          )}
          <KLayer listening={shapesListening || !!handleShape}>
            <Group x={T.tx} y={T.ty} scaleX={T.scale} scaleY={T.scale}>
              {trails.map((v) => (
                <Line
                  key={'trail-' + v.raw.id}
                  points={trailPoints(v.raw, currentTime)}
                  stroke={v.raw.color}
                  strokeWidth={Math.max(3, v.raw.width * 0.6)}
                  dash={[10 * unit, 8 * unit]}
                  lineCap="round"
                  lineJoin="round"
                  opacity={0.75 * v.opacity}
                  listening={false}
                />
              ))}
              {visible.map(({ shape, raw, opacity, locked }) => (
                <ShapeNode
                  key={raw.id}
                  shape={shape}
                  opacity={opacity}
                  viewScale={T.scale}
                  now={raw.kind === 'trail' ? currentTime : undefined}
                  draggable={!locked && canGrab(raw)}
                  onSelect={!locked && canGrab(raw) ? ed.select : undefined}
                  onDragStart={ed.beginChange}
                  onDragEnd={onShapeDragEnd}
                  onTextEdit={tool === 'select' && !followArmed ? editLabel : undefined}
                />
              ))}
              {draft && <ShapeNode shape={draft} opacity={1} viewScale={T.scale} />}
              {handleShape &&
                handleIdx.map((i) => {
                  const pts = (handleShape.shape as { points: number[] }).points;
                  const attached = handleShape.raw.kind === 'gap' && (i === 0 ? handleShape.raw.a : handleShape.raw.b);
                  return (
                    <Circle
                      key={i}
                      x={pts[i]}
                      y={pts[i + 1]}
                      radius={11 / T.scale}
                      fill={attached ? '#34c759' : i === 2 && handleShape.raw.kind === 'curve' ? '#fff' : handleShape.raw.color}
                      stroke="#fff"
                      strokeWidth={2 / T.scale}
                      hitStrokeWidth={20 / T.scale}
                      draggable
                      onDragStart={ed.beginChange}
                      onDragMove={(e) => onHandleMove(i, e.target.x(), e.target.y())}
                    />
                  );
                })}
            </Group>
          </KLayer>
          <KLayer>
            <Transformer
              ref={trRef}
              rotateEnabled={false}
              flipEnabled={false}
              anchorSize={16}
              anchorCornerRadius={8}
              anchorStroke="#e0435c"
              borderStroke="#e0435c"
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
            textEditRef.current = null;
            setTextEdit(null);
            textRef.current!.blur();
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
      {followArmed && (
        <div className="follow-banner" onPointerDown={(e) => e.stopPropagation()}>
          <span className="rec-dot" />
          <span className="follow-text">
            <b>Follow:</b> hold the Pencil on the player. Video plays while you hold, pauses when you lift.
          </span>
          <select
            className="btn small"
            value={followRate}
            onChange={(e) => useEditor.getState().setHockey({ followRate: Number(e.target.value) })}
            aria-label="Follow speed"
          >
            {[0.1, 0.25, 0.5, 1].map((r) => (
              <option key={r} value={r}>{r}×</option>
            ))}
          </select>
          <button className="btn small primary" onClick={() => useEditor.getState().armFollow(false)}>
            <Icon name="close" size={16} /> Done
          </button>
        </div>
      )}
      {view.zoom > 1 && (
        <button className="zoom-badge" onPointerDown={(e) => e.stopPropagation()} onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>
          {view.zoom.toFixed(1)}× · reset
        </button>
      )}
      {pencilOnly && !followArmed && <div className="pencil-badge">✎ Pencil draws · fingers pan</div>}
    </div>
  );
}

/** Snap a line end to 15° increments (hold Shift). */
function snapAngle(a: Pt, b: Pt) {
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
