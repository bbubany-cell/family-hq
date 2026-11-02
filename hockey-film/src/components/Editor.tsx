// Editor screen: header, tool rail, video stage, side panel, transport.
import { useEffect, useMemo, useState } from 'react';
import type { Project } from '../types';
import { useEditor } from '../store/editorStore';
import { getVideo, seek, setRate, usePlayer } from '../store/playerStore';
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

const isNarrow = () => window.innerWidth < 1000;

export function Editor({ project, src, onExit }: { project: Project; src: string; onExit: () => void }) {
  const [panelOpen, setPanelOpen] = useState(!isNarrow());
  const [help, setHelp] = useState(false);
  const [clearMenu, setClearMenu] = useState(false);
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
    });
    setRate(1);
    return () => useEditor.getState().closeProject();
  }, [project]);

  // Resume where we left off once the video can seek.
  useEffect(() => {
    if (ready && project.lastTime > 0) seek(project.lastTime);
  }, [ready, project.lastTime]);

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
