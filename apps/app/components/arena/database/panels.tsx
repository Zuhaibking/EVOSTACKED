'use client'

import {
  filterRecords,
  sortRecords,
  type DatabaseSection,
  type WorkflowStep,
  type WorkspaceLog,
} from '@/lib/database-control-center'
import type {
  GeneratedDbTable,
  GeneratedEndpoint,
  GeneratedEnvVar,
  GeneratedIntegration,
  GeneratedProjectDatabase,
  GeneratedSecuritySignal,
} from '@/lib/generated-project-database'
import {
  DbBadge,
  DbCard,
  DbEmpty,
  DbLabel,
  DbSearch,
  DbTableFrame,
  cell,
} from '@/components/arena/database/ui'
import { useMemo, useState, type ReactNode } from 'react'

export type DataSource = {
  id: string
  label: string
  origin: 'project' | 'platform'
  rows: Record<string, unknown>[]
  available: boolean
  emptyReason?: string
}

function toneFromStatus(status: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (/pass|ok|live|done|healthy|active|signed/i.test(status)) return 'good'
  if (/warn|partial|pending/i.test(status)) return 'warn'
  if (/fail|error|bad|missing|down/i.test(status)) return 'bad'
  return 'neutral'
}

function RecordDetail({
  row,
  onClose,
}: {
  row: Record<string, unknown>
  onClose: () => void
}) {
  return (
    <aside className="w-full lg:w-[280px] shrink-0 border-t lg:border-t-0 lg:border-l border-border overflow-y-auto">
      <div className="flex items-center justify-between px-3 h-10 border-b border-border">
        <DbLabel>Record</DbLabel>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>
      <dl className="p-3 space-y-2.5">
        {Object.entries(row).map(([key, value]) => (
          <div key={key}>
            <dt className="font-mono text-[9px] tracking-[0.16em] uppercase text-muted-foreground">
              {key}
            </dt>
            <dd className="mt-0.5 text-[12px] break-words text-foreground">
              {cell(value)}
            </dd>
          </div>
        ))}
      </dl>
    </aside>
  )
}

