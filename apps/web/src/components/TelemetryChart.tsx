import { useState, useMemo } from 'react';
import { Plot } from '../lib/plotly';
import Panel from './ui/Panel';
import type { StreamsLatest } from '../types/api';
import { GOES_CLASSES, SERIES_COLORS, CHART_COLORS, goesClassColor } from '../lib/constants';
import { useIsMobile } from '../lib/responsive';

interface TelemetryChartProps {
  streams: StreamsLatest | null;
  windowSize: number;
  onWindowChange: (w: number) => void;
}

const WINDOWS = [60, 120, 360, 1440];

/** Plot height: short enough to leave the page scannable on a phone, tall
 *  enough that a decade of the log axis stays legible. */
const HEIGHT_MOBILE = 300;
const HEIGHT_DESKTOP = 400;

/** Compress the per-sample quality flags into ≤160 cells for the strip. */
function bucketQuality(quality: number[], maxCells = 160): number[] {
  if (quality.length <= maxCells) return quality;
  const size = Math.ceil(quality.length / maxCells);
  const out: number[] = [];
  for (let i = 0; i < quality.length; i += size) {
    const slice = quality.slice(i, i + size);
    // A cell counts as good only if the whole bucket is good.
    out.push(slice.every((q) => q !== 0) ? 1 : 0);
  }
  return out;
}

