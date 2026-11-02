// IndexedDB persistence via Dexie. Projects hold annotations + metadata only.
// Video files are NOT stored here (they can be multi-GB); we keep a file handle
// where the browser supports it (Chrome/Edge desktop), otherwise the user re-picks
// the file from their device when reopening a project (we verify name + size).
import Dexie, { type Table } from 'dexie';
import type { Project } from '../types';

interface HandleRow {
  projectId: string;
  handle: FileSystemFileHandle;
}

class FilmRoomDB extends Dexie {
  projects!: Table<Project, string>;
  handles!: Table<HandleRow, string>;
  constructor() {
    super('film-room');
    this.version(1).stores({
      projects: 'id, updatedAt, name',
      handles: 'projectId',
    });
  }
}

export const db = new FilmRoomDB();

export const listProjects = () => db.projects.orderBy('updatedAt').reverse().toArray();
export const getProject = (id: string) => db.projects.get(id);
export const saveProject = (p: Project) => db.projects.put(p);
export async function deleteProject(id: string) {
  await db.transaction('rw', db.projects, db.handles, async () => {
    await db.projects.delete(id);
    await db.handles.delete(id);
  });
}

export async function saveHandle(projectId: string, handle: FileSystemFileHandle) {
  try {
    await db.handles.put({ projectId, handle });
  } catch {
    /* some browsers can't clone handles; relink fallback covers it */
  }
}
export const getHandle = async (projectId: string) => (await db.handles.get(projectId))?.handle;

/** Ask the browser to keep our storage from being evicted under pressure. */
export function requestPersistentStorage() {
  navigator.storage?.persist?.().catch(() => {});
}
