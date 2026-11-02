// Global keyboard shortcuts for the editor. See HelpOverlay for the list shown to the user.
import { useEffect } from 'react';
import { useEditor } from '../store/editorStore';
import { gotoStop, jump, nudgeRate, play, seek, setLoop, stepFrames, togglePlay, usePlayer, getVideo } from '../store/playerStore';
import { isTypingTarget, shapeOpacity } from '../lib/util';
import type { Tool } from '../types';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select', h: 'hand', p: 'pen', n: 'line', a: 'arrow', c: 'curve', e: 'ellipse', r: 'rect', t: 'text', x: 'eraser',
  s: 'spotlight', m: 'marker', w: 'trail', z: 'zone', g: 'gap',
};
const TOOL_ORDER: Tool[] = ['select', 'hand', 'pen', 'line', 'arrow', 'curve', 'ellipse', 'rect', 'text', 'eraser'];

interface Handlers {
  toggleHelp: () => void;
  togglePanel: () => void;
  toggleFullscreen: () => void;
  zoomBy: (factor: number) => void;
}

export function useKeyboard(h: Handlers) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const ed = useEditor.getState();
      const pl = usePlayer.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      // Undo / redo
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? ed.redo() : ed.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); ed.redo(); return; }
      if (mod) return; // leave other browser shortcuts alone

      let handled = true;
      switch (k) {
        // ---- playback ----
        case ' ': togglePlay(); break;
        case 'k': togglePlay(); break;
        case 'j': jump(-5); break;
        case 'l':
          if (e.shiftKey) {
            if (pl.loop.in !== null && pl.loop.out !== null) setLoop({ enabled: !pl.loop.enabled });
          } else if (pl.playing) nudgeRate(1);
          else play();
          break;
        case 'ArrowLeft': case ',': e.shiftKey ? jump(-1) : stepFrames(-1); break;
        case 'ArrowRight': case '.': e.shiftKey ? jump(1) : stepFrames(1); break;
        case 'ArrowUp': jump(5); break;
        case 'ArrowDown': jump(-5); break;
        case 'Home': seek(0); break;
        case 'End': seek(pl.duration); break;
        case '[': nudgeRate(-1); break;
        case ']': nudgeRate(1); break;
        case 'i': setLoop({ in: getVideo()?.currentTime ?? pl.currentTime }); break;
        case 'o': setLoop({ out: getVideo()?.currentTime ?? pl.currentTime, enabled: pl.loop.in !== null ? true : pl.loop.enabled }); break;

        // ---- teaching ----
        case '<': gotoStop(-1); break;
        case '>': gotoStop(1); break;

        // ---- tools ----
        case 'd': ed.toggleDraw(); break;
        case 'Escape':
          if (ed.followArmed) ed.armFollow(false);
          else if (ed.selectedId) ed.select(null);
          else ed.setTool('select');
          break;
        case 'Delete':
        case 'Backspace':
          if (e.shiftKey) {
            // Clear everything visible on this frame.
            const now = pl.currentTime;
            ed.clearAll((s) => shapeOpacity(s, now) > 0);
          } else ed.deleteSelected();
          break;

        // ---- view ----
        case '=': case '+': h.zoomBy(1.25); break;
        case '-': case '_': h.zoomBy(0.8); break;
        case '0': pl.set({ view: { zoom: 1, x: 0, y: 0 } }); break;
        case 'f': h.toggleFullscreen(); break;
        case '?': h.toggleHelp(); break;
        case '\\': h.togglePanel(); break;

        default:
          if (e.shiftKey && k === 's') ed.toggleStop(getVideo()?.currentTime ?? pl.currentTime);
          else if (e.shiftKey && k === 't') pl.set({ teach: !pl.teach });
          else if (TOOL_KEYS[k] && !e.shiftKey) ed.setTool(TOOL_KEYS[k]);
          else if (/^[1-9]$/.test(k)) ed.setTool(TOOL_ORDER[Number(k) - 1]);
          else handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [h]);
}
