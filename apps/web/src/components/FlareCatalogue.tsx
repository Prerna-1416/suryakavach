import { Download } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Plot } from '../lib/plotly';
import { api } from '../lib/api';
import Panel from './ui/Panel';
import Metric from './ui/Metric';
import type { CatalogueData, FlareDetail } from '../types/api';
import { goesClassColor, goesClassBg, SERIES_COLORS, CHART_COLORS } from '../lib/constants';
import { useRouter, isModifiedClick, catalogueUrl } from '../lib/router';
import { detailSlide, usePrefersReducedMotion } from '../lib/motion';

const FILTERS = ['ALL', 'X', 'M', 'C', 'B'] as const;

function fmtTs(ts: string | null | undefined): string {
  return ts ? ts.replace('T', ' ').replace('Z', '') : '—';
}

/** Detail pane: time series, impact breakdown, confidence — driven by the URL. */
function FlareDetailPane({ flare, minClass }: { flare: FlareDetail; minClass: string }) {
  const { go } = useRouter();
  const clsColor = goesClassColor(flare.peak_flux_sxr);
  const series = flare.series;

  const solexsX = series?.solexs.map((d) => d.t) ?? [];
  const solexsY = series?.solexs.map((d) => (d.v && d.v > 0 ? d.v : 1e-9));
  const hel1osX = series?.hel1os.map((d) => d.t) ?? [];
  const hel1osY = series?.hel1os.map((d) => (d.v && d.v > 0 ? d.v : 1e-10));
  const postX = series?.posterior.map((d) => d.t) ?? [];
  const postY = series?.posterior.map((d) => d.v ?? 0);

  return (
    <div className="mt-4 border border-rule">
      <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-b border-rule bg-accent-wash/50">
        <a
          href={catalogueUrl(null, minClass)}
          onClick={(e) => {
            if (isModifiedClick(e)) return;
            e.preventDefault();
            go(catalogueUrl(null, minClass));
          }}
          className="text-[11px] font-mono-val text-accent hover:underline"
        >
          ← All flares
        </a>
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-bold font-mono-val" style={{ color: clsColor }}>
            {flare.class}
          </span>
          <span className="text-sm font-semibold">{flare.id}</span>
        </div>
        <span className="ml-auto text-[11px] font-mono-val text-ink-muted">
          ONSET {fmtTs(flare.onset)} · PEAK {fmtTs(flare.peak)}
        </span>
      </div>

      {solexsX.length > 0 && (
        <div className="border-b border-rule p-3" style={{ height: 320 }}>
          <Plot
            data={[
              { x: solexsX, y: solexsY, type: 'scatter', mode: 'lines', name: 'SoLEXS SXR', line: { color: SERIES_COLORS.sxr, width: 1.8 }, yaxis: 'y' },
              { x: hel1osX, y: hel1osY, type: 'scatter', mode: 'lines', name: 'HEL1OS HXR', line: { color: SERIES_COLORS.hxr, width: 1.5 }, yaxis: 'y2' },
              { x: postX, y: postY, type: 'scatter', mode: 'lines', name: 'BOCPD P(CP)', line: { color: SERIES_COLORS.posterior, width: 1.2, dash: 'dash' }, yaxis: 'y3' },
            ]}
            layout={{
              autosize: true,
              margin: { l: 56, r: 76, t: 16, b: 36 },
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor: CHART_COLORS.plotBg,
              font: { family: 'JetBrains Mono, monospace', size: 10, color: CHART_COLORS.tick },
              xaxis: { gridcolor: CHART_COLORS.grid },
              yaxis: { type: 'log', range: [-8, -3], title: { text: 'SXR W/m²', font: { color: SERIES_COLORS.sxr } }, tickfont: { color: SERIES_COLORS.sxr }, gridcolor: CHART_COLORS.grid },
              yaxis2: { type: 'log', range: [-10, -4], title: { text: 'HXR W/m²', font: { color: SERIES_COLORS.hxr } }, tickfont: { color: SERIES_COLORS.hxr }, overlaying: 'y', side: 'right', showgrid: false },
              yaxis3: { range: [0, 1], title: { text: 'P(CP)', font: { color: SERIES_COLORS.posterior } }, tickfont: { color: SERIES_COLORS.posterior }, overlaying: 'y', side: 'right', position: 0.96, showgrid: false },
              showlegend: true, legend: { orientation: 'h', y: 1.12 },
            } as unknown as Partial<Plotly.Layout>}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%', height: '100%' }}
            useResizeHandler
          />
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
        <Metric label="SXR peak" value={flare.peak_flux_sxr?.toExponential(3) ?? '—'} unit="W/m²" tone={SERIES_COLORS.sxr} />
        <Metric label="HXR peak" value={flare.peak_flux_hxr?.toExponential(3) ?? '—'} unit="W/m²" tone={SERIES_COLORS.hxr} />
        <Metric label="Hardness" value={flare.hardness?.toFixed(3) ?? '—'} />
        <Metric label="Impulsivity" value={flare.impulsivity?.toFixed(2) ?? '—'} />
        <Metric label="Impact index" value={flare.impact_index?.toFixed(2) ?? '—'} unit="/ 10" />
        <Metric label="R-level" value={flare.r_level ?? '—'} />
        <Metric label="Detection" value={flare.detection_method ?? '—'} />
        <Metric label="Posterior" value={flare.posterior?.toFixed(3) ?? '—'} />
      </div>

      {flare.subscores && (
        <div className="px-4 pb-4">
          <div className="text-[10px] uppercase tracking-[0.12em] text-ink-faint mb-2">Impact subscores</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Metric label="Peak SXR" value={flare.subscores.peak_sxr.toFixed(3)} />
            <Metric label="Hardness" value={flare.subscores.hardness.toFixed(3)} />
            <Metric label="Impulsivity" value={flare.subscores.impulsivity.toFixed(3)} />
            <Metric label="Duration" value={flare.subscores.duration.toFixed(3)} />
          </div>
        </div>
      )}

      {flare.confidence && (
        <p className="px-4 pb-4 text-xs font-mono-val text-ink-muted border-t border-rule pt-3 -mt-1">
          {flare.confidence}
        </p>
      )}
    </div>
  );
}

export default function FlareCatalogue() {
  const { route, go } = useRouter();
  const minClass = route.minClass;
  const reduced = usePrefersReducedMotion();

  const { data, isLoading } = useQuery({
    queryKey: ['catalogue', minClass],
    queryFn: () =>
      api.get<CatalogueData>(
        `/api/flare/catalogue?min_class=${minClass === 'ALL' ? 'A' : minClass}&page_size=50`,
      ),
  });

  const { data: detail, isError: detailError } = useQuery({
    queryKey: ['flare', route.flareId],
    queryFn: () => api.get<FlareDetail>(`/api/flare/${route.flareId}`),
    enabled: !!route.flareId,
    staleTime: 60_000,
  });

  const flares = data?.items ?? [];
  const total = data?.total ?? 0;

  const handleDownloadCsv = () => {
    window.location.href = '/api/flare/catalogue?format=csv';
  };

  return (
    <Panel
      label="Flare Catalogue"
      tone="#e6a94c"
      meta={<span>{total} events · synthetic cache</span>}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        {/* Class filter lives in the URL (?class=M) so a filtered view is shareable. */}
        <div className="flex items-center border border-rule text-[11px] font-mono-val" role="group" aria-label="Class filter">
          {FILTERS.map((c) => {
            const active = minClass === c;
            const href = catalogueUrl(null, c);
            return (
              <a
                key={c}
                href={href}
                aria-current={active ? 'true' : undefined}
                onClick={(e) => {
                  if (isModifiedClick(e)) return;
                  e.preventDefault();
                  go(href);
                }}
                className={`px-3 py-1 ${
                  active ? 'bg-accent text-white font-bold' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {c === 'ALL' ? 'ALL' : `${c}-CLASS`}
              </a>
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleDownloadCsv}
          aria-label="Export catalogue as CSV"
          className="px-3 py-1.5 text-[11px] font-semibold border border-rule text-ink-muted hover:text-ink hover:border-rule-strong flex items-center gap-1.5 transition-colors"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Export CSV</span>
        </button>
      </div>

      <div className="overflow-x-auto border border-rule">
        <table className="w-full text-left text-xs font-mono-val tabular-nums" role="grid" aria-label="Flare catalogue">
          <thead className="bg-surface text-ink-faint uppercase text-[10px] tracking-[0.1em] border-b border-rule">
            <tr>
              <th className="px-3 py-2 font-semibold">ID</th>
              <th className="px-3 py-2 font-semibold">Onset (UTC)</th>
              <th className="px-3 py-2 font-semibold">Peak</th>
              <th className="px-3 py-2 font-semibold">Class</th>
              <th className="px-3 py-2 font-semibold text-right">SXR peak</th>
              <th className="px-3 py-2 font-semibold text-right">Hardness</th>
              <th className="px-3 py-2 font-semibold text-right">Impulsivity</th>
              <th className="px-3 py-2 font-semibold text-right">Impact</th>
              <th className="px-3 py-2 font-semibold">Detection</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule bg-panel text-ink">
            {isLoading ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-ink-faint font-sans">
                  Loading catalogue items…
                </td>
              </tr>
            ) : flares.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-ink-faint font-sans">
                  No flare events matching filter criteria.
                </td>
              </tr>
            ) : (
              flares.map((row) => {
                const href = catalogueUrl(row.id, minClass);
                const selected = route.flareId === row.id;
                return (
                  <tr
                    key={row.id}
                    className={selected ? 'bg-accent-wash' : 'hover:bg-surface'}
                  >
                    <td className="px-3 py-2">
                      <a
                        href={href}
                        onClick={(e) => {
                          if (isModifiedClick(e)) return;
                          e.preventDefault();
                          go(href);
                        }}
                        className={`font-semibold underline-offset-2 hover:underline ${selected ? 'text-accent' : 'text-ink'}`}
                        aria-current={selected ? 'true' : undefined}
                      >
                        {row.id}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{fmtTs(row.onset)}</td>
                    <td className="px-3 py-2 text-ink-muted">{fmtTs(row.peak)}</td>
                    <td
                      className="px-3 py-2 font-bold"
                      style={{ color: goesClassColor(row.peak_flux_sxr), backgroundColor: goesClassBg(row.peak_flux_sxr) }}
                    >
                      {row.class || 'A0.0'}
                    </td>
                    <td className="px-3 py-2 text-right text-ink-muted">
                      {row.peak_flux_sxr ? row.peak_flux_sxr.toExponential(2) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-ink-muted">
                      {row.hardness ? row.hardness.toFixed(3) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-ink-muted">
                      {row.impulsivity ? row.impulsivity.toFixed(2) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{row.impact_index.toFixed(2)}</td>
                    <td className="px-3 py-2 text-ink-faint">{row.detection_method || '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {route.flareId && (
          <motion.div
            key={route.flareId}
            initial={reduced ? false : detailSlide.initial}
            animate={reduced ? undefined : detailSlide.animate}
            exit={reduced ? undefined : detailSlide.exit}
            transition={reduced ? { duration: 0 } : detailSlide.transition}
          >
            {detail ? (
              <FlareDetailPane flare={detail} minClass={minClass} />
            ) : detailError ? (
              <p className="mt-4 border border-rule border-l-2 border-l-alarm px-4 py-3 text-xs font-mono-val text-ink-muted">
                Flare {route.flareId} not found.
              </p>
            ) : (
              <p className="mt-4 px-1 text-xs font-mono-val text-ink-faint">Loading flare {route.flareId}…</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  );
}
