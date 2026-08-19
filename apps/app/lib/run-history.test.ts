import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  pickRestoreRunId,
  textFromStoredContent,
  titleFromRunSources,
} from './run-history'

describe('textFromStoredContent', () => {
  it('reads Clerk-style message content arrays', () => {
    assert.equal(
      textFromStoredContent({
        role: 'user',
        content: [{ type: 'text', text: 'Build a CRM' }],
      }),
      'Build a CRM',
    )
  })
})

describe('titleFromRunSources', () => {
  it('prefers the product name from the plan', () => {
    assert.equal(
      titleFromRunSources({
        productName: 'Harbor Ledger',
        firstUserText: 'make an accounting app',
      }),
      'Harbor Ledger',
    )
  })

  it('falls back to the first user line', () => {
    assert.equal(
      titleFromRunSources({ firstUserText: 'Plan a tournament engine\nwith 50 specimens' }),
      'Plan a tournament engine',
    )
  })
})

describe('pickRestoreRunId', () => {
  const runs = [
    {
      id: 'run_new_empty',
      title: 'Untitled run',
      preview: '',
      updatedAt: '2026-08-20T00:00:00.000Z',
      hasTournament: false,
      status: 'active',
      memoryVersion: 0,
    },
    {
      id: 'run_chat',
      title: 'Harbor Ledger',
      preview: 'Build a CRM',
      updatedAt: '2026-08-19T00:00:00.000Z',
      hasTournament: true,
      status: 'active',
      memoryVersion: 4,
    },
  ]

  it('skips empty minted runs and restores the last chat with work', () => {
    assert.equal(pickRestoreRunId({ runs }), 'run_chat')
  })

  it('honors a URL run that still exists', () => {
    assert.equal(
      pickRestoreRunId({ urlRunId: 'run_chat', storedRunId: 'run_new_empty', runs }),
      'run_chat',
    )
  })

  it('honors a pasted URL even if history has not listed it yet', () => {
    assert.equal(
      pickRestoreRunId({
        urlRunId: 'run_mt0hk7ui_in8paaok',
        storedRunId: 'run_chat',
        runs,
      }),
      'run_mt0hk7ui_in8paaok',
    )
  })

  it('skips a stored empty mint in favor of the last chat with work', () => {
    assert.equal(
      pickRestoreRunId({ storedRunId: 'run_new_empty', runs }),
      'run_chat',
    )
  })
})
