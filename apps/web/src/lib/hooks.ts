import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useReplayStore } from '../store/replayStore';
import type {
  StreamsLatest,
  NowcastState,
  ForecastData,
  ImpactCurrent,
  ImpactScale,
  HealthStatus,
  CatalogueData,
  FlareDetail,
  ReplayDates,
  ReplayState,
  ReplayControlBody,
  ReplayStartResult,
  Alert,
  EvaluationRunDto,
} from '../types/api';

export function useStreams(windowSize: number) {
  return useQuery({
    queryKey: ['streams', windowSize],
    queryFn: () => api.get<StreamsLatest>(`/api/streams/latest?window=${windowSize}`),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });
}

export function useNowcast() {
  return useQuery({
    queryKey: ['nowcast'],
    queryFn: () => api.get<NowcastState>('/api/nowcast/state'),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });
}

export function useForecast() {
  return useQuery({
    queryKey: ['forecast'],
    queryFn: () => api.get<ForecastData>('/api/forecast/horizons'),
    staleTime: 30_000,
  });
}

export function useImpact() {
  return useQuery({
    queryKey: ['impact'],
    queryFn: () => api.get<ImpactCurrent>('/api/impact/current'),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });
}

export function useImpactScale() {
  return useQuery({
    queryKey: ['impactScale'],
    queryFn: () => api.get<ImpactScale>('/api/impact/scale'),
    staleTime: Infinity,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthStatus>('/api/health'),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

export function useCatalogue(minClass: string = 'A') {
  return useQuery({
    queryKey: ['catalogue', minClass],
    queryFn: () => api.get<CatalogueData>(`/api/flare/catalogue?min_class=${minClass}&page_size=50`),
    staleTime: 60_000,
  });
}

export function useFlareDetail(id: string | null) {
  return useQuery({
    queryKey: ['flare', id],
    queryFn: () => api.get<FlareDetail>(`/api/flare/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function useReplayDates() {
  return useQuery({
    queryKey: ['replayDates'],
    queryFn: () => api.get<ReplayDates>('/api/replay/dates'),
    staleTime: Infinity,
  });
}

export function useAlerts() {
  return useQuery({
    queryKey: ['alerts'],
    queryFn: () => api.get<Alert[]>('/api/alerts'),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });
}

export function useMetrics(runId?: string) {
  return useQuery({
    queryKey: ['metrics', runId],
    queryFn: () => api.get<EvaluationRunDto>(runId ? `/api/metrics/${runId}` : '/api/metrics'),
    staleTime: 60_000,
  });
}

/**
 * Server-state queries that depend on the replay cursor. Any replay mutation
 * invalidates these so the view reflects the new cursor without waiting for
 * the next WebSocket tick.
 */
const CURSOR_DEPENDENT_KEYS = ['streams', 'nowcast', 'forecast', 'impact', 'alerts', 'health'];

function useReplaySync() {
  const queryClient = useQueryClient();

  return (state: ReplayState) => {
    // Read actions imperatively: this helper only writes, so it must not
    // subscribe the calling component to store updates.
    const { setPlaying, setSpeed, setCursor, setEventDate, setMode } = useReplayStore.getState();
    // The API response is authoritative — adopt it rather than trusting the
    // optimistic local value.
    setPlaying(state.playing);
    setSpeed(state.speed);
    setCursor(state.cursor_idx);
    setEventDate(state.event_date);
    if (state.mode === 'live' || state.mode === 'replay') setMode(state.mode);
    for (const key of CURSOR_DEPENDENT_KEYS) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
}

/** Unified replay control: play, pause, toggle, stop, seek, speed, status. */
export function useReplayControl() {
  const sync = useReplaySync();
  return useMutation({
    mutationFn: (body: ReplayControlBody) => api.post<ReplayState>('/api/replay/control', body),
    onSuccess: sync,
  });
}

/** Switch the replayed event date. Restarts the session server-side. */
export function useStartReplay() {
  const sync = useReplaySync();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { event_date: string; speed: number }) =>
      api.post<ReplayStartResult>('/api/replay/start', params),
    onSuccess: async (result) => {
      // /start returns session info, not full replay state, so read back the
      // canonical state to stay in sync.
      const state = await api.post<ReplayState>('/api/replay/control', { action: 'status' });
      sync(state);
      queryClient.invalidateQueries({ queryKey: ['catalogue'] });
      return result;
    },
  });
}
