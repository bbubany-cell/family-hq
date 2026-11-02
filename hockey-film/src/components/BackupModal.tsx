// Back up everything to a file / restore from one.
import { useEffect, useRef, useState } from 'react';
import { backupBlob, buildBackup, markBackedUp, parseBackup, restore, type BackupFile, type ImportPlan } from '../lib/backup';
import { fileSafe, stamp } from '../lib/saveFile';
import { ExportResult, type ExportFile } from './ExportResult';
import { Icon } from './Icon';

export function BackupModal({ onClose, onRestored }: { onClose: () => void; onRestored: () => void }) {
  const [file, setFile] = useState<ExportFile | null>(null);
  const [counts, setCounts] = useState<BackupFile | null>(null);
  const [pending, setPending] = useState<{ b: BackupFile; plan: ImportPlan; name: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Build the backup right away so the Save/Share tap is still a direct user gesture (iPad needs that).
  useEffect(() => {
    buildBackup().then(setCounts);
  }, []);

  const pick = async (f: File) => {
    setErr(null);
    setMsg(null);
    try {
      const b = parseBackup(await f.text());
      setPending({ b, plan: await restore(b, false), name: f.name });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (file) return <ExportResult file={file} onClose={onClose} onSaved={markBackedUp} />;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Backup &amp; restore</h2>

        <section className="backup-box">
          <strong>Back up everything</strong>
          <p className="hint">
            Drawings, tracking, clips, playlists and drills in one small file. Save it to iCloud Drive or AirDrop it
            to yourself. Videos aren't included; they stay on this device.
          </p>
          {counts && (
            <p className="small">
              {counts.projects.length} videos · {counts.clips.length} clips · {counts.playlists.length} playlists · {counts.drills.length} drills
            </p>
          )}
          <button
            className="btn primary"
            disabled={!counts}
            onClick={() => counts && setFile({ blob: backupBlob(counts), filename: `film-room-backup-${stamp()}.json` })}
          >
            <Icon name="backup" size={18} /> Create backup file
          </button>
        </section>

        <section className="backup-box">
          <strong>Restore from a backup</strong>
          <p className="hint">Adds anything missing and updates anything older. Nothing here gets deleted.</p>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }}
          />
          {!pending && <button className="btn" onClick={() => input.current?.click()}>Choose backup file…</button>}
          {pending && (
            <>
              <p className="small">
                <b>{pending.name}</b>
                <br />
                {pending.plan.counts.projects} videos · {pending.plan.counts.clips} clips · {pending.plan.counts.playlists} playlists · {pending.plan.counts.drills} drills
                <br />
                <span className="dim">
                  {pending.plan.add} new · {pending.plan.update} newer than yours · {pending.plan.keep} already up to date
                </span>
              </p>
              <div className="row-inline">
                <button className="btn" onClick={() => setPending(null)}>Cancel</button>
                <button
                  className="btn primary"
                  disabled={pending.plan.add + pending.plan.update === 0}
                  onClick={async () => {
                    try {
                      const r = await restore(pending.b, true);
                      setPending(null);
                      setMsg(`Restored ${r.add} new and ${r.update} updated item(s). Open each video once to point it at its file.`);
                      onRestored();
                    } catch (e) {
                      setErr((e as Error).message);
                    }
                  }}
                >
                  Restore
                </button>
              </div>
            </>
          )}
          {msg && <p className="hint ok-text">{msg}</p>}
          {err && <p className="hint err-text">{err}</p>}
        </section>

        <div className="row-end">
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

/** One project + its clips, for moving a single game to another device or sharing with an assistant coach. */
export async function projectExportFile(projectId: string, name: string): Promise<ExportFile> {
  const b = await buildBackup(projectId);
  return {
    blob: backupBlob(b),
    filename: `${fileSafe(name)}.film-room.json`,
    note: 'Drawings, tracking and clips for this video. Restore it with Backup → Restore. The video file itself is not included.',
  };
}
