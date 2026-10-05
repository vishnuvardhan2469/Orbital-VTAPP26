import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  eciToEcf,
  ecfToLookAngles,
  degreesLat,
  degreesLong,
  sunPos,
  jday,
  type SatRec,
} from 'satellite.js'
import type { GroundStation, PassPrediction, SatelliteState, SpaceObject } from '@/lib/types'
import { deg, rad } from '@/lib/util/math'

export const EARTH_RADIUS_KM = 6371.0
const AU_KM = 149_597_870.7

/**
 * Parsing a TLE into a SatRec is the expensive part of SGP4, and the elements
 * only change when a fresh TLE arrives — so cache by TLE text.
 */
const satrecCache = new Map<string, SatRec>()

export function getSatrec(tle: [string, string]): SatRec {
  const key = tle[0] + tle[1]
  let rec = satrecCache.get(key)
  if (!rec) {
    rec = twoline2satrec(tle[0], tle[1])
    satrecCache.set(key, rec)
  }
  return rec
}

/** True when the satellite is outside Earth's cylindrical shadow. */
function computeSunlit(eci: { x: number; y: number; z: number }, date: Date) {
  const { rsun } = sunPos(jday(date))
  const sun = { x: rsun.x * AU_KM, y: rsun.y * AU_KM, z: rsun.z * AU_KM }
  const sunMag = Math.hypot(sun.x, sun.y, sun.z)
  const u = { x: sun.x / sunMag, y: sun.y / sunMag, z: sun.z / sunMag }

  // Projection of the satellite vector onto the Sun direction.
  const along = eci.x * u.x + eci.y * u.y + eci.z * u.z
  if (along >= 0) return true // sunward side is always lit

  // Perpendicular distance from the Earth–Sun axis.
  const perp = Math.hypot(eci.x - along * u.x, eci.y - along * u.y, eci.z - along * u.z)
  return perp > EARTH_RADIUS_KM
}

/**
 * Propagate one object to a moment in time.
 * Returns null when SGP4 fails (decayed object, malformed or very stale TLE).
 */
export function propagateAt(obj: SpaceObject, date: Date): SatelliteState | null {
  const pv = propagate(getSatrec(obj.tle), date)
  if (!pv) return null

  const gmst = gstime(date)
  const geo = eciToGeodetic(pv.position, gmst)

  return {
    noradId: obj.noradId,
    lat: degreesLat(geo.latitude),
    lon: degreesLong(geo.longitude),
    altKm: geo.height,
    speedKmS: Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z),
    eci: { x: pv.position.x, y: pv.position.y, z: pv.position.z },
    sunlit: computeSunlit(pv.position, date),
    timestamp: date.getTime(),
  }
}

/** Propagate a whole catalog, dropping objects SGP4 could not resolve. */
export function propagateAll(objects: SpaceObject[], date: Date): SatelliteState[] {
  const out: SatelliteState[] = []
  for (const obj of objects) {
    const s = propagateAt(obj, date)
    if (s) out.push(s)
  }
  return out
}

/** Orbital period in minutes, derived from the TLE mean motion. */
export function orbitalPeriodMin(obj: SpaceObject) {
  const rec = getSatrec(obj.tle)
  // satrec.no is mean motion in radians/minute.
  return (2 * Math.PI) / rec.no
}

export interface GroundTrackPoint {
  lat: number
  lon: number
  t: number
}

/**
 * Sub-satellite track over `minutes`, sampled every `stepSec`.
 * Returned as separate segments split at the ±180° dateline so a 2D map can
 * draw them as polylines without a horizontal streak across the whole world.
 */
