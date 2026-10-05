# Problem statement — to be filled in

The Orbital Guard hackathon had not released its problem statement when this
foundation was built. Paste it here when it arrives, then work through the
triage below.

```
(paste the problem statement verbatim here)
```

---

## Triage — 20 minutes, before writing any code

### 1. Which existing module is closest?

| If the statement is about… | Start from | File |
| --- | --- | --- |
| Tracking, orbit determination, coverage, revisit | Orbit Tracker | `src/modules/tracking/TrackingPage.tsx` |
| Debris, collision avoidance, manoeuvre planning | Collision Risk | `src/modules/conjunction/ConjunctionPage.tsx` + `src/lib/orbit/conjunction.ts` |
| Spacecraft health, fault detection, predictive maintenance | Telemetry | `src/lib/telemetry/anomaly.ts` |
| Disasters, climate, land use, imagery | Earth Watch | `src/modules/earth/EarthPage.tsx` |
| Ground segment, scheduling, downlink contention | Orbit Tracker pass prediction | `src/lib/orbit/propagate.ts` |
| Something genuinely new | A new module | `src/modules/registry.ts` |

Extend the closest module rather than starting a page from scratch. The globe,
the map, the mission clock, the alert feed and the catalog are already wired.

### 2. What data does it name?

Fill this in as you read the statement:

- Sources named: …
- Format (TLE / OMM / JSON / GeoTIFF / CSV): …
- Authentication needed: …
- Does it send CORS headers: …

Then write the adapter in `src/lib/adapters/` and register it in
`adapters/index.ts`. Do not fetch from inside a component — the whole app
depends on the adapter seam holding.

### 3. What is the actual deliverable?

Hackathon statements usually ask for one of four things. Name which:

- **Detect** something — extend `AnomalyDetector`, keep the `Anomaly[]` contract.
- **Predict** something — add to `src/lib/orbit/`, return plain data.
- **Visualise** something — new module, reuse `Globe3D` / `GroundTrackMap`.
- **Optimise** something (scheduling, tasking, routing) — new `src/lib/` module,
  new page; the pass predictor already gives you the constraint set.

### 4. What is demonstrable in the room?

The mission clock exists for exactly this. Whatever gets built, make sure a
judge can reach the interesting moment in under ten seconds — fast-forward to
it, or add an injection control the way the telemetry page does.

---

## Things already built that you should not rebuild

- SGP4 propagation, ground tracks, look angles, pass prediction
- Eclipse / terminator geometry, in both 3D and 2D
- Close-approach screening with refined TCA
- Four streaming anomaly detectors with human-readable explanations
- A 3D globe and a 2D map that need no textures, tiles or network
- Mission clock with pause, scrub and time acceleration
- Cross-module alert feed with acknowledgement
- Catalog filtering, selection and search shared across pages
- TLE construction and parsing, with checksums

## Deliberate gaps — likely places the statement will land

These were left out because guessing wrong costs more than building later:

- **Manoeuvre planning.** Conjunctions are screened but no avoidance burn is
  computed. Adding Δv and a re-screen after the burn is a natural extension.
- **Real imagery.** Earth Watch has AOIs and overpass geometry but shows no
  pixels. NASA GIBS tiles would slot into the map component.
- **Persistence.** Everything is in memory. Nothing survives a reload.
- **Multi-user / shared state.** Single operator, single browser.
- **Orbit determination.** The app propagates given elements; it does not fit
  elements to observations.
- **Re-entry prediction.** BSTAR is carried through but decay is not modelled.
