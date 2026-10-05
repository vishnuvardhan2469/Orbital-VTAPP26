import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { Globe3D } from '@/components/globe/Globe3D'
import {
  Badge,
  EmptyState,
  Loading,
  PageHeader,
  Panel,
  StatTile,
  StatusDot,
} from '@/components/ui/primitives'
import { predictPasses } from '@/lib/orbit/propagate'
import { countdown, duration, relativeTime, utcTime } from '@/lib/util/format'
import { useFleetHealth, useUnacknowledgedAlerts, useStore } from '@/state/store'

/**
 * Mission control overview.
 *
 * The question this page answers is "is anything wrong, and what happens next?"
 * — fleet health, the next ground contacts, and the highest-severity events
 * from every other module, without needing to visit them.
 */
export function OverviewPage() {
  const catalog = useStore((s) => s.catalog)
  const states = useStore((s) => s.states)
  const stations = useStore((s) => s.stations)
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)
  const simTime = useStore((s) => s.simTime)
  const alerts = useStore((s) => s.alerts)
  const unacknowledged = useUnacknowledgedAlerts()
  const conjunctions = useStore((s) => s.conjunctions)
  const anomalies = useStore((s) => s.anomalies)
  const health = useFleetHealth()
  const loading = useStore((s) => s.catalog.length === 0)

  /**
   * The next contact for each of the busiest stations. Full 24 h prediction for
   * every object × every station would be thousands of SGP4 calls, so this
   * looks two hours ahead across a bounded slice of the catalog and refreshes
   * every five minutes of mission time.
   */
  const contactBucket = Math.floor(simTime / 300_000)

  const upcoming = useMemo(() => {
    const watched = catalog.filter((o) => o.type === 'PAYLOAD').slice(0, 10)
    const rows: Array<{ name: string; station: string; aos: number; durationSec: number; maxEl: number }> = []

    for (const station of stations.slice(0, 4)) {
      for (const obj of watched) {
        const pass = predictPasses(obj, station, new Date(simTime), 2, 60)[0]
        if (pass) {
          rows.push({
            name: obj.name,
            station: station.name,
            aos: pass.aos,
            durationSec: pass.durationSec,
            maxEl: pass.maxElevationDeg,
          })
        }
      }
    }
    return rows.sort((a, b) => a.aos - b.aos).slice(0, 7)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bucketed on purpose
  }, [catalog, stations, contactBucket])

  const sunlit = Object.values(states).filter((s) => s.sunlit).length
  const criticalConjunctions = conjunctions.filter((c) => c.severity === 'CRITICAL')
  const topAlerts = alerts.filter((a) => a.severity !== 'INFO').slice(0, 6)

  if (loading) {
    return (
      <Panel className="h-[70vh]">
        <Loading label="Acquiring catalog" />
      </Panel>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Mission Control"
        description="Fleet status, upcoming ground contacts and the current threat picture across every module."
      />

      {/* ── Top-line numbers ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="Tracked objects"
          value={catalog.length}
          hint={`${catalog.filter((o) => o.type === 'PAYLOAD').length} payloads · ${catalog.filter((o) => o.type !== 'PAYLOAD').length} debris`}
        />
        <StatTile
          label="Fleet health"
          value={health.counts.NOMINAL}
          unit={`/ ${health.total}`}
          tone={health.worst === 'CRITICAL' ? 'CRITICAL' : health.worst === 'WARNING' ? 'WARNING' : undefined}
          hint={`${health.counts.CAUTION} caution · ${health.counts.CRITICAL} critical`}
        />
        <StatTile
          label="In sunlight"
          value={sunlit}
          unit={`/ ${Object.keys(states).length}`}
          hint="Rest are in eclipse"
        />
        <StatTile
          label="Open alerts"
          value={unacknowledged.length}
          tone={unacknowledged.length > 0 ? 'WARNING' : undefined}
          hint={`${anomalies.length} telemetry detections logged`}
        />
        <StatTile
          label="Critical conjunctions"
          value={criticalConjunctions.length}
          tone={criticalConjunctions.length > 0 ? 'CRITICAL' : undefined}
          hint={
            criticalConjunctions[0]
              ? `Closest ${criticalConjunctions[0].missDistanceKm.toFixed(2)} km`
              : 'Nothing inside 1 km'
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* ── Globe ───────────────────────────────────────────────── */}
        <Panel
          title="Live constellation"
          subtitle="Earth-centred inertial · dimmed objects are in eclipse"
          className="lg:col-span-7 h-[26rem]"
          actions={
            <Link
              to="/tracking"
              className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-signal hover:underline"
            >
              Open tracker <ArrowUpRight size={11} />
            </Link>
          }
          dense
        >
          <Globe3D
            objects={catalog}
            states={states}
            stations={stations}
            selectedId={selectedId}
            simTime={simTime}
            onSelect={select}
          />
        </Panel>

        {/* ── Contacts ────────────────────────────────────────────── */}
        <Panel
          title="Next ground contacts"
          subtitle="Two-hour look-ahead across the primary stations"
          className="lg:col-span-5 h-[26rem]"
          bodyClassName="overflow-y-auto"
          dense
        >
          {upcoming.length === 0 ? (
            <EmptyState title="No contacts in the next two hours" />
          ) : (
            <ul className="divide-y divide-line-soft">
              {upcoming.map((row) => {
                const inProgress = row.aos <= simTime
                return (
                  <li key={`${row.name}-${row.station}-${row.aos}`} className="px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-[12px] text-ink">{row.name}</p>
                      <span
                        className={`font-mono text-[11px] tabular-nums ${
                          inProgress ? 'text-nominal' : 'text-signal'
                        }`}
                      >
                        {inProgress ? 'in contact' : countdown(row.aos - simTime)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-baseline justify-between gap-2">
                      <p className="truncate font-mono text-[10px] text-ink-faint">{row.station}</p>
                      <span className="font-mono text-[10px] text-ink-faint">
                        {utcTime(row.aos)} · {duration(row.durationSec)} · {row.maxEl.toFixed(0)}°
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        {/* ── Fleet board ─────────────────────────────────────────── */}
        <Panel
          title="Fleet"
          subtitle="Health by spacecraft"
          className="lg:col-span-7"
          bodyClassName="max-h-72 overflow-auto"
          dense
        >
          <table className="w-full min-w-[34rem] text-left">
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-line font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
                <th className="px-4 py-2 font-medium">Spacecraft</th>
                <th className="px-3 py-2 font-medium">Agency</th>
                <th className="px-3 py-2 text-right font-medium">Altitude</th>
                <th className="px-3 py-2 text-right font-medium">Speed</th>
                <th className="px-4 py-2 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {catalog
                .filter((o) => o.type === 'PAYLOAD')
                .map((obj) => {
                  const state = states[obj.noradId]
                  return (
                    <tr
                      key={obj.noradId}
                      onClick={() => select(obj.noradId)}
                      className={`cursor-pointer border-b border-line-soft/60 text-[11px] transition-colors ${
                        obj.noradId === selectedId ? 'bg-signal/10' : 'hover:bg-raised/50'
                      }`}
                    >
                      <td className="px-4 py-1.5">
                        <span className="flex items-center gap-2">
                          <StatusDot tone={obj.health} pulse={obj.health === 'CRITICAL'} />
                          <span className="truncate text-ink">{obj.name}</span>
                        </span>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[10px] text-ink-faint">{obj.agency}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-dim">
                        {state ? state.altKm.toFixed(0) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-dim">
                        {state ? state.speedKmS.toFixed(2) : '—'}
                      </td>
                      <td className="px-4 py-1.5 text-right">
                        <Badge tone={obj.health}>{obj.health}</Badge>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </Panel>

        {/* ── Recent events ───────────────────────────────────────── */}
        <Panel
          title="Recent events"
          className="lg:col-span-5"
          actions={
            <Link
              to="/alerts"
              className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-signal hover:underline"
            >
              Full feed <ArrowUpRight size={11} />
            </Link>
          }
          bodyClassName="max-h-72 overflow-y-auto"
          dense
        >
          {topAlerts.length === 0 ? (
            <EmptyState
              title="Nothing to report"
              detail="Warnings and critical events from every module surface here."
            />
          ) : (
            <ul className="divide-y divide-line-soft">
              {topAlerts.map((alert) => (
                <li key={alert.id} className="px-4 py-2.5">
                  <div className="flex items-start gap-2">
                    <Badge tone={alert.severity}>{alert.severity}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] text-ink">{alert.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-ink-dim">
                        {alert.detail}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-ink-faint">
                        {relativeTime(alert.t)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}
