// Burning drawings into images and videos.
// SceneRenderer mounts the same Konva scene the app shows, off-screen, at the video's native size
// (scale 1, pixel ratio 1). Each frame we draw the video frame, then the annotation layers on top.
// Clip videos are recorded in real time from a canvas with MediaRecorder (MP4 on Safari, WebM elsewhere).
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { Layer as KLayer, Line, Shape as KShape, Stage } from 'react-konva';
import type Konva from 'konva';
import type { Project } from '../types';
import { drawSpotlights, resolveScene, spotRows } from './scene';
import { hasTrack, trailPoints } from './track';
import { ShapeNode } from '../components/ShapeNode';
import { releaseVideo } from './media';

function SceneCanvas({ project, t, onStage }: { project: Project; t: number; onStage: (s: Konva.Stage | null) => void }) {
  const vw = project.video.width || 1920;
  const vh = project.video.height || 1080;
  const visible = resolveScene(project.shapes, project.layers, t);
  const spots = spotRows(visible);
  return (
    <Stage width={vw} height={vh} ref={onStage} listening={false}>
      <KLayer listening={false}>
        <KShape spots={spots} sceneFunc={(c, node) => drawSpotlights(c, node.getAttr('spots'), vw, vh)} />
      </KLayer>
      <KLayer listening={false}>
        {visible
          .filter((v) => v.raw.showTrail && hasTrack(v.raw))
          .map((v) => (
            <Line key={'tr' + v.raw.id} points={trailPoints(v.raw, t)} stroke={v.raw.color} strokeWidth={Math.max(3, v.raw.width * 0.6)}
              dash={[10, 8]} lineCap="round" lineJoin="round" opacity={0.75 * v.opacity} />
          ))}
        {visible.map((v) => (
          <ShapeNode key={v.raw.id} shape={v.shape} opacity={v.opacity} viewScale={1} now={v.raw.kind === 'trail' ? t : undefined} />
        ))}
      </KLayer>
    </Stage>
  );
}

/** Off-screen annotation renderer for one project. Call render(t) per frame, destroy() when done. */
export class SceneRenderer {
  private div: HTMLDivElement;
  private root: Root;
  private stage: Konva.Stage | null = null;
  constructor(private project: Project) {
    this.div = document.createElement('div');
    this.div.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
    document.body.appendChild(this.div);
    this.root = createRoot(this.div);
  }
  /** Draw the annotations for time t onto ctx (sized w × h). */
  drawOnto(ctx: CanvasRenderingContext2D, t: number, w: number, h: number) {
    flushSync(() => this.root.render(<SceneCanvas project={this.project} t={t} onStage={(s) => (this.stage = s)} />));
    const st = this.stage;
    if (!st) return;
    for (const l of st.getLayers()) {
      if (l.getCanvas().getPixelRatio() !== 1) l.getCanvas().setPixelRatio(1);
    }
    st.draw(); // synchronous (react-konva otherwise batches to the next animation frame)
    for (const l of st.getLayers()) ctx.drawImage(l.getNativeCanvasElement(), 0, 0, w, h);
  }
  destroy() {
    this.root.unmount();
    this.div.remove();
  }
}

/** PNG of a video frame with its drawings at full video resolution. */
export async function exportFramePNG(project: Project, video: HTMLVideoElement, t: number): Promise<Blob> {
  const w = video.videoWidth || project.video.width, h = video.videoHeight || project.video.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, w, h);
  const r = new SceneRenderer(project);
  try {
    r.drawOnto(ctx, t, w, h);
  } finally {
    r.destroy();
  }
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not create image'))), 'image/png'));
}

