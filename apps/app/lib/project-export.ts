/**
 * Extra files packed into a candidate zip: README, scorecard, Docker.
 * Source files still come from the fragment; this only enriches the archive.
 */
import type { ApplicationPlan } from '@/lib/plan'
import type { ZipFileInput } from '@/lib/project-zip'
import { getTemplateId } from '@/lib/templates'
import type { VariantId } from '@/lib/tournament'
import { VARIANTS } from '@/lib/tournament'
import { scrubSecrets } from '@/lib/source-diff'

export type ProjectExportMeta = {
  prompt?: string | null
  plan?: Pick<
    ApplicationPlan,
    'productName' | 'productGoal' | 'coreFeatures' | 'pages'
  > & { applicationType?: string } | null
  variantId?: VariantId | null
  variantLabel?: string | null
  scores?: {
    clarity?: number
    fit?: number
    polish?: number
    composite?: number
  } | null
  health?: { score: number; statusLabel: string } | null
  architectureSummary?: string | null
  verificationSummary?: string | null
  smokeSummary?: string | null
  repairNotes?: string | null
  templateId?: string | null
}

function variantName(id?: VariantId | null, label?: string | null): string {
  if (label?.trim()) return label.trim()
  if (!id) return 'Unknown'
  return VARIANTS.find((v) => v.id === id)?.label || id
}

function md(text: string | null | undefined): string {
  return scrubSecrets((text || '').trim() || '—')
}

function pct(n?: number): string {
  if (n == null || Number.isNaN(n)) return '—'
  const display = n <= 1 ? Math.round(n * 100) : Math.round(n)
  return `${display}`
}

export function buildExportReadme(meta: ProjectExportMeta): string {
  const plan = meta.plan
  const name = plan?.productName || 'EvoStack export'
  const features = (plan?.coreFeatures || []).map((f) => `- ${f}`).join('\n')
  const pages = (plan?.pages || [])
    .map((p) => `- ${p.name} (${p.path}): ${p.purpose}`)
    .join('\n')
  const health =
    meta.health != null
      ? `${meta.health.score}/100 · ${meta.health.statusLabel}`
      : '—'
  const scores = meta.scores
    ? `clarity ${pct(meta.scores.clarity)} · fit ${pct(meta.scores.fit)} · polish ${pct(meta.scores.polish)} · composite ${pct(meta.scores.composite)}`
    : '—'

  return `# ${name}

Exported from EvoStack.

## Original prompt

${md(meta.prompt)}

## Application plan

- **Name:** ${md(plan?.productName)}
- **Type:** ${md(plan?.applicationType)}
- **Goal:** ${md(plan?.productGoal)}

### Key features

${features || '- (none recorded)'}

### Pages

${pages || '- (none recorded)'}

## Variant

${variantName(meta.variantId, meta.variantLabel)}

## App Health / scores

- App Health: ${health}
- Judge scores: ${scores}

## Run locally

See \`Dockerfile\` and \`docker-compose.yml\` in this archive (when present).
For Next.js / Nuxt templates, \`docker compose up --build\` is the shortest path.
`
}

export function buildExportScorecard(meta: ProjectExportMeta): string {
  return `# Scorecard — ${variantName(meta.variantId, meta.variantLabel)}

## Architecture compliance

${md(meta.architectureSummary)}

## Runtime verification

${md(meta.verificationSummary)}

## Browser smoke

${md(meta.smokeSummary)}

## Repair notes

${md(meta.repairNotes)}

## Scores

- Clarity: ${pct(meta.scores?.clarity)}
- Fit: ${pct(meta.scores?.fit)}
- Polish: ${pct(meta.scores?.polish)}
- Composite: ${pct(meta.scores?.composite)}
- App Health: ${
    meta.health != null
      ? `${meta.health.score}/100 (${meta.health.statusLabel})`
      : '—'
  }
`
}

export function dockerPortForTemplate(templateId?: string | null): number | null {
  const id = getTemplateId(templateId || '')
  if (id.includes('nextjs') || id.includes('vue')) return 3000
  if (id.includes('streamlit')) return 8501
  if (id.includes('gradio')) return 7860
  return null
}

export function buildExportDockerfile(templateId?: string | null): string | null {
  const id = getTemplateId(templateId || '')
  if (id.includes('nextjs')) {
    return `FROM node:20-alpine
WORKDIR /app
COPY . .
RUN if [ -f package.json ]; then npm install; fi
EXPOSE 3000
CMD ["sh", "-c", "if [ -f package.json ]; then npm run dev -- -p 3000 -H 0.0.0.0; else npx --yes next@14.2.5 dev -p 3000 -H 0.0.0.0; fi"]
`
  }
  if (id.includes('vue')) {
    return `FROM node:20-alpine
WORKDIR /app
COPY . .
RUN if [ -f package.json ]; then npm install; fi
EXPOSE 3000
CMD ["sh", "-c", "if [ -f package.json ]; then npm run dev -- --port 3000 --host 0.0.0.0; else npx --yes nuxi@3.13.0 dev --port 3000 --host 0.0.0.0; fi"]
`
  }
  if (id.includes('streamlit')) {
    return `FROM python:3.11-slim
WORKDIR /app
COPY . .
RUN pip install --no-cache-dir streamlit pandas numpy
EXPOSE 8501
CMD ["streamlit", "run", "app.py", "--server.address=0.0.0.0", "--server.port=8501"]
`
  }
  if (id.includes('gradio')) {
    return `FROM python:3.11-slim
WORKDIR /app
COPY . .
RUN pip install --no-cache-dir gradio pandas numpy
EXPOSE 7860
CMD ["python", "app.py"]
`
  }
  return null
}

export function buildExportCompose(templateId?: string | null): string | null {
  const port = dockerPortForTemplate(templateId)
  if (port == null) return null
  return `services:
  app:
    build: .
    ports:
      - "${port}:${port}"
`
}

function sanitizeExportPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\.\//g, '')
}

/**
 * Overlay README / scorecard / Docker onto fragment files.
 * An existing app README is kept as docs/APP_README.md so the export README
 * always carries the prompt, plan, and scores.
 */
export function enrichProjectExportFiles(
  files: ZipFileInput[],
  meta: ProjectExportMeta,
): ZipFileInput[] {
  const out: ZipFileInput[] = []
  const seen = new Set<string>()

  for (const file of files) {
    let path = sanitizeExportPath(file.path || '')
    if (!path) continue
    if (path.toLowerCase() === 'readme.md') path = 'docs/APP_README.md'
    if (seen.has(path)) continue
    seen.add(path)
    out.push({ path, content: file.content ?? '' })
  }

  const extras: ZipFileInput[] = [
    { path: 'README.md', content: buildExportReadme(meta) },
    { path: 'scorecard.md', content: buildExportScorecard(meta) },
  ]
  const dockerfile = buildExportDockerfile(meta.templateId)
  if (dockerfile) extras.push({ path: 'Dockerfile', content: dockerfile })
  const compose = buildExportCompose(meta.templateId)
  if (compose) extras.push({ path: 'docker-compose.yml', content: compose })

  for (const extra of extras) {
    if (seen.has(extra.path)) continue
    seen.add(extra.path)
    out.push(extra)
  }
  return out
}
