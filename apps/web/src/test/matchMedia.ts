/**
 * Minimal matchMedia implementation for jsdom, which ships without one.
 *
 * Queries are matched by exact string against the provided table, so a test
 * can decide that the viewport is a phone (`MOBILE_QUERY: true`) while
 * `prefers-reduced-motion` stays false. `set()` fires change listeners so the
 * hooks under test can be observed reacting, not just initialising.
 */
export interface MatchMediaHarness {
  set(query: string, matches: boolean): void;
  listeners: Map<string, Set<(e: MediaQueryListEvent) => void>>;
}

export function installMatchMedia(initial: Record<string, boolean>): MatchMediaHarness {
  const state = new Map<string, boolean>(Object.entries(initial));
  const listeners = new Map<string, Set<(e: MediaQueryListEvent) => void>>();

  const make = (query: string) => {
    const target = listeners.get(query) ?? new Set<(e: MediaQueryListEvent) => void>();
    listeners.set(query, target);
    return {
      media: query,
      matches: state.get(query) ?? false,
      onchange: null,
      addEventListener: (type: string, cb: (e: MediaQueryListEvent) => void) => {
        if (type === 'change') target.add(cb);
      },
      removeEventListener: (type: string, cb: (e: MediaQueryListEvent) => void) => {
        if (type === 'change') target.delete(cb);
      },
      addListener: (cb: (e: MediaQueryListEvent) => void) => target.add(cb),
      removeListener: (cb: (e: MediaQueryListEvent) => void) => target.delete(cb),
      dispatchEvent: () => true,
    };
  };

  const mm = (query: string) => make(query) as unknown as MediaQueryList;

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: mm,
  });

  return {
    listeners,
    set(query, matches) {
      state.set(query, matches);
      listeners.get(query)?.forEach((cb) => cb({ matches, media: query } as MediaQueryListEvent));
    },
  };
}
