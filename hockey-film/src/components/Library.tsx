// Home screen with tabs: Videos (projects) · Clips · Playlists · Drills.
import { useEffect, useMemo, useState } from 'react';
import type { Clip, Drill, Project } from '../types';
import { deleteDrill, deleteProject, listDrills, listProjects, saveDrill, saveHandle, saveProject } from '../db/db';
import { pickVideo, probeVideo, type PickedVideo } from '../lib/videoFile';
import { forgetFile, rememberFile } from '../lib/videoAccess';
import { fmtTime, uid } from '../lib/util';
import { useLibrary } from '../store/libraryStore';
import { whenSaved } from '../hooks/useAutosave';
import { ClipLibrary } from './ClipLibrary';
import { Playlists } from './Playlists';
import { newDrill } from '../lib/board';
import { Icon } from './Icon';
import { BackupModal, projectExportFile } from './BackupModal';
import { ExportResult, type ExportFile } from './ExportResult';
import { lastBackupAt } from '../lib/backup';

export type Tab = 'videos' | 'clips' | 'playlists' | 'drills';

export interface LibraryActions {
  openProject: (p: Project, focus?: Clip) => void;
  compare: (a: Clip, b: Clip) => void;
  present: (clipIds: string[]) => void;
  openDrill: (d: Drill) => void;
  exportClip: (c: Clip) => void;
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'videos', label: 'Videos', icon: 'video' },
  { id: 'clips', label: 'Clips', icon: 'clip' },
  { id: 'playlists', label: 'Playlists', icon: 'list' },
  { id: 'drills', label: 'Drills', icon: 'rink' },
];

export function Library({ tab, setTab, actions }: { tab: Tab; setTab: (t: Tab) => void; actions: LibraryActions }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const loadLib = useLibrary((s) => s.load);

  const refresh = () => whenSaved().then(listProjects).then(setProjects);
  useEffect(() => {
    refresh();
    loadLib();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects]);
  const [backupOpen, setBackupOpen] = useState(false);
  const [lastBackup, setLastBackup] = useState(lastBackupAt);
  const days = lastBackup ? Math.floor((Date.now() - lastBackup) / 86_400_000) : null;
  // Nudge when there's work to lose and no backup in the last week.
  const stale = !!projects?.length && (days === null || days >= 7);

  return (
    <div className="library">
      <header className="lib-head">
        <div className="brand">
          <img src="./icon.svg" alt="" width={40} height={40} />
          <div>
            <h1>Film Room</h1>
            <div className="dim small">Videos stay on this device. Nothing is uploaded.</div>
          </div>
        </div>
        <button className={'btn' + (stale ? ' warn' : '')} onClick={() => setBackupOpen(true)} title="Back up or restore your work">
          <Icon name="backup" size={18} />
          {days === null ? 'Back up (never)' : days === 0 ? 'Backed up today' : `Backed up ${days}d ago`}
        </button>
      </header>
      {backupOpen && (
        <BackupModal
          onClose={() => { setBackupOpen(false); setLastBackup(lastBackupAt()); }}
          onRestored={() => { refresh(); loadLib(); }}
        />
      )}

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={'tab' + (tab === t.id ? ' active' : '')} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={20} /> {t.label}
          </button>
        ))}
      </nav>

      {tab === 'videos' && <Videos projects={projects} refresh={refresh} onOpen={(p) => actions.openProject(p)} />}
      {tab === 'clips' && <ClipLibrary projects={byId} actions={actions} />}
      {tab === 'playlists' && <Playlists projects={byId} actions={actions} goToClips={() => setTab('clips')} />}
      {tab === 'drills' && <Drills onOpen={actions.openDrill} />}
    </div>
  );
}

// ---------------- Videos (projects) ----------------

