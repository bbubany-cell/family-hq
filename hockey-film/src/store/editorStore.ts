// Editor state: the open project's annotations, layers, tool/style, selection and undo history.
import { create } from 'zustand';
import type { Layer, Project, Shape, ShapeStyle, ShapeTiming, Team, Tool, ZonePreset } from '../types';
import { uid } from '../lib/util';

interface Snapshot {
  shapes: Shape[];
  layers: Layer[];
  stops: number[];
}

const HISTORY_LIMIT = 150;

export interface EditorState {
  project: Project | null;
  shapes: Shape[];
  layers: Layer[];
  activeLayerId: string;

  tool: Tool;
  /** Last drawing tool used, so "D" can toggle back to it. */
  lastDrawTool: Tool;
  style: ShapeStyle;
  /** Timing applied to new shapes (start time comes from the video). */
  timing: Omit<ShapeTiming, 't'>;
  fontSize: number;
  selectedId: string | null;
  /**
   * True when the selection is the drawing you just made (auto-selected). Panel changes then apply to it
   * AND become the defaults for your next drawings. A drawing you deliberately select only changes itself.
   */
  justDrawn: boolean;
  /** iPad: when true, Apple Pencil draws and fingers only pan/zoom. */
  pencilOnly: boolean;

  // ---- Phase 2 hockey tool settings ----
  markerTeam: Team;
  markerVariant: 'ring' | 'dot';
  teamColors: Record<Team, string>;
  zonePreset: ZonePreset;
  spotlightDim: number;
  trailReveal: number;
  /** "Follow with Pencil" armed for the selected shape: next press on the video records its path. */
  followArmed: boolean;
  /** Playback speed while recording a follow. */
  followRate: number;
  /** Teaching stops (video times). */
  stops: number[];

  past: Snapshot[];
  future: Snapshot[];
  /** Used to merge rapid edits (slider drags) into one undo step. */
  lastCoalesce: { key: string; at: number } | null;

  /** Bumped on every content change; autosave watches this. */
  rev: number;

  loadProject: (p: Project) => void;
  closeProject: () => void;
  setTool: (t: Tool) => void;
  toggleDraw: () => void;
  setStyle: (s: Partial<ShapeStyle>) => void;
  setTiming: (t: Partial<Omit<ShapeTiming, 't'>>) => void;
  setFontSize: (n: number) => void;
  setPencilOnly: (b: boolean) => void;
  setHockey: (p: Partial<Pick<EditorState, 'markerTeam' | 'markerVariant' | 'zonePreset' | 'spotlightDim' | 'trailReveal' | 'followRate' | 'teamColors'>>) => void;
  armFollow: (on: boolean) => void;
  /** Change a team's color and recolor all of that team's markers (one undo step). */
  recolorTeam: (team: Team, color: string) => void;
  toggleStop: (t: number) => void;
  select: (id: string | null, opts?: { justDrawn?: boolean }) => void;

  addShape: (s: Shape) => void;
  /** Patch one shape. `coalesce` merges repeated patches with the same key into one undo step. */
  updateShape: (id: string, patch: Partial<Shape>, opts?: { coalesce?: string; history?: boolean }) => void;
  /** Push current state to history before a live (multi-event) edit like dragging a handle. */
  beginChange: () => void;
  deleteShape: (id: string) => void;
  deleteSelected: () => void;
  clearAll: (onlyAtTime?: (s: Shape) => boolean) => void;
  undo: () => void;
  redo: () => void;

  addLayer: () => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  deleteLayer: (id: string) => void;
  setActiveLayer: (id: string) => void;
  moveShapeToLayer: (shapeId: string, layerId: string) => void;
}

// Default "on screen for" timing is remembered on this device between sessions.
const TIMING_KEY = 'filmroom.timing';
function loadTiming(): Omit<ShapeTiming, 't'> {
  const fallback = { hold: 3, fadeIn: 0, fadeOut: 0.5 };
  try {
    const v = JSON.parse(localStorage.getItem(TIMING_KEY) ?? 'null');
    if (v && (v.hold === null || typeof v.hold === 'number') && typeof v.fadeIn === 'number' && typeof v.fadeOut === 'number') return v;
  } catch { /* unavailable */ }
  return fallback;
}
function saveTiming(t: Omit<ShapeTiming, 't'>) {
  try { localStorage.setItem(TIMING_KEY, JSON.stringify(t)); } catch { /* private mode */ }
}

