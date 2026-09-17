import Panel from './ui/Panel';
import { METRICS } from '../lib/constants';

interface Cohort {
  label: string;
  tss: number;
  hss: number;
  far: number;
  tp?: number;
  fp?: number;
  fn?: number;
}

function CohortRow({ cohort, targetTss }: { cohort: Cohort; targetTss: number }) {
  const meetsTarget = cohort.tss >= targetTss;
  return (
    <tr className="border-t border-rule">
      <th scope="row" className="px-3 py-2 text-left font-semibold">
        {cohort.label}
      </th>
      <td
        className="px-3 py-2 text-right font-mono-val tabular-nums font-bold"
        style={{ color: meetsTarget ? 'var(--color-ok)' : 'var(--color-alarm)' }}
      >
        {cohort.tss.toFixed(3)}
      </td>
      <td className="px-3 py-2 text-right font-mono-val tabular-nums">{cohort.hss.toFixed(3)}</td>
      <td className="px-3 py-2 text-right font-mono-val tabular-nums">{cohort.far.toFixed(3)}</td>
      <td className="px-3 py-2 text-right font-mono-val tabular-nums text-ink-muted">
        {cohort.tp !== undefined ? `${cohort.tp} / ${cohort.fp} / ${cohort.fn}` : '—'}
      </td>
      <td className="px-3 py-2 text-right text-[11px] font-semibold">
        {meetsTarget ? (
          <span className="text-ok px-1.5 py-0.5 border border-ok bg-ok/10">MEETS ≥ {targetTss}</span>
        ) : (
          <span className="text-alarm px-1.5 py-0.5 border border-alarm bg-alarm/10">BELOW ≥ {targetTss}</span>
        )}
      </td>
    </tr>
  );
}

/**
 * Offline validation, reported honestly. Both cohorts from the evaluation
 * report are shown side by side: the M+ row clears the PRD target, the
 * all-class row does not — it carries 56 false positives against 29 true
 * positives, and hiding that behind the M+ numbers would misrepresent the
 * system. Figures come from METRICS in constants.ts.
 */
export default function MetricsPanel() {
  return (
    <Panel label="Offline Validation" meta={<span>synthetic fused SoLEXS/HEL1OS cache</span>} tone="#16a34a">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">
              Detection skill by cohort, offline validation on the synthetic cache
            </caption>
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.1em] text-ink-faint text-left">
                <th scope="col" className="px-3 py-2 font-semibold">Cohort</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">TSS</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">HSS</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">FAR</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right" title="True positives / false positives / false negatives">TP / FP / FN</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">PRD target</th>
              </tr>
            </thead>
            <tbody className="text-ink">
              <CohortRow cohort={METRICS.allClass} targetTss={METRICS.targetTss} />
              <CohortRow cohort={METRICS.mPlus} targetTss={METRICS.targetTss} />
            </tbody>
          </table>
          <p className="mt-3 text-[11px] font-mono-val text-ink-faint">
            Source: {METRICS.provenance}. Not an operational claim.
          </p>
        </div>

        <div className="border border-accent/40 bg-accent-wash p-4 flex flex-col justify-center gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">Mean onset lead</div>
            <div className="mt-1 text-2xl font-bold font-mono-val tabular-nums">
              {METRICS.meanOnsetLeadMin.toFixed(1)}
              <span className="text-sm text-ink-faint">{' '}min</span>
            </div>
            <div className="text-[11px] text-ink-muted mt-1">
              detected events, onset-to-peak · target ≥ {METRICS.targetLeadMin} min
            </div>
          </div>
          <div className="border-t border-rule pt-3 text-[11px] text-ink-muted leading-5">
            The all-class cohort fails its target: the detector over-triggers on
            sub-C activity, producing 56 false alarms. The M+ cohort passes, but on
            a small number of events in a synthetic cache.
          </div>
        </div>
      </div>
    </Panel>
  );
}
