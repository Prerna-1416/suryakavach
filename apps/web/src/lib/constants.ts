// GOES flare classification thresholds (W/m²) for 1-8 Å soft X-ray band
// A < 1e-7, B = 1e-7→1e-6, C = 1e-6→1e-5, M = 1e-5→1e-4, X ≥ 1e-4
// `bg` is a translucent dark-scene wash of the class colour.
export const GOES_CLASSES = [
  { label: 'A', threshold: 0, color: '#16a34a', bg: 'rgba(22, 163, 74, 0.12)' },
  { label: 'B', threshold: 1e-7, color: '#0284c7', bg: 'rgba(2, 132, 199, 0.14)' },
  { label: 'C', threshold: 1e-6, color: '#d97706', bg: 'rgba(217, 119, 6, 0.14)' },
  { label: 'M', threshold: 1e-5, color: '#ea580c', bg: 'rgba(234, 88, 12, 0.16)' },
  { label: 'X', threshold: 1e-4, color: '#dc2626', bg: 'rgba(220, 38, 38, 0.18)' },
] as const;

export function goesClass(flux: number): string {
  for (let i = GOES_CLASSES.length - 1; i >= 0; i--) {
    if (flux >= GOES_CLASSES[i].threshold) return GOES_CLASSES[i].label;
  }
  return 'A';
}

export function goesClassColor(flux: number): string {
  for (let i = GOES_CLASSES.length - 1; i >= 0; i--) {
    if (flux >= GOES_CLASSES[i].threshold) return GOES_CLASSES[i].color;
  }
  return GOES_CLASSES[0].color;
}

/** Pale tint of the matching GOES class, for cell/badge washes. */
export function goesClassBg(flux: number): string {
  for (let i = GOES_CLASSES.length - 1; i >= 0; i--) {
    if (flux >= GOES_CLASSES[i].threshold) return GOES_CLASSES[i].bg;
  }
  return GOES_CLASSES[0].bg;
}

// Presentation-only fallback; thresholds, bands, and weights come from
// /api/impact/scale so the dashboard cannot drift from the backend model.
const R_LEVEL_COLORS: Record<string, string> = {
  R0: '#16a34a', R1: '#0284c7', R2: '#d97706', R3: '#ea580c', R4: '#dc2626', R5: '#991b1b',
};

export function rLevelColor(level: string): string {
  return R_LEVEL_COLORS[level] ?? 'var(--color-ink-faint)';
}

// Forecast horizon defaults (minutes)
export const FORECAST_HORIZONS = [5, 10, 20, 40] as const;

// Risk probability thresholds
export const RISK_THRESHOLDS = {
  low: 0.2,
  moderate: 0.5,
  high: 0.8,
} as const;

export function riskLevel(p: number): 'low' | 'moderate' | 'high' | 'extreme' {
  if (p >= RISK_THRESHOLDS.high) return 'extreme';
  if (p >= RISK_THRESHOLDS.moderate) return 'high';
  if (p >= RISK_THRESHOLDS.low) return 'moderate';
  return 'low';
}

export function riskColor(p: number): string {
  if (p >= RISK_THRESHOLDS.high) return '#dc2626';
  if (p >= RISK_THRESHOLDS.moderate) return '#ea580c';
  if (p >= RISK_THRESHOLDS.low) return '#d97706';
  return '#16a34a';
}

// Instrument series colours — single source for every Plotly trace and
// legend. Brightened so they hold up on the dark space surface.
export const SERIES_COLORS = {
  sxr: '#38bdf8',       // SoLEXS soft X-ray — sky
  hxr: '#fb923c',       // HEL1OS hard X-ray — amber
  posterior: '#a78bfa', // BOCPD P(CP) — violet
} as const;

// Chart chrome neutrals, matched to the token palette in index.css.
export const CHART_COLORS = {
  grid: '#1c2434',
  zeroline: '#2c3850',
  plotBg: '#0a0f1c',
  gapBand: '#141b2a',
  tick: '#93a0b6',
} as const;

/**
 * Offline validation metrics.
 *
 * Transcribed by hand from backend/reports/metrics.md — synthetic fused
 * SoLEXS/HEL1OS cache, NOT an operational claim. Both cohorts are shown on
 * the dashboard: the all-class row is where the 56 false positives live, and
 * hiding it behind the M+ row would misrepresent the evaluation.
 *
 * There is no /api/metrics endpoint yet; when one exists, delete this
 * constant and query it instead — the panel reads it through one import.
 */
export const METRICS = {
  allClass: { label: 'All classes', tss: 0.001, hss: 0.001, far: 0.659, tp: 29, fp: 56, fn: 1 },
  mPlus: { label: 'M+ only', tss: 1.0, hss: 1.0, far: 0.0 },
  meanOnsetLeadMin: 16.5,
  targetTss: 0.6,
  targetLeadMin: 3,
  provenance: 'backend/reports/metrics.md — synthetic fused SoLEXS/HEL1OS cache',
} as const;

// Nowcast state labels and colors
export const NOWCAST_STATES = {
  quiet: { label: 'Quiet', color: '#16a34a', bg: 'rgba(22, 163, 74, 0.12)' },
  onset: { label: 'Onset', color: '#d97706', bg: 'rgba(217, 119, 6, 0.14)' },
  rising: { label: 'Rising', color: '#ea580c', bg: 'rgba(234, 88, 12, 0.16)' },
  peak: { label: 'Peak', color: '#dc2626', bg: 'rgba(220, 38, 38, 0.18)' },
  decay: { label: 'Decay', color: '#0284c7', bg: 'rgba(2, 132, 199, 0.14)' },
} as const;

export type NowcastStateKey = keyof typeof NOWCAST_STATES;

// Replay constants
export const REPLAY = {
  MIN_CURSOR: 0,
  MAX_CURSOR: 1439,
  DEFAULT_SPEED: 20,
  // Must stay within the API's accepted range (1..60, see api.py ReplayControl)
  // and match config.yaml `replay.speeds`.
  SPEEDS: [1, 5, 20, 60] as const,
  DEFAULT_EVENT_DATE: '2024-02-22',
  TICK_MS: 500,
} as const;

// API base. Same-origin by default: the Vite dev proxy handles it locally and
// the vercel.json /api rewrite handles it in production, so REST stays CORS-free.
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

// Vercel rewrites do NOT proxy WebSocket upgrades, so in production this must
// point straight at the API host. VITE_WS_URL is set in .env.production; the
// same-origin fallback is for local dev, where the Vite proxy forwards /ws.
export const WS_URL =
  import.meta.env.VITE_WS_URL ??
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/live`;
