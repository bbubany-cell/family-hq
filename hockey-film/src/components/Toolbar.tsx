// Left tool rail (becomes a horizontal strip on narrow/portrait screens).
import { useLayoutEffect, useRef, useState } from 'react';
import { useEditor } from '../store/editorStore';
import type { Tool } from '../types';
import { Icon } from './Icon';

export const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'select', label: 'Select / move', key: 'V' },
  { id: 'hand', label: 'Pan', key: 'H' },
  { id: 'pen', label: 'Pen', key: 'P' },
  { id: 'line', label: 'Line', key: 'N' },
  { id: 'arrow', label: 'Arrow', key: 'A' },
  { id: 'curve', label: 'Curved arrow (sketch the bend)', key: 'C' },
  { id: 'ellipse', label: 'Circle / ellipse', key: 'E' },
  { id: 'rect', label: 'Rectangle', key: 'R' },
  { id: 'text', label: 'Text label', key: 'T' },
  { id: 'eraser', label: 'Eraser', key: 'X' },
];

/** Phase 2 hockey tools. */
export const HOCKEY_TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'spotlight', label: 'Spotlight a player', key: 'S' },
  { id: 'marker', label: 'Player marker (ring / numbered dot)', key: 'M' },
  { id: 'trail', label: 'Trail: route that draws itself on', key: 'W' },
  { id: 'zone', label: 'Zone shading', key: 'Z' },
  { id: 'gap', label: 'Gap line between players', key: 'G' },
];

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);

  // Basic tools in one group, hockey tools + undo/redo in another. Stacked in one column when
  // the screen is tall enough, side by side (two columns) when it isn't (e.g. iPad landscape).
  const navRef = useRef<HTMLElement>(null);
  const [twoCol, setTwoCol] = useState(false);
  useLayoutEffect(() => {
    const el = navRef.current!;
    const total = TOOLS.length + HOCKEY_TOOLS.length + 2; // + undo/redo
    const ro = new ResizeObserver(() => setTwoCol(el.clientHeight < total * 52 + 40));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const btn = (t: { id: Tool; label: string; key: string }) => (
    <button
      key={t.id}
      className={'tool' + (tool === t.id ? ' active' : '')}
      title={`${t.label} (${t.key})`}
      aria-label={t.label}
      onClick={() => setTool(t.id)}
    >
      <Icon name={t.id} />
    </button>
  );

  return (
    <nav className={'toolbar' + (twoCol ? ' two-col' : '')} ref={navRef}>
      <div className="tool-group">{TOOLS.map(btn)}</div>
      <div className="tool-group">
        <div className="toolbar-sep" />
        {HOCKEY_TOOLS.map(btn)}
        <div className="toolbar-sep" />
        <button className="tool" title="Undo (Ctrl/Cmd+Z)" disabled={!canUndo} onClick={undo}>
          <Icon name="undo" />
        </button>
        <button className="tool" title="Redo (Shift+Ctrl/Cmd+Z)" disabled={!canRedo} onClick={redo}>
          <Icon name="redo" />
        </button>
      </div>
    </nav>
  );
}
