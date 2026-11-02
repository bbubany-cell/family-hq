// Getting a project's video file back, from any screen (editor, compare, presentation).
// Order: this session's cache → stored file handle (Chrome/Edge) → ask the user to re-pick it.
// The re-pick prompt is a modal (RelinkModal) driven by this store, so the "Choose file" tap
// is a real user gesture (iPad Safari requires one to open the file picker).
import { create } from 'zustand';
import type { Project } from '../types';
import { getHandle, saveHandle } from '../db/db';
import { fileFromHandle, pickVideo } from './videoFile';
import { fmtBytes } from './util';

const fileCache = new Map<string, File>();
const urlCache = new Map<string, string>();

interface RelinkState {
  pending: { project: Project; resolve: (f: File | null) => void } | null;
}
export const useRelink = create<RelinkState>(() => ({ pending: null }));

export const rememberFile = (projectId: string, file: File) => fileCache.set(projectId, file);
export const forgetFile = (projectId: string) => {
  fileCache.delete(projectId);
  const u = urlCache.get(projectId);
  if (u) URL.revokeObjectURL(u);
  urlCache.delete(projectId);
};

/** Resolve a project's video file, prompting the user if needed. Null if they cancel. */
export async function ensureFile(project: Project): Promise<File | null> {
  const cached = fileCache.get(project.id);
  if (cached) return cached;
  const handle = await getHandle(project.id);
  if (handle) {
    const f = await fileFromHandle(handle);
    if (f) {
      fileCache.set(project.id, f);
      return f;
    }
  }
  return new Promise((resolve) => useRelink.setState({ pending: { project, resolve } }));
}

/** Object URL for a project's video (shared across screens this session; streams from disk). */
export async function ensureUrl(project: Project): Promise<string | null> {
  const u = urlCache.get(project.id);
  if (u && fileCache.has(project.id)) return u;
  const f = await ensureFile(project);
  if (!f) return null;
  const url = URL.createObjectURL(f);
  urlCache.set(project.id, url);
  return url;
}

/** Called from the modal's "Choose file" button (user gesture). */
export async function relinkPick(): Promise<void> {
  const pending = useRelink.getState().pending;
  if (!pending) return;
  const picked = await pickVideo();
  if (!picked) return;
  const p = pending.project;
  if (
    picked.file.size !== p.video.size &&
    !confirm(`That file doesn't match "${p.video.name}" (${fmtBytes(p.video.size)}). Use it anyway? Drawings may not line up.`)
  )
    return;
  if (picked.handle) await saveHandle(p.id, picked.handle);
  fileCache.set(p.id, picked.file);
  useRelink.setState({ pending: null });
  pending.resolve(picked.file);
}

export function relinkCancel() {
  const pending = useRelink.getState().pending;
  useRelink.setState({ pending: null });
  pending?.resolve(null);
}