/** Best recording format this browser supports. Safari: MP4 (H.264). Chrome/Firefox: WebM. */
export function pickVideoMime(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const options = [
    { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];
  return options.find((o) => MediaRecorder.isTypeSupported(o.mime)) ?? null;
}

export interface ClipExportOptions {
  project: Project;
  src: string;
  start: number;
  end: number;
  /** Playback speed baked into the export (0.5 = half-speed video). */
  rate: number;
  /** Seconds to freeze on each teaching stop inside the clip (0 = don't). */
  holdAtStops: number;
  /** Output height cap (1080 / 720). */
  maxHeight: number;
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
}

/** Record a clip with drawings burned in. Takes about (clip length / rate + holds) seconds of real time. */
export async function exportClipVideo(o: ClipExportOptions): Promise<{ blob: Blob; ext: string }> {
  const fmt = pickVideoMime();
  if (!fmt) throw new Error("This browser can't record video. Try Safari or Chrome.");

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = o.src;
  video.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;';
  document.body.appendChild(video);
  const renderer = new SceneRenderer(o.project);
  const cleanup = () => { releaseVideo(video); video.remove(); renderer.destroy(); };

  try {
    await once(video, 'loadedmetadata');
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = Math.min(1, o.maxHeight / vh);
    const W = Math.round((vw * scale) / 2) * 2, H = Math.round((vh * scale) / 2) * 2;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const sx = W / (o.project.video.width || vw), sy = H / (o.project.video.height || vh);

    const draw = (t: number) => {
      ctx.drawImage(video, 0, 0, W, H);
      ctx.save();
      ctx.scale(sx, sy);
      renderer.drawOnto(ctx, t, o.project.video.width || vw, o.project.video.height || vh);
      ctx.restore();
    };

    video.currentTime = o.start;
    await once(video, 'seeked');
    draw(o.start);

    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: Math.round(8_000_000 * (H / 1080)) });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.start(250);

    const stops = o.holdAtStops > 0 ? (o.project.stops ?? []).filter((s) => s > o.start + 0.05 && s < o.end - 0.05) : [];
    const dur = o.end - o.start;
    const totalWall = dur / o.rate + stops.length * o.holdAtStops;
    let wallDone = 0;
    const report = (t: number) => o.onProgress(Math.min(1, ((t - o.start) / o.rate + wallDone) / totalWall));

    /** Keep re-drawing a frozen frame (so the recording has frames) for `secs`. */
    const hold = (t: number, secs: number) =>
      new Promise<void>((res) => {
        const t0 = performance.now();
        const tick = () => {
          if (o.signal.aborted) return res();
          draw(t);
          if (performance.now() - t0 >= secs * 1000) res();
          else requestAnimationFrame(tick);
        };
        tick();
      });

    // Play through the clip, freezing at teaching stops.
    let from = o.start;
    for (const stopT of [...stops, o.end]) {
      if (o.signal.aborted) break;
      await playUntil(video, from, stopT, o.rate, (t) => { draw(t); report(t); }, o.signal);
      if (stopT < o.end && !o.signal.aborted) {
        video.currentTime = stopT;
        await once(video, 'seeked');
        await hold(stopT, o.holdAtStops);
        wallDone += o.holdAtStops;
      }
      from = stopT;
    }
    if (!o.signal.aborted) await hold(o.end, 0.4); // a beat on the last frame
    rec.stop();
    await stopped;
    stream.getTracks().forEach((tr) => tr.stop());
    if (o.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
    return { blob: new Blob(chunks, { type: fmt.mime.split(';')[0] }), ext: fmt.ext };
  } finally {
    cleanup();
  }
}

/** Play the video from a to b at a rate, calling onFrame for every presented frame. */
function playUntil(video: HTMLVideoElement, a: number, b: number, rate: number, onFrame: (t: number) => void, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let id = 0, raf = 0;
    const finish = () => {
      video.pause();
      if (id) video.cancelVideoFrameCallback?.(id);
      cancelAnimationFrame(raf);
      resolve();
    };
    const step = (t: number) => {
      if (signal.aborted || t >= b - 0.001 || video.ended) {
        onFrame(Math.min(t, b));
        finish();
        return false;
      }
      onFrame(t);
      return true;
    };
    video.playbackRate = rate;
    const start = () => {
      if (typeof video.requestVideoFrameCallback === 'function') {
        const cb = (_n: number, m: VideoFrameCallbackMetadata) => { if (step(m.mediaTime)) id = video.requestVideoFrameCallback(cb); };
        id = video.requestVideoFrameCallback(cb);
      } else {
        const loop = () => { if (step(video.currentTime)) raf = requestAnimationFrame(loop); };
        raf = requestAnimationFrame(loop);
      }
      video.play().catch(reject);
    };
    if (Math.abs(video.currentTime - a) > 0.05) {
      video.currentTime = a;
      once(video, 'seeked').then(start, reject);
    } else start();
  });
}

function once(el: HTMLElement, ev: string) {
  return new Promise<void>((res, rej) => {
    const ok = () => { cleanup(); res(); };
    const bad = () => { cleanup(); rej(new Error("The video couldn't be read for export.")); };
    const cleanup = () => { el.removeEventListener(ev, ok); el.removeEventListener('error', bad); };
    el.addEventListener(ev, ok, { once: true });
    el.addEventListener('error', bad, { once: true });
  });
}
