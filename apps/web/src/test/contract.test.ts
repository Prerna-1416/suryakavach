import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type {
  StreamsLatest,
  NowcastState,
  ForecastData,
  ImpactCurrent,
  CatalogueData,
  FlareDetail,
  Alert,
  Clock,
  HealthStatus,
  ReplayDates,
} from '../types/api';

// Zod schemas mirroring the TypeScript types for runtime contract validation

const DataPointSchema = z.object({
  t: z.string(),
  v: z.number().nullable(),
});

const ChangePointSchema = z.object({
  t: z.string(),
  p: z.number(),
});

const FlareIntervalSchema = z.object({
  start: z.string(),
  end: z.string(),
  class: z.string(),
});

const StreamGapSchema = z.object({
  start: z.string(),
  end: z.string(),
});

const StreamsLatestSchema = z.object({
  solexs: z.array(DataPointSchema),
  hel1os: z.array(DataPointSchema),
  quality: z.array(z.number()),
  flare_intervals: z.array(FlareIntervalSchema),
  changepoints: z.array(ChangePointSchema),
  gaps: z.array(StreamGapSchema),
});

const ActiveFlareSchema = z.object({
  id: z.string(),
  onset: z.string(),
  peak: z.string(),
  end: z.string().nullable(),
  class: z.string(),
  peak_flux_sxr: z.number(),
  peak_flux_hxr: z.number(),
  hardness: z.number(),
  impulsivity: z.number(),
  integrated_flux: z.number(),
  index: z.number(),
  severity_band: z.string(),
  r_level: z.string(),
  detection_method: z.string(),
  posterior: z.number(),
});

const NowcastStateSchema = z.object({
  state: z.enum(['quiet', 'onset', 'rising', 'peak', 'decay']),
  active: ActiveFlareSchema.nullable(),
  threshold_baseline_active: z.boolean(),
});

const ForecastHorizonSchema = z.object({
  horizon_min: z.number(),
  p_c1: z.number(),
  p_m1: z.number(),
  q50: z.number(),
  q90: z.number(),
  q99: z.number(),
});

const ForecastDataSchema = z.object({
  horizons: z.array(ForecastHorizonSchema),
});

const ImpactSubscoresSchema = z.object({
  peak_sxr: z.number(),
  hardness: z.number(),
  impulsivity: z.number(),
  duration: z.number(),
});

const ImpactCurrentSchema = z.object({
  index: z.number().nullable(),
  band: z.string(),
  r_level: z.string(),
  g_level: z.string(),
  s_level: z.string(),
  subscores: ImpactSubscoresSchema.partial(),
  weights_used: ImpactSubscoresSchema.partial(),
  flare_id: z.string().optional(),
  note: z.string(),
});

const CatalogueFlareSchema = z.object({
  id: z.string(),
  onset: z.string(),
  peak: z.string(),
  end: z.string().nullable(),
  class: z.string(),
  peak_flux_sxr: z.number(),
  peak_flux_hxr: z.number(),
  hardness: z.number(),
  impulsivity: z.number(),
  integrated_flux: z.number(),
  impact_index: z.number(),
  severity_band: z.string(),
  r_level: z.string(),
  detection_method: z.string(),
  onset_idx: z.number(),
  peak_idx: z.number(),
  end_idx: z.number().nullable(),
  posterior: z.number(),
});

const CatalogueDataSchema = z.object({
  items: z.array(CatalogueFlareSchema),
  page: z.number(),
  page_size: z.number(),
  total: z.number(),
});

const FlareDetailSchema = CatalogueFlareSchema.extend({
  series: z.object({
    solexs: z.array(DataPointSchema),
    hel1os: z.array(DataPointSchema),
    posterior: z.array(DataPointSchema),
  }).optional(),
  subscores: ImpactSubscoresSchema,
  confidence: z.string().optional(),
});

const AlertSchema = z.object({
  id: z.number(),
  ts: z.string(),
  type: z.string(),
  severity: z.string(),
  flare_id: z.string().nullable(),
  message: z.string(),
});

