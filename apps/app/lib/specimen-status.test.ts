import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { specimenStatus } from './specimen-status'
import type { Candidate } from './tournament-client'

const source = {
  title: 'LODA Store Admin',
  template: 'nextjs-developer-dev',
  file_path: 'pages/index.tsx',
  code: 'export default function Page() { return <main>ok</main> }',
}

function candidate(partial: Partial<Candidate>): Candidate {
  return {
    id: 'minimal',
    label: 'Product',
    sigil: 'P',
    status: 'verified',
    ...partial,
  }
}

describe('specimenStatus', () => {
  it('does not spin sibling specimens that only have saved source', () => {
    const saved = candidate({ fragment: source, execution: undefined })
    assert.deepEqual(specimenStatus(saved, false), {
      label: 'Idle',
      tone: 'idle',
    })
    assert.deepEqual(specimenStatus(saved, false, { deploying: true }), {
      label: 'Starting',
      tone: 'work',
    })
  })

  it('shows Ready once a live preview URL exists', () => {
    const live = candidate({
      fragment: source,
      execution: {
        sbxId: 'sbx_1',
        template: 'nextjs-developer-dev',
        url: 'https://sbx.e2b.dev',
      },
    })
    assert.deepEqual(specimenStatus(live, false), {
      label: 'Ready',
      tone: 'ready',
    })
  })

  it('keeps failed-without-source as Failed', () => {
    const failed = candidate({
      status: 'verify_failed',
      fragment: undefined,
      error: 'exit status 1',
    })
    assert.deepEqual(specimenStatus(failed, false), {
      label: 'Failed',
      tone: 'fail',
    })
  })
})
