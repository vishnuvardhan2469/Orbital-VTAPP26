import { useMemo, useState } from 'react'
import { Sparkline } from '@/components/charts/TelemetryChart'
import { GroundTrackMap } from '@/components/map/GroundTrackMap'
import {
  Badge,
  EmptyState,
  KeyValue,
  Meter,
  PageHeader,
  Panel,
  StatTile,
} from '@/components/ui/primitives'
import { predictPasses } from '@/lib/orbit/propagate'
import { haversineKm } from '@/lib/util/math'
import { duration, latLon, utc } from '@/lib/util/format'
import type { EarthAOI, Severity } from '@/lib/types'
import { useStore } from '@/state/store'

/**
 * Earth-observation watch board.
 *
 * Ties areas of interest to the imaging assets that can actually revisit them:
 * for each AOI, the next overpass is computed by treating the AOI centre as a
 * ground station with a wide acceptance angle, which is exactly the geometry
 * that decides whether a sensor can see it.
 */

const WATCH_LABELS: Record<EarthAOI['watchFor'], string> = {
  WILDFIRE: 'Active fire',
  FLOOD: 'Flood extent',
  DEFORESTATION: 'Forest loss',
  CYCLONE: 'Cyclone risk',
  URBAN_HEAT: 'Surface heat',
}

/** Index bands are per-hazard in reality; a single scale keeps the demo legible. */
function severityFor(index: number): Severity {
  if (index >= 0.75) return 'CRITICAL'
  if (index >= 0.55) return 'WARNING'
  return 'INFO'
}

