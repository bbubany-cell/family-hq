// Bottom transport: scrub bar (with loop range + annotation markers) and playback controls.
import { useMemo, useRef, useState } from 'react';
import { useEditor } from '../store/editorStore';
import {
  RATES,
  gotoStop,
  jump,
  seek,
  setLoop,
  setRate,
  stepFrames,
  togglePlay,
  usePlayer,
} from '../store/playerStore';
import { clamp, fmtTime } from '../lib/util';
import { Icon } from './Icon';

export function Transport() {
  const { currentTime, duration, playing, rate, loop, fps, teach, teachAtDrawings } = usePlayer();
  const shapes = useEditor((s) => s.shapes);
  const stops = useEditor((s) => s.stops);
  const selected = useEditor((s) => s.shapes.find((x) => x.id === s.selectedId));
  const onStop = stops.some((t) => Math.abs(t - currentTime) < 0.15);
  const barRef = useRef<HTMLDivElement>(null);
  const [dragT, setDragT] = useState<number | null>(null);

  // One marker per distinct annotation moment.
  const markers = useMemo(() => [...new Set(shapes.map((s) => Math.round(s.t * 10) / 10))], [shapes]);

  const tAt = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return clamp((clientX - r.left) / r.width, 0, 1) * (duration || 0);
  };

  const onDown = (e: React.PointerEvent) => {
    barRef.current!.setPointerCapture(e.pointerId);
    const t = tAt(e.clientX);
    setDragT(t);
    seek(t);
  };
  const onMove = (e: React.PointerEvent) => {
    if (dragT === null) return;
    const t = tAt(e.clientX);
    setDragT(t);
    seek(t); // throttled internally: one decode in flight, latest wins
  };
  const onUp = (e: React.PointerEvent) => {
    if (dragT === null) return;
    seek(tAt(e.clientX));
    setDragT(null);
  };

  const shown = dragT ?? currentTime;
  const pct = (t: number) => `${duration ? (t / duration) * 100 : 0}%`;
  const hasRange = loop.in !== null && loop.out !== null;

  return (
    <div className="transport">
      <div className="scrub" ref={barRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="scrub-track" />
        {hasRange && (
          <div
            className={'scrub-range' + (loop.enabled ? ' on' : '')}
            style={{ left: pct(loop.in!), width: `calc(${pct(loop.out!)} - ${pct(loop.in!)})` }}
          />
        )}
        {loop.in !== null && !hasRange && <div className="scrub-mark-in" style={{ left: pct(loop.in) }} />}
        <div className="scrub-fill" style={{ width: pct(shown) }} />
        {markers.map((t) => (
          <div key={t} className="scrub-marker" style={{ left: pct(t) }} />
        ))}
        {stops.map((t) => (
          <div key={'s' + t} className="scrub-stop" style={{ left: pct(t) }} />
        ))}
        {selected?.track && selected.track.length > 1 && (
          <div
            className="scrub-track-span"
            style={{ left: pct(selected.track[0].t), width: `calc(${pct(selected.track[selected.track.length - 1].t)} - ${pct(selected.track[0].t)})` }}
          />
        )}
        <div className="scrub-head" style={{ left: pct(shown) }} />
      </div>

      <div className="controls">
        <div className="ctl-group">
          <button className="btn icon" title="Back 5s (J)" onClick={() => jump(-5)}><Icon name="back" /></button>
          <button className="btn icon" title="Previous frame (←)" onClick={() => stepFrames(-1)}><Icon name="prev" /></button>
          <button className="btn icon play" title="Play/Pause (Space / K)" onClick={togglePlay}>
            <Icon name={playing ? 'pause' : 'play'} size={26} />
          </button>
          <button className="btn icon" title="Next frame (→)" onClick={() => stepFrames(1)}><Icon name="next" /></button>
          <button className="btn icon" title="Forward 5s" onClick={() => jump(5)}><Icon name="fwd" /></button>
        </div>

        <div className="time">
          <span>{fmtTime(shown)}</span>
          <span className="dim"> / {fmtTime(duration, false)}</span>
          <span className="dim frame"> · f{Math.floor(shown * fps)}</span>
        </div>

        <div className="ctl-group">
          <button
            className={'btn' + (onStop ? ' active-red' : '')}
            title="Add / remove a teaching stop here (Shift+S)"
            onClick={() => useEditor.getState().toggleStop(currentTime)}
          >
            <Icon name="flag" size={18} /> {onStop ? 'Unstop' : 'Stop'}
          </button>
          <button
            className={'btn' + (teach ? ' active' : '')}
            title="Teach mode: playback pauses at every stop (Shift+T)"
            onClick={() => usePlayer.getState().set({ teach: !teach })}
          >
            <Icon name="teach" size={18} /> Teach
          </button>
          {teach && (
            <>
              <button className="btn icon" title="Previous stop (<)" onClick={() => gotoStop(-1)}>‹</button>
              <button className="btn icon" title="Next stop (>)" onClick={() => gotoStop(1)}>›</button>
              <label className="toggle small-toggle" title="Also stop at every drawing's start">
                <input type="checkbox" checked={teachAtDrawings} onChange={(e) => usePlayer.getState().set({ teachAtDrawings: e.target.checked })} />
                <span>+ drawings</span>
              </label>
            </>
          )}
        </div>

        <div className="ctl-group">
          <select className="btn" value={rate} onChange={(e) => setRate(Number(e.target.value))} title="Speed ([ / ])">
            {RATES.map((r) => (
              <option key={r} value={r}>{r}×</option>
            ))}
          </select>
          <button className="btn" title="Set loop in (I)" onClick={() => setLoop({ in: currentTime })}>In</button>
          <button className="btn" title="Set loop out (O)" onClick={() => setLoop({ out: currentTime, enabled: loop.in !== null ? true : loop.enabled })}>Out</button>
          <button
            className={'btn' + (loop.enabled ? ' active' : '')}
            title="Loop range (Shift+L)"
            disabled={!hasRange}
            onClick={() => setLoop({ enabled: !loop.enabled })}
          >
            <Icon name="loop" size={18} /> Loop
          </button>
          {(loop.in !== null || loop.out !== null) && (
            <button className="btn" title="Clear range" onClick={() => setLoop({ in: null, out: null, enabled: false })}><Icon name="close" size={18} /></button>
          )}
        </div>
      </div>
    </div>
  );
}
