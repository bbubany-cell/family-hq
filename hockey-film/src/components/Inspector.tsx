// Right panel: style (color/size/dash), timing (hold/fade/pin), selected-shape actions, layers.
// With a shape selected, edits apply to that shape; otherwise they set defaults for new shapes.
import { DEFAULT_COLORS, useEditor } from '../store/editorStore';
import { getVideo, seek, usePlayer } from '../store/playerStore';
import { fmtTime, shapeOpacity } from '../lib/util';
import type { Shape } from '../types';
import { Icon } from './Icon';
import { HockeyPanel } from './HockeyPanel';
import { ProjectClips } from './ProjectClips';

const KIND_LABEL: Record<Shape['kind'], string> = {
  pen: 'Pen', line: 'Line', arrow: 'Arrow', curve: 'Curve', ellipse: 'Ellipse', rect: 'Rect', text: 'Text',
  spotlight: 'Spotlight', marker: 'Player', trail: 'Trail', zone: 'Zone', gap: 'Gap',
};

export function Inspector({ onClose }: { onClose?: () => void }) {
  const ed = useEditor();
  const fps = usePlayer((s) => s.fps);
  const fpsLocked = usePlayer((s) => s.fpsLocked);
  const selected = ed.shapes.find((s) => s.id === ed.selectedId);
  // Show the selected drawing's own values; otherwise the defaults for new drawings.
  const style = selected ? { color: selected.color, width: selected.width, dashed: selected.dashed } : ed.style;
  const timing = selected ? { hold: selected.hold, fadeIn: selected.fadeIn, fadeOut: selected.fadeOut } : ed.timing;
  const fontSize = selected?.kind === 'text' ? selected.fontSize : ed.fontSize;
  const pinned = timing.hold === null;
  const target = !selected
    ? 'Applies to your next drawings. To change an older drawing, tap it with Select (arrow tool).'
    : ed.justDrawn
      ? `Changes the ${KIND_LABEL[selected.kind].toLowerCase()} you just drew, and your next drawings.`
      : `Changes only this ${KIND_LABEL[selected.kind].toLowerCase()}.`;

  return (
    <aside className="inspector">
      <div className="panel-head">
        <strong>
          {selected ? `${KIND_LABEL[selected.kind]} @ ${fmtTime(selected.t)}` : 'New drawings'}
          {selected && ed.justDrawn && <span className="dim small"> · just drawn</span>}
        </strong>
        {onClose && (
          <button className="btn icon ghost" onClick={onClose} aria-label="Close panel">
            <Icon name="close" />
          </button>
        )}
      </div>

      <HockeyPanel />

      <section>
        <label className="lbl">Color</label>
        <div className="swatches">
          {DEFAULT_COLORS.map((c) => (
            <button
              key={c}
              className={'swatch' + (style.color.toLowerCase() === c ? ' active' : '')}
              style={{ background: c }}
              onClick={() => ed.setStyle({ color: c })}
              aria-label={`Color ${c}`}
            />
          ))}
          <label className="swatch custom" title="Custom color">
            <input type="color" value={style.color} onChange={(e) => ed.setStyle({ color: e.target.value })} />
          </label>
        </div>
      </section>

      <section>
        <label className="lbl">
          Thickness <span className="dim">{style.width}px</span>
        </label>
        <input type="range" min={1} max={30} value={style.width} onChange={(e) => ed.setStyle({ width: Number(e.target.value) })} />
        <div className="seg">
          <button className={!style.dashed ? 'active' : ''} onClick={() => ed.setStyle({ dashed: false })}>Solid</button>
          <button className={style.dashed ? 'active' : ''} onClick={() => ed.setStyle({ dashed: true })}>Dashed</button>
        </div>
      </section>

      {(ed.tool === 'text' || selected?.kind === 'text') && (
        <section>
          <label className="lbl">
            Text size <span className="dim">{Math.round(fontSize)}</span>
          </label>
          <input type="range" min={16} max={120} value={fontSize} onChange={(e) => ed.setFontSize(Number(e.target.value))} />
        </section>
      )}

      <section>
        <label className="lbl">
          On screen for <span className="dim">{pinned ? 'rest of video' : `${(timing.hold ?? 0).toFixed(1)}s`}</span>
        </label>
        <p className="hint target-hint">{target}</p>
        <div className="seg">
          <button className={pinned ? 'active' : ''} onClick={() => ed.setTiming({ hold: pinned ? 3 : null })} title="Stay visible for the rest of the video">
            Pin
          </button>
          {[1, 3, 5, 10].map((h) => (
            <button key={h} className={timing.hold === h ? 'active' : ''} onClick={() => ed.setTiming({ hold: h })}>
              {h}s
            </button>
          ))}
        </div>
        {!pinned && (
          <input type="range" min={0.2} max={30} step={0.1} value={timing.hold ?? 3} onChange={(e) => ed.setTiming({ hold: Number(e.target.value) })} />
        )}
        <div className="row2">
          <label className="lbl small">
            Fade in <span className="dim">{timing.fadeIn.toFixed(1)}s</span>
            <input type="range" min={0} max={2} step={0.1} value={timing.fadeIn} onChange={(e) => ed.setTiming({ fadeIn: Number(e.target.value) })} />
          </label>
          <label className="lbl small">
            Fade out <span className="dim">{timing.fadeOut.toFixed(1)}s</span>
            <input type="range" min={0} max={2} step={0.1} value={timing.fadeOut} onChange={(e) => ed.setTiming({ fadeOut: Number(e.target.value) })} />
          </label>
        </div>
      </section>

      {selected && (
        <section className="actions">
          <button className="btn" onClick={() => ed.updateShape(selected.id, { t: getVideo()?.currentTime ?? selected.t })} title="Make this drawing start at the current frame">
            <Icon name="clock" size={18} /> Start here
          </button>
          <button className="btn danger" onClick={ed.deleteSelected}>
            <Icon name="trash" size={18} /> Delete
          </button>
        </section>
      )}

      <ProjectClips />

      <Layers />

      <section>
        <label className="lbl">Frame rate</label>
        <select
          className="btn full"
          value={fpsLocked ? String(fps) : 'auto'}
          onChange={(e) =>
            e.target.value === 'auto'
              ? usePlayer.getState().set({ fpsLocked: false })
              : usePlayer.getState().set({ fps: Number(e.target.value), fpsLocked: true })
          }
        >
          <option value="auto">Auto ({fps} fps)</option>
          {[24, 25, 29.97, 30, 50, 59.94, 60].map((f) => (
            <option key={f} value={f}>{f} fps</option>
          ))}
        </select>
      </section>

      <section>
        <label className="toggle">
          <input type="checkbox" checked={ed.pencilOnly} onChange={(e) => ed.setPencilOnly(e.target.checked)} />
          <span>Apple Pencil draws, fingers pan/zoom</span>
        </label>
      </section>
    </aside>
  );
}