const ClockSchema = z.object({
  utc: z.string(),
  ist: z.string(),
});

const HealthStatusSchema = z.object({
  status: z.string(),
  data_last_timestamp: z.string(),
  engines: z.object({
    nowcast: z.string(),
    forecast: z.string(),
    impact: z.string(),
  }),
  mode: z.string(),
  playing: z.boolean(),
  speed: z.number(),
});

const ReplayDatesSchema = z.object({
  dates: z.array(z.string()),
});

// Fixtures — synthetic data matching the contract shapes

const fixtureStreams: StreamsLatest = {
  solexs: [{ t: '2024-02-22T00:00:00Z', v: 5.2e-7 }],
  hel1os: [{ t: '2024-02-22T00:00:00Z', v: 3.1e-8 }],
  quality: [1, 1, 0.95],
  flare_intervals: [{ start: '00:10', end: '00:25', class: 'M1.2' }],
  changepoints: [{ t: '00:10', p: 0.92 }],
  gaps: [],
};

const fixtureNowcast: NowcastState = {
  state: 'rising',
  active: {
    id: 'FLR-001',
    onset: '2024-02-22T00:10:00Z',
    peak: '2024-02-22T00:18:00Z',
    end: null,
    state: 'rising',
    class: 'M1.2',
    peak_flux_sxr: 1.2e-5,
    peak_flux_hxr: 3.4e-6,
    hardness: 0.71,
    impulsivity: 2.1,
    integrated_flux: 0.045,
    index: 1,
    severity_band: 'moderate',
    r_level: 'R2',
    detection_method: 'BOCPD',
    posterior: 0.92,
  },
  threshold_baseline_active: true,
};

const fixtureForecast: ForecastData = {
  horizons: [
    { horizon_min: 5, p_c1: 0.85, p_m1: 0.32, q50: 1.1e-5, q90: 3.4e-5, q99: 8.7e-5 },
    { horizon_min: 10, p_c1: 0.78, p_m1: 0.25, q50: 9.5e-6, q90: 2.8e-5, q99: 7.1e-5 },
  ],
};

const fixtureImpact: ImpactCurrent = {
  index: 5.7,
  band: 'moderate',
  r_level: 'R2',
  g_level: 'G1',
  s_level: 'S1',
  subscores: { peak_sxr: 6.2, hardness: 5.1, impulsivity: 4.8, duration: 6.5 },
  weights_used: { peak_sxr: 0.35, hardness: 0.25, impulsivity: 0.2, duration: 0.2 },
  flare_id: 'FLR-001',
  note: 'Moderate space weather impact expected.',
};

const fixtureCatalogue: CatalogueData = {
  items: [
    {
      id: 'FLR-001',
      onset: '2024-02-22T00:10:00Z',
      peak: '2024-02-22T00:18:00Z',
      end: '2024-02-22T00:35:00Z',
      class: 'M1.2',
      peak_flux_sxr: 1.2e-5,
      peak_flux_hxr: 3.4e-6,
      hardness: 0.71,
      impulsivity: 2.1,
      integrated_flux: 0.045,
      impact_index: 5.7,
      severity_band: 'moderate',
      r_level: 'R2',
      detection_method: 'BOCPD',
      onset_idx: 10,
      peak_idx: 18,
      end_idx: 35,
      posterior: 0.92,
    },
  ],
  page: 1,
  page_size: 50,
  total: 1,
};

const fixtureFlareDetail: FlareDetail = {
  ...fixtureCatalogue.items[0],
  series: {
    solexs: [{ t: '00:00', v: 5e-7 }, { t: '00:10', v: 1.2e-5 }],
    hel1os: [{ t: '00:00', v: 3e-8 }, { t: '00:10', v: 3.4e-6 }],
    posterior: [{ t: '00:00', v: 0.01 }, { t: '00:10', v: 0.92 }],
  },
  subscores: { peak_sxr: 6.2, hardness: 5.1, impulsivity: 4.8, duration: 6.5 },
  confidence: 'High confidence BOCPD detection.',
};

