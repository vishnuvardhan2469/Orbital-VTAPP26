import clsx from 'clsx'
import { Search } from 'lucide-react'
import { ALL_AGENCIES, ALL_TYPES, useStore } from '@/state/store'
import type { AgencyId, ObjectType, SatelliteState, SpaceObject } from '@/lib/types'
import { StatusDot } from './primitives'

/** Filterable catalog list. Shared by the tracker and the overview. */
export function ObjectList({
  objects,
  states,
  selectedId,
  onSelect,
  showFilters = true,
}: {
  objects: SpaceObject[]
  states: Record<number, SatelliteState>
  selectedId: number | null
  onSelect: (noradId: number) => void
  showFilters?: boolean
}) {
  const filters = useStore((s) => s.filters)
  const setFilters = useStore((s) => s.setFilters)

  const toggleSet = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    // Never let the operator filter the list down to nothing by accident.
    return next.size === 0 ? set : next
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showFilters && (
        <div className="shrink-0 space-y-2 border-b border-line-soft px-3 py-2.5">
          <label className="flex items-center gap-2 rounded-lg border border-line bg-deep px-2 py-1.5">
            <Search size={12} className="shrink-0 text-ink-faint" />
            <input
              value={filters.query}
              onChange={(e) => setFilters({ query: e.target.value })}
              placeholder="Name, NORAD id or designator"
              className="w-full bg-transparent font-mono text-[11px] text-ink outline-none placeholder:text-ink-faint"
            />
          </label>

          <div className="flex flex-wrap gap-1">
            {ALL_AGENCIES.map((agency: AgencyId) => (
              <FilterChip
                key={agency}
                label={agency}
                active={filters.agencies.has(agency)}
                onClick={() => setFilters({ agencies: toggleSet(filters.agencies, agency) })}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {ALL_TYPES.map((type: ObjectType) => (
              <FilterChip
                key={type}
                label={type.replace('_', ' ').toLowerCase()}
                active={filters.types.has(type)}
                onClick={() => setFilters({ types: toggleSet(filters.types, type) })}
              />
            ))}
          </div>
        </div>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {objects.length === 0 && (
          <li className="px-3 py-6 text-center text-[11px] text-ink-faint">
            No objects match the current filters.
          </li>
        )}
        {objects.map((obj) => {
          const state = states[obj.noradId]
          const selected = obj.noradId === selectedId
          return (
            <li key={obj.noradId}>
              <button
                type="button"
                onClick={() => onSelect(obj.noradId)}
                className={clsx(
                  'flex w-full items-center gap-2.5 border-l-2 px-3 py-2 text-left transition-colors',
                  selected
                    ? 'border-l-signal bg-signal/10'
                    : 'border-l-transparent hover:bg-raised/50',
                )}
              >
                <StatusDot tone={obj.health} pulse={obj.health === 'CRITICAL'} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] leading-tight text-ink">{obj.name}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-ink-faint">
                    {obj.noradId} · {obj.agency}
                  </p>
                </div>
                {state && (
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-[11px] tabular-nums text-ink-dim">
                      {state.altKm.toFixed(0)}
                      <span className="text-ink-faint"> km</span>
                    </p>
                    <p className="font-mono text-[10px] tabular-nums text-ink-faint">
                      {state.speedKmS.toFixed(2)} km/s
                    </p>
                  </div>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors',
        active
          ? 'border-signal/40 bg-signal/10 text-signal'
          : 'border-line bg-deep text-ink-faint hover:text-ink-dim',
      )}
    >
      {label}
    </button>
  )
}
