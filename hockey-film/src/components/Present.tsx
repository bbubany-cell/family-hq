// Presentation mode: a playlist of clips, fullscreen, no clutter.
// Tap = play/pause (and shows controls briefly). Swipe or ←/→ = previous/next clip. Esc = exit.
// Each clip stops on its last frame (you control the pace) unless Auto-advance is on.
// Teaching stops inside a clip pause playback there.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipPlayer, type ClipPlayerHandle } from './ClipPlayer';
import type { ClipSource } from './Compare';
import { Icon } from './Icon';

export function Present({ items, onExit }: { items: ClipSource[]; onExit: () => void }) {
  const [i, setI] = useState(0);
  const [ended, setEnded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [auto, setAuto] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const player = useRef<ClipPlayerHandle>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cur = items[i];

  const poke = useCallback(() => {
    setChrome(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChrome(false), 2500);
  }, []);
  useEffect(() => { poke(); return () => clearTimeout(hideTimer.current); }, [poke]);

  const go = useCallback((d: number) => {
    setI((x) => Math.max(0, Math.min(items.length - 1, x + d)));
    setEnded(false);
    poke();
  }, [items.length, poke]);

  const onEnded = useCallback(() => {
    setEnded(true);
    setChrome(true);
    if (auto && i < items.length - 1) setTimeout(() => go(1), 800);
  }, [auto, i, items.length, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
      else if (e.key === ' ' || e.key === 'k') { e.preventDefault(); player.current?.toggle(); poke(); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
      else if (e.key === 'r') { player.current?.seekRel(0); player.current?.play(); setEnded(false); }
      else if (e.key === '.') player.current?.step(1);
      else if (e.key === ',') player.current?.step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onExit, poke]);

  // Swipe left/right for next/previous.
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);

  return (
    <div
      className={'present' + (chrome ? '' : ' hide-chrome')}
      onPointerMove={(e) => e.pointerType === 'mouse' && poke()}
      onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY, t: Date.now() }; }}
      onPointerUp={(e) => {
        const s = swipe.current;
        swipe.current = null;
        if (!s || (e.target as HTMLElement).closest('.present-ui')) return;
        const dx = e.clientX - s.x, dy = e.clientY - s.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - s.t < 600) go(dx < 0 ? 1 : -1);
        else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) { player.current?.toggle(); setEnded(false); poke(); }
      }}
    >
      <ClipPlayer
        key={cur.clip.id + ':' + i}
        ref={player}
        src={cur.src}
        project={cur.project}
        clip={cur.clip}
        teach
        autoPlay
        controls={false}
        onEnded={onEnded}
        onPlayingChange={(p) => { setPlaying(p); if (p) setEnded(false); }}
      />

      <div className="present-ui present-top">
        <span className="pill">{i + 1} / {items.length}</span>
        <span className="pill title">{cur.clip.name}</span>
        {cur.clip.tags.map((t) => <span key={t} className="pill tag-pill">{t}</span>)}
        <div className="spacer" />
        {cur.clip.notes && (
          <button className={'pill btn-pill' + (showNotes ? ' on' : '')} onClick={() => setShowNotes((s) => !s)}>Notes</button>
        )}
        <button className="pill btn-pill" onClick={onExit} aria-label="Exit"><Icon name="close" size={18} /></button>
      </div>
      {showNotes && cur.clip.notes && <div className="present-ui present-notes">{cur.clip.notes}</div>}

      {ended && i < items.length - 1 && !auto && (
        <button className="present-ui present-next" onClick={() => go(1)}>
          Next clip <Icon name="next" size={22} />
        </button>
      )}
      {ended && i === items.length - 1 && <div className="present-ui present-done">End of playlist</div>}

      <div className="present-ui present-bottom">
        <button className="btn icon" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous clip"><Icon name="back" /></button>
        <button className="btn icon" onClick={() => player.current?.step(-1)} aria-label="Previous frame"><Icon name="prev" /></button>
        <button className="btn icon play" onClick={() => { player.current?.toggle(); setEnded(false); poke(); }} aria-label="Play/pause">
          <Icon name={playing ? 'pause' : 'play'} size={26} />
        </button>
        <button className="btn icon" onClick={() => player.current?.step(1)} aria-label="Next frame"><Icon name="next" /></button>
        <button className="btn icon" onClick={() => go(1)} disabled={i === items.length - 1} aria-label="Next clip"><Icon name="fwd" /></button>
        <button className="btn" onClick={() => { player.current?.seekRel(0); player.current?.play(); setEnded(false); }}>Replay</button>
        <label className="toggle small-toggle">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span>Auto-advance</span>
        </label>
      </div>
    </div>
  );
}
