// IndexedDB persistence via Dexie. Projects hold annotations + metadata only.
// Video files are NOT stored here (they can be multi-GB); we keep a file handle
// where the browser supports it (Chrome/Edge desktop), otherwise the user re-picks
// the file from their device when reopening a project (we verify name + size).
import Dexie, { type Table } from 'dexie';
import type { Clip, Drill, Playlist, Project } from '../types';

interface HandleRow {
  projectId: string;
  handle: FileSystemFileHandle;
}

class FilmRoomDB extends Dexie {
  projects!: Table<Project, string>;
  handles!: Table<HandleRow, string>;
  clips!: Table<Clip, string>;
  playlists!: Table<Playlist, string>;
  drills!: Table<Drill, string>;
  constructor() {
    super('film-room');
    this.version(1).stores({
      projects: 'id, updatedAt, name',
      handles: 'projectId',
    });
    // Phase 3: clip library, playlists, whiteboard drills. Existing data is untouched.
    this.version(2).stores({
      clips: 'id, projectId, updatedAt, *tags',
      playlists: 'id, updatedAt',
      drills: 'id, updatedAt',
    });
  }
}

export const db = new FilmRoomDB();

export const listProjects = () => db.projects.orderBy('updatedAt').reverse().toArray();
export const getProject = (id: string) => db.projects.get(id);
export const saveProject = (p: Project) => db.projects.put(p);
export async function deleteProject(id: string) {
  await db.transaction('rw', [db.projects, db.handles, db.clips, db.playlists], async () => {
    const clipIds = (await db.clips.where('projectId').equals(id).primaryKeys()) as string[];
    await db.projects.delete(id);
    await db.handles.delete(id);
    await db.clips.bulkDelete(clipIds);
    // Drop the deleted clips from any playlist.
    const gone = new Set(clipIds);
    await db.playlists.toCollection().modify((pl) => {
      pl.clipIds = pl.clipIds.filter((c) => !gone.has(c));
    });
  });
}

// ---- clips ----
export const listClips = () => db.clips.orderBy('updatedAt').reverse().toArray();
export const clipsForProject = (projectId: string) => db.clips.where('projectId').equals(projectId).sortBy('start');
export const saveClip = (c: Clip) => db.clips.put({ ...c, updatedAt: Date.now() });
export async function deleteClip(id: string) {
  await db.transaction('rw', db.clips, db.playlists, async () => {
    await db.clips.delete(id);
    await db.playlists.toCollection().modify((pl) => {
      pl.clipIds = pl.clipIds.filter((c) => c !== id);
    });
  });
}

// ---- playlists ----
export const listPlaylists = () => db.playlists.orderBy('updatedAt').reverse().toArray();
export const savePlaylist = (p: Playlist) => db.playlists.put({ ...p, updatedAt: Date.now() });
export const deletePlaylist = (id: string) => db.playlists.delete(id);

// ---- drills ----
export const listDrills = () => db.drills.orderBy('updatedAt').reverse().toArray();
export const saveDrill = (d: Drill) => db.drills.put(d);
export const deleteDrill = (id: string) => db.drills.delete(id);

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
