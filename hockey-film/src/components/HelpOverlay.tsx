const ROWS: [string, string][] = [
  ['Space / K', 'Play / pause'],
  ['← → (or , .)', 'Step one frame'],
  ['Shift + ← →', 'Jump 1 second'],
  ['↑ ↓ / J', 'Jump ±5 seconds (J = back)'],
  ['L', 'Play (press again to speed up)'],
  ['[ ]', 'Slower / faster'],
  ['I / O', 'Set loop in / out'],
  ['Shift + L', 'Loop on/off'],
  ['Home / End', 'Start / end of video'],
  ['D', 'Toggle draw ↔ select'],
  ['V H P N A C E R T X', 'Select, Pan, Pen, liNe, Arrow, Curve, Ellipse, Rect, Text, eraser'],
  ['S M W Z G', 'Spotlight, Marker, trail (W), Zone, Gap line'],
  ['1 – 9', 'Tools by position'],
  ['Shift + S', 'Add / remove a teaching stop here'],
  ['Shift + T', 'Teach mode on/off (auto-pause at stops)'],
  ['< / >', 'Previous / next stop'],
  ['Esc', 'Stop following / deselect'],
  ['Shift (while drawing)', 'Snap angle / perfect circle & square'],
  ['Delete', 'Delete selected drawing'],
  ['Shift + Delete', 'Clear drawings on this frame'],
  ['Ctrl/⌘ Z, Shift+Ctrl/⌘ Z', 'Undo / redo'],
  ['+ / − / 0', 'Zoom in / out / reset'],
  ['Pinch, wheel, trackpad', 'Zoom & pan the video'],
  ['F', 'Fullscreen'],
  ['\\', 'Show / hide side panel'],
  ['?', 'This help'],
];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Shortcuts</h2>
        <table className="keys">
          <tbody>
            {ROWS.map(([k, d]) => (
              <tr key={k}>
                <td><kbd>{k}</kbd></td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="dim small">
          Drawings start on the frame you draw them and stay up for the "On screen for" time (or pin them). Double-tap a text
          label in Select mode to edit it. Curved arrow: just sketch the bend — it snaps to a clean curve.
          To make anything follow a player: select it, tap <b>Follow with Pencil</b>, then hold the Pencil on the
          player while the video plays in slow-mo. Lift to pause, press again to keep going.
        </p>
        <button className="btn primary" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
