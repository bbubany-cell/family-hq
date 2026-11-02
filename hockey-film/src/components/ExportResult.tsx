// "Your file is ready" sheet: preview + Save / Share. Used by every export.
import { useEffect, useMemo, useState } from 'react';
import { canShare, downloadBlob, shareFile } from '../lib/saveFile';
import { fmtBytes } from '../lib/util';
import { Icon } from './Icon';

export interface ExportFile {
  blob: Blob;
  filename: string;
  note?: string;
}

export function ExportResult({ file, onClose, onSaved }: { file: ExportFile; onClose: () => void; onSaved?: () => void }) {
  const f = useMemo(() => new File([file.blob], file.filename, { type: file.blob.type }), [file]);
  // Preview URL is created and revoked by the same effect (safe under React's double-invoked effects).
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const [msg, setMsg] = useState<string | null>(null);
  const isImg = file.blob.type.startsWith('image/');
  const isVid = file.blob.type.startsWith('video/');

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Ready</h2>
        {isImg && url && <img className="export-preview" src={url} alt="Export preview" />}
        {isVid && url && <video className="export-preview" src={url} controls playsInline />}
        <div>
          <strong className="ellipsis">{file.filename}</strong> <span className="dim small">{fmtBytes(file.blob.size)}</span>
        </div>
        {file.note && <p className="hint">{file.note}</p>}
        {msg && <p className="hint">{msg}</p>}
        <div className="row-end wrap">
          <button className="btn" onClick={onClose}>Close</button>
          <button
            className="btn"
            onClick={() => {
              downloadBlob(file.blob, file.filename);
              setMsg('Saved. On iPad it lands in Files → Downloads.');
              onSaved?.();
            }}
          >
            <Icon name="down" size={18} /> Save to device
          </button>
          {canShare(f) && (
            <button
              className="btn primary"
              onClick={async () => {
                try {
                  if (await shareFile(f)) { setMsg('Shared.'); onSaved?.(); }
                } catch (e) {
                  setMsg('Share failed: ' + (e as Error).message);
                }
              }}
            >
              <Icon name="share" size={18} /> Share…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
