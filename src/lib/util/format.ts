/** Display formatting. Mission consoles favour fixed-width, unambiguous output. */

export const pad = (n: number, width = 2) => String(Math.floor(Math.abs(n))).padStart(width, '0')

/** Anything the app stores as a moment in time: epoch ms, Date, or ISO string. */
export type TimeLike = number | Date | string

const toDate = (t: TimeLike) => (t instanceof Date ? t : new Date(t))

/** UTC timestamp in the form ops teams read: 2026-09-09 14:03:22Z */
export function utc(t: TimeLike) {
  const d = toDate(t)
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`
  )
}

export function utcTime(t: TimeLike) {
  const d = toDate(t)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

/** "T-04:12:07" style countdown; negative deltas render as T+. */
export function countdown(deltaMs: number) {
  const sign = deltaMs < 0 ? '+' : '-'
  const s = Math.abs(deltaMs) / 1000
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return `T${sign}${pad(h)}:${pad(m)}:${pad(sec)}`
}

export function duration(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}m ${pad(s)}s`
}

export const km = (v: number, digits = 1) => `${v.toFixed(digits)} km`

export function relativeTime(t: number, now = Date.now()) {
  const s = Math.round((now - t) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

/** 12.4°N 77.6°E */
export function latLon(lat: number, lon: number) {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`
}
