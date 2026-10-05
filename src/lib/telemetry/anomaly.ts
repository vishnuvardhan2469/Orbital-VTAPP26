import type { Anomaly, AnomalyMethod, Severity, TelemetryChannel, TelemetrySample } from '@/lib/types'
import { mean, stdDev } from '@/lib/util/math'

/**
 * Streaming anomaly detection for spacecraft telemetry.
 *
 * Four independent detectors run over every channel. They are deliberately
 * cheap and online (O(1) per sample amortised) so the whole fleet can be
 * screened in the browser at 1 Hz:
 *
 *   OUT_OF_LIMITS  — the sample violates a published red/yellow limit.
 *   Z_SCORE        — the sample is far from the rolling mean of the window.
 *   EWMA_RESIDUAL  — the sample departs from an exponentially-weighted
 *                    forecast; catches slow drifts a z-score absorbs.
 *   RATE_OF_CHANGE — the sample jumps faster than the channel physically can.
 *
 * Swap or extend these once the problem statement names its detection target;
 * the rest of the app only consumes the `Anomaly[]` they emit.
 */

export interface DetectorConfig {
  /** Samples retained per channel for rolling statistics. */
  windowSize: number
  /** |z| above this is reported. 3.0 ≈ 0.3% false-positive rate on clean noise. */
  zThreshold: number
  /** EWMA smoothing factor; lower reacts slower but rejects more noise. */
  ewmaAlpha: number
  /** Residual (in rolling sigmas) above which the EWMA detector fires. */
  ewmaThreshold: number
  /** Multiple of the observed typical step that counts as a jump. */
  rocThreshold: number
  /** Samples to observe before any statistical detector is trusted. */
  warmup: number
}

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  windowSize: 120,
  zThreshold: 3.0,
  ewmaAlpha: 0.2,
  ewmaThreshold: 3.5,
  rocThreshold: 6.0,
  warmup: 20,
}

interface ChannelStats {
  window: number[]
  ewma: number | null
  lastValue: number | null
  stepWindow: number[]
  seen: number
}

let anomalySeq = 0

export class AnomalyDetector {
  private stats = new Map<string, ChannelStats>()
  private config: DetectorConfig

  constructor(config: Partial<DetectorConfig> = {}) {
    this.config = { ...DEFAULT_DETECTOR_CONFIG, ...config }
  }

  setConfig(config: Partial<DetectorConfig>) {
    this.config = { ...this.config, ...config }
  }

  getConfig(): DetectorConfig {
    return { ...this.config }
  }

  reset() {
    this.stats.clear()
  }

  /** Key on satellite + channel so the same channel on two craft stays separate. */
  private key(noradId: number, channelId: string) {
    return `${noradId}:${channelId}`
  }

  private statsFor(key: string): ChannelStats {
    let s = this.stats.get(key)
    if (!s) {
      s = { window: [], ewma: null, lastValue: null, stepWindow: [], seen: 0 }
      this.stats.set(key, s)
    }
    return s
  }

