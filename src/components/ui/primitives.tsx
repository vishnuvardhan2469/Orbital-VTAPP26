import clsx from 'clsx'
import type { ReactNode } from 'react'
import type { HealthState, Severity } from '@/lib/types'

/** Shared UI primitives. Every panel in the console is built from these. */

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  dense,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  dense?: boolean
}) {
  return (
    <section
      className={clsx(
        'flex min-h-0 flex-col rounded-xl border border-line bg-panel/80 backdrop-blur-sm',
        'shadow-[0_1px_0_0_rgba(255,255,255,.03)_inset,0_20px_40px_-30px_rgba(0,0,0,.9)]',
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex shrink-0 flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-line-soft px-4 py-3">
          <div className="min-w-0">
            {title && (
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-1 text-xs text-ink-faint">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx('min-h-0 flex-1', dense ? 'p-0' : 'p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

const SEVERITY_CLASS: Record<Severity, string> = {
  INFO: 'border-signal/30 bg-signal/10 text-signal',
  WARNING: 'border-solar/30 bg-solar/10 text-solar',
  CRITICAL: 'border-alert/40 bg-alert/10 text-alert',
}

const HEALTH_CLASS: Record<HealthState, string> = {
  NOMINAL: 'border-nominal/30 bg-nominal/10 text-nominal',
  CAUTION: 'border-solar/30 bg-solar/10 text-solar',
  CRITICAL: 'border-alert/40 bg-alert/10 text-alert',
  OFFLINE: 'border-line bg-raised text-ink-faint',
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: Severity | HealthState | 'neutral' | 'accent'
  className?: string
}) {
  const toneClass =
    tone === 'neutral'
      ? 'border-line bg-raised text-ink-dim'
      : tone === 'accent'
        ? 'border-plasma/30 bg-plasma/10 text-plasma'
        : tone in SEVERITY_CLASS
          ? SEVERITY_CLASS[tone as Severity]
          : HEALTH_CLASS[tone as HealthState]

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5',
        'font-mono text-[10px] font-medium uppercase tracking-wider whitespace-nowrap',
        toneClass,
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Small pulsing dot used for live/health indicators. */
export function StatusDot({ tone, pulse = false }: { tone: Severity | HealthState; pulse?: boolean }) {
  const color =
    tone === 'CRITICAL'
      ? 'bg-alert'
      : tone === 'WARNING' || tone === 'CAUTION'
        ? 'bg-solar'
        : tone === 'OFFLINE'
          ? 'bg-ink-faint'
          : tone === 'NOMINAL'
            ? 'bg-nominal'
            : 'bg-signal'

  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse && <span className={clsx('absolute inset-0 rounded-full opacity-70 animate-pulse-ring', color)} />}
      <span className={clsx('relative h-2 w-2 rounded-full', color)} />
    </span>
  )
}

export function StatTile({
  label,
  value,
  unit,
  hint,
  tone,
}: {
  label: string
  value: ReactNode
  unit?: string
  hint?: ReactNode
  tone?: Severity
}) {
  const valueColor =
    tone === 'CRITICAL' ? 'text-alert' : tone === 'WARNING' ? 'text-solar' : 'text-ink'

  return (
    <div className="rounded-lg border border-line bg-raised/40 px-3 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">{label}</p>
      <p className={clsx('mt-1 font-mono text-xl leading-none tabular-nums', valueColor)}>
        {value}
        {unit && <span className="ml-1 text-xs text-ink-faint">{unit}</span>}
      </p>
      {hint && <p className="mt-1.5 text-[11px] text-ink-faint">{hint}</p>}
    </div>
  )
}

/** Label / value row, monospaced so columns line up down a list. */
export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-[11px] text-ink-faint">{label}</span>
      <span className="truncate text-right font-mono text-xs tabular-nums text-ink">{value}</span>
    </div>
  )
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: Array<{ value: T; label: ReactNode; title?: string }>
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-deep p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          title={option.title}
          onClick={() => onChange(option.value)}
          className={clsx(
            'rounded-md font-mono uppercase tracking-wider transition-colors',
            size === 'sm' ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1.5 text-[11px]',
            option.value === value
              ? 'bg-signal/15 text-signal'
              : 'text-ink-faint hover:text-ink-dim',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex items-center gap-2 text-left"
    >
      <span
        className={clsx(
          'relative h-4 w-7 shrink-0 rounded-full border transition-colors',
          checked ? 'border-signal/50 bg-signal/25' : 'border-line bg-deep',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all',
            checked ? 'left-3.5 bg-signal' : 'left-0.5 bg-ink-faint',
          )}
        />
      </span>
      <span className="text-xs text-ink-dim group-hover:text-ink">{label}</span>
    </button>
  )
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  size = 'md',
  disabled,
  title,
  className,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'ghost' | 'primary' | 'danger'
  size?: 'sm' | 'md'
  disabled?: boolean
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-lg border font-mono uppercase tracking-wider transition-colors',
        size === 'sm' ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-[11px]',
        disabled && 'cursor-not-allowed opacity-40',
        variant === 'primary' && 'border-signal/40 bg-signal/15 text-signal hover:bg-signal/25',
        variant === 'danger' && 'border-alert/40 bg-alert/10 text-alert hover:bg-alert/20',
        variant === 'ghost' && 'border-line bg-raised/50 text-ink-dim hover:border-line hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** Horizontal bar for a 0..1 index, coloured by how close it is to the top. */
export function Meter({ value, tone }: { value: number; tone?: Severity }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  const color =
    tone === 'CRITICAL' ? 'bg-alert' : tone === 'WARNING' ? 'bg-solar' : 'bg-signal'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-deep">
      <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-1 px-6 py-8 text-center">
      <p className="font-mono text-xs uppercase tracking-wider text-ink-dim">{title}</p>
      {detail && <p className="max-w-sm text-[11px] text-ink-faint">{detail}</p>}
    </div>
  )
}

export function Loading({ label = 'Acquiring' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-3">
      <div className="relative h-8 w-8">
        <span className="absolute inset-0 rounded-full border border-line" />
        <span className="absolute inset-0 animate-spin rounded-full border-t border-signal" />
      </div>
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">{label}</p>
    </div>
  )
}

/** Page heading used at the top of every module. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-1">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-0.5 max-w-2xl text-xs text-ink-dim">{description}</p>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
