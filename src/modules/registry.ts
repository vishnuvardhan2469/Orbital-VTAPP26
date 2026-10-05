import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import {
  AlertTriangle,
  Activity,
  Database,
  Globe2,
  LayoutDashboard,
  Radar,
  Satellite,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Pages are loaded on demand. Three.js and Recharts together are most of the
 * bundle and each is needed by only some of the modules, so splitting here
 * keeps the first paint of the console small.
 */
const OverviewPage = lazy(() => import('./overview/OverviewPage').then((m) => ({ default: m.OverviewPage })))
const TrackingPage = lazy(() => import('./tracking/TrackingPage').then((m) => ({ default: m.TrackingPage })))
const EarthPage = lazy(() => import('./earth/EarthPage').then((m) => ({ default: m.EarthPage })))
const TelemetryPage = lazy(() => import('./telemetry/TelemetryPage').then((m) => ({ default: m.TelemetryPage })))
const ConjunctionPage = lazy(() => import('./conjunction/ConjunctionPage').then((m) => ({ default: m.ConjunctionPage })))
const AlertsPage = lazy(() => import('./alerts/AlertsPage').then((m) => ({ default: m.AlertsPage })))
const SourcesPage = lazy(() => import('./sources/SourcesPage').then((m) => ({ default: m.SourcesPage })))

/**
 * Module registry — the extension point of this app.
 *
 * Adding a capability means writing one page component and appending one entry
 * here. Navigation, routing and the command palette all read from this list,
 * so nothing else needs to change. When the hackathon problem statement lands,
 * a new module slots in beside the existing ones rather than displacing them.
 */

export interface ModuleDef {
  id: string
  /** Route path, relative to the app root. */
  path: string
  label: string
  description: string
  icon: LucideIcon
  component: LazyExoticComponent<ComponentType>
  /** Grouping in the sidebar. */
  group: 'OPERATIONS' | 'ANALYSIS' | 'SYSTEM'
}

export const MODULES: ModuleDef[] = [
  {
    id: 'overview',
    path: '/',
    label: 'Mission Control',
    description: 'Fleet status, live passes and the current threat picture at a glance.',
    icon: LayoutDashboard,
    component: OverviewPage,
    group: 'OPERATIONS',
  },
  {
    id: 'tracking',
    path: '/tracking',
    label: 'Orbit Tracker',
    description: 'SGP4 propagation of the tracked catalog, in 3D and on the ground track.',
    icon: Satellite,
    component: TrackingPage,
    group: 'OPERATIONS',
  },
  {
    id: 'earth',
    path: '/earth',
    label: 'Earth Watch',
    description: 'Areas of interest, revisit planning and change indices from Earth observation.',
    icon: Globe2,
    component: EarthPage,
    group: 'OPERATIONS',
  },
  {
    id: 'telemetry',
    path: '/telemetry',
    label: 'Telemetry',
    description: 'Live housekeeping channels with streaming anomaly detection.',
    icon: Activity,
    component: TelemetryPage,
    group: 'ANALYSIS',
  },
  {
    id: 'conjunction',
    path: '/conjunction',
    label: 'Collision Risk',
    description: 'Close-approach screening across the catalog with refined time of closest approach.',
    icon: Radar,
    component: ConjunctionPage,
    group: 'ANALYSIS',
  },
  {
    id: 'alerts',
    path: '/alerts',
    label: 'Alert Feed',
    description: 'Every event the console has raised, in one acknowledgeable log.',
    icon: AlertTriangle,
    component: AlertsPage,
    group: 'ANALYSIS',
  },
  {
    id: 'sources',
    path: '/sources',
    label: 'Data Sources',
    description: 'Which feed the console is reading, and how to point it somewhere else.',
    icon: Database,
    component: SourcesPage,
    group: 'SYSTEM',
  },
]

export const MODULE_GROUPS = ['OPERATIONS', 'ANALYSIS', 'SYSTEM'] as const

export function modulesInGroup(group: ModuleDef['group']) {
  return MODULES.filter((m) => m.group === group)
}
