import { useEffect, useMemo, useRef, useState } from 'react'
import { Zap, TrendingUp, Ban, Trash2 } from 'lucide-react'
import { TelemetryChart } from '@/components/charts/TelemetryChart'
import { ObjectList } from '@/components/ui/ObjectList'
import { Badge, Button, EmptyState, PageHeader, Panel, Segmented } from '@/components/ui/primitives'
import { orbitalPeriodMin } from '@/lib/orbit/propagate'
import { METHOD_LABELS } from '@/lib/telemetry/anomaly'
import { CHANNELS } from '@/lib/telemetry/stream'
import { useTelemetryStream } from '@/lib/telemetry/useTelemetry'
import type { Anomaly, TelemetryChannel } from '@/lib/types'
import { utcTime } from '@/lib/util/format'
import { useFilteredCatalog, useSelectedObject, useStore } from '@/state/store'

type Subsystem = TelemetryChannel['subsystem'] | 'ALL'

const SUBSYSTEMS: Subsystem[] = ['ALL', 'POWER', 'THERMAL', 'ADCS', 'COMMS', 'PAYLOAD']

/**
 * Telemetry console.
 *
 * Housekeeping channels stream in at 1 Hz and every sample passes through the
 * detector stack in `lib/telemetry/anomaly.ts` before it is drawn. The fault
 * injection controls exist so the detectors can be demonstrated on demand
 * rather than waiting for the simulation to misbehave on its own.
 */
