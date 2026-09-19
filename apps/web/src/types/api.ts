// API response envelope
export interface Envelope<T> {
  data: T;
  meta: {
    timestamp: string;
    mode: string;
    event_date: string;
    cursor: string;
    error?: string;
  };
}

export interface DataPoint {
  t: string;
  v: number | null;
}

export interface ChangePoint {
  t: string;
  p: number;
}

export interface FlareInterval {
  start: string;
  end: string;
  class: string;
}

export interface StreamGap {
  start: string;
  end: string;
}

export interface StreamsLatest {
  solexs: DataPoint[];
  hel1os: DataPoint[];
  quality: number[];
  flare_intervals: FlareInterval[];
  changepoints: ChangePoint[];
  gaps: StreamGap[];
}

export interface ActiveFlare {
  id: string;
  onset: string;
  peak: string;
  end: string | null;
  state: 'quiet' | 'onset' | 'rising' | 'peak' | 'decay';
  class: string;
  peak_flux_sxr: number;
  peak_flux_hxr: number;
  hardness: number;
  impulsivity: number;
  integrated_flux: number;
  index: number;
  severity_band: string;
  r_level: string;
  detection_method: string;
  posterior: number;
}

export interface NowcastState {
  state: 'quiet' | 'onset' | 'rising' | 'peak' | 'decay';
  active: ActiveFlare | null;
  threshold_baseline_active: boolean;
}

export interface ForecastHorizon {
  horizon_min: number;
  p_c1: number;
  p_m1: number;
  q50: number;
  q90: number;
  q99: number;
}

export interface ForecastData {
  horizons: ForecastHorizon[];
}

export interface ImpactSubscores {
  peak_sxr: number;
  hardness: number;
  impulsivity: number;
  duration: number;
}

export interface ImpactCurrent {
  index: number | null;
  band: string;
  r_level: string;
  g_level: string;
  s_level: string;
  subscores: Partial<ImpactSubscores>;
  weights_used: Partial<ImpactSubscores>;
  flare_id?: string;
  note: string;
}

export interface ImpactScaleBand {
  min: number;
  max: number;
  band: string;
  r_level: string;
  color: string;
}

export interface ImpactScale {
  version: string;
  bands: ImpactScaleBand[];
  weights: Partial<ImpactSubscores>;
  source_state: 'synthetic' | 'observed_uncalibrated' | 'observed_calibrated' | string;
  operational: boolean;
}

export interface CatalogueFlare {
  id: string;
  onset: string;
  peak: string;
  end: string | null;
  class: string;
  peak_flux_sxr: number;
  peak_flux_hxr: number;
  hardness: number;
  impulsivity: number;
  integrated_flux: number;
  impact_index: number;
  severity_band: string;
  r_level: string;
  detection_method: string;
  onset_idx: number;
  peak_idx: number;
  end_idx: number | null;
  posterior: number;
}

export interface CatalogueData {
  items: CatalogueFlare[];
  page: number;
  page_size: number;
  total: number;
}

export interface Alert {
  id: number;
  ts: string;
  type: string;
  severity: string;
  flare_id: string | null;
  message: string;
}

export interface Clock {
  utc: string;
  ist: string;
}

export interface HealthStatus {
  status: string;
  data_last_timestamp: string;
  engines: {
    nowcast: string;
    forecast: string;
    impact: string;
  };
  mode: string;
  playing: boolean;
  speed: number;
}

export interface ReplayDates {
  dates: string[];
}

/** Canonical replay state returned by every replay control mutation. */
export interface ReplayState {
  playing: boolean;
  speed: number;
  cursor_idx: number;
  cursor: string;
  event_date: string;
  mode: string;
}

/** Payload for POST /api/replay/control. */
export type ReplayAction = 'play' | 'pause' | 'toggle' | 'stop' | 'seek' | 'speed' | 'status';

export interface ReplayControlBody {
  action: ReplayAction;
  speed?: number;
  cursor?: number;
}

export interface ReplayStartResult {
  session_id: number | null;
  event_date: string;
  speed: number;
  cursor: string;
}

export interface FlareDetail extends CatalogueFlare {
  series?: {
    solexs: DataPoint[];
    hel1os: DataPoint[];
    posterior: DataPoint[];
  };
  subscores: ImpactSubscores;
  confidence?: string;
}

export interface DetectionMetricsDto {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  tss: number;
  hss: number;
  far: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface LeadTimeStatsDto {
  mean: number;
  median: number;
  std: number;
  p25: number;
  p75: number;
  min_val: number;
  max_val: number;
}

export interface CalibrationPointDto {
  bin_center: number;
  prob_pred: number;
  prob_true: number;
  count: number;
}

export interface CalibrationCurveDto {
  points: CalibrationPointDto[];
  brier_score: number;
  brier_skill_score: number;
}

export interface FailureSliceMetricsDto {
  slice_name: string;
  sample_count: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  tss: number;
  hss: number;
  far: number;
}

export interface ConfidenceIntervalDto {
  metric_name: string;
  point_estimate: number;
  ci_lower: number;
  ci_upper: number;
  confidence_level: number;
}

export interface EvaluationRunDto {
  id: string;
  created_at: string;
  source_cohort: 'synthetic' | 'observed_uncalibrated' | 'observed_calibrated' | string;
  split_id: string;
  config_hash: string;
  dataset_hash: string;
  code_revision: string;
  model_version: string;
  detection_metrics: DetectionMetricsDto;
  lead_time_stats: LeadTimeStatsDto;
  horizon_brier_scores: Record<string, number>;
  confidence_intervals: Record<string, ConfidenceIntervalDto>;
  calibration_curve: CalibrationCurveDto;
  failure_slices: Record<string, FailureSliceMetricsDto>;
  sample_count: number;
  age_seconds: number;
}
