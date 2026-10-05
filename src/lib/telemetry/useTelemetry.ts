import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnomalyDetector, type DetectorConfig } from './anomaly'
import { CHANNELS, TelemetrySimulator, type FaultInjection } from './stream'
import type { Anomaly, TelemetrySample } from '@/lib/types'

/**
 * Live telemetry stream for one spacecraft.
 *
 * Samples arrive on a real-time interval but are stamped with mission time, so
 * a paused clock freezes the trace and a fast clock stretches the same window
 * over more orbit. Buffers are ring-limited: an operator console has to be able
 * to run for hours without growing without bound.
 */

const BUFFER_SIZE = 240
const SAMPLE_INTERVAL_MS = 1000

export interface TelemetryStream {
  /** Latest samples per channel, oldest first. */
  series: Record<string, TelemetrySample[]>
  /** Anomalies raised in this session, newest first. */
  anomalies: Anomaly[]
  /** Most recent value per channel. */
  latest: Record<string, number>
  injectFault: (channelId: string, kind: FaultInjection['kind']) => void
  clearFaults: () => void
  setDetectorConfig: (config: Partial<DetectorConfig>) => void
  detectorConfig: DetectorConfig
}

export function useTelemetryStream(
  noradId: number | null,
  orbitalPeriodMin: number,
  running: boolean,
  simTimeRef: { current: number },
  onAnomalies?: (anomalies: Anomaly[]) => void,
): TelemetryStream {
  const [series, setSeries] = useState<Record<string, TelemetrySample[]>>({})
  const [anomalies, setAnomalies] = useState<Anomaly[]>([])
  const [detectorConfig, setDetectorConfigState] = useState<DetectorConfig>(() =>
    new AnomalyDetector().getConfig(),
  )

  const simulatorRef = useRef<TelemetrySimulator | null>(null)
  const detectorRef = useRef<AnomalyDetector | null>(null)
  const onAnomaliesRef = useRef(onAnomalies)
  onAnomaliesRef.current = onAnomalies

  // ── Rebuild the stream whenever the spacecraft changes ────────────────
  useEffect(() => {
    if (noradId === null) return

    const simulator = new TelemetrySimulator(noradId, orbitalPeriodMin, noradId)
    const detector = new AnomalyDetector(detectorConfig)
    simulatorRef.current = simulator
    detectorRef.current = detector

    // Backfill so the charts open with a full window rather than one point.
    const now = simTimeRef.current
    const seeded: Record<string, TelemetrySample[]> = {}
    for (const channel of CHANNELS) {
      const history = simulator.history(channel.id, BUFFER_SIZE, SAMPLE_INTERVAL_MS, now)
      // Warm the detector on the backfill without reporting it: those anomalies
      // are historical and would flood the log the instant a craft is selected.
      for (const sample of history) detector.push(noradId, channel, sample)
      seeded[channel.id] = history
    }
    setSeries(seeded)
    setAnomalies([])

    return () => {
      simulatorRef.current = null
      detectorRef.current = null
    }
  }, [noradId, orbitalPeriodMin])

  // ── Sampling loop ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!running || noradId === null) return

    const interval = setInterval(() => {
      const simulator = simulatorRef.current
      const detector = detectorRef.current
      if (!simulator || !detector) return

      const t = simTimeRef.current
      const samples = simulator.sampleAll(t)
      const found: Anomaly[] = []

      for (const channel of CHANNELS) {
        const sample = samples.find((s) => s.channelId === channel.id)
        if (sample) found.push(...detector.push(noradId, channel, sample))
      }

      setSeries((previous) => {
        const next: Record<string, TelemetrySample[]> = {}
        for (const sample of samples) {
          const buffer = previous[sample.channelId] ?? []
          next[sample.channelId] =
            buffer.length >= BUFFER_SIZE
              ? [...buffer.slice(buffer.length - BUFFER_SIZE + 1), sample]
              : [...buffer, sample]
        }
        return next
      })

      if (found.length > 0) {
        setAnomalies((previous) => [...found, ...previous].slice(0, 100))
        onAnomaliesRef.current?.(found)
      }
    }, SAMPLE_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [running, noradId, simTimeRef])

  const latest = useMemo(() => {
    const out: Record<string, number> = {}
    for (const [channelId, samples] of Object.entries(series)) {
      const last = samples[samples.length - 1]
      if (last) out[channelId] = last.value
    }
    return out
  }, [series])

  const injectFault = useCallback((channelId: string, kind: FaultInjection['kind']) => {
    simulatorRef.current?.scheduleFault(channelId, kind, 500)
  }, [])

  const clearFaults = useCallback(() => {
    simulatorRef.current?.clearFaults()
  }, [])

  const setDetectorConfig = useCallback((config: Partial<DetectorConfig>) => {
    detectorRef.current?.setConfig(config)
    setDetectorConfigState((previous) => ({ ...previous, ...config }))
  }, [])

  return { series, anomalies, latest, injectFault, clearFaults, setDetectorConfig, detectorConfig }
}
