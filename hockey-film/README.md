# Film Room — hockey video analysis & teaching

Browser-based, local-first video breakdown for youth hockey coaching. Works on a laptop and an iPad
(touch + Apple Pencil). No backend, no accounts. **Videos never leave your device.**

## Run it

```bash
cd hockey-film
npm install
npm run dev          # http://localhost:5173 (also printed with your LAN IP)
```

To use it on an iPad, run `npm run dev` on your laptop. Then open the **Network** URL it prints in Safari on the iPad (both devices need to be on the same Wi-Fi).

Production build (static files you can host anywhere: Netlify, GitHub Pages, a USB stick, etc.):

```bash
npm run build        # outputs dist/
npm run preview      # serve dist/ locally
```

**Install as an app (PWA):** host the `dist/` build over HTTPS. On iPad, open it in Safari, tap Share, then Add to Home Screen.
On desktop Chrome/Edge, use the install icon in the address bar. Once installed it works offline.

## Phase 1 features (current)

- **Load video** (MP4/MOV/WebM) from the device. Playback streams straight from the file, so 2 GB game
  files load instantly and nothing is copied.
- **Player:** play/pause, frame-by-frame, ±1s / ±5s jumps, speed 0.1×–2×, scrub bar, loop an in/out range,
  zoom & pan (pinch, trackpad, wheel, +/−).
- **Drawing tools:** pen, line, arrow, curved arrow (sketch the bend and it snaps to a clean curve), ellipse,
  rectangle, text label, eraser. Color, thickness, solid/dashed. Hold Shift to snap angles and get perfect circles/squares.
- **Timed annotations:** a drawing appears on the frame you drew it and stays up for N seconds (or pin it),
  with optional fade in/out. Yellow ticks on the scrub bar mark annotated moments. Drawing during playback auto-pauses.
- **Editing:** undo/redo, clear frame / clear all, layers (show/hide/lock/rename), select → move,
  resize, drag line/arrow endpoints and the curve's bend point, delete. Double-tap a label to edit it.
- **iPad:** big touch targets, the side panel turns into a drawer, and a "Pencil draws, fingers pan/zoom" toggle.
- **Autosave** to IndexedDB on every change (and when you switch away from the tab). Resumes where you left off.

Press **?** in the editor for the full shortcut list.

## Reopening a project

Projects store drawings, not the video. On Chrome/Edge desktop the app remembers the file and reopens it
(after one permission click). On iPad/Safari you'll be asked to pick the same video again. It checks the name and size so
drawings line up.

## Video format notes

- iPhone/iPad recordings (HEVC .mov) play in Safari. Chrome on Windows may not decode HEVC, so convert to H.264 MP4
  if a file won't open.
- Frame rate is auto-detected during playback (used for frame stepping). Override it in the side panel if needed.

## Code map

```
src/
  types.ts                 data model (shapes in video-pixel coords + timing)
  store/editorStore.ts     shapes, layers, tools, selection, undo/redo (Zustand)
  store/playerStore.ts     playback state + <video> controller (throttled seeking, loop, fps detect)
  db/db.ts                 IndexedDB via Dexie (projects + file handles)
  lib/view.ts              zoom/pan math (screen <-> video coords)
  lib/util.ts              timing/opacity, helpers
  lib/videoFile.ts         file picking, metadata + thumbnail probe
  hooks/useAutosave.ts     debounced save + flush on hide/close
  hooks/useKeyboard.ts     all shortcuts
  components/
    Library.tsx            project list, create / relink / delete
    Editor.tsx             editor layout
    VideoStage.tsx         video + Konva canvas, all pointer/pencil/pinch input
    ShapeNode.tsx          renders a shape
    Transport.tsx          scrub bar + playback controls
    Toolbar.tsx, Inspector.tsx, HelpOverlay.tsx, Icon.tsx
```

## Roadmap

- **Phase 2:** spotlight with keyframes, player markers, animated trails, zone shading, gap lines, auto-pause teaching mode.
- **Phase 3:** clip library + tags, side-by-side compare, presentation playlists, rink whiteboard & drills.
- **Phase 4:** export MP4/WebM/PNG, project backup/import.
