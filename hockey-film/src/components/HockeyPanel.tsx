// Inspector sections for the Phase 2 hockey tools: marker team/style/label, spotlight dim,
// zone presets, trail draw-on speed, gap label, and tracking (Follow with Pencil / keyframes).
import { useEditor } from '../store/editorStore';
import { getVideo, usePlayer } from '../store/playerStore';
import { fmtTime } from '../lib/util';
import { offsetAt } from '../lib/track';
import { ZONES } from '../lib/zones';
import type { Shape, Team, ZonePreset } from '../types';
import { Icon } from './Icon';

export function HockeyPanel() {
  const ed = useEditor();
  const sel = ed.shapes.find((s) => s.id === ed.selectedId);
  const tool = ed.tool;
  const kind = sel?.kind ?? tool;
  const patch = (p: Partial<Shape>, key: string) => sel && ed.updateShape(sel.id, p, { coalesce: key });

  return (
    <>
      {sel && <TrackSection shape={sel} />}

      {kind === 'marker' && (
        <section>
          <label className="lbl">Team</label>
          <div className="team-row">
            {(['us', 'them'] as Team[]).map((t) => {
              const active = (sel?.kind === 'marker' ? sel.team : ed.markerTeam) === t;
              return (
                <div key={t} className={'team-chip' + (active ? ' active' : '')}>
                  <button
                    onClick={() => {
                      ed.setHockey({ markerTeam: t });
                      if (sel?.kind === 'marker') patch({ team: t, color: ed.teamColors[t] } as Partial<Shape>, 'team');
                    }}
                  >
                    <span className="dot big" style={{ background: ed.teamColors[t] }} />
                    {t === 'us' ? 'Us' : 'Them'}
                  </button>
                  <label className="team-color" title="Team color">
                    <input type="color" value={ed.teamColors[t]} onChange={(e) => ed.recolorTeam(t, e.target.value)} />
                  </label>
                </div>
              );
            })}
          </div>
          <div className="seg">
            {(['ring', 'dot'] as const).map((v) => (
              <button
                key={v}
                className={(sel?.kind === 'marker' ? sel.variant : ed.markerVariant) === v ? 'active' : ''}
                onClick={() => {
                  ed.setHockey({ markerVariant: v });
                  if (sel?.kind === 'marker') patch({ variant: v } as Partial<Shape>, 'variant');
                }}
              >
                {v === 'ring' ? 'Skate ring' : 'Numbered dot'}
              </button>
            ))}
          </div>
          {sel?.kind === 'marker' && (
            <input
              className="field"
              placeholder="Name or # (e.g. 17 or Parker)"
              value={sel.label}
              onChange={(e) => patch({ label: e.target.value } as Partial<Shape>, 'label')}
            />
          )}
          {!sel && <p className="hint">Tap a player's skates to drop a ring (drag to size it).</p>}
        </section>
      )}

      {kind === 'spotlight' && (
        <section>
          <label className="lbl">
            Darken the rest <span className="dim">{Math.round((sel?.kind === 'spotlight' ? sel.dim : ed.spotlightDim) * 100)}%</span>
          </label>
          <input
            type="range" min={0.2} max={0.9} step={0.05}
            value={sel?.kind === 'spotlight' ? sel.dim : ed.spotlightDim}
            onChange={(e) => {
              const dim = Number(e.target.value);
              ed.setHockey({ spotlightDim: dim });
              if (sel?.kind === 'spotlight') patch({ dim } as Partial<Shape>, 'dim');
            }}
          />
          {!sel && <p className="hint">Tap a player for a standard spotlight, or drag to size it.</p>}
        </section>
      )}

      {kind === 'zone' && (!sel || ed.justDrawn) && (
        <section>
          <label className="lbl">Zone</label>
          <div className="chips">
            {(Object.keys(ZONES) as ZonePreset[]).map((z) => (
              <button
                key={z}
                className={'chip' + (ed.zonePreset === z ? ' active' : '')}
                onClick={() => ed.setHockey({ zonePreset: z })}
              >
                <span className="dot" style={{ background: ZONES[z].color }} /> {ZONES[z].label}
              </button>
            ))}
          </div>
          <p className="hint">
            {ed.zonePreset === 'lane' ? 'Drag from the passer to the target.' : 'Drag a box over the area, then switch to Select and drag the corners to fit the ice.'}
          </p>
        </section>
      )}

      {kind === 'trail' && (
        <section>
          <label className="lbl">
            Draws on over <span className="dim">{(sel?.kind === 'trail' ? sel.reveal ?? 0 : ed.trailReveal).toFixed(1)}s</span>
          </label>
          <input
            type="range" min={0} max={8} step={0.1}
            value={sel?.kind === 'trail' ? sel.reveal ?? 0 : ed.trailReveal}
            onChange={(e) => {
              const reveal = Number(e.target.value);
              ed.setHockey({ trailReveal: reveal });
              if (sel?.kind === 'trail') patch({ reveal } as Partial<Shape>, 'reveal');
            }}
          />
          {!sel && <p className="hint">Draw the route. When the video plays it skates itself on, ending in an arrow.</p>}
        </section>
      )}

      {kind === 'gap' && (
        <section>
          {sel?.kind === 'gap' ? (
            <>
              <label className="lbl">Label</label>
              <input className="field" placeholder='e.g. "Gap" or "Too far"' value={sel.label} onChange={(e) => patch({ label: e.target.value } as Partial<Shape>, 'label')} />
              <p className="hint">
                {sel.a && sel.b ? 'Both ends follow their players.' : sel.a || sel.b ? 'One end follows a player.' : 'Drag an end onto a player marker or spotlight to attach it.'}
              </p>
            </>
          ) : (
            <p className="hint">Drag from one player to another. Ends dropped on a marker or spotlight stick to that player.</p>
          )}
        </section>
      )}
    </>
  );
}

/** Tracking controls for the selected shape. */
function TrackSection({ shape }: { shape: Shape }) {
  const ed = useEditor();
  usePlayer((s) => Math.round(s.currentTime * 4)); // refresh the "here" info a few times a second
  const track = shape.track ?? [];
  const tracked = track.length > 0;
  if (shape.kind === 'gap' && (shape.a || shape.b)) return null; // follows its players already

  return (
    <section className="track">
      <label className="lbl">
        Follow a player
        {tracked && <span className="dim">{fmtTime(track[0].t)}–{fmtTime(track[track.length - 1].t)}</span>}
      </label>
      <button
        className={'btn full big' + (ed.followArmed ? ' active' : ' primary')}
        onClick={() => {
          ed.setTool('select');
          ed.select(shape.id);
          ed.armFollow(!ed.followArmed);
        }}
      >
        <Icon name="pencil" /> {ed.followArmed ? 'Following… tap to stop' : tracked ? 'Re-record from here' : 'Follow with Pencil'}
      </button>
      <div className="actions">
        <button
          className="btn"
          title="Pin the shape's current position at this moment. Then drag it at other moments to keyframe."
          onClick={() => {
            const t = getVideo()?.currentTime ?? 0;
            const o = offsetAt(shape.track, t);
            const rest = track.filter((k) => Math.abs(k.t - t) > 0.01);
            ed.updateShape(shape.id, { track: [...rest, { t, dx: o.dx, dy: o.dy }].sort((a, b) => a.t - b.t) });
          }}
        >
          <Icon name="plus" size={16} /> Keyframe
        </button>
        {tracked && (
          <button className="btn danger" onClick={() => ed.updateShape(shape.id, { track: [], showTrail: false })}>
            <Icon name="trash" size={16} /> Clear
          </button>
        )}
      </div>
      {tracked && (
        <label className="toggle">
          <input type="checkbox" checked={!!shape.showTrail} onChange={(e) => ed.updateShape(shape.id, { showTrail: e.target.checked })} />
          <span>Show path skated</span>
        </label>
      )}
      <p className="hint">
        {tracked
          ? `${track.length} positions. Drag it while paused to fix a spot.`
          : 'Hold the Pencil on the player and it plays in slow-mo while you follow. Lift to pause.'}
      </p>
    </section>
  );
}