export const DEFAULT_COLORS = ['#ffd60a', '#ff3b30', '#b3263f', '#2f81f7', '#34c759', '#ffffff', '#ff9500', '#000000'];

export const useEditor = create<EditorState>((set, get) => {
  /** Record an undoable change. */
  const commit = (next: Partial<Snapshot>, extra: Partial<EditorState> = {}) => {
    const { shapes, layers, stops, past, rev } = get();
    set({
      past: [...past, { shapes, layers, stops }].slice(-HISTORY_LIMIT),
      future: [],
      lastCoalesce: null,
      rev: rev + 1,
      ...next,
      ...extra,
    });
  };

  return {
    project: null,
    shapes: [],
    layers: [],
    activeLayerId: '',
    tool: 'pen',
    lastDrawTool: 'pen',
    style: { color: '#ffd60a', width: 6, dashed: false },
    timing: loadTiming(),
    fontSize: 42,
    selectedId: null,
    justDrawn: false,
    pencilOnly: false,
    markerTeam: 'us',
    markerVariant: 'ring',
    teamColors: { us: '#b3263f', them: '#2f81f7' }, // us = Anoka maroon, them = blue
    zonePreset: 'slot',
    spotlightDim: 0.6,
    trailReveal: 2,
    followArmed: false,
    followRate: 0.25,
    stops: [],
    past: [],
    future: [],
    lastCoalesce: null,
    rev: 0,

    loadProject: (p) =>
      set({
        project: p,
        shapes: p.shapes,
        layers: p.layers,
        activeLayerId: p.activeLayerId,
        stops: p.stops ?? [],
        followArmed: false,
        selectedId: null,
        justDrawn: false,
        past: [],
        future: [],
        rev: 0,
      }),
    closeProject: () => set({ project: null, shapes: [], layers: [], stops: [], selectedId: null, followArmed: false, past: [], future: [] }),

    setTool: (tool) =>
      set((s) => ({
        tool,
        lastDrawTool: tool !== 'select' && tool !== 'hand' && tool !== 'eraser' ? tool : s.lastDrawTool,
        selectedId: tool === 'select' ? s.selectedId : null,
        followArmed: tool === 'select' ? s.followArmed : false,
      })),
    toggleDraw: () => {
      const { tool, lastDrawTool } = get();
      get().setTool(tool === 'select' || tool === 'hand' ? lastDrawTool : 'select');
    },
    // Panel edits: nothing selected → defaults for new drawings; just drawn → that drawing + defaults;
    // deliberately selected → only that drawing (your defaults stay put).
    // Color is the exception: right after drawing, a new color is for your NEXT drawings only
    // (the one you just drew keeps its color). Select a drawing deliberately to recolor it.
    setStyle: (style) => {
      const { selectedId: id, justDrawn } = get();
      if (!id || justDrawn) set((s) => ({ style: { ...s.style, ...style } }));
      const patch: Partial<ShapeStyle> = { ...style };
      if (justDrawn) delete patch.color;
      if (id && Object.keys(patch).length) get().updateShape(id, patch as Partial<Shape>, { coalesce: 'style:' + Object.keys(patch).join() });
    },
    setTiming: (timing) => {
      const { selectedId: id, justDrawn } = get();
      if (!id || justDrawn) {
        set((s) => ({ timing: { ...s.timing, ...timing } }));
        saveTiming(get().timing);
      }
      if (id) get().updateShape(id, timing as Partial<Shape>, { coalesce: 'timing:' + Object.keys(timing).join() });
    },
    setFontSize: (fontSize) => {
      const { selectedId: id, justDrawn } = get();
      if (!id || justDrawn) set({ fontSize });
      const sel = get().shapes.find((s) => s.id === id);
      if (sel?.kind === 'text') get().updateShape(sel.id, { fontSize } as Partial<Shape>, { coalesce: 'font' });
    },
    setPencilOnly: (pencilOnly) => set({ pencilOnly }),
    setHockey: (p) => set(p),
    recolorTeam: (team, color) => {
      set({ teamColors: { ...get().teamColors, [team]: color } });
      commit({ shapes: get().shapes.map((x) => (x.kind === 'marker' && x.team === team ? { ...x, color } : x)) });
    },
    armFollow: (on) => set({ followArmed: on && !!get().selectedId }),
    toggleStop: (t) => {
      const { stops } = get();
      const near = stops.findIndex((x) => Math.abs(x - t) < 0.15);
      commit({ stops: near >= 0 ? stops.filter((_, i) => i !== near) : [...stops, t].sort((a, b) => a - b) });
    },
    // Selecting never touches your defaults; the panel just shows the selected drawing's own values.
    select: (selectedId, opts) =>
      set({
        selectedId,
        justDrawn: !!selectedId && !!opts?.justDrawn,
        followArmed: selectedId ? get().followArmed && selectedId === get().selectedId : false,
      }),

    addShape: (shape) => commit({ shapes: [...get().shapes, shape] }),

    updateShape: (id, patch, opts = {}) => {
      const { shapes, lastCoalesce, rev } = get();
      const now = Date.now();
      const key = opts.coalesce ? id + opts.coalesce : null;
      const merge = opts.history === false || (key && lastCoalesce?.key === key && now - lastCoalesce.at < 800);
      const next = shapes.map((s) => (s.id === id ? ({ ...s, ...patch } as Shape) : s));
      if (merge) {
        set({ shapes: next, rev: rev + 1, lastCoalesce: key ? { key, at: now } : lastCoalesce });
      } else {
        commit({ shapes: next }, key ? { lastCoalesce: { key, at: now } } : {});
      }
    },

    beginChange: () => {
      const { shapes, layers, stops, past } = get();
      set({ past: [...past, { shapes, layers, stops }].slice(-HISTORY_LIMIT), future: [], lastCoalesce: null });
    },

    deleteShape: (id) =>
      commit(
        {
          shapes: get()
            .shapes.filter((s) => s.id !== id)
            // Gap lines attached to a deleted player keep their last position instead of breaking.
            .map((s) => (s.kind === 'gap' && (s.a === id || s.b === id) ? { ...s, a: s.a === id ? null : s.a, b: s.b === id ? null : s.b } : s)),
        },
        get().selectedId === id ? { selectedId: null, followArmed: false } : {},
      ),
    deleteSelected: () => {
      const id = get().selectedId;
      if (id) get().deleteShape(id);
    },
    clearAll: (filter) => {
      const keep = filter ? get().shapes.filter((s) => !filter(s)) : [];
      if (keep.length !== get().shapes.length) commit({ shapes: keep }, { selectedId: null });
    },

    undo: () => {
      const { past, future, shapes, layers, stops, rev } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      set({
        ...prev,
        past: past.slice(0, -1),
        future: [{ shapes, layers, stops }, ...future],
        selectedId: null,
        lastCoalesce: null,
        rev: rev + 1,
      });
    },
    redo: () => {
      const { past, future, shapes, layers, stops, rev } = get();
      const next = future[0];
      if (!next) return;
      set({ ...next, past: [...past, { shapes, layers, stops }], future: future.slice(1), selectedId: null, rev: rev + 1 });
    },

    addLayer: () => {
      const layer: Layer = { id: uid(), name: `Layer ${get().layers.length + 1}`, visible: true, locked: false };
      commit({ layers: [...get().layers, layer] }, { activeLayerId: layer.id });
    },
    updateLayer: (id, patch) => commit({ layers: get().layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }),
    deleteLayer: (id) => {
      const { layers, shapes, activeLayerId } = get();
      if (layers.length <= 1) return;
      const rest = layers.filter((l) => l.id !== id);
      commit(
        { layers: rest, shapes: shapes.filter((s) => s.layerId !== id) },
        { activeLayerId: activeLayerId === id ? rest[rest.length - 1].id : activeLayerId, selectedId: null },
      );
    },
    setActiveLayer: (activeLayerId) => set({ activeLayerId, rev: get().rev + 1 }),
    moveShapeToLayer: (shapeId, layerId) =>
      commit({ shapes: get().shapes.map((s) => (s.id === shapeId ? { ...s, layerId } : s)) }),
  };
});
