// Clips tab: every saved clip across all videos. Search, filter by tag, select to compare / present / add to a playlist.
import { useMemo, useState } from 'react';
import type { Clip, Project } from '../types';
import { useLibrary } from '../store/libraryStore';
import { fmtTime, uid } from '../lib/util';
import type { LibraryActions } from './Library';
import { ClipDialog } from './ClipDialog';
import { Icon } from './Icon';

export function ClipLibrary({ projects, actions }: { projects: Map<string, Project>; actions: LibraryActions }) {
  const clips = useLibrary((s) => s.clips);
  const playlists = useLibrary((s) => s.playlists);
  const [q, setQ] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [editing, setEditing] = useState<Clip | null>(null);
  const [addTo, setAddTo] = useState(false);

  const allTags = useMemo(() => [...new Set(clips.flatMap((c) => c.tags))].sort(), [clips]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return clips.filter((c) => {
      if (tags.length && !tags.every((t) => c.tags.includes(t))) return false;
      if (!needle) return true;
      const p = projects.get(c.projectId);
      return [c.name, c.notes, p?.name ?? '', ...c.tags].some((s) => s.toLowerCase().includes(needle));
    });
  }, [clips, q, tags, projects]);

  const toggleSel = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selClips = sel.map((id) => clips.find((c) => c.id === id)).filter(Boolean) as Clip[];

  const addToPlaylist = async (playlistId: string | null) => {
    const lib = useLibrary.getState();
    if (playlistId) {
      const pl = lib.playlists.find((p) => p.id === playlistId)!;
      await lib.putPlaylist({ ...pl, clipIds: [...pl.clipIds, ...sel.filter((id) => !pl.clipIds.includes(id))] });
    } else {
      const name = prompt('Playlist name', 'Video session');
      if (!name) return;
      await lib.putPlaylist({ id: uid(), name, clipIds: [...sel], createdAt: Date.now(), updatedAt: Date.now() });
    }
    setAddTo(false);
    setSel([]);
  };

  return (
    <div className="tab-body">
      <div className="filter-bar">
        <div className="search">
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clips, notes, games…" />
        </div>
        {allTags.length > 0 && (
          <div className="chips">
            {allTags.map((t) => (
              <button key={t} className={'chip' + (tags.includes(t) ? ' active' : '')} onClick={() => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}>
                {t}
              </button>
            ))}
            {tags.length > 0 && <button className="chip" onClick={() => setTags([])}>Clear</button>}
          </div>
        )}
      </div>

      {clips.length === 0 && (
        <div className="empty">
          <p>No clips yet.</p>
          <p className="dim">In a video, set <b>In</b> and <b>Out</b> on the timeline and tap <b>Clip</b>.</p>
        </div>
      )}
      {clips.length > 0 && shown.length === 0 && <div className="empty dim">No clips match.</div>}

      <div className="grid">
        {shown.map((c) => {
          const p = projects.get(c.projectId);
          const on = sel.includes(c.id);
          return (
            <div key={c.id} className={'card' + (on ? ' selected' : '')} onClick={() => (sel.length ? toggleSel(c.id) : p && actions.openProject(p, c))}>
              <div className="thumb" style={c.thumb ? { backgroundImage: `url(${c.thumb})` } : p?.thumb ? { backgroundImage: `url(${p.thumb})` } : undefined}>
                <span className="badge">{fmtTime(c.end - c.start, false)}</span>
                <button className={'select-dot' + (on ? ' on' : '')} aria-label="Select clip" onClick={(e) => { e.stopPropagation(); toggleSel(c.id); }}>
                  {on ? sel.indexOf(c.id) + 1 : ''}
                </button>
              </div>
              <div className="card-body">
                <div className="card-title">{c.name}</div>
                <div className="dim small ellipsis">{p?.name ?? 'Missing video'} · {fmtTime(c.start, false)}</div>
                {c.tags.length > 0 && (
                  <div className="tag-row">{c.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
                )}
                {c.notes && <div className="small notes-preview">{c.notes}</div>}
              </div>
              <div className="card-tools">
                <button className="btn icon ghost" aria-label="Edit clip" onClick={(e) => { e.stopPropagation(); setEditing(c); }}>
                  <Icon name="edit" size={18} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {sel.length > 0 && (
        <div className="action-bar">
          <span><b>{sel.length}</b> selected</span>
          <button className="btn" onClick={() => setSel([])}>Clear</button>
          <button
            className="btn primary"
            disabled={sel.length !== 2}
            title={sel.length !== 2 ? 'Select exactly 2 clips' : 'Side by side'}
            onClick={() => actions.compare(selClips[0], selClips[1])}
          >
            <Icon name="compare" size={18} /> Compare
          </button>
          <button className="btn primary" onClick={() => actions.present(sel)}>
            <Icon name="teach" size={18} /> Present
          </button>
          <button className="btn" onClick={() => setAddTo(true)}>
            <Icon name="list" size={18} /> Playlist
          </button>
        </div>
      )}

      {addTo && (
        <div className="modal-back" onClick={() => setAddTo(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add {sel.length} clip{sel.length === 1 ? '' : 's'} to…</h2>
            <button className="btn primary full" onClick={() => addToPlaylist(null)}><Icon name="plus" size={18} /> New playlist</button>
            {playlists.map((p) => (
              <button key={p.id} className="btn full" onClick={() => addToPlaylist(p.id)}>
                {p.name} <span className="dim">({p.clipIds.length})</span>
              </button>
            ))}
            <button className="btn" onClick={() => setAddTo(false)}>Cancel</button>
          </div>
        </div>
      )}

      {editing && (
        <ClipDialog
          clip={editing}
          duration={projects.get(editing.projectId)?.video.duration}
          onCancel={() => setEditing(null)}
          onSave={(c) => { useLibrary.getState().putClip(c); setEditing(null); }}
          onDelete={() => { useLibrary.getState().removeClip(editing.id); setEditing(null); }}
        />
      )}
    </div>
  );
}
