// Rink whiteboard: place skaters/puck/cones/nets, draw routes, step out a play, play it back.
// Draw a skate/carry route starting ON a player and he moves to the end of it in the next step;
// a pass/shot route starting at the puck moves the puck. Playback skates everyone along their routes.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Arrow, Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import type { BoardView, Drill, Piece, PieceKind, Route, RouteKind } from '../types';
import {
  PIECE_DEFAULTS, PIECE_R, RINK, ROUTE_INFO, VIEWS, addRoute, frameAt, movePiece, removePiece, smooth, wavy,
} from '../lib/board';
import { partialPath } from '../lib/track';
import { saveDrill } from '../db/db';
import { uid } from '../lib/util';
import { Icon } from './Icon';
import { ExportResult, type ExportFile } from './ExportResult';
import { pickVideoMime } from '../lib/exporter';
import { fileSafe } from '../lib/saveFile';

type BoardTool = 'move' | PieceKind | RouteKind | 'erase';

const PIECE_TOOLS: PieceKind[] = ['O', 'X', 'G', 'puck', 'cone', 'net', 'coach'];
const ROUTE_TOOLS: RouteKind[] = ['skate', 'carry', 'backward', 'pass', 'shot', 'line'];
const COLORS = ['#111827', '#1d4ed8', '#d62828', '#15803d', '#f97316', '#7c3aed'];
const ICE = '#f5f8fc';

