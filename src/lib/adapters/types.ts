import type { EarthAOI, GroundStation, SpaceObject } from '@/lib/types'

/**
 * The single seam between Orbital Guard's UI and its data.
 *
 * Every page reads through this interface, so switching from generated demo
 * data to live NASA / ISRO / ESA feeds is one implementation swap — no
 * component changes. Add methods here as the problem statement demands them.
 */
export interface DataAdapter {
  readonly id: string
  readonly label: string
  /** Shown in the data-source panel so an operator knows what they are seeing. */
  readonly description: string
  readonly isLive: boolean

  /** The tracked catalog: satellites, rocket bodies and debris. */
  getCatalog(): Promise<SpaceObject[]>
  /** Ground segment: stations that can see the fleet. */
  getGroundStations(): Promise<GroundStation[]>
  /** Earth-observation areas of interest under watch. */
  getAOIs(): Promise<EarthAOI[]>
}

export interface AdapterStatus {
  adapterId: string
  state: 'IDLE' | 'LOADING' | 'READY' | 'ERROR'
  message?: string
  lastSync?: number
  recordCount?: number
}