function Layers() {
  const ed = useEditor();
  // Rounded so the list doesn't re-render every frame during playback.
  const now = usePlayer((s) => Math.round(s.currentTime * 10) / 10);

  return (
    <section className="layers">
      <div className="lbl-row">
        <label className="lbl">Layers</label>
        <button className="btn small" onClick={ed.addLayer}>
          <Icon name="plus" size={16} /> Layer
        </button>
      </div>
      {[...ed.layers].reverse().map((l) => {
        const items = ed.shapes.filter((s) => s.layerId === l.id).sort((a, b) => a.t - b.t);
        return (
          <div key={l.id} className={'layer' + (l.id === ed.activeLayerId ? ' active' : '')}>
            <div className="layer-head" onClick={() => ed.setActiveLayer(l.id)}>
              <input
                className="layer-name"
                value={l.name}
                onChange={(e) => ed.updateLayer(l.id, { name: e.target.value })}
                onClick={(e) => e.stopPropagation()}
              />
              <span className="dim small">{items.length}</span>
              <button className="btn icon ghost" title={l.visible ? 'Hide' : 'Show'} onClick={(e) => { e.stopPropagation(); ed.updateLayer(l.id, { visible: !l.visible }); }}>
                <Icon name={l.visible ? 'eye' : 'eyeOff'} size={18} />
              </button>
              <button className="btn icon ghost" title={l.locked ? 'Unlock' : 'Lock'} onClick={(e) => { e.stopPropagation(); ed.updateLayer(l.id, { locked: !l.locked }); }}>
                <Icon name={l.locked ? 'lock' : 'unlock'} size={18} />
              </button>
              {ed.layers.length > 1 && (
                <button
                  className="btn icon ghost"
                  title="Delete layer and its drawings"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (items.length === 0 || confirm(`Delete "${l.name}" and its ${items.length} drawing(s)?`)) ed.deleteLayer(l.id);
                  }}
                >
                  <Icon name="trash" size={18} />
                </button>
              )}
            </div>
            {items.length > 0 && (
              <ul className="shape-list">
                {items.map((s) => (
                  <li
                    key={s.id}
                    className={(s.id === ed.selectedId ? 'sel ' : '') + (shapeOpacity(s, now) > 0 ? 'live' : '')}
                    onClick={() => {
                      // Jump to the drawing's moment and select it.
                      seek(s.t);
                      ed.setTool('select');
                      ed.select(s.id);
                    }}
                  >
                    <span className="dot" style={{ background: s.color }} />
                    {KIND_LABEL[s.kind]}
                    {s.kind === 'text' ? ` "${s.text.slice(0, 14)}"` : s.kind === 'marker' && s.label ? ` ${s.label.slice(0, 14)}` : ''}
                    {s.track?.length ? ' ⟿' : ''}
                    <span className="dim"> {fmtTime(s.t)}</span>
                    <button
                      className="x"
                      aria-label="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        ed.deleteShape(s.id);
                      }}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
