import { useEffect, useRef, useState } from 'react'
import { groundTrack, orbitalPeriodMin } from '@/lib/orbit/propagate'
import { footprintRadiusDeg, loadLandOutlines, project, type Ring } from '@/lib/util/geo'
import type { EarthAOI, GroundStation, SatelliteState, SpaceObject } from '@/lib/types'

/**
 * Equirectangular ground-track map, drawn on a 2D canvas.
 *
 * A canvas rather than SVG because the coastline is ~4 000 segments and the
 * whole thing is redrawn on every clock tick; a DOM node per segment would
 * stall. Everything is plain projection maths — no mapping library, no tiles,
 * no network.
 */

interface GroundTrackMapProps {
  objects: SpaceObject[]
  states: Record<number, SatelliteState>
  stations: GroundStation[]
  aois?: EarthAOI[]
  selectedId: number | null
  simTime: number
  onSelect?: (noradId: number) => void
  /** Draw one revolution of the selected object's track. */
  showTrack?: boolean
  showFootprint?: boolean
  showTerminator?: boolean
}

const COLORS = {
  ocean: '#070c16',
  land: '#132a3f',
  landEdge: '#20496b',
  graticule: 'rgba(56,189,248,0.07)',
  track: '#38bdf8',
  trackPast: 'rgba(56,189,248,0.28)',
  station: '#34d399',
  aoi: '#fbbf24',
  night: 'rgba(2,6,16,0.55)',
}

export function GroundTrackMap({
  objects,
  states,
  stations,
  aois = [],
  selectedId,
  simTime,
  onSelect,
  showTrack = true,
  showFootprint = true,
  showTerminator = true,
}: GroundTrackMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [land, setLand] = useState<Ring[]>([])
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    loadLandOutlines().then(setLand)
  }, [])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(() => {
      setSize({ width: wrap.clientWidth, height: wrap.clientHeight })
    })
    observer.observe(wrap)
    setSize({ width: wrap.clientWidth, height: wrap.clientHeight })
    return () => observer.disconnect()
  }, [])

  // Track geometry is expensive (one SGP4 call per sample), so it is recomputed
  // only when the selection changes or the clock moves by a minute.
  const trackRef = useRef<{ key: string; segments: ReturnType<typeof groundTrack> }>({
    key: '',
    segments: [],
  })
  const trackBucket = Math.floor(simTime / 60_000)

  useEffect(() => {
    if (!showTrack || selectedId === null) {
      trackRef.current = { key: '', segments: [] }
      return
    }
    const selected = objects.find((o) => o.noradId === selectedId)
    if (!selected) return

    const key = `${selectedId}:${trackBucket}`
    if (trackRef.current.key === key) return

    const period = orbitalPeriodMin(selected)
    // A whole revolution centred on now, so the operator sees where it came
    // from as well as where it is going.
    const start = new Date(simTime - (period / 2) * 60_000)
    trackRef.current = { key, segments: groundTrack(selected, start, period, 20) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bucketed on purpose
  }, [objects, selectedId, showTrack, trackBucket])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width === 0 || size.height === 0) return

    const dpr = Math.min(window.devicePixelRatio, 2)
    const { width, height } = size
    canvas.width = width * dpr
    canvas.height = height * dpr

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const px = (lon: number, lat: number) => project(lon, lat, width, height)

    // ── Ocean ─────────────────────────────────────────────────────────
    ctx.fillStyle = COLORS.ocean
    ctx.fillRect(0, 0, width, height)

    // ── Graticule ─────────────────────────────────────────────────────
    ctx.strokeStyle = COLORS.graticule
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let lon = -180; lon <= 180; lon += 30) {
      const p = px(lon, 0)
      ctx.moveTo(p.x, 0)
      ctx.lineTo(p.x, height)
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const p = px(0, lat)
      ctx.moveTo(0, p.y)
      ctx.lineTo(width, p.y)
    }
    ctx.stroke()

    // ── Land ──────────────────────────────────────────────────────────
    ctx.fillStyle = COLORS.land
    ctx.strokeStyle = COLORS.landEdge
    ctx.lineWidth = 0.6
    for (const ring of land) {
      ctx.beginPath()
      ring.forEach(([lon, lat], i) => {
        const p = px(lon, lat)
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      })
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }

    // ── Night shading ─────────────────────────────────────────────────
    if (showTerminator) drawNightShading(ctx, simTime, width, height)

    // ── Areas of interest ─────────────────────────────────────────────
    for (const aoi of aois) {
      const topLeft = px(aoi.lon - aoi.spanDeg, aoi.lat + aoi.spanDeg)
      const bottomRight = px(aoi.lon + aoi.spanDeg, aoi.lat - aoi.spanDeg)
      ctx.strokeStyle = COLORS.aoi
      ctx.globalAlpha = 0.55
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y)
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }

    // ── Ground stations ───────────────────────────────────────────────
    for (const station of stations) {
      const p = px(station.lon, station.lat)
      ctx.fillStyle = COLORS.station
      ctx.beginPath()
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 0.3
      ctx.beginPath()
      ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // ── Selected ground track ─────────────────────────────────────────
    const selectedState = selectedId !== null ? states[selectedId] : null

    if (showTrack) {
      for (const segment of trackRef.current.segments) {
        ctx.beginPath()
        segment.forEach((point, i) => {
          const p = px(point.lon, point.lat)
          if (i === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        })
        // Past is dimmed, future is bright — direction of travel is readable
        // without an arrowhead.
        ctx.strokeStyle = segment[0].t < simTime ? COLORS.trackPast : COLORS.track
        ctx.lineWidth = 1.4
        ctx.stroke()
      }
    }

    // ── Footprint ─────────────────────────────────────────────────────
    if (showFootprint && selectedState) {
      const radius = footprintRadiusDeg(selectedState.altKm)
      drawFootprint(ctx, selectedState.lat, selectedState.lon, radius, width, height)
    }

    // ── Satellites ────────────────────────────────────────────────────
    for (const obj of objects) {
      const state = states[obj.noradId]
      if (!state) continue
      const p = px(state.lon, state.lat)
      const selected = obj.noradId === selectedId

      ctx.beginPath()
      ctx.arc(p.x, p.y, selected ? 4 : 2.2, 0, Math.PI * 2)
      ctx.fillStyle = selected ? '#ffffff' : state.sunlit ? '#7dd3fc' : '#3f5d7a'
      ctx.fill()

      if (selected) {
        ctx.strokeStyle = COLORS.track
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2)
        ctx.stroke()

        ctx.font = '10px ui-monospace, monospace'
        ctx.fillStyle = '#e6edf9'
        ctx.fillText(obj.name, p.x + 11, p.y + 3)
      }
    }
  }, [land, objects, states, stations, aois, selectedId, simTime, size, showTrack, showFootprint, showTerminator])

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSelect) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    let nearest: { id: number; d: number } | null = null
    for (const obj of objects) {
      const state = states[obj.noradId]
      if (!state) continue
      const p = project(state.lon, state.lat, rect.width, rect.height)
      const d = Math.hypot(p.x - x, p.y - y)
      if (d < 10 && (!nearest || d < nearest.d)) nearest = { id: obj.noradId, d }
    }
    if (nearest) onSelect(nearest.id)
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="h-full w-full cursor-crosshair"
        style={{ width: size.width, height: size.height }}
      />
    </div>
  )
}

