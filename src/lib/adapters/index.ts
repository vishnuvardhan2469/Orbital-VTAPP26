import { liveAdapter } from './live'
import { mockAdapter } from './mock'
import type { DataAdapter } from './types'

export type { DataAdapter, AdapterStatus } from './types'
export { mockAdapter } from './mock'
export { liveAdapter, parseTleCatalog } from './live'

/**
 * Adapter registry.
 *
 * Register a new source here and it shows up in the data-source switcher with
 * no other changes. Keep `mock` first — it is the safe default for a demo on
 * conference wifi.
 */
export const ADAPTERS: DataAdapter[] = [mockAdapter, liveAdapter]

export const DEFAULT_ADAPTER_ID = mockAdapter.id

export function getAdapter(id: string): DataAdapter {
  return ADAPTERS.find((a) => a.id === id) ?? mockAdapter
}
