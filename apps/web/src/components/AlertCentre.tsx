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

export default function AlertCentre() {
  const { data, isLoading } = useAlerts();
  const alerts: Alert[] = data ?? [];

  return (
    <Panel label="Alert Centre" meta={<span>{alerts.length} alerts</span>} tone="#f87171">
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
                className="flex items-start gap-3 px-3 py-2.5 bg-panel border-l-2"
                style={{ borderLeftColor: color }}
              >
                <span
                  className="mt-0.5 text-[10px] font-bold px-1.5 py-0.5 border font-mono-val shrink-0"
                  style={{ color, borderColor: color, backgroundColor: `${color}14` }}
                >
                  {alert.severity}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
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
                  <p className="text-xs text-ink">{alert.message}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
