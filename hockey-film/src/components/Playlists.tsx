// Playlists tab: ordered lists of clips for a video session. Reorder, remove, rename, present.
import { useState } from 'react';
import type { Project } from '../types';
import { useLibrary } from '../store/libraryStore';
import { fmtTime, uid } from '../lib/util';
import type { LibraryActions } from './Library';
import { Icon } from './Icon';

export function Playlists({ projects, actions, goToClips }: { projects: Map<string, Project>; actions: LibraryActions; goToClips: () => void }) {
  const playlists = useLibrary((s) => s.playlists);
  const clips = useLibrary((s) => s.clips);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = playlists.find((p) => p.id === openId);
  const lib = useLibrary.getState();

  if (open) {
    const items = open.clipIds.map((id) => clips.find((c) => c.id === id)).filter(Boolean) as typeof clips;
    const total = items.reduce((s, c) => s + (c.end - c.start), 0);
    const move = (i: number, d: number) => {
      const ids = [...open.clipIds];
      const j = i + d;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      lib.putPlaylist({ ...open, clipIds: ids });
    };
    return (
      <div className="tab-body">
        <div className="tab-actions">
          <button className="btn" onClick={() => setOpenId(null)}>‹ Playlists</button>
          <input className="field title-field" value={open.name} onChange={(e) => lib.putPlaylist({ ...open, name: e.target.value })} />
          <button className="btn primary big" disabled={!items.length} onClick={() => actions.present(open.clipIds)}>
            <Icon name="teach" /> Present
          </button>
        </div>
        <div className="dim small">{items.length} clips · {fmtTime(total, false)}</div>
        {items.length === 0 && (
          <div className="empty">
            <p className="dim">Empty. Go to <button className="link" onClick={goToClips}>Clips</button>, select some, and tap <b>Playlist</b>.</p>
          </div>
        )}
        <ol className="pl-list">
          {items.map((c, i) => {
            const p = projects.get(c.projectId);
            return (
              <li key={c.id + i} className="pl-item">
                <span className="pl-num">{i + 1}</span>
                <div className="pl-thumb" style={c.thumb ? { backgroundImage: `url(${c.thumb})` } : undefined} />
                <div className="pl-info">
                  <div className="card-title">{c.name}</div>
                  <div className="dim small ellipsis">{p?.name} · {fmtTime(c.end - c.start, false)} {c.tags.length ? '· ' + c.tags.join(', ') : ''}</div>
                </div>
                <button className="btn icon ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={18} /></button>
                <button className="btn icon ghost" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={18} /></button>
                <button className="btn icon ghost" aria-label="Remove" onClick={() => lib.putPlaylist({ ...open, clipIds: open.clipIds.filter((_, j) => j !== i) })}>
                  <Icon name="close" size={18} />
                </button>
              </li>
            );
          })}
        </ol>
        <div className="row-end">
          <button className="btn danger" onClick={() => { if (confirm(`Delete playlist "${open.name}"? Clips are kept.`)) { lib.removePlaylist(open.id); setOpenId(null); } }}>
            <Icon name="trash" size={16} /> Delete playlist
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-body">
      <div className="tab-actions">
        <button
          className="btn primary big"
          onClick={() => {
            const name = prompt('Playlist name', 'Video session');
            if (!name) return;
            const id = uid();
            lib.putPlaylist({ id, name, clipIds: [], createdAt: Date.now(), updatedAt: Date.now() });
            setOpenId(id);
          }}
        >
          <Icon name="plus" /> New playlist
        </button>
      </div>
      {playlists.length === 0 && (
        <div className="empty">
          <p>No playlists yet.</p>
          <p className="dim">Build a video session: pick clips in <button className="link" onClick={goToClips}>Clips</button>, then present them fullscreen.</p>
        </div>
      )}
      <div className="grid">
        {playlists.map((p) => {
          const first = clips.find((c) => c.id === p.clipIds[0]);
          const total = p.clipIds.reduce((s, id) => { const c = clips.find((x) => x.id === id); return s + (c ? c.end - c.start : 0); }, 0);
          return (
            <div key={p.id} className="card" onClick={() => setOpenId(p.id)}>
              <div className="thumb" style={first?.thumb ? { backgroundImage: `url(${first.thumb})` } : undefined}>
                <span className="badge">{p.clipIds.length} clips · {fmtTime(total, false)}</span>
              </div>
              <div className="card-body">
                <div className="card-title">{p.name}</div>
                <div className="dim small">Updated {new Date(p.updatedAt).toLocaleDateString()}</div>
              </div>
              <div className="card-tools">
                <button className="btn icon ghost" aria-label="Present" disabled={!p.clipIds.length} onClick={(e) => { e.stopPropagation(); actions.present(p.clipIds); }}>
                  <Icon name="play" size={18} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
