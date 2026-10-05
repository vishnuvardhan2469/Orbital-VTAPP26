import { useMemo } from 'react'
import { create } from 'zustand'
import { getAdapter, DEFAULT_ADAPTER_ID, type AdapterStatus } from '@/lib/adapters'
import { propagateAll } from '@/lib/orbit/propagate'
import type {
  AgencyId,
  AlertEvent,
  Anomaly,
  ConjunctionEvent,
  EarthAOI,
  GroundStation,
  ObjectType,
  SatelliteState,
  Severity,
  SpaceObject,
} from '@/lib/types'

/**
 * Single application store.
 *
 * Two things live here that the rest of the app depends on:
 *
 *  1. The **mission clock** — every view renders against `simTime`, never
 *     `Date.now()`. That makes the whole console scrubbable and lets a demo
 *     fast-forward to an event instead of waiting for it.
 *  2. The **propagated fleet state**, recomputed once per tick and shared, so
 *     the globe, the map and the tables never disagree about where something is.
 */

export interface Filters {
  agencies: Set<AgencyId>
  types: Set<ObjectType>
  query: string
}

export const ALL_AGENCIES: AgencyId[] = ['NASA', 'ISRO', 'ESA', 'NOAA', 'OTHER']
export const ALL_TYPES: ObjectType[] = ['PAYLOAD', 'ROCKET_BODY', 'DEBRIS', 'UNKNOWN']

/** Speeds offered by the clock control, in simulated seconds per real second. */
export const TIME_SCALES = [1, 10, 60, 300, 1800] as const

interface AppState {
  // ── Data source ──────────────────────────────────────────────────────
  adapterId: string
  status: AdapterStatus
  catalog: SpaceObject[]
  stations: GroundStation[]
  aois: EarthAOI[]

  // ── Mission clock ────────────────────────────────────────────────────
  simTime: number
  timeScale: number
  playing: boolean

  // ── Propagated state, keyed by NORAD id ──────────────────────────────
  states: Record<number, SatelliteState>

  // ── Selection and filtering ──────────────────────────────────────────
  selectedId: number | null
  selectedStationId: string
  filters: Filters

  // ── Events ───────────────────────────────────────────────────────────
  alerts: AlertEvent[]
  anomalies: Anomaly[]
  conjunctions: ConjunctionEvent[]

  // ── Actions ──────────────────────────────────────────────────────────
  loadSource: (adapterId: string) => Promise<void>
  tick: (deltaMs: number) => void
  setPlaying: (playing: boolean) => void
  setTimeScale: (scale: number) => void
  resetClock: () => void
  jumpTo: (t: number) => void
  select: (noradId: number | null) => void
  selectStation: (id: string) => void
  setFilters: (patch: Partial<Filters>) => void
  pushAlert: (alert: Omit<AlertEvent, 'id' | 'acknowledged'>) => void
  acknowledgeAlert: (id: string) => void
  acknowledgeAll: () => void
  recordAnomalies: (anomalies: Anomaly[]) => void
  setConjunctions: (events: ConjunctionEvent[]) => void
}

/** Keeps the alert feed bounded — an operator console runs for hours. */
const MAX_ALERTS = 200
const MAX_ANOMALIES = 400

let alertSeq = 0

