import type { AgencyId, EarthAOI, GroundStation, ObjectType, SpaceObject } from '@/lib/types'
import { buildTle, meanMotionForAltitude } from '@/lib/orbit/tle'
import { seededRandom } from '@/lib/util/math'
import type { DataAdapter } from './types'

/**
 * Generated demo catalog.
 *
 * Orbital geometry (inclination, altitude, eccentricity) matches each real
 * mission; epochs are set to "now" and phasing is synthetic, so the app always
 * propagates cleanly regardless of when it is run. See `lib/orbit/tle.ts`.
 */

interface CatalogSeed {
  noradId: number
  name: string
  agency: AgencyId
  type: ObjectType
  intlDesignator: string
  inclination: number
  altitudeKm: number
  eccentricity?: number
  bstar?: number
  mission?: string
}

const CATALOG_SEEDS: CatalogSeed[] = [
  // NASA / NOAA
  { noradId: 25544, name: 'ISS (ZARYA)',     agency: 'NASA', type: 'PAYLOAD', intlDesignator: '98067A',  inclination: 51.6416, altitudeKm: 420,   bstar: 3.2e-5, mission: 'Crewed orbital laboratory' },
  { noradId: 49260, name: 'LANDSAT 9',       agency: 'NASA', type: 'PAYLOAD', intlDesignator: '21088A',  inclination: 98.2210, altitudeKm: 705,   bstar: 1.1e-5, mission: 'Multispectral land imaging' },
  { noradId: 25994, name: 'TERRA',           agency: 'NASA', type: 'PAYLOAD', intlDesignator: '99068A',  inclination: 98.2094, altitudeKm: 705,   bstar: 1.4e-5, mission: 'MODIS / ASTER Earth science' },
  { noradId: 27424, name: 'AQUA',            agency: 'NASA', type: 'PAYLOAD', intlDesignator: '02022A',  inclination: 98.2035, altitudeKm: 705,   bstar: 1.3e-5, mission: 'Water cycle observation' },
  { noradId: 43013, name: 'NOAA-20',         agency: 'NOAA', type: 'PAYLOAD', intlDesignator: '17073A',  inclination: 98.7386, altitudeKm: 824,   bstar: 4.0e-6, mission: 'VIIRS polar weather' },
  { noradId: 33591, name: 'NOAA-19',         agency: 'NOAA', type: 'PAYLOAD', intlDesignator: '09005A',  inclination: 99.0400, altitudeKm: 870,   bstar: 5.0e-6, mission: 'AVHRR polar weather' },

  // ISRO
  { noradId: 44804, name: 'CARTOSAT-3',      agency: 'ISRO', type: 'PAYLOAD', intlDesignator: '19081A',  inclination: 97.5040, altitudeKm: 509,   bstar: 2.6e-5, mission: '0.25 m panchromatic imaging' },
  { noradId: 44233, name: 'RISAT-2B',        agency: 'ISRO', type: 'PAYLOAD', intlDesignator: '19028A',  inclination: 36.9990, altitudeKm: 557,   bstar: 2.1e-5, mission: 'X-band synthetic aperture radar' },
  { noradId: 54361, name: 'EOS-06 OCEANSAT', agency: 'ISRO', type: 'PAYLOAD', intlDesignator: '22161A',  inclination: 98.3120, altitudeKm: 740,   bstar: 9.0e-6, mission: 'Ocean colour and winds' },
  { noradId: 41783, name: 'RESOURCESAT-2A',  agency: 'ISRO', type: 'PAYLOAD', intlDesignator: '16074A',  inclination: 98.7160, altitudeKm: 817,   bstar: 6.0e-6, mission: 'Agriculture and land resources' },
  { noradId: 43689, name: 'HYSIS',           agency: 'ISRO', type: 'PAYLOAD', intlDesignator: '18096A',  inclination: 97.9570, altitudeKm: 636,   bstar: 1.5e-5, mission: 'Hyperspectral imaging' },
  { noradId: 45026, name: 'GSAT-30',         agency: 'ISRO', type: 'PAYLOAD', intlDesignator: '20005A',  inclination: 0.0620,  altitudeKm: 35786, eccentricity: 0.00018, bstar: 0, mission: 'Geostationary communications' },

  // ESA
  { noradId: 39634, name: 'SENTINEL-1A',     agency: 'ESA',  type: 'PAYLOAD', intlDesignator: '14016A',  inclination: 98.1810, altitudeKm: 693,   bstar: 1.2e-5, mission: 'C-band SAR all-weather imaging' },
  { noradId: 40697, name: 'SENTINEL-2A',     agency: 'ESA',  type: 'PAYLOAD', intlDesignator: '15028A',  inclination: 98.5670, altitudeKm: 786,   bstar: 7.0e-6, mission: 'Optical land monitoring' },
  { noradId: 42063, name: 'SENTINEL-2B',     agency: 'ESA',  type: 'PAYLOAD', intlDesignator: '17013A',  inclination: 98.5680, altitudeKm: 786,   bstar: 7.0e-6, mission: 'Optical land monitoring' },
  { noradId: 36508, name: 'CRYOSAT-2',       agency: 'ESA',  type: 'PAYLOAD', intlDesignator: '10013A',  inclination: 92.0320, altitudeKm: 717,   bstar: 1.0e-5, mission: 'Ice-sheet altimetry' },
  { noradId: 39452, name: 'SWARM A',         agency: 'ESA',  type: 'PAYLOAD', intlDesignator: '13067A',  inclination: 87.3540, altitudeKm: 462,   bstar: 3.0e-5, mission: 'Geomagnetic field survey' },
  { noradId: 38771, name: 'METOP-B',         agency: 'ESA',  type: 'PAYLOAD', intlDesignator: '12049A',  inclination: 98.7020, altitudeKm: 817,   bstar: 5.0e-6, mission: 'Operational meteorology' },

  // Debris and spent stages
  { noradId: 90112, name: 'COSMOS 1408 DEB', agency: 'OTHER', type: 'DEBRIS',      intlDesignator: '82092QA', inclination: 82.5600, altitudeKm: 481, bstar: 8.0e-5 },
  { noradId: 90337, name: 'FENGYUN 1C DEB',  agency: 'OTHER', type: 'DEBRIS',      intlDesignator: '99025DQ', inclination: 98.7400, altitudeKm: 851, bstar: 4.0e-5 },
  { noradId: 90455, name: 'CZ-6A R/B',       agency: 'OTHER', type: 'ROCKET_BODY', intlDesignator: '22151B',  inclination: 98.9100, altitudeKm: 802, bstar: 6.0e-5 },
  { noradId: 90781, name: 'BREEZE-M DEB',    agency: 'OTHER', type: 'DEBRIS',      intlDesignator: '12044C',  inclination: 49.4000, altitudeKm: 615, bstar: 9.0e-5 },
]

