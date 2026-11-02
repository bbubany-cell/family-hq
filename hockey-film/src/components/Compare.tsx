// Side-by-side compare: two clips (good play vs bad play). Sync drives both from one set of controls,
// lined up from each clip's start; unsynced, each has its own controls.
import { useEffect, useRef, useState } from 'react';
import type { Clip, Project } from '../types';
import { ClipPlayer, type ClipPlayerHandle } from './ClipPlayer';
import { RATES } from '../store/playerStore';
import { clamp, fmtTime } from '../lib/util';
import { Icon } from './Icon';

export interface ClipSource {
  clip: Clip;
  project: Project;
  src: string;
}

export function Compare({ a, b, onExit }: { a: ClipSource; b: ClipSource; onExit: () => void }) {
  const [sides, setSides] = useState<[ClipSource, ClipSource]>([a, b]);
  const [sync, setSync] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [rel, setRel] = useState(0);
  const A = useRef<ClipPlayerHandle>(null);
  const B = useRef<ClipPlayerHandle>(null);
  const both = (fn: (h: ClipPlayerHandle) => void) => [A.current, B.current].forEach((h) => h && fn(h));
  const longest = Math.max(...sides.map((s) => s.clip.end - s.clip.start));

  // While synced and playing: follow A's clock for the master bar and keep B within ~0.1s of A.
  useEffect(() => {
    if (!sync) return;
    const id = setInterval(() => {
      const ra = A.current?.rel() ?? 0;
      setRel(ra);
      if (A.current?.playing() && B.current?.playing()) {
        const rb = B.current.rel();
        const bLen = sides[1].clip.end - sides[1].clip.start;
        if (ra < bLen && Math.abs(rb - ra) > 0.1) B.current.seekRel(ra);
      }
    }, 250);
    return () => clearInterval(id);
  }, [sync, sides]);

  const toggle = () => {
    if (playing) both((h) => h.pause());
    else {
      B.current?.seekRel(A.current?.rel() ?? 0);
      both((h) => h.play());
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
      else if (!sync) return;
      else if (e.key === ' ') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight') both((h) => h.step(1));
      else if (e.key === 'ArrowLeft') both((h) => h.step(-1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const barRef = useRef<HTMLDivElement>(null);
  const scrub = (x: number) => {
    const r = barRef.current!.getBoundingClientRect();
    const t = clamp((x - r.left) / r.width, 0, 1) * longest;
    both((h) => h.seekRel(t));
    setRel(t);
  };

  return (
    <div className="compare">
      <header className="topbar">
        <button className="btn icon ghost" onClick={onExit} aria-label="Back"><Icon name="home" /></button>
        <strong>Compare</strong>
        <div className="spacer" />
        <label className="toggle">
          <input type="checkbox" checked={sync} onChange={(e) => { both((h) => h.pause()); setSync(e.target.checked); }} />
          <span>Sync</span>
        </label>
        <button className="btn" onClick={() => { both((h) => h.pause()); setSides(([x, y]) => [y, x]); }}>
          <Icon name="compare" size={18} /> Swap
        </button>
      </header>

      <div className="compare-panes">
        {sides.map((s, i) => (
          <div key={s.clip.id + i} className="pane">
            <div className="pane-label">
              <b>{s.clip.name}</b>
              {s.clip.tags.map((t) => <span key={t} className="tag">{t}</span>)}
            </div>
            <ClipPlayer
              ref={i === 0 ? A : B}
              src={s.src}
              project={s.project}
              clip={s.clip}
              loop={!sync}
              controls={!sync}
              onPlayingChange={i === 0 ? setPlaying : undefined}
              onEnded={i === 0 && sync ? () => both((h) => h.pause()) : undefined}
            />
          </div>
        ))}
      </div>

      {sync && (
        <div className="transport compare-bar">
          <div
            className="scrub"
            ref={barRef}
            onPointerDown={(e) => { barRef.current!.setPointerCapture(e.pointerId); scrub(e.clientX); }}
            onPointerMove={(e) => e.buttons && scrub(e.clientX)}
          >
            <div className="scrub-track" />
            <div className="scrub-fill" style={{ width: `${(rel / (longest || 1)) * 100}%` }} />
            <div className="scrub-head" style={{ left: `${(rel / (longest || 1)) * 100}%` }} />
          </div>
          <div className="controls">
            <div className="ctl-group">
              <button className="btn icon" onClick={() => both((h) => h.step(-1))} aria-label="Previous frame"><Icon name="prev" /></button>
              <button className="btn icon play" onClick={toggle} aria-label="Play both"><Icon name={playing ? 'pause' : 'play'} size={26} /></button>
              <button className="btn icon" onClick={() => both((h) => h.step(1))} aria-label="Next frame"><Icon name="next" /></button>
              <button className="btn" onClick={() => { both((h) => h.pause()); both((h) => h.seekRel(0)); setRel(0); }}>Restart</button>
            </div>
            <div className="time">{fmtTime(rel)} <span className="dim">/ {fmtTime(longest, false)}</span></div>
            <select className="btn" value={rate} onChange={(e) => { const r = Number(e.target.value); setRate(r); both((h) => h.setRate(r)); }}>
              {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
