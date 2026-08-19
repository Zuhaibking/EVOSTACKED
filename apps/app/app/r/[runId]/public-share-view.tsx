'use client'

import { Button } from '@/components/ui/button'
import { enrichProjectExportFiles } from '@/lib/project-export'
import { downloadProjectZip, zipFilename } from '@/lib/project-zip'
import {
  shareExportMeta,
  type PublicShareCandidate,
  type PublicSharePayload,
} from '@/lib/public-share'
import { Download, ExternalLink } from 'lucide-react'
import Link from 'next/link'

function scorePct(n?: number): string {
  if (n == null || Number.isNaN(n)) return '—'
  const display = n <= 1 ? Math.round(n * 100) : Math.round(n)
  return `${display}`
}

function downloadCandidate(
  payload: PublicSharePayload,
  candidate: PublicShareCandidate,
) {
  const files = (candidate.fragment?.code || []).map((f) => ({
    path: f.file_path,
    content: f.file_content,
  }))
  if (!files.length) return
  downloadProjectZip(
    zipFilename(`${payload.productName}-${candidate.variant}`),
    enrichProjectExportFiles(files, shareExportMeta(payload, candidate)),
  )
}

export function PublicShareView({ data }: { data: PublicSharePayload }) {
  const winnerId = data.recommendation?.winnerId
  const winner = data.candidates.find((c) => c.variantId === winnerId)

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-4 sm:px-8 h-12 flex items-center justify-between">
        <Link href="/" className="font-display text-[17px] font-black tracking-tight">
          Evo<span className="italic font-normal">Stack</span>
        </Link>
        <span className="font-mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground">
          Public result
        </span>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-10 space-y-10">
        <section>
          <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
            Prompt
          </p>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl leading-tight">
            {data.productName}
          </h1>
          <p className="mt-3 text-[15px] text-muted-foreground whitespace-pre-wrap max-w-3xl">
            {data.prompt || 'No prompt recorded.'}
          </p>
        </section>

        {(data.health || data.recommendation || data.usage) && (
          <section className="border border-border grid sm:grid-cols-3">
            <div className="px-4 py-3 border-b sm:border-b-0 sm:border-r border-border">
              <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-muted-foreground">
                App Health
              </p>
              <p className="mt-1 font-display text-2xl">
                {data.health ? `${data.health.score}/100` : '—'}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {data.health?.statusLabel || 'Not scored'}
              </p>
            </div>
            <div className="px-4 py-3 border-b sm:border-b-0 sm:border-r border-border">
              <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-muted-foreground">
                Recommendation
              </p>
              <p className="mt-1 font-display text-2xl">
                {winner?.variant || '—'}
              </p>
              <p className="text-[12px] text-muted-foreground line-clamp-3">
                {data.recommendation?.reasoning || 'Inspect the candidates below.'}
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-muted-foreground">
                Estimated tokens
              </p>
              <p className="mt-1 font-display text-2xl">
                {data.usage
                  ? data.usage.totalTokens.toLocaleString()
                  : '—'}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {data.usage
                  ? `~$${data.usage.estimatedUsd.toFixed(data.usage.estimatedUsd < 0.01 ? 4 : 2)}`
                  : 'Not recorded'}
              </p>
            </div>
          </section>
        )}

        {winner?.fragment && (
          <div>
            <Button
              className="rounded-none font-mono text-[10px] tracking-[0.16em] uppercase"
              onClick={() => downloadCandidate(data, winner)}
            >
              <Download className="h-3.5 w-3.5 mr-2" />
              Download recommended ZIP
            </Button>
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          {data.candidates.map((candidate) => {
            const isWinner = candidate.variantId === winnerId
            const canZip = Boolean(candidate.fragment?.code?.length)
            return (
              <article
                key={candidate.variantId}
                className={`border border-border p-4 flex flex-col ${
                  isWinner ? 'bg-foreground/[0.03]' : ''
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-display text-xl">{candidate.variant}</h2>
                  <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-muted-foreground">
                    {candidate.status}
                  </span>
                </div>
                {isWinner && (
                  <p className="mt-1 font-mono text-[9px] tracking-[0.18em] uppercase text-brand">
                    Recommended
                  </p>
                )}
                <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                  Clarity {scorePct(candidate.scores?.clarity)} · Fit{' '}
                  {scorePct(candidate.scores?.fit)} · Polish{' '}
                  {scorePct(candidate.scores?.polish)}
                </p>
                <p className="mt-1 font-mono text-[11px]">
                  Composite {scorePct(candidate.scores?.composite)}
                </p>
                {candidate.previewUrl && !candidate.previewExpired ? (
                  <a
                    href={candidate.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] uppercase text-foreground hover:text-brand"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Live preview
                  </a>
                ) : (
                  <p className="mt-3 font-mono text-[10px] text-muted-foreground">
                    Preview expired — download the zip to run it locally.
                  </p>
                )}
                {candidate.error && (
                  <p className="mt-2 text-[12px] text-destructive line-clamp-3">
                    {candidate.error}
                  </p>
                )}
                <div className="mt-auto pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canZip}
                    className="rounded-none font-mono text-[9px] tracking-[0.14em] uppercase"
                    onClick={() => downloadCandidate(data, candidate)}
                  >
                    <Download className="h-3 w-3 mr-1.5" />
                    ZIP
                  </Button>
                </div>
              </article>
            )
          })}
        </section>
      </div>
    </main>
  )
}
