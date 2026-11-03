/**
 * Composants de base du design system AI Studio.
 */
import clsx from 'clsx'
import { Loader2, type LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function cn(...args: Parameters<typeof clsx>): string {
  return clsx(...args)
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'secondary',
  icon: Icon,
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: LucideIcon; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-[#06140d] hover:bg-accent-strong',
        variant === 'secondary' && 'border border-line-strong bg-surface-2 text-fg hover:bg-surface-3',
        variant === 'ghost' && 'text-fg-muted hover:bg-surface-2 hover:text-fg',
        variant === 'danger' && 'border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20',
        className
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" strokeWidth={1.75} /> : null}
      {children}
    </button>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-[var(--radius-card)] border border-line bg-surface', className)}>{children}</div>
}

export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div>
        <h3 className="text-[14px] font-semibold tracking-[-0.01em]">{title}</h3>
        {description && <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}

type BadgeTone = 'neutral' | 'local' | 'cloud' | 'accent' | 'warn' | 'danger'

export function Badge({ tone = 'neutral', children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold tracking-wide uppercase',
        tone === 'neutral' && 'bg-surface-3 text-fg-muted',
        tone === 'local' && 'bg-local/12 text-local',
        tone === 'cloud' && 'bg-cloud/12 text-cloud',
        tone === 'accent' && 'bg-accent-soft text-accent',
        tone === 'warn' && 'bg-warn/12 text-warn',
        tone === 'danger' && 'bg-danger/12 text-danger',
        className
      )}
    >
      {children}
    </span>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-6 pb-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13.5px] text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-surface-3'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform duration-200 ease-[var(--ease-out-soft)]',
          checked && 'translate-x-4'
        )}
      />
    </button>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-fg-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-fg-subtle">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'h-9 w-full rounded-lg border border-line-strong bg-bg px-3 text-[13.5px] text-fg placeholder:text-fg-subtle outline-none transition-colors focus:border-accent/60'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-2', className)} />
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11.5px] font-medium tracking-wide text-fg-subtle uppercase">{label}</div>
      <div className="mt-1 truncate text-[15px] font-semibold tracking-[-0.01em]">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[12px] text-fg-muted">{sub}</div>}
    </div>
  )
}

export function Meter({ value, max, tone = 'accent' }: { value: number; max: number; tone?: 'accent' | 'cloud' | 'warn' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out-soft)]',
          tone === 'accent' && 'bg-accent',
          tone === 'cloud' && 'bg-cloud',
          tone === 'warn' && 'bg-warn'
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10 * 1024 ? 0 : 1).replace('.', ',')} Go`
  return `${mb} Mo`
}
