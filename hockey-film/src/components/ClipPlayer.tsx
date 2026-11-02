// Read-only player for one clip: plays only [start, end] of a project's video with all its drawings,
// tracking and spotlights. Used by side-by-side Compare and Presentation mode.
// Imperative handle lets a parent drive it (sync two players, next/prev in a playlist).
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { Group, Layer as KLayer, Line, Shape as KShape, Stage } from 'react-konva';
import type { Clip, Project } from '../types';
import { computeTransform } from '../lib/view';
import { drawSpotlights, resolveScene, spotRows } from '../lib/scene';
import { hasTrack, trailPoints } from '../lib/track';
import { clamp, fmtTime } from '../lib/util';
import { RATES } from '../store/playerStore';
import { ShapeNode } from './ShapeNode';
import { Icon } from './Icon';

export interface ClipPlayerHandle {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Seek to a time relative to the clip start (seconds). */
  seekRel: (r: number) => void;
  step: (frames: number) => void;
  setRate: (r: number) => void;
  rel: () => number;
  playing: () => boolean;
}

interface Props {
  ref?: Ref<ClipPlayerHandle>;
  src: string;
  project: Project;
  clip: Pick<Clip, 'start' | 'end'>;
  /** Loop the clip (compare) or stop at the end (presentation). */
  loop?: boolean;
  /** Pause at the project's teaching stops inside the clip. */
  teach?: boolean;
  /** Show this player's own transport bar. */
  controls?: boolean;
  autoPlay?: boolean;
  onEnded?: () => void;
  onPlayingChange?: (playing: boolean) => void;
}

