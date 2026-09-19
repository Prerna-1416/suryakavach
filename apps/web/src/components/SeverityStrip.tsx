import { ChevronRight } from 'lucide-react';
import type { ImpactCurrent } from '../types/api';
import { R_SCALE, rLevelColor } from '../lib/constants';
import { useRouter, isModifiedClick } from '../lib/router';

interface SeverityStripProps {
  impact: ImpactCurrent | null;
}

/**
 * Compact impact severity readout for the phone priority stack.
 *
 * The full ImpactGauge is a two-column panel that has to sit further down the
 * page; this is its headline — index, NOAA level and the R-scale track — in a
 * single tappable row, linking through to the full breakdown. Desktop keeps
 * the full gauge and does not render this.
 *
 * With no impact reading every field stays an em dash rather than a plausible
 * placeholder, matching the console-wide rule.
 */
export default function SeverityStrip({ impact }: SeverityStripProps) {
  const { go } = useRouter();
  const index = impact?.index ?? null;
  const hasData = index !== null;
  const color = hasData ? rLevelColor(index) : 'var(--color-ink-faint)';
  const href = '/impact';

  return (
    <a
      href={href}
      onClick={(e) => {
        if (isModifiedClick(e)) return;
        e.preventDefault();
        go(href);
      }}
      className="sk-panel sk-card-press block p-3"
      aria-label={`Impact severity ${hasData ? `${index.toFixed(2)} of 10, NOAA ${impact?.r_level}` : 'unavailable'} — open the impact screen`}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              Impact severity
            </span>
            <span className="text-[11px] font-bold font-mono-val" style={{ color }}>
              {impact?.r_level ?? '—'}
            </span>
            <span className="text-[10px] text-ink-faint truncate">{impact?.band ?? ''}</span>
          </div>

          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono-val tabular-nums leading-8" style={{ color }}>
              {hasData ? index.toFixed(2) : '—'}
            </span>
            <span className="font-mono-val text-[11px] text-ink-faint">/ 10.0</span>
          </div>
        </div>

        <ChevronRight className="w-4 h-4 text-ink-faint shrink-0" aria-hidden="true" />
      </div>

      {/* R-scale track — same segments as the full gauge, phone-width. */}
      <div className="mt-2 flex w-full h-2.5 border border-rule overflow-hidden" aria-hidden="true">
        {R_SCALE.map((rs) => (
          <div
            key={rs.level}
            className="flex-1 border-r border-rule last:border-r-0"
            style={{ backgroundColor: hasData && index >= rs.min ? rs.color : 'transparent' }}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1 text-[9px] font-mono-val text-ink-faint" aria-hidden="true">
        {R_SCALE.map((rs) => (
          <span key={rs.level}>{rs.level}</span>
        ))}
      </div>
    </a>
  );
}
