import { Suspense, useEffect, useRef } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { Loading } from '@/components/ui/primitives'
import { MODULES } from '@/modules/registry'
import { useStore } from '@/state/store'

/**
 * Mission clock ticker.
 *
 * One requestAnimationFrame loop drives the whole app: it advances simulated
 * time and re-propagates the catalog. Propagation is throttled to 5 Hz because
 * SGP4 over the catalog costs more than a frame's budget and nothing on screen
 * moves visibly faster than that.
 */
function useMissionClock() {
  const tick = useStore((s) => s.tick)
  const lastRef = useRef(performance.now())
  const accumulatorRef = useRef(0)

  useEffect(() => {
    let frame = 0
    const PROPAGATE_INTERVAL_MS = 200

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop)
      const delta = now - lastRef.current
      lastRef.current = now
      accumulatorRef.current += delta

      if (accumulatorRef.current >= PROPAGATE_INTERVAL_MS) {
        tick(accumulatorRef.current)
        accumulatorRef.current = 0
      }
    }

    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [tick])
}

export default function App() {
  const loadSource = useStore((s) => s.loadSource)
  const adapterId = useStore((s) => s.adapterId)
  // StrictMode mounts, unmounts and remounts every component in development.
  // Refs survive that, so this guard keeps the initial fetch to one — otherwise
  // the alert feed opens with a duplicate "catalog loaded" entry.
  const loadedRef = useRef(false)

  useMissionClock()

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void loadSource(adapterId)
    // Only on mount: switching sources goes through the data-source page,
    // which calls loadSource itself.
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          {MODULES.map((module) => (
            <Route
              key={module.id}
              path={module.path}
              element={
                <Suspense fallback={<Loading label={`Loading ${module.label}`} />}>
                  <module.component />
                </Suspense>
              }
            />
          ))}
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
