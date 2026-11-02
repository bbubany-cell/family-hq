// Create / edit a clip: name, in/out, tags, notes.
import { useState } from 'react';
import { CLIP_TAGS, type Clip } from '../types';
import { fmtTime } from '../lib/util';
import { Icon } from './Icon';

interface Props {
  clip: Clip;
  /** Current playhead (editor only) for the "set to now" buttons. */
  now?: () => number;
  duration?: number;
  onSave: (c: Clip) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

export function ClipDialog({ clip, now, duration, onSave, onCancel, onDelete }: Props) {
  const [c, setC] = useState(clip);
  const [custom, setCustom] = useState('');
  const set = (p: Partial<Clip>) => setC((x) => ({ ...x, ...p }));
  const toggleTag = (t: string) => set({ tags: c.tags.includes(t) ? c.tags.filter((x) => x !== t) : [...c.tags, t] });
  const allTags = [...new Set([...CLIP_TAGS, ...c.tags])];
  const valid = c.end > c.start + 0.1 && c.name.trim();
  const nudge = (k: 'start' | 'end', d: number) => set({ [k]: Math.max(0, Math.min(duration ?? Infinity, c[k] + d)) } as Partial<Clip>);

  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{onDelete ? 'Edit clip' : 'Save clip'}</h2>
        <input className="field" value={c.name} onChange={(e) => set({ name: e.target.value })} placeholder="Clip name" autoFocus={!onDelete} />

        <div className="clip-range">
          {(['start', 'end'] as const).map((k) => (
            <div key={k} className="range-box">
              <div className="lbl">{k === 'start' ? 'Start' : 'End'}</div>
              <div className="range-row">
                <button className="btn small" onClick={() => nudge(k, -1)}>−1s</button>
                <strong className="time">{fmtTime(c[k])}</strong>
                <button className="btn small" onClick={() => nudge(k, 1)}>+1s</button>
              </div>
              {now && <button className="btn small full" onClick={() => set({ [k]: now() } as Partial<Clip>)}>Set to playhead</button>}
            </div>
          ))}
        </div>
        <div className="dim small">Length {fmtTime(Math.max(0, c.end - c.start))}</div>

        <div>
          <div className="lbl">Tags</div>
          <div className="chips">
            {allTags.map((t) => (
              <button key={t} className={'chip' + (c.tags.includes(t) ? ' active' : '')} onClick={() => toggleTag(t)}>{t}</button>
            ))}
          </div>
          <div className="row-inline">
            <input
              className="field"
              value={custom}
              placeholder="Add tag (e.g. Line 2, #17)"
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && custom.trim()) {
                  e.preventDefault();
                  if (!c.tags.includes(custom.trim())) set({ tags: [...c.tags, custom.trim()] });
                  setCustom('');
                }
              }}
            />
            <button
              className="btn"
              disabled={!custom.trim()}
              onClick={() => { if (!c.tags.includes(custom.trim())) set({ tags: [...c.tags, custom.trim()] }); setCustom(''); }}
            >
              <Icon name="plus" size={16} />
            </button>
          </div>
        </div>

        <textarea className="field notes" rows={3} value={c.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Notes: what to look for, what went right/wrong…" />

        <div className="row-end">
          {onDelete && (
            <button className="btn danger" onClick={() => confirm('Delete this clip? (The video and drawings are not touched.)') && onDelete()}>
              <Icon name="trash" size={16} /> Delete
            </button>
          )}
          <div className="spacer" />
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={!valid} onClick={() => onSave({ ...c, name: c.name.trim() })}>Save</button>
        </div>
      </div>
    </div>
  );
}
