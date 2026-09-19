import { useId } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { motion, useMotionValue } from 'framer-motion';
import { useNowcast, useImpact, useStreams, useForecast } from '../lib/hooks';
import { useRouter, isModifiedClick } from '../lib/router';
import {
  NOWCAST_STATES,
  goesClass,
  goesClassColor,
  rLevelColor,
  FORECAST_HORIZONS,
  riskColor,
} from '../lib/constants';
import { usePrefersReducedMotion } from '../lib/motion';
import SolarScene from './three/SolarScene';

/** One live reading shown in the mission strip. */
function Stat({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
}) {
  return (
    <div className="border-l border-accent/30 pl-4">
      <div className="text-[9px] uppercase tracking-[0.22em] text-ink-faint">{label}</div>
      <div
        className="mt-1.5 font-mono-val tabular-nums text-xl leading-none"
        style={tone ? { color: tone } : undefined}
      >
        {value}
        {unit && <span className="ml-1 text-[10px] text-ink-faint">{unit}</span>}
      </div>
    </div>
  );
}

/** SVG pointer line with a bend and glowing endpoint node for HUD callouts. */
function CalloutLine({ aim }: { aim: 'left-down' | 'right-down' | 'right-up' }) {
  const id = useId();
  return (
    <svg
      className={`sk-callout-line sk-callout-line--${aim}`}
      viewBox="0 0 120 48"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffb45e" stopOpacity="0" />
          <stop offset="1" stopColor="#ffd9a0" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <path d="M0 48 L84 48 L84 12" stroke={`url(#${id})`} strokeWidth="1" />
      <circle cx="84" cy="12" r="3" fill="#fff6e8" style={{ filter: 'drop-shadow(0 0 5px #ffb45e)' }} />
    </svg>
  );
}

const MONITOR = ['Solar Flares', 'Coronal Mass Ejections', 'Radiation Levels', 'Satellite Impact Forecasts'];

