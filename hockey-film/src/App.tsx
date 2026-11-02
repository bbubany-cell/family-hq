import { useEffect, useState } from 'react';
import type { Project } from './types';
import { Library } from './components/Library';
import { Editor } from './components/Editor';
import { requestPersistentStorage } from './db/db';

type Route = { screen: 'library' } | { screen: 'editor'; project: Project; src: string };

export function App() {
  const [route, setRoute] = useState<Route>({ screen: 'library' });

  useEffect(requestPersistentStorage, []);

  const openProject = (project: Project, file: File) => {
    // Object URL streams straight from the file on disk — no copy into memory, so huge game files are fine.
    setRoute({ screen: 'editor', project, src: URL.createObjectURL(file) });
  };

  const exit = () => {
    if (route.screen === 'editor') URL.revokeObjectURL(route.src);
    setRoute({ screen: 'library' });
  };

  return route.screen === 'library' ? (
    <Library onOpen={openProject} />
  ) : (
    <Editor key={route.project.id} project={route.project} src={route.src} onExit={exit} />
  );
}
