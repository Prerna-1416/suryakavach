import { useEffect, useRef } from 'react';
import { Download, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Plot } from '../lib/plotly';
import { api } from '../lib/api';
import Panel from './ui/Panel';
import Metric from './ui/Metric';
import type { CatalogueData, CatalogueFlare, FlareDetail } from '../types/api';
import { goesClassColor, goesClassBg, SERIES_COLORS, CHART_COLORS } from '../lib/constants';
import { useRouter, isModifiedClick, catalogueUrl } from '../lib/router';
import { detailSlide, usePrefersReducedMotion } from '../lib/motion';
import { useIsMobile } from '../lib/responsive';

const FILTERS = ['ALL', 'X', 'M', 'C', 'B'] as const;

function fmtTs(ts: string | null | undefined): string {
  return ts ? ts.replace('T', ' ').replace('Z', '') : '—';
}

/**
 * The detail reading itself — chart, flux metrics, subscores, confidence.
 * Shared by the desktop side pane and the phone bottom sheet so both surfaces
 * show exactly the same numbers.
 */
function FlareDetailContent({ flare }: { flare: FlareDetail }) {
  const isMobile = useIsMobile();
  const series = flare.series;

  const solexsX = series?.solexs.map((d) => d.t) ?? [];
  const solexsY = series?.solexs.map((d) => (d.v && d.v > 0 ? d.v : 1e-9));
  const hel1osX = series?.hel1os.map((d) => d.t) ?? [];
  const hel1osY = series?.hel1os.map((d) => (d.v && d.v > 0 ? d.v : 1e-10));
  const postX = series?.posterior.map((d) => d.t) ?? [];
  const postY = series?.posterior.map((d) => d.v ?? 0);

  return (
    <>
      {solexsX.length > 0 && (
        <div className="border-b border-rule p-2 md:p-3" style={{ height: isMobile ? 240 : 320 }}>
          <Plot
            data={[
              { x: solexsX, y: solexsY, type: 'scatter', mode: 'lines', name: 'SoLEXS SXR', line: { color: SERIES_COLORS.sxr, width: 1.8 }, yaxis: 'y' },
              { x: hel1osX, y: hel1osY, type: 'scatter', mode: 'lines', name: 'HEL1OS HXR', line: { color: SERIES_COLORS.hxr, width: 1.5 }, yaxis: 'y2' },
              { x: postX, y: postY, type: 'scatter', mode: 'lines', name: 'BOCPD P(CP)', line: { color: SERIES_COLORS.posterior, width: 1.2, dash: 'dash' }, yaxis: 'y3' },
            ]}
            layout={{
              autosize: true,
              // Same mobile reasoning as the console chart: draw the margins
              // in and drop the axis titles, which the tick labels already carry.
              margin: isMobile ? { l: 40, r: 44, t: 8, b: 30 } : { l: 56, r: 76, t: 16, b: 36 },
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor: CHART_COLORS.plotBg,
              font: { family: 'JetBrains Mono, monospace', size: isMobile ? 9 : 10, color: CHART_COLORS.tick },
              dragmode: isMobile ? false : 'zoom',
              xaxis: { gridcolor: CHART_COLORS.grid, nticks: isMobile ? 4 : 12, fixedrange: isMobile },
              yaxis: { type: 'log', range: [-8, -3], title: isMobile ? undefined : { text: 'SXR W/m²', font: { color: SERIES_COLORS.sxr } }, tickfont: { color: SERIES_COLORS.sxr }, gridcolor: CHART_COLORS.grid, fixedrange: isMobile },
              yaxis2: { type: 'log', range: [-10, -4], title: isMobile ? undefined : { text: 'HXR W/m²', font: { color: SERIES_COLORS.hxr } }, tickfont: { color: SERIES_COLORS.hxr }, overlaying: 'y', side: 'right', showgrid: false, fixedrange: isMobile },
              yaxis3: { range: [0, 1], title: isMobile ? undefined : { text: 'P(CP)', font: { color: SERIES_COLORS.posterior } }, tickfont: { color: SERIES_COLORS.posterior }, overlaying: 'y', side: 'right', position: 0.96, showgrid: false, fixedrange: isMobile },
              showlegend: !isMobile,
              legend: { orientation: 'h', y: 1.12 },
            } as unknown as Partial<Plotly.Layout>}
            config={{ displayModeBar: false, responsive: true, scrollZoom: false, doubleClick: false, displaylogo: false }}
            style={{ width: '100%', height: '100%' }}
            useResizeHandler
          />
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 p-3 md:p-4">
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
        <div className="px-3 md:px-4 pb-3 md:pb-4">
          <div className="text-[10px] uppercase tracking-[0.12em] text-ink-faint mb-2">Impact subscores</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <Metric label="Peak SXR" value={flare.subscores.peak_sxr.toFixed(3)} />
            <Metric label="Hardness" value={flare.subscores.hardness.toFixed(3)} />
            <Metric label="Impulsivity" value={flare.subscores.impulsivity.toFixed(3)} />
            <Metric label="Duration" value={flare.subscores.duration.toFixed(3)} />
          </div>
        </div>
      )}

      {flare.confidence && (
        <p className="px-3 md:px-4 pb-3 md:pb-4 text-xs font-mono-val text-ink-muted border-t border-rule pt-3">
          {flare.confidence}
        </p>
      )}
    </>
  );
}

