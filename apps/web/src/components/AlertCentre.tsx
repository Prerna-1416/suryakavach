import { useAlerts } from '../lib/hooks';
import type { Alert } from '../types/api';
import Panel from './ui/Panel';

const SEVERITY_COLORS: Record<string, string> = {
  R1: '#38bdf8',
  R2: '#fbbf24',
  R3: '#fb923c',
  R4: '#f87171',
  R5: '#ef4444',
};

interface AlertCentreProps {
  /**
   * Show only the newest N alerts. Used by the phone Live console, where the
   * latest warning must sit in the first screenful — the full feed stays one
   * tap away in the Alert Centre.
   */
  limit?: number;
  /** Tighter rows for the priority stack on a phone. */
  compact?: boolean;
}

export default function AlertCentre({ limit, compact = false }: AlertCentreProps = {}) {
  const { data, isLoading } = useAlerts();
  const all: Alert[] = data ?? [];
  // /api/alerts returns ORDER BY id DESC, so index 0 is the newest.
  const alerts = limit !== undefined ? all.slice(0, limit) : all;
  const totalLabel = limit !== undefined && all.length > alerts.length
    ? `latest ${alerts.length} of ${all.length}`
    : `${all.length} alerts`;

  return (
    <Panel label="Alert Centre" meta={<span>{totalLabel}</span>} tone="#f87171">
      {isLoading ? (
        <div className="text-center text-ink-faint py-8 text-xs font-mono-val">Loading alerts…</div>
      ) : alerts.length === 0 ? (
        <div className="text-center text-ink-faint py-8 text-xs font-mono-val">
          No alerts in current session.
        </div>
      ) : (
        <div className="divide-y divide-rule border border-rule" role="log" aria-live="polite" aria-label="Alert feed">
          {alerts.map((alert) => {
            const color = SEVERITY_COLORS[alert.severity] ?? '#8b8f96';
            return (
              <div
                key={alert.id}
                className={`flex items-start gap-3 bg-panel border-l-2 ${compact ? 'px-3 py-2' : 'px-3 py-2.5'}`}
                style={{ borderLeftColor: color }}
              >
                <span
                  className="mt-0.5 text-[10px] font-bold px-1.5 py-0.5 border font-mono-val shrink-0"
                  style={{ color, borderColor: color, backgroundColor: `${color}14` }}
                >
                  {alert.severity}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-0.5">
                    <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-faint">
                      {alert.type.replace('_', ' ')}
                    </span>
                    {alert.flare_id && (
                      <span className="text-[10px] font-mono-val text-ink-muted">{alert.flare_id}</span>
                    )}
                    <span className="ml-auto text-[10px] font-mono-val tabular-nums text-ink-faint shrink-0">
                      {alert.ts.replace('T', ' ').replace('Z', '')} UTC
                    </span>
                  </div>
                  <p className="text-[13px] md:text-xs text-ink">{alert.message}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
