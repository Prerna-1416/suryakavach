import type { Page } from '@playwright/test';

/**
 * Deterministic API stub for the responsive specs.
 *
 * The console reads eight endpoints on every screen; without a stub these
 * specs would be asserting against whatever state the local backend happened
 * to be in (or against empty panels while it is down). Interception happens in
 * the browser, before Vite's /api proxy, so the specs are self-contained and
 * can run without the Python service.
 *
 * The replay endpoints are modelled with a tiny state machine so a tapped
 * control produces the same round-trip the real console gets: POST /control,
 * an authoritative state object back, and the store adopting it.
 */

const T = (min: number) => `2024-02-22T22:${String(min).padStart(2, '0')}:00Z`;

const SERIES = Array.from({ length: 40 }, (_, i) => ({ t: T(i % 60), v: 1e-7 * (1 + i) }));

const FLARE = {
  id: 'FLR-001',
  onset: T(0),
  peak: T(12),
  end: null,
  class: 'X6.3',
  peak_flux_sxr: 6.3e-4,
  peak_flux_hxr: 1.2e-6,
  hardness: 0.421,
  impulsivity: 0.8,
  integrated_flux: 1e-3,
  impact_index: 6.42,
  severity_band: 'R3-R4',
  r_level: 'R4',
  detection_method: 'bocpd+neupert',
  onset_idx: 10,
  peak_idx: 20,
  end_idx: null,
  posterior: 0.93,
};

/** Replay state, mutated by the POST handler below. */
function initialReplay() {
  return { playing: false, speed: 20, cursor_idx: 0, event_date: '2024-02-22', mode: 'live' };
}

/** Fresh per test so a speed tapped in one spec cannot leak into the next. */
let replay = initialReplay();

interface ReplayBody {
  action?: 'play' | 'pause' | 'toggle' | 'stop' | 'seek' | 'speed' | 'status';
  cursor?: number;
  speed?: number;
}

function applyReplay(body: ReplayBody) {
  if (body.action === 'toggle') replay.playing = !replay.playing;
  if (body.action === 'play') replay.playing = true;
  if (body.action === 'pause' || body.action === 'stop') replay.playing = false;
  if (body.action === 'speed' && typeof body.speed === 'number') replay.speed = body.speed;
  if (body.action === 'seek' && typeof body.cursor === 'number') replay.cursor_idx = body.cursor;
  return { ...replay };
}

const ROUTES: Record<string, unknown> = {
  '/api/health': {
    status: 'ok',
    data_last_timestamp: T(39),
    engines: { nowcast: 'ok', forecast: 'ok', impact: 'ok' },
    mode: 'live',
  },
  '/api/nowcast/state': {
    state: 'rising',
    active: FLARE,
    threshold_baseline_active: false,
  },
  '/api/streams/latest': {
    solexs: SERIES,
    hel1os: SERIES,
    quality: SERIES.map(() => 1),
    flare_intervals: [{ start: T(0), end: T(20), class: 'X' }],
    changepoints: [{ t: T(3), p: 0.81 }],
    gaps: [],
  },
  '/api/forecast/horizons': {
    horizons: [5, 10, 20, 40].map((h) => ({
      horizon_min: h,
      p_c1: 0.42,
      p_m1: 0.18 + h / 1000,
      q50: 1.2e-6,
      q90: 3.4e-6,
      q99: 5.6e-6,
    })),
  },
  '/api/impact/current': {
    index: 6.42,
    band: 'R3-R4',
    r_level: 'R4',
    g_level: 'G0',
    s_level: 'S1',
    subscores: { peak_sxr: 0.9, hardness: 0.42, impulsivity: 0.8, duration: 0.5 },
    flare_id: 'FLR-001',
    note: 'Index uses hand-tuned weights (SUIT term dropped).',
  },
  '/api/alerts': [
    {
      id: 2,
      ts: T(12),
      type: 'flare_peak',
      severity: 'R4',
      flare_id: 'FLR-001',
      message: 'X6.3 peak flux recorded; HF blackout expected on the sunlit side.',
    },
    {
      id: 1,
      ts: T(2),
      type: 'flare_onset',
      severity: 'R1',
      flare_id: 'FLR-001',
      message: 'Flux breaking baseline; change-point detected.',
    },
  ],
  '/api/replay/dates': { dates: ['2024-02-22', '2024-05-14', '2024-10-03'] },
  '/api/replay/start': { session_id: 'sess-1', event_date: '2024-02-22', speed: 20, started: true },
  '/api/flare/catalogue': { items: [FLARE], page: 1, page_size: 50, total: 1 },
  '/api/flare/FLR-001': {
    ...FLARE,
    // A short trace so the detail chart exercises the real mobile Plotly path
    // (240px box, no legend, fixed axes) inside the bottom sheet.
    series: { solexs: SERIES, hel1os: SERIES, posterior: SERIES.map((d, i) => ({ t: d.t, v: i / 40 })) },
    subscores: { peak_sxr: 0.9, hardness: 0.42, impulsivity: 0.8, duration: 0.5 },
    confidence: 'Changepoint posterior at onset 0.930. Neupert gate applied.',
  },
};

