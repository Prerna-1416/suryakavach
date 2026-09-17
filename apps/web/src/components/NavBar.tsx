import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import OrbitMark from './ui/OrbitMark';
import { useRouter, isModifiedClick } from '../lib/router';
import { usePrefersReducedMotion } from '../lib/motion';

interface NavBarProps {
  /** Live-data link state. When false the indicator shows an offline tone. */
  wsConnected?: boolean;
  /** Stream mode emitted by the API: 'live' or 'replay'. */
  mode?: string | null;
  theme?: 'overlay' | 'solid';
}

const NAV = [
  { screen: 'home', label: 'Home', href: '/' },
  { screen: 'live', label: 'Live', href: '/live' },
  { screen: 'forecast', label: 'Forecast', href: '/forecast' },
  { screen: 'impact', label: 'Impact', href: '/impact' },
  { screen: 'replay', label: 'Replay', href: '/replay' },
  { screen: 'about', label: 'About', href: '/about' },
] as const;

function useUtcClock(): { utc: string; date: string } {
  const fmt = (d: Date) => ({
    utc: d.toISOString().split('T')[1].replace('Z', ''),
    date: d.toISOString().split('T')[0],
  });
  const [now, setNow] = useState(() => fmt(new Date()));
  useEffect(() => {
    const id = setInterval(() => setNow(fmt(new Date())), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Cinematic top navigation for the deep-space interface. Transparent glass
 * bar with a thin hairline rule, brand left, minimal nav centre, and a
 * glowing "LIVE DATA" indicator + UTC clock on the right.
 */
export default function NavBar({ wsConnected = true, mode = 'live', theme = 'overlay' }: NavBarProps) {
  const { route, go } = useRouter();
  const reduced = usePrefersReducedMotion();
  const { utc, date } = useUtcClock();

  /* Theme toggle — flips a .sk-theme-light class on <html> and persists
     the choice so it survives reloads. */
  const [light, setLight] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem('suryakavach-theme') === 'light';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('sk-theme-light', light);
    try {
      localStorage.setItem('suryakavach-theme', light ? 'light' : 'dark');
    } catch {
      /* private mode — ignore */
    }
  }, [light]);

  const solid = theme === 'solid';

  return (
    <header
      className={`sticky top-0 z-50 ${solid ? 'bg-panel/90' : 'sk-glass'} border-b border-rule/70`}
    >
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <nav
        aria-label="Main navigation"
        className="max-w-[1440px] mx-auto flex items-center gap-4 px-5 h-16"
      >
        {/* Brand */}
        <a
          href="/"
          onClick={(e) => {
            if (isModifiedClick(e)) return;
            e.preventDefault();
            go('/');
          }}
          className="flex items-center gap-2.5 shrink-0 group"
        >
          <OrbitMark size={20} dark />
          <span className="flex flex-col leading-none">
            <span className="text-[13px] font-semibold tracking-[0.28em] text-screen-title group-hover:text-accent-soft transition-colors">
              SURYAKAVACH
            </span>
            <span className="mt-1 text-[9px] font-mono-val tracking-[0.22em] text-ink-faint">
              ADITYA-L1 · SIH 2026
            </span>
          </span>
        </a>

        {/* Center navigation */}
        <div className="hidden lg:flex items-center gap-1 mx-auto">
          {NAV.map(({ screen, label, href }) => {
            const active = screen === 'home' ? route.screen === 'home' : route.screen === screen;
            return (
              <motion.a
                key={screen}
                href={href}
                aria-current={active ? 'page' : undefined}
                {...(reduced ? {} : { whileTap: { scale: 0.96 } })}
                onClick={(e) => {
                  if (isModifiedClick(e)) return;
                  e.preventDefault();
                  go(href);
                }}
                className={`relative px-3.5 py-1.5 text-[11px] tracking-[0.18em] uppercase transition-colors ${
                  active ? 'text-accent-soft' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {label}
                {active && (
                  <motion.span
                    layoutId="nav-underline"
                    className="absolute left-2.5 right-2.5 -bottom-0.5 h-px bg-gradient-to-r from-transparent via-accent to-transparent"
                    transition={reduced ? { duration: 0 } : { type: 'tween', ease: [0.22, 1, 0.36, 1], duration: 0.28 }}
                  />
                )}
              </motion.a>
            );
          })}
        </div>

        {/* Right cluster */}
        <div className="flex items-center gap-4 ml-auto lg:ml-0 shrink-0">
          <span className="hidden md:flex items-center gap-1.5" title="Live telemetry feed">
            <span
              className="relative inline-block w-1.5 h-1.5 rounded-full"
              aria-hidden="true"
              style={{
                backgroundColor: wsConnected ? 'var(--color-ok)' : 'var(--color-alarm)',
                boxShadow: `0 0 6px 1px ${wsConnected ? 'rgba(52,211,153,0.8)' : 'rgba(239,122,90,0.8)'}`,
              }}
            >
              {wsConnected && (
                <span
                  className="absolute -inset-1 rounded-full border"
                  style={{
                    borderColor: 'var(--color-ok)',
                    animation: 'sk-pulse 2.4s ease-out infinite',
                  }}
                  aria-hidden="true"
                />
              )}
            </span>
            <span className={`text-[11px] tracking-[0.18em] uppercase ${wsConnected ? 'text-ok' : 'text-alarm'}`}>
              Live Data
            </span>
          </span>

          <span className="hidden md:flex items-center gap-2 font-mono-val text-[10px] text-ink-faint tabular-nums">
            <span className="tracking-[0.14em] uppercase">{mode === 'replay' ? 'Replay' : 'Live'}</span>
            <span className="text-rule-strong">|</span>
            <span>{date}</span>
            <span className="text-accent-soft">{utc} IST</span>
          </span>

          <a
            href="/about"
            onClick={(e) => {
              if (isModifiedClick(e)) return;
              e.preventDefault();
              go('/about');
            }}
            className="hidden md:inline-flex items-center gap-2 font-mono-val text-[10px] text-ink-faint hover:text-ink transition-colors"
            title="About the mission"
          >
            ISRO <span className="text-accent-soft">|</span> Aditya-L1
          </a>

          {/* Theme toggle — dark (default) / light instrument panels */}
          <button
            type="button"
            className="inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-full border border-rule-strong text-ink-faint hover:text-accent-soft hover:border-accent/60 transition-colors"
            aria-label={light ? 'Switch to dark mode' : 'Switch to light mode'}
            aria-pressed={light}
            title={light ? 'Switch to dark mode' : 'Switch to light mode'}
            onClick={() => setLight((v) => !v)}
          >
            {light ? <Sun size={14} strokeWidth={1.8} /> : <Moon size={14} strokeWidth={1.8} />}
          </button>
        </div>

        {/* Mobile nav */}
        <div className="lg:hidden flex items-center gap-1 ml-auto overflow-x-auto">
          {NAV.map(({ screen, label, href }) => {
            const active = screen === 'home' ? route.screen === 'home' : route.screen === screen;
            return (
              <a
                key={screen}
                href={href}
                aria-current={active ? 'page' : undefined}
                onClick={(e) => {
                  if (isModifiedClick(e)) return;
                  e.preventDefault();
                  go(href);
                }}
                className={`whitespace-nowrap px-2.5 py-1.5 text-[10px] tracking-[0.16em] uppercase ${
                  active ? 'text-accent-soft' : 'text-ink-muted'
                }`}
              >
                {label}
              </a>
            );
          })}
        </div>
      </nav>
    </header>
  );
}