export function Board({ initial, onExit }: { initial: Drill; onExit: () => void }) {
  const [d, setD] = useState<Drill>(initial);
  const [past, setPast] = useState<Drill[]>([]);
  const [future, setFuture] = useState<Drill[]>([]);
  const [tool, setTool] = useState<BoardTool>('move');
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState<{ type: 'piece' | 'route'; id: string } | null>(null);
  const [routeColor, setRouteColor] = useState('#111827');
  const [playing, setPlaying] = useState(false);
  const [tau, setTau] = useState<number | null>(null); // playback time; null = editing
  const [draft, setDraft] = useState<number[] | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [exportMenu, setExportMenu] = useState(false);
  const [exportFile, setExportFile] = useState<ExportFile | null>(null);
  const [recording, setRecording] = useState(false);
  const playingRef = useRef(false);

  /** Apply an undoable change. */
  const dRef = useRef(d);
  dRef.current = d;
  const commit = useCallback((next: Drill | ((x: Drill) => Drill)) => {
    const cur = dRef.current;
    const n = typeof next === 'function' ? next(cur) : next;
    if (n === cur) return;
    const stamped = { ...n, updatedAt: Date.now() };
    dRef.current = stamped;
    setPast((p) => [...p.slice(-99), cur]);
    setFuture([]);
    setD(stamped);
  }, []);
  const undo = () => { const prev = past[past.length - 1]; if (!prev) return; setFuture((f) => [d, ...f]); setPast((p) => p.slice(0, -1)); setD(prev); setSel(null); };
  const redo = () => { const nx = future[0]; if (!nx) return; setPast((p) => [...p, d]); setFuture((f) => f.slice(1)); setD(nx); setSel(null); };

  // ---- autosave ----
  const saveRef = useRef(d);
  saveRef.current = d;
  useEffect(() => {
    const t = setTimeout(() => saveDrill(d), 500);
    return () => clearTimeout(t);
  }, [d]);
  const exit = () => {
    // Fresh thumbnail of the current step for the drill card.
    const thumb = stageRef.current?.toDataURL({ pixelRatio: Math.min(1, 360 / (size.w || 360)), mimeType: 'image/jpeg', quality: 0.75 });
    saveDrill({ ...saveRef.current, thumb, updatedAt: Date.now() }).finally(onExit);
  };

  // ---- layout: feet <-> px ----
  useLayoutEffect(() => {
    const el = boxRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const v = VIEWS[d.view];
  const pad = 3;
  const s = Math.min(size.w / (v.x1 - v.x0 + pad * 2), size.h / (RINK.W + pad * 2)) || 1;
  const ox = (size.w - (v.x1 - v.x0) * s) / 2 - v.x0 * s;
  const oy = (size.h - RINK.W * s) / 2;
  const toFt = (px: number, py: number) => ({ x: (px - ox) / s, y: (py - oy) / s });

  playingRef.current = playing;
  // ---- playback ----
  const total = Math.max(0, (d.steps.length - 1) * d.stepTime);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTau((t) => {
        const n = (t ?? 0) + dt;
        if (n >= total) { setPlaying(false); return total; }
        return n;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);
  const play = () => {
    if (d.steps.length < 2) return;
    setSel(null);
    setTau((t) => (t === null || t >= total - 0.01 ? Math.min(step, d.steps.length - 2) * d.stepTime : t));
    setPlaying(true);
  };
  const stopPlayback = (toStep?: number) => {
    setPlaying(false);
    setTau(null);
    if (toStep !== undefined) setStep(toStep);
  };

  const frame = useMemo(() => (tau === null ? null : frameAt(d, tau)), [d, tau]);
  const showStep = frame ? frame.step : step;
  const positions = frame ? frame.pos : d.steps[step]?.pos ?? {};

  // ---- pointer input on the rink ----
  const drawing = useRef<number[] | null>(null);
  const isRouteTool = (ROUTE_TOOLS as string[]).includes(tool);

  const stagePos = () => stageRef.current!.getPointerPosition() ?? { x: 0, y: 0 };

  const onDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (tau !== null) stopPlayback(frame?.done ? d.steps.length - 1 : frame?.step);
    const p = toFt(stagePos().x, stagePos().y);
    if (isRouteTool) {
      drawing.current = [p.x, p.y];
      setDraft([p.x, p.y, p.x, p.y]);
      return;
    }
    const hitPiece = e.target.findAncestor('.piece', true);
    const hitRoute = e.target.findAncestor('.route', true);
    if (tool === 'erase') {
      if (hitPiece) commit((x) => removePiece(x, hitPiece.id()));
      else if (hitRoute) commit((x) => ({ ...x, steps: x.steps.map((st) => ({ ...st, routes: st.routes.filter((r) => r.id !== hitRoute.id()) })) }));
      setSel(null);
      return;
    }
    if (tool === 'move') {
      if (hitPiece) setSel({ type: 'piece', id: hitPiece.id() });
      else if (hitRoute) setSel({ type: 'route', id: hitRoute.id() });
      else setSel(null);
      return;
    }
    // Piece tools: tap on the ice to place one (in every step, same spot).
    if (hitPiece) { setSel({ type: 'piece', id: hitPiece.id() }); return; }
    const kind = tool as PieceKind;
    const def = PIECE_DEFAULTS[kind];
    const sameKind = d.pieces.filter((x) => x.kind === kind).length;
    const piece: Piece = { id: uid(), kind, color: def.color, label: kind === 'O' || kind === 'X' ? String(sameKind + 1) : def.label };
    commit((x) => ({
      ...x,
      pieces: [...x.pieces, piece],
      steps: x.steps.map((st) => ({ ...st, pos: { ...st.pos, [piece.id]: p } })),
    }));
    setSel({ type: 'piece', id: piece.id });
  };
  const onMove = () => {
    if (!drawing.current) return;
    const p = toFt(stagePos().x, stagePos().y);
    const pts = drawing.current;
    const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
    if (Math.hypot(p.x - lx, p.y - ly) < 0.6) return;
    pts.push(p.x, p.y);
    setDraft(pts.slice());
  };
  const onUp = () => {
    const pts = drawing.current;
    drawing.current = null;
    setDraft(null);
    if (!pts || pts.length < 4) return;
    const len = pts.reduce((acc, _, i) => (i >= 2 && i % 2 === 0 ? acc + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]) : acc), 0);
    if (len < 3) return;
    const kind = tool as RouteKind;
    // Passes and shots are straight; skating routes keep their shape.
    const clean = kind === 'pass' || kind === 'shot' ? [pts[0], pts[1], pts[pts.length - 2], pts[pts.length - 1]] : smooth(pts, 3);
    commit((x) => addRoute(x, step, kind, routeColor, clean));
  };

  const onPieceDragEnd = (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    const p = { x: e.target.x(), y: e.target.y() };
    commit((x) => movePiece(x, step, id, p));
  };

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (e.key === ' ') { e.preventDefault(); playing ? setPlaying(false) : play(); }
      else if (e.key === 'ArrowRight') { stopPlayback(); setStep((k) => Math.min(d.steps.length - 1, k + 1)); }
      else if (e.key === 'ArrowLeft') { stopPlayback(); setStep((k) => Math.max(0, k - 1)); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); deleteSel(); }
      else if (e.key === 'Escape') { if (sel) setSel(null); else exit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selPiece = sel?.type === 'piece' ? d.pieces.find((x) => x.id === sel.id) : undefined;
  const selRoute = sel?.type === 'route' ? d.steps[step]?.routes.find((r) => r.id === sel.id) : undefined;
  const deleteSel = () => {
    if (!sel) return;
    if (sel.type === 'piece') commit((x) => removePiece(x, sel.id));
    else commit((x) => ({ ...x, steps: x.steps.map((st) => ({ ...st, routes: st.routes.filter((r) => r.id !== sel.id) })) }));
    setSel(null);
  };
  const patchPiece = (p: Partial<Piece>) => selPiece && commit((x) => ({ ...x, pieces: x.pieces.map((q) => (q.id === selPiece.id ? { ...q, ...p } : q)) }));
  const patchRoute = (p: Partial<Route>) =>
    selRoute && commit((x) => ({ ...x, steps: x.steps.map((st) => ({ ...st, routes: st.routes.map((r) => (r.id === selRoute.id ? { ...r, ...p } : r)) })) }));

  const addStep = () => {
    stopPlayback();
    // Insert a new step after the current one, starting from the current positions.
    commit((x) => ({
      ...x,
      steps: [...x.steps.slice(0, step + 1), { id: uid(), pos: structuredClone(x.steps[step].pos), routes: [], note: '' }, ...x.steps.slice(step + 1)],
    }));
    setStep((k) => k + 1);
  };
  const deleteStep = () => {
    if (d.steps.length <= 1) return;
    stopPlayback();
    commit((x) => ({ ...x, steps: x.steps.filter((_, i) => i !== step) }));
    setStep((k) => Math.max(0, Math.min(k, d.steps.length - 2)));
  };

  // ---- exports ----
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const exportImage = async () => {
    setExportMenu(false);
    setSel(null);
    await nextFrame();
    const blob = await new Promise<Blob>((res, rej) =>
      stageRef.current!.toBlob({ pixelRatio: 2, mimeType: 'image/png', callback: (b) => (b ? res(b) : rej(new Error('Could not create image'))) }),
    );
    setExportFile({ blob, filename: `${fileSafe(d.name)} step ${(frame?.step ?? step) + 1}.png` });
  };
  const exportVideo = async () => {
    setExportMenu(false);
    const fmt = pickVideoMime();
    if (!fmt) return alert("This browser can't record video. Try Safari or Chrome.");
    if (d.steps.length < 2) return alert('Add at least 2 steps (draw a route from a player) to make a video.');
    setSel(null);
    setPlaying(false);
    setTau(0);
    setRecording(true);
    await nextFrame();
    const layer = stageRef.current!.getLayers()[0];
    const canvas = layer.getNativeCanvasElement();
    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
    // Hold a frame (keep repainting so the recorder gets frames), for `ms`.
    const holdFor = (ms: number) => new Promise<void>((r) => {
      const t0 = performance.now();
      const tick = () => { layer.draw(); if (performance.now() - t0 >= ms) r(); else requestAnimationFrame(tick); };
      tick();
    });
    rec.start(250);
    await holdFor(700);
    setPlaying(true);
    await new Promise<void>((r) => {
      const wait = () => (playingRef.current ? requestAnimationFrame(wait) : r()); // until playback finishes
      requestAnimationFrame(() => requestAnimationFrame(wait));
    });
    await holdFor(1200);
    rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    setRecording(false);
    setTau(null);
    setExportFile({ blob: new Blob(chunks, { type: fmt.mime.split(';')[0] }), filename: `${fileSafe(d.name)}.${fmt.ext}` });
  };

  const routesToShow = d.steps[showStep]?.routes ?? [];
  const prevRoutes = !frame && step > 0 ? d.steps[step - 1].routes : [];

  return (
    <div className="board">
      <header className="topbar">
        <button className="btn icon ghost" onClick={exit} aria-label="Back to drills"><Icon name="home" /></button>
        <input className="title-input" value={d.name} onChange={(e) => commit({ ...d, name: e.target.value })} aria-label="Drill name" />
        <div className="spacer" />
        <div className="seg compact">
          {(Object.keys(VIEWS) as BoardView[]).map((k) => (
            <button key={k} className={d.view === k ? 'active' : ''} onClick={() => commit({ ...d, view: k })}>{VIEWS[k].label}</button>
          ))}
        </div>
        <div className="menu-wrap">
          <button className="btn" onClick={() => setExportMenu((m) => !m)} disabled={recording}><Icon name="export" size={18} /> Export</button>
          {exportMenu && (
            <div className="menu" onMouseLeave={() => setExportMenu(false)}>
              <button onClick={exportImage}>Image of this step (PNG)</button>
              <button onClick={exportVideo}>Video of the play</button>
            </div>
          )}
        </div>
        <button className="btn icon ghost" onClick={undo} disabled={!past.length} aria-label="Undo"><Icon name="undo" /></button>
        <button className="btn icon ghost" onClick={redo} disabled={!future.length} aria-label="Redo"><Icon name="redo" /></button>
      </header>

      <div className="board-main">
        <nav className="toolbar board-tools">
          <div className="tool-group">
            <button className={'tool' + (tool === 'move' ? ' active' : '')} onClick={() => setTool('move')} title="Select / move"><Icon name="select" /></button>
            {PIECE_TOOLS.map((k) => (
              <button key={k} className={'tool' + (tool === k ? ' active' : '')} onClick={() => setTool(k)} title={PIECE_DEFAULTS[k].name}>
                <PieceGlyph kind={k} />
              </button>
            ))}
          </div>
          <div className="tool-group">
            {ROUTE_TOOLS.map((k) => (
              <button key={k} className={'tool' + (tool === k ? ' active' : '')} onClick={() => setTool(k)} title={ROUTE_INFO[k].name}>
                <RouteGlyph kind={k} />
              </button>
            ))}
            <button className={'tool' + (tool === 'erase' ? ' active' : '')} onClick={() => setTool('erase')} title="Eraser"><Icon name="eraser" /></button>
          </div>
        </nav>

        <div className="board-stage" ref={boxRef}>
          {size.w > 0 && (
            <Stage
              ref={stageRef}
              width={size.w}
              height={size.h}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              <Layer>
                {/* Solid background so exported images/videos aren't transparent around the rink. */}
                <Rect width={size.w} height={size.h} fill="#0f1722" listening={false} />
                <Group x={ox} y={oy} scaleX={s} scaleY={s}>
                  <RinkMarkings />
                  {prevRoutes.map((r) => <RouteNode key={'p' + r.id} r={r} opacity={0.22} />)}
                  {routesToShow.map((r) => (
                    <RouteNode
                      key={r.id}
                      r={r}
                      frac={frame && frame.step === showStep && !frame.done ? frame.u : 1}
                      selected={sel?.id === r.id}
                    />
                  ))}
                  {draft && <RouteNode r={{ id: 'draft', kind: tool as RouteKind, color: routeColor, points: draft }} />}
                  {d.pieces.map((pc) => {
                    const p = positions[pc.id];
                    if (!p) return null;
                    return (
                      <PieceNode
                        key={pc.id}
                        pc={pc}
                        x={p.x}
                        y={p.y}
                        selected={sel?.id === pc.id}
                        draggable={tool === 'move' && tau === null}
                        listening={!isRouteTool}
                        onDragEnd={(e) => onPieceDragEnd(pc.id, e)}
                      />
                    );
                  })}
                </Group>
                {/* Step note caption, drawn on the canvas so it's in exported videos too. */}
                {frame && d.steps[frame.step]?.note && (
                  <Group listening={false}>
                    <Rect x={0} y={size.h - 52} width={size.w} height={52} fill="rgba(10,14,20,0.82)" />
                    <Text x={12} y={size.h - 52} width={size.w - 24} height={52} text={d.steps[frame.step].note} align="center" verticalAlign="middle"
                      fontSize={20} fontStyle="bold" fill="#fff" fontFamily="system-ui, -apple-system, sans-serif" />
                  </Group>
                )}
              </Layer>
            </Stage>
          )}
          {recording && <div className="board-recording"><span className="rec-dot" /> Recording the play…</div>}
          {exportFile && <ExportResult file={exportFile} onClose={() => setExportFile(null)} />}
          {d.pieces.length === 0 && tau === null && (
            <div className="board-hint">Pick O / X on the left and tap the ice to place players. Then draw routes starting on a player to make him skate.</div>
          )}
        </div>
      </div>

      {(selPiece || selRoute) && tau === null && (
        <div className="board-props">
          {selPiece && (
            <>
              <strong>{PIECE_DEFAULTS[selPiece.kind].name}</strong>
              {selPiece.kind !== 'puck' && selPiece.kind !== 'cone' && selPiece.kind !== 'net' && (
                <input className="field small-field" value={selPiece.label} placeholder="#" maxLength={4} onChange={(e) => patchPiece({ label: e.target.value })} />
              )}
            </>
          )}
          {selRoute && <strong>{ROUTE_INFO[selRoute.kind].name}</strong>}
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                className={'swatch sm' + ((selPiece?.color ?? selRoute?.color) === c ? ' active' : '')}
                style={{ background: c }}
                onClick={() => (selPiece ? patchPiece({ color: c }) : patchRoute({ color: c }))}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
          <button className="btn danger" onClick={deleteSel}><Icon name="trash" size={16} /> Delete</button>
        </div>
      )}
      {isRouteTool && !sel && (
        <div className="board-props">
          <strong>{ROUTE_INFO[tool as RouteKind].name}</strong>
          <span className="dim small">
            {ROUTE_INFO[tool as RouteKind].moves === 'piece' ? 'Start on a player — he skates it in the next step.'
              : ROUTE_INFO[tool as RouteKind].moves === 'puck' ? 'Start at the puck — it moves in the next step.' : 'Just a line.'}
          </span>
          <div className="swatches">
            {COLORS.map((c) => (
              <button key={c} className={'swatch sm' + (routeColor === c ? ' active' : '')} style={{ background: c }} onClick={() => setRouteColor(c)} aria-label={`Color ${c}`} />
            ))}
          </div>
        </div>
      )}

      <footer className="board-steps">
        <button className="btn icon play" onClick={() => (playing ? setPlaying(false) : play())} disabled={d.steps.length < 2} aria-label="Play">
          <Icon name={playing ? 'pause' : 'play'} size={24} />
        </button>
        <div className="steps-row">
          {d.steps.map((st, i) => (
            <button
              key={st.id}
              className={'step-chip' + ((frame ? frame.step === i : step === i) ? ' active' : '')}
              onClick={() => { stopPlayback(i); setSel(null); }}
            >
              {i + 1}
            </button>
          ))}
          <button className="step-chip add" onClick={addStep} aria-label="Add step"><Icon name="plus" size={16} /></button>
        </div>
        {tau !== null && (
          <input
            className="tau"
            type="range"
            min={0}
            max={total}
            step={0.01}
            value={tau}
            onChange={(e) => { setPlaying(false); setTau(Number(e.target.value)); }}
            aria-label="Playback position"
          />
        )}
        {tau === null && (
          <input
            className="field step-note"
            placeholder={`Step ${step + 1} note (shows during playback)`}
            value={d.steps[step]?.note ?? ''}
            onChange={(e) => commit({ ...d, steps: d.steps.map((st, i) => (i === step ? { ...st, note: e.target.value } : st)) })}
          />
        )}
        <select className="btn small" value={d.stepTime} onChange={(e) => commit({ ...d, stepTime: Number(e.target.value) })} aria-label="Seconds per step">
          {[0.8, 1.2, 1.6, 2.2, 3].map((t) => <option key={t} value={t}>{t}s / step</option>)}
        </select>
        <button className="btn small danger" onClick={deleteStep} disabled={d.steps.length <= 1}>Delete step</button>
      </footer>
    </div>
  );
}

