# IQ Film Room

Hockey video analysis & teaching. Build hockey IQ, level up.

Browser-based, local-first video breakdown for youth hockey coaching. Works on a laptop and an iPad
(touch + Apple Pencil). No backend, no accounts. **Videos never leave your device.**

## Live site

**https://bbubany-cell.github.io/family-hq/**. Every push to `main` that touches `hockey-film/` redeploys it
automatically (`.github/workflows/deploy-film-room.yml`). No computer needed to use it.

## Run it locally (developers)

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

## Phase 2: hockey highlighting

- **Spotlight (S):** dims everything except a soft circle around a player. Tap for a standard size, or drag to size it.
- **Player marker (M):** a skate ring or numbered dot in your team color or the opponent's, with a name/# tag.
  Team colors are editable and recolor every marker on that team.
- **Trail (W):** draw a route; during playback it draws itself on over N seconds and ends in an arrow.
- **Zone (Z):** slot, high-danger area, neutral zone, blue line, passing lane, or a free area. Drag a box,
  then drag the corner handles to fit the ice.
- **Gap line (G):** drag from one player to another. Ends dropped on a marker or spotlight stick to that
  player and follow him. Double-tap to label it.
- **Follow with Pencil (tracking):** select anything and tap *Follow with Pencil*. Then hold the Pencil on
  the player: the video plays in slow-mo (0.1–1×) while you follow, and pauses when you lift. Press again to
  continue, and re-record any stretch to fix it. While paused you can also drag a tracked shape to set a
  keyframe at that moment. Turn on *Show path skated* to draw the route behind him.
- **Teach mode:** drop red *Stop* flags on the timeline (Shift+S). With *Teach* on, playback pauses on each
  stop (optionally at every drawing too). `<` and `>` jump between stops.

Everything tracked rides along during playback: spotlights, rings, tags, arrows, text, zones and gap lines.

## Phase 3: teaching tools

- **Clips:** in a video, set In/Out (or don't, and it grabs a few seconds around the playhead), then tap
  **Clip**. Give it a name, tags (Breakout, Forecheck, PP, PK, D-zone, Turnover, Goal… or your own) and notes.
  The editor's side panel lists that video's clips; tap one to loop it.
- **Clip library** (Clips tab): every clip from every game. Search names, notes and games, and filter by tag.
  Tap a clip to open it in the editor. Tap the circle to select clips, then **Compare**, **Present** or add them to a **Playlist**.
- **Compare:** two clips side by side (stacked in portrait). With **Sync** on, one set of controls drives both,
  lined up from each clip's start. Turn Sync off to scrub each one on its own. Drawings and tracking show in both.
- **Presentation mode:** a playlist (or any selected clips) plays fullscreen with drawings and no clutter.
  Tap = play/pause, swipe or ←/→ = previous/next clip, Esc = exit. Each clip stops on its last frame
  (or turn on Auto-advance), and teaching stops inside a clip pause it there. Clip notes are one tap away.
- **Rink whiteboard** (Drills tab): full, half or zone view. Place O / X / goalie / coach / puck / cones / nets
  and draw skate, carry (wavy), backward, pass (dashed), shot (double) routes, or plain lines.
  **Draw a route starting on a player and he skates it in the next step.** Starting a pass or shot at the puck
  moves the puck, and a carry brings the puck along. Add steps, add a note per step, and hit play: everyone
  skates their routes. Drills autosave and can be duplicated for variations.

## Phase 4: export & backup

- **Backup & restore** (home screen, top right): one small file with every video's drawings, tracking, clips,
  playlists and drills. Save it to Files/iCloud or share it (AirDrop, Mail). **Restore** merges: anything missing is
  added and anything older is updated; nothing is deleted. The button turns orange if it's been a week (or never).
  Videos aren't in the backup; after restoring on a new device, open each video once to point it at its file.
- **Export one video's work:** the export icon on a video card gives a single-game file (drawings + clips) for an
  assistant coach or another device. Restore it the same way.
- **Frame → PNG:** editor → Export → *This frame as image*. Full video resolution with all drawings burned in.
- **Clip → video:** editor → Export → *In → Out as video*, or the export icon on any clip in the Clips tab.
  Drawings, spotlights and tracking are burned in. Options: normal or slow-mo, a 2–4s freeze at each teaching stop,
  1080p/720p. It records in real time, so keep the app on screen. MP4 on Safari/iPad (and recent Chrome), WebM otherwise. No audio.
- **Whiteboard → image or video:** board → Export. The video plays the whole drill with step notes as captions.

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
  lib/track.ts             tracking: keyframe interpolation, anchors, gap attachment, trail reveal
  lib/zones.ts             zone presets
  lib/util.ts              timing/opacity, helpers
  lib/videoFile.ts         file picking, metadata + thumbnail probe
  hooks/useAutosave.ts     debounced save + flush on hide/close
  hooks/useKeyboard.ts     all shortcuts
  components/
    Library.tsx            home tabs: videos, clips, playlists, drills
    ClipLibrary.tsx, ClipDialog.tsx, ProjectClips.tsx, Playlists.tsx
    ClipPlayer.tsx         read-only clip player (shared by Compare + Present)
    Compare.tsx, Present.tsx
    Board.tsx              rink whiteboard (lib/board.ts = model + route animation)
    RelinkModal.tsx        "find the video" prompt (lib/videoAccess.ts)
    BackupModal.tsx        backup / restore (lib/backup.ts)
    ExportClipModal.tsx    clip → video (lib/exporter.tsx: off-screen scene render + MediaRecorder)
    ExportResult.tsx       Save / Share sheet (lib/saveFile.ts)
    Editor.tsx             editor layout
    VideoStage.tsx         video + Konva canvas, all pointer/pencil/pinch input
    ShapeNode.tsx          renders a shape
    HockeyPanel.tsx        side-panel controls for the hockey tools + Follow with Pencil
    Transport.tsx          scrub bar + playback controls
    Toolbar.tsx, Inspector.tsx, HelpOverlay.tsx, Icon.tsx
```

## Roadmap

- **Maybe later:** auto-tracking assist (tap a player and the app guesses the path for you to correct).
