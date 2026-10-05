import { NavLink, Outlet } from 'react-router-dom'
import clsx from 'clsx'
import { Radio } from 'lucide-react'
import { MODULE_GROUPS, MODULES, modulesInGroup } from '@/modules/registry'
import { useFleetHealth, useUnacknowledgedAlerts, useStore } from '@/state/store'
import { Badge, StatusDot } from '@/components/ui/primitives'
import { MissionClock } from './MissionClock'

/** Application chrome: sidebar navigation, status bar and the routed page. */
export function AppShell() {
  const status = useStore((s) => s.status)
  const adapterId = useStore((s) => s.adapterId)
  const unacknowledged = useUnacknowledgedAlerts()
  const health = useFleetHealth()
  const conjunctions = useStore((s) => s.conjunctions)

  const criticalConjunctions = conjunctions.filter((c) => c.severity === 'CRITICAL').length

  const counts: Record<string, number> = {
    alerts: unacknowledged.length,
    conjunction: criticalConjunctions,
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-void bg-starfield text-ink">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className="flex w-14 shrink-0 flex-col border-r border-line bg-deep/70 backdrop-blur xl:w-56">
        <div className="flex items-center gap-2.5 border-b border-line px-3 py-4 xl:px-4">
          <span className="relative flex h-7 w-7 items-center justify-center rounded-lg border border-signal/30 bg-signal/10">
            <Radio size={14} className="text-signal" />
          </span>
          <div className="hidden leading-none xl:block">
            <p className="font-mono text-[13px] font-semibold tracking-[0.08em] text-ink">
              ORBITAL<span className="text-signal">GUARD</span>
            </p>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-ink-faint">
              space asset console
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {MODULE_GROUPS.map((group) => {
            const modules = modulesInGroup(group)
            if (modules.length === 0) return null
            return (
              <div key={group} className="mb-4">
                <p className="hidden px-2 pb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-ink-faint xl:block">
                  {group}
                </p>
                {modules.map((module) => (
                  <NavLink
                    key={module.id}
                    to={module.path}
                    end={module.path === '/'}
                    title={module.description}
                    className={({ isActive }) =>
                      clsx(
                        'group relative mb-0.5 flex items-center justify-center gap-2.5 rounded-lg px-2 py-2 text-[13px] transition-colors xl:justify-start',
                        isActive
                          ? 'bg-signal/10 text-ink'
                          : 'text-ink-dim hover:bg-raised/60 hover:text-ink',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <module.icon
                          size={15}
                          className={isActive ? 'text-signal' : 'text-ink-faint group-hover:text-ink-dim'}
                        />
                        <span className="hidden flex-1 truncate xl:block">{module.label}</span>
                        {counts[module.id] > 0 && (
                          <span className="absolute top-1 right-1 rounded bg-alert/20 px-1 py-0.5 font-mono text-[9px] text-alert xl:static xl:px-1.5 xl:text-[10px]">
                            {counts[module.id]}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>

        {/* ── Source status ─────────────────────────────────────────── */}
        <div className="border-t border-line px-3 py-3 xl:px-3">
          <div className="flex items-center gap-2">
            <StatusDot
              tone={status.state === 'ERROR' ? 'CRITICAL' : status.state === 'READY' ? 'NOMINAL' : 'CAUTION'}
              pulse={status.state === 'LOADING'}
            />
            <span className="hidden truncate font-mono text-[10px] uppercase tracking-wider text-ink-dim xl:inline">
              {adapterId === 'mock' ? 'simulated feed' : adapterId}
            </span>
          </div>
          <p className="mt-1.5 hidden font-mono text-[10px] text-ink-faint xl:block">
            {status.state === 'READY'
              ? `${status.recordCount} objects tracked`
              : status.state === 'ERROR'
                ? 'source unavailable'
                : status.state === 'LOADING'
                  ? 'acquiring…'
                  : 'idle'}
          </p>
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-deep/60 px-4 py-3 backdrop-blur sm:px-5">
          <div className="flex items-center gap-2.5">
            <Badge tone={health.worst === 'CRITICAL' ? 'CRITICAL' : health.worst === 'WARNING' ? 'WARNING' : 'NOMINAL'}>
              <StatusDot tone={health.worst} pulse={health.worst === 'CRITICAL'} />
              fleet {health.worst === 'INFO' ? 'nominal' : health.worst.toLowerCase()}
            </Badge>
            <span className="hidden font-mono text-[11px] text-ink-faint lg:inline">
              {health.counts.NOMINAL} nominal · {health.counts.CAUTION} caution · {health.counts.CRITICAL} critical
            </span>
          </div>

          <MissionClock />
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/** Route table derived from the module registry. */
export const ROUTES = MODULES.map((m) => ({ path: m.path, Component: m.component }))
