import { Check, RefreshCw, TriangleAlert } from 'lucide-react'
import {
  Badge,
  Button,
  KeyValue,
  PageHeader,
  Panel,
  StatusDot,
} from '@/components/ui/primitives'
import { ADAPTERS } from '@/lib/adapters'
import { relativeTime, utc } from '@/lib/util/format'
import { useStore } from '@/state/store'

/**
 * Data-source console.
 *
 * Makes the adapter seam visible and switchable at runtime, so the decision
 * "am I looking at real data or simulated data?" is never ambiguous — the one
 * question that matters most when a demo becomes a system.
 */
export function SourcesPage() {
  const adapterId = useStore((s) => s.adapterId)
  const status = useStore((s) => s.status)
  const catalog = useStore((s) => s.catalog)
  const stations = useStore((s) => s.stations)
  const aois = useStore((s) => s.aois)
  const loadSource = useStore((s) => s.loadSource)
  const simTime = useStore((s) => s.simTime)

  // Staleness is measured against mission time like everything else, so
  // fast-forwarding the clock ages the element sets the way it should.
  const staleTles = catalog.filter(
    (o) => simTime - new Date(o.epoch).getTime() > 14 * 86_400_000,
  ).length

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Data Sources"
        description="Every view in this console reads through one adapter interface. Switching the source swaps the implementation — no page knows the difference."
        actions={
          <Button onClick={() => loadSource(adapterId)} disabled={status.state === 'LOADING'}>
            <RefreshCw size={12} className={status.state === 'LOADING' ? 'animate-spin' : ''} />
            Reload
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {ADAPTERS.map((adapter) => {
          const active = adapter.id === adapterId
          return (
            <Panel
              key={adapter.id}
              title={adapter.label}
              className={active ? 'border-signal/40' : ''}
              actions={
                active ? (
                  <Badge tone={status.state === 'ERROR' ? 'CRITICAL' : 'NOMINAL'}>
                    <StatusDot
                      tone={status.state === 'ERROR' ? 'CRITICAL' : 'NOMINAL'}
                      pulse={status.state === 'LOADING'}
                    />
                    active
                  </Badge>
                ) : (
                  <Button size="sm" onClick={() => loadSource(adapter.id)}>
                    Switch
                  </Button>
                )
              }
            >
              <p className="text-[11px] leading-relaxed text-ink-dim">{adapter.description}</p>

              <div className="mt-3 border-t border-line-soft pt-2">
                <KeyValue label="Mode" value={adapter.isLive ? 'Live network' : 'Offline simulation'} />
                {active && (
                  <>
                    <KeyValue label="State" value={status.state} />
                    <KeyValue
                      label="Last sync"
                      value={status.lastSync ? relativeTime(status.lastSync) : '—'}
                    />
                    <KeyValue label="Objects" value={status.recordCount ?? 0} />
                  </>
                )}
              </div>

              {active && status.state === 'ERROR' && (
                <p className="mt-3 flex items-start gap-2 rounded-lg border border-alert/30 bg-alert/10 px-2.5 py-2 text-[11px] leading-snug text-alert">
                  <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                  {status.message}
                </p>
              )}
            </Panel>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel title="Loaded data">
          <KeyValue label="Tracked objects" value={catalog.length} />
          <KeyValue label="Payloads" value={catalog.filter((o) => o.type === 'PAYLOAD').length} />
          <KeyValue label="Debris" value={catalog.filter((o) => o.type === 'DEBRIS').length} />
          <KeyValue label="Rocket bodies" value={catalog.filter((o) => o.type === 'ROCKET_BODY').length} />
          <KeyValue label="Ground stations" value={stations.length} />
          <KeyValue label="Areas of interest" value={aois.length} />
        </Panel>

        <Panel title="Element set health">
          <KeyValue
            label="Stale TLEs (> 14 days)"
            value={
              <span className={staleTles > 0 ? 'text-solar' : 'text-nominal'}>{staleTles}</span>
            }
          />
          <KeyValue
            label="Newest epoch"
            value={
              catalog.length
                ? utc(Math.max(...catalog.map((o) => new Date(o.epoch).getTime())))
                : '—'
            }
          />
          <KeyValue
            label="Oldest epoch"
            value={
              catalog.length
                ? utc(Math.min(...catalog.map((o) => new Date(o.epoch).getTime())))
                : '—'
            }
          />
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
            SGP4 accuracy degrades roughly linearly away from epoch — a few kilometres after a day,
            tens of kilometres after a week. Anything older than two weeks should be refreshed before
            it is trusted for conjunction work.
          </p>
        </Panel>

        <Panel title="Wiring a new source">
          <ol className="space-y-2.5 text-[11px] leading-relaxed text-ink-dim">
            <li className="flex gap-2">
              <Check size={13} className="mt-0.5 shrink-0 text-signal" />
              Implement <code className="font-mono text-signal">DataAdapter</code> in{' '}
              <code className="font-mono text-ink-faint">src/lib/adapters/</code>.
            </li>
            <li className="flex gap-2">
              <Check size={13} className="mt-0.5 shrink-0 text-signal" />
              Register it in <code className="font-mono text-ink-faint">adapters/index.ts</code> — it
              appears here automatically.
            </li>
            <li className="flex gap-2">
              <Check size={13} className="mt-0.5 shrink-0 text-signal" />
              For endpoints without CORS headers, add a dev proxy in{' '}
              <code className="font-mono text-ink-faint">vite.config.ts</code> rather than loosening
              the client.
            </li>
          </ol>
        </Panel>
      </div>
    </div>
  )
}
