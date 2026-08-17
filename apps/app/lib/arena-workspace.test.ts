import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { isArenaCommandDocked } from './arena-workspace'

describe('arena desktop sidebar width', () => {
  it('uses a single Arena sidebar token around 480–500px', () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), 'app/globals.css'),
      'utf8',
    )
    const shell = fs.readFileSync(
      path.join(process.cwd(), 'components/arena/arena-shell.tsx'),
      'utf8',
    )
    const width = css.match(/--arena-sidebar-width:\s*(\d+)px/)
    assert.ok(width, 'expected --arena-sidebar-width on .arena-workspace')
    const px = Number(width![1])
    assert.ok(px >= 480 && px <= 500, `sidebar width ${px}px`)
    assert.match(shell, /md:grid-cols-\[var\(--arena-sidebar-width\)_minmax\(0,1fr\)\]/)
    assert.doesNotMatch(shell, /220px_minmax|260px_minmax|280px_minmax/)
    assert.match(shell, /w-\[min\(320px,88vw\)\]/)
  })
})

describe('isArenaCommandDocked', () => {
  it('keeps the command bar in the empty workspace before any prompt', () => {
    assert.equal(
      isArenaCommandDocked({
        messageCount: 0,
        tournamentPhase: 'idle',
        hasFragment: false,
      }),
      false,
    )
  })

  it('docks after the first prompt is submitted', () => {
    assert.equal(
      isArenaCommandDocked({
        messageCount: 1,
        tournamentPhase: 'generating',
        hasFragment: false,
      }),
      true,
    )
  })

  it('docks while a generated project is present', () => {
    assert.equal(
      isArenaCommandDocked({
        messageCount: 0,
        tournamentPhase: 'idle',
        hasFragment: true,
      }),
      true,
    )
  })
})
