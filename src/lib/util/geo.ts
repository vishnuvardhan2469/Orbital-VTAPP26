import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import { rad } from './math'

/**
 * Coastline geometry and geodetic → Cartesian conversions.
 *
 * The Natural Earth land outline ships with the app (`public/geo/land-110m.json`,
 * 55 KB) rather than being pulled from a CDN, so the globe and the map still
 * draw when the venue wifi does not cooperate.
 */

export const EARTH_RADIUS_KM = 6371

/** A closed ring of [lon, lat] pairs. */
export type Ring = Array<[number, number]>

let cache: Promise<Ring[]> | null = null

export function loadLandOutlines(): Promise<Ring[]> {
  if (!cache) {
    cache = fetch(`${import.meta.env.BASE_URL}geo/land-110m.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`land outlines: HTTP ${r.status}`)
        return r.json() as Promise<Topology<{ land: GeometryCollection }>>
      })
      .then((topology) => {
        const collection = feature(topology, topology.objects.land)
        const rings: Ring[] = []

        const pushPolygon = (polygon: number[][][]) => {
          for (const ring of polygon) rings.push(ring as Ring)
        }

        for (const f of collection.features) {
          const geom = f.geometry
          if (geom.type === 'Polygon') pushPolygon(geom.coordinates)
          else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(pushPolygon)
        }
        return rings
      })
      .catch((error) => {
        // A missing coastline is cosmetic — the graticule still gives the globe
        // a readable frame — so degrade instead of failing the whole view.
        console.warn('[geo] coastlines unavailable:', error)
        return [] as Ring[]
      })
  }
  return cache
}

/**
 * Geodetic position to Earth-fixed Cartesian, in units of Earth radii.
 * Uses a spherical Earth: at globe rendering scale the WGS84 flattening is
 * well under a pixel.
 */
export function geodeticToVec3(latDeg: number, lonDeg: number, altKm = 0) {
  const r = 1 + altKm / EARTH_RADIUS_KM
  const lat = rad(latDeg)
  const lon = rad(lonDeg)
  return {
    x: r * Math.cos(lat) * Math.cos(lon),
    y: r * Math.cos(lat) * Math.sin(lon),
    z: r * Math.sin(lat),
  }
}

/** Latitude/longitude graticule as flat [x,y,z, x,y,z, …] line-segment pairs. */
export function graticuleSegments(stepDeg = 15, radius = 1.001) {
  const out: number[] = []
  const push = (lat: number, lon: number) => {
    const v = geodeticToVec3(lat, lon)
    out.push(v.x * radius, v.y * radius, v.z * radius)
  }

  // Parallels
  for (let lat = -75; lat <= 75; lat += stepDeg) {
    for (let lon = -180; lon < 180; lon += 3) {
      push(lat, lon)
      push(lat, lon + 3)
    }
  }
  // Meridians
  for (let lon = -180; lon < 180; lon += stepDeg) {
    for (let lat = -90; lat < 90; lat += 3) {
      push(lat, lon)
      push(lat + 3, lon)
    }
  }
  return out
}

/** Coastline rings as line segments ready for a THREE.BufferGeometry. */
export function ringsToSegments(rings: Ring[], radius = 1.002) {
  const out: number[] = []
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = geodeticToVec3(ring[i][1], ring[i][0])
      const b = geodeticToVec3(ring[i + 1][1], ring[i + 1][0])
      out.push(a.x * radius, a.y * radius, a.z * radius)
      out.push(b.x * radius, b.y * radius, b.z * radius)
    }
  }
  return out
}

/** Equirectangular projection into a pixel box — used by the 2D ground-track map. */
export function project(lonDeg: number, latDeg: number, width: number, height: number) {
  return {
    x: ((lonDeg + 180) / 360) * width,
    y: ((90 - latDeg) / 180) * height,
  }
}

/**
 * Radius of the circle on the ground within which a satellite is above a given
 * elevation angle — the "footprint" drawn under each spacecraft.
 */
export function footprintRadiusDeg(altKm: number, minElevationDeg = 0) {
  const el = rad(minElevationDeg)
  const ratio = EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altKm)
  const centralAngle = Math.acos(Math.min(1, ratio * Math.cos(el))) - el
  return (centralAngle * 180) / Math.PI
}