/**
 * Shades the night hemisphere.
 *
 * Computes the sub-solar point from the date, then for each pixel column finds
 * the latitude where the sun sits exactly on the horizon and fills the dark
 * side of that curve. Cheap, and accurate enough to read at map scale.
 */
function drawNightShading(
  ctx: CanvasRenderingContext2D,
  t: number,
  width: number,
  height: number,
) {
  const date = new Date(t)
  const dayOfYear = (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000

  // Solar declination — the standard Cooper approximation, ±0.5° all year.
  const declination = 23.45 * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81))

  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600
  const subSolarLon = 180 - utcHours * 15

  const toRad = (d: number) => (d * Math.PI) / 180
  const decl = toRad(declination)

  ctx.fillStyle = COLORS.night
  ctx.beginPath()

  const points: Array<{ x: number; y: number }> = []
  for (let i = 0; i <= width; i++) {
    const lon = (i / width) * 360 - 180
    const hourAngle = toRad(lon - subSolarLon)
    // Terminator latitude: where cos(zenith) = 0.
    const lat = Math.atan(-Math.cos(hourAngle) / Math.tan(decl)) * (180 / Math.PI)
    points.push(project(lon, lat, width, height))
  }

  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))

  // Close the polygon along whichever pole is in darkness.
  if (declination > 0) {
    ctx.lineTo(width, height)
    ctx.lineTo(0, height)
  } else {
    ctx.lineTo(width, 0)
    ctx.lineTo(0, 0)
  }
  ctx.closePath()
  ctx.fill()
}

/** Satellite footprint, sampled as a circle of constant angular radius. */
function drawFootprint(
  ctx: CanvasRenderingContext2D,
  latDeg: number,
  lonDeg: number,
  radiusDeg: number,
  width: number,
  height: number,
) {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI

  const lat0 = toRad(latDeg)
  const lon0 = toRad(lonDeg)
  const r = toRad(radiusDeg)

  ctx.strokeStyle = 'rgba(34,211,238,0.5)'
  ctx.fillStyle = 'rgba(34,211,238,0.07)'
  ctx.lineWidth = 1

  let previousX: number | null = null
  ctx.beginPath()

  for (let i = 0; i <= 120; i++) {
    const bearing = (i / 120) * 2 * Math.PI
    const lat = Math.asin(Math.sin(lat0) * Math.cos(r) + Math.cos(lat0) * Math.sin(r) * Math.cos(bearing))
    const lon =
      lon0 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(r) * Math.cos(lat0),
        Math.cos(r) - Math.sin(lat0) * Math.sin(lat),
      )

    const lonDegWrapped = ((toDeg(lon) + 540) % 360) - 180
    const p = project(lonDegWrapped, toDeg(lat), width, height)

    // Start a fresh subpath when the circle wraps the dateline, otherwise it
    // draws a band straight across the map.
    if (previousX !== null && Math.abs(p.x - previousX) > width / 2) ctx.moveTo(p.x, p.y)
    else if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)

    previousX = p.x
  }
  ctx.stroke()
}