export default function LandingHero() {
  const { go } = useRouter();
  const reduced = usePrefersReducedMotion();

  /* Mouse parallax state — the WebGL camera springs toward the cursor. */
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  /* 1 while the pointer is over the hero, 0 when it leaves (drives the
     Sun's proximity interaction and lets it settle back to rest). */
  const inside = useMotionValue(1);

  const handleMove = (e: ReactMouseEvent<HTMLElement>) => {
    if (reduced) return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };
  const handleLeave = () => {
    mx.set(0);
    my.set(0);
    inside.set(0);
  };

  const { data: nowcast } = useNowcast();
  const { data: impact } = useImpact();
  const { data: streams } = useStreams(120);
  const { data: forecast } = useForecast();

  const state = (nowcast?.state ?? 'quiet') as keyof typeof NOWCAST_STATES;
  const stateInfo = NOWCAST_STATES[state];
  const activeFlare = nowcast?.active ?? null;

  const lastSxr = streams?.solexs[streams.solexs.length - 1];
  const lastHxr = streams?.hel1os[streams.hel1os.length - 1];

  const sxr = lastSxr?.v ?? null;
  const hxr = lastHxr?.v ?? null;
  const impactIndex = impact?.index ?? null;

  const fade = (delay: number) =>
    reduced
      ? {}
      : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 } as const,
          transition: { duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] as const } };

  return (
    <div className="bg-space">
      {/* ================= HERO — WebGL solar system, 2D HUD overlay ================= */}
      <section
        className="sk-scene relative h-[100svh] min-h-[680px] overflow-hidden bg-[#030305]"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onMouseEnter={() => inside.set(1)}
      >
        {/* 0 · Nebula dust behind the transparent WebGL canvas */}
        <div className="sk-nebula" aria-hidden="true" />

        {/* 1 · The 3D scene: Sun, solar wind, Earth + parallax camera */}
        <div className="absolute inset-0 z-10">
          <SolarScene mx={mx} my={my} reduced={reduced} inside={inside} />
        </div>

        {/* Legibility softeners */}
        <div className="sk-mask-vignette" aria-hidden="true" />
        <div className="absolute inset-x-0 top-0 z-10 h-36 bg-gradient-to-b from-[#030305] to-transparent" aria-hidden="true" />

        {/* ================= 2D HUD OVERLAY ================= */}
        <div className="pointer-events-none absolute inset-0 z-20">
          {/* Upper-right tagline */}
          <motion.div
            {...(reduced ? {} : fade(0.3).initial)}
            {...(reduced ? {} : fade(0.3).animate)}
            transition={fade(0.3).transition}
            className="sk-tagline hidden lg:block absolute right-8 top-24 text-right"
          >
            <p className="font-serif italic text-sm md:text-base leading-relaxed text-white/80">
              A safer tomorrow,
              <br />
              under a calmer Sun.
            </p>
            <span className="mt-3 ml-auto block h-px w-14 bg-gradient-to-l from-accent/60 to-transparent" aria-hidden="true" />
          </motion.div>

          {/* Centre hero block */}
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <motion.p
              {...(reduced ? {} : fade(0.15).initial)}
              {...(reduced ? {} : fade(0.15).animate)}
              transition={fade(0.15).transition}
              className="flex items-center gap-4 text-[10px] md:text-[11px] tracking-[0.44em] uppercase text-ink-muted"
            >
              <span className="hidden sm:block h-px w-8 bg-gradient-to-r from-transparent to-accent/60" aria-hidden="true" />
              <span className="text-accent-soft">Observe</span> · Predict · Protect
              <span className="hidden sm:block h-px w-8 bg-gradient-to-l from-transparent to-accent/60" aria-hidden="true" />
            </motion.p>

            <motion.h1
              {...(reduced ? {} : fade(0.25).initial)}
              {...(reduced ? {} : fade(0.25).animate)}
              transition={fade(0.25).transition}
              className="mt-4 font-display sk-title-glow text-[clamp(2.5rem,6.5vw,6.5rem)] leading-[0.95] text-white"
            >
              SURYAKAVACH
            </motion.h1>

            <motion.p
              {...(reduced ? {} : fade(0.38).initial)}
              {...(reduced ? {} : fade(0.38).animate)}
              transition={fade(0.38).transition}
              className="mt-5 max-w-2xl font-serif italic text-base md:text-xl leading-relaxed text-white/80"
            >
              Because what happens on the <span className="text-accent-soft not-italic">Sun</span>{' '}
              doesn&rsquo;t always stay <em className="text-accent-soft">there</em>.
            </motion.p>

            <motion.div
              {...(reduced ? {} : fade(0.52).initial)}
              {...(reduced ? {} : fade(0.52).animate)}
              transition={fade(0.52).transition}
              className="mt-8"
            >
              <a
                href="/live"
                onClick={(e) => {
                  if (isModifiedClick(e)) return;
                  e.preventDefault();
                  go('/live');
                }}
                className="sk-hero-btn pointer-events-auto inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-[11px] uppercase tracking-[0.26em]"
              >
                Explore Live Data
                <span aria-hidden="true">→</span>
              </a>
            </motion.div>
          </div>

          {/* Pointer callouts */}
          <div className="sk-callout sk-callout--sun hidden xl:block">
            <CalloutLine aim="left-down" />
            <div className="sk-callout-title">
              <span className="sk-callout-dot" aria-hidden="true" />
              The Sun
            </div>
            <div className="sk-callout-spec">Temperature −5,500 °C</div>
            <div className="sk-callout-spec">Distance 149.6 million km</div>
          </div>

          <div className="sk-callout sk-callout--wind hidden xl:block">
            <CalloutLine aim="left-down" />
            <div className="sk-callout-title">
              <span className="sk-callout-dot sk-callout-dot--cool" aria-hidden="true" />
              Solar Wind
            </div>
            <div className="sk-callout-spec">Travels at 300 – 800 km/s</div>
          </div>

          <div className="sk-callout sk-callout--earth hidden xl:block">
            <CalloutLine aim="right-up" />
            <div className="sk-callout-title">
              <span className="sk-callout-dot sk-callout-dot--earth" aria-hidden="true" />
              Earth
            </div>
            <div className="sk-callout-spec">Our home. Our responsibility.</div>
          </div>

          {/* Bottom bar */}
          <div className="absolute inset-x-0 bottom-0 px-6 pb-6">
            <div className="mx-auto flex max-w-[1500px] items-end justify-between gap-6">
              <div className="hidden lg:block">
                <div className="text-[9px] uppercase tracking-[0.3em] text-ink-faint">
                  Real-Time Monitoring
                </div>
                <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono-val text-[9px] uppercase tracking-[0.16em] text-ink-faint/80">
                  {MONITOR.map((m) => (
                    <li key={m} className="flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-0.5 rounded-full bg-accent/80" aria-hidden="true" />
                      {m}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="sk-scroll-cue sk-scroll-cue--static mx-auto lg:mx-0 flex flex-col items-center gap-2.5">
                <span className="sk-mouse" aria-hidden="true" />
                <span className="text-[9px] tracking-[0.32em] uppercase text-ink-faint">Scroll to Explore</span>
              </div>

              <div className="hidden xl:block text-right font-mono-val text-[9px] uppercase tracking-[0.2em] text-ink-faint/80 leading-relaxed">
                Powered by Science <span className="text-accent-soft/80">|</span> Built for a Safer Tomorrow
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= MISSION STRIP ================= */}
      <section id="mission" className="sk-scene relative border-t border-white/[0.05] bg-space px-5 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center gap-3">
            <span className="w-6 h-px bg-accent/60" aria-hidden="true" />
            <span className="text-[10px] uppercase tracking-[0.3em] text-ink-faint font-mono-val">
              Mission Status
            </span>
          </div>

          <div className="mt-3 max-w-2xl">
            <h2 className="font-display text-3xl md:text-5xl leading-tight text-white">
              Watch the sun. <span className="italic text-accent-soft">Protect the grid.</span>
            </h2>
            <p className="mt-4 text-sm md:text-base leading-relaxed text-ink-muted">
              Countdown-level intelligence for solar flare onset — BOCPD change-point detection,
              Neupert-effect correlation, discrete hazard forecasts and a 0–10 radiation impact index,
              fused from the SoLEXS and HEL1OS payloads of ISRO&rsquo;s Aditya-L1 observatory.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-2 lg:grid-cols-4 gap-6 sk-glass p-6 md:p-8">
            <Stat
              label="SoLEXS soft X-ray"
              value={sxr !== null ? sxr.toExponential(2) : '—'}
              unit="W/m²"
              tone={sxr !== null ? goesClassColor(sxr) : undefined}
            />
            <Stat
              label="GOES class"
              value={sxr !== null ? goesClass(sxr) : '—'}
              tone={sxr !== null ? goesClassColor(sxr) : undefined}
            />
            <Stat
              label="HEL1OS hard X-ray"
              value={hxr !== null ? hxr.toExponential(2) : '—'}
              unit="W/m²"
              tone={hxr !== null ? goesClassColor(hxr) : undefined}
            />
            <Stat
              label="Flare impact index"
              value={impactIndex !== null ? impactIndex.toFixed(1) : '—'}
              unit={`/ 10 · ${impact?.r_level ?? ''}`}
              tone={impactIndex !== null ? rLevelColor(impact?.r_level ?? 'R0') : undefined}
            />
          </div>

          {/* Nowcast state + forecast probability strip */}
          <div className="mt-6 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 sk-glass p-6">
            <div className="flex items-center gap-4">
              <span
                className={`sk-signal`}
                style={{ color: stateInfo.color }}
                aria-hidden="true"
              >
                <span />
                <span />
                <span />
                <span />
              </span>
              <div>
                <div
                  className="text-[10px] uppercase tracking-[0.22em]"
                  style={{ color: stateInfo.color }}
                >
                  {stateInfo.label} {activeFlare ? `· ${activeFlare.class}` : ''}
                </div>
                <div className="mt-1 text-sm text-ink-muted">
                  {activeFlare
                    ? activeFlare.class.startsWith('X') || activeFlare.class.startsWith('M')
                      ? 'High-energy flare event active'
                      : 'Solar flare event in progress'
                    : 'Solar radiation baseline — no active flare'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-5">
              {(forecast?.horizons ?? [])
                .filter((h) =>
                  FORECAST_HORIZONS.includes(h.horizon_min as (typeof FORECAST_HORIZONS)[number]),
                )
                .sort((a, b) => a.horizon_min - b.horizon_min)
                .map((h) => {
                  const color = riskColor(h.p_m1);
                  return (
                    <div key={h.horizon_min} className="text-center">
                      <div
                        className="font-mono-val tabular-nums text-base font-semibold"
                        style={{ color }}
                      >
                        {(h.p_m1 * 100).toFixed(0)}%
                      </div>
                      <div className="mt-0.5 text-[9px] uppercase tracking-[0.18em] text-ink-faint">
                        +{h.horizon_min}m P(M+)
                      </div>
                    </div>
                  );
                })}
              <div className="ml-2 flex items-center gap-4">
                <a
                  href="/forecast"
                  onClick={(e) => {
                    if (isModifiedClick(e)) return;
                    e.preventDefault();
                    go('/forecast');
                  }}
                  className="text-[10px] uppercase tracking-[0.22em] text-accent-soft hover:text-white transition-colors"
                >
                  Forecast →
                </a>
                <a
                  href="/impact"
                  onClick={(e) => {
                    if (isModifiedClick(e)) return;
                    e.preventDefault();
                    go('/impact');
                  }}
                  className="text-[10px] uppercase tracking-[0.22em] text-accent-soft hover:text-white transition-colors"
                >
                  Impact →
                </a>
              </div>
            </div>
          </div>

          <footer className="mt-14 flex flex-col md:flex-row items-center justify-between gap-3 border-t border-white/[0.05] pt-6 text-[10px] font-mono-val tracking-[0.14em] uppercase text-ink-faint">
            <span>SURYAKAVACH · SIH 2026 · Space Technology</span>
            <span className="normal-case tracking-normal text-ink-faint/70">
              Synthetic fused cache — not live Aditya-L1 telemetry
            </span>
          </footer>
        </div>
      </section>
    </div>
  );
}
