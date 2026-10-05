/** Small numeric helpers shared across detectors, charts and the globe. */

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export function stdDev(xs: number[], mu = mean(xs)) {
  if (xs.length < 2) return 0
  const variance = xs.reduce((acc, x) => acc + (x - mu) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(variance)
}

export const deg = (rad: number) => (rad * 180) / Math.PI
export const rad = (degrees: number) => (degrees * Math.PI) / 180

/**
 * Deterministic PRNG (mulberry32). Mock data must be reproducible so a demo
 * looks the same on every reload and bugs stay repeatable.
 */
export function seededRandom(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box-Muller transform: turns a uniform generator into a standard normal one. */
export function gaussian(rng: () => number) {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Great-circle distance between two geodetic points, km. */
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371
  const dLat = rad(bLat - aLat)
  const dLon = rad(bLon - aLon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
