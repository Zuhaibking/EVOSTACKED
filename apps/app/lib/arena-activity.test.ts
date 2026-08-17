import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildArenaActivity } from './arena-activity'
import type { Candidate } from './tournament-client'
import { retainTournamentCandidates } from './tournament-candidates'

function cand(
  id: 'minimal' | 'rich' | 'playful',
  label: string,
  extra: Record<string, unknown> = {},
): Candidate {
  return { id, label, sigil: label[0], status: 'pending', ...extra } as Candidate
}

describe('buildArenaActivity', () => {
  it('does not invent completed steps while idle with no plan', () => {
    const items = buildArenaActivity({
      phase: 'idle',
      candidates: retainTournamentCandidates(null),
    })
    assert.equal(items.length, 0)
  })

  it('shows planning in progress before a plan exists', () => {
    const items = buildArenaActivity({
      phase: 'generating',
      candidates: retainTournamentCandidates({
        minimal: cand('minimal', 'Product', { status: 'generating' }),
      }),
    })
    assert.equal(items[0]?.label, 'Planning')
    assert.equal(items[0]?.tone, 'work')
    assert.equal(
      items.some((i) => i.label === 'Generating Product' && i.tone === 'work'),
      true,
    )
    assert.equal(
      items.some((i) => i.label.includes('integrity')),
      false,
    )
  })

  it('marks planning done once a plan exists and does not complete later candidates', () => {
    const items = buildArenaActivity({
      phase: 'generating',
      plan: { productName: 'Nexus Pass' },
      candidates: retainTournamentCandidates({
        minimal: cand('minimal', 'Product', {
          status: 'done',
          fragment: {
            title: 'P',
            file_path: 'app/page.tsx',
            code: 'export default function Page(){return null}',
          },
        }),
        rich: cand('rich', 'Premium', { status: 'generating' }),
      }),
    })
    assert.equal(items.find((i) => i.id === 'plan')?.tone, 'done')
    assert.equal(
      items.some((i) => i.label === 'Product generated' && i.tone === 'done'),
      true,
    )
    assert.equal(
      items.some((i) => i.label === 'Generating Premium' && i.tone === 'work'),
      true,
    )
    assert.equal(
      items.some((i) => i.label.includes('Innovate') && i.tone === 'done'),
      false,
    )
  })

  it('does not mark integrity complete while architecture is still checking', () => {
    const items = buildArenaActivity({
      phase: 'architecture',
      plan: {},
      candidates: retainTournamentCandidates({
        minimal: cand('minimal', 'Product', {
          status: 'architecture_checking',
          fragment: {
            file_path: 'app/page.tsx',
            code: 'export default function Page(){return null}',
          },
        }),
      }),
    })
    const integrity = items.find((i) => i.id === 'minimal-integrity')
    assert.equal(integrity?.tone, 'work')
    assert.equal(
      items.some((i) => i.id === 'minimal-runtime'),
      false,
    )
  })

  it('exposes failed build with source/details and does not claim preview ready', () => {
    const items = buildArenaActivity({
      phase: 'verifying',
      plan: {},
      candidates: retainTournamentCandidates({
        minimal: cand('minimal', 'Product', {
          status: 'verify_failed',
          fragment: {
            file_path: 'app/page.tsx',
            code: 'export default function Page(){return null}',
          },
          verification: { status: 'failed', errors: ['BUILD FAILED'] },
        }),
      }),
    })
    const runtime = items.find((i) => i.id === 'minimal-runtime')
    assert.equal(runtime?.tone, 'fail')
    assert.equal(runtime?.allowDetails, true)
    assert.equal(runtime?.allowSource, true)
    assert.equal(
      items.some((i) => i.label.includes('preview ready')),
      false,
    )
  })

  it('keeps preview ready when smoke timed out on a healthy runtime', () => {
    const items = buildArenaActivity({
      phase: 'done',
      plan: {},
      candidates: retainTournamentCandidates({
        minimal: cand('minimal', 'Product', {
          status: 'tested',
          fragment: {
            file_path: 'app/page.tsx',
            code: 'export default function Page(){return null}',
          },
          execution: {
            sbxId: 'sbx_1',
            template: 'nextjs-developer',
            url: 'https://sbx_1.e2b.app',
          },
          verification: {
            status: 'passed',
            previewReachable: true,
            sbxId: 'sbx_1',
            url: 'https://sbx_1.e2b.app',
            template: 'nextjs-developer',
          },
          smoke: {
            status: 'timeout',
            tests: [],
            durationMs: 1,
            summary: 'timed out',
          },
        }),
      }),
    })
    assert.equal(
      items.some((i) => i.label === 'Product preview ready' && i.tone === 'done'),
      true,
    )
    const smoke = items.find((i) => i.id === 'minimal-smoke')
    assert.equal(smoke?.label, 'Product smoke timed out')
    assert.equal(smoke?.tone, 'done')
  })

  it('omits repair unless a repair actually started', () => {
    const items = buildArenaActivity({
      phase: 'verifying',
      plan: {},
      candidates: retainTournamentCandidates({
        minimal: cand('minimal', 'Product', {
          status: 'verified',
          fragment: {
            file_path: 'app/page.tsx',
            code: 'export default function Page(){return null}',
          },
          verification: { status: 'passed' },
        }),
      }),
    })
    assert.equal(
      items.some((i) => i.label.toLowerCase().includes('repair')),
      false,
    )
  })
})