export function EarthPage() {
  const aois = useStore((s) => s.aois)
  const catalog = useStore((s) => s.catalog)
  const states = useStore((s) => s.states)
  const stations = useStore((s) => s.stations)
  const simTime = useStore((s) => s.simTime)
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)

  const [activeAoiId, setActiveAoiId] = useState<string | null>(null)
  const activeAoi = aois.find((a) => a.id === activeAoiId) ?? aois[0] ?? null

  /** Imaging assets — the ones whose overpasses matter for an AOI. */
  const imagers = useMemo(
    () => catalog.filter((o) => o.type === 'PAYLOAD' && o.mission && /imag|observ|ocean|land|radar|hyperspectral|meteorolog|weather|resource/i.test(o.mission)),
    [catalog],
  )

  /**
   * Next overpass per imaging asset. An AOI is treated as an observer with a
   * 25° minimum elevation — roughly the off-nadir limit at which most optical
   * sensors still deliver usable geometry.
   */
  const overpassBucket = Math.floor(simTime / 600_000)

  const overpasses = useMemo(() => {
    if (!activeAoi) return []
    const observer = {
      id: activeAoi.id,
      name: activeAoi.name,
      agency: 'OTHER' as const,
      lat: activeAoi.lat,
      lon: activeAoi.lon,
      altKm: 0,
      minElevationDeg: 25,
    }

    return imagers
      .map((obj) => {
        const next = predictPasses(obj, observer, new Date(simTime), 24, 60)[0]
        return next ? { obj, pass: next } : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.pass.aos - b.pass.aos)
      .slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bucketed on purpose
  }, [activeAoi, imagers, overpassBucket])

  /** Which tracked assets are currently overhead of the AOI, by ground distance. */
  const overhead = useMemo(() => {
    if (!activeAoi) return []
    return catalog
      .map((obj) => {
        const state = states[obj.noradId]
        if (!state) return null
        const d = haversineKm(activeAoi.lat, activeAoi.lon, state.lat, state.lon)
        return { obj, state, distanceKm: d }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null && x.distanceKm < 2500)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 5)
  }, [activeAoi, catalog, states])

  const elevated = aois.filter((a) => severityFor(a.index) !== 'INFO').length

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader
        title="Earth Watch"
        description="Areas of interest scored from the latest scene, with the next usable overpass for every imaging asset in the catalog."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Areas monitored" value={aois.length} hint="Across five hazard classes" />
        <StatTile
          label="Elevated"
          value={elevated}
          tone={elevated > 0 ? 'WARNING' : undefined}
          hint="Index above 0.55"
        />
        <StatTile label="Imaging assets" value={imagers.length} hint="Optical, radar and hyperspectral" />
        <StatTile
          label="Next overpass"
          value={overpasses[0] ? new Date(overpasses[0].pass.aos).toISOString().slice(11, 16) : '—'}
          unit={overpasses[0] ? 'UTC' : undefined}
          hint={overpasses[0]?.obj.name ?? 'None in 24 h'}
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ── AOI list ────────────────────────────────────────────── */}
        <Panel title={`Areas of interest · ${aois.length}`} className="lg:col-span-3 min-h-[26rem]" dense>
          <ul className="divide-y divide-line-soft overflow-y-auto">
            {aois.map((aoi) => {
              const severity = severityFor(aoi.index)
              return (
                <li key={aoi.id}>
                  <button
                    type="button"
                    onClick={() => setActiveAoiId(aoi.id)}
                    className={`w-full px-3 py-2.5 text-left transition-colors ${
                      activeAoi?.id === aoi.id ? 'bg-signal/10' : 'hover:bg-raised/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[12px] leading-tight text-ink">{aoi.name}</p>
                      <Badge tone={severity}>{aoi.index.toFixed(2)}</Badge>
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-ink-faint">
                      {WATCH_LABELS[aoi.watchFor]}
                    </p>
                    <div className="mt-1.5">
                      <Meter value={aoi.index} tone={severity} />
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </Panel>

        {/* ── Map ─────────────────────────────────────────────────── */}
        <Panel
          title="Coverage"
          subtitle="Areas of interest, ground stations and the live constellation"
          className="lg:col-span-6 min-h-[26rem]"
          dense
        >
          <GroundTrackMap
            objects={catalog}
            states={states}
            stations={stations}
            aois={aois}
            selectedId={selectedId}
            simTime={simTime}
            onSelect={select}
            showTrack
            showFootprint
          />
        </Panel>

        {/* ── AOI detail ──────────────────────────────────────────── */}
        <div className="lg:col-span-3 flex min-h-0 flex-col gap-4">
          <Panel title="Area detail">
            {!activeAoi ? (
              <EmptyState title="No area selected" />
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-ink">{activeAoi.name}</p>
                  <p className="font-mono text-[10px] text-ink-faint">
                    {latLon(activeAoi.lat, activeAoi.lon)} · ±{activeAoi.spanDeg}°
                  </p>
                </div>

                <div>
                  <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-faint">
                    {WATCH_LABELS[activeAoi.watchFor]} index · 24 scenes
                  </p>
                  <Sparkline
                    values={activeAoi.trend}
                    tone={severityFor(activeAoi.index) === 'CRITICAL' ? '#f43f5e' : '#fbbf24'}
                  />
                </div>

                <div className="border-t border-line-soft pt-1">
                  <KeyValue label="Latest index" value={activeAoi.index.toFixed(3)} />
                  <KeyValue label="Last scene" value={activeAoi.lastScene} />
                  <KeyValue label="Assets overhead" value={overhead.length} />
                </div>
              </div>
            )}
          </Panel>

          <Panel
            title="Next overpasses · 24 h"
            subtitle="≥ 25° elevation at the area centre"
            className="min-h-0 flex-1"
            bodyClassName="overflow-y-auto"
            dense
          >
            {overpasses.length === 0 ? (
              <EmptyState title="No overpasses" detail="No imaging asset reaches usable geometry in the next 24 hours." />
            ) : (
              <ul className="divide-y divide-line-soft">
                {overpasses.map(({ obj, pass }) => (
                  <li key={obj.noradId}>
                    <button
                      type="button"
                      onClick={() => select(obj.noradId)}
                      className="w-full px-3 py-2 text-left hover:bg-raised/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[11px] text-ink">{obj.name}</p>
                        <span className="font-mono text-[10px] text-signal">
                          {pass.maxElevationDeg.toFixed(0)}°
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono text-[10px] text-ink-faint">
                        {utc(pass.aos)} · {duration(pass.durationSec)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
