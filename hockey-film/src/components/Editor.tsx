// Editor screen: header, tool rail, video stage, side panel, transport.
import { useEffect, useMemo, useState } from 'react';
import type { Clip, Project } from '../types';
import { useLibrary } from '../store/libraryStore';
import { useEditor } from '../store/editorStore';
import { getVideo, seek, setLoop, setRate, setStopSource, usePlayer } from '../store/playerStore';
import { useAutosave, useSaveStatus } from '../hooks/useAutosave';
import { useKeyboard } from '../hooks/useKeyboard';
import { shapeOpacity } from '../lib/util';
import { zoomAt } from '../lib/view';
import { VideoStage } from './VideoStage';
import { Transport } from './Transport';
import { Toolbar } from './Toolbar';
import { Inspector } from './Inspector';
import { HelpOverlay } from './HelpOverlay';
import { Icon } from './Icon';
import { ExportResult, type ExportFile } from './ExportResult';
import { ExportClipModal } from './ExportClipModal';
import { exportFramePNG } from '../lib/exporter';
import { fileSafe } from '../lib/saveFile';
import { fmtTime } from '../lib/util';

const isNarrow = () => window.innerWidth < 1000;

export function Editor({ project, src, focus, onExit }: { project: Project; src: string; focus?: Clip; onExit: () => void }) {
  const [panelOpen, setPanelOpen] = useState(!isNarrow());
  const [help, setHelp] = useState(false);
  const [clearMenu, setClearMenu] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [exportFile, setExportFile] = useState<ExportFile | null>(null);
  const [clipExport, setClipExport] = useState<{ start: number; end: number } | null>(null);

  /** The project as it is right now (drawings live in the editor store until autosave). */
  const liveProject = (): Project => {
    const ed = useEditor.getState();
    return { ...(ed.project ?? project), shapes: ed.shapes, layers: ed.layers, stops: ed.stops, fps: usePlayer.getState().fps };
  };
  const exportFrame = async () => {
    setExportMenu(false);
    const v = getVideo();
    if (!v) return;
    v.pause();
    const t = v.currentTime;
    const blob = await exportFramePNG(liveProject(), v, t);
    setExportFile({ blob, filename: `${fileSafe(liveProject().name)} ${fmtTime(t).replace(/[:.]/g, '-')}.png` });
  };
  const exportRange = () => {
    setExportMenu(false);
    const { loop } = usePlayer.getState();
    if (loop.in === null || loop.out === null) {
      alert('Set In and Out on the timeline first (I / O), then export.');
      return;
    }
    getVideo()?.pause();
    setClipExport({ start: loop.in, end: loop.out });
  };
  const ready = usePlayer((s) => s.ready);
  const name = useEditor((s) => s.project?.name ?? '');
  const save = useSaveStatus();

  // Declared before the load effect so its unmount flush runs before the project is closed.
  useAutosave();

  // Load project into stores once.
  useEffect(() => {
    useEditor.getState().loadProject(project);
    usePlayer.getState().set({
      fps: project.fps,
      fpsLocked: !!project.fpsLocked,
      loop: project.loop,
      view: { zoom: 1, x: 0, y: 0 },
      currentTime: project.lastTime,
      rate: 1,
      teach: !!project.teach?.on,
      teachAtDrawings: !!project.teach?.atDrawings,
      following: false,
    });
    setRate(1);
    // Teach mode pauses at stops; optionally at every drawing's start too.
    setStopSource(() => {
      const ed = useEditor.getState();
      const times = [...ed.stops];
      if (usePlayer.getState().teachAtDrawings) for (const s of ed.shapes) times.push(s.t);
      return times.sort((a, b) => a - b);
    });
    return () => useEditor.getState().closeProject();
  }, [project]);

  // Opened from a clip: loop that clip. Otherwise resume where we left off.
  useEffect(() => {
    if (!ready) return;
    if (focus) {
      setLoop({ in: focus.start, out: focus.end, enabled: true });
      seek(focus.start);
    } else if (project.lastTime > 0) seek(project.lastTime);
  }, [ready, project.lastTime, focus]);
  useEffect(() => { useLibrary.getState().load(); }, []);

  const handlers = useMemo(
    () => ({
      toggleHelp: () => setHelp((h) => !h),
      togglePanel: () => setPanelOpen((p) => !p),
      toggleFullscreen,
      zoomBy: (f: number) => {
        const st = document.querySelector('.stage') as HTMLElement | null;
        const pl = usePlayer.getState();
        if (!st) return;
        const w = st.clientWidth, h = st.clientHeight;
        pl.set({ view: zoomAt(w, h, pl.videoW, pl.videoH, pl.view, w / 2, h / 2, pl.view.zoom * f) });
      },
    }),
    [],
  );
  useKeyboard(handlers);

  const rename = (n: string) => {
    const ed = useEditor.getState();
    if (ed.project) useEditor.setState({ project: { ...ed.project, name: n }, rev: ed.rev + 1 });
  };

  const clearFrame = () => {
    const now = getVideo()?.currentTime ?? 0;
    useEditor.getState().clearAll((s) => shapeOpacity(s, now) > 0);
    setClearMenu(false);
  };
  const clearAllShapes = () => {
    if (confirm('Delete ALL drawings in this project? (You can still undo.)')) useEditor.getState().clearAll();
    setClearMenu(false);
  };

  return (
    <div className="editor">
      <header className="topbar">
        <button className="btn icon ghost" onClick={onExit} title="Back to library" aria-label="Library">
          <Icon name="home" />
        </button>
        <input className="title-input" value={name} onChange={(e) => rename(e.target.value)} aria-label="Project name" />
        <span className={'save-status ' + save.status}>
          {save.status === 'saving' ? 'Saving…' : save.status === 'error' ? 'Save failed — retrying' : 'Saved'}
        </span>
        <div className="spacer" />
        <div className="menu-wrap">
          <button className="btn" onClick={() => setExportMenu((m) => !m)}><Icon name="export" size={18} /> Export</button>
          {exportMenu && (
            <div className="menu" onMouseLeave={() => setExportMenu(false)}>
              <button onClick={exportFrame}>This frame as image (PNG)</button>
              <button onClick={exportRange}>In → Out as video</button>
            </div>
          )}
        </div>
        <div className="menu-wrap">
          <button className="btn" onClick={() => setClearMenu((m) => !m)}>Clear</button>
          {clearMenu && (
            <div className="menu" onMouseLeave={() => setClearMenu(false)}>
              <button onClick={clearFrame}>Clear this frame</button>
              <button className="danger" onClick={clearAllShapes}>Clear all drawings</button>
            </div>
          )}
        </div>
        <button className="btn icon ghost" onClick={() => setHelp(true)} title="Shortcuts (?)" aria-label="Help">
          <Icon name="help" />
        </button>
        <button className="btn icon ghost" onClick={toggleFullscreen} title="Fullscreen (F)" aria-label="Fullscreen">
          <Icon name="full" />
        </button>
        <button className={'btn icon ghost' + (panelOpen ? ' active' : '')} onClick={() => setPanelOpen((p) => !p)} title="Panel (\)" aria-label="Toggle panel">
          <Icon name="panel" />
        </button>
      </header>

      <div className={'workspace' + (panelOpen ? ' panel-open' : '')}>
        <Toolbar />
        <VideoStage src={src} />
        {panelOpen && <Inspector onClose={isNarrow() ? () => setPanelOpen(false) : undefined} />}
      </div>

      <Transport />
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
      {exportFile && <ExportResult file={exportFile} onClose={() => setExportFile(null)} />}
      {clipExport && (
        <ExportClipModal
          project={liveProject()}
          src={src}
          start={clipExport.start}
          end={clipExport.end}
          name={`${liveProject().name} ${fmtTime(clipExport.start, false)}`}
          onClose={() => setClipExport(null)}
        />
      )}
    </div>
  );
}

function toggleFullscreen() {
  const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (document.fullscreenElement || d.webkitFullscreenElement) {
      if (document.exitFullscreen) void document.exitFullscreen();
      else d.webkitExitFullscreen?.();
    } else if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    } else el.webkitRequestFullscreen?.();
  } catch {
    /* not supported (e.g. iPhone) */
  }
}
