/**
 * Core domain vocabulary for Orbital Guard.
 *
 * Everything the UI renders is described here. Data *sources* are pluggable
 * (see `lib/adapters`), so when the hackathon problem statement lands we swap
 * the adapter — not the components.
 */

export type AgencyId = 'NASA' | 'ISRO' | 'ESA' | 'NOAA' | 'OTHER'

export type ObjectType = 'PAYLOAD' | 'ROCKET_BODY' | 'DEBRIS' | 'UNKNOWN'

export type HealthState = 'NOMINAL' | 'CAUTION' | 'CRITICAL' | 'OFFLINE'

/** A tracked space object, keyed by NORAD catalog id. */
export interface SpaceObject {
  noradId: number
  name: string
  agency: AgencyId
  type: ObjectType
  /** International designator, e.g. 1998-067A */
  intlDesignator: string
  /** Two-line element set — the raw input to SGP4. */
  tle: [string, string]
  /** Epoch of the TLE (ISO string). Stale TLEs degrade propagation accuracy. */
  epoch: string
  health: HealthState
  mission?: string
}

/** Instantaneous propagated state of an object. */
export interface SatelliteState {
  noradId: number
  /** Geodetic sub-satellite point. */
  lat: number
  lon: number
  /** Altitude above the WGS84 ellipsoid, km. */
  altKm: number
  /** Scalar speed, km/s. */
  speedKmS: number
  /** Earth-centered inertial position, km — used by the 3D globe. */
  eci: { x: number; y: number; z: number }
  /** True when the object is in sunlight (not in Earth's shadow). */
  sunlit: boolean
  timestamp: number
}

/** A ground station / mission control site that can see satellites. */
export interface GroundStation {
  id: string
  name: string
  agency: AgencyId
  lat: number
  lon: number
  altKm: number
  /** Minimum elevation for a usable link, degrees. */
  minElevationDeg: number
}

/** A predicted visibility window between a station and an object. */
export interface PassPrediction {
  noradId: number
  stationId: string
  aos: number
  los: number
  maxElevationDeg: number
  durationSec: number
}

/** One telemetry channel definition (what a spacecraft reports). */
export interface TelemetryChannel {
  id: string
  label: string
  unit: string
  /** Operational limits. Values outside [min,max] are out-of-limits by definition. */
  nominalMin: number
  nominalMax: number
  /** Subsystem grouping, used for the telemetry board layout. */
  subsystem: 'POWER' | 'THERMAL' | 'ADCS' | 'COMMS' | 'PAYLOAD'
}

export interface TelemetrySample {
  channelId: string
  t: number
  value: number
}

export type AnomalyMethod = 'OUT_OF_LIMITS' | 'Z_SCORE' | 'EWMA_RESIDUAL' | 'RATE_OF_CHANGE'

export type Severity = 'INFO' | 'WARNING' | 'CRITICAL'

export interface Anomaly {
  id: string
  noradId: number
  channelId: string
  t: number
  value: number
  /** How far outside normal the sample sits, in detector-specific units. */
  score: number
  method: AnomalyMethod
  severity: Severity
  explanation: string
}

/** A screened close approach between two catalogued objects. */
export interface ConjunctionEvent {
  id: string
  primary: number
  secondary: number
  /** Time of closest approach (epoch ms). */
  tca: number
  missDistanceKm: number
  relativeSpeedKmS: number
  /** Toy probability-of-collision estimate — see lib/orbit/conjunction.ts. */
  probability: number
  severity: Severity
}

/** Unified operator-facing event feed entry. */
export interface AlertEvent {
  id: string
  t: number
  severity: Severity
  source: 'TELEMETRY' | 'CONJUNCTION' | 'GROUND_SEGMENT' | 'EARTH_OBSERVATION' | 'SYSTEM'
  title: string
  detail: string
  noradId?: number
  acknowledged: boolean
}

/** An Earth-observation area of interest being monitored. */
export interface EarthAOI {
  id: string
  name: string
  lat: number
  lon: number
  /** Bounding box half-width in degrees. */
  spanDeg: number
  /** What we are watching this AOI for. */
  watchFor: 'WILDFIRE' | 'FLOOD' | 'DEFORESTATION' | 'CYCLONE' | 'URBAN_HEAT'
  /** 0..1 index derived from the latest scene. */
  index: number
  lastScene: string
  trend: number[]
}
