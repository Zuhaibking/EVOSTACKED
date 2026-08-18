import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export function DbLabel({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-muted-foreground">
      {children}
    </p>
  )
}

export function DbBadge({
  tone = 'neutral',
  children,
}: {
  tone?: 'good' | 'warn' | 'bad' | 'neutral'
  children: ReactNode
}) {
  const toneClass =
    tone === 'good'
      ? 'text-brand-accent border-brand-accent/40 bg-brand-accent/10'
      : tone === 'warn'
        ? 'text-chart-4 border-chart-4/40 bg-chart-4/10'
        : tone === 'bad'
          ? 'text-destructive border-destructive/40 bg-destructive/10'
          : 'text-muted-foreground border-border bg-foreground/[0.03]'
  return (
    <span
      className={cn(
        'inline-flex items-center h-5 px-1.5 font-mono text-[9px] tracking-[0.14em] uppercase border',
        toneClass,
      )}
    >
      {children}
    </span>
  )
}

export function DbCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'good' | 'warn' | 'bad' | 'neutral'
}) {
  return (
    <div className="border border-border bg-card/70 px-3 py-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <DbLabel>{label}</DbLabel>
        {tone ? <DbBadge tone={tone}>{tone}</DbBadge> : null}
      </div>
      <p className="mt-2 font-display text-[22px] leading-none tabular text-foreground">
        {value}
      </p>
      {hint ? (
        <p className="mt-1.5 text-[12px] text-muted-foreground leading-snug">{hint}</p>
      ) : null}
    </div>
  )
}

export function DbEmpty({
  title,
  body,
}: {
  title: string
  body: string
}) {
  return (
    <div className="h-full min-h-[220px] flex flex-col items-center justify-center px-6 text-center">
      <DbLabel>Empty</DbLabel>
      <p className="mt-2 font-display text-[20px] text-foreground">{title}</p>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  )
}

export function DbError({ message }: { message: string }) {
  return (
    <div className="border border-destructive/30 bg-destructive/5 px-3 py-2">
      <DbLabel>Error</DbLabel>
      <p className="mt-1 text-[13px] text-foreground">{message}</p>
    </div>
  )
}

export function DbLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="h-full min-h-[180px] flex flex-col items-center justify-center">
      <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-brand shimmer-text">
        {label}
      </span>
    </div>
  )
}

export function DbSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-8 w-full min-w-0 border border-border bg-transparent px-2.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  )
}

export function DbTableFrame({
  columns,
  children,
}: {
  columns: string[]
  children: ReactNode
}) {
  return (
    <div className="border border-border overflow-auto">
      <table className="w-full text-left border-collapse min-w-[520px]">
        <thead className="sticky top-0 bg-card/95 backdrop-blur-sm">
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col}
                className="px-2.5 py-2 font-mono text-[9px] tracking-[0.16em] uppercase text-muted-foreground font-normal"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function cell(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return '—'
  }
}
