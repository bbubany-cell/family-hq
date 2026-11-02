// Side-panel list of the open video's clips. Tap = loop that clip; pencil = edit.
import { useMemo, useState } from 'react';
import { useEditor } from '../store/editorStore';
import { useLibrary } from '../store/libraryStore';
import { getVideo, seek, setLoop, usePlayer } from '../store/playerStore';
import { fmtTime } from '../lib/util';
import type { Clip } from '../types';
import { ClipDialog } from './ClipDialog';
import { Icon } from './Icon';

export function ProjectClips() {
  const projectId = useEditor((s) => s.project?.id);
  const all = useLibrary((s) => s.clips);
  const clips = useMemo(() => all.filter((c) => c.projectId === projectId).sort((a, b) => a.start - b.start), [all, projectId]);
  const duration = usePlayer((s) => s.duration);
  const [editing, setEditing] = useState<Clip | null>(null);
  if (!projectId) return null;

  return (
    <section>
      <label className="lbl">Clips from this video <span className="dim">{clips.length}</span></label>
      {clips.length === 0 && <p className="hint">Set In/Out on the timeline and tap <b>Clip</b> to save one.</p>}
      <ul className="shape-list">
        {clips.map((c) => (
          <li
            key={c.id}
            className="live"
            onClick={() => {
              setLoop({ in: c.start, out: c.end, enabled: true });
              seek(c.start);
            }}
          >
            <span className="dot" style={{ background: '#ffd60a' }} />
            <span className="ellipsis">{c.name}</span>
            <span className="dim"> {fmtTime(c.end - c.start, false)}</span>
            <button className="x" aria-label="Edit clip" onClick={(e) => { e.stopPropagation(); setEditing(c); }}>
              <Icon name="edit" size={14} />
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <ClipDialog
          clip={editing}
          now={() => getVideo()?.currentTime ?? 0}
          duration={duration}
          onCancel={() => setEditing(null)}
          onSave={(c) => { useLibrary.getState().putClip(c); setEditing(null); }}
          onDelete={() => { useLibrary.getState().removeClip(editing.id); setEditing(null); }}
        />
      )}
    </section>
  );
}