const envelope = (data: unknown) => ({
  data,
  meta: { timestamp: T(39), mode: 'live', event_date: '2024-02-22', cursor: '00:39' },
});

/**
 * Silence the live feed. The console opens /ws/live and adopts whatever it
 * pushes (cursor, playing, speed, event_date) into the replay store, so a
 * locally running backend would otherwise make these specs environment
 * dependent. The socket is left open — wsConnected stays true, the pip stays
 * green — but no message can arrive to move the transport under an assertion.
 */
export async function stubSocket(page: Page): Promise<void> {
  await page.routeWebSocket(/\/ws\//, () => {
    /* Deliberately not calling connectToServer(). */
  });
}

export async function stubBackend(page: Page): Promise<void> {
  await stubSocket(page);
  replay = initialReplay();
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname === '/api/replay/control') {
      const body = (request.postDataJSON() ?? {}) as ReplayBody;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(envelope(applyReplay(body))),
      });
      return;
    }

    // Longest-prefix match so /api/flare/FLR-001 wins over /api/flare/catalogue.
    const key = Object.keys(ROUTES)
      .filter((k) => url.pathname.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (!key || (method !== 'GET' && !key.startsWith('/api/replay'))) {
      await route.fulfill({ status: 404, body: JSON.stringify({ detail: 'not stubbed' }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(envelope(ROUTES[key])),
    });
  });
}

/**
 * Every element that extends past the viewport without being clipped by an
 * ancestor, i.e. content that would actually let the page scroll sideways.
 *
 * Elements inside an ancestor with overflow hidden/clip/auto/scroll are
 * skipped: those are intentional (the hero's off-canvas Sun, a table that
 * scrolls inside its own box). The walk deliberately stops at #root, so the
 * document-level guards the app already applies cannot mask a real overflow.
 */
export async function overflowReport(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad: string[] = [];

    const isClipped = (el: Element) => {
      let p = el.parentElement;
      while (p && p !== document.body && p.id !== 'root') {
        if (getComputedStyle(p).overflowX !== 'visible') return true;
        p = p.parentElement;
      }
      return false;
    };

    document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (getComputedStyle(el).position === 'fixed') return;
      /* Only the right edge counts. Overflow past the left edge is unreachable
         in an LTR page — the browser does not scroll to it, and scrollWidth
         ignores it — so off-canvas decoration parked at left:-10000px (plotly's
         text-measurement svg, the hero's orbit rings) is not a defect. */
      if (r.right <= vw + 1) return;
      if (isClipped(el)) return;
      const tag = el.tagName.toLowerCase();
      const cls = typeof el.className === 'string' ? el.className.split(' ').slice(0, 3).join('.') : '';
      bad.push(`${tag}${cls ? `.${cls}` : ''} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    });

    return {
      viewportWidth: vw,
      documentScrollWidth: document.documentElement.scrollWidth,
      offenders: bad.slice(0, 6),
    };
  });
}