export function ClipPlayer({ ref, src, project, clip, loop, teach, controls = true, autoPlay, onEnded, onPlayingChange }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [t, setT] = useState(clip.start);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(1);
  const lastT = useRef(clip.start);
  // Callbacks via refs so a parent re-render never restarts the playback loop.
  const cbs = useRef({ onEnded, onPlayingChange });
  cbs.current = { onEnded, onPlayingChange };
  const vw = project.video.width || 1920;
  const vh = project.video.height || 1080;
  const fps = project.fps || 30;
  const stops = useMemo(() => (project.stops ?? []).filter((s) => s > clip.start + 0.05 && s < clip.end - 0.05), [project.stops, clip]);

  useLayoutEffect(() => {
    const el = boxRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Start at the clip's first frame.
  useEffect(() => {
    const v = videoRef.current!;
    const init = () => {
      v.currentTime = clip.start;
      lastT.current = clip.start;
      setT(clip.start);
      if (autoPlay) v.play().catch(() => {});
    };
    if (v.readyState >= 1) init();
    else v.addEventListener('loadedmetadata', init, { once: true });
    return () => v.removeEventListener('loadedmetadata', init);
  }, [src, clip.start, clip.end]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-frame loop while playing: publish time, enforce the clip range and teaching stops.
  useEffect(() => {
    const v = videoRef.current!;
    let id = 0;
    let raf = 0;
    const tick = (now: number) => {
      const from = lastT.current;
      if (teach) {
        const stop = stops.find((s) => s > from + 1e-3 && s <= now + 1e-3);
        if (stop !== undefined) {
          v.pause();
          v.currentTime = stop;
          lastT.current = stop;
          setT(stop);
          return false;
        }
      }
      if (now >= clip.end) {
        if (loop) {
          v.currentTime = clip.start;
          lastT.current = clip.start;
          setT(clip.start);
          return true;
        }
        v.pause();
        v.currentTime = clip.end;
        lastT.current = clip.end;
        setT(clip.end);
        cbs.current.onEnded?.();
        return false;
      }
      lastT.current = now;
      setT(now);
      return true;
    };
    const onPlay = () => {
      setPlaying(true);
      cbs.current.onPlayingChange?.(true);
      if (typeof v.requestVideoFrameCallback === 'function') {
        const cb = (_n: number, m: VideoFrameCallbackMetadata) => { if (tick(m.mediaTime)) id = v.requestVideoFrameCallback(cb); };
        id = v.requestVideoFrameCallback(cb);
      } else {
        const loopFn = () => { if (tick(v.currentTime)) raf = requestAnimationFrame(loopFn); };
        raf = requestAnimationFrame(loopFn);
      }
    };
    const onPause = () => {
      setPlaying(false);
      cbs.current.onPlayingChange?.(false);
      if (id) v.cancelVideoFrameCallback?.(id);
      cancelAnimationFrame(raf);
      setT(v.currentTime);
      lastT.current = v.currentTime;
    };
    const onSeeked = () => { if (v.paused) { setT(v.currentTime); lastT.current = v.currentTime; } };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked);
    if (!v.paused) onPlay(); // settings changed mid-playback: restart the frame loop
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', onSeeked);
      if (id) v.cancelVideoFrameCallback?.(id);
      cancelAnimationFrame(raf);
    };
  }, [clip.start, clip.end, loop, teach, stops]);

  const api: ClipPlayerHandle = {
    play: () => {
      const v = videoRef.current!;
      if (v.currentTime >= clip.end - 0.02) { v.currentTime = clip.start; lastT.current = clip.start; }
      else lastT.current = v.currentTime;
      v.play().catch(() => {});
    },
    pause: () => videoRef.current?.pause(),
    toggle: () => (videoRef.current?.paused ? api.play() : api.pause()),
    seekRel: (r) => {
      const v = videoRef.current!;
      const target = clamp(clip.start + r, clip.start, clip.end);
      v.currentTime = target;
      lastT.current = target;
      setT(target);
    },
    step: (n) => {
      const v = videoRef.current!;
      v.pause();
      const frame = Math.floor(v.currentTime * fps + 0.01);
      api.seekRel((frame + n) / fps + 0.3 / fps - clip.start);
    },
    setRate: (r) => {
      videoRef.current!.playbackRate = r;
      setRateState(r);
    },
    rel: () => (videoRef.current?.currentTime ?? clip.start) - clip.start,
    playing: () => !!videoRef.current && !videoRef.current.paused,
  };
  useImperativeHandle(ref, () => api);

  const T = computeTransform(size.w, size.h, vw, vh, { zoom: 1, x: 0, y: 0 });
  const visible = useMemo(() => resolveScene(project.shapes, project.layers, t), [project, t]);
  const spots = spotRows(visible);
  const dur = clip.end - clip.start;

  // Scrub within the clip.
  const barRef = useRef<HTMLDivElement>(null);
  const scrubTo = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    api.seekRel(clamp((clientX - r.left) / r.width, 0, 1) * dur);
  };

  return (
    <div className="clip-player">
      <div ref={boxRef} className="cp-stage">
        <video
          ref={videoRef}
          src={src}
          playsInline
          preload="auto"
          className="stage-video"
          style={{ width: vw, height: vh, transform: `translate(${T.tx}px, ${T.ty}px) scale(${T.scale})` }}
        />
        {size.w > 0 && (
          <Stage width={size.w} height={size.h} className="stage-canvas" listening={false}>
            {spots.length > 0 && (
              <KLayer listening={false}>
                <Group x={T.tx} y={T.ty} scaleX={T.scale} scaleY={T.scale}>
                  <KShape spots={spots} sceneFunc={(c, node) => drawSpotlights(c, node.getAttr('spots'), vw, vh)} />
                </Group>
              </KLayer>
            )}
            <KLayer listening={false}>
              <Group x={T.tx} y={T.ty} scaleX={T.scale} scaleY={T.scale}>
                {visible
                  .filter((v) => v.raw.showTrail && hasTrack(v.raw))
                  .map((v) => (
                    <Line key={'tr' + v.raw.id} points={trailPoints(v.raw, t)} stroke={v.raw.color} strokeWidth={Math.max(3, v.raw.width * 0.6)}
                      dash={[10, 8]} lineCap="round" lineJoin="round" opacity={0.75 * v.opacity} />
                  ))}
                {visible.map((v) => (
                  <ShapeNode key={v.raw.id} shape={v.shape} opacity={v.opacity} viewScale={T.scale} now={v.raw.kind === 'trail' ? t : undefined} />
                ))}
              </Group>
            </KLayer>
          </Stage>
        )}
      </div>
      {controls && (
        <div className="cp-bar">
          <button className="btn icon" onClick={() => api.step(-1)} aria-label="Previous frame"><Icon name="prev" /></button>
          <button className="btn icon play" onClick={api.toggle} aria-label="Play/pause"><Icon name={playing ? 'pause' : 'play'} /></button>
          <button className="btn icon" onClick={() => api.step(1)} aria-label="Next frame"><Icon name="next" /></button>
          <div
            className="cp-scrub"
            ref={barRef}
            onPointerDown={(e) => { barRef.current!.setPointerCapture(e.pointerId); scrubTo(e.clientX); }}
            onPointerMove={(e) => e.buttons && scrubTo(e.clientX)}
          >
            <div className="cp-fill" style={{ width: `${(clamp(t - clip.start, 0, dur) / (dur || 1)) * 100}%` }} />
            {stops.map((s) => <div key={s} className="scrub-stop" style={{ left: `${((s - clip.start) / dur) * 100}%` }} />)}
          </div>
          <span className="time small">{fmtTime(clamp(t - clip.start, 0, dur))}</span>
          <select className="btn small" value={rate} onChange={(e) => api.setRate(Number(e.target.value))} aria-label="Speed">
            {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