/** Flare identity header, shared by the pane and the sheet. */
function FlareDetailHead({
  flare,
  minClass,
  onClose,
  closeRef,
}: {
  flare: FlareDetail;
  minClass: string;
  onClose?: () => void;
  closeRef?: React.Ref<HTMLButtonElement>;
}) {
  const { go } = useRouter();
  const clsColor = goesClassColor(flare.peak_flux_sxr);
  const backHref = catalogueUrl(null, minClass);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 md:px-4 py-2 md:py-3 border-b border-rule bg-accent-wash/50">
      <a
        href={backHref}
        onClick={(e) => {
          if (isModifiedClick(e)) return;
          e.preventDefault();
          go(backHref);
        }}
        className="sk-touch flex items-center text-[11px] font-mono-val text-accent hover:underline"
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
      {onClose && (
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close flare detail"
          className="sk-touch ml-auto md:ml-0 flex items-center justify-center w-11 border border-rule text-ink-muted"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/**
 * Phone presentation of the detail: a bottom sheet instead of a narrow side
 * pane. The backdrop, Escape and the close control all resolve to the same
 * navigation — back to the filtered list — so the URL stays the single source
 * of truth for which flare is open.
 */
function FlareDetailSheet({
  flare,
  minClass,
  onClose,
}: {
  flare: FlareDetail;
  minClass: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('sk-scroll-locked');
    const id = window.setTimeout(() => closeRef.current?.focus(), 0);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('keydown', onKeyDown);
      document.documentElement.classList.remove('sk-scroll-locked');
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] md:hidden" role="dialog" aria-modal="true" aria-label={`Flare ${flare.id} detail`}>
      <div className="sk-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="sk-sheet">
        <span className="sk-sheet-grip" aria-hidden="true" />
        <div className="shrink-0">
          <FlareDetailHead flare={flare} minClass={minClass} onClose={onClose} closeRef={closeRef} />
        </div>
        <div className="sk-sheet-body">
          <FlareDetailContent flare={flare} />
        </div>
      </div>
    </div>
  );
}

/**
 * Catalogue: filters and CSV export always reachable, then either the full
 * nine-column table (tablet and up, horizontally contained if it overflows) or
 * one card per event on a phone. The detail opens in place on desktop and as a
 * bottom sheet on phones.
 */
export default function FlareCatalogue() {
  const { route, go } = useRouter();
  const minClass = route.minClass;
  const reduced = usePrefersReducedMotion();
  const isMobile = useIsMobile();

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

  const selectFlare = (row: CatalogueFlare) => {
    const href = catalogueUrl(row.id, minClass);
    return (e: React.MouseEvent) => {
      if (isModifiedClick(e)) return;
      e.preventDefault();
      go(href);
    };
  };

  const closeDetail = () => go(catalogueUrl(null, minClass));

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
                className={`sk-touch flex items-center px-2.5 md:px-3 py-1 ${
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
          className="sk-touch px-3 py-1.5 text-[11px] font-semibold border border-rule text-ink-muted hover:text-ink hover:border-rule-strong flex items-center gap-1.5 transition-colors"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Export CSV</span>
        </button>
      </div>

      {/* ---- Phones: one card per event. No forced table, no sideways scroll. ---- */}
      {isMobile ? (
        <ul className="flex flex-col gap-2" aria-label="Flare catalogue">
          {isLoading ? (
            <li className="border border-rule px-3 py-6 text-center text-ink-faint text-xs font-mono-val">
              Loading catalogue items…
            </li>
          ) : flares.length === 0 ? (
            <li className="border border-rule px-3 py-6 text-center text-ink-faint text-xs font-mono-val">
              No flare events matching filter criteria.
            </li>
          ) : (
            flares.map((row) => {
              const selected = route.flareId === row.id;
              return (
                <li key={row.id}>
                  <a
                    href={catalogueUrl(row.id, minClass)}
                    onClick={selectFlare(row)}
                    aria-current={selected ? 'true' : undefined}
                    className={`sk-card sk-card-press block p-3 ${
                      selected ? 'border-accent bg-accent-wash' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[11px] font-bold px-1.5 py-0.5 font-mono-val shrink-0"
                        style={{
                          color: goesClassColor(row.peak_flux_sxr),
                          backgroundColor: goesClassBg(row.peak_flux_sxr),
                        }}
                      >
                        {row.class || 'A0.0'}
                      </span>
                      <span className="font-mono-val text-sm font-semibold">{row.id}</span>
                      <span className="ml-auto font-mono-val text-sm font-bold tabular-nums shrink-0">
                        {row.impact_index.toFixed(2)}
                        <span className="text-ink-faint font-normal"> /10</span>
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono-val text-ink-muted">
                      <span>ONSET {fmtTs(row.onset)}</span>
                      <span className="text-ink-faint">PEAK {fmtTs(row.peak)}</span>
                    </div>

                    <dl className="grid grid-cols-3 gap-2 mt-2.5 pt-2.5 border-t border-rule text-[11px] font-mono-val tabular-nums">
                      <div className="min-w-0">
                        <dt className="text-[10px] uppercase tracking-[0.1em] text-ink-faint">SXR</dt>
                        <dd className="mt-0.5 text-ink-muted truncate" style={{ color: SERIES_COLORS.sxr }}>
                          {row.peak_flux_sxr ? row.peak_flux_sxr.toExponential(1) : '—'}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10px] uppercase tracking-[0.1em] text-ink-faint">Hardness</dt>
                        <dd className="mt-0.5 text-ink-muted truncate">{row.hardness ? row.hardness.toFixed(2) : '—'}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10px] uppercase tracking-[0.1em] text-ink-faint">Impuls.</dt>
                        <dd className="mt-0.5 text-ink-muted truncate">{row.impulsivity ? row.impulsivity.toFixed(2) : '—'}</dd>
                      </div>
                    </dl>

                    <div className="mt-2 text-[10px] font-mono-val text-ink-faint">
                      DETECTION {row.detection_method || '—'}
                    </div>
                  </a>
                </li>
              );
            })
          )}
        </ul>
      ) : (
        /* ---- Tablet and up: the full table, scroll contained if it overflows. ---- */
        <div className="sk-hscroll-wrap">
          <div className="sk-hscroll border border-rule">
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
        </div>
      )}

      {/* ---- Detail: bottom sheet on phones, in-flow pane from 768px up. ---- */}
      {isMobile ? (
        <AnimatePresence>
          {route.flareId && detail && (
            <motion.div
              key={route.flareId}
              initial={reduced ? { opacity: 1 } : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduced ? { opacity: 1 } : { opacity: 0 }}
              transition={reduced ? { duration: 0 } : { duration: 0.18 }}
            >
              <FlareDetailSheet flare={detail} minClass={minClass} onClose={closeDetail} />
            </motion.div>
          )}
        </AnimatePresence>
      ) : (        <AnimatePresence mode="wait" initial={false}>
          {route.flareId && (
            <motion.div
              key={route.flareId}
              initial={reduced ? false : detailSlide.initial}
              animate={reduced ? undefined : detailSlide.animate}
              exit={reduced ? undefined : detailSlide.exit}
              transition={reduced ? { duration: 0 } : detailSlide.transition}
            >
              {detail ? (
                <div className="mt-4 border border-rule">
                  <FlareDetailHead flare={detail} minClass={minClass} />
                  <FlareDetailContent flare={detail} />
                </div>
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
      )}

      {/* A sheet that cannot resolve its flare id — or is still fetching it —
          still has to say so. */}
      {isMobile && route.flareId && !detail && (
        <p
          role={detailError ? 'alert' : undefined}
          className={`mt-3 border border-rule px-3 py-3 text-xs font-mono-val ${
            detailError ? 'border-l-2 border-l-alarm text-ink-muted' : 'text-ink-faint'
          }`}
        >
          {detailError ? `Flare ${route.flareId} not found.` : `Loading flare ${route.flareId}…`}
        </p>
      )}
    </Panel>
  );
}