function Videos({ projects, refresh, onOpen }: { projects: Project[] | null; refresh: () => void; onOpen: (p: Project) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [exportFile, setExportFile] = useState<ExportFile | null>(null);
  const clips = useLibrary((s) => s.clips);

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
      rememberFile(p.id, picked.file);
      onOpen(p);
    } catch (e) {
      setError((e as Error).message || 'Could not open that video.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (p: Project) => {
    const n = clips.filter((c) => c.projectId === p.id).length;
    if (!confirm(`Delete "${p.name}", its drawings${n ? ` and ${n} clip(s)` : ''}? Your video file is not touched.`)) return;
    await deleteProject(p.id);
    forgetFile(p.id);
    await useLibrary.getState().load();
    refresh();
  };

  return (
    <div
      className={'tab-body' + (dragOver ? ' drag' : '')}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) createFrom({ file: f });
      }}
    >
      <div className="tab-actions">
        <button className="btn primary big" onClick={async () => createFrom(await pickVideo())} disabled={!!busy}>
          <Icon name="video" /> New from video
        </button>
      </div>
      {busy && <div className="notice">{busy}</div>}
      {error && <div className="notice error">{error}</div>}
      {projects && projects.length === 0 && (
        <div className="empty">
          <p>No videos yet.</p>
          <p className="dim">Tap <strong>New from video</strong> (or drop an MP4/MOV here) to start breaking down film.</p>
        </div>
      )}
      <div className="grid">
        {projects?.map((p) => (
          <div key={p.id} className="card" onClick={() => onOpen(p)}>
            <div className="thumb" style={p.thumb ? { backgroundImage: `url(${p.thumb})` } : undefined}>
              <span className="badge">{fmtTime(p.video.duration, false)}</span>
            </div>
            <div className="card-body">
              <div className="card-title">{p.name}</div>
              <div className="dim small">
                {p.shapes.length} drawing{p.shapes.length === 1 ? '' : 's'} · {clips.filter((c) => c.projectId === p.id).length} clips ·{' '}
                {new Date(p.updatedAt).toLocaleDateString()}
              </div>
              <div className="dim small ellipsis">{p.video.name}</div>
            </div>
            <div className="card-tools">
              <button className="btn icon ghost" aria-label="Export project" title="Export drawings + clips for this video"
                onClick={async (e) => { e.stopPropagation(); setExportFile(await projectExportFile(p.id, p.name)); }}>
                <Icon name="export" size={18} />
              </button>
              <button className="btn icon ghost" aria-label="Delete project" onClick={(e) => { e.stopPropagation(); remove(p); }}>
                <Icon name="trash" size={18} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {exportFile && <ExportResult file={exportFile} onClose={() => setExportFile(null)} />}
    </div>
  );
}

// ---------------- Drills (rink whiteboard) ----------------

function Drills({ onOpen }: { onOpen: (d: Drill) => void }) {
  const [drills, setDrills] = useState<Drill[] | null>(null);
  const refresh = () => listDrills().then(setDrills);
  useEffect(() => { refresh(); }, []);

  return (
    <div className="tab-body">
      <div className="tab-actions">
        <button className="btn primary big" onClick={() => onOpen(newDrill())}>
          <Icon name="rink" /> New drill / play
        </button>
      </div>
      {drills && drills.length === 0 && (
        <div className="empty">
          <p>No drills yet.</p>
          <p className="dim">Draw a play on the rink, step it out, and play it back for the team.</p>
        </div>
      )}
      <div className="grid">
        {drills?.map((d) => (
          <div key={d.id} className="card" onClick={() => onOpen(d)}>
            <div className="thumb rink-thumb" style={d.thumb ? { backgroundImage: `url(${d.thumb})` } : undefined}>
              <span className="badge">{d.steps.length} step{d.steps.length === 1 ? '' : 's'}</span>
            </div>
            <div className="card-body">
              <div className="card-title">{d.name}</div>
              <div className="dim small ellipsis">{d.notes || `${d.view} rink`}</div>
            </div>
            <div className="card-tools">
              <button
                className="btn icon ghost"
                aria-label="Duplicate drill"
                onClick={async (e) => {
                  e.stopPropagation();
                  await saveDrill({ ...structuredClone(d), id: uid(), name: d.name + ' (copy)', createdAt: Date.now(), updatedAt: Date.now() });
                  refresh();
                }}
              >
                <Icon name="copy" size={18} />
              </button>
              <button
                className="btn icon ghost"
                aria-label="Delete drill"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (confirm(`Delete drill "${d.name}"?`)) { await deleteDrill(d.id); refresh(); }
                }}
              >
                <Icon name="trash" size={18} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
