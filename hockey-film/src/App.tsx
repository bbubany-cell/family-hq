import { useEffect, useState } from 'react';
import type { Clip, Drill, Project } from './types';
import { Library, type LibraryActions, type Tab } from './components/Library';
import { Editor } from './components/Editor';
import { Compare, type ClipSource } from './components/Compare';
import { Present } from './components/Present';
import { Board } from './components/Board';
import { RelinkModal } from './components/RelinkModal';
import { getProject, requestPersistentStorage } from './db/db';
import { ensureUrl } from './lib/videoAccess';
import { useLibrary } from './store/libraryStore';
import { whenSaved } from './hooks/useAutosave';

type Route =
  | { screen: 'library' }
  | { screen: 'editor'; project: Project; src: string; focus?: Clip }
  | { screen: 'compare'; a: ClipSource; b: ClipSource }
  | { screen: 'present'; items: ClipSource[] }
  | { screen: 'board'; drill: Drill };

const TAB_KEY = 'filmroom.tab';
const readTab = (): Tab => {
  try {
    return (localStorage.getItem(TAB_KEY) as Tab) || 'videos';
  } catch {
    return 'videos';
  }
};

export function App() {
  const [route, setRoute] = useState<Route>({ screen: 'library' });
  const [tab, setTabState] = useState<Tab>(readTab);
  const [busy, setBusy] = useState(false);
  const setTab = (t: Tab) => {
    setTabState(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* private mode */ }
  };

  useEffect(requestPersistentStorage, []);

  /** Latest saved copy of a project (clips can outlive an open editor session). */
  const fresh = async (projectId: string) => {
    await whenSaved();
    return getProject(projectId);
  };

  /** Resolve each clip's project + video, asking for any video we don't have yet. */
  const sources = async (clips: Clip[]): Promise<ClipSource[] | null> => {
    const out: ClipSource[] = [];
    for (const clip of clips) {
      const project = await fresh(clip.projectId);
      if (!project) continue;
      const src = await ensureUrl(project); // may show the "Find the video" prompt
      if (!src) return null;
      out.push({ clip, project, src });
    }
    return out;
  };

  const actions: LibraryActions = {
    openProject: async (p, focus) => {
      const src = await ensureUrl(p);
      if (src) setRoute({ screen: 'editor', project: (await fresh(p.id)) ?? p, src, focus });
    },
    compare: async (a, b) => {
      setBusy(true);
      const s = await sources([a, b]).finally(() => setBusy(false));
      if (s && s.length === 2) setRoute({ screen: 'compare', a: s[0], b: s[1] });
    },
    present: async (ids) => {
      const all = useLibrary.getState().clips;
      const clips = ids.map((id) => all.find((c) => c.id === id)).filter(Boolean) as Clip[];
      setBusy(true);
      const s = await sources(clips).finally(() => setBusy(false));
      if (s && s.length) setRoute({ screen: 'present', items: s });
    },
    openDrill: (drill) => setRoute({ screen: 'board', drill }),
  };

  const home = () => setRoute({ screen: 'library' });

  return (
    <>
      {route.screen === 'library' && <Library tab={tab} setTab={setTab} actions={actions} />}
      {route.screen === 'editor' && <Editor key={route.project.id} project={route.project} src={route.src} focus={route.focus} onExit={home} />}
      {route.screen === 'compare' && <Compare a={route.a} b={route.b} onExit={home} />}
      {route.screen === 'present' && <Present items={route.items} onExit={home} />}
      {route.screen === 'board' && <Board key={route.drill.id} initial={route.drill} onExit={home} />}
      {busy && <div className="busy">Loading clips…</div>}
      <RelinkModal />
    </>
  );
}
