// Getting files out of the app: plain download (iPad Safari: Files → Downloads) or the system share
// sheet (AirDrop, Messages, Mail, Save to Files). Both need a user tap, so callers build the file
// first and then show the ExportResult sheet with the buttons.

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function canShare(file: File): boolean {
  try {
    return !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

export async function shareFile(file: File): Promise<boolean> {
  try {
    await navigator.share({ files: [file], title: file.name });
    return true;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return false; // user closed the sheet
    throw e;
  }
}

/** Safe file name from a title. */
export const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'iq-film-room';

export const stamp = () => new Date().toISOString().slice(0, 10);