/**
 * Debris placed on orbits that deliberately converge with tracked payloads
 * inside the 24 h screening horizon. Without them a catalog this small produces
 * no close approaches at all and the conjunction console looks broken.
 * Delete these once real catalog data is wired in.
 */
interface EngineeredConjunction {
  target: number
  seed: CatalogSeed
  dRaan: number
  dInc: number
  dMeanAnomaly: number
}

const ENGINEERED_CONJUNCTIONS: EngineeredConjunction[] = [
  {
    target: 40697,
    dRaan: 0.02,
    dInc: 0.09,
    dMeanAnomaly: 0.006,
    seed: { noradId: 90902, name: 'UNKNOWN DEB 90902', agency: 'OTHER', type: 'DEBRIS', intlDesignator: '15028DK', inclination: 98.567, altitudeKm: 786, bstar: 5.5e-5 },
  },
  {
    target: 44804,
    dRaan: -0.03,
    dInc: 0.06,
    dMeanAnomaly: -0.05,
    seed: { noradId: 90903, name: 'UNKNOWN DEB 90903', agency: 'OTHER', type: 'DEBRIS', intlDesignator: '19081DF', inclination: 97.504, altitudeKm: 509, bstar: 7.5e-5 },
  },
]

/**
 * The orbit-placement parameters an engineered conjunction has to copy from its
 * target. Argument of perigee matters as much as mean anomaly: the two together
 * fix where on the orbit the object actually is, so cloning only the mean
 * anomaly leaves the pair hundreds of kilometres apart.
 */
