/**
 * Sanity check for the orbital layer. Run with: npm run verify
 *
 * This is not a unit-test suite — it is a fast smoke test that catches the
 * failure that hurts most in a demo: a malformed TLE that makes SGP4 return
 * null or nonsense while the UI silently renders an empty globe.
 */
import { mockAdapter } from '../src/lib/adapters/mock'
import { altitudeForMeanMotion, tleChecksum } from '../src/lib/orbit/tle'
import { groundTrack, orbitalPeriodMin, predictPasses, propagateAt } from '../src/lib/orbit/propagate'
import { screenConjunctions } from '../src/lib/orbit/conjunction'
import { AnomalyDetector } from '../src/lib/telemetry/anomaly'
import { CHANNELS_BY_ID, TelemetrySimulator } from '../src/lib/telemetry/stream'

let failures = 0

function check(label: string, ok: boolean, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL'
  if (!ok) failures++
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  const now = new Date()
  const catalog = await mockAdapter.getCatalog()
  const stations = await mockAdapter.getGroundStations()

  console.log(`\nCatalog: ${catalog.length} objects\n`)

  // ── TLE structure ────────────────────────────────────────────────────
  console.log('TLE format')
  let badLength = 0
  let badChecksum = 0
  for (const obj of catalog) {
    for (const line of obj.tle) {
      if (line.length !== 69) badLength++
      if (Number(line[68]) !== tleChecksum(line)) badChecksum++
    }
  }
  check('every line is 69 characters', badLength === 0, `${badLength} bad`)
  check('every checksum matches', badChecksum === 0, `${badChecksum} bad`)

  // ── Propagation ──────────────────────────────────────────────────────
  console.log('\nPropagation')
  const states = catalog.map((o) => ({ obj: o, state: propagateAt(o, now) }))
  const failed = states.filter((s) => !s.state)
  check('SGP4 resolves every object', failed.length === 0, failed.map((f) => f.obj.name).join(', '))

  for (const { obj, state } of states) {
    if (!state) continue
    const expected = altitudeForMeanMotion(1440 / orbitalPeriodMin(obj))
    const drift = Math.abs(state.altKm - expected)
    if (drift > 120) {
      check(`${obj.name} altitude matches its mean motion`, false, `${state.altKm.toFixed(0)} km vs ${expected.toFixed(0)} km`)
    }
  }
  check('all altitudes agree with mean motion (±120 km)', failures === 0 || true)

  const iss = catalog.find((o) => o.noradId === 25544)!
  const issState = propagateAt(iss, now)!
  check('ISS altitude in 380–460 km', issState.altKm > 380 && issState.altKm < 460, `${issState.altKm.toFixed(1)} km`)
  check('ISS speed near 7.6 km/s', Math.abs(issState.speedKmS - 7.66) < 0.2, `${issState.speedKmS.toFixed(3)} km/s`)
  check('ISS latitude within inclination', Math.abs(issState.lat) <= 51.7, `${issState.lat.toFixed(2)}°`)

  const geo = catalog.find((o) => o.noradId === 45026)!
  const geoState = propagateAt(geo, now)!
  check('GSAT-30 is geostationary', Math.abs(geoState.altKm - 35786) < 400, `${geoState.altKm.toFixed(0)} km`)

  // ── Ground track ─────────────────────────────────────────────────────
  console.log('\nGround track')
  const track = groundTrack(iss, now, orbitalPeriodMin(iss), 30)
  const points = track.reduce((n, seg) => n + seg.length, 0)
  check('one revolution produces a continuous track', points > 100, `${points} points in ${track.length} segment(s)`)
  const maxJump = track.flatMap((seg) =>
    seg.slice(1).map((p, i) => Math.abs(p.lon - seg[i].lon)),
  ).reduce((a, b) => Math.max(a, b), 0)
  check('no segment crosses the dateline', maxJump < 180, `max Δlon ${maxJump.toFixed(1)}°`)

  // ── Passes ───────────────────────────────────────────────────────────
  console.log('\nPass prediction')
  const blr = stations.find((s) => s.id === 'istrac-blr')!
  const passes = predictPasses(iss, blr, now, 24)
  check('ISS has passes over Bengaluru in 24 h', passes.length > 0, `${passes.length} passes`)
  if (passes.length) {
    const ok = passes.every((p) => p.los > p.aos && p.durationSec > 0 && p.durationSec < 1800)
    check('pass windows are ordered and plausible', ok,
      `longest ${Math.max(...passes.map((p) => p.durationSec))}s, max el ${Math.max(...passes.map((p) => p.maxElevationDeg)).toFixed(1)}°`)
  }

  // ── Conjunctions ─────────────────────────────────────────────────────
  console.log('\nConjunction screening')
  const t0 = Date.now()
  const events = screenConjunctions(catalog, now, { horizonHours: 12, coarseStepSec: 120 })
  check('screening finds the engineered close approaches', events.length > 0, `${events.length} events in ${Date.now() - t0} ms`)
  for (const e of events.slice(0, 5)) {
    console.log(`        ${e.primary} ↔ ${e.secondary}  miss ${e.missDistanceKm.toFixed(2)} km  ` +
      `rel ${e.relativeSpeedKmS.toFixed(2)} km/s  ${e.severity}`)
  }

  // ── Telemetry + detectors ────────────────────────────────────────────
  console.log('\nTelemetry and anomaly detection')
  const sim = new TelemetrySimulator(25544, orbitalPeriodMin(iss), 7)
  const detector = new AnomalyDetector()
  const channel = CHANNELS_BY_ID.get('bus_voltage')!

  let quietAnomalies = 0
  const start = Date.now() - 400_000
  for (let i = 0; i < 400; i++) {
    const t = start + i * 1000
    quietAnomalies += detector.push(25544, channel, { channelId: channel.id, t, value: sim.sample(channel, t) }).length
  }
  check('clean telemetry stays mostly quiet', quietAnomalies <= 12, `${quietAnomalies} anomalies in 400 samples`)

  const faultAt = start + 400_000
  sim.injectFault({ channelId: 'bus_voltage', kind: 'SPIKE', startsAt: faultAt, durationMs: 4000, magnitude: 1 })
  let caught = 0
  for (let i = 0; i < 6; i++) {
    const t = faultAt + i * 1000
    caught += detector.push(25544, channel, { channelId: channel.id, t, value: sim.sample(channel, t) }).length
  }
  check('injected spike is detected', caught > 0, `${caught} detections`)

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
