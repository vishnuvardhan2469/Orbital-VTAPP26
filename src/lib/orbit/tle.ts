/**
 * TLE construction.
 *
 * The demo catalog is *generated* rather than pasted from a snapshot, for two
 * reasons: a hard-coded TLE goes stale within weeks (SGP4 accuracy decays
 * fast away from epoch), and a generated set is guaranteed to be structurally
 * valid — correct column positions and checksums — so SGP4 never silently
 * fails during a demo.
 *
 * Element values are taken from the real published orbits of each mission, so
 * inclinations, altitudes and ground tracks behave correctly. Phasing (RAAN,
 * mean anomaly) is synthetic. Replace this with live Celestrak/Space-Track
 * data via the live adapter when the problem statement calls for it.
 */

export interface OrbitalElements {
  noradId: number
  /** e.g. "98067A" — 2-digit launch year, 3-digit launch number, piece. */
  intlDesignator: string
  epoch: Date
  /** Degrees. */
  inclination: number
  /** Right ascension of the ascending node, degrees. */
  raan: number
  eccentricity: number
  /** Argument of perigee, degrees. */
  argPerigee: number
  /** Degrees. */
  meanAnomaly: number
  /** Revolutions per day. */
  meanMotion: number
  /** Drag term. Larger = lower orbit / higher area-to-mass. */
  bstar: number
  revNumber: number
}

/** TLE checksum: sum of digits, with every minus sign counting as 1, mod 10. */
export function tleChecksum(line: string) {
  let sum = 0
  for (const ch of line.slice(0, 68)) {
    if (ch >= '0' && ch <= '9') sum += Number(ch)
    else if (ch === '-') sum += 1
  }
  return sum % 10
}

/** Epoch as the TLE's YYDDD.DDDDDDDD field. */
function epochField(date: Date) {
  const year = date.getUTCFullYear()
  const yy = String(year % 100).padStart(2, '0')
  const startOfYear = Date.UTC(year, 0, 1)
  const dayOfYear = (date.getTime() - startOfYear) / 86_400_000 + 1
  return yy + dayOfYear.toFixed(8).padStart(12, '0')
}

/** Exponent-notation field used for BSTAR and the 2nd derivative, e.g. "-11606-4". */
function expField(value: number) {
  if (value === 0) return ' 00000-0'
  const sign = value < 0 ? '-' : ' '
  const abs = Math.abs(value)
  let exponent = Math.floor(Math.log10(abs)) + 1
  let mantissa = Math.round((abs / 10 ** exponent) * 1e5)
  if (mantissa >= 100000) {
    mantissa = Math.round(mantissa / 10)
    exponent += 1
  }
  const expSign = exponent < 0 ? '-' : '+'
  return `${sign}${String(mantissa).padStart(5, '0')}${expSign}${Math.abs(exponent)}`
}

/** Fixed-width numeric field, right-justified, with a set number of decimals. */
const fixed = (value: number, width: number, decimals: number) =>
  value.toFixed(decimals).padStart(width, ' ')

export function buildTle(el: OrbitalElements): [string, string] {
  const id = String(el.noradId).padStart(5, '0')
  const designator = el.intlDesignator.padEnd(8, ' ')

  let line1 =
    `1 ${id}U ${designator} ${epochField(el.epoch)}` +
    ` ${' .00000000'.slice(0, 10)}` + // mean motion 1st derivative — unused by SGP4 here
    ` ${' 00000-0'}` +                 // 2nd derivative
    ` ${expField(el.bstar)}` +
    ` 0` +
    ` ${String(el.revNumber % 10000).padStart(4, ' ')}`

  let line2 =
    `2 ${id}` +
    ` ${fixed(el.inclination, 8, 4)}` +
    ` ${fixed(el.raan, 8, 4)}` +
    ` ${el.eccentricity.toFixed(7).slice(2)}` +
    ` ${fixed(el.argPerigee, 8, 4)}` +
    ` ${fixed(el.meanAnomaly, 8, 4)}` +
    ` ${fixed(el.meanMotion, 11, 8)}` +
    `${String(el.revNumber % 100000).padStart(5, ' ')}`

  line1 = line1.padEnd(68, ' ')
  line2 = line2.padEnd(68, ' ')
  return [line1 + tleChecksum(line1), line2 + tleChecksum(line2)]
}

/** Mean motion (rev/day) for a circular orbit at a given altitude. */
export function meanMotionForAltitude(altitudeKm: number) {
  const mu = 398_600.4418 // km³/s², Earth's standard gravitational parameter
  const a = 6378.137 + altitudeKm
  const periodSec = 2 * Math.PI * Math.sqrt(a ** 3 / mu)
  return 86_400 / periodSec
}

/** Approximate mean altitude implied by a mean motion, km. */
export function altitudeForMeanMotion(revsPerDay: number) {
  const mu = 398_600.4418
  const periodSec = 86_400 / revsPerDay
  const a = Math.cbrt((mu * periodSec ** 2) / (4 * Math.PI ** 2))
  return a - 6378.137
}