export default function TelemetryChart({ streams, windowSize, onWindowChange }: TelemetryChartProps) {
  const isMobile = useIsMobile();
  const chartHeight = isMobile ? HEIGHT_MOBILE : HEIGHT_DESKTOP;
  // Three overlaid axes do not survive a 320px column: the posterior starts
  // hidden on phones (one tap restores it) so the two payload traces and the
  // flare bands get the full width.
  const [showPosterior, setShowPosterior] = useState(() => !isMobile);

  const solexs = streams?.solexs ?? [];
  const hel1os = streams?.hel1os ?? [];
  const changepoints = streams?.changepoints ?? [];
  const gaps = streams?.gaps ?? [];
  const flareIntervals = streams?.flare_intervals ?? [];
  const quality = streams?.quality ?? [];

  const { sxrX, sxrY, hxrX, hxrY, cpX, cpY, qualityCells } = useMemo(() => {
    const sxrX = solexs.map((d) => d.t);
    const sxrY = solexs.map((d) => (d.v && d.v > 0 ? d.v : 1e-9));
    const hxrX = hel1os.map((d) => d.t);
    const hxrY = hel1os.map((d) => (d.v && d.v > 0 ? d.v : 1e-10));

    const cpMap = new Map<string, number>();
    changepoints.forEach((cp) => cpMap.set(cp.t, cp.p));
    const cpX: string[] = [];
    const cpY: number[] = [];
    solexs.forEach((d) => {
      if (cpMap.has(d.t)) {
        cpX.push(d.t);
        cpY.push(cpMap.get(d.t)!);
      }
    });

    return { sxrX, sxrY, hxrX, hxrY, cpX, cpY, qualityCells: bucketQuality(quality) };
  }, [solexs, hel1os, changepoints, quality]);

  const layout = useMemo(
    () => ({
      autosize: true,
      height: chartHeight,
      // Right margin widened: two axes live on the right (HXR + P(CP)).
      // On a phone the margins are drawn in: every pixel of left/right inset
      // is a pixel the traces lose, and the axis titles are dropped because
      // the tick labels already carry the unit (A…X10 / W/m²).
      margin: isMobile
        ? { l: 40, r: showPosterior ? 44 : 38, t: 8, b: 30 }
        : { l: 56, r: 76, t: 16, b: 36 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: CHART_COLORS.plotBg,
      font: { family: 'JetBrains Mono, monospace', size: isMobile ? 9 : 10, color: CHART_COLORS.tick },
      // Touch: drag-to-zoom would swallow the page scroll gesture, so on a
      // phone the plot is fixed-range and the window buttons do the zooming.
      dragmode: isMobile ? false : 'zoom',
      xaxis: {
        gridcolor: CHART_COLORS.grid,
        zerolinecolor: CHART_COLORS.zeroline,
        tickangle: 0,
        nticks: isMobile ? 5 : 12,
        fixedrange: isMobile,
      },
      yaxis: {
        type: 'log',
        range: [-8, -3],
        title: isMobile
          ? undefined
          : { text: 'SXR W/m²', font: { color: SERIES_COLORS.sxr } },
        tickfont: { color: SERIES_COLORS.sxr },
        gridcolor: CHART_COLORS.grid,
        zerolinecolor: CHART_COLORS.zeroline,
        tickvals: [1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3],
        ticktext: ['A', 'B', 'C', 'M', 'X', 'X10'],
        fixedrange: isMobile,
      },
      yaxis2: {
        type: 'log',
        range: [-10, -4],
        title: isMobile
          ? undefined
          : { text: 'HXR W/m²', font: { color: SERIES_COLORS.hxr } },
        tickfont: { color: SERIES_COLORS.hxr },
        overlaying: 'y',
        side: 'right',
        showgrid: false,
        fixedrange: isMobile,
      },
      // Posterior is a 0–1 probability: it needs its own linear axis.
      // Plotting it on the log SXR axis left it five decades below the
      // visible window, i.e. invisible.
      yaxis3: {
        range: [0, 1],
        title: isMobile
          ? undefined
          : { text: 'P(CP)', font: { color: SERIES_COLORS.posterior } },
        tickfont: { color: SERIES_COLORS.posterior },
        overlaying: 'y',
        side: 'right',
        position: 0.96,
        showgrid: false,
        fixedrange: isMobile,
      },
      // Phones drop the legend: the series are identified by the panel meta
      // and the labelled axes, and a 3-row legend costs ~15% of the height.
      showlegend: !isMobile,
      legend: { orientation: 'h', y: 1.12, font: { size: 10, color: CHART_COLORS.tick } },
      shapes: [
        // Data gaps: grey bands behind the traces.
        ...gaps.map((gap) => ({
          type: 'rect' as const,
          xref: 'x',
          x0: gap.start,
          x1: gap.end,
          yref: 'paper' as const,
          y0: 0,
          y1: 1,
          fillcolor: CHART_COLORS.gapBand,
          opacity: 0.7,
          line: { width: 0 },
        })),
        // Detected flare intervals, tinted by GOES class.
        ...flareIntervals.map((fi) => ({
          type: 'rect' as const,
          xref: 'x',
          x0: fi.start,
          x1: fi.end,
          yref: 'paper' as const,
          y0: 0,
          y1: 1,
          fillcolor: goesClassColor(1e-6), // placeholder, replaced below
          opacity: 0,
          line: { width: 0 },
        })),
        // GOES class thresholds.
        ...GOES_CLASSES.slice(1).map((cls) => ({
          type: 'line' as const,
          xref: 'paper' as const,
          x0: 0,
          x1: 1,
          y0: cls.threshold,
          y1: cls.threshold,
          yref: 'y',
          line: { color: `${cls.color}99`, width: 1, dash: 'dot' },
        })),
      ],
    }),
    [gaps, flareIntervals, isMobile, showPosterior, chartHeight],
  ) as unknown as Partial<Plotly.Layout>;

  // Tint each flare-interval band with its own class colour. The shapes
  // array is [gaps..., flareIntervals..., GOES lines], so the interval at
  // index i lives at gaps.length + i.
  const layoutWithFlares = useMemo(() => {
    if (flareIntervals.length === 0) return layout;
    const shapes = [...(layout.shapes ?? [])];
    flareIntervals.forEach((fi, i) => {
      const flux =
        GOES_CLASSES.find((c) => c.label === fi.class.charAt(0).toUpperCase())?.threshold ?? 1e-6;
      const shapeIdx = gaps.length + i;
      if (shapes[shapeIdx]) {
        shapes[shapeIdx] = {
          ...shapes[shapeIdx],
          fillcolor: goesClassColor(flux),
          opacity: 0.12,
        };
      }
    });
    return { ...layout, shapes };
  }, [layout, flareIntervals, gaps.length]);

  const data: Plotly.Data[] = [
    {
      x: sxrX,
      y: sxrY,
      type: 'scatter',
      mode: 'lines',
      name: 'SoLEXS SXR',
      line: { color: SERIES_COLORS.sxr, width: 1.8 },
      fill: 'tozeroy',
      fillcolor: 'rgba(56, 189, 248, 0.09)',
      yaxis: 'y',
    },
    {
      x: hxrX,
      y: hxrY,
      type: 'scatter',
      mode: 'lines',
      name: 'HEL1OS HXR',
      line: { color: SERIES_COLORS.hxr, width: 1.5 },
      yaxis: 'y2',
    },
    ...(showPosterior && cpX.length > 0
      ? [
          {
            x: cpX,
            y: cpY,
            type: 'scatter' as const,
            mode: 'lines' as const,
            name: 'BOCPD P(CP)',
            line: { color: SERIES_COLORS.posterior, width: 1.2, dash: 'dash' },
            yaxis: 'y3',
          },
        ]
      : []),
  ];

  return (
    <Panel
      label="X-Ray Telemetry — Aditya-L1"
      tone={SERIES_COLORS.sxr}
      meta={
        <>
          <span>{solexs.length} pts</span>
          {gaps.length > 0 && <span>{gaps.length} gaps</span>}
          {flareIntervals.length > 0 && <span>{flareIntervals.length} flares</span>}
        </>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <button
          type="button"
          onClick={() => setShowPosterior(!showPosterior)}
          aria-pressed={showPosterior}
          className={`sk-touch px-2.5 py-1 text-[11px] font-mono-val border transition-colors ${
            showPosterior
              ? 'text-accent border-accent bg-accent-wash'
              : 'text-ink-muted border-rule hover:text-ink'
          }`}
        >
          BOCPD P(CP)
        </button>

        <div className="flex items-center border border-rule text-[11px] font-mono-val">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => onWindowChange(w)}
              aria-pressed={windowSize === w}
              aria-label={`Show ${w >= 60 ? `${w / 60} hours` : `${w} minutes`} of telemetry`}
              className={`sk-touch px-2.5 py-1 ${
                windowSize === w
                  ? 'bg-accent text-white font-bold'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              {w >= 60 ? `${w / 60}h` : `${w}m`}
            </button>
          ))}
        </div>
      </div>

      {/* Height is owned by the wrapper (CSS px), the Plot fills it and
          useResizeHandler re-measures on every container resize — no
          window.innerWidth read anywhere in this component. */}
      <div className="w-full" style={{ height: chartHeight }}>
        <Plot
          data={data}
          layout={layoutWithFlares}
          config={{
            displayModeBar: false,
            responsive: true,
            scrollZoom: false,
            doubleClick: false,
            displaylogo: false,
          }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
        />
      </div>

      {/* Inline series key, phones only — replaces the hidden Plotly legend. */}
      {isMobile && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[10px] font-mono-val text-ink-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-[2px]" style={{ background: SERIES_COLORS.sxr }} aria-hidden="true" />
            SoLEXS SXR
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-[2px]" style={{ background: SERIES_COLORS.hxr }} aria-hidden="true" />
            HEL1OS HXR
          </span>
          {showPosterior && (
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-[2px]"
                style={{ background: `repeating-linear-gradient(90deg, ${SERIES_COLORS.posterior} 0 3px, transparent 3px 6px)` }}
                aria-hidden="true"
              />
              BOCPD P(CP)
            </span>
          )}
        </div>
      )}

      {/* Per-sample data quality — one cell per bucket, full width. */}
      {qualityCells.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">Data quality</span>
            <span className="text-[10px] font-mono-val text-ink-faint">
              {qualityCells.filter((q) => q === 0).length === 0 ? 'no gaps in window' : 'grey = gap'}
            </span>
          </div>
          <div
            className="flex w-full h-2 border border-rule overflow-hidden"
            role="img"
            aria-label={`Data quality strip: ${qualityCells.filter((q) => q === 0).length} of ${qualityCells.length} buckets contain gaps`}
          >
            {qualityCells.map((q, i) => (
              <div
                key={i}
                className="flex-1"
                style={{ backgroundColor: q === 0 ? 'var(--color-rule-strong)' : 'var(--color-ok)' }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3 border-t border-rule text-[11px] text-ink-faint font-mono-val">
        <div className="flex items-center gap-3">
          <span className="font-sans">GOES scale</span>
          {GOES_CLASSES.map((cls) => (
            <span key={cls.label} style={{ color: cls.color }}>
              {cls.label} {cls.threshold.toExponential(0)}
            </span>
          ))}
        </div>
        <div>SoLEXS 0.5–10 Å · HEL1OS 10–150 keV</div>
      </div>
    </Panel>
  );
}
