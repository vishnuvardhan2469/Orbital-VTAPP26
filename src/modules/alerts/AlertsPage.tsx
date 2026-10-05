import { useMemo, useState } from 'react'
import { Check, CheckCheck } from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Panel,
  Segmented,
  StatTile,
} from '@/components/ui/primitives'
import { relativeTime, utc } from '@/lib/util/format'
import type { AlertEvent, Severity } from '@/lib/types'
import { useStore } from '@/state/store'

type Filter = 'ALL' | 'OPEN' | Severity

const SOURCE_LABELS: Record<AlertEvent['source'], string> = {
  TELEMETRY: 'Telemetry',
  CONJUNCTION: 'Conjunction',
  GROUND_SEGMENT: 'Ground segment',
  EARTH_OBSERVATION: 'Earth observation',
  SYSTEM: 'System',
}

/** Unified event log. Every module raises alerts here rather than to its own feed. */
export function AlertsPage() {
  const alerts = useStore((s) => s.alerts)
  const acknowledgeAlert = useStore((s) => s.acknowledgeAlert)
  const acknowledgeAll = useStore((s) => s.acknowledgeAll)
  const select = useStore((s) => s.select)

  const [filter, setFilter] = useState<Filter>('OPEN')

  const filtered = useMemo(() => {
    switch (filter) {
      case 'ALL':
        return alerts
      case 'OPEN':
        return alerts.filter((a) => !a.acknowledged)
      default:
        return alerts.filter((a) => a.severity === filter)
    }
  }, [alerts, filter])

  const counts = useMemo(
    () => ({
      open: alerts.filter((a) => !a.acknowledged).length,
      critical: alerts.filter((a) => a.severity === 'CRITICAL').length,
      warning: alerts.filter((a) => a.severity === 'WARNING').length,
    }),
    [alerts],
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader
        title="Alert Feed"
        description="Every event raised by the console, from any module, in one acknowledgeable log."
        actions={
          <Button onClick={acknowledgeAll} disabled={counts.open === 0}>
            <CheckCheck size={12} /> Acknowledge all
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Total events" value={alerts.length} />
        <StatTile
          label="Unacknowledged"
          value={counts.open}
          tone={counts.open > 0 ? 'WARNING' : undefined}
        />
        <StatTile
          label="Critical"
          value={counts.critical}
          tone={counts.critical > 0 ? 'CRITICAL' : undefined}
        />
        <StatTile label="Warning" value={counts.warning} />
      </div>

      <Panel
        title={`Events · ${filtered.length}`}
        className="min-h-0 flex-1"
        actions={
          <Segmented
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'OPEN' as const, label: 'Open' },
              { value: 'ALL' as const, label: 'All' },
              { value: 'CRITICAL' as const, label: 'Critical' },
              { value: 'WARNING' as const, label: 'Warning' },
            ]}
          />
        }
        bodyClassName="overflow-y-auto"
        dense
      >
        {filtered.length === 0 ? (
          <EmptyState
            title={filter === 'OPEN' ? 'Nothing outstanding' : 'No matching events'}
            detail={
              filter === 'OPEN'
                ? 'Every alert raised so far has been acknowledged.'
                : 'Adjust the filter to see other events.'
            }
          />
        ) : (
          <ul className="divide-y divide-line-soft">
            {filtered.map((alert) => (
              <li
                key={alert.id}
                className={`flex items-start gap-3 px-4 py-3 ${alert.acknowledged ? 'opacity-55' : ''}`}
              >
                <Badge tone={alert.severity} className="mt-0.5">
                  {alert.severity}
                </Badge>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <p className="text-[12px] text-ink">{alert.title}</p>
                    <span className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">
                      {SOURCE_LABELS[alert.source]}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-ink-dim">{alert.detail}</p>
                  <p className="mt-1 font-mono text-[10px] text-ink-faint">
                    {utc(alert.t)} · {relativeTime(alert.t)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {alert.noradId !== undefined && (
                    <Button size="sm" onClick={() => select(alert.noradId!)}>
                      Track
                    </Button>
                  )}
                  {!alert.acknowledged && (
                    <Button size="sm" onClick={() => acknowledgeAlert(alert.id)} title="Acknowledge">
                      <Check size={11} />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
