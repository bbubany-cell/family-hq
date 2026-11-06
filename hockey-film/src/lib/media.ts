// Video element lifecycle helpers.
//
// iPad Safari only allows a few videos to decode at once and is strict about memory. A <video> that is
// removed from the page but still has a `src` keeps its decoder and buffers until garbage collection
// (which can be a long time). Opening a few games or flipping through a playlist then exhausts the
// iPad: new videos refuse to load and Safari kills the tab. So every player in the app sets its source
// when it mounts and fully releases it when it unmounts.

/** Point a video at a source (no-op if already there). */
export function setVideoSource(v: HTMLVideoElement, src: string) {
  if (v.getAttribute('src') !== src) v.src = src;
}

/** Stop decoding and drop the file so the browser frees the decoder and buffers right away. */
export function releaseVideo(v: HTMLVideoElement | null | undefined) {
  if (!v) return;
  try {
    v.pause();
    v.removeAttribute('src');
    v.load(); // with no source this resets the element and releases media resources
  } catch {
    /* already gone */
  }
}
