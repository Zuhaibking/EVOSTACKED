'use client'

import {
  AnalyticsPanel,
  ApiPanel,
  DataPanel,
  EnvironmentPanel,
  IntegrationsPanel,
  LogsPanel,
  OverviewPanel,
  SectionFrame,
  SecurityPanel,
  SettingsPanel,
  TablesPanel,
  UsersPanel,
  WorkflowsPanel,
  type DataSource,
} from '@/components/arena/database/panels'
import { DbBadge, DbLabel } from '@/components/arena/database/ui'
import {
  DATABASE_SECTION_META,
  logsFromDiagnostics,
  workflowInputFromWorkspace,
  type DatabaseSection,
} from '@/lib/database-control-center'
import { resolveGeneratedDatabaseView } from '@/lib/generated-project-database'
import { getFragmentFiles } from '@/lib/fragment'
import type { FragmentSchema } from '@/lib/schema'
import type { ExecutionResult } from '@/lib/types'
import type { DeepPartial } from '@evostack/shared'
import { useMemo, useState } from 'react'

function DatabaseEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-[13px] tracking-[0.22em] uppercase text-muted-foreground">
        Database
      </p>
      <p className="mt-2 text-[18px] text-foreground">{title}</p>
      <p className="mt-1.5 max-w-md text-[16px] leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  )
}

export function DatabaseWorkspace({
  fragment,
  result,
  diagnostics,
  projectName,
}: {
  fragment?: DeepPartial<FragmentSchema>
  result?: ExecutionResult
  diagnostics?: string[]
  projectName?: string
}) {
  const [section, setSection] = useState<DatabaseSection>('overview')
  const view = useMemo(
    () => resolveGeneratedDatabaseView(fragment),
    [fragment],
  )

  if (view.status === 'no-project') {
    return (
      <DatabaseEmpty
        title="No generated project yet."
        body="Generate a project to inspect its database, schema, tables, and data."
      />
    )
  }

  if (view.status === 'no-database') {
    return (
      <DatabaseEmpty
        title="No database configured for this project."
        body="This generated project has no Prisma, Drizzle, or SQL schema to inspect."
      />
    )
  }

  const inspection = view.inspection
  const files = getFragmentFiles(fragment)
  const logs = logsFromDiagnostics(diagnostics)
  const sources: DataSource[] = inspection.fileRecords.map((set) => ({
    id: `project:${set.filePath}:${set.tableHint}`,
    label: set.tableHint,
    origin: 'project',
    rows: set.records,
    available: true,
  }))
  const users = inspection.fileRecords
    .filter((set) => /user|member|account|profile/i.test(set.tableHint))
    .flatMap((set) => set.records)
  const recordCount = sources.reduce((sum, source) => sum + source.rows.length, 0)
  const title =
    projectName ||
    (typeof fragment?.title === 'string' ? fragment.title : undefined)
  const metrics = [
    {
      label: 'Generated tables',
      value: inspection.tables.length,
      hint: 'Models parsed from this generated project schema',
    },
    {
      label: 'Schema files',
      value: inspection.files.length,
      hint: 'Database-related files in the generated project',
    },
    {
      label: 'Project records',
      value: recordCount,
      hint: 'Rows found in generated project data files',
    },
    {
      label: 'Detected endpoints',
      value: inspection.endpoints.length,
      hint: 'API routes parsed from generated source',
    },
  ]
  const workflows = workflowInputFromWorkspace({
    fragment,
    result,
    diagnostics,
  })
  const groups = ['database', 'project', 'platform', 'system'] as const

  return (
    <div className="h-full min-h-0 flex bg-background/40">
      <nav
        aria-label="Database sections"
        className="w-[168px] shrink-0 border-r border-border overflow-y-auto"
      >
        <div className="px-3 py-3 border-b border-border">
          <DbLabel>Database</DbLabel>
          <p className="mt-1 font-display text-[20px] leading-tight">
            Control center
          </p>
        </div>
        {groups.map((group) => (
          <div key={group} className="px-2 py-2">
            <p className="px-1.5 mb-1 font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground/80">
              {group}
            </p>
            {DATABASE_SECTION_META.filter((item) => item.group === group).map(
              (item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={section === item.id ? 'page' : undefined}
                  onClick={() => setSection(item.id)}
                  className={`w-full text-left px-2 h-7 font-mono text-[13px] tracking-[0.12em] uppercase transition-colors ${
                    section === item.id
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {item.label}
                </button>
              ),
            )}
          </div>
        ))}
      </nav>

      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="shrink-0 h-10 px-3 border-b border-border flex items-center gap-2">
          <DbBadge tone="good">schema</DbBadge>
          <span className="ml-auto font-mono text-[13px] text-muted-foreground truncate">
            {title || 'generated project'}
            {files.length ? ` · ${files.length} files` : ''}
          </span>
        </div>

        <div className="flex-1 min-h-0">
          <SectionFrame section={section}>
            {section === 'overview' && (
              <OverviewPanel
                inspection={inspection}
                projectName={title}
                recordCount={recordCount}
                recentLogs={logs}
              />
            )}
            {section === 'tables' && <TablesPanel inspection={inspection} />}
            {section === 'data' && <DataPanel sources={sources} />}
            {section === 'users' && <UsersPanel users={users} />}
            {section === 'analytics' && <AnalyticsPanel metrics={metrics} />}
            {section === 'api' && (
              <ApiPanel generated={inspection.endpoints} />
            )}
            {section === 'integrations' && (
              <IntegrationsPanel generated={inspection.integrations} />
            )}
            {section === 'environment' && (
              <EnvironmentPanel generated={inspection.envVars} />
            )}
            {section === 'logs' && <LogsPanel logs={logs} />}
            {section === 'workflows' && <WorkflowsPanel steps={workflows} />}
            {section === 'security' && (
              <SecurityPanel generated={inspection.security} />
            )}
            {section === 'settings' && (
              <SettingsPanel
                projectName={title}
                provider={inspection.provider}
                fileCount={inspection.files.length}
              />
            )}
          </SectionFrame>
        </div>
      </div>
    </div>
  )
}
