import { Pause, Play, RotateCcw } from 'lucide-react'
import { TIME_SCALES, useStore } from '@/state/store'
import { utc } from '@/lib/util/format'
import { Button, Segmented } from '@/components/ui/primitives'

/**
 * Mission clock.
 *
 * Every view renders against this clock rather than wall time, so the console
 * can be paused mid-event or run fast to reach a conjunction. The offset from
 * real time is shown whenever it is non-zero — an operator must never mistake
 * a fast-forwarded display for live truth.
 */
export function MissionClock() {
  const simTime = useStore((s) => s.simTime)
  const playing = useStore((s) => s.playing)
  const timeScale = useStore((s) => s.timeScale)
  const setPlaying = useStore((s) => s.setPlaying)
  const setTimeScale = useStore((s) => s.setTimeScale)
  const resetClock = useStore((s) => s.resetClock)

  const offsetMs = simTime - Date.now()
  const offsetMinutes = Math.round(offsetMs / 60_000)
  const drifted = Math.abs(offsetMinutes) >= 1

  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className="font-mono text-sm leading-none tabular-nums text-ink">{utc(simTime)}</p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          {drifted ? (
            <span className="text-solar">
              simulated · {offsetMinutes > 0 ? '+' : ''}
              {offsetMinutes} min from now
            </span>
          ) : (
            'mission time · utc'
          )}
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant={playing ? 'ghost' : 'primary'}
          onClick={() => setPlaying(!playing)}
          title={playing ? 'Pause the mission clock' : 'Resume the mission clock'}
        >
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </Button>
        <Button size="sm" onClick={resetClock} title="Return the clock to real time">
          <RotateCcw size={12} />
        </Button>
      </div>

      <div className="hidden lg:block">
      <Segmented
        size="sm"
        value={timeScale}
        onChange={setTimeScale}
        options={TIME_SCALES.map((scale) => ({
          value: scale,
          label: scale === 1 ? '1×' : scale >= 60 ? `${scale / 60}m/s` : `${scale}×`,
          title: `${scale} simulated seconds per real second`,
        }))}
      />
      </div>
    </div>
  )
}
