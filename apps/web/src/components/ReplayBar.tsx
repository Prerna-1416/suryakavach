import { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, Loader2 } from 'lucide-react';
import { REPLAY } from '../lib/constants';
import { useReplayStore } from '../store/replayStore';
import { useReplayControl, useStartReplay } from '../lib/hooks';
import { silkPress, usePrefersReducedMotion } from '../lib/motion';

export default function ReplayBar() {
  const { playing, speed, cursor, eventDate, dates } = useReplayStore();
  const control = useReplayControl();
  const startReplay = useStartReplay();
  const reduced = usePrefersReducedMotion();
  const press = reduced ? {} : silkPress;

  // While dragging the scrubber we track the value locally and only commit to
  // the server on release, so a drag doesn't fire a request per pixel.
  const [scrubValue, setScrubValue] = useState<number | null>(null);

  const busy = control.isPending || startReplay.isPending;
  const displayCursor = scrubValue ?? cursor;

  const formatMinutes = (m: number) => {
    const hrs = Math.floor(m / 60);
    const mins = m % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  };

  const commitScrub = () => {
    if (scrubValue === null) return;
    const target = scrubValue;
    setScrubValue(null);
    if (target !== cursor) control.mutate({ action: 'seek', cursor: target });
  };

  return (
    <footer
      className="bg-panel/90 border-t border-rule sticky bottom-0 z-30 px-4 py-2.5"
      role="toolbar"
      aria-label="Replay controls"
    >
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
            aria-valuetext={`${formatMinutes(displayCursor)} UTC`}
            onChange={(e) => setScrubValue(parseInt(e.target.value, 10))}
            onPointerUp={commitScrub}
            onKeyUp={commitScrub}
            onBlur={commitScrub}
            className="w-full h-1.5 bg-surface border border-rule rounded-none appearance-none cursor-pointer accent-[#e6a94c]"
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

      {(control.isError || startReplay.isError) && (
        <p role="alert" className="max-w-[1200px] mx-auto mt-2 text-[11px] font-mono-val text-alarm">
          Replay command failed: {(control.error ?? startReplay.error)?.message ?? 'unknown error'}
        </p>
      )}
    </footer>
  );
}