// ---------------- rink + pieces + routes ----------------

function RinkMarkings() {
  const { L, W, corner, goal, blue } = RINK;
  const cy = W / 2;
  const red = '#d62828', bl = '#1d4ed8';
  const circles = [[31, cy - 22], [31, cy + 22], [169, cy - 22], [169, cy + 22]];
  const nzDots = [[80, cy - 22], [80, cy + 22], [120, cy - 22], [120, cy + 22]];
  return (
    <Group listening={false}>
      <Rect width={L} height={W} cornerRadius={corner} fill={ICE} stroke="#1f2937" strokeWidth={0.9} />
      <Group clipFunc={(ctx) => roundRectPath(ctx, 0, 0, L, W, corner)}>
        {[goal, L - goal].map((x) => <Line key={x} points={[x, 0, x, W]} stroke={red} strokeWidth={0.35} />)}
        {[blue, L - blue].map((x) => <Rect key={x} x={x - 0.5} y={0} width={1} height={W} fill={bl} />)}
        <Rect x={L / 2 - 0.5} y={0} width={1} height={W} fill={red} />
        <Circle x={L / 2} y={cy} radius={15} stroke={bl} strokeWidth={0.35} />
        <Circle x={L / 2} y={cy} radius={0.6} fill={bl} />
        {circles.map(([x, y]) => (
          <Group key={`${x}-${y}`}>
            <Circle x={x} y={y} radius={15} stroke={red} strokeWidth={0.35} />
            <Circle x={x} y={y} radius={1} fill={red} />
          </Group>
        ))}
        {nzDots.map(([x, y]) => <Circle key={`${x}-${y}`} x={x} y={y} radius={1} fill={red} />)}
        {/* creases + nets */}
        {[[goal, 1], [L - goal, -1]].map(([x, dir]) => (
          <Group key={x}>
            <Line points={[x, cy - 4, x + dir * 4.5, cy - 4, x + dir * 6, cy, x + dir * 4.5, cy + 4, x, cy + 4]} closed fill="#bfdbfe" stroke={red} strokeWidth={0.3} tension={0.3} />
            <Rect x={dir === 1 ? x - 3.4 : x} y={cy - 3} width={3.4} height={6} stroke={red} strokeWidth={0.45} cornerRadius={1} />
          </Group>
        ))}
      </Group>
    </Group>
  );
}

