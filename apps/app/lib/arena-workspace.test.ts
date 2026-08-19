import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import {
  isArenaCommandDocked,
  PREVIEW_VIEWPORT_FRAMES,
} from './arena-workspace'

const appRoot = process.cwd()

function readApp(rel: string) {
  return fs.readFileSync(path.join(appRoot, rel), 'utf8')
}

describe('arena shell fills the real viewport', () => {
  it('sizes the desktop sidebar with clamp, not a locked 492px poster', () => {
    const css = readApp('app/globals.css')
    const shell = readApp('components/arena/arena-shell.tsx')
    const width = css.match(/--arena-sidebar-width:\s*([^;]+);/)
    assert.ok(width, 'expected --arena-sidebar-width on .arena-workspace')
    assert.match(width![1], /clamp\(/)
    assert.doesNotMatch(width![1], /492px/)
    assert.match(
      shell,
      /md:grid-cols-\[var\(--arena-sidebar-width\)_minmax\(0,1fr\)\]/,
    )
    assert.match(shell, /w-\[min\(320px,88vw\)\]/)
    assert.match(css, /height:\s*100dvh/)
  })

  it('hardcodes arena chrome at 125% of the old 8–9px type', () => {
    const nav = readApp('components/navbar.tsx')
    const sidebar = readApp('components/project-sidebar.tsx')
    const workspace = readApp('components/arena/arena-workspace.tsx')
    assert.match(nav, /text-\[11px\]/)
    assert.doesNotMatch(nav, /text-\[9px\]/)
    assert.match(sidebar, /text-\[11px\]/)
    assert.doesNotMatch(sidebar, /text-\[9px\]/)
    assert.match(workspace, /text-\[11px\]/)
    assert.doesNotMatch(workspace, /text-\[8px\]/)
    assert.doesNotMatch(workspace, /text-\[9px\]/)
  })

  it('does not pin the empty hero or command slot to 18vh laptop offsets', () => {
    const css = readApp('app/globals.css')
    assert.doesNotMatch(css, /18vh/)
    assert.doesNotMatch(css, /calc\(18vh/)
    assert.match(css, /arena-command-slot-centered/)
    assert.match(css, /clamp\(/)
  })

  it('keeps the Database workspace out from under the floating command slot', () => {
    const shell = readApp('components/arena/arena-shell.tsx')
    const page = readApp('app/app/page.tsx')
    assert.match(shell, /commandOverlaysWorkspace/)
    assert.match(
      shell,
      /md:col-start-2 md:row-start-1 arena-command-slot-centered/,
    )
    assert.match(
      shell,
      /: 'col-start-1 row-start-2 w-full min-w-0 justify-self-stretch arena-glass md:col-start-2'/,
    )
    assert.match(
      page,
      /commandOverlaysWorkspace=\{workspaceMode !== 'database'\}/,
    )
  })
})

describe('preview device frames', () => {
  it('fills desktop and frames tablet/mobile', () => {
    assert.equal(PREVIEW_VIEWPORT_FRAMES.desktop, null)
    assert.deepEqual(PREVIEW_VIEWPORT_FRAMES.tablet, {
      width: 768,
      height: 1024,
    })
    assert.deepEqual(PREVIEW_VIEWPORT_FRAMES.mobile, {
      width: 390,
      height: 844,
    })
  })

  it('applies frames only to the generated iframe, and fills on phones', () => {
    const web = readApp('components/fragment-web.tsx')
    const css = readApp('app/globals.css')
    assert.match(web, /preview-stage/)
    assert.match(web, /data-viewport=\{viewport\}/)
    assert.match(css, /\.preview-stage\[data-viewport='desktop'\]/)
    assert.match(css, /@media \(max-width: 767px\)/)
    assert.doesNotMatch(web, /max-w-\[390px\]/)
    assert.doesNotMatch(web, /max-w-\[768px\]/)
  })

  it('hides device toggles until there is something to preview', () => {
    const workspace = readApp('components/arena/arena-workspace.tsx')
    assert.match(workspace, /fragment \|\| result/)
    assert.match(workspace, /hidden md:inline-flex/)
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
