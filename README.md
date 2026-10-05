# Orbital Guard

A space-asset monitoring console: satellite tracking, Earth-observation watch,
telemetry anomaly detection and conjunction screening — built as a foundation to
extend once the hackathon problem statement lands.

Everything runs in the browser. Real SGP4 orbital mechanics, real coastline
geometry, no backend, and no network required for the default configuration.

```bash
npm install
npm run dev      # http://localhost:5180
npm run verify   # smoke-test the orbital + detection maths
npm run build    # typecheck and production bundle
```

---

## What is actually implemented

Nothing here is a mockup. The numbers on screen are computed.

| Module | What it does |
| --- | --- |
| **Mission Control** | Fleet health roll-up, next ground contacts across the station network, cross-module event summary. |
| **Orbit Tracker** | SGP4 propagation of the whole catalog, 3D inertial globe and 2D ground track, look angles and 24 h pass prediction per ground station. |
| **Earth Watch** | Areas of interest with change indices, plus the next usable overpass of every imaging asset (≥ 25° elevation at the AOI centre). |
| **Telemetry** | 1 Hz housekeeping stream through four online anomaly detectors, with fault injection to exercise them. |
| **Collision Risk** | Two-stage close-approach screening across the catalog with refined time of closest approach. |
| **Alert Feed** | Every event any module raises, acknowledgeable in one log. |
| **Data Sources** | Which adapter is live, element-set health, and how to wire a new source. |

### The maths, briefly

- **Propagation** — `satellite.js` (SGP4/SDP4) in an Earth-centred inertial
  frame. The globe rotates the Earth by GMST under fixed orbits, which is why
  orbit rings stay put while the planet turns.
- **Eclipse** — cylindrical shadow test against the true solar position, so
  objects dim when they cross into Earth's shadow.
- **Passes** — coarse 30 s horizon scan, then binary refinement of each
  elevation crossing. About a second of accuracy for a fraction of the cost of
  a per-second scan.
- **Conjunctions** — a shared coarse ephemeris grid over the catalog, then
  ternary-search refinement of each candidate pair's closest approach.
- **Anomalies** — four independent online detectors: hard limit checks, rolling
  z-score, EWMA forecast residual, and rate-of-change. All O(1) per sample.

`npm run verify` checks all of this end to end: TLE checksums, ISS altitude and
speed, geostationary period, ground-track continuity across the dateline, pass
plausibility, conjunction detection, and detector sensitivity.

---

## Architecture

```
src/
  lib/
    types.ts          Domain vocabulary — everything the UI renders
    adapters/         ← the data seam. Swap sources here, nothing else changes
      types.ts        DataAdapter interface
      mock.ts         Generated catalog (offline, deterministic)
      live.ts         Celestrak fetch + TLE parsing
    orbit/
      tle.ts          TLE construction with correct columns and checksums
      propagate.ts    SGP4 wrappers, ground tracks, look angles, passes
      conjunction.ts  Close-approach screening
    telemetry/
      stream.ts       Physically-plausible telemetry simulation
      anomaly.ts      The four detectors
      useTelemetry.ts Live stream hook
    util/             math, formatting, geodesy
  state/store.ts      Mission clock + propagated fleet state (Zustand)
  components/         globe (three.js), map (canvas), charts (Recharts), UI kit
  modules/
    registry.ts       ← the extension point. One entry = one nav item + route
    <module>/         One page per module
```

### Two seams that matter

**1. The data adapter.** Every page reads through `DataAdapter`. Switching from
simulated data to live agency feeds is one implementation swap — no component
knows the difference. The Data Sources page makes the active adapter visible so
"am I looking at real data?" is never ambiguous.

**2. The module registry.** Adding a capability means writing one page component
and appending one entry to `MODULES` in `src/modules/registry.ts`. Navigation,
routing, code-splitting and badge counts all read from that list.

### The mission clock

Every view renders against `simTime` from the store, never `Date.now()`. That is
what lets the console be paused mid-event or run at 30 min/s to reach a
conjunction. When the clock has drifted from real time, the header says so — a
fast-forwarded display must never be mistaken for live truth.

---

## Extending it when the problem statement lands

### Add a module

```tsx
// src/modules/debris/DebrisPage.tsx
export function DebrisPage() { /* ... */ }

// src/modules/registry.ts
const DebrisPage = lazy(() => import('./debris/DebrisPage').then((m) => ({ default: m.DebrisPage })))

{
  id: 'debris',
  path: '/debris',
  label: 'Debris Forecast',
  description: 'Re-entry prediction and debris flux.',
  icon: Trash2,
  component: DebrisPage,
  group: 'ANALYSIS',
}
```

That is the whole change. It appears in the sidebar, gets its own route and its
own bundle chunk.

### Going live

`src/lib/adapters/live.ts` already fetches current element sets from Celestrak
and carries a list of the endpoints worth knowing (Space-Track, NASA EONET,
GIBS, FIRMS, ISRO Bhuvan, ESA Copernicus).

Several of those send no CORS headers, so a browser fetch is blocked. Add a dev
proxy rather than loosening the client:

```ts
// vite.config.ts
server: {
  proxy: {
    '/api/firms': {
      target: 'https://firms.modaps.eosdis.nasa.gov',
      changeOrigin: true,
      rewrite: (p) => p.replace(/^\/api\/firms/, ''),
    },
  },
}
```

For production, put the same proxy behind a small serverless function so API
keys stay off the client.

### Swap in a real detector

`AnomalyDetector` in `src/lib/telemetry/anomaly.ts` has one entry point —
`push(noradId, channel, sample) → Anomaly[]`. Replace the internals with an
autoencoder, an isolation forest, or a model served over HTTP; the rest of the
app only consumes the `Anomaly[]` that comes out.

---

## Honest notes on the demo data

These are stated plainly so nothing is oversold in a judging room:

- **The catalog is generated, not a live snapshot.** Inclinations, altitudes and
  eccentricities match each real mission, so ground tracks and revisit patterns
  behave correctly. Orbit phasing (RAAN, mean anomaly, argument of perigee) is
  synthetic, and epochs are set to the current time so SGP4 never runs stale.
  Switch to the Celestrak adapter for real element sets.
- **Two debris objects are engineered to converge** with SENTINEL-2A and
  CARTOSAT-3 inside the screening horizon. A catalog of 24 objects produces no
  natural close approaches, and an empty conjunction console looks broken rather
  than safe. They are clearly marked in `mock.ts` and should be deleted once
  real catalog data is wired in.
- **Collision probability is a screening heuristic**, not an operational Pc. A
  real Pc needs covariance data that TLEs do not carry. It is monotonic in miss
  distance, which is all the ranking needs.
- **Telemetry is simulated.** It is shaped by real physics — eclipse cycles
  drive power and thermal channels on the orbital period — but no spacecraft
  produced it.
- **Earth-observation indices are synthetic.** Overpass times are real; the
  change indices are not derived from imagery.

## Stack

React 19 · TypeScript · Vite · Tailwind v4 · Zustand · three.js · Recharts ·
satellite.js · Natural Earth coastlines (bundled, 55 KB)
