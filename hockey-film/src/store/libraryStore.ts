// Clips + playlists, loaded once and kept in sync with IndexedDB. Small data, so keep it all in memory.
import { create } from 'zustand';
import type { Clip, Playlist } from '../types';
import { deleteClip, deletePlaylist, listClips, listPlaylists, saveClip, savePlaylist } from '../db/db';

interface LibState {
  clips: Clip[];
  playlists: Playlist[];
  loaded: boolean;
  load: () => Promise<void>;
  putClip: (c: Clip) => Promise<void>;
  removeClip: (id: string) => Promise<void>;
  putPlaylist: (p: Playlist) => Promise<void>;
  removePlaylist: (id: string) => Promise<void>;
}

export const useLibrary = create<LibState>((set, get) => ({
  clips: [],
  playlists: [],
  loaded: false,
  load: async () => {
    const [clips, playlists] = await Promise.all([listClips(), listPlaylists()]);
    set({ clips, playlists, loaded: true });
  },
  putClip: async (c) => {
    const clip = { ...c, updatedAt: Date.now() };
    set({ clips: [clip, ...get().clips.filter((x) => x.id !== c.id)] });
    await saveClip(clip);
  },
  removeClip: async (id) => {
    set({
      clips: get().clips.filter((x) => x.id !== id),
      playlists: get().playlists.map((p) => ({ ...p, clipIds: p.clipIds.filter((c) => c !== id) })),
    });
    await deleteClip(id);
  },
  putPlaylist: async (p) => {
    const pl = { ...p, updatedAt: Date.now() };
    set({ playlists: [pl, ...get().playlists.filter((x) => x.id !== p.id)] });
    await savePlaylist(pl);
  },
  removePlaylist: async (id) => {
    set({ playlists: get().playlists.filter((x) => x.id !== id) });
    await deletePlaylist(id);
  },
}));
