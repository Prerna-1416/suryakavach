import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, Moon, Sun, X } from 'lucide-react';
import OrbitMark from './ui/OrbitMark';
import { useRouter, isModifiedClick } from '../lib/router';
import { usePrefersReducedMotion } from '../lib/motion';
import { useIsMobile } from '../lib/responsive';

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

const MENU_ID = 'sk-mobile-nav';

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
 *
 * Below 768px the inline nav is replaced by a disclosure menu: the same
 * routes, same aria-current semantics, but as full-width 44px rows that can
 * be reached with a thumb. The menu closes on route selection, Escape and
 * outside pointer-down, and returns focus to the trigger on Escape.
 */
export default function NavBar({ wsConnected = true, mode = 'live', theme = 'overlay' }: NavBarProps) {
  const { route, go } = useRouter();
  const reduced = usePrefersReducedMotion();
  const isMobile = useIsMobile();
  const { utc, date } = useUtcClock();

  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

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

  /* The menu only exists below 768px. CSS hides it above that, but the open
     state has to be released too or a rotate→desktop→back cycle would
     restore a stale drawer. */
  useEffect(() => {
    if (!isMobile) setOpen(false);
  }, [isMobile]);

  /* Escape closes and hands focus back to the trigger. */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  /* Outside pointer-down closes. The trigger is exempt so its own click
     toggles instead of closing-then-reopening. */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  /* Lock the page behind the drawer, and land focus on the first row so a
     keyboard user is not left behind on the trigger. */
  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add('sk-scroll-locked');
    const id = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled])')?.focus();
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.documentElement.classList.remove('sk-scroll-locked');
    };
  }, [open]);

  /* Keep Tab inside the open drawer — the backdrop makes it modal in
     practice, so the keyboard must agree with the pointer. */
  const onPanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled])',
    );
    if (!focusables || focusables.length === 0) return;
    const list = Array.from(focusables);
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const solid = theme === 'solid';
  const modeLabel = mode === 'replay' ? 'Replay' : 'Live';

  const navigate = (href: string, e: React.MouseEvent) => {
    if (isModifiedClick(e)) return;
    e.preventDefault();
    go(href);
    close();
  };

  return (
    <header
      className={`sticky top-0 z-50 ${solid ? 'bg-panel/90' : 'sk-glass'} border-b border-rule/70 sk-safe-x`}
    >
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <nav
        aria-label="Main navigation"
        className="max-w-[1440px] mx-auto flex items-center gap-2 md:gap-4 px-3 md:px-5 h-16"
      >
        {/* Brand — tracking tightens and the mission subtitle drops off below
            400px so the bar still fits a 320px phone. */}
        <a
          href="/"
          onClick={(e) => navigate('/', e)}
          className="flex items-center gap-2 md:gap-2.5 shrink-0 group"
        >
          <OrbitMark size={20} dark />
          <span className="flex flex-col leading-none">
            <span className="text-[11px] md:text-[13px] font-semibold tracking-[0.16em] md:tracking-[0.28em] text-screen-title group-hover:text-accent-soft transition-colors">
              SURYAKAVACH
            </span>
            <span className="mt-1 hidden min-[400px]:block text-[9px] font-mono-val tracking-[0.18em] md:tracking-[0.22em] text-ink-faint">
              ADITYA-L1 · SIH 2026
            </span>
          </span>
        </a>

        {/* Center navigation — the six route links are the bar's layout budget,
            so their padding and tracking step up only once there is room (xl). */}
        <div className="hidden md:flex items-center gap-1 mx-auto">
          {NAV.map(({ screen, label, href }) => {
            const active = screen === 'home' ? route.screen === 'home' : route.screen === screen;
            return (
              <motion.a
                key={screen}
                href={href}
                aria-current={active ? 'page' : undefined}
                {...(reduced ? {} : { whileTap: { scale: 0.96 } })}
                onClick={(e) => navigate(href, e)}
                className={`relative px-2 xl:px-3.5 py-1.5 text-[10px] xl:text-[11px] tracking-[0.14em] xl:tracking-[0.18em] uppercase transition-colors ${
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

        {/* Right cluster.
            Width is staged rather than binary: the compact status pip carries
            the feed state up to 1024, the mode + UTC readout joins it from
            1024, and the full telemetry block (LIVE DATA, date, IST, ISRO)
            only appears at 1280+ where it actually fits. Everything dropped in
            between is still on the Header strip below the bar. */}
        <div className="flex items-center gap-2 md:gap-4 ml-auto md:ml-0 shrink-0">
          <span className="hidden xl:flex items-center gap-1.5" title="Live telemetry feed">
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

          <span className="hidden lg:flex items-center gap-2 font-mono-val text-[10px] text-ink-faint tabular-nums">
            <span className="tracking-[0.14em] uppercase">{modeLabel}</span>
            <span className="text-rule-strong">|</span>
            <span className="hidden xl:inline">{date}</span>
            <span className="text-accent-soft">{utc} IST</span>
          </span>

          {/* Phone and tablet status pip: the feed state must stay visible
              without the drawer, so the dot survives on its own with a text
              label carried by title/aria. */}
          <span
            className="flex lg:hidden items-center gap-1.5 shrink-0"
            title={`Live telemetry feed — ${wsConnected ? 'connected' : 'disconnected'} · mode ${modeLabel}`}
          >
            <span
              role="img"
              aria-label={`Telemetry ${wsConnected ? 'connected' : 'disconnected'}, mode ${modeLabel}`}
              className="inline-block w-2 h-2 rounded-full"
              style={{
                backgroundColor: wsConnected ? 'var(--color-ok)' : 'var(--color-alarm)',
                boxShadow: `0 0 6px 1px ${wsConnected ? 'rgba(52,211,153,0.8)' : 'rgba(239,122,90,0.8)'}`,
              }}
            />
            <span
              className={`font-mono-val text-[10px] tracking-[0.14em] uppercase ${wsConnected ? 'text-ok' : 'text-alarm'}`}
            >
              {modeLabel}
            </span>
          </span>

          <a
            href="/about"
            onClick={(e) => navigate('/about', e)}
            className="hidden xl:inline-flex items-center gap-2 font-mono-val text-[10px] text-ink-faint hover:text-ink transition-colors"
            title="About the mission"
          >
            ISRO <span className="text-accent-soft">|</span> Aditya-L1
          </a>

          {/* Theme toggle — dark (default) / light instrument panels */}
          <button
            type="button"
            className="inline-flex sk-touch shrink-0 items-center justify-center w-8 h-8 md:w-8 md:h-8 rounded-full border border-rule-strong text-ink-faint hover:text-accent-soft hover:border-accent/60 transition-colors"
            aria-label={light ? 'Switch to dark mode' : 'Switch to light mode'}
            aria-pressed={light}
            title={light ? 'Switch to dark mode' : 'Switch to light mode'}
            onClick={() => setLight((v) => !v)}
          >
            {light ? <Sun size={14} strokeWidth={1.8} /> : <Moon size={14} strokeWidth={1.8} />}
          </button>

          {/* Hamburger — below 768px only */}
          <button
            ref={triggerRef}
            type="button"
            className="md:hidden inline-flex sk-touch items-center justify-center w-8 h-8 rounded-sm border border-rule-strong text-ink-muted hover:text-accent-soft hover:border-accent/60 transition-colors"
            aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={open}
            aria-controls={MENU_ID}
            aria-haspopup="dialog"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={16} strokeWidth={1.8} /> : <Menu size={16} strokeWidth={1.8} />}
          </button>
        </div>
      </nav>

      {/* Mobile nav — disclosure panel anchored under the bar. */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="mobile-nav"
            className="md:hidden"
            initial={reduced ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduced ? { opacity: 1 } : { opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Backdrop: dims the console and is the outside-click target. */}
            <div
              className="fixed inset-x-0 bottom-0 top-16 z-40 bg-black/60"
              aria-hidden="true"
              onClick={() => close()}
            />
            <div
              id={MENU_ID}
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Main navigation"
              onKeyDown={onPanelKeyDown}
              className={`absolute inset-x-0 top-full z-50 border-b border-rule ${solid ? 'bg-panel' : 'sk-glass'} sk-safe-x sk-safe-b`}
            >
              <ul className="flex flex-col py-1">
                {NAV.map(({ screen, label, href }) => {
                  const active = screen === 'home' ? route.screen === 'home' : route.screen === screen;
                  return (
                    <li key={screen}>
                      <a
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        onClick={(e) => navigate(href, e)}
                        className={`flex items-center justify-between min-h-[48px] px-4 text-[12px] tracking-[0.2em] uppercase transition-colors ${
                          active ? 'text-accent-soft' : 'text-ink-muted active:text-ink'
                        }`}
                      >
                        {label}
                        {active && <span className="w-6 h-px bg-accent" aria-hidden="true" />}
                      </a>
                    </li>
                  );
                })}
              </ul>

              {/* Status block — the desktop bar's right cluster, restacked. */}
              <div className="border-t border-rule px-4 py-3 flex flex-col gap-2 font-mono-val text-[10px] text-ink-faint tabular-nums">
                <span className="flex items-center justify-between gap-3">
                  <span className="tracking-[0.16em] uppercase">Mode</span>
                  <span className={wsConnected ? 'text-ok' : 'text-alarm'}>{modeLabel}</span>
                </span>
                <span className="flex items-center justify-between gap-3">
                  <span className="tracking-[0.16em] uppercase">Date</span>
                  <span>{date}</span>
                </span>
                <span className="flex items-center justify-between gap-3">
                  <span className="tracking-[0.16em] uppercase">UTC</span>
                  <span className="text-accent-soft">{utc}</span>
                </span>
                <a
                  href="/about"
                  onClick={(e) => navigate('/about', e)}
                  className="flex items-center min-h-[44px] tracking-[0.16em] uppercase text-ink-faint active:text-ink"
                >
                  ISRO <span className="mx-1.5 text-accent-soft">|</span> Aditya-L1
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
