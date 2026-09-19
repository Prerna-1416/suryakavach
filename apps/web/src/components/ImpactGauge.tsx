import type { ImpactCurrent } from '../types/api';
import { rLevelColor } from '../lib/constants';
import { useImpactScale } from '../lib/hooks';
import Panel from './ui/Panel';
import Metric from './ui/Metric';

interface ImpactGaugeProps {
  impact: ImpactCurrent | null;
}

const R_INFO: Record<string, { title: string; desc: string }> = {
  R5: { title: 'Extreme radio blackout', desc: 'Complete HF radio blackout on entire sunlit side of Earth' },
  R4: { title: 'Severe radio blackout', desc: 'HF radio blackout on most sunlit side; satellite degradation' },
  R3: { title: 'Strong radio blackout', desc: 'Wide area blackout of HF radio; loss of radio contact for ~1 hr' },
  R2: { title: 'Moderate radio blackout', desc: 'Limited blackout of HF radio; loss of radio contact' },
  R1: { title: 'Minor radio blackout', desc: 'Weak or minor degradation of HF radio signal' },
  R0: { title: 'No space weather blackout', desc: 'Normal space weather operating conditions' },
};

const SUBSCORE_LABELS: Record<string, string> = {
  peak_sxr: 'Peak SXR',
  hardness: 'Hardness',
  impulsivity: 'Impulsivity',
  duration: 'Duration',
};

const SECTORS = [
  {
    name: 'HF communications',
    risk: (i: number) => (i >= 6 ? 'HIGH LOSS' : i >= 3 ? 'MODERATE' : 'NORMAL'),
    desc: 'High-frequency ionospheric absorption',
  },
  {
    name: 'Satellite operations',
    risk: (i: number) => (i >= 7 ? 'SURGE RISK' : i >= 4 ? 'ELEVATED' : 'NOMINAL'),
    desc: 'Orbit drag & single event upset monitoring',
  },
  {
    name: 'Astronaut EVA',
    risk: (i: number) => (i >= 6 ? 'SUSPEND EVA' : 'SAFE'),
    desc: 'Proton flux radiation hazard threshold',
  },
  {
    name: 'GNSS navigation',
    risk: (i: number) => (i >= 5 ? 'DEGRADED' : 'ACCURATE'),
    desc: 'Ionospheric total electron content fluctuation',
  },
];

/**
 * Fused radiation impact: 0–10 index onto the NOAA R-scale. Subscores,
 * G/S geomagnetic/storm levels, and the engine note all come from
 * /api/impact/current and are rendered, not discarded.
 */
export default function ImpactGauge({ impact }: ImpactGaugeProps) {
  const { data: scale } = useImpactScale();
  const index = impact?.index ?? null;
  const rLvl = impact?.r_level ?? 'R0';
  const rInfo = R_INFO[rLvl] ?? R_INFO.R0;
  const currentBand = scale?.bands.find((band) => band.r_level === rLvl);
  const color = index !== null ? (currentBand?.color ?? rLevelColor(rLvl)) : 'var(--color-ink-faint)';
  const hasData = index !== null;
  const subscores = Object.entries({ ...(impact?.weights_used ?? {}), ...(scale?.weights ?? {}) });

  return (
    <Panel
      label="Radiation Impact"
      tone={color}
      meta={
        <span className="font-bold" style={{ color }}>
          {rLvl} · {impact?.band ?? '—'}
        </span>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
        {/* Index + R-scale track */}
        <div className="lg:col-span-5 border border-rule p-3 md:p-4 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-ink-faint">
              <span>Impact index 0–10</span>
              <span className="font-semibold" style={{ color }}>{rInfo.title}</span>
            </div>

            <div className="flex items-baseline gap-2 my-2">
              <span className="text-4xl font-bold font-mono-val tabular-nums tracking-tight" style={{ color }}>
                {hasData ? index.toFixed(2) : '—'}
              </span>
              <span className="font-mono-val text-ink-faint">/ 10.0</span>
            </div>

            {/* R-scale track: one segment per level, filled up to current */}
            <div className="flex w-full h-3 border border-rule overflow-hidden" aria-hidden="true">
              {(scale?.bands ?? []).map((rs) => {
                const filled = index !== null && index >= rs.min;
                return (
                  <div
                    key={rs.r_level}
                    className="flex-1 border-r border-rule last:border-r-0"
                    style={{ backgroundColor: filled ? rs.color : 'transparent' }}
                  />
                );
              })}
            </div>
            <div className="flex justify-between mt-1 text-[9px] font-mono-val text-ink-faint" aria-hidden="true">
              {(scale?.bands ?? []).map((rs) => (
                <span key={rs.r_level}>{rs.r_level}</span>
              ))}
            </div>
            <span className="sr-only">
              Impact index {hasData ? index.toFixed(2) : 'unavailable'} of 10, NOAA level {rLvl}
            </span>

            <p className="text-xs text-ink-muted mt-3">{rInfo.desc}</p>
          </div>

          {/* Space-weather scale levels from the API */}
          <div className="grid grid-cols-2 gap-3 md:gap-4 border-t border-rule pt-3">
            <Metric label="G-level" value={impact?.g_level ?? '—'} />
            <Metric label="S-level" value={impact?.s_level ?? '—'} />
          </div>
        </div>

        {/* Subscores + affected sectors */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-ink-faint mb-2">Fusion subscores</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
              {subscores.map(([key, weight]) => (
                <Metric
                  key={key}
                  label={`${SUBSCORE_LABELS[key] ?? key} · ${Math.round(weight * 100)}%`}
                  value={
                    impact?.subscores && impact.subscores[key as keyof typeof impact.subscores] !== undefined
                      ? impact.subscores[key as keyof typeof impact.subscores]!.toFixed(3)
                      : '—'
                  }
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-rule border border-rule">
            {SECTORS.map((sec) => {
              const risk = index !== null ? sec.risk(index) : '—';
              const alarm = risk !== '—' && ['HIGH LOSS', 'SURGE RISK', 'SUSPEND EVA', 'DEGRADED'].includes(risk);
              return (
                <div key={sec.name} className="bg-panel p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-semibold">{sec.name}</span>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 border font-mono-val"
                      style={{
                        color: alarm ? 'var(--color-alarm)' : 'var(--color-ok)',
                        borderColor: alarm ? 'var(--color-alarm)' : 'var(--color-ok)',
                        backgroundColor: alarm ? 'rgba(239,122,90,0.12)' : 'rgba(52,211,153,0.10)',
                      }}
                    >
                      {risk}
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-muted">{sec.desc}</p>
                </div>
              );
            })}
          </div>

          {impact?.note && (
            <p className="text-[11px] font-mono-val text-ink-muted border-t border-rule pt-3">{impact.note}</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
