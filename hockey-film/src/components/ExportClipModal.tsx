// Export a clip as a video with drawings burned in: options → progress → Save / Share.
import { useRef, useState } from 'react';
import type { Project } from '../types';
import { exportClipVideo, pickVideoMime } from '../lib/exporter';
import { fileSafe } from '../lib/saveFile';
import { fmtTime } from '../lib/util';
import { ExportResult, type ExportFile } from './ExportResult';

interface Props {
  project: Project;
  src: string;
  start: number;
  end: number;
  name: string;
  onClose: () => void;
}

export function ExportClipModal({ project, src, start, end, name, onClose }: Props) {
  const [rate, setRate] = useState(1);
  const [hold, setHold] = useState(2);
  const [height, setHeight] = useState(1080);
  const [progress, setProgress] = useState<number | null>(null);
  const [file, setFile] = useState<ExportFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const fmt = pickVideoMime();
  const stops = (project.stops ?? []).filter((s) => s > start + 0.05 && s < end - 0.05);
  const est = (end - start) / rate + (hold ? stops.length * hold : 0) + 0.5;

  const go = async () => {
    setErr(null);
    setProgress(0);
    abort.current = new AbortController();
    try {
      const { blob, ext } = await exportClipVideo({
        project, src, start, end, rate, holdAtStops: hold, maxHeight: height,
        onProgress: setProgress, signal: abort.current.signal,
      });
      setFile({
        blob,
        filename: `${fileSafe(name)}.${ext}`,
        note: ext === 'webm' ? 'WebM plays in Chrome and most apps. For iPhone/iPad sharing, export from Safari to get an MP4.' : undefined,
      });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr((e as Error).message);
      setProgress(null);
    }
  };

  if (file) return <ExportResult file={file} onClose={onClose} />;

  return (
    <div className="modal-back" onClick={() => progress === null && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Export video</h2>
        <div className="small">
          <b>{name}</b> · {fmtTime(start)}–{fmtTime(end)} ({fmtTime(end - start)})
        </div>
        {!fmt && <p className="hint err-text">This browser can't record video. Use Safari on iPad or Chrome on a computer.</p>}

        {progress === null ? (
          <>
            <label className="lbl">Speed</label>
            <div className="seg">
              {[1, 0.5, 0.25].map((r) => (
                <button key={r} className={rate === r ? 'active' : ''} onClick={() => setRate(r)}>{r === 1 ? 'Normal' : `${r}× slow-mo`}</button>
              ))}
            </div>
            <label className="lbl">Pause on teaching stops {stops.length ? `(${stops.length} in this clip)` : '(none in this clip)'}</label>
            <div className="seg">
              {[0, 2, 4].map((h) => (
                <button key={h} className={hold === h ? 'active' : ''} disabled={!stops.length} onClick={() => setHold(h)}>{h ? `${h}s` : 'Off'}</button>
              ))}
            </div>
            <label className="lbl">Quality</label>
            <div className="seg">
              {[1080, 720].map((h) => (
                <button key={h} className={height === h ? 'active' : ''} onClick={() => setHeight(h)}>{h}p</button>
              ))}
            </div>
            <p className="hint">
              Records in real time: about {Math.ceil(est)}s. Keep Film Room on screen while it runs. Drawings, spotlights and
              tracking are burned in. No audio.
            </p>
            {err && <p className="hint err-text">{err}</p>}
            <div className="row-end">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={!fmt} onClick={go}>Export</button>
            </div>
          </>
        ) : (
          <>
            <div className="progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <p className="hint">Recording… {Math.round(progress * 100)}%. Keep this screen open.</p>
            <div className="row-end">
              <button className="btn" onClick={() => abort.current?.abort()}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
