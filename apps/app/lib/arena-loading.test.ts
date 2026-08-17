import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { arenaLoadingLabel, candidateLoadingLabel } from './arena-loading'
import { retainTournamentCandidates } from './tournament-candidates'

describe('arenaLoadingLabel', () => {
  it('names the generating specimen without inventing a percent', () => {
    const candidates = retainTournamentCandidates({
      minimal: {
        id: 'minimal',
        label: 'Product',
        sigil: 'P',
        status: 'done',
      },
      rich: {
        id: 'rich',
        label: 'Premium',
        sigil: 'R',
        status: 'generating',
      },
    })
    assert.equal(
      arenaLoadingLabel({
        tournamentPhase: 'generating',
        candidates,
        isPreviewLoading: false,
        isChatLoading: false,
        evolutionRunning: false,
      }),
      'Generating Premium',
    )
  })

  it('uses Improving only when evolution is actually running', () => {
    const candidates = retainTournamentCandidates(null)
    assert.equal(
      arenaLoadingLabel({
        tournamentPhase: 'idle',
        candidates,
        isPreviewLoading: false,
        isChatLoading: false,
        evolutionRunning: true,
      }),
      'Improving',
    )
    assert.equal(
      arenaLoadingLabel({
        tournamentPhase: 'idle',
        candidates,
        isPreviewLoading: false,
        isChatLoading: false,
        evolutionRunning: false,
      }),
      null,
    )
  })

  it('maps in-flight specimen status to a compact label without inventing steps', () => {
    assert.equal(candidateLoadingLabel('generating'), 'Generating')
    assert.equal(candidateLoadingLabel('verifying'), 'Building')
    assert.equal(candidateLoadingLabel('done'), null)
    assert.equal(candidateLoadingLabel(undefined), null)
  })
})
