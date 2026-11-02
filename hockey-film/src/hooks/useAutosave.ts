// Autosave: any change to annotations, layers, fps, loop range or playhead is written to
// IndexedDB shortly after it happens, and immediately when the tab is hidden/closed.
import { useEffect } from 'react';
import { create } from 'zustand';
import { saveProject } from '../db/db';
import { useEditor } from '../store/editorStore';
import { usePlayer } from '../store/playerStore';

export const useSaveStatus = create<{ status: 'saved' | 'saving' | 'error'; at: number }>(() => ({
  status: 'saved',
  at: Date.now(),
}));

/** Resolves when the most recent save has hit IndexedDB (Library awaits this before listing). */
let lastSave: Promise<unknown> = Promise.resolve();
export const whenSaved = () => lastSave.catch(() => {});

export function useAutosave() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dirty = false;

    const flush = async () => {
      clearTimeout(timer);
      if (!dirty) return;
      dirty = false;
      const ed = useEditor.getState();
      const pl = usePlayer.getState();
      if (!ed.project) return;
      const project = {
        ...ed.project,
        shapes: ed.shapes,
        layers: ed.layers,
        activeLayerId: ed.activeLayerId,
        stops: ed.stops,
        teach: { on: pl.teach, atDrawings: pl.teachAtDrawings },
        fps: pl.fps,
        fpsLocked: pl.fpsLocked,
        loop: pl.loop,
        lastTime: pl.currentTime,
        updatedAt: Date.now(),
      };
      useSaveStatus.setState({ status: 'saving' });
      try {
        lastSave = saveProject(project);
        await lastSave;
        useEditor.setState({ project });
        useSaveStatus.setState({ status: 'saved', at: Date.now() });
      } catch (e) {
        console.error('Autosave failed', e);
        useSaveStatus.setState({ status: 'error' });
        dirty = true;
        timer = setTimeout(flush, 2000); // keep trying
      }
    };

    const schedule = (delay = 400) => {
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    };

    const unsubEd = useEditor.subscribe((s, prev) => {
      if (s.rev !== prev.rev) schedule();
    });
    const unsubPl = usePlayer.subscribe((s, prev) => {
      if (s.loop !== prev.loop || s.fps !== prev.fps || s.fpsLocked !== prev.fpsLocked || s.teach !== prev.teach || s.teachAtDrawings !== prev.teachAtDrawings) schedule();
      // Remember the playhead, but don't hammer the DB during playback.
      else if (s.currentTime !== prev.currentTime && !s.playing) schedule(1500);
    });

    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);

    return () => {
      unsubEd();
      unsubPl();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      void flush();
    };
  }, []);
}
