import type { ConjunctionEvent, SpaceObject } from '@/lib/types'
import { propagateAt } from './propagate'

/**
 * Conjunction (close-approach) screening.
 *
 * Two-stage, the way real screening works:
 *   1. Coarse pass — propagate every object on a shared time grid and keep
 *      pairs that come within `coarseKm`. Cheap enough for a few hundred
 *      objects in the browser.
 *   2. Fine pass — golden-section refinement around each coarse hit to find
 *      the true time of closest approach and miss distance.
 *
 * The probability figure is a screening heuristic, not an operational Pc.
 * A real Pc needs covariance data (Foster / Alfano) that TLEs do not carry —
 * documented here so nobody mistakes the number for flight-grade output.
 */

export interface ScreenOptions {
  /** How far ahead to screen, hours. */
  horizonHours: number
  /** Coarse grid step, seconds. */
  coarseStepSec: number
  /** Pairs closer than this on the coarse grid go to refinement, km. */
  coarseKm: number
  /** Report events with a refined miss distance under this, km. */
  reportKm: number
}

export const DEFAULT_SCREEN_OPTIONS: ScreenOptions = {
  horizonHours: 24,
  coarseStepSec: 120,
  coarseKm: 200,
  reportKm: 50,
}

function distanceAt(a: SpaceObject, b: SpaceObject, t: number) {
  const sa = propagateAt(a, new Date(t))
  const sb = propagateAt(b, new Date(t))
  if (!sa || !sb) return null
  return Math.hypot(sa.eci.x - sb.eci.x, sa.eci.y - sb.eci.y, sa.eci.z - sb.eci.z)
}

/** Ternary search for the minimum of the (unimodal near a pass) distance curve. */
function refineTca(a: SpaceObject, b: SpaceObject, lo: number, hi: number) {
  for (let i = 0; i < 24; i++) {
    const m1 = lo + (hi - lo) / 3
    const m2 = hi - (hi - lo) / 3
    const d1 = distanceAt(a, b, m1)
    const d2 = distanceAt(a, b, m2)
    if (d1 === null || d2 === null) break
    if (d1 < d2) hi = m2
    else lo = m1
  }
  const tca = Math.round((lo + hi) / 2)
  return { tca, distance: distanceAt(a, b, tca) ?? Infinity }
}

/**
 * Relative speed at closest approach. The range rate is ~0 at TCA by
 * definition, so this differences the two velocity vectors instead.
 */
function relativeSpeed(a: SpaceObject, b: SpaceObject, t: number) {
  const va = velocityOf(a, t)
  const vb = velocityOf(b, t)
  if (!va || !vb) return 0
  return Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z)
}

function velocityOf(obj: SpaceObject, t: number) {
  const dt = 500
  const before = propagateAt(obj, new Date(t - dt))
  const after = propagateAt(obj, new Date(t + dt))
  if (!before || !after) return null
  const scale = 1000 / (2 * dt)
  return {
    x: (after.eci.x - before.eci.x) * scale,
    y: (after.eci.y - before.eci.y) * scale,
    z: (after.eci.z - before.eci.z) * scale,
  }
}

/**
 * Screening heuristic: treats the combined hard-body radius plus a fixed
 * position uncertainty as a Gaussian miss-distance error and integrates it.
 * Monotonic in miss distance, which is all the ranking needs.
 */
export function collisionProbability(missKm: number, sigmaKm = 1.2, hardBodyKm = 0.05) {
  const r = hardBodyKm
  const s2 = sigmaKm ** 2
  return Math.exp(-(missKm ** 2) / (2 * s2)) * (1 - Math.exp(-(r ** 2) / (2 * s2)))
}

function severityFor(missKm: number, probability: number): ConjunctionEvent['severity'] {
  if (missKm < 1 || probability > 1e-4) return 'CRITICAL'
  if (missKm < 10 || probability > 1e-6) return 'WARNING'
  return 'INFO'
}

/**
 * Screen a catalog for close approaches. Returns events sorted by severity
 * then time. Runs synchronously — call it from a worker or an idle callback
 * for catalogs larger than a few hundred objects.
 */
export function screenConjunctions(
  objects: SpaceObject[],
  start: Date,
  options: Partial<ScreenOptions> = {},
): ConjunctionEvent[] {
  const opts = { ...DEFAULT_SCREEN_OPTIONS, ...options }
  const startMs = start.getTime()
  const steps = Math.floor((opts.horizonHours * 3600) / opts.coarseStepSec)

  // Precompute the coarse ephemeris once per object rather than per pair.
  const grid: Array<Array<{ x: number; y: number; z: number } | null>> = objects.map(() => [])
  for (let i = 0; i <= steps; i++) {
    const t = startMs + i * opts.coarseStepSec * 1000
    objects.forEach((obj, idx) => {
      const s = propagateAt(obj, new Date(t))
      grid[idx].push(s ? s.eci : null)
    })
  }

  // One event per pair — keep only that pair's tightest approach.
  const best = new Map<string, { i: number; j: number; step: number; d: number }>()

  for (let i = 0; i < objects.length; i++) {
    for (let j = i + 1; j < objects.length; j++) {
      for (let step = 0; step <= steps; step++) {
        const a = grid[i][step]
        const b = grid[j][step]
        if (!a || !b) continue
        const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
        if (d > opts.coarseKm) continue
        const key = `${i}-${j}`
        const current = best.get(key)
        if (!current || d < current.d) best.set(key, { i, j, step, d })
      }
    }
  }

  const events: ConjunctionEvent[] = []
  for (const hit of best.values()) {
    const a = objects[hit.i]
    const b = objects[hit.j]
    const centre = startMs + hit.step * opts.coarseStepSec * 1000
    const halfWindow = opts.coarseStepSec * 1000
    const { tca, distance } = refineTca(a, b, centre - halfWindow, centre + halfWindow)
    if (distance > opts.reportKm) continue

    const probability = collisionProbability(distance)
    events.push({
      id: `cdm-${a.noradId}-${b.noradId}-${tca}`,
      primary: a.noradId,
      secondary: b.noradId,
      tca,
      missDistanceKm: distance,
      relativeSpeedKmS: relativeSpeed(a, b, tca),
      probability,
      severity: severityFor(distance, probability),
    })
  }

  const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const
  return events.sort((x, y) => rank[x.severity] - rank[y.severity] || x.tca - y.tca)
}