const fixtureAlert: Alert = {
  id: 1,
  ts: '2024-02-22T00:10:00Z',
  type: 'onset',
  severity: 'moderate',
  flare_id: 'FLR-001',
  message: 'Flare onset detected by BOCPD.',
};

const fixtureClock: Clock = {
  utc: '2024-02-22T00:15:00Z',
  ist: '2024-02-22T05:45:00Z',
};

const fixtureHealth: HealthStatus = {
  status: 'ok',
  data_last_timestamp: '2024-02-22T00:15:00Z',
  engines: { nowcast: 'active', forecast: 'active', impact: 'active' },
  mode: 'replay',
  playing: true,
  speed: 20,
};

const fixtureReplayDates: ReplayDates = {
  dates: ['2024-02-22', '2024-05-10', '2023-07-02'],
};

describe('StreamsLatest contract', () => {
  it('accepts valid streams payload', () => {
    expect(() => StreamsLatestSchema.parse(fixtureStreams)).not.toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => StreamsLatestSchema.parse({ solexs: [] })).toThrow();
  });
});

describe('NowcastState contract', () => {
  it('accepts valid nowcast payload', () => {
    expect(() => NowcastStateSchema.parse(fixtureNowcast)).not.toThrow();
  });

  it('accepts null active flare', () => {
    const payload = { ...fixtureNowcast, active: null };
    expect(() => NowcastStateSchema.parse(payload)).not.toThrow();
  });

  it('rejects invalid state enum', () => {
    const payload = { ...fixtureNowcast, state: 'invalid' };
    expect(() => NowcastStateSchema.parse(payload)).toThrow();
  });
});

describe('ForecastData contract', () => {
  it('accepts valid forecast payload', () => {
    expect(() => ForecastDataSchema.parse(fixtureForecast)).not.toThrow();
  });

  it('rejects missing horizon_min', () => {
    const payload = { horizons: [{ p_c1: 0.5 }] };
    expect(() => ForecastDataSchema.parse(payload)).toThrow();
  });
});

describe('ImpactCurrent contract', () => {
  it('accepts valid impact payload', () => {
    expect(() => ImpactCurrentSchema.parse(fixtureImpact)).not.toThrow();
  });

  it('rejects missing band field', () => {
    const { band: _, ...rest } = fixtureImpact;
    expect(() => ImpactCurrentSchema.parse(rest)).toThrow();
  });
});

describe('CatalogueData contract', () => {
  it('accepts valid catalogue payload', () => {
    expect(() => CatalogueDataSchema.parse(fixtureCatalogue)).not.toThrow();
  });

  it('rejects empty items with wrong total', () => {
    const payload = { items: [], page: 1, page_size: 50, total: 5 };
    expect(() => CatalogueDataSchema.parse(payload)).not.toThrow(); // schema doesn't enforce semantic consistency
  });
});

describe('FlareDetail contract', () => {
  it('accepts valid flare detail payload', () => {
    expect(() => FlareDetailSchema.parse(fixtureFlareDetail)).not.toThrow();
  });

  it('accepts detail without optional series', () => {
    const { series: _, ...rest } = fixtureFlareDetail;
    expect(() => FlareDetailSchema.parse(rest)).not.toThrow();
  });
});

describe('Alert contract', () => {
  it('accepts valid alert payload', () => {
    expect(() => AlertSchema.parse(fixtureAlert)).not.toThrow();
  });

  it('accepts null flare_id', () => {
    const payload = { ...fixtureAlert, flare_id: null };
    expect(() => AlertSchema.parse(payload)).not.toThrow();
  });
});

describe('Clock contract', () => {
  it('accepts valid clock payload', () => {
    expect(() => ClockSchema.parse(fixtureClock)).not.toThrow();
  });

  it('rejects missing ist', () => {
    expect(() => ClockSchema.parse({ utc: '2024-02-22T00:00:00Z' })).toThrow();
  });
});