interface Phasing {
  raan: number
  meanAnomaly: number
  inclination: number
  argPerigee: number
  eccentricity: number
}

export function buildCatalog(now: Date): SpaceObject[] {
  const rng = seededRandom(20260909)
  const phasing = new Map<number, Phasing>()

  const toObject = (seed: CatalogSeed, override?: Partial<Phasing>): SpaceObject => {
    // Draw every random element unconditionally so the sequence, and therefore
    // the whole catalog, stays identical whether or not overrides are supplied.
    const drawn: Phasing = {
      raan: rng() * 360,
      meanAnomaly: rng() * 360,
      inclination: seed.inclination,
      argPerigee: rng() * 360,
      eccentricity: seed.eccentricity ?? 0.00012 + rng() * 0.0008,
    }
    const elements: Phasing = { ...drawn, ...override }
    phasing.set(seed.noradId, elements)

    const tle = buildTle({
      noradId: seed.noradId,
      intlDesignator: seed.intlDesignator,
      epoch: now,
      inclination: elements.inclination,
      raan: elements.raan,
      eccentricity: elements.eccentricity,
      argPerigee: elements.argPerigee,
      meanAnomaly: elements.meanAnomaly,
      meanMotion: meanMotionForAltitude(seed.altitudeKm),
      bstar: seed.bstar ?? 1e-5,
      revNumber: 1000 + Math.floor(rng() * 8000),
    })

    return {
      noradId: seed.noradId,
      name: seed.name,
      agency: seed.agency,
      type: seed.type,
      intlDesignator: seed.intlDesignator,
      tle,
      epoch: now.toISOString(),
      health: 'NOMINAL',
      mission: seed.mission,
    }
  }

  const objects = CATALOG_SEEDS.map((seed) => toObject(seed))

  for (const conj of ENGINEERED_CONJUNCTIONS) {
    const target = phasing.get(conj.target)
    if (!target) continue
    objects.push(
      toObject(conj.seed, {
        raan: target.raan + conj.dRaan,
        inclination: target.inclination + conj.dInc,
        meanAnomaly: target.meanAnomaly + conj.dMeanAnomaly,
        argPerigee: target.argPerigee,
        eccentricity: target.eccentricity,
      }),
    )
  }

  // A few non-nominal states so the fleet board is not uniformly green.
  const caution = new Set([27424, 39452])
  const critical = new Set([44233])
  for (const obj of objects) {
    if (caution.has(obj.noradId)) obj.health = 'CAUTION'
    if (critical.has(obj.noradId)) obj.health = 'CRITICAL'
  }

  return objects
}

