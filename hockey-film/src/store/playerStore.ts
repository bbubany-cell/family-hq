// Player state + a small controller around the single <video> element.
// Seeks are throttled (one in flight at a time, latest target wins) so scrubbing a
// 20-minute 1080p game file stays responsive instead of queueing hundreds of decodes.
import { create } from 'zustand';
import type { LoopRange } from '../types';
import { clamp, snapFps } from '../lib/util';

export const RATES = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

export interface View {
  zoom: number;
  /** Pan offset in screen px, applied after fit-to-container centering. */
  x: number;
  y: number;
}

interface PlayerState {
  ready: boolean;
  currentTime: number;
  duration: number;
  playing: boolean;
  rate: number;
  fps: number;
  fpsLocked: boolean;
  loop: LoopRange;
  videoW: number;
  videoH: number;
  view: View;
  set: (p: Partial<PlayerState>) => void;
}

export const usePlayer = create<PlayerState>((set) => ({
  ready: false,
  currentTime: 0,
  duration: 0,
  playing: false,
  rate: 1,
  fps: 30,
  fpsLocked: false,
  loop: { in: null, out: null, enabled: false },
  videoW: 1920,
  videoH: 1080,
  view: { zoom: 1, x: 0, y: 0 },
  set: (p) => set(p),
}));

const S = () => usePlayer.getState();

let video: HTMLVideoElement | null = null;
let pendingSeek: number | null = null;
let frameCbId = 0;
let rafId = 0;
const frameDeltas: number[] = [];
let lastMediaTime = -1;

/** Attach the controller to a <video>. Returns a detach function. */
export function attachVideo(el: HTMLVideoElement) {
  video = el;
  const onMeta = () => {
    S().set({ duration: el.duration, videoW: el.videoWidth || 1920, videoH: el.videoHeight || 1080, ready: true });
  };
  const onSeeked = () => {
    if (pendingSeek !== null) {
      const t = pendingSeek;
      pendingSeek = null;
      el.currentTime = t;
      return;
    }
    S().set({ currentTime: el.currentTime });
  };
  const onPlay = () => {
    S().set({ playing: true });
    startTicking();
  };
  const onPause = () => {
    S().set({ playing: false, currentTime: el.currentTime });
    stopTicking();
  };
  const onTimeUpdate = () => {
    if (el.paused && !el.seeking) S().set({ currentTime: el.currentTime });
  };
  const onEnded = () => S().set({ playing: false });

  el.addEventListener('loadedmetadata', onMeta);
  el.addEventListener('seeked', onSeeked);
  el.addEventListener('play', onPlay);
  el.addEventListener('pause', onPause);
  el.addEventListener('timeupdate', onTimeUpdate);
  el.addEventListener('ended', onEnded);
  if (el.readyState >= 1) onMeta();

  return () => {
    stopTicking();
    el.removeEventListener('loadedmetadata', onMeta);
    el.removeEventListener('seeked', onSeeked);
    el.removeEventListener('play', onPlay);
    el.removeEventListener('pause', onPause);
    el.removeEventListener('timeupdate', onTimeUpdate);
    el.removeEventListener('ended', onEnded);
    if (video === el) video = null;
    S().set({ ready: false, playing: false });
  };
}

/** Per-frame loop while playing: publishes currentTime, enforces loop range, detects fps. */
function startTicking() {
  stopTicking();
  const el = video;
  if (!el) return;
  // Older Safari lacks requestVideoFrameCallback; fall back to rAF.
  const useVFC = typeof (el as Partial<HTMLVideoElement>).requestVideoFrameCallback === 'function';

  const tick = (mediaTime: number) => {
    const { loop } = S();
    if (loop.enabled && loop.in !== null && loop.out !== null && loop.out > loop.in && mediaTime >= loop.out) {
      el.currentTime = loop.in;
      mediaTime = loop.in;
    }
    S().set({ currentTime: mediaTime });
  };

  if (useVFC) {
    const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
      detectFps(meta.mediaTime);
      tick(meta.mediaTime);
      frameCbId = el.requestVideoFrameCallback(onFrame);
    };
    frameCbId = el.requestVideoFrameCallback(onFrame);
  } else {
    const loop = () => {
      tick(el.currentTime);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }
}

function stopTicking() {
  if (video && frameCbId) video.cancelVideoFrameCallback?.(frameCbId);
  if (rafId) cancelAnimationFrame(rafId);
  frameCbId = 0;
  rafId = 0;
  lastMediaTime = -1;
}

/** Estimate source fps from the smallest gap between presented frames. */
function detectFps(mediaTime: number) {
  if (S().fpsLocked) return;
  if (lastMediaTime >= 0) {
    const d = mediaTime - lastMediaTime;
    if (d > 0.004 && d < 0.1) frameDeltas.push(d);
  }
  lastMediaTime = mediaTime;
  if (frameDeltas.length >= 40) {
    const sorted = [...frameDeltas].sort((a, b) => a - b);
    const fps = snapFps(1 / sorted[Math.floor(sorted.length * 0.2)]);
    frameDeltas.length = 0;
    if (fps !== S().fps) S().set({ fps });
  }
}

// ---------- Public controls (used by transport, keyboard, and drawing) ----------

export const getVideo = () => video;

export function play() {
  if (!video) return;
  const { loop } = S();
  // If looping and we're outside the range, start from the in point.
  if (loop.enabled && loop.in !== null && loop.out !== null) {
    if (video.currentTime < loop.in || video.currentTime >= loop.out) video.currentTime = loop.in;
  } else if (video.ended) video.currentTime = 0;
  video.play().catch(() => {});
}
export const pause = () => video?.pause();
export const togglePlay = () => (video && !video.paused ? pause() : play());

/** Seek with throttling. `fast` uses fastSeek (keyframe) when available — for live scrubbing. */
export function seek(t: number, fast = false) {
  if (!video) return;
  t = clamp(t, 0, video.duration || 0);
  if (fast && typeof (video as Partial<HTMLVideoElement>).fastSeek === 'function') {
    video.fastSeek(t);
    return;
  }
  if (video.seeking) pendingSeek = t;
  else video.currentTime = t;
  // Optimistic UI so the scrub bar / time read-out feel instant.
  S().set({ currentTime: t });
}

export function jump(delta: number) {
  if (!video) return;
  seek((pendingSeek ?? video.currentTime) + delta);
}

/** Step whole frames. Lands slightly inside the target frame to avoid boundary rounding. */
export function stepFrames(n: number) {
  if (!video) return;
  pause();
  const { fps } = S();
  const base = pendingSeek ?? video.currentTime;
  const frame = Math.floor(base * fps + 0.01);
  seek((frame + n) / fps + 0.3 / fps);
}

export function setRate(rate: number) {
  if (video) video.playbackRate = rate;
  S().set({ rate });
}
export function nudgeRate(dir: 1 | -1) {
  const i = RATES.indexOf(S().rate);
  const next = RATES[clamp((i < 0 ? RATES.indexOf(1) : i) + dir, 0, RATES.length - 1)];
  setRate(next);
}

export function setLoop(p: Partial<LoopRange>) {
  const loop = { ...S().loop, ...p };
  // Keep in < out.
  if (loop.in !== null && loop.out !== null && loop.in > loop.out) [loop.in, loop.out] = [loop.out, loop.in];
  S().set({ loop });
}