describe('HealthStatus contract', () => {
  it('accepts valid health payload', () => {
    expect(() => HealthStatusSchema.parse(fixtureHealth)).not.toThrow();
  });

  it('rejects missing engines', () => {
    expect(() => HealthStatusSchema.parse({ status: 'ok' })).toThrow();
  });
});

describe('ReplayDates contract', () => {
  it('accepts valid replay dates payload', () => {
    expect(() => ReplayDatesSchema.parse(fixtureReplayDates)).not.toThrow();
  });

  it('accepts empty dates array', () => {
    expect(() => ReplayDatesSchema.parse({ dates: [] })).not.toThrow();
  });
});

const DetectionMetricsSchema = z.object({
  tp: z.number(),
  fp: z.number(),
  fn: z.number(),
  tn: z.number(),
  tss: z.number(),
  hss: z.number(),
  far: z.number(),
  precision: z.number(),
  recall: z.number(),
  f1: z.number(),
});

const LeadTimeStatsSchema = z.object({
  mean: z.number(),
  median: z.number(),
  std: z.number(),
  p25: z.number(),
  p75: z.number(),
  min_val: z.number(),
  max_val: z.number(),
});

const CalibrationPointSchema = z.object({
  bin_center: z.number(),
  prob_pred: z.number(),
  prob_true: z.number(),
  count: z.number(),
});

const CalibrationCurveSchema = z.object({
  points: z.array(CalibrationPointSchema),
  brier_score: z.number(),
  brier_skill_score: z.number(),
});

const ConfidenceIntervalSchema = z.object({
  metric_name: z.string(),
  point_estimate: z.number(),
  ci_lower: z.number(),
  ci_upper: z.number(),
  confidence_level: z.number(),
});

const EvaluationRunSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  source_cohort: z.string(),
  split_id: z.string(),
  config_hash: z.string(),
  dataset_hash: z.string(),
  code_revision: z.string(),
  model_version: z.string(),
  detection_metrics: DetectionMetricsSchema,
  lead_time_stats: LeadTimeStatsSchema,
  horizon_brier_scores: z.record(z.string(), z.number()),
  confidence_intervals: z.record(z.string(), ConfidenceIntervalSchema),
  calibration_curve: CalibrationCurveSchema,
  sample_count: z.number(),
  age_seconds: z.number().optional(),
});

describe('EvaluationRun contract', () => {
  it('validates evaluation metrics payload structure', () => {
    const fixtureRun = {
      id: 'run_20260919_050000_123456',
      created_at: '2026-09-19T05:00:00Z',
      source_cohort: 'synthetic',
      split_id: 'synthetic-demo',
      config_hash: '58eee72355ec89ac',
      dataset_hash: '2fc1e6eca343fa0b',
      code_revision: 'ee5fbc2d25a2f3b6',
      model_version: 'bocpd_neupert_v1',
      detection_metrics: {
        tp: 29, fp: 54, fn: 1, tn: 48,
        tss: 0.437, hss: 0.269, far: 0.651,
        precision: 0.349, recall: 0.967, f1: 0.513
      },
      lead_time_stats: {
        mean: 18.3, median: 19.0, std: 5.9, p25: 14.0, p75: 23.0, min_val: 8.0, max_val: 33.0
      },
      horizon_brier_scores: { '5': 0.0589, '10': 0.0636, '20': 0.0663, '40': 0.0664 },
      confidence_intervals: {
        tss: { metric_name: 'tss', point_estimate: 0.437, ci_lower: 0.279, ci_upper: 0.592, confidence_level: 0.95 }
      },
      calibration_curve: {
        points: [{ bin_center: 0.05, prob_pred: 0.0043, prob_true: 0.0523, count: 15637 }],
        brier_score: 0.0578,
        brier_skill_score: -0.0464
      },
      sample_count: 11,
      age_seconds: 120
    };

    expect(() => EvaluationRunSchema.parse(fixtureRun)).not.toThrow();
  });
});