const GROUND_STATIONS: GroundStation[] = [
  { id: 'istrac-blr', name: 'ISTRAC Bengaluru', agency: 'ISRO', lat: 13.0343,  lon: 77.5117,   altKm: 0.9,  minElevationDeg: 5 },
  { id: 'isro-lko',   name: 'ISTRAC Lucknow',   agency: 'ISRO', lat: 26.9124,  lon: 80.9462,   altKm: 0.12, minElevationDeg: 5 },
  { id: 'isro-ant',   name: 'IDSN Antarctica',  agency: 'ISRO', lat: -69.4,    lon: 76.18,     altKm: 0.03, minElevationDeg: 5 },
  { id: 'dsn-gold',   name: 'DSN Goldstone',    agency: 'NASA', lat: 35.4267,  lon: -116.89,   altKm: 1.0,  minElevationDeg: 10 },
  { id: 'nasa-wal',   name: 'Wallops Island',   agency: 'NASA', lat: 37.94,    lon: -75.4664,  altKm: 0.01, minElevationDeg: 5 },
  { id: 'esa-kou',    name: 'Kourou',           agency: 'ESA',  lat: 5.251,    lon: -52.8047,  altKm: 0.01, minElevationDeg: 5 },
  { id: 'esa-red',    name: 'Redu',             agency: 'ESA',  lat: 50.0016,  lon: 5.1456,    altKm: 0.39, minElevationDeg: 5 },
  { id: 'ksat-sva',   name: 'Svalbard SvalSat', agency: 'ESA',  lat: 78.2297,  lon: 15.3894,   altKm: 0.46, minElevationDeg: 3 },
]

function makeTrend(seed: number, base: number) {
  const rng = seededRandom(seed)
  const out: number[] = []
  let v = base
  for (let i = 0; i < 24; i++) {
    v = Math.min(1, Math.max(0, v + (rng() - 0.45) * 0.06))
    out.push(Number(v.toFixed(3)))
  }
  return out
}

const AOIS: EarthAOI[] = [
  { id: 'aoi-uttarakhand', name: 'Uttarakhand Himalaya', lat: 30.07,  lon: 79.1,   spanDeg: 2.0, watchFor: 'FLOOD',         index: 0.71, lastScene: 'SENTINEL-1A · IW GRD', trend: makeTrend(11, 0.52) },
  { id: 'aoi-sundarbans',  name: 'Bay of Bengal Coast',  lat: 21.6,   lon: 88.9,   spanDeg: 3.0, watchFor: 'CYCLONE',       index: 0.84, lastScene: 'EOS-06 · OCM-3',       trend: makeTrend(22, 0.6) },
  { id: 'aoi-amazon',      name: 'Amazon Basin — Pará',  lat: -4.2,   lon: -55.3,  spanDeg: 4.0, watchFor: 'DEFORESTATION', index: 0.46, lastScene: 'LANDSAT 9 · OLI-2',    trend: makeTrend(33, 0.4) },
  { id: 'aoi-sierra',      name: 'Sierra Nevada, CA',    lat: 37.8,   lon: -119.5, spanDeg: 2.5, watchFor: 'WILDFIRE',      index: 0.63, lastScene: 'TERRA · MODIS',        trend: makeTrend(44, 0.48) },
  { id: 'aoi-delhi',       name: 'Delhi NCR',            lat: 28.61,  lon: 77.21,  spanDeg: 1.2, watchFor: 'URBAN_HEAT',    index: 0.77, lastScene: 'LANDSAT 9 · TIRS-2',   trend: makeTrend(55, 0.65) },
  { id: 'aoi-nsw',         name: 'New South Wales',      lat: -33.0,  lon: 149.2,  spanDeg: 3.5, watchFor: 'WILDFIRE',      index: 0.38, lastScene: 'SENTINEL-2A · MSI',    trend: makeTrend(66, 0.35) },
]

/** Simulates a short network round-trip so loading states get exercised. */
function delay<T>(value: T, ms = 220) {
  return new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))
}

export const mockAdapter: DataAdapter = {
  id: 'mock',
  label: 'Simulated catalog',
  description:
    'Generated from published mission orbits with a current epoch. Fully offline — nothing ' +
    'leaves the browser. Use this for development and for demoing without a network.',
  isLive: false,

  getCatalog: () => delay(buildCatalog(new Date())),
  getGroundStations: () => delay(GROUND_STATIONS, 120),
  getAOIs: () => delay(AOIS, 160),
}
