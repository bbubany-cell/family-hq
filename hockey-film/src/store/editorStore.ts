// Editor state: the open project's annotations, layers, tool/style, selection and undo history.
import { create } from 'zustand';
import type { Layer, Project, Shape, ShapeStyle, ShapeTiming, Tool } from '../types';
import { uid } from '../lib/util';

interface Snapshot {
  shapes: Shape[];
  layers: Layer[];
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
  /** iPad: when true, Apple Pencil draws and fingers only pan/zoom. */
  pencilOnly: boolean;

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
  select: (id: string | null) => void;

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

export const DEFAULT_COLORS = ['#ffd60a', '#ff3b30', '#2f81f7', '#34c759', '#ffffff', '#ff9500', '#bf5af2', '#000000'];

export const useEditor = create<EditorState>((set, get) => {
  /** Record an undoable change. */
  const commit = (next: Partial<Snapshot>, extra: Partial<EditorState> = {}) => {
    const { shapes, layers, past, rev } = get();
    set({
      past: [...past, { shapes, layers }].slice(-HISTORY_LIMIT),
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
    timing: { hold: 3, fadeIn: 0, fadeOut: 0.5 },
    fontSize: 42,
    selectedId: null,
    pencilOnly: false,
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
        selectedId: null,
        past: [],
        future: [],
        rev: 0,
      }),
    closeProject: () => set({ project: null, shapes: [], layers: [], selectedId: null, past: [], future: [] }),

    setTool: (tool) =>
      set((s) => ({
        tool,
        lastDrawTool: tool !== 'select' && tool !== 'hand' && tool !== 'eraser' ? tool : s.lastDrawTool,
        selectedId: tool === 'select' ? s.selectedId : null,
      })),
    toggleDraw: () => {
      const { tool, lastDrawTool } = get();
      get().setTool(tool === 'select' || tool === 'hand' ? lastDrawTool : 'select');
    },
    setStyle: (style) => {
      set((s) => ({ style: { ...s.style, ...style } }));
      const id = get().selectedId;
      if (id) get().updateShape(id, style as Partial<Shape>, { coalesce: 'style:' + Object.keys(style).join() });
    },
    setTiming: (timing) => {
      set((s) => ({ timing: { ...s.timing, ...timing } }));
      const id = get().selectedId;
      if (id) get().updateShape(id, timing as Partial<Shape>, { coalesce: 'timing:' + Object.keys(timing).join() });
    },
    setFontSize: (fontSize) => {
      set({ fontSize });
      const sel = get().shapes.find((s) => s.id === get().selectedId);
      if (sel?.kind === 'text') get().updateShape(sel.id, { fontSize } as Partial<Shape>, { coalesce: 'font' });
    },
    setPencilOnly: (pencilOnly) => set({ pencilOnly }),
    select: (selectedId) => {
      set({ selectedId });
      // Reflect the selected shape's style in the panel so tweaks start from its values.
      const s = get().shapes.find((x) => x.id === selectedId);
      if (s) {
        set({
          style: { color: s.color, width: s.width, dashed: s.dashed },
          timing: { hold: s.hold, fadeIn: s.fadeIn, fadeOut: s.fadeOut },
          ...(s.kind === 'text' ? { fontSize: s.fontSize } : {}),
        });
      }
    },

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
      const { shapes, layers, past } = get();
      set({ past: [...past, { shapes, layers }].slice(-HISTORY_LIMIT), future: [], lastCoalesce: null });
    },

    deleteShape: (id) =>
      commit({ shapes: get().shapes.filter((s) => s.id !== id) }, get().selectedId === id ? { selectedId: null } : {}),
    deleteSelected: () => {
      const id = get().selectedId;
      if (id) get().deleteShape(id);
    },
    clearAll: (filter) => {
      const keep = filter ? get().shapes.filter((s) => !filter(s)) : [];
      if (keep.length !== get().shapes.length) commit({ shapes: keep }, { selectedId: null });
    },

    undo: () => {
      const { past, future, shapes, layers, rev } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      set({
        ...prev,
        past: past.slice(0, -1),
        future: [{ shapes, layers }, ...future],
        selectedId: null,
        lastCoalesce: null,
        rev: rev + 1,
      });
    },
    redo: () => {
      const { past, future, shapes, layers, rev } = get();
      const next = future[0];
      if (!next) return;
      set({ ...next, past: [...past, { shapes, layers }], future: future.slice(1), selectedId: null, rev: rev + 1 });
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
