import { motion } from 'framer-motion';
import type { NowcastState, ActiveFlare } from '../types/api';
import { NOWCAST_STATES, goesClassColor, goesClassBg, rLevelColor } from '../lib/constants';
import { useRouter, isModifiedClick, catalogueUrl } from '../lib/router';
import { silkHover, usePrefersReducedMotion } from '../lib/motion';
import Metric from './ui/Metric';
import Typewriter from './ui/Typewriter';

interface NowcastBannerProps {
  nowcastState: NowcastState | null;
}

/**
 * Primary status readout — the console's hero panel. Framed with HUD corner
 * brackets and a state-tinted wash so the current nowcast state carries
 * visually. With no active flare every numeric field shows an em dash —
 * never a plausible-looking placeholder, which would read as real telemetry.
 */
export default function NowcastBanner({ nowcastState }: NowcastBannerProps) {
  const { go } = useRouter();
  const reduced = usePrefersReducedMotion();
  const hover = reduced ? {} : silkHover;

  const state = nowcastState?.state || 'quiet';
  const active: ActiveFlare | null = nowcastState?.active ?? null;
  const stateInfo = NOWCAST_STATES[state];
  const flareClass = active?.class ?? '—';
  const isMajor = flareClass.startsWith('X') || flareClass.startsWith('M');
  const stateTone = active ? stateInfo.color : 'var(--color-ink-faint)';
  const clsColor = active ? goesClassColor(active.peak_flux_sxr) : 'var(--color-ink-faint)';

  const detailHref = active?.id ? catalogueUrl(active.id, 'ALL') : null;

  return (
    <div
      className="sk-panel relative"
      role="status"
      aria-live="polite"
      style={
        active
          ? {
              // State-tinted wash bleeding from the class corner — subtle, so
              // the panel still reads as an instrument, not a marketing card.
              background: `linear-gradient(135deg, ${goesClassBg(active.peak_flux_sxr)} 0%, var(--color-panel) 45%)`,
            }
          : undefined
      }
    >
      {/* HUD frame — corners take the state colour while a flare is active. */}
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <span
          key={c}
          className={`sk-corner sk-corner-${c}`}
          style={{ borderColor: active ? clsColor : 'var(--color-rule-strong)' }}
          aria-hidden="true"
        />
      ))}

      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5 p-4">
        {/* State + active flare identity */}
        <div className="flex items-center gap-5 min-w-0">
          <div
            className="relative flex flex-col items-center justify-center w-24 h-20 border px-2 text-center shrink-0"
            style={{
              borderColor: active ? clsColor : 'var(--color-rule)',
              backgroundColor: active ? goesClassBg(active.peak_flux_sxr) : 'var(--color-surface)',
            }}
          >
            {active && <span className="sk-pulse" style={{ borderColor: clsColor }} aria-hidden="true" />}
            <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">GOES class</span>
            <span
              className="text-2xl font-bold font-mono-val tabular-nums leading-8"
              style={{ color: clsColor }}
            >
              {flareClass}
            </span>
            <span className="text-[10px] font-mono-val text-ink-faint">SoLEXS peak</span>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <span
                className="px-2 py-0.5 text-[11px] font-bold tracking-[0.1em] border font-mono-val"
                style={{ color: stateTone, borderColor: stateTone, backgroundColor: stateInfo.bg }}
              >
                {stateInfo.label.toUpperCase()}
              </span>
              {/* Live-activity equaliser, keyed to the state colour. */}
              <span className="sk-signal" style={{ color: stateTone }} aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </span>
              {active?.id && detailHref && (
                <a
                  href={detailHref}
                  onClick={(e) => {
                    if (isModifiedClick(e)) return;
                    e.preventDefault();
                    go(detailHref);
                  }}
                  className="text-[11px] font-mono-val text-accent hover:underline"
                  title="Open this flare in the catalogue"
                >
                  ID {active.id} →
                </a>
              )}
            </div>
            <h1 className="text-base font-semibold leading-6">
              <Typewriter
                text={
                  active
                    ? isMajor
                      ? 'High-energy solar flare event active'
                      : 'Solar flare event in progress'
                    : 'Solar radiation baseline — no active flare'
                }
              />
            </h1>
            <p className="text-[11px] text-ink-muted mt-0.5">
              BOCPD online change-point detection &amp; Neupert-effect cross-correlation on Aditya-L1 payload streams.
            </p>
          </div>
        </div>

        {/* Active flare telemetry — each tile lifts gently on hover */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full lg:w-auto">
          <motion.div {...hover}>
            <Metric
              label="SXR 0.5–10 Å"
              value={active?.peak_flux_sxr ? active.peak_flux_sxr.toExponential(2) : '—'}
              unit={active?.peak_flux_sxr ? 'W/m²' : undefined}
            />
          </motion.div>
          <motion.div {...hover}>
            <Metric
              label="HXR 10–150 keV"
              value={active?.peak_flux_hxr ? active.peak_flux_hxr.toExponential(2) : '—'}
              unit={active?.peak_flux_hxr ? 'W/m²' : undefined}
            />
          </motion.div>
          <motion.div {...hover}>
            <Metric label="Spectral hardness" value={active?.hardness ? active.hardness.toFixed(3) : '—'} />
          </motion.div>
          <motion.div {...hover}>
            <Metric label="Impulsivity" value={active?.impulsivity ? active.impulsivity.toFixed(2) : '—'} />
          </motion.div>
          <motion.div {...hover}>
            <Metric label="Severity band" value={active?.severity_band ?? '—'} />
          </motion.div>
          <motion.div {...hover}>
            <Metric
              label="R-level"
              value={active?.r_level ?? '—'}
              tone={active ? rLevelColor(active.r_level) : undefined}
            />
          </motion.div>
        </div>
      </div>
    </div>
  );
}
