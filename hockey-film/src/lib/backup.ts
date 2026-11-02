// Backup / restore: everything Film Room knows (projects with drawings + tracking, clips, playlists,
// drills) in one JSON file. Videos are NOT included — they stay on your device; after restoring on a
// new device you point each project at its video once (same "Find the video" prompt as always).
import { db } from '../db/db';
import type { Clip, Drill, Playlist, Project } from '../types';

export interface BackupFile {
  format: 'film-room-backup';
  version: 1;
  exportedAt: number;
  projects: Project[];
  clips: Clip[];
  playlists: Playlist[];
  drills: Drill[];
}

const LAST_KEY = 'filmroom.lastBackup';
export const lastBackupAt = (): number | null => {
  try {
    const v = localStorage.getItem(LAST_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
};
export const markBackedUp = () => {
  try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch { /* private mode */ }
};

/** Everything, or just one project and its clips. */
export async function buildBackup(projectId?: string): Promise<BackupFile> {
  const [projects, clips, playlists, drills] = await Promise.all([
    projectId ? db.projects.where('id').equals(projectId).toArray() : db.projects.toArray(),
    projectId ? db.clips.where('projectId').equals(projectId).toArray() : db.clips.toArray(),
    projectId ? Promise.resolve([]) : db.playlists.toArray(),
    projectId ? Promise.resolve([]) : db.drills.toArray(),
  ]);
  return { format: 'film-room-backup', version: 1, exportedAt: Date.now(), projects, clips, playlists, drills };
}

export const backupBlob = (b: BackupFile) => new Blob([JSON.stringify(b)], { type: 'application/json' });

export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a Film Room backup (not valid JSON).");
  }
  const b = data as Partial<BackupFile>;
  if (b?.format !== 'film-room-backup' || !Array.isArray(b.projects)) throw new Error("That file isn't a Film Room backup.");
  if ((b.version ?? 0) > 1) throw new Error('This backup is from a newer version of Film Room. Reload the app to update, then try again.');
  return {
    format: 'film-room-backup',
    version: 1,
    exportedAt: b.exportedAt ?? 0,
    projects: b.projects ?? [],
    clips: b.clips ?? [],
    playlists: b.playlists ?? [],
    drills: b.drills ?? [],
  };
}

export interface ImportPlan {
  add: number; // brand-new items
  update: number; // backup copy is newer than what's here
  keep: number; // what's here is the same or newer — left alone
  counts: { projects: number; clips: number; playlists: number; drills: number };
}

type Row = { id: string; updatedAt: number };

async function diff<T extends Row>(rows: T[], existing: (ids: string[]) => Promise<(T | undefined)[]>) {
  const cur = await existing(rows.map((r) => r.id));
  const put: T[] = [];
  let add = 0, update = 0, keep = 0;
  rows.forEach((r, i) => {
    const c = cur[i];
    if (!c) { add++; put.push(r); }
    else if ((r.updatedAt ?? 0) > (c.updatedAt ?? 0)) { update++; put.push(r); }
    else keep++;
  });
  return { put, add, update, keep };
}

/** Work out what a restore would do (newer copy wins, nothing is deleted). Optionally apply it. */
export async function restore(b: BackupFile, apply: boolean): Promise<ImportPlan> {
  const p = await diff(b.projects, (ids) => db.projects.bulkGet(ids));
  const c = await diff(b.clips, (ids) => db.clips.bulkGet(ids));
  const pl = await diff(b.playlists, (ids) => db.playlists.bulkGet(ids));
  const d = await diff(b.drills, (ids) => db.drills.bulkGet(ids));
  if (apply) {
    await db.transaction('rw', [db.projects, db.clips, db.playlists, db.drills], async () => {
      await db.projects.bulkPut(p.put);
      await db.clips.bulkPut(c.put);
      await db.playlists.bulkPut(pl.put);
      await db.drills.bulkPut(d.put);
    });
  }
  const all = [p, c, pl, d];
  return {
    add: all.reduce((s, x) => s + x.add, 0),
    update: all.reduce((s, x) => s + x.update, 0),
    keep: all.reduce((s, x) => s + x.keep, 0),
    counts: { projects: b.projects.length, clips: b.clips.length, playlists: b.playlists.length, drills: b.drills.length },
  };
}
