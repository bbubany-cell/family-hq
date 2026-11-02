// "Find the video" prompt. Shown whenever a screen needs a project's video we don't have yet.
import { relinkCancel, relinkPick, useRelink } from '../lib/videoAccess';
import { fmtBytes } from '../lib/util';

export function RelinkModal() {
  const pending = useRelink((s) => s.pending);
  if (!pending) return null;
  const { project } = pending;
  return (
    <div className="modal-back" onClick={relinkCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Find the video</h2>
        <p>
          The app never copies your video, so it needs you to point at it again:
          <br />
          <strong>{project.video.name}</strong> <span className="dim">({fmtBytes(project.video.size)})</span>
          <br />
          <span className="dim small">for "{project.name}"</span>
        </p>
        <div className="row-end">
          <button className="btn" onClick={relinkCancel}>Cancel</button>
          <button className="btn primary" onClick={relinkPick}>Choose file…</button>
        </div>
      </div>
    </div>
  );
}
