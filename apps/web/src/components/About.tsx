import Panel from './ui/Panel';

const PHASE_ONE = [
  { label: 'SoLEXS X-ray', desc: 'Soft X-ray (0.5–10 Å) flux graph rendered live from the Aditya-L1 payload stream.' },
  { label: 'HEL1OS hard X-ray', desc: 'Hard X-ray (10–150 keV) flux graph, co-plotted against the soft X-ray channel.' },
  { label: 'Flare detection', desc: 'BOCPD online change-point detection flags flux onset in real time and drives the nowcast state.' },
  { label: 'Flare classification', desc: 'GOES class (A–X) assigned live, and a searchable catalogue of every detected event.' },
  { label: 'Impact index 0–10', desc: 'Weighted fusion of SXR peak, hardness, impulsivity and duration onto the NOAA R-scale.' },
  { label: '5/10/20/40-min forecast', desc: 'Discrete-time logistic hazard probabilities plus EVT peak-flux quantiles per horizon.' },
  { label: 'Alert / warning', desc: 'Severity-ordered alert feed keyed to the R-scale, streaming with the telemetry.' },
  { label: 'Historical replay', desc: 'Replay any recorded event day at 1×/5×/20×/60× with a scrubbable timeline.' },
];

const METHODOLOGY = [
  {
    title: 'BOCPD Detection',
    tone: '#a78bfa',
    body: 'Bayesian Online Change-Point Detection identifies flux onset in real time, producing the P(CP) posterior overlaid on the telemetry chart. A Neupert-effect cross-correlation gates soft/hard X-ray coupling.',
  },
  {
    title: 'Logistic Hazard',
    tone: '#e6a94c',
    body: 'A calibrated discrete-time logistic hazard model forecasts flare probability over the 5/10/20/40-minute horizons, with GPD-based Extreme Value Theory intensity quantiles (q50/q90/q99).',
  },
  {
    title: 'Impact Fusion',
    tone: '#ef7a5a',
    body: 'Weighted fusion of peak SXR flux, spectral hardness, impulsivity and duration into a single 0–10 impact index, mapped onto the NOAA R-scale with sector guidance for HF, GNSS, satellites and EVA.',
  },
];

export default function About() {
  return (
    <div className="space-y-4">
      <Panel label="About SURYAKAVACH" tone="#e6a94c" meta={<span>SIH 2026 · Space Technology</span>}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 text-sm leading-relaxed text-ink-muted">
            <p className="mb-4 text-ink">
              SURYAKAVACH is an early-warning platform for solar flare radiation impact, built around
              the payloads of ISRO&rsquo;s Aditya-L1 observatory. It reads the Sun&rsquo;s soft and hard
              X-ray flux in near-real time, detects flare onset the moment the flux breaks baseline,
              classifies the event on the GOES scale, and tells power-grid, GNSS, satellite and
              astronaut operators exactly how bad it is about to get.
            </p>
            <p>
              Everything shown on this console today is produced by the deterministic synthetic fused
              cache used for offline validation — it is NOT live Aditya-L1 telemetry. The pipeline
              (detection → nowcast → forecast → impact) runs end to end so every screen behaves exactly
              as it will when the real payload stream is wired in.
            </p>
          </div>
          <div className="border-l border-accent/30 pl-4">
            <div className="text-[10px] uppercase tracking-[0.22em] text-ink-faint">Payloads</div>
            <ul className="mt-3 space-y-2.5 text-sm text-ink">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400" aria-hidden="true" />
                SoLEXS — Soft X-ray Spectrometer
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400" aria-hidden="true" />
                HEL1OS — High Energy L1 Orbiting X-ray Spectrometer
              </li>
            </ul>
          </div>
        </div>
      </Panel>

      <Panel label="Phase 1 — Feature Set" tone="#38bdf8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-rule border border-rule">
          {PHASE_ONE.map((f) => (
            <div key={f.label} className="bg-panel p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-soft">
                {f.label}
              </div>
              <p className="mt-2 text-xs leading-5 text-ink-muted">{f.desc}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel label="Methodology" tone="#e6a94c" meta={<span>offline-validated engines</span>}>
        <dl className="grid grid-cols-1 md:grid-cols-3 gap-px bg-rule border border-rule">
          {METHODOLOGY.map((m) => (
            <div key={m.title} className="bg-panel p-4 border-l-2" style={{ borderLeftColor: m.tone }}>
              <dt className="text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-muted">
                {m.title}
              </dt>
              <dd className="mt-2 text-xs leading-5 text-ink-muted">{m.body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[11px] font-mono-val text-ink-faint">
          Detection skill on the synthetic cache: TSS 1.0 / HSS 1.0 / FAR 0.0 for M+ class, all-class
          cohort carries 56 false positives — see Offline Validation on the Live console.
        </p>
      </Panel>
    </div>
  );
}