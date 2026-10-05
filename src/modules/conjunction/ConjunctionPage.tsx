import { useEffect, useMemo, useState } from 'react'
import { Play, RefreshCw } from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  KeyValue,
  Loading,
  PageHeader,
  Panel,
  StatTile,
} from '@/components/ui/primitives'
import { DEFAULT_SCREEN_OPTIONS, screenConjunctions } from '@/lib/orbit/conjunction'
import { propagateAt } from '@/lib/orbit/propagate'
import { countdown, km, utc } from '@/lib/util/format'
import type { ConjunctionEvent } from '@/lib/types'
import { useStore } from '@/state/store'

/**
 * Collision-risk console.
 *
 * Screening runs in the browser on demand rather than on the clock: it is the
 * heaviest computation in the app, and a conjunction picture that silently
 * changes underneath an operator is worse than one they refresh deliberately.
 */
export function ConjunctionPage() {
  const catalog = useStore((s) => s.catalog)
  const simTime = useStore((s) => s.simTime)
  const conjunctions = useStore((s) => s.conjunctions)
  const setConjunctions = useStore((s) => s.setConjunctions)
  const pushAlert = useStore((s) => s.pushAlert)
  const select = useStore((s) => s.select)

  const [running, setRunning] = useState(false)
  const [horizonHours, setHorizonHours] = useState(DEFAULT_SCREEN_OPTIONS.horizonHours)
  const [reportKm, setReportKm] = useState(DEFAULT_SCREEN_OPTIONS.reportKm)
  const [lastRun, setLastRun] = useState<{ at: number; ms: number; pairs: number } | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null)

  const names = useMemo(
    () => new Map(catalog.map((o) => [o.noradId, o.name])),
    [catalog],
  )

  const run = () => {
    if (catalog.length === 0) return
    setRunning(true)

    // Yield a frame first so the button's pressed state actually paints before
    // the main thread is blocked by the screening pass.
    requestAnimationFrame(() => {
      const startedAt = performance.now()
      const events = screenConjunctions(catalog, new Date(simTime), {
        horizonHours,
        reportKm,
        coarseKm: Math.max(reportKm * 4, 200),
      })
      const elapsed = performance.now() - startedAt

      setConjunctions(events)
      setLastRun({
        at: Date.now(),
        ms: elapsed,
        pairs: (catalog.length * (catalog.length - 1)) / 2,
      })
      setRunning(false)

      for (const event of events.filter((e) => e.severity === 'CRITICAL')) {
        pushAlert({
          t: event.tca,
          severity: 'CRITICAL',
          source: 'CONJUNCTION',
          title: `Close approach · ${names.get(event.primary) ?? event.primary}`,
          detail:
            `Miss distance ${event.missDistanceKm.toFixed(2)} km against ` +
            `${names.get(event.secondary) ?? event.secondary} at ${utc(event.tca)}.`,
          noradId: event.primary,
        })
      }
    })
  }

  // Screen once when the catalog first arrives so the page is never empty on
  // arrival, then leave refreshes to the operator.
  useEffect(() => {
    if (catalog.length > 0 && conjunctions.length === 0 && !lastRun) run()
  }, [catalog.length])

  const active = conjunctions.find((c) => c.id === selectedEvent) ?? conjunctions[0] ?? null

  const criticalCount = conjunctions.filter((c) => c.severity === 'CRITICAL').length
  const warningCount = conjunctions.filter((c) => c.severity === 'WARNING').length
  const tightest = conjunctions.reduce<ConjunctionEvent | null>(
    (best, e) => (!best || e.missDistanceKm < best.missDistanceKm ? e : best),
    null,
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader
        title="Collision Risk"
        description="Two-stage close-approach screening: a coarse ephemeris grid across the whole catalog, then ternary refinement of each candidate to find the true time of closest approach."
        actions={
          <Button variant="primary" onClick={run} disabled={running || catalog.length === 0}>
            {running ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}
            {running ? 'Screening' : 'Run screening'}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Critical"
          value={criticalCount}
          tone={criticalCount > 0 ? 'CRITICAL' : undefined}
          hint="< 1 km or Pc > 1e-4"
        />
        <StatTile
          label="Warning"
          value={warningCount}
          tone={warningCount > 0 ? 'WARNING' : undefined}
          hint="< 10 km or Pc > 1e-6"
        />
        <StatTile
          label="Tightest miss"
          value={tightest ? tightest.missDistanceKm.toFixed(2) : '—'}
          unit={tightest ? 'km' : undefined}
          hint={tightest ? `TCA ${utc(tightest.tca)}` : 'No events screened'}
        />
        <StatTile
          label="Screening cost"
          value={lastRun ? lastRun.ms.toFixed(0) : '—'}
          unit={lastRun ? 'ms' : undefined}
          hint={lastRun ? `${lastRun.pairs} pairs over ${horizonHours} h` : 'Not yet run'}
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-12 gap-4">
        <Panel
          title={`Screened events · ${conjunctions.length}`}
          className="lg:col-span-8 min-h-[24rem]"
          bodyClassName="overflow-auto"
          dense
        >
          {running ? (
            <Loading label="Screening catalog" />
          ) : conjunctions.length === 0 ? (
            <EmptyState
              title="No close approaches"
              detail={`Nothing came within ${reportKm} km over the next ${horizonHours} hours. Widen the screening volume to see more.`}
            />
          ) : (
            <table className="w-full min-w-[42rem] text-left">
              <thead className="sticky top-0 bg-panel">
                <tr className="border-b border-line font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
                  <th className="px-3 py-2 font-medium">Primary</th>
                  <th className="px-3 py-2 font-medium">Secondary</th>
                  <th className="px-3 py-2 text-right font-medium">TCA</th>
                  <th className="px-3 py-2 text-right font-medium">Miss</th>
                  <th className="px-3 py-2 text-right font-medium">Rel. speed</th>
                  <th className="px-3 py-2 text-right font-medium">Pc</th>
                </tr>
              </thead>
              <tbody>
                {conjunctions.map((event) => (
                  <tr
                    key={event.id}
                    onClick={() => setSelectedEvent(event.id)}
                    className={`cursor-pointer border-b border-line-soft/60 text-[11px] transition-colors ${
                      active?.id === event.id ? 'bg-signal/10' : 'hover:bg-raised/50'
                    }`}
                  >
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <Badge tone={event.severity}>{event.severity[0]}</Badge>
                        <span className="truncate text-ink">{names.get(event.primary) ?? event.primary}</span>
                      </span>
                    </td>
                    <td className="truncate px-3 py-2 text-ink-dim">
                      {names.get(event.secondary) ?? event.secondary}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-dim">
                      {countdown(event.tca - simTime)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
                        event.missDistanceKm < 1 ? 'text-alert' : 'text-ink'
                      }`}
                    >
                      {event.missDistanceKm.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-dim">
                      {event.relativeSpeedKmS.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-faint">
                      {event.probability < 1e-12 ? '<1e-12' : event.probability.toExponential(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <div className="lg:col-span-4 flex min-h-0 flex-col gap-4">
          <Panel title="Screening volume">
            <div className="space-y-4">
              <Slider
                label="Horizon"
                value={horizonHours}
                min={6}
                max={72}
                step={6}
                unit="h"
                onChange={setHorizonHours}
              />
              <Slider
                label="Report threshold"
                value={reportKm}
                min={5}
                max={200}
                step={5}
                unit="km"
                onChange={setReportKm}
              />
              <p className="text-[11px] leading-relaxed text-ink-faint">
                A wider threshold surfaces more encounters but costs more to refine. Real operations
                screen a box around the primary, typically ±1 km radial by ±25 km along-track.
              </p>
            </div>
          </Panel>

          <Panel title="Event detail" className="min-h-0 flex-1">
            {!active ? (
              <EmptyState title="No event selected" />
            ) : (
              <EventDetail event={active} names={names} simTime={simTime} onSelectObject={select} />
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}

function EventDetail({
  event,
  names,
  simTime,
  onSelectObject,
}: {
  event: ConjunctionEvent
  names: Map<number, string>
  simTime: number
  onSelectObject: (id: number) => void
}) {
  const catalog = useStore((s) => s.catalog)

  // Separation at TCA broken into its radial/along-track components is what an
  // operator actually manoeuvres against.
  const geometry = useMemo(() => {
    const primary = catalog.find((o) => o.noradId === event.primary)
    const secondary = catalog.find((o) => o.noradId === event.secondary)
    if (!primary || !secondary) return null

    const a = propagateAt(primary, new Date(event.tca))
    const b = propagateAt(secondary, new Date(event.tca))
    if (!a || !b) return null

    return {
      radialKm: Math.abs(a.altKm - b.altKm),
      primaryAlt: a.altKm,
      secondaryAlt: b.altKm,
      lat: a.lat,
      lon: a.lon,
    }
  }, [catalog, event])

  return (
    <div className="space-y-3">
      <div>
        <Badge tone={event.severity}>{event.severity}</Badge>
        <p className="mt-2 text-sm text-ink">
          {names.get(event.primary) ?? event.primary}
        </p>
        <p className="font-mono text-[10px] text-ink-faint">
          against {names.get(event.secondary) ?? event.secondary}
        </p>
      </div>

      <div className="rounded-lg border border-line bg-raised/40 px-3 py-2">
        <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
          Time to closest approach
        </p>
        <p className="mt-1 font-mono text-lg leading-none tabular-nums text-solar">
          {countdown(event.tca - simTime)}
        </p>
        <p className="mt-1 font-mono text-[10px] text-ink-faint">{utc(event.tca)}</p>
      </div>

      <div className="border-t border-line-soft pt-1">
        <KeyValue label="Miss distance" value={km(event.missDistanceKm, 3)} />
        <KeyValue label="Relative speed" value={`${event.relativeSpeedKmS.toFixed(3)} km/s`} />
        <KeyValue label="Collision probability" value={event.probability.toExponential(2)} />
        {geometry && (
          <>
            <KeyValue label="Radial separation" value={km(geometry.radialKm, 2)} />
            <KeyValue label="Primary altitude" value={km(geometry.primaryAlt, 1)} />
            <KeyValue label="Secondary altitude" value={km(geometry.secondaryAlt, 1)} />
          </>
        )}
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSelectObject(event.primary)}>
          Track primary
        </Button>
        <Button size="sm" onClick={() => onSelectObject(event.secondary)}>
          Track secondary
        </Button>
      </div>

      <p className="border-t border-line-soft pt-2 text-[10px] leading-relaxed text-ink-faint">
        Probability is a screening heuristic over miss distance and a fixed position uncertainty.
        An operational Pc needs the covariance that TLEs do not carry — treat this figure as a
        ranking, not a flight-safety number.
      </p>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (value: number) => void
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">{label}</span>
        <span className="font-mono text-xs tabular-nums text-ink">
          {value}
          <span className="ml-0.5 text-ink-faint">{unit}</span>
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-[#22d3ee]"
      />
    </label>
  )
}