  /**
   * Feed one sample. Returns every anomaly the sample triggered — a single
   * reading can violate more than one detector, which is itself a useful
   * confidence signal for the operator.
   */
  push(noradId: number, channel: TelemetryChannel, sample: TelemetrySample): Anomaly[] {
    const cfg = this.config
    const s = this.statsFor(this.key(noradId, channel.id))
    const found: Anomaly[] = []
    const v = sample.value

    // ── 1. Hard limits ────────────────────────────────────────────────
    if (v < channel.nominalMin || v > channel.nominalMax) {
      const span = channel.nominalMax - channel.nominalMin || 1
      const excess = v < channel.nominalMin ? channel.nominalMin - v : v - channel.nominalMax
      found.push(
        this.make(noradId, channel, sample, 'OUT_OF_LIMITS', excess / span,
          excess / span > 0.15 ? 'CRITICAL' : 'WARNING',
          `${channel.label} at ${v.toFixed(2)} ${channel.unit} is outside the ` +
          `${channel.nominalMin}–${channel.nominalMax} ${channel.unit} operating band.`),
      )
    }

    // Statistical detectors need history before they mean anything.
    if (s.seen >= cfg.warmup) {
      const mu = mean(s.window)
      const sigma = stdDev(s.window, mu)

      // ── 2. Rolling z-score ──────────────────────────────────────────
      if (sigma > 1e-9) {
        const z = Math.abs(v - mu) / sigma
        if (z > cfg.zThreshold) {
          found.push(
            this.make(noradId, channel, sample, 'Z_SCORE', z,
              z > cfg.zThreshold * 1.8 ? 'CRITICAL' : 'WARNING',
              `${v.toFixed(2)} ${channel.unit} sits ${z.toFixed(1)}σ from the ` +
              `${cfg.windowSize}-sample rolling mean of ${mu.toFixed(2)}.`),
          )
        }
      }

      // ── 3. EWMA forecast residual ───────────────────────────────────
      if (s.ewma !== null && sigma > 1e-9) {
        const residual = Math.abs(v - s.ewma) / sigma
        if (residual > cfg.ewmaThreshold) {
          found.push(
            this.make(noradId, channel, sample, 'EWMA_RESIDUAL', residual, 'WARNING',
              `Reading departs from its EWMA forecast of ${s.ewma.toFixed(2)} ` +
              `${channel.unit} by ${residual.toFixed(1)}σ — consistent with a drift.`),
          )
        }
      }

      // ── 4. Rate of change ───────────────────────────────────────────
      if (s.lastValue !== null && s.stepWindow.length >= cfg.warmup) {
        const step = Math.abs(v - s.lastValue)
        const typical = mean(s.stepWindow)
        if (typical > 1e-9 && step > typical * cfg.rocThreshold) {
          found.push(
            this.make(noradId, channel, sample, 'RATE_OF_CHANGE', step / typical, 'CRITICAL',
              `Step of ${step.toFixed(2)} ${channel.unit} between samples is ` +
              `${(step / typical).toFixed(0)}× the channel's typical ${typical.toFixed(3)}.`),
          )
        }
      }
    }

    // ── Update state ─────────────────────────────────────────────────
    // Anomalous readings still update the window: excluding them would let a
    // genuine regime change (e.g. a commanded mode switch) alarm forever.
    s.window.push(v)
    if (s.window.length > cfg.windowSize) s.window.shift()

    if (s.lastValue !== null) {
      s.stepWindow.push(Math.abs(v - s.lastValue))
      if (s.stepWindow.length > cfg.windowSize) s.stepWindow.shift()
    }

    s.ewma = s.ewma === null ? v : cfg.ewmaAlpha * v + (1 - cfg.ewmaAlpha) * s.ewma
    s.lastValue = v
    s.seen++

    return found
  }

  /** Current EWMA forecast for a channel — charts draw this as the expected band. */
  forecast(noradId: number, channelId: string) {
    const s = this.stats.get(this.key(noradId, channelId))
    if (!s || s.ewma === null) return null
    const mu = mean(s.window)
    return { ewma: s.ewma, sigma: stdDev(s.window, mu), mean: mu, samples: s.seen }
  }

  private make(
    noradId: number,
    channel: TelemetryChannel,
    sample: TelemetrySample,
    method: AnomalyMethod,
    score: number,
    severity: Severity,
    explanation: string,
  ): Anomaly {
    return {
      id: `anom-${++anomalySeq}`,
      noradId,
      channelId: channel.id,
      t: sample.t,
      value: sample.value,
      score,
      method,
      severity,
      explanation,
    }
  }
}

export const METHOD_LABELS: Record<AnomalyMethod, string> = {
  OUT_OF_LIMITS: 'Limit violation',
  Z_SCORE: 'Statistical outlier',
  EWMA_RESIDUAL: 'Forecast drift',
  RATE_OF_CHANGE: 'Rate spike',
}
