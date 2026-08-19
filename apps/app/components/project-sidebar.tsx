'use client'

import { ActivityTimeline } from '@/components/arena/activity-timeline'
import { CandidateSwitcher } from '@/components/candidate-switcher'
import { Chat } from '@/components/chat'
import { ProjectBrainPanel } from '@/components/project-brain-panel'
import { VersionVaultPanel } from '@/components/version-vault-panel'
import type { ArenaActivityItem } from '@/lib/arena-activity'
import type { AppHealthReport } from '@/lib/app-health'
import type { GenerationCostSummary } from '@/lib/generation-cost'
import { formatCostSummary } from '@/lib/generation-cost'
import type { Message } from '@/lib/messages'
import type { ProjectBrain } from '@/lib/project-brain'
import type { FragmentSchema } from '@/lib/schema'
import type { Candidate } from '@/lib/tournament-client'
import type { VariantId } from '@/lib/tournament'
import type { ExecutionResult } from '@/lib/types'
import type { VersionSnapshot } from '@/lib/version-vault'
import type { DeepPartial } from '@evostack/shared'
import type { ReactNode } from 'react'
import { useState } from 'react'

function Section({
  title,
  summary,
  children,
  defaultOpen = true,
}: {
  title: string
  summary?: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-border/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-foreground/[0.02]"
      >
        <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-muted-foreground">
          {title}
        </span>
        <span className="flex items-center gap-2 min-w-0">
          {!open && summary ? (
            <span className="font-mono text-[11px] text-muted-foreground truncate">
              {summary}
            </span>
          ) : null}
          <span className="font-mono text-[13px] text-muted-foreground">
            {open ? '–' : '+'}
          </span>
        </span>
      </button>
      {open ? <div className="px-3 pb-3">{children}</div> : null}
    </div>
  )
}

