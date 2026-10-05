import type { AgencyId, EarthAOI, GroundStation, ObjectType, SpaceObject } from '@/lib/types'
import { mockAdapter } from './mock'
import type { DataAdapter } from './types'

/**
 * Live-data adapter.
 *
 * This is the file to edit when the problem statement names its data sources.
 * The catalog path is already wired to Celestrak's public GP endpoint; ground
 * stations and AOIs fall back to the simulated set until real sources exist,
 * which keeps the whole app usable while only part of it is live.
 *
 * Endpoints worth knowing:
 *   Celestrak GP      https://celestrak.org/NORAD/elements/gp.php?GROUP=<g>&FORMAT=json
 *   Space-Track       https://www.space-track.org/basicspacedata/query/...   (login required)
 *   NASA EONET        https://eonet.gsfc.nasa.gov/api/v3/events              (natural events)
 *   NASA GIBS/WMTS    https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/    (imagery tiles)
 *   NASA FIRMS        https://firms.modaps.eosdis.nasa.gov/api/area/         (active fire, key)
 *   ISRO Bhuvan       https://bhuvan-app1.nrsc.gov.in/api/                   (Indian EO)
 *   ESA Copernicus    https://catalogue.dataspace.copernicus.eu/odata/v1/    (Sentinel scenes)
 *
 * Several of these do not send CORS headers, so a browser fetch will be blocked.
 * When that happens, put a small proxy in front of them rather than weakening
 * the front end — see README, "Going live".
 */

const CELESTRAK_GP = 'https://celestrak.org/NORAD/elements/gp.php'

/** Celestrak groups that map onto the agencies this console cares about. */
const GROUPS = ['stations', 'resource', 'weather', 'sarsat'] as const

function inferAgency(name: string): AgencyId {
  const n = name.toUpperCase()
  if (/SENTINEL|METOP|CRYOSAT|SWARM|PROBA|BIOMASS|AEOLUS/.test(n)) return 'ESA'
  if (/CARTOSAT|RISAT|OCEANSAT|RESOURCESAT|GSAT|INSAT|EOS-|HYSIS|ASTROSAT/.test(n)) return 'ISRO'
  if (/NOAA|GOES|SUOMI|JPSS/.test(n)) return 'NOAA'
  if (/ISS|LANDSAT|TERRA|AQUA|AURA|ICESAT|SWOT|TESS|PACE/.test(n)) return 'NASA'
  return 'OTHER'
}

function inferType(name: string): ObjectType {
  const n = name.toUpperCase()
  if (n.includes('DEB')) return 'DEBRIS'
  if (/R\/B|ROCKET/.test(n)) return 'ROCKET_BODY'
  return 'PAYLOAD'
}

async function fetchGroup(group: string, signal?: AbortSignal): Promise<SpaceObject[]> {
  const url = `${CELESTRAK_GP}?GROUP=${encodeURIComponent(group)}&FORMAT=tle`
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Celestrak ${group}: HTTP ${response.status}`)

  const text = await response.text()
  return parseTleCatalog(text)
}

/** Parse the classic 3-line TLE text format Celestrak serves. */
export function parseTleCatalog(text: string): SpaceObject[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean)
  const out: SpaceObject[] = []

  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i]
    const l1 = lines[i + 1]
    const l2 = lines[i + 2]
    if (!l1?.startsWith('1 ') || !l2?.startsWith('2 ')) continue

    const noradId = Number(l1.slice(2, 7).trim())
    if (!Number.isFinite(noradId)) continue

    const epochYear = Number(l1.slice(18, 20))
    const epochDay = Number(l1.slice(20, 32))
    const fullYear = epochYear < 57 ? 2000 + epochYear : 1900 + epochYear
    const epoch = new Date(Date.UTC(fullYear, 0, 1) + (epochDay - 1) * 86_400_000)

    out.push({
      noradId,
      name: name.trim(),
      agency: inferAgency(name),
      type: inferType(name),
      intlDesignator: l1.slice(9, 17).trim(),
      tle: [l1, l2],
      epoch: epoch.toISOString(),
      health: 'NOMINAL',
    })
  }
  return out
}

export const liveAdapter: DataAdapter = {
  id: 'live',
  label: 'Celestrak (live)',
  description:
    'Fetches current GP element sets from Celestrak over the public internet. Requires ' +
    'network access; ground stations and AOIs still come from the simulated set.',
  isLive: true,

  async getCatalog() {
    const results = await Promise.allSettled(GROUPS.map((g) => fetchGroup(g)))
    const objects = new Map<number, SpaceObject>()

    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      for (const obj of result.value) objects.set(obj.noradId, obj)
    }

    if (objects.size === 0) {
      throw new Error(
        'No element sets returned. Celestrak may be unreachable, or the browser blocked ' +
          'the request (CORS). Falling back to the simulated catalog is safe.',
      )
    }
    return [...objects.values()]
  },

  // No public source is wired for these yet — the simulated set keeps the
  // ground-segment and Earth-watch pages working while the catalog is live.
  getGroundStations(): Promise<GroundStation[]> {
    return mockAdapter.getGroundStations()
  },

  getAOIs(): Promise<EarthAOI[]> {
    return mockAdapter.getAOIs()
  },
}
