import { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, Loader2, ChevronUp, ChevronDown } from 'lucide-react';
import { REPLAY } from '../lib/constants';
import { useReplayStore } from '../store/replayStore';
import { useReplayControl, useStartReplay } from '../lib/hooks';
import { silkPress, usePrefersReducedMotion } from '../lib/motion';
import { useIsMobile } from '../lib/responsive';

export default function ReplayBar() {
  const { playing, speed, cursor, eventDate, dates } = useReplayStore();
  const control = useReplayControl();
  const startReplay = useStartReplay();
  const reduced = usePrefersReducedMotion();
  const isMobile = useIsMobile();
  const press = reduced ? {} : silkPress;

  // While dragging the scrubber we track the value locally and only commit to
  // the server on release, so a drag doesn't fire a request per pixel.
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  // Phone transport collapses to a single row by default; the settings panel
  // opens upward so the sticky bar never eats the viewport on a short screen.
  const [expanded, setExpanded] = useState(false);

  const busy = control.isPending || startReplay.isPending;
  const displayCursor = scrubValue ?? cursor;

  const formatMinutes = (m: number) => {
    const hrs = Math.floor(m / 60);
    const mins = m % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  };

  const commitScrub = () => {
    if (busy) {
      setScrubValue(null);
      return;
    }
    if (scrubValue === null) return;
    const target = scrubValue;
    setScrubValue(null);
    if (target !== cursor) control.mutate({ action: 'seek', cursor: target });
  };

  /* Speed chip on the collapsed row: one tap steps to the next preset, so the
     rate is reachable without opening the panel. Same mutation as the
     segmented control below it. */
  const cycleSpeed = () => {
    // SPEEDS is an `as const` tuple; widen it so a speed that arrived from the
    // server as a plain number can be looked up without a cast at the call site.
    const speeds: readonly number[] = REPLAY.SPEEDS;
    const idx = speeds.indexOf(speed);
    const next = REPLAY.SPEEDS[(idx + 1) % REPLAY.SPEEDS.length];
    control.mutate({ action: 'speed', speed: next });
  };

  const error = control.error ?? startReplay.error;

  return (
    <footer
      className="bg-panel/90 border-t border-rule sticky bottom-0 z-30 sk-safe-b"
      role="toolbar"
      aria-label="Replay controls"
    >
      {isMobile ? (
        <div className="relative">
          {expanded && (
            <div
              id="replay-mobile-panel"
              className="absolute bottom-full left-0 right-0 bg-panel border-t border-rule-strong px-3 py-3 flex flex-col gap-3 shadow-[0_-14px_32px_rgba(0,0,0,0.45)]"
            >
              {/* Event date — the full-width row a select needs on a phone. */}
              <div className="flex items-center gap-2 border border-rule px-2.5 sk-touch text-[12px] font-mono-val">
                <label className="text-[10px] uppercase tracking-[0.14em] text-ink-faint shrink-0" htmlFor="replay-date-m">
                  Date
                </label>
                <select
                  id="replay-date-m"
                  value={eventDate}
                  disabled={busy}
                  onChange={(e) => startReplay.mutate({ event_date: e.target.value, speed })}
                  className="flex-1 min-w-0 bg-transparent text-ink outline-none cursor-pointer font-semibold disabled:cursor-wait"
                >
                  {dates.length > 0 ? (
                    dates.map((d) => (
                      <option key={d} value={d}>
                        {d} {d === REPLAY.DEFAULT_EVENT_DATE ? '(X6.3 flare)' : ''}
                      </option>
                    ))
                  ) : (
                    <option value={REPLAY.DEFAULT_EVENT_DATE}>
                      {REPLAY.DEFAULT_EVENT_DATE} (X6.3 flare)
                    </option>
                  )}
                </select>
              </div>

              {/* Speed presets, each a full 44px target. */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint shrink-0">Speed</span>
                <div className="flex flex-1 items-stretch border border-rule text-[12px] font-mono-val">
                  {REPLAY.SPEEDS.map((s) => (
                    <motion.button
                      key={s}
                      type="button"
                      {...press}
                      onClick={() => control.mutate({ action: 'speed', speed: s })}
                      disabled={busy}
                      aria-pressed={speed === s}
                      aria-label={`Replay speed ${s} times`}
                      className={`flex-1 sk-touch disabled:opacity-60 ${
                        speed === s ? 'bg-accent text-white font-bold' : 'text-ink-muted active:text-ink'
                      }`}
                    >
                      {s}×
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Timeline: full width, labelled endpoints, one thumb. */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[11px] font-mono-val tabular-nums text-ink-muted">
                  <span>{formatMinutes(displayCursor)}</span>
                  <span className="text-ink-faint">Timeline · {formatMinutes(REPLAY.MAX_CURSOR)} UTC</span>
                </div>
                <label className="sr-only" htmlFor="replay-scrubber-m">
                  Replay timeline
                </label>
                <div className="relative flex items-center h-11">
                  <input
                    id="replay-scrubber-m"
                    type="range"
                    min={REPLAY.MIN_CURSOR}
                    max={REPLAY.MAX_CURSOR}
                    value={displayCursor}
                    disabled={busy}
                    aria-valuetext={`${formatMinutes(displayCursor)} UTC`}
                    onChange={(e) => setScrubValue(parseInt(e.target.value, 10))}
                    onPointerUp={commitScrub}
                    onKeyUp={commitScrub}
                    onBlur={commitScrub}
                    className="w-full h-11 bg-transparent border-0 rounded-none appearance-none cursor-pointer accent-[#e6a94c] sk-touch z-10 disabled:cursor-wait"
                  />
                  <div className="absolute inset-x-0 h-2 bg-surface border border-rule pointer-events-none" aria-hidden="true" />
                </div>
              </div>
            </div>
          )}

          {/* Collapsed transport: 44px targets, no wrap, no sideways scroll. */}
          <div className="flex items-center gap-2 px-3 py-1.5">
            <motion.button
              type="button"
              {...press}
              onClick={() => control.mutate({ action: 'toggle' })}
              disabled={busy}
              aria-label={playing ? 'Pause replay' : 'Play replay'}
              className={`sk-touch w-11 border flex items-center justify-center transition-colors disabled:opacity-60 ${
                playing ? 'bg-accent border-accent text-white' : 'border-rule text-ink'
              }`}
            >
              {control.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : playing ? (
                <Pause className="w-4 h-4 fill-current" aria-hidden="true" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" aria-hidden="true" />
              )}
            </motion.button>

            <span className="font-mono-val text-[12px] tabular-nums text-ink-muted">
              {formatMinutes(displayCursor)}
              <span className="text-ink-faint"> / {formatMinutes(REPLAY.MAX_CURSOR)}</span>
            </span>

            <button
              type="button"
              onClick={cycleSpeed}
              disabled={busy}
              aria-label={`Replay speed ${speed} times — tap to change`}
              className="sk-touch ml-auto px-2.5 border border-rule text-[12px] font-mono-val text-accent-soft disabled:opacity-60"
            >
              {speed}×
            </button>

            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-controls="replay-mobile-panel"
              aria-label={expanded ? 'Hide replay settings' : 'Show replay settings'}
              className="sk-touch w-11 border border-rule flex items-center justify-center text-ink-muted"
            >
              {expanded ? (
                <ChevronDown className="w-4 h-4" aria-hidden="true" />
              ) : (
                <ChevronUp className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="px-4 py-2.5">
          <div className="max-w-[1200px] mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {/* Date Selector */}
              <div className="flex items-center border border-rule px-2.5 py-1 text-[11px] font-mono-val">
                <label className="sr-only" htmlFor="replay-date">Event date</label>
                <select
                  id="replay-date"
                  value={eventDate}
                  disabled={busy}
                  onChange={(e) => startReplay.mutate({ event_date: e.target.value, speed })}
                  className="bg-transparent text-ink outline-none cursor-pointer font-semibold disabled:cursor-wait"
                >
                  {dates.length > 0 ? (
                    dates.map((d) => (
                      <option key={d} value={d}>
                        {d} {d === REPLAY.DEFAULT_EVENT_DATE ? '(X6.3 flare)' : ''}
                      </option>
                    ))
                  ) : (
                    <option value={REPLAY.DEFAULT_EVENT_DATE}>
                      {REPLAY.DEFAULT_EVENT_DATE} (X6.3 flare)
                    </option>
                  )}
                </select>
              </div>

              {/* Play / Pause Toggle */}
              <motion.button
                type="button"
                {...press}
                onClick={() => control.mutate({ action: 'toggle' })}
                disabled={busy}
                aria-label={playing ? 'Pause replay' : 'Play replay'}
                className={`w-8 h-8 border flex items-center justify-center transition-colors disabled:opacity-60 ${
                  playing
                    ? 'bg-accent border-accent text-white'
                    : 'border-rule text-ink hover:border-rule-strong'
                }`}
              >
                {control.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : playing ? (
                  <Pause className="w-4 h-4 fill-current" aria-hidden="true" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" aria-hidden="true" />
                )}
              </motion.button>

              {/* Speed Buttons */}
              <div className="flex items-center border border-rule text-[11px] font-mono-val">
                {REPLAY.SPEEDS.map((s) => (
                  <motion.button
                    key={s}
                    type="button"
                    {...press}
                    onClick={() => control.mutate({ action: 'speed', speed: s })}
                    disabled={busy}
                    aria-pressed={speed === s}
                    aria-label={`Replay speed ${s} times`}
                    className={`px-2 py-1 disabled:opacity-60 ${
                      speed === s ? 'bg-accent text-white font-bold' : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {s}×
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Scrubber Timeline */}
            <div className="flex-1 w-full flex items-center gap-3">
              <span className="text-[11px] font-mono-val tabular-nums text-ink-muted min-w-12 text-right">
                {formatMinutes(displayCursor)}
              </span>

              <label className="sr-only" htmlFor="replay-scrubber">Replay timeline</label>
              <input
                id="replay-scrubber"
                type="range"
                min={REPLAY.MIN_CURSOR}
                max={REPLAY.MAX_CURSOR}
                value={displayCursor}
                disabled={busy}
                aria-valuetext={`${formatMinutes(displayCursor)} UTC`}
                onChange={(e) => setScrubValue(parseInt(e.target.value, 10))}
                onPointerUp={commitScrub}
                onKeyUp={commitScrub}
                onBlur={commitScrub}
                className="w-full h-1.5 bg-surface border border-rule rounded-none appearance-none cursor-pointer accent-[#e6a94c] disabled:cursor-wait"
              />

              <span className="text-[11px] font-mono-val tabular-nums text-ink-muted min-w-12">
                {formatMinutes(REPLAY.MAX_CURSOR)}
              </span>
            </div>

            {/* Live Replay Indicator */}
            <div className="hidden lg:flex items-center gap-2 font-mono-val text-[11px] tabular-nums text-ink-muted">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${playing ? 'bg-accent' : 'bg-rule-strong'}`}
                aria-hidden="true"
              />
              <span>REPLAY {eventDate} @ {speed}×</span>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="max-w-[1200px] mx-auto px-3 md:px-0 pb-2 text-[11px] font-mono-val text-alarm">
          Replay command failed: {error.message ?? 'unknown error'}
        </p>
      )}
    </footer>
  );
}