export function TelemetryPage() {
  const [subsystem, setSubsystem] = useState<Subsystem>('ALL')

  const catalog = useFilteredCatalog()
  const states = useStore((s) => s.states)
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)
  const selected = useSelectedObject()
  const playing = useStore((s) => s.playing)
  const simTime = useStore((s) => s.simTime)
  const pushAlert = useStore((s) => s.pushAlert)
  const recordAnomalies = useStore((s) => s.recordAnomalies)

  // The 1 Hz sampling loop reads mission time through a ref so it is not torn
  // down and restarted on every clock tick.
  const simTimeRef = useRef(simTime)
  useEffect(() => {
    simTimeRef.current = simTime
  })

  const period = selected ? orbitalPeriodMin(selected) : 95

  const onAnomalies = useMemo(
    () => (found: Anomaly[]) => {
      recordAnomalies(found)

      // Only the most severe finding per batch becomes an operator alert;
      // four detectors firing on one sample is one event, not four.
      const worst = found.find((a) => a.severity === 'CRITICAL') ?? found[0]
      if (!worst || !selected) return
      pushAlert({
        t: worst.t,
        severity: worst.severity,
        source: 'TELEMETRY',
        title: `${selected.name} · ${CHANNELS.find((c) => c.id === worst.channelId)?.label ?? worst.channelId}`,
        detail: worst.explanation,
        noradId: worst.noradId,
      })
    },
    [selected?.noradId, pushAlert, recordAnomalies],
  )

  const stream = useTelemetryStream(selectedId, period, playing, simTimeRef, onAnomalies)

  const channels = useMemo(
    () => (subsystem === 'ALL' ? CHANNELS : CHANNELS.filter((c) => c.subsystem === subsystem)),
    [subsystem],
  )

  const outOfLimits = useMemo(
    () =>
      CHANNELS.filter((channel) => {
        const value = stream.latest[channel.id]
        return value !== undefined && (value < channel.nominalMin || value > channel.nominalMax)
      }),
    [stream.latest],
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader
        title="Telemetry & Anomaly Detection"
        description="Housekeeping channels at 1 Hz, screened by four independent online detectors: limit checks, rolling z-score, EWMA forecast residual and rate of change."
        actions={
          <Segmented
            size="sm"
            value={subsystem}
            onChange={setSubsystem}
            options={SUBSYSTEMS.map((s) => ({ value: s, label: s }))}
          />
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ── Spacecraft picker ───────────────────────────────────── */}
        <Panel title="Spacecraft" className="lg:col-span-3 min-h-[30rem]" dense>
          <ObjectList
            objects={catalog}
            states={states}
            selectedId={selectedId}
            onSelect={select}
            showFilters={false}
          />
        </Panel>

        {/* ── Channels ────────────────────────────────────────────── */}
        <Panel
          className="lg:col-span-6 min-h-[30rem]"
          title={selected ? `${selected.name} · housekeeping` : 'Housekeeping'}
          subtitle={
            outOfLimits.length > 0
              ? `${outOfLimits.length} channel${outOfLimits.length > 1 ? 's' : ''} out of limits`
              : 'All channels within their operating bands'
          }
          actions={
            outOfLimits.length > 0 ? (
              <Badge tone="CRITICAL">out of limits</Badge>
            ) : (
              <Badge tone="NOMINAL">nominal</Badge>
            )
          }
          bodyClassName="overflow-y-auto"
        >
          {!selected ? (
            <EmptyState title="No spacecraft selected" detail="Pick a spacecraft to stream its housekeeping telemetry." />
          ) : (
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 2xl:grid-cols-2">
              {channels.map((channel) => (
                <TelemetryChart
                  key={channel.id}
                  channel={channel}
                  samples={stream.series[channel.id] ?? []}
                  anomalies={stream.anomalies}
                  height={126}
                />
              ))}
            </div>
          )}
        </Panel>

        {/* ── Detections and controls ─────────────────────────────── */}
        <div className="lg:col-span-3 flex min-h-0 flex-col gap-4">
          <Panel
            title="Fault injection"
            subtitle="Drive a channel out of family to exercise the detectors."
          >
            <FaultControls
              disabled={!selected}
              onInject={stream.injectFault}
              onClear={stream.clearFaults}
            />
          </Panel>

          <Panel
            title={`Detections · ${stream.anomalies.length}`}
            className="min-h-0 flex-1"
            bodyClassName="overflow-y-auto"
            dense
          >
            {stream.anomalies.length === 0 ? (
              <EmptyState
                title="Nothing flagged"
                detail="Detectors are running. Inject a fault to see one fire."
              />
            ) : (
              <ul className="divide-y divide-line-soft">
                {stream.anomalies.slice(0, 40).map((anomaly) => (
                  <li key={anomaly.id} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone={anomaly.severity}>{METHOD_LABELS[anomaly.method]}</Badge>
                      <span className="font-mono text-[10px] text-ink-faint">{utcTime(anomaly.t)}</span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-snug text-ink-dim">{anomaly.explanation}</p>
                    <p className="mt-1 font-mono text-[10px] text-ink-faint">
                      score {anomaly.score.toFixed(2)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}

function FaultControls({
  disabled,
  onInject,
  onClear,
}: {
  disabled: boolean
  onInject: (channelId: string, kind: 'SPIKE' | 'DRIFT' | 'STUCK' | 'DROPOUT') => void
  onClear: () => void
}) {
  const [channelId, setChannelId] = useState(CHANNELS[0].id)
  const [injected, setInjected] = useState<string | null>(null)

  // Clear the confirmation chip on its own so the panel does not stay "armed"
  // looking after the fault has already played out.
  useEffect(() => {
    if (!injected) return
    const timer = setTimeout(() => setInjected(null), 2500)
    return () => clearTimeout(timer)
  }, [injected])

  const inject = (kind: 'SPIKE' | 'DRIFT' | 'STUCK' | 'DROPOUT') => {
    onInject(channelId, kind)
    setInjected(kind)
  }

  return (
    <div className="space-y-2.5">
      <select
        value={channelId}
        onChange={(e) => setChannelId(e.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-line bg-deep px-2 py-1.5 font-mono text-[11px] text-ink-dim outline-none disabled:opacity-40"
      >
        {CHANNELS.map((channel) => (
          <option key={channel.id} value={channel.id}>
            {channel.label} ({channel.unit})
          </option>
        ))}
      </select>

      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" onClick={() => inject('SPIKE')} disabled={disabled}>
          <Zap size={11} /> Spike
        </Button>
        <Button size="sm" onClick={() => inject('DRIFT')} disabled={disabled}>
          <TrendingUp size={11} /> Drift
        </Button>
        <Button size="sm" onClick={() => inject('STUCK')} disabled={disabled}>
          <Ban size={11} /> Stuck
        </Button>
        <Button size="sm" variant="danger" onClick={() => inject('DROPOUT')} disabled={disabled}>
          <Zap size={11} /> Dropout
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <Button size="sm" onClick={onClear} disabled={disabled}>
          <Trash2 size={11} /> Clear faults
        </Button>
        {injected && <Badge tone="WARNING">{injected.toLowerCase()} armed</Badge>}
      </div>
    </div>
  )
}
