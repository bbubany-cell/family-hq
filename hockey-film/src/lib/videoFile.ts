// Picking video files from the device and reading their metadata. Nothing leaves the device.
import type { VideoMeta } from '../types';

export interface PickedVideo {
  file: File;
  handle?: FileSystemFileHandle;
}

const ACCEPT = 'video/*,.mp4,.mov,.m4v,.webm';

/** Open a file picker. Uses the File System Access API when available so we can reopen later without re-picking. */
export async function pickVideo(): Promise<PickedVideo | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Video', accept: { 'video/*': ['.mp4', '.mov', '.m4v', '.webm'] } }],
      });
      return { file: await handle.getFile(), handle };
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      // fall through to <input> on any other failure
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files?.[0];
      input.remove();
      resolve(file ? { file } : null);
    };
    // Safari fires 'cancel' on newer versions; otherwise the promise just never resolves (harmless).
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    input.click();
  });
}

/** Load metadata (+ a small thumbnail) from a video file. Rejects if the browser can't decode it. */
export function probeVideo(file: File): Promise<{ meta: VideoMeta; thumb?: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    let meta: VideoMeta | null = null;
    const done = (thumb?: string) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      v.load();
      if (meta) resolve({ meta, thumb });
    };
    const timer = setTimeout(() => (meta ? done() : (URL.revokeObjectURL(url), reject(new Error('timeout')))), 8000);
    v.onerror = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(new Error('This browser can\'t play that video format. Try Safari, or convert to H.264 MP4.'));
    };
    v.onloadedmetadata = () => {
      meta = {
        name: file.name,
        size: file.size,
        type: file.type,
        duration: v.duration,
        width: v.videoWidth,
        height: v.videoHeight,
      };
      v.currentTime = Math.min(2, (v.duration || 0) / 10);
    };
    v.onseeked = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 320;
        c.height = Math.round((320 * (v.videoHeight || 9)) / (v.videoWidth || 16));
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
        done(c.toDataURL('image/jpeg', 0.7));
      } catch {
        done();
      }
    };
    v.src = url;
  });
}

/** Get the file back for an existing project via its stored handle (Chrome/Edge). */
export async function fileFromHandle(handle: FileSystemFileHandle): Promise<File | null> {
  try {
    let perm = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
    if (perm !== 'granted') perm = (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied';
    return perm === 'granted' ? await handle.getFile() : null;
  } catch {
    return null;
  }
}
