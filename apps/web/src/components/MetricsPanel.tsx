import Panel from './ui/Panel';
import { useMetrics } from '../lib/hooks';

interface CohortRowProps {
  label: string;
  tss: number;
  hss: number;
  far: number;
  tp?: number;
  fp?: number;
  fn?: number;
  targetTss?: number;
  ciTss?: { ci_lower: number; ci_upper: number };
}

function CohortRow({ cohort }: { cohort: CohortRowProps }) {
  const targetTss = cohort.targetTss ?? 0.6;
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
        {cohort.ciTss && (
          <span className="block text-[10px] font-normal text-ink-faint">
            [{cohort.ciTss.ci_lower.toFixed(2)}, {cohort.ciTss.ci_upper.toFixed(2)}]
          </span>
        )}
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

export default function MetricsPanel() {
  const { data: run, isLoading, error } = useMetrics();

  if (isLoading) {
    return (
      <Panel label="Offline Validation" meta={<span>Loading evaluation metrics...</span>} tone="#16a34a">
        <div className="p-6 text-center text-xs font-mono-val text-ink-muted">
          Fetching evaluation provenance & benchmark metrics...
        </div>
      </Panel>
    );
  }

  if (error || !run) {
    return (
      <Panel label="Offline Validation" meta={<span className="text-alarm">Evaluation Data Unavailable</span>} tone="#dc2626">
        <div className="p-4 text-xs font-mono-val text-alarm border border-alarm/30 bg-alarm/5">
          Failed to load evaluation metrics from <code>/api/metrics</code>.
        </div>
      </Panel>
    );
  }

  const dm = run.detection_metrics;
  const lt = run.lead_time_stats;
  const cis = run.confidence_intervals;
  const cal = run.calibration_curve;
  const fs = run.failure_slices || {};

  const targetTss = 0.6;
  const targetLeadMin = 3;

  return (
    <Panel
      label="Offline Validation & Backtesting"
      meta={
        <span className="font-mono-val text-[11px]">
          Run: <code className="text-accent">{run.id}</code> ({run.source_cohort})
        </span>
      }
      tone={run.source_cohort === 'synthetic' ? '#d97706' : '#16a34a'}
    >
      <div className="space-y-6">
        {/* Cohort Provenance Banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-xs font-mono-val border border-rule bg-surface-wash">
          <div className="flex items-center gap-3">
            <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              run.source_cohort === 'synthetic' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
            }`}>
              {run.source_cohort}
            </span>
            <span>Split: <code className="text-ink">{run.split_id}</code></span>
            <span>Model: <code className="text-ink">{run.model_version}</code></span>
          </div>
          <div className="text-ink-faint text-[11px] flex gap-3">
            <span>Data SHA: <code>{run.dataset_hash?.slice(0, 8)}</code></span>
            <span>Cfg SHA: <code>{run.config_hash?.slice(0, 8)}</code></span>
            <span>Rev: <code>{run.code_revision?.slice(0, 8)}</code></span>
          </div>
        </div>

        {/* Main Grid: Detection Skill & Lead Time */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Detection skill by cohort and failure slices</caption>
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.1em] text-ink-faint text-left">
                  <th scope="col" className="px-3 py-2 font-semibold">Cohort / Slice</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-right">TSS (95% CI)</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-right">HSS</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-right">FAR</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-right" title="True positives / false positives / false negatives">TP / FP / FN</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-right">PRD target</th>
                </tr>
              </thead>
              <tbody className="text-ink">
                <CohortRow
                  cohort={{
                    label: 'All classes (±15m)',
                    tss: dm.tss,
                    hss: dm.hss,
                    far: dm.far,
                    tp: dm.tp,
                    fp: dm.fp,
                    fn: dm.fn,
                    targetTss,
                    ciTss: cis?.tss,
                  }}
                />
                {fs.m_class_plus && (
                  <CohortRow
                    cohort={{
                      label: 'M-class+ (≥ 1e-5)',
                      tss: fs.m_class_plus.tss,
                      hss: fs.m_class_plus.hss,
                      far: fs.m_class_plus.far,
                      tp: fs.m_class_plus.tp,
                      fp: fs.m_class_plus.fp,
                      fn: fs.m_class_plus.fn,
                      targetTss,
                    }}
                  />
                )}
                {fs.x_class_plus && (
                  <CohortRow
                    cohort={{
                      label: 'X-class+ (≥ 1e-4)',
                      tss: fs.x_class_plus.tss,
                      hss: fs.x_class_plus.hss,
                      far: fs.x_class_plus.far,
                      tp: fs.x_class_plus.tp,
                      fp: fs.x_class_plus.fp,
                      fn: fs.x_class_plus.fn,
                      targetTss,
                    }}
                  />
                )}
              </tbody>
            </table>
          </div>

          {/* Lead Time & Brier Summary */}
          <div className="border border-accent/40 bg-accent-wash p-4 flex flex-col justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">Mean onset lead time</div>
              <div className="mt-1 text-2xl font-bold font-mono-val tabular-nums">
                {lt.mean.toFixed(1)}
                <span className="text-sm text-ink-faint">{' '}min</span>
              </div>
              {cis?.lead_time_mean && (
                <div className="text-[11px] font-mono-val text-ink-muted">
                  95% CI: [{cis.lead_time_mean.ci_lower.toFixed(1)}, {cis.lead_time_mean.ci_upper.toFixed(1)}] min
                </div>
              )}
              <div className="text-[11px] text-ink-muted mt-1">
                detected events, onset-to-peak · target ≥ {targetLeadMin} min
              </div>
            </div>

            <div className="border-t border-rule pt-3 text-[11px] text-ink-muted space-y-1">
              <div className="flex justify-between font-mono-val">
                <span>Overall Brier Score:</span>
                <span className="font-bold text-ink">{cal.brier_score.toFixed(4)}</span>
              </div>
              <div className="flex justify-between font-mono-val">
                <span>Brier Skill Score (vs Clim):</span>
                <span className="font-bold text-ink">{cal.brier_skill_score.toFixed(4)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Per-Horizon Brier Scores & Reliability Calibration Curves */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-rule">
          {/* Horizon Brier Scores Table */}
          <div>
            <h4 className="text-xs font-semibold text-ink mb-2">Per-Horizon Forecast Brier Scores</h4>
            <table className="w-full text-xs font-mono-val">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-ink-faint border-b border-rule">
                  <th className="py-1 text-left">Forecast Horizon</th>
                  <th className="py-1 text-right">Brier Score</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(run.horizon_brier_scores || {}).map(([horizon, brier]) => (
                  <tr key={horizon} className="border-b border-rule/50">
                    <td className="py-1 text-ink-muted">t+{horizon} min</td>
                    <td className="py-1 text-right text-ink font-bold">{brier.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Reliability Curve Table */}
          <div>
            <h4 className="text-xs font-semibold text-ink mb-2">Reliability & Calibration (Binned Probabilities)</h4>
            <div className="max-h-36 overflow-y-auto">
              <table className="w-full text-xs font-mono-val">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-ink-faint border-b border-rule">
                    <th className="py-1 text-left">Bin Center</th>
                    <th className="py-1 text-right">Pred Prob</th>
                    <th className="py-1 text-right">Observed Freq</th>
                    <th className="py-1 text-right">Samples</th>
                  </tr>
                </thead>
                <tbody>
                  {cal.points?.map((pt, i) => (
                    <tr key={i} className="border-b border-rule/50">
                      <td className="py-1 text-ink-muted">{pt.bin_center.toFixed(2)}</td>
                      <td className="py-1 text-right text-ink">{pt.prob_pred.toFixed(3)}</td>
                      <td className="py-1 text-right text-ink font-bold">{pt.prob_true.toFixed(3)}</td>
                      <td className="py-1 text-right text-ink-faint">{pt.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
