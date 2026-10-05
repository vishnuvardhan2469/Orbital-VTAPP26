import { useMemo } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Anomaly, TelemetryChannel, TelemetrySample } from '@/lib/types'
import { utcTime } from '@/lib/util/format'

/**
 * One telemetry channel over time.
 *
 * Three layers, in reading order: the shaded operating band tells you what
 * "normal" means for this channel; the trace tells you what the spacecraft is
 * actually doing; the marks tell you where a detector objected. Anything a
 * detector flagged stays visible even after it scrolls out of the alert list.
 */
export function TelemetryChart({
  channel,
  samples,
  anomalies,
  height = 140,
  compact = false,
}: {
  channel: TelemetryChannel
  samples: TelemetrySample[]
  anomalies: Anomaly[]
  height?: number
  compact?: boolean
}) {
  const data = useMemo(
    () => samples.map((s) => ({ t: s.t, value: s.value })),
    [samples],
  )

  // Give the axis headroom around both the data and the limit band, so an
  // excursion is visible as a gap rather than being clipped at the edge.
  const domain = useMemo(() => {
    if (data.length === 0) return [channel.nominalMin, channel.nominalMax]
    const values = data.map((d) => d.value)
    const low = Math.min(...values, channel.nominalMin)
    const high = Math.max(...values, channel.nominalMax)
    const pad = (high - low) * 0.12 || 1
    return [low - pad, high + pad]
  }, [data, channel])

  const visible = useMemo(() => {
    if (data.length === 0) return []
    const first = data[0].t
    const last = data[data.length - 1].t
    return anomalies.filter((a) => a.channelId === channel.id && a.t >= first && a.t <= last)
  }, [anomalies, channel.id, data])

  const latest = data[data.length - 1]?.value
  const outOfLimits =
    latest !== undefined && (latest < channel.nominalMin || latest > channel.nominalMax)

  return (
    <div>
      {!compact && (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-dim">
            {channel.label}
          </p>
          <p
            className={`font-mono text-xs tabular-nums ${outOfLimits ? 'text-alert' : 'text-ink'}`}
          >
            {latest?.toFixed(2) ?? '—'}
            <span className="ml-1 text-[10px] text-ink-faint">{channel.unit}</span>
          </p>
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`fill-${channel.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="#162034" strokeDasharray="2 4" vertical={false} />

          <ReferenceArea
            y1={channel.nominalMin}
            y2={channel.nominalMax}
            fill="#34d399"
            fillOpacity={0.05}
            stroke="#34d399"
            strokeOpacity={0.18}
            strokeDasharray="3 3"
          />

          <XAxis
            dataKey="t"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(t) => utcTime(t)}
            tick={{ fill: '#5c6b87', fontSize: 9, fontFamily: 'ui-monospace, monospace' }}
            axisLine={{ stroke: '#1c2740' }}
            tickLine={false}
            minTickGap={48}
            hide={compact}
          />
          <YAxis
            domain={domain}
            tick={{ fill: '#5c6b87', fontSize: 9, fontFamily: 'ui-monospace, monospace' }}
            axisLine={false}
            tickLine={false}
            width={compact ? 28 : 40}
            tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(1))}
          />

          <Tooltip
            contentStyle={{
              background: '#0c111d',
              border: '1px solid #1c2740',
              borderRadius: 8,
              fontFamily: 'ui-monospace, monospace',
              fontSize: 11,
            }}
            labelStyle={{ color: '#5c6b87' }}
            labelFormatter={(t) => utcTime(Number(t))}
            formatter={(value) => [`${Number(value).toFixed(3)} ${channel.unit}`, channel.label]}
          />

          <Area
            type="monotone"
            dataKey="value"
            stroke="none"
            fill={`url(#fill-${channel.id})`}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#22d3ee"
            strokeWidth={1.4}
            dot={false}
            isAnimationActive={false}
          />

          {visible.map((anomaly) => (
            <ReferenceDot
              key={anomaly.id}
              x={anomaly.t}
              y={anomaly.value}
              r={3}
              fill={anomaly.severity === 'CRITICAL' ? '#f43f5e' : '#fbbf24'}
              stroke="#05070d"
              strokeWidth={1}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Tiny inline trace with no axes — used in tables and stat rows. */
export function Sparkline({ values, tone = '#22d3ee' }: { values: number[]; tone?: string }) {
  if (values.length < 2) return <div className="h-6" />

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${100 - ((v - min) / span) * 100}`)
    .join(' ')

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-6 w-full" aria-hidden>
      <polyline points={points} fill="none" stroke={tone} strokeWidth={3} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