function roundRectPath(ctx: Konva.Context, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function PieceNode({ pc, x, y, selected, draggable, listening, onDragEnd }: {
  pc: Piece; x: number; y: number; selected: boolean; draggable: boolean; listening: boolean;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
}) {
  const r = PIECE_R;
  const ring = selected ? <Circle radius={r + 1.3} stroke="#f59e0b" strokeWidth={0.5} dash={[1, 0.6]} /> : null;
  const common = { id: pc.id, name: 'piece', x, y, draggable, listening, onDragEnd };
  const label = (fill: string, size = 2.6) => (
    <Text text={pc.label} width={r * 2} height={r * 2} offsetX={r} offsetY={r} align="center" verticalAlign="middle" fontSize={size} fontStyle="bold" fill={fill} listening={false} />
  );
  switch (pc.kind) {
    case 'O':
      return <Group {...common}>{ring}<Circle radius={r} fill="#fff" stroke={pc.color} strokeWidth={0.7} hitStrokeWidth={3} />{label(pc.color)}</Group>;
    case 'X':
      return (
        <Group {...common}>
          {ring}
          <Circle radius={r} fill="rgba(0,0,0,0.001)" />
          <Line points={[-r * 0.8, -r * 0.8, r * 0.8, r * 0.8]} stroke={pc.color} strokeWidth={0.8} lineCap="round" />
          <Line points={[-r * 0.8, r * 0.8, r * 0.8, -r * 0.8]} stroke={pc.color} strokeWidth={0.8} lineCap="round" />
          {pc.label && <Text text={pc.label} x={r * 0.7} y={-r * 1.5} fontSize={2.2} fontStyle="bold" fill={pc.color} listening={false} />}
        </Group>
      );
    case 'G':
      return <Group {...common}>{ring}<Circle radius={r} fill={pc.color} />{label('#fff')}</Group>;
    case 'coach':
      return <Group {...common}>{ring}<Rect x={-r} y={-r} width={r * 2} height={r * 2} cornerRadius={0.6} fill={pc.color} />{label('#fff')}</Group>;
    case 'puck':
      return <Group {...common}>{ring}<Circle radius={0.9} fill={pc.color} hitStrokeWidth={4} stroke="rgba(0,0,0,0.001)" strokeWidth={0.1} /></Group>;
    case 'cone':
      return <Group {...common}>{ring}<Line points={[0, -1.6, 1.5, 1.2, -1.5, 1.2]} closed fill={pc.color} stroke="#9a3412" strokeWidth={0.2} /></Group>;
    case 'net':
      return (
        <Group {...common}>
          {ring}
          <Rect x={-2} y={-3} width={4} height={6} cornerRadius={1.2} stroke={pc.color} strokeWidth={0.5} fill="rgba(214,40,40,0.08)" />
          <Line points={[-1, -3, -1, 3, 0, -3, 0, 3, 1, -3, 1, 3]} stroke={pc.color} strokeWidth={0.1} opacity={0.6} />
        </Group>
      );
  }
}

function RouteNode({ r, frac = 1, opacity = 1, selected }: { r: Route; frac?: number; opacity?: number; selected?: boolean }) {
  const pts = frac < 1 ? partialPath(r.points, frac) : r.points;
  if (pts.length < 4) return null;
  const w = 0.5;
  const head = 2.2;
  const common = { id: r.id, name: 'route', opacity, hitStrokeWidth: 3, lineCap: 'round' as const, lineJoin: 'round' as const };
  const sel = selected ? <Line points={pts} stroke="#f59e0b" strokeWidth={2.2} opacity={0.35} lineCap="round" lineJoin="round" listening={false} /> : null;
  switch (r.kind) {
    case 'carry':
      return <Group>{sel}<Arrow {...common} points={wavy(pts)} stroke={r.color} fill={r.color} strokeWidth={w} pointerLength={head} pointerWidth={head} /></Group>;
    case 'pass':
      return <Group>{sel}<Arrow {...common} points={pts} stroke={r.color} fill={r.color} strokeWidth={w} dash={[1.6, 1.1]} pointerLength={head} pointerWidth={head} /></Group>;
    case 'shot':
      return (
        <Group>
          {sel}
          <Arrow {...common} points={pts} stroke={r.color} fill={r.color} strokeWidth={1.4} pointerLength={head * 1.3} pointerWidth={head * 1.5} />
          <Line points={pts.slice(0, -2).length >= 4 ? pts.slice(0, -2) : pts} stroke={ICE} strokeWidth={0.45} listening={false} />
        </Group>
      );
    case 'backward': {
      // Skating backward: line with small cross-ticks.
      const ticks: number[][] = [];
      for (let f = 0.12; f < 0.9; f += 0.12) {
        const a = partialPath(pts, f);
        const x = a[a.length - 2], y = a[a.length - 1];
        const b = partialPath(pts, Math.min(1, f + 0.02));
        const dx = b[b.length - 2] - x, dy = b[b.length - 1] - y;
        const l = Math.hypot(dx, dy) || 1;
        ticks.push([x - (dy / l) * 1.1, y + (dx / l) * 1.1, x + (dy / l) * 1.1, y - (dx / l) * 1.1]);
      }
      return (
        <Group>
          {sel}
          <Arrow {...common} points={pts} stroke={r.color} fill={r.color} strokeWidth={w} pointerLength={head} pointerWidth={head} />
          {frac >= 1 && ticks.map((t, i) => <Line key={i} points={t} stroke={r.color} strokeWidth={0.35} listening={false} />)}
        </Group>
      );
    }
    case 'line':
      return <Group>{sel}<Line {...common} points={pts} stroke={r.color} strokeWidth={w} /></Group>;
    default:
      return <Group>{sel}<Arrow {...common} points={pts} stroke={r.color} fill={r.color} strokeWidth={w} pointerLength={head} pointerWidth={head} /></Group>;
  }
}

// ---------------- toolbar glyphs ----------------

function PieceGlyph({ kind }: { kind: PieceKind }) {
  const c = PIECE_DEFAULTS[kind].color;
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
      {kind === 'O' && <circle cx="12" cy="12" r="8" fill="none" stroke="#60a5fa" strokeWidth="2.5" />}
      {kind === 'X' && <path d="M6 6l12 12M18 6L6 18" stroke="#f87171" strokeWidth="3" strokeLinecap="round" />}
      {kind === 'G' && <><circle cx="12" cy="12" r="9" fill="#e5e7eb" /><text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="#111">G</text></>}
      {kind === 'coach' && <><rect x="3" y="3" width="18" height="18" rx="3" fill="#22c55e" /><text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">C</text></>}
      {kind === 'puck' && <ellipse cx="12" cy="13" rx="7" ry="4" fill="#e5e7eb" />}
      {kind === 'cone' && <path d="M12 4l7 15H5z" fill={c} />}
      {kind === 'net' && <rect x="6" y="5" width="12" height="14" rx="3" fill="none" stroke="#f87171" strokeWidth="2.5" />}
    </svg>
  );
}

function RouteGlyph({ kind }: { kind: RouteKind }) {
  const st = { stroke: 'currentColor', strokeWidth: 2.2, fill: 'none', strokeLinecap: 'round' as const };
  const arrow = <path d="M15 5h5v5" {...st} />;
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
      {kind === 'skate' && <><path d="M4 20L20 5" {...st} />{arrow}</>}
      {kind === 'carry' && <><path d="M4 20c2-1 1-4 3-5s3 1 5-1 1-4 3-5 3 0 5-4" {...st} />{arrow}</>}
      {kind === 'backward' && <><path d="M4 20L20 5M7 14l3 3M11 10l3 3" {...st} />{arrow}</>}
      {kind === 'pass' && <><path d="M4 20L20 5" {...st} strokeDasharray="3 3" />{arrow}</>}
      {kind === 'shot' && <><path d="M3 18L18 5M6 21L21 8" {...st} /><path d="M16 3h6v6" {...st} /></>}
      {kind === 'line' && <path d="M4 20L20 4" {...st} />}
    </svg>
  );
}
