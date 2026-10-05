import type { TelemetryChannel, TelemetrySample } from '@/lib/types'
import { clamp, gaussian, seededRandom } from '@/lib/util/math'

/**
 * Synthetic telemetry generator.
 *
 * Produces physically-plausible spacecraft housekeeping data with realistic
 * structure — orbital-period sinusoids (eclipse cycles drive power and
 * thermal), sensor noise, and occasional injected faults. This is what feeds
 * the console until a real telemetry feed replaces it in `lib/adapters`.
 */

export const CHANNELS: TelemetryChannel[] = [
  { id: 'bus_voltage',  label: 'Bus voltage',        unit: 'V',   nominalMin: 26.0, nominalMax: 30.5, subsystem: 'POWER' },
  { id: 'batt_soc',     label: 'Battery SoC',        unit: '%',   nominalMin: 45,   nominalMax: 100,  subsystem: 'POWER' },
  { id: 'array_current',label: 'Solar array current',unit: 'A',   nominalMin: 0,    nominalMax: 14,   subsystem: 'POWER' },
  { id: 'temp_batt',    label: 'Battery temp',       unit: '°C',  nominalMin: -5,   nominalMax: 35,   subsystem: 'THERMAL' },
  { id: 'temp_payload', label: 'Payload temp',       unit: '°C',  nominalMin: -20,  nominalMax: 45,   subsystem: 'THERMAL' },
  { id: 'gyro_x',       label: 'Body rate X',        unit: '°/s', nominalMin: -2.0, nominalMax: 2.0,  subsystem: 'ADCS' },
  { id: 'wheel_rpm',    label: 'Reaction wheel',     unit: 'rpm', nominalMin: -4500,nominalMax: 4500, subsystem: 'ADCS' },
  { id: 'downlink_snr', label: 'Downlink SNR',       unit: 'dB',  nominalMin: 8,    nominalMax: 26,   subsystem: 'COMMS' },
  { id: 'payload_duty', label: 'Payload duty cycle', unit: '%',   nominalMin: 0,    nominalMax: 95,   subsystem: 'PAYLOAD' },
]

export const CHANNELS_BY_ID = new Map(CHANNELS.map((c) => [c.id, c]))

/** How each channel behaves: baseline, orbital swing, noise, and drift rate. */
interface ChannelModel {
  base: number
  amplitude: number
  noise: number
  /** Phase offset in fractions of an orbit, so channels are not all in step. */
  phase: number
}

const MODELS: Record<string, ChannelModel> = {
  bus_voltage:   { base: 28.4,  amplitude: 0.9,   noise: 0.08,  phase: 0.0 },
  batt_soc:      { base: 78,    amplitude: 16,    noise: 0.25,  phase: 0.12 },
  array_current: { base: 7.0,   amplitude: 6.4,   noise: 0.22,  phase: 0.0 },
  temp_batt:     { base: 16,    amplitude: 9,     noise: 0.30,  phase: 0.22 },
  temp_payload:  { base: 12,    amplitude: 18,    noise: 0.55,  phase: 0.30 },
  gyro_x:        { base: 0.02,  amplitude: 0.35,  noise: 0.07,  phase: 0.55 },
  wheel_rpm:     { base: 900,   amplitude: 2100,  noise: 35,    phase: 0.40 },
  downlink_snr:  { base: 17,    amplitude: 5.5,   noise: 0.65,  phase: 0.70 },
  payload_duty:  { base: 45,    amplitude: 38,    noise: 1.8,   phase: 0.18 },
}

/** A fault deliberately injected into a channel, so detectors have something to find. */
export interface FaultInjection {
  channelId: string
  kind: 'SPIKE' | 'DRIFT' | 'STUCK' | 'DROPOUT'
  /** Epoch ms when the fault begins. */
  startsAt: number
  durationMs: number
  /** Magnitude relative to the channel's nominal span. */
  magnitude: number
}

export class TelemetrySimulator {
  private rng: () => number
  private faults: FaultInjection[] = []
  private stuckValues = new Map<string, number>()

  private noradId: number
  /** Orbital period in minutes — drives the eclipse-cycle sinusoid. */
  private periodMin: number

  constructor(noradId: number, periodMin: number, seed = 1) {
    this.noradId = noradId
    this.periodMin = periodMin
    this.rng = seededRandom(seed ^ noradId)
  }

  get satelliteId() {
    return this.noradId
  }

  injectFault(fault: FaultInjection) {
    this.faults.push(fault)
  }

  /** Schedule a fault to begin shortly, for the "inject anomaly" demo control. */
  scheduleFault(channelId: string, kind: FaultInjection['kind'], delayMs = 1000) {
    this.injectFault({
      channelId,
      kind,
      startsAt: Date.now() + delayMs,
      durationMs: kind === 'SPIKE' ? 3_000 : 60_000,
      magnitude: kind === 'DRIFT' ? 0.5 : 1.0,
    })
  }

  clearFaults() {
    this.faults = []
    this.stuckValues.clear()
  }

  activeFaults(now = Date.now()) {
    return this.faults.filter((f) => now >= f.startsAt && now <= f.startsAt + f.durationMs)
  }

  /** Sample every channel at time `t`. */
  sampleAll(t: number): TelemetrySample[] {
    return CHANNELS.map((c) => ({ channelId: c.id, t, value: this.sample(c, t) }))
  }

  sample(channel: TelemetryChannel, t: number): number {
    const model = MODELS[channel.id]
    const span = channel.nominalMax - channel.nominalMin

    // Position within the orbit, 0..1.
    const orbitFraction = ((t / 60_000) % this.periodMin) / this.periodMin
    const angle = 2 * Math.PI * (orbitFraction + model.phase)

    let value = model.base + model.amplitude * Math.sin(angle)

    // Eclipse: solar input collapses on the shadow side of every orbit.
    if (channel.id === 'array_current' || channel.id === 'batt_soc') {
      const eclipse = Math.sin(angle) < -0.35
      if (eclipse) value -= channel.id === 'array_current' ? model.base * 0.85 : 4
    }

    value += gaussian(this.rng) * model.noise

    // Apply any fault currently in effect.
    for (const fault of this.activeFaults(t)) {
      if (fault.channelId !== channel.id) continue
      const progress = (t - fault.startsAt) / fault.durationMs
      switch (fault.kind) {
        case 'SPIKE':
          value += span * fault.magnitude * 0.6 * (this.rng() > 0.5 ? 1 : -1)
          break
        case 'DRIFT':
          value += span * fault.magnitude * progress
          break
        case 'STUCK': {
          const held = this.stuckValues.get(channel.id) ?? value
          this.stuckValues.set(channel.id, held)
          value = held
          break
        }
        case 'DROPOUT':
          value = channel.nominalMin - span * 0.2
          break
      }
    }

    // Clamp to something a real sensor could report, generously outside limits.
    return clamp(value, channel.nominalMin - span * 0.5, channel.nominalMax + span * 0.5)
  }

  /** Backfill history so charts open with context instead of an empty axis. */
  history(channelId: string, samples: number, stepMs: number, endT = Date.now()) {
    const channel = CHANNELS_BY_ID.get(channelId)
    if (!channel) return []
    const out: TelemetrySample[] = []
    for (let i = samples - 1; i >= 0; i--) {
      const t = endT - i * stepMs
      out.push({ channelId, t, value: this.sample(channel, t) })
    }
    return out
  }
}