export function ProjectSidebar({
  projectBrain,
  vaultSnapshots,
  vaultRefreshKey,
  activeVersion,
  onVaultPreview,
  onVaultRestore,
  runId,
  tournamentPhase,
  selectedCandidate,
  messages,
  isLoading,
  setCurrentPreview,
  candidates,
  selectedId,
  activeId,
  deployingId,
  onSelectCandidate,
  onPreviewCandidate,
  onViewSourceCandidate,
  onUseVersion,
  activity,
  onViewSource,
  detailsFor,
  appHealth,
  generationCost,
  providerBudgetLabel,
}: {
  projectBrain: ProjectBrain | null
  vaultSnapshots: VersionSnapshot[]
  vaultRefreshKey: number
  activeVersion?: number | null
  onVaultPreview: (snapshot: VersionSnapshot) => void
  onVaultRestore: (snapshot: VersionSnapshot) => void
  runId: string | null
  tournamentPhase: string
  selectedCandidate?: Candidate
  messages: Message[]
  isLoading: boolean
  setCurrentPreview: (preview: {
    fragment: DeepPartial<FragmentSchema> | undefined
    result: ExecutionResult | undefined
  }) => void
  candidates: Record<VariantId, Candidate>
  selectedId?: VariantId
  activeId?: VariantId
  deployingId?: VariantId
  onSelectCandidate: (id: VariantId) => void
  onPreviewCandidate: (id: VariantId) => void
  onViewSourceCandidate: (id: VariantId) => void
  onUseVersion: (id: VariantId) => void
  activity: ArenaActivityItem[]
  onViewSource: (id: VariantId) => void
  detailsFor: (id: VariantId) => string[]
  appHealth?: AppHealthReport | null
  generationCost?: GenerationCostSummary | null
  providerBudgetLabel?: string | null
}) {
  const name =
    projectBrain?.plan?.productName ||
    (typeof selectedCandidate?.fragment?.title === 'string'
      ? selectedCandidate.fragment.title
      : '') ||
    'Untitled'
  const purpose = projectBrain?.plan?.productGoal || 'No purpose yet.'
  const features = projectBrain?.plan?.coreFeatures?.slice(0, 4) || []
  const runtime =
    selectedCandidate?.finalVerification?.status ||
    selectedCandidate?.verification?.status ||
    '—'
  const brainItems =
    (projectBrain?.issues.length || 0) +
    (projectBrain?.improvements.length || 0) +
    (projectBrain?.userRequests.length || 0) +
    (projectBrain?.fileTree.length || 0)
  const runShort = runId ? runId.replace(/^run_/, '').slice(-8) : '—'

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <Section title="Project" summary={name}>
        <p className="font-display text-[19px] leading-tight">{name}</p>
        <p className="mt-1 text-[15px] text-muted-foreground line-clamp-3">
          {purpose}
        </p>
        {features.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {features.map((feature) => (
              <li
                key={feature}
                className="font-mono text-[13px] text-muted-foreground truncate"
              >
                · {feature}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Versions"
        defaultOpen={false}
        summary={`+ ${vaultSnapshots.length} versions`}
      >
        <p className="mb-2 font-mono text-[13px] text-muted-foreground">
          Active {activeVersion != null && activeVersion >= 1 ? `v${activeVersion}` : 'none'}
        </p>
        <div className="[&>section]:mx-0 [&>section]:mb-0 [&>section]:border-border/60">
          <VersionVaultPanel
            snapshots={vaultSnapshots}
            activeVersion={activeVersion ?? null}
            refreshKey={vaultRefreshKey}
            onPreview={onVaultPreview}
            onRestore={onVaultRestore}
          />
        </div>
      </Section>

      <Section title="Run" summary={`#${runShort}`}>
        <div className="space-y-1 font-mono text-[13px] text-muted-foreground">
          <p>Run #{runShort}</p>
          <p>Tournament {tournamentPhase}</p>
          <p>Runtime {runtime}</p>
          <p>Smoke {selectedCandidate?.smoke?.status || '—'}</p>
          {appHealth ? (
            <p>
              Health {appHealth.score} · {appHealth.statusLabel}
            </p>
          ) : null}
          {generationCost ? (
            <p title={`${generationCost.modelName} · ${generationCost.calls} calls · ${generationCost.source}`}>
              Tokens {formatCostSummary(generationCost)}
            </p>
          ) : null}
          {providerBudgetLabel ? <p>{providerBudgetLabel}</p> : null}
        </div>
      </Section>

      <Section title="Tournament">
        <CandidateSwitcher
          candidates={candidates}
          selectedId={selectedId}
          activeId={activeId}
          deployingId={deployingId}
          onSelect={onSelectCandidate}
          onPreview={onPreviewCandidate}
          onViewSource={onViewSourceCandidate}
          onUseVersion={onUseVersion}
        />
      </Section>

      <Section
        title="Brain"
        defaultOpen={false}
        summary={brainItems ? `${brainItems} items` : 'empty'}
      >
        <div className="[&>section]:mx-0 [&>section]:mb-0 [&>section]:border-border/60">
          <ProjectBrainPanel brain={projectBrain} />
        </div>
      </Section>

      <Section
        title="Activity"
        defaultOpen
        summary={`${activity.length} events`}
      >
        <ActivityTimeline
          items={activity}
          onViewSource={onViewSource}
          detailsFor={detailsFor}
        />
        {messages.length > 0 && (
          <details className="mt-2 border-t border-border/60 pt-2">
            <summary className="font-mono text-[11px] tracking-[0.16em] uppercase text-muted-foreground cursor-pointer">
              Transcript
            </summary>
            <div className="mt-2 max-h-40 overflow-hidden [&>#chat-container]:max-h-40 [&>#chat-container]:pb-2">
              <Chat
                messages={messages}
                isLoading={isLoading}
                setCurrentPreview={setCurrentPreview}
              />
            </div>
          </details>
        )}
      </Section>
    </div>
  )
}
