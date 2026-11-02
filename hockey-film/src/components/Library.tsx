// Home screen: list of projects + "New project from video". Handles reopening/relinking videos.
import { useEffect, useState } from 'react';
import type { Project } from '../types';
import { deleteProject, getHandle, listProjects, saveHandle, saveProject } from '../db/db';
import { fileFromHandle, pickVideo, probeVideo, type PickedVideo } from '../lib/videoFile';
import { fmtBytes, fmtTime, uid } from '../lib/util';
import { Icon } from './Icon';
import { whenSaved } from '../hooks/useAutosave';

/** Files picked this session, so hopping between projects doesn't require re-picking. */
const fileCache = new Map<string, File>();

export function Library({ onOpen }: { onOpen: (p: Project, file: File) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [relink, setRelink] = useState<Project | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const refresh = () => whenSaved().then(listProjects).then(setProjects);
  useEffect(() => {
    refresh();
  }, []);

  const createFrom = async (picked: PickedVideo | null) => {
    if (!picked) return;
    setError(null);
    setBusy('Reading video…');
    try {
      const { meta, thumb } = await probeVideo(picked.file);
      const layerId = uid();
      const p: Project = {
        id: uid(),
        name: picked.file.name.replace(/\.[^.]+$/, ''),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        video: meta,
        thumb,
        fps: 30,
        shapes: [],
        layers: [{ id: layerId, name: 'Layer 1', visible: true, locked: false }],
        activeLayerId: layerId,
        loop: { in: null, out: null, enabled: false },
        lastTime: 0,
      };
      await saveProject(p);
      if (picked.handle) await saveHandle(p.id, picked.handle);
      fileCache.set(p.id, picked.file);
      onOpen(p, picked.file);
    } catch (e) {
      setError((e as Error).message || 'Could not open that video.');
    } finally {
      setBusy(null);
    }
  };

  const open = async (p: Project) => {
    setError(null);
    const cached = fileCache.get(p.id);
    if (cached) return onOpen(p, cached);
    const handle = await getHandle(p.id);
    if (handle) {
      const f = await fileFromHandle(handle);
      if (f) {
        fileCache.set(p.id, f);
        return onOpen(p, f);
      }
    }
    setRelink(p); // ask the user to point us at the video file again
  };

  const doRelink = async () => {
    const p = relink!;
    const picked = await pickVideo();
    if (!picked) return;
    if (picked.file.size !== p.video.size && !confirm(`That file doesn't match "${p.video.name}" (${fmtBytes(p.video.size)}). Use it anyway? Drawings may not line up.`)) return;
    if (picked.handle) await saveHandle(p.id, picked.handle);
    fileCache.set(p.id, picked.file);
    setRelink(null);
    onOpen(p, picked.file);
  };

  const remove = async (p: Project) => {
    if (!confirm(`Delete project "${p.name}" and all its drawings? Your video file is not touched.`)) return;
    await deleteProject(p.id);
    fileCache.delete(p.id);
    refresh();
  };

  return (
    <div
      className={'library' + (dragOver ? ' drag' : '')}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) createFrom({ file: f });
      }}
    >
      <header className="lib-head">
        <div className="brand">
          <img src="./icon.svg" alt="" width={40} height={40} />
          <div>
            <h1>Film Room</h1>
            <div className="dim small">Videos stay on this device. Nothing is uploaded.</div>
          </div>
        </div>
        <button className="btn primary big" onClick={async () => createFrom(await pickVideo())} disabled={!!busy}>
          <Icon name="video" /> New from video
        </button>
      </header>

      {busy && <div className="notice">{busy}</div>}
      {error && <div className="notice error">{error}</div>}

      {projects && projects.length === 0 && (
        <div className="empty">
          <p>No projects yet.</p>
          <p className="dim">Tap <strong>New from video</strong> (or drop an MP4/MOV here) to start breaking down film.</p>
        </div>
      )}

      <div className="grid">
        {projects?.map((p) => (
          <div key={p.id} className="card" onClick={() => open(p)}>
            <div className="thumb" style={p.thumb ? { backgroundImage: `url(${p.thumb})` } : undefined}>
              <span className="badge">{fmtTime(p.video.duration, false)}</span>
            </div>
            <div className="card-body">
              <div className="card-title">{p.name}</div>
              <div className="dim small">
                {p.shapes.length} drawing{p.shapes.length === 1 ? '' : 's'} · {new Date(p.updatedAt).toLocaleDateString()}
              </div>
              <div className="dim small ellipsis">{p.video.name}</div>
            </div>
            <button
              className="btn icon ghost card-del"
              aria-label="Delete project"
              onClick={(e) => {
                e.stopPropagation();
                remove(p);
              }}
            >
              <Icon name="trash" size={18} />
            </button>
          </div>
        ))}
      </div>

      {relink && (
        <div className="modal-back" onClick={() => setRelink(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Find the video</h2>
            <p>
              Film Room never copies your video, so it needs you to point at it again:
              <br />
              <strong>{relink.video.name}</strong> <span className="dim">({fmtBytes(relink.video.size)})</span>
            </p>
            <div className="row-end">
              <button className="btn" onClick={() => setRelink(null)}>Cancel</button>
              <button className="btn primary" onClick={doRelink}>Choose file…</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
