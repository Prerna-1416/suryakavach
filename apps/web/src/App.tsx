import { useEffect, useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import NavBar from './components/NavBar';
import Header from './components/Header';
import LandingHero from './components/LandingHero';
import NowcastBanner from './components/NowcastBanner';
import TelemetryChart from './components/TelemetryChart';
import ForecastCards from './components/ForecastCards';
import ImpactGauge from './components/ImpactGauge';
import FlareCatalogue from './components/FlareCatalogue';
import ReplayBar from './components/ReplayBar';
import MetricsPanel from './components/MetricsPanel';
import AlertCentre from './components/AlertCentre';
import About from './components/About';
import SeverityStrip from './components/SeverityStrip';
import { useReplayStore } from './store/replayStore';
import { useStreams, useNowcast, useForecast, useImpact, useHealth, useReplayDates } from './lib/hooks';
import { WS_URL } from './lib/constants';
import { useRouter, isModifiedClick } from './lib/router';
import type { Clock } from './types/api';
import { screenFade, usePrefersReducedMotion } from './lib/motion';
import { useIsMobile } from './lib/responsive';

function PageHeading({
  eyebrow,
  title,
  trail,
}: {
  eyebrow: string;
  title: string;
  trail?: { label: string; href: string }[];
}) {
  const { go } = useRouter();
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-1">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="w-5 h-px bg-accent/60" aria-hidden="true" />
          <span className="text-[10px] uppercase tracking-[0.3em] text-ink-faint font-mono-val">
            {eyebrow}
          </span>
        </div>
        <h1 className="mt-2 font-display leading-none text-screen-title text-[clamp(1.625rem,6.2vw,2.25rem)]">
          {title}
        </h1>
      </div>
      {trail && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] uppercase tracking-[0.2em]">
          {trail.map((t) => (
            <a
              key={t.href}
              href={t.href}
              onClick={(e) => {
                if (isModifiedClick(e)) return;
                e.preventDefault();
                go(t.href);
              }}
              className="sk-touch inline-flex items-center text-ink-faint hover:text-accent-soft transition-colors"
            >
              {t.label} →
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { route } = useRouter();
  const reduced = usePrefersReducedMotion();
  const isMobile = useIsMobile();
  const { setPlaying, setSpeed, setCursor, setEventDate, setDates, setMode } = useReplayStore();

  const [windowSize, setWindowSize] = useState(120);
  const [wsConnected, setWsConnected] = useState(false);
  const [clock, setClock] = useState<Clock | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number>(1000);

  // TanStack Query hooks for server state
  const { data: streams } = useStreams(windowSize);
  const { data: nowcastState } = useNowcast();
  const { data: forecast } = useForecast();
  const { data: impact } = useImpact();
  const { data: health } = useHealth();
  const { data: replayDates } = useReplayDates();

  // Wire replay dates into the store
  useEffect(() => {
    if (replayDates?.dates) setDates(replayDates.dates);
  }, [replayDates, setDates]);

  // WebSocket connection with exponential backoff
  const connectWS = useCallback(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      reconnectRef.current = 1000;
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.heartbeat) return;
        if (payload.clock) setClock(payload.clock);
        if (payload.cursor_idx !== undefined) setCursor(payload.cursor_idx);
        if (payload.playing !== undefined) setPlaying(payload.playing);
        if (payload.speed !== undefined) setSpeed(payload.speed);
        if (payload.event_date) setEventDate(payload.event_date);
        if (payload.dates) setDates(payload.dates);
        if (payload.mode) setMode(payload.mode);
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
      setTimeout(connectWS, reconnectRef.current);
      reconnectRef.current = Math.min(reconnectRef.current * 2, 30000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [setPlaying, setSpeed, setCursor, setEventDate, setDates, setMode]);

  useEffect(() => {
    connectWS();
    return () => wsRef.current?.close();
  }, [connectWS]);

  const handleWindowChange = (w: number) => setWindowSize(w);

  const renderScreen = () => {
    switch (route.screen) {
      case 'live': {
        const heading = (
          <PageHeading
            eyebrow="Live Console"
            title="Solar flare nowcast"
            trail={[
              { label: 'Flare Catalogue', href: '/catalogue' },
              { label: 'Alert Centre', href: '/alerts' },
            ]}
          />
        );
        const banner = <NowcastBanner nowcastState={nowcastState ?? null} />;
        const chart = (
          <TelemetryChart
            streams={streams ?? null}
            windowSize={windowSize}
            onWindowChange={handleWindowChange}
          />
        );

        /* Phone: a straight priority stack — current state, how bad it is,
           the newest warning, the live trace. Everything else (forecast
           detail, full impact breakdown) follows below the fold. */
        if (isMobile) {
          return (
            <div className="space-y-4">
              {heading}
              {banner}
              <SeverityStrip impact={impact ?? null} />
              <AlertCentre limit={1} compact />
              {chart}
              <ForecastCards forecast={forecast ?? null} />
              <ImpactGauge impact={impact ?? null} />
            </div>
          );
        }

        /* Desktop and tablet: the existing console order is unchanged. */
        return (
          <motion.div
            className="space-y-5"
            variants={reduced ? undefined : { hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
            initial={reduced ? undefined : 'hidden'}
            animate={reduced ? undefined : 'show'}
          >
            <motion.div variants={reduced ? undefined : { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}>
              {heading}
            </motion.div>
            {banner}
            {chart}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <ForecastCards forecast={forecast ?? null} />
              <ImpactGauge impact={impact ?? null} />
            </div>
          </motion.div>
        );
      }
      case 'forecast':
        return (
          <motion.div className="space-y-5" {...screenFade}>
            <PageHeading
              eyebrow="Forecast"
              title="5 · 10 · 20 · 40 minute outlook"
              trail={[
                { label: 'Live Console', href: '/live' },
                { label: 'Impact', href: '/impact' },
              ]}
            />
            <ForecastCards forecast={forecast ?? null} />
            <TelemetryChart streams={streams ?? null} windowSize={windowSize} onWindowChange={handleWindowChange} />
            <MetricsPanel />
          </motion.div>
        );
      case 'impact':
        return (
          <motion.div className="space-y-5" {...screenFade}>
            <PageHeading
              eyebrow="Impact"
              title="Radiation impact index"
              trail={[
                { label: 'Alert Centre', href: '/alerts' },
                { label: 'Live Console', href: '/live' },
              ]}
            />
            <ImpactGauge impact={impact ?? null} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <NowcastBanner nowcastState={nowcastState ?? null} />
              <AlertCentre />
            </div>
          </motion.div>
        );
      case 'replay':
        return (
          <motion.div className="space-y-5" {...screenFade}>
            <PageHeading
              eyebrow="Historical Replay"
              title="Replay recorded flare days"
              trail={[
                { label: 'Flare Catalogue', href: '/catalogue' },
                { label: 'About', href: '/about' },
              ]}
            />
            <NowcastBanner nowcastState={nowcastState ?? null} />
            <TelemetryChart streams={streams ?? null} windowSize={windowSize} onWindowChange={handleWindowChange} />
          </motion.div>
        );
      case 'catalogue':
        return (
          <motion.div className="space-y-5" {...screenFade}>
            <PageHeading
              eyebrow="Flare Catalogue"
              title="Event classification"
              trail={[
                { label: 'Alert Centre', href: '/alerts' },
                { label: 'Live Console', href: '/live' },
              ]}
            />
            <FlareCatalogue />
          </motion.div>
        );
      case 'alerts':
        return (
          <motion.div className="space-y-5" {...screenFade}>
            <PageHeading
              eyebrow="Warning System"
              title="Alert centre"
              trail={[
                { label: 'Impact', href: '/impact' },
                { label: 'Live Console', href: '/live' },
              ]}
            />
            <AlertCentre />
            <MetricsPanel />
          </motion.div>
        );
      case 'about':
        return (
          <motion.div className="space-y-5" {...screenFade}>
            <PageHeading
              eyebrow="Mission"
              title="About SURYAKAVACH"
              trail={[
                { label: 'Live Console', href: '/live' },
                { label: 'Forecast', href: '/forecast' },
              ]}
            />
            <About />
          </motion.div>
        );
      default:
        return null;
    }
  };

  const isHome = route.screen === 'home';

  return (
    <div className="min-h-screen bg-space text-ink">
      <NavBar wsConnected={wsConnected} mode={health?.mode ?? 'live'} theme={isHome ? 'overlay' : 'solid'} />

      {isHome ? (
        <main id="main-content" className="min-h-screen">
          <LandingHero />
        </main>
      ) : (
        <div className="min-h-[100svh] flex flex-col">
          <Header health={health ?? null} clock={clock} wsConnected={wsConnected} />
          <main id="main-content" className="flex-1 w-full max-w-[1200px] mx-auto px-3 md:px-4 py-5 md:py-8 space-y-4 md:space-y-5">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={route.screen}
                initial={reduced ? false : screenFade.initial}
                animate={reduced ? undefined : screenFade.animate}
                exit={reduced ? undefined : screenFade.exit}
                transition={reduced ? { duration: 0 } : screenFade.transition}
              >
                {renderScreen()}
              </motion.div>
            </AnimatePresence>
          </main>
          <ReplayBar />
        </div>
      )}
    </div>
  );
}