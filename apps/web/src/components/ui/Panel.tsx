import type { ReactNode } from 'react';

interface PanelProps {
  /** Uppercase letter-spaced label shown on the panel's top rule. */
  label: string;
  /** Right-aligned slot on the label rule: counts, badges, small controls. */
  meta?: ReactNode;
  /**
   * Data colour for the label chip (a small square before the label).
   * Use it to echo what the panel measures — series colour, R-scale,
   * severity — never decoration.
   */
  tone?: string;
  children: ReactNode;
  className?: string;
}

/**
 * The one panel chrome in the console: a hairline-ruled box titled by a
 * single uppercase label. No icon, no subtitle, no shadow.
 *
 * Padding tightens below 768px (16px of gutter each side is a tenth of a
 * 320px screen) and the label rule is allowed to wrap so a long label and
 * its meta never collide on a narrow panel.
 */
export default function Panel({ label, meta, tone, children, className = '' }: PanelProps) {
  return (
    <section className={`sk-panel ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 md:px-4 py-2 border-b border-rule">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-muted">
          {tone && (
            <span
              className="inline-block w-2 h-2 shrink-0"
              style={{ backgroundColor: tone }}
              aria-hidden="true"
            />
          )}
          {label}
        </h2>
        {meta && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono-val text-ink-faint">
            {meta}
          </div>
        )}
      </header>
      <div className="p-3 md:p-4">{children}</div>
    </section>
  );
}
