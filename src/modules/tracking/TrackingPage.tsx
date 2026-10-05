import { useMemo, useState } from 'react'
import { Globe2, Map as MapIcon } from 'lucide-react'
import { Globe3D } from '@/components/globe/Globe3D'
import { GroundTrackMap } from '@/components/map/GroundTrackMap'
import { ObjectList } from '@/components/ui/ObjectList'
import {
  Badge,
  KeyValue,
  Loading,
  PageHeader,
  Panel,
  Segmented,
  StatTile,
  Toggle,
} from '@/components/ui/primitives'
import { lookAngles, orbitalPeriodMin, predictPasses } from '@/lib/orbit/propagate'
import { countdown, duration, latLon, utc, utcTime } from '@/lib/util/format'
import { useFilteredCatalog, useSelectedObject, useStore } from '@/state/store'

/**
 * Orbit tracker.
 *
 * The 3D and 2D views are two projections of the same propagated state, so
 * they can never disagree; switching between them is purely a display choice.
 */
export function TrackingPage() {
  const [view, setView] = useState<'globe' | 'map'>('globe')
  const [showOrbit, setShowOrbit] = useState(true)
  const [showFootprint, setShowFootprint] = useState(true)
  const [showStations, setShowStations] = useState(true)

  const catalog = useFilteredCatalog()
  const states = useStore((s) => s.states)
  const stations = useStore((s) => s.stations)
  const aois = useStore((s) => s.aois)
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)
  const simTime = useStore((s) => s.simTime)
  const selected = useSelectedObject()
  const selectedStationId = useStore((s) => s.selectedStationId)
  const selectStation = useStore((s) => s.selectStation)
  const loading = useStore((s) => s.status.state === 'LOADING' || s.catalog.length === 0)

  const station = stations.find((s) => s.id === selectedStationId) ?? stations[0]
  const state = selectedId !== null ? states[selectedId] : null

  // Pass prediction is the expensive call on this page — one SGP4 evaluation
  // per 30 s of the horizon. Recomputing it every clock tick would dominate the
  // frame, and a 24 h pass list does not change meaningfully inside five
  // minutes, so both derivations are bucketed on mission time instead.
  const passBucket = Math.floor(simTime / 300_000)
  const lookBucket = Math.floor(simTime / 1000)

  const passes = useMemo(() => {
    if (!selected || !station) return []
    return predictPasses(selected, station, new Date(simTime), 24).slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bucketed on purpose
  }, [selected, station, passBucket])

  const currentLook = useMemo(() => {
    if (!selected || !station) return null
    return lookAngles(selected, station, new Date(simTime))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bucketed on purpose
  }, [selected, station, lookBucket])

  const nextPass = passes.find((p) => p.los > simTime)
  const inPass = nextPass ? simTime >= nextPass.aos : false

  if (loading) {
    return (
      <Panel className="h-[70vh]">
        <Loading label="Propagating catalog" />
      </Panel>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader
        title="Orbit Tracker"
        description="SGP4 propagation of every tracked object, rendered in an Earth-centred inertial frame. Click a point to select it."
        actions={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'globe' as const, label: <span className="flex items-center gap-1.5"><Globe2 size={11} /> 3D</span> },
              { value: 'map' as const, label: <span className="flex items-center gap-1.5"><MapIcon size={11} /> Ground track</span> },
            ]}
          />
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ── Catalog ─────────────────────────────────────────────── */}
        <Panel
          title={`Catalog · ${catalog.length}`}
          className="lg:col-span-3 min-h-[32rem]"
          dense
        >
          <ObjectList
            objects={catalog}
            states={states}
            selectedId={selectedId}
            onSelect={select}
          />
        </Panel>

        {/* ── Viewport ────────────────────────────────────────────── */}
        <Panel
          className="lg:col-span-6 min-h-[32rem]"
          title={view === 'globe' ? 'Inertial view' : 'Ground track · equirectangular'}
          actions={
            <div className="flex items-center gap-3">
              <Toggle checked={showOrbit} onChange={setShowOrbit} label="Orbit" />
              <Toggle checked={showFootprint} onChange={setShowFootprint} label="Footprint" />
              <Toggle checked={showStations} onChange={setShowStations} label="Stations" />
            </div>
          }
          dense
        >
          {view === 'globe' ? (
            <Globe3D
              objects={catalog}
              states={states}
              stations={showStations ? stations : []}
              selectedId={selectedId}
              selectedObject={selected}
              simTime={simTime}
              onSelect={select}
              showOrbit={showOrbit}
              showFootprint={showFootprint}
              showStations={showStations}
            />
          ) : (
            <GroundTrackMap
              objects={catalog}
              states={states}
              stations={showStations ? stations : []}
              aois={aois}
              selectedId={selectedId}
              simTime={simTime}
              onSelect={select}
              showTrack={showOrbit}
              showFootprint={showFootprint}
            />
          )}
        </Panel>

        {/* ── Selected object ─────────────────────────────────────── */}
        <div className="lg:col-span-3 flex min-h-0 flex-col gap-4">
          <Panel
            title="Selected object"
            subtitle={selected?.mission}
            actions={selected && <Badge tone={selected.health}>{selected.health}</Badge>}
          >
            {!selected || !state ? (
              <p className="text-[11px] text-ink-faint">Select an object to see its state vector.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-ink">{selected.name}</p>
                  <p className="font-mono text-[10px] text-ink-faint">
                    NORAD {selected.noradId} · {selected.intlDesignator} · {selected.agency}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <StatTile label="Altitude" value={state.altKm.toFixed(1)} unit="km" />
                  <StatTile label="Speed" value={state.speedKmS.toFixed(3)} unit="km/s" />
                </div>

                <div className="border-t border-line-soft pt-1">
                  <KeyValue label="Sub-satellite point" value={latLon(state.lat, state.lon)} />
                  <KeyValue label="Orbital period" value={`${orbitalPeriodMin(selected).toFixed(1)} min`} />
                  <KeyValue label="Illumination" value={state.sunlit ? 'Sunlit' : 'Eclipse'} />
                  <KeyValue label="TLE epoch" value={utc(selected.epoch)} />
                </div>
              </div>
            )}
          </Panel>

          <Panel
            title="Ground segment"
            className="min-h-0 flex-1"
            actions={
              <select
                value={station?.id ?? ''}
                onChange={(e) => selectStation(e.target.value)}
                className="rounded border border-line bg-deep px-1.5 py-1 font-mono text-[10px] text-ink-dim outline-none"
              >
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            }
            bodyClassName="flex flex-col gap-3"
          >
            {!station || !selected ? (
              <p className="text-[11px] text-ink-faint">Select an object and a station.</p>
            ) : (
              <>
                <div className="rounded-lg border border-line bg-raised/40 px-3 py-2">
                  {inPass ? (
                    <>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-nominal">
                        In contact
                      </p>
                      <p className="mt-1 font-mono text-lg leading-none tabular-nums text-nominal">
                        {countdown(nextPass!.los - simTime)}
                      </p>
                      <p className="mt-1 text-[10px] text-ink-faint">until loss of signal</p>
                    </>
                  ) : nextPass ? (
                    <>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                        Next acquisition
                      </p>
                      <p className="mt-1 font-mono text-lg leading-none tabular-nums text-signal">
                        {countdown(nextPass.aos - simTime)}
                      </p>
                      <p className="mt-1 text-[10px] text-ink-faint">
                        {utc(nextPass.aos)} · max {nextPass.maxElevationDeg.toFixed(0)}° elevation
                      </p>
                    </>
                  ) : (
                    <p className="text-[11px] text-ink-faint">
                      No passes over {station.name} in the next 24 hours.
                    </p>
                  )}
                </div>

                {currentLook && (
                  <div className="border-t border-line-soft pt-1">
                    <KeyValue label="Azimuth" value={`${currentLook.azimuthDeg.toFixed(1)}°`} />
                    <KeyValue
                      label="Elevation"
                      value={
                        <span className={currentLook.elevationDeg >= station.minElevationDeg ? 'text-nominal' : ''}>
                          {currentLook.elevationDeg.toFixed(1)}°
                        </span>
                      }
                    />
                    <KeyValue label="Slant range" value={`${currentLook.rangeKm.toFixed(0)} km`} />
                  </div>
                )}

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-line-soft pt-2">
                  <p className="pb-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-faint">
                    Upcoming passes · 24 h
                  </p>
                  {passes.length === 0 ? (
                    <p className="text-[11px] text-ink-faint">None predicted.</p>
                  ) : (
                    <table className="w-full font-mono text-[10px] tabular-nums">
                      <tbody>
                        {passes.map((pass) => (
                          <tr key={pass.aos} className="border-b border-line-soft/60 last:border-0">
                            <td className="py-1 text-ink-dim">{utcTime(pass.aos)}</td>
                            <td className="py-1 text-right text-ink-faint">{duration(pass.durationSec)}</td>
                            <td className="py-1 text-right text-signal">
                              {pass.maxElevationDeg.toFixed(0)}°
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