export function groundTrack(
  obj: SpaceObject,
  start: Date,
  minutes: number,
  stepSec = 30,
): GroundTrackPoint[][] {
  const segments: GroundTrackPoint[][] = []
  let current: GroundTrackPoint[] = []
  let prevLon: number | null = null

  const steps = Math.floor((minutes * 60) / stepSec)
  for (let i = 0; i <= steps; i++) {
    const t = start.getTime() + i * stepSec * 1000
    const state = propagateAt(obj, new Date(t))
    if (!state) continue

    if (prevLon !== null && Math.abs(state.lon - prevLon) > 180) {
      if (current.length > 1) segments.push(current)
      current = []
    }
    current.push({ lat: state.lat, lon: state.lon, t })
    prevLon = state.lon
  }
  if (current.length > 1) segments.push(current)
  return segments
}

/** One full revolution in ECI coordinates — what the 3D globe draws as an orbit ring. */
export function orbitPathEci(obj: SpaceObject, start: Date, samples = 180) {
  const periodMin = orbitalPeriodMin(obj)
  const pts: Array<{ x: number; y: number; z: number }> = []
  for (let i = 0; i <= samples; i++) {
    const t = start.getTime() + (i / samples) * periodMin * 60_000
    const pv = propagate(getSatrec(obj.tle), new Date(t))
    if (pv) pts.push({ x: pv.position.x, y: pv.position.y, z: pv.position.z })
  }
  return pts
}

/** Look angles from a ground station to an object at a given time. */
export function lookAngles(obj: SpaceObject, station: GroundStation, date: Date) {
  const pv = propagate(getSatrec(obj.tle), date)
  if (!pv) return null

  const gmst = gstime(date)
  const ecf = eciToEcf(pv.position, gmst)
  const la = ecfToLookAngles(
    { longitude: rad(station.lon), latitude: rad(station.lat), height: station.altKm },
    ecf,
  )
  return {
    azimuthDeg: (deg(la.azimuth) + 360) % 360,
    elevationDeg: deg(la.elevation),
    rangeKm: la.rangeSat,
  }
}

/**
 * Coarse-to-fine pass prediction.
 *
 * Step through the horizon at 30 s resolution to find where elevation crosses
 * the station minimum, then refine each crossing with a 1 s scan. That is far
 * cheaper than propagating every second across a whole day and is accurate to
 * about a second, which is plenty for scheduling and demo purposes.
 */
export function predictPasses(
  obj: SpaceObject,
  station: GroundStation,
  start: Date,
  hours = 24,
  coarseStepSec = 30,
): PassPrediction[] {
  const passes: PassPrediction[] = []
  const endMs = start.getTime() + hours * 3600_000

  let inPass = false
  let aos = 0
  let maxEl = -90

  for (let t = start.getTime(); t <= endMs; t += coarseStepSec * 1000) {
    const la = lookAngles(obj, station, new Date(t))
    if (!la) continue
    const visible = la.elevationDeg >= station.minElevationDeg

    if (visible && !inPass) {
      inPass = true
      aos = refineCrossing(obj, station, t - coarseStepSec * 1000, t)
      maxEl = la.elevationDeg
    } else if (visible) {
      maxEl = Math.max(maxEl, la.elevationDeg)
    } else if (!visible && inPass) {
      inPass = false
      const los = refineCrossing(obj, station, t - coarseStepSec * 1000, t)
      passes.push({
        noradId: obj.noradId,
        stationId: station.id,
        aos,
        los,
        maxElevationDeg: maxEl,
        durationSec: Math.round((los - aos) / 1000),
      })
    }
  }
  return passes
}

/** Binary search for the instant elevation crosses the station minimum. */
function refineCrossing(obj: SpaceObject, station: GroundStation, lo: number, hi: number) {
  const visibleAt = (t: number) => {
    const la = lookAngles(obj, station, new Date(t))
    return la ? la.elevationDeg >= station.minElevationDeg : false
  }
  // `lo` only ever moves to a point on its own side of the crossing, so the
  // visibility at the low end of the bracket is invariant.
  const loVisible = visibleAt(lo)

  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2
    if (visibleAt(mid) === loVisible) lo = mid
    else hi = mid
  }
  return Math.round((lo + hi) / 2)
}
