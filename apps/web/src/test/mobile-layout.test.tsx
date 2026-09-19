import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NavBar from '../components/NavBar';
import ForecastCards from '../components/ForecastCards';
import ReplayBar from '../components/ReplayBar';
import FlareCatalogue from '../components/FlareCatalogue';
import { MOBILE_QUERY, DESKTOP_QUERY } from '../lib/responsive';
import { useRouter, parseLocation } from '../lib/router';
import { installMatchMedia } from './matchMedia';
import type { CatalogueFlare, FlareDetail, ForecastData } from '../types/api';

const REDUCED = '(prefers-reduced-motion: reduce)';

function setViewport(kind: 'mobile' | 'desktop') {
  installMatchMedia({
    [MOBILE_QUERY]: kind === 'mobile',
    [DESKTOP_QUERY]: kind === 'desktop',
    [REDUCED]: true, // keep framer-motion exits synchronous in assertions
  });
}

function wrap(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const mockFetch = vi.fn();
global.fetch = mockFetch;

const FLARE: CatalogueFlare = {
  id: 'FLR-001',
  onset: '2024-02-22T22:00:00Z',
  peak: '2024-02-22T22:12:00Z',
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

const DETAIL: FlareDetail = {
  ...FLARE,
  subscores: { peak_sxr: 0.9, hardness: 0.42, impulsivity: 0.8, duration: 0.5 },
  confidence: 'Changepoint posterior at onset 0.930. Neupert gate applied.',
};

const FORECAST: ForecastData = {
  horizons: [5, 10, 20, 40].map((h) => ({
    horizon_min: h,
    p_c1: 0.42,
    p_m1: 0.18,
    q50: 1.2e-6,
    q90: 3.4e-6,
    q99: 5.6e-6,
  })),
};

beforeEach(() => {
  vi.resetAllMocks();
  setViewport('mobile');
  window.history.pushState({}, '', '/catalogue');
  useRouter.setState({ route: parseLocation('/catalogue', '') });
  mockFetch.mockImplementation(async (url: string) => {
    const path = String(url);
    // /api/flare/catalogue is a list; /api/flare/<id> is one event.
    const payload = /\/api\/flare\/[^/?]+$/.test(path)
      ? { data: DETAIL, meta: { timestamp: '', mode: '', event_date: '', cursor: '' } }
      : { data: { items: [FLARE], page: 1, page_size: 50, total: 1 }, meta: { timestamp: '', mode: '', event_date: '', cursor: '' } };
    return { ok: true, status: 200, statusText: 'OK', json: async () => payload };
  });
});

afterEach(() => {
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe('NavBar mobile menu', () => {
  it('shows a hamburger instead of the inline nav below 768px', () => {
    wrap(<NavBar />);
    const trigger = screen.getByRole('button', { name: 'Open navigation menu' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-controls', 'sk-mobile-nav');
  });

  it('opens on tap and closes when a route is chosen', async () => {
    wrap(<NavBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const panel = document.getElementById('sk-mobile-nav');
    expect(panel).not.toBeNull();
    expect(within(panel as HTMLElement).getByRole('link', { name: 'Live' })).toBeInTheDocument();

    fireEvent.click(within(panel as HTMLElement).getByRole('link', { name: 'Live' }));
    expect(window.location.pathname).toBe('/live');
    // AnimatePresence unmounts on the frame after the exit completes.
    await waitFor(() => expect(document.getElementById('sk-mobile-nav')).toBeNull());
    expect(screen.getByRole('button', { name: 'Open navigation menu' })).toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    wrap(<NavBar />);
    const trigger = screen.getByRole('button', { name: 'Open navigation menu' });
    fireEvent.click(trigger);
    expect(document.getElementById('sk-mobile-nav')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.getElementById('sk-mobile-nav')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on an outside pointer-down', async () => {
    wrap(<NavBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(document.getElementById('sk-mobile-nav')).not.toBeNull();

    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(document.getElementById('sk-mobile-nav')).toBeNull());
  });

  it('gives every menu row a 44px touch target class', () => {
    wrap(<NavBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const panel = document.getElementById('sk-mobile-nav') as HTMLElement;
    for (const label of ['Home', 'Live', 'Forecast', 'Impact', 'Replay', 'About']) {
      const row = within(panel).getByRole('link', { name: label });
      expect(row.className).toContain('min-h-[48px]');
    }
    expect(within(panel).getByRole('link', { name: 'Live' })).toBeInTheDocument();
  });

  it('keeps the theme toggle reachable on a phone', () => {
    wrap(<NavBar />);
    const toggle = screen.getByRole('button', { name: 'Switch to light mode' });
    expect(toggle.className).toContain('sk-touch');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
  });
});

describe('ForecastCards on a phone', () => {
  it('renders one card per horizon with the probability that drives the decision', () => {
    setViewport('mobile');
    wrap(<ForecastCards forecast={FORECAST} />);
    /* jsdom applies no stylesheet, so the `hidden md:block` table is in the DOM
       too — scope to the phone list, which is the branch under test. */
    const list = screen.getByRole('list', { name: 'Forecast horizons' });
    for (const h of [5, 10, 20, 40]) {
      expect(within(list).getByText(`+${h} min`)).toBeInTheDocument();
    }
    expect(within(list).getAllByText('18%')).toHaveLength(4);
    expect(within(list).getAllByText('1.2e-6')).toHaveLength(4);
    expect(within(list).getAllByText('NOMINAL')).toHaveLength(4);
  });
});

describe('ReplayBar on a phone', () => {
  it('exposes play/pause and speed as 44px targets in a single row', () => {
    setViewport('mobile');
    wrap(<ReplayBar />);
    const play = screen.getByRole('button', { name: 'Play replay' });
    expect(play.className).toContain('sk-touch');
    expect(play.className).toContain('w-11');

    const speed = screen.getByRole('button', { name: /Replay speed \d+ times — tap to change/ });
    expect(speed.className).toContain('sk-touch');
    expect(speed.textContent).toBe('20×');
  });

  it('opens the settings panel with date, speed presets and the scrubber', () => {
    setViewport('mobile');
    wrap(<ReplayBar />);
    const expand = screen.getByRole('button', { name: 'Show replay settings' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(expand);

    expect(screen.getByRole('button', { name: 'Hide replay settings' })).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('replay-date-m')).not.toBeNull();
    const scrubber = document.getElementById('replay-scrubber-m') as HTMLInputElement;
    expect(scrubber).not.toBeNull();
    expect(scrubber.min).toBe('0');
    expect(scrubber.max).toBe('1439');
    expect(screen.getByRole('button', { name: 'Replay speed 60 times' })).toBeInTheDocument();
  });

  it('keeps the desktop transport, with its original ids, from 768px up', () => {
    setViewport('desktop');
    wrap(<ReplayBar />);
    expect(document.getElementById('replay-date')).not.toBeNull();
    expect(document.getElementById('replay-scrubber')).not.toBeNull();
    expect(document.getElementById('replay-date-m')).toBeNull();
  });
});

describe('FlareCatalogue on a phone', () => {
  it('renders compact cards, not the nine-column table', async () => {
    wrap(<FlareCatalogue />);
    const list = await screen.findByRole('list', { name: 'Flare catalogue' });
    // findBy: the list element exists while the query is still loading.
    expect(await within(list).findByRole('link', { name: /FLR-001/ })).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('still offers every class filter and the CSV export', async () => {
    wrap(<FlareCatalogue />);
    await screen.findByRole('list', { name: 'Flare catalogue' });
    for (const f of ['ALL', 'X-CLASS', 'M-CLASS', 'C-CLASS', 'B-CLASS']) {
      expect(screen.getByRole('link', { name: f })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Export catalogue as CSV' })).toBeInTheDocument();
  });

  it('opens the flare detail as a bottom sheet', async () => {
    useRouter.setState({ route: parseLocation('/catalogue/FLR-001', '') });
    window.history.pushState({}, '', '/catalogue/FLR-001');
    wrap(<FlareCatalogue />);

    const sheet = await screen.findByRole('dialog');
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(within(sheet).getByText('X6.3')).toBeInTheDocument();
    expect(within(sheet).getByText(/Changepoint posterior/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Close flare detail' })).toBeInTheDocument();
    expect(document.documentElement.classList.contains('sk-scroll-locked')).toBe(true);
  });

  it('closes the sheet back to the filtered list', async () => {
    useRouter.setState({ route: parseLocation('/catalogue/FLR-001', '?class=M') });
    window.history.pushState({}, '', '/catalogue/FLR-001?class=M');
    wrap(<FlareCatalogue />);

    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close flare detail' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/catalogue');
    expect(window.location.search).toBe('?class=M');
  });

  it('uses the in-flow pane, not a sheet, from 768px up', async () => {
    setViewport('desktop');
    useRouter.setState({ route: parseLocation('/catalogue/FLR-001', '') });
    window.history.pushState({}, '', '/catalogue/FLR-001');
    wrap(<FlareCatalogue />);

    expect(await screen.findByRole('link', { name: '← All flares' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('grid')).toBeInTheDocument();
  });
});
