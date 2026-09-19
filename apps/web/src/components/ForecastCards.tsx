import type { ForecastData, ForecastHorizon } from '../types/api';
import { riskColor, riskLevel } from '../lib/constants';
import Panel from './ui/Panel';

interface ForecastCardsProps {
  forecast: ForecastData | null;
}

function horizonView(horizon: ForecastHorizon) {
  const pctC1 = Math.round(horizon.p_c1 * 100);
  const pctM1 = Math.round(horizon.p_m1 * 100);
  const color = riskColor(horizon.p_m1);
  const level = riskLevel(horizon.p_m1);
  const badgeLabel =
    level === 'extreme' ? 'HIGH' : level === 'high' ? 'ELEVATED' : level === 'moderate' ? 'MODERATE' : 'NOMINAL';
  return { pctC1, pctM1, color, badgeLabel };
}

const exp = (v: number | undefined) => (v !== undefined ? v.toExponential(1) : '—');

function HorizonRow({ horizon }: { horizon: ForecastHorizon }) {
  const { pctC1, pctM1, color, badgeLabel } = horizonView(horizon);

  return (
    <tr className="border-t border-rule">
      <th scope="row" className="px-3 py-2.5 text-left font-mono-val tabular-nums font-semibold whitespace-nowrap">
        +{horizon.horizon_min} min
      </th>
      <td className="px-3 py-2.5 w-[30%]">
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 bg-surface border border-rule overflow-hidden" aria-hidden="true">
            <div
              className="h-full transition-[width] duration-500"
              style={{ width: `${pctM1}%`, backgroundColor: color }}
            />
          </div>
          <span className="w-10 text-right font-mono-val tabular-nums font-semibold" style={{ color }}>
            {pctM1}%
          </span>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right font-mono-val tabular-nums text-ink-muted">{pctC1}%</td>
      <td className="px-3 py-2.5 text-right font-mono-val tabular-nums text-ink-muted">{exp(horizon.q50)}</td>
      <td className="px-3 py-2.5 text-right font-mono-val tabular-nums text-ink-muted">{exp(horizon.q90)}</td>
      <td className="px-3 py-2.5 text-right font-mono-val tabular-nums text-ink-muted">{exp(horizon.q99)}</td>
      <td className="px-3 py-2.5 text-right">
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 border font-mono-val"
          style={{ color, borderColor: color, backgroundColor: `${color}14` }}
        >
          {badgeLabel}
        </span>
      </td>
    </tr>
  );
}

/**
 * Phone presentation of one horizon. Seven columns cannot be read at 320px
 * and shrinking them further only makes the numbers worse, so each horizon
 * becomes a card: the probability that carries the decision first, the EVT
 * quantiles as a labelled row beneath it.
 */
function HorizonCard({ horizon }: { horizon: ForecastHorizon }) {
  const { pctC1, pctM1, color, badgeLabel } = horizonView(horizon);

  return (
    <li className="border border-rule bg-panel p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono-val tabular-nums text-sm font-semibold">+{horizon.horizon_min} min</span>
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 border font-mono-val shrink-0"
          style={{ color, borderColor: color, backgroundColor: `${color}14` }}
        >
          {badgeLabel}
        </span>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-ink-faint mb-1">
          <span>P(M+ flare)</span>
          <span className="font-mono-val tabular-nums text-sm font-semibold normal-case tracking-normal" style={{ color }}>
            {pctM1}%
          </span>
        </div>
        <div className="h-2 bg-surface border border-rule overflow-hidden" aria-hidden="true">
          <div
            className="h-full transition-[width] duration-500"
            style={{ width: `${pctM1}%`, backgroundColor: color }}
          />
        </div>
      </div>

      <dl className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-rule text-[11px] font-mono-val tabular-nums">
        <div>
          <dt className="text-[10px] uppercase tracking-[0.1em] text-ink-faint">P(C+)</dt>
          <dd className="mt-0.5 text-ink-muted">{pctC1}%</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-[0.1em] text-ink-faint">q50</dt>
          <dd className="mt-0.5 text-ink-muted">{exp(horizon.q50)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-[0.1em] text-ink-faint">q90</dt>
          <dd className="mt-0.5 text-ink-muted">{exp(horizon.q90)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-[0.1em] text-ink-faint">q99</dt>
          <dd className="mt-0.5 text-ink-muted">{exp(horizon.q99)}</dd>
        </div>
      </dl>
    </li>
  );
}

/**
 * Discrete-time logistic hazard forecast. The EVT intensity quantiles
 * (q50/q90/q99) arrived from the API all along — they are rendered here
 * rather than discarded.
 */
export default function ForecastCards({ forecast }: ForecastCardsProps) {
  const horizons = forecast?.horizons ?? [];

  return (
    <Panel label="Flare Hazard Forecast — 5/10/20/40 min" meta={<span>logistic hazard + EVT</span>} tone="#a78bfa">
      {horizons.length === 0 ? (
        <p className="text-xs font-mono-val text-ink-faint py-6 text-center">No forecast horizons available.</p>
      ) : (
        <>
          {/* Phones: one card per horizon. */}
          <ul className="md:hidden flex flex-col gap-3" aria-label="Forecast horizons">
            {horizons.map((item) => (
              <HorizonCard key={item.horizon_min} horizon={item} />
            ))}
          </ul>

          {/* Tablet and up: the full table. */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">
                Flare probability and EVT peak-flux quantiles by forecast horizon
              </caption>
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.1em] text-ink-faint text-left">
                  <th scope="col" className="px-3 py-2 font-semibold">Horizon</th>
                  <th scope="col" className="px-3 py-2 font-semibold">P(M+)</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-right">P(C+)</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-right" title="EVT median peak flux (W/m²)">q50</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-right" title="EVT 90th percentile peak flux (W/m²)">q90</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-right" title="EVT 99th percentile peak flux (W/m²)">q99</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-right">Status</th>
                </tr>
              </thead>
              <tbody className="text-ink">
                {horizons.map((item) => (
                  <HorizonRow key={item.horizon_min} horizon={item} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-3 text-[11px] font-mono-val text-ink-faint">
        q50/q90/q99 — EVT peak-flux quantiles (W/m²) for the horizon window.
      </p>
    </Panel>
  );
}