export const useStore = create<AppState>((set, get) => ({
  adapterId: DEFAULT_ADAPTER_ID,
  status: { adapterId: DEFAULT_ADAPTER_ID, state: 'IDLE' },
  catalog: [],
  stations: [],
  aois: [],

  simTime: Date.now(),
  timeScale: 1,
  playing: true,

  states: {},

  selectedId: null,
  selectedStationId: 'istrac-blr',
  filters: {
    agencies: new Set(ALL_AGENCIES),
    types: new Set(ALL_TYPES),
    query: '',
  },

  alerts: [],
  anomalies: [],
  conjunctions: [],

  async loadSource(adapterId) {
    const adapter = getAdapter(adapterId)
    set({ adapterId, status: { adapterId, state: 'LOADING' } })

    try {
      const [catalog, stations, aois] = await Promise.all([
        adapter.getCatalog(),
        adapter.getGroundStations(),
        adapter.getAOIs(),
      ])

      const now = get().simTime
      const states = Object.fromEntries(
        propagateAll(catalog, new Date(now)).map((s) => [s.noradId, s]),
      )

      set({
        catalog,
        stations,
        aois,
        states,
        selectedId: get().selectedId ?? catalog[0]?.noradId ?? null,
        status: {
          adapterId,
          state: 'READY',
          lastSync: Date.now(),
          recordCount: catalog.length,
        },
      })

      get().pushAlert({
        t: Date.now(),
        severity: 'INFO',
        source: 'SYSTEM',
        title: `Catalog loaded from ${adapter.label}`,
        detail: `${catalog.length} tracked objects, ${stations.length} ground stations.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ status: { adapterId, state: 'ERROR', message } })
      get().pushAlert({
        t: Date.now(),
        severity: 'CRITICAL',
        source: 'SYSTEM',
        title: `${adapter.label} unavailable`,
        detail: message,
      })
    }
  },

  tick(deltaMs) {
    const { playing, timeScale, simTime, catalog } = get()
    if (!playing || catalog.length === 0) return

    const next = simTime + deltaMs * timeScale
    const states = Object.fromEntries(
      propagateAll(catalog, new Date(next)).map((s) => [s.noradId, s]),
    )
    set({ simTime: next, states })
  },

  setPlaying: (playing) => set({ playing }),
  setTimeScale: (timeScale) => set({ timeScale }),
  resetClock: () => set({ simTime: Date.now() }),

  jumpTo(t) {
    const states = Object.fromEntries(
      propagateAll(get().catalog, new Date(t)).map((s) => [s.noradId, s]),
    )
    set({ simTime: t, states })
  },

  select: (selectedId) => set({ selectedId }),
  selectStation: (selectedStationId) => set({ selectedStationId }),
  setFilters: (patch) => set({ filters: { ...get().filters, ...patch } }),

  pushAlert(alert) {
    const entry: AlertEvent = { ...alert, id: `alert-${++alertSeq}`, acknowledged: false }
    set({ alerts: [entry, ...get().alerts].slice(0, MAX_ALERTS) })
  },

  acknowledgeAlert(id) {
    set({
      alerts: get().alerts.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)),
    })
  },

  acknowledgeAll() {
    set({ alerts: get().alerts.map((a) => ({ ...a, acknowledged: true })) })
  },

  recordAnomalies(incoming) {
    if (incoming.length === 0) return
    set({ anomalies: [...incoming, ...get().anomalies].slice(0, MAX_ANOMALIES) })
  },

  setConjunctions: (conjunctions) => set({ conjunctions }),
}))

// ── Derived state ──────────────────────────────────────────────────────
//
// These are hooks rather than plain store selectors on purpose. Zustand v5
// compares selector output by identity, so a selector that builds a new array
// or object on every call re-renders forever. Deriving with `useMemo` over
// stable slices keeps the reference steady between store updates.

export function filterCatalog(catalog: SpaceObject[], filters: Filters): SpaceObject[] {
  const { agencies, types, query } = filters
  const needle = query.trim().toLowerCase()

  return catalog.filter((obj) => {
    if (!agencies.has(obj.agency)) return false
    if (!types.has(obj.type)) return false
    if (!needle) return true
    return (
      obj.name.toLowerCase().includes(needle) ||
      String(obj.noradId).includes(needle) ||
      obj.intlDesignator.toLowerCase().includes(needle)
    )
  })
}

export function useFilteredCatalog(): SpaceObject[] {
  const catalog = useStore((s) => s.catalog)
  const filters = useStore((s) => s.filters)
  return useMemo(() => filterCatalog(catalog, filters), [catalog, filters])
}

export function useSelectedObject(): SpaceObject | null {
  const catalog = useStore((s) => s.catalog)
  const selectedId = useStore((s) => s.selectedId)
  return useMemo(
    () => catalog.find((o) => o.noradId === selectedId) ?? null,
    [catalog, selectedId],
  )
}

export function useUnacknowledgedAlerts(): AlertEvent[] {
  const alerts = useStore((s) => s.alerts)
  return useMemo(() => alerts.filter((a) => !a.acknowledged), [alerts])
}

/** Fleet-level health roll-up used by the overview and the status strip. */
export function useFleetHealth() {
  const catalog = useStore((s) => s.catalog)

  return useMemo(() => {
    const counts = { NOMINAL: 0, CAUTION: 0, CRITICAL: 0, OFFLINE: 0 }
    for (const obj of catalog) counts[obj.health]++

    const worst: Severity =
      counts.CRITICAL > 0 ? 'CRITICAL' : counts.CAUTION > 0 ? 'WARNING' : 'INFO'

    return { counts, worst, total: catalog.length }
  }, [catalog])
}