function Grid({
  rows,
  emptyTitle,
  emptyBody,
}: {
  rows: Record<string, unknown>[]
  emptyTitle: string
  emptyBody: string
}) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [selected, setSelected] = useState<number | null>(null)

  const columns = useMemo(() => {
    const keys = new Set<string>()
    for (const row of rows.slice(0, 40)) {
      Object.keys(row).forEach((k) => keys.add(k))
    }
    return [...keys].slice(0, 8)
  }, [rows])

  const visible = useMemo(
    () => sortRecords(filterRecords(rows, query), sortKey, sortDir),
    [rows, query, sortKey, sortDir],
  )

  if (rows.length === 0) {
    return <DbEmpty title={emptyTitle} body={emptyBody} />
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
      <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <DbSearch
            value={query}
            onChange={setQuery}
            placeholder="Search records"
          />
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular">
            {visible.length}
          </span>
        </div>
        <div className="flex-1 min-h-0">
          <DbTableFrame
            columns={columns.map((c) =>
              sortKey === c ? `${c} ${sortDir === 'asc' ? '↑' : '↓'}` : c,
            )}
          >
            {visible.map((row, index) => (
              <tr
                key={index}
                onClick={() => setSelected(index)}
                className={`border-b border-border/70 cursor-pointer transition-colors ${
                  selected === index
                    ? 'bg-foreground/[0.07]'
                    : 'hover:bg-foreground/[0.04]'
                }`}
              >
                {columns.map((col) => (
                  <td
                    key={col}
                    className="px-2.5 py-1.5 font-mono text-[11px] text-foreground/90 max-w-[220px] truncate"
                  >
                    {cell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </DbTableFrame>
        </div>
        <div className="flex flex-wrap gap-1">
          {columns.map((col) => (
            <button
              key={col}
              type="button"
              onClick={() => {
                if (sortKey === col) {
                  setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                } else {
                  setSortKey(col)
                  setSortDir('asc')
                }
              }}
              className="h-6 px-2 border border-border font-mono text-[9px] tracking-[0.12em] uppercase text-muted-foreground hover:text-foreground"
            >
              Sort {col}
            </button>
          ))}
        </div>
      </div>
      {selected != null && visible[selected] ? (
        <RecordDetail row={visible[selected]} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  )
}

export function OverviewPanel({
  inspection,
  projectName,
  recordCount,
  recentLogs,
}: {
  inspection: GeneratedProjectDatabase
  projectName?: string
  recordCount: number
  recentLogs: WorkspaceLog[]
}) {
  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <header>
        <DbLabel>Overview</DbLabel>
        <h2 className="mt-1 font-display text-[24px] text-foreground">
          {projectName || 'Generated project'}
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground max-w-xl">
          Database information for this generated project, inspected from its
          own schema and data files.
        </p>
      </header>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        <DbCard
          label="Project database"
          value={inspection.configured ? 'Detected' : 'None'}
          hint={
            inspection.configured
              ? `${inspection.provider || 'schema'} · ${inspection.tables.length} models`
              : 'No Prisma, Drizzle, or SQL artifacts in this project'
          }
          tone={inspection.configured ? 'good' : 'neutral'}
        />
        <DbCard
          label="Tables"
          value={inspection.tables.length}
          hint="Models parsed from the generated project schema"
        />
        <DbCard
          label="Project records"
          value={recordCount}
          hint="Rows found in generated project data files"
        />
        <DbCard
          label="Schema files"
          value={inspection.files.length}
          hint="Database-related files in the generated project"
        />
      </div>

      <section className="border border-border">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <DbLabel>Recent activity</DbLabel>
          <DbBadge tone={recentLogs.some((l) => l.level === 'error') ? 'bad' : 'neutral'}>
            {recentLogs.length} events
          </DbBadge>
        </div>
        {recentLogs.length === 0 ? (
          <p className="px-3 py-4 text-[13px] text-muted-foreground">
            No preview diagnostics are available for this generated project yet.
          </p>
        ) : (
          <ul>
            {recentLogs.slice(0, 8).map((log) => (
              <li
                key={log.id}
                className="px-3 py-2 border-t border-border/70 flex items-start gap-3"
              >
                <DbBadge tone={toneFromStatus(log.level)}>{log.level}</DbBadge>
                <div className="min-w-0">
                  <p className="font-mono text-[11px] text-foreground truncate">
                    {log.message}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {log.source}
                    {log.timestamp ? ` · ${log.timestamp}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export function TablesPanel({
  inspection,
}: {
  inspection: GeneratedProjectDatabase
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const generated = inspection.tables.filter((table) =>
    `${table.name} ${table.mappedName || ''} ${table.source}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  )
  const activeGenerated = generated.find(
    (t) => `project:${t.name}:${t.filePath}` === selected,
  )

  return (
    <div className="h-full min-h-0 flex">
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="p-3 flex items-center gap-2 border-b border-border">
          <DbSearch value={query} onChange={setQuery} placeholder="Search tables" />
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-3 space-y-4">
          <section>
            <DbLabel>Generated project</DbLabel>
            {generated.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted-foreground">
                No generated schema tables were detected in this project.
              </p>
            ) : (
              <div className="mt-2 border border-border">
                {generated.map((table) => {
                  const id = `project:${table.name}:${table.filePath}`
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSelected(id)}
                      className={`w-full text-left px-3 py-2 border-b border-border/70 last:border-0 transition-colors ${
                        selected === id
                          ? 'bg-foreground/[0.06]'
                          : 'hover:bg-foreground/[0.03]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[12px]">{table.name}</span>
                        <DbBadge>{table.source}</DbBadge>
                      </div>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground truncate">
                        {table.columns.length} columns
                        {table.mappedName ? ` · ${table.mappedName}` : ''}
                        {table.primaryKeys.length
                          ? ` · pk ${table.primaryKeys.join(', ')}`
                          : ''}
                      </p>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>
      <aside className="hidden md:block w-[300px] shrink-0 border-l border-border overflow-y-auto">
        {activeGenerated ? (
          <TableDetail table={activeGenerated} />
        ) : (
          <div className="p-6">
            <DbEmpty
              title="Select a table"
              body="Models come from this generated project's schema files."
            />
          </div>
        )}
      </aside>
    </div>
  )
}

function TableDetail({ table }: { table: GeneratedDbTable }) {
  return (
    <div className="p-3 space-y-3">
      <DbLabel>{table.source}</DbLabel>
      <h3 className="font-display text-[20px]">{table.name}</h3>
      <p className="font-mono text-[10px] text-muted-foreground break-all">
        {table.filePath}
        {table.mappedName ? ` · ${table.mappedName}` : ''}
      </p>
      {table.primaryKeys.length > 0 ? (
        <p className="text-[12px] text-muted-foreground">
          Primary key: {table.primaryKeys.join(', ')}
        </p>
      ) : null}
      <div className="border border-border">
        {table.columns.map((col) => (
          <div
            key={col.name}
            className="px-2.5 py-1.5 border-b border-border/70 last:border-0"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px]">{col.name}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {col.type}
                {col.isArray ? '[]' : ''}
                {col.optional ? '?' : ''}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {col.isPrimaryKey ? <DbBadge tone="good">pk</DbBadge> : null}
              {col.isUnique ? <DbBadge>unique</DbBadge> : null}
              {col.isRelation ? (
                <DbBadge tone="neutral">→ {col.relationTo}</DbBadge>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {table.relations.length > 0 ? (
        <div>
          <DbLabel>Relationships</DbLabel>
          <ul className="mt-1 space-y-1">
            {table.relations.map((rel) => (
              <li key={`${rel.field}-${rel.to}`} className="font-mono text-[11px]">
                {rel.field} → {rel.to} ({rel.kind})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export function DataPanel({ sources }: { sources: DataSource[] }) {
  const [active, setActive] = useState(sources[0]?.id || '')
  const source = sources.find((s) => s.id === active) || sources[0]

  if (!source) {
    return (
      <DbEmpty
        title="No readable data"
        body="This workspace only shows records returned by existing APIs or JSON files in the generated project."
      />
    )
  }

  return (
    <div className="h-full min-h-0 flex">
      <aside className="w-[180px] shrink-0 border-r border-border overflow-y-auto">
        {sources.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActive(item.id)}
            className={`w-full text-left px-3 py-2 border-b border-border/60 ${
              item.id === source.id
                ? 'bg-foreground/[0.06] text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="block font-mono text-[11px] truncate">{item.label}</span>
            <span className="block font-mono text-[9px] uppercase tracking-[0.14em]">
              {item.origin}
              {item.available ? ` · ${item.rows.length}` : ''}
            </span>
          </button>
        ))}
      </aside>
      {source.available ? (
        <Grid
          rows={source.rows}
          emptyTitle={`No ${source.label} rows`}
          emptyBody={
            source.emptyReason ||
            'The endpoint responded, but there are no records for this run.'
          }
        />
      ) : (
        <DbEmpty
          title={`${source.label} is not readable`}
          body={
            source.emptyReason ||
            'The current backend does not expose a list endpoint for this table.'
          }
        />
      )}
    </div>
  )
}

export function UsersPanel({
  users,
}: {
  users: Record<string, unknown>[]
  signedIn?: boolean
}) {
  if (users.length === 0) {
    return (
      <DbEmpty
        title="No project users"
        body="This generated project has no user records in its data files."
      />
    )
  }
  return (
    <Grid
      rows={users}
      emptyTitle="No project users"
      emptyBody="No user records are available."
    />
  )
}

export function AnalyticsPanel({
  metrics,
}: {
  metrics: { label: string; value: number; hint: string }[]
}) {
  const max = Math.max(1, ...metrics.map((m) => m.value))
  if (metrics.every((m) => m.value === 0)) {
    return (
      <DbEmpty
        title="No analytics yet"
        body="Counts appear here only after this run has messages, versions, logs, or generated schema."
      />
    )
  }
  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      <DbLabel>Analytics</DbLabel>
      <p className="text-[13px] text-muted-foreground">
        Observed counts only. Nothing here is estimated or filled in.
      </p>
      {metrics.map((metric) => (
        <div key={metric.label} className="border border-border px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em]">
              {metric.label}
            </span>
            <span className="font-display text-[20px] tabular">{metric.value}</span>
          </div>
          <div className="mt-2 h-1 bg-foreground/10">
            <div
              className="h-full bg-brand transition-all duration-300"
              style={{ width: `${Math.round((metric.value / max) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">{metric.hint}</p>
        </div>
      ))}
    </div>
  )
}

export function ApiPanel({
  generated,
}: {
  generated: GeneratedEndpoint[]
  apiUp?: boolean | null
}) {
  const rows = generated.map((e) => ({
    method: e.method,
    route: e.route,
    description: e.description || e.filePath,
    status: 'detected',
  }))

  if (rows.length === 0) {
    return (
      <DbEmpty
        title="No generated API routes"
        body="No App Router, Pages API, or framework route handlers were detected in this generated project."
      />
    )
  }

  return (
    <div className="h-full min-h-0 flex flex-col p-3 gap-2">
      <p className="text-[13px] text-muted-foreground">
        Routes parsed from this generated project source.
      </p>
      <div className="flex-1 min-h-0">
        <DbTableFrame columns={['method', 'route', 'status', 'description']}>
          {rows.map((row) => (
            <tr key={`${row.method}:${row.route}:${row.description}`} className="border-b border-border/70">
              <td className="px-2.5 py-1.5 font-mono text-[11px]">{row.method}</td>
              <td className="px-2.5 py-1.5 font-mono text-[11px]">{row.route}</td>
              <td className="px-2.5 py-1.5">
                <DbBadge tone={toneFromStatus(row.status)}>{row.status}</DbBadge>
              </td>
              <td className="px-2.5 py-1.5 text-[12px] text-muted-foreground">
                {row.description}
              </td>
            </tr>
          ))}
        </DbTableFrame>
      </div>
    </div>
  )
}

export function IntegrationsPanel({
  generated,
  extras = [],
}: {
  generated: GeneratedIntegration[]
  extras?: GeneratedIntegration[]
}) {
  const items = [...generated, ...extras]
  if (items.length === 0) {
    return (
      <DbEmpty
        title="No integrations configured"
        body="Nothing in the generated project looks like a connected integration."
      />
    )
  }
  return (
    <div className="h-full overflow-y-auto p-3 grid grid-cols-1 md:grid-cols-2 gap-2 content-start">
      {items.map((item) => (
        <div key={`${item.name}-${item.evidence}`} className="border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-[18px]">{item.name}</h3>
            <DbBadge>{item.kind}</DbBadge>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">{item.evidence}</p>
        </div>
      ))}
    </div>
  )
}

export function EnvironmentPanel({
  generated,
}: {
  generated: GeneratedEnvVar[]
}) {
  const rows = generated.map((v) => ({ ...v, origin: 'project' }))
  if (rows.length === 0) {
    return (
      <DbEmpty
        title="No environment files"
        body="Safe variable names appear here when the generated project includes env examples."
      />
    )
  }
  return (
    <div className="h-full min-h-0 p-3">
      <p className="mb-2 text-[13px] text-muted-foreground">
        Names and configured state only. Secret values are never displayed.
      </p>
      <DbTableFrame columns={['name', 'origin', 'configured', 'sensitivity']}>
        {rows.map((row) => (
          <tr key={`${row.origin}:${row.name}:${row.filePath}`} className="border-b border-border/70">
            <td className="px-2.5 py-1.5 font-mono text-[11px]">{row.name}</td>
            <td className="px-2.5 py-1.5 font-mono text-[10px] uppercase text-muted-foreground">
              {row.origin}
            </td>
            <td className="px-2.5 py-1.5">
              <DbBadge tone={row.configured ? 'good' : 'neutral'}>
                {row.configured ? 'set' : 'empty'}
              </DbBadge>
            </td>
            <td className="px-2.5 py-1.5">
              <DbBadge tone={row.secret ? 'warn' : 'neutral'}>
                {row.secret ? 'secret' : 'public'}
              </DbBadge>
            </td>
          </tr>
        ))}
      </DbTableFrame>
    </div>
  )
}

export function LogsPanel({ logs }: { logs: WorkspaceLog[] }) {
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<'all' | 'error' | 'warn' | 'info'>('all')
  const visible = logs.filter((log) => {
    if (level !== 'all' && log.level !== level) return false
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      log.message.toLowerCase().includes(q) ||
      log.source.toLowerCase().includes(q)
    )
  })

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="p-3 flex flex-wrap gap-2 border-b border-border">
        <div className="flex-1 min-w-[180px]">
          <DbSearch value={query} onChange={setQuery} placeholder="Search logs" />
        </div>
        {(['all', 'error', 'warn', 'info'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setLevel(item)}
            className={`h-8 px-2 border font-mono text-[9px] tracking-[0.14em] uppercase ${
              level === item
                ? 'border-foreground bg-foreground text-background'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {item}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <DbEmpty
          title="No logs"
          body="Preview diagnostics appear here when this generated project recorded them."
        />
      ) : (
        <ul className="flex-1 min-h-0 overflow-auto">
          {visible.map((log) => (
            <li
              key={log.id}
              className="px-3 py-2 border-b border-border/70 flex items-start gap-3"
            >
              <DbBadge tone={toneFromStatus(log.level)}>{log.level}</DbBadge>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-foreground">{log.message}</p>
                <p className="font-mono text-[10px] text-muted-foreground">
                  {log.source}
                  {log.timestamp ? ` · ${log.timestamp}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function WorkflowsPanel({ steps }: { steps: WorkflowStep[] }) {
  return (
    <div className="h-full overflow-y-auto p-4">
      <DbLabel>Workflows</DbLabel>
      <p className="mt-1 mb-4 text-[13px] text-muted-foreground max-w-xl">
        Prompt through publish, using only state this run already has. Later
        steps stay pending until real evidence exists.
      </p>
      <ol className="space-y-2">
        {steps.map((step, index) => (
          <li key={step.id} className="border border-border px-3 py-2.5 flex gap-3">
            <span className="font-mono text-[10px] text-muted-foreground tabular w-5">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-[18px]">{step.label}</span>
                <DbBadge tone={toneFromStatus(step.status)}>{step.status}</DbBadge>
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function SecurityPanel({
  generated,
}: {
  generated: GeneratedSecuritySignal[]
  signedIn?: boolean
  apiUp?: boolean | null
}) {
  if (generated.length === 0) {
    return (
      <DbEmpty
        title="No security signals"
        body="No authentication or secret-configuration signals were detected in this generated project."
      />
    )
  }
  return (
    <div className="h-full overflow-y-auto p-4 space-y-2">
      {generated.map((item) => (
        <div key={item.id} className="border border-border px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-[18px]">{item.label}</h3>
            <DbBadge tone={toneFromStatus(item.status)}>{item.status}</DbBadge>
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">{item.detail}</p>
        </div>
      ))}
    </div>
  )
}

export function SettingsPanel({
  projectName,
  provider,
  fileCount,
}: {
  runId?: string | null
  projectName?: string
  provider?: string
  memoryRevision?: number
  activeVersion?: number | null
  fileCount?: number
  onRefresh?: () => void
}) {
  const rows = [
    { label: 'Project', value: projectName || 'untitled' },
    { label: 'Generated provider', value: provider || 'not detected' },
    { label: 'Schema files', value: fileCount != null ? String(fileCount) : '—' },
  ]
  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <DbLabel>Settings</DbLabel>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Read-only generated-project database context. No secrets, no writes.
          </p>
        </div>
      </div>
      <div className="border border-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="px-3 py-2 border-b border-border/70 last:border-0 flex items-center justify-between gap-3"
          >
            <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-muted-foreground">
              {row.label}
            </span>
            <span className="font-mono text-[12px] text-foreground truncate">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SectionFrame({
  section,
  children,
}: {
  section: DatabaseSection
  children: ReactNode
}) {
  return (
    <div
      key={section}
      className="h-full min-h-0 animate-reveal-up"
    >
      {children}
    </div>
  )
}

