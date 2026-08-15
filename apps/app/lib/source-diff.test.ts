/**
 * Deterministic source-diff tests (no LLM / E2B).
 * Run: npm run test:source-diff
 */
import assert from 'node:assert/strict'
import {
  diffFragments,
  diffLines,
  scrubSecrets,
  summarizeSourceDiff,
} from './source-diff'

function frag(files: Array<{ file_path: string; file_content: string }>) {
  return {
    title: 'App',
    template: 'nextjs-developer',
    file_path: files[0]?.file_path || 'pages/index.tsx',
    code: files,
  }
}

const oldApp = frag([
  {
    file_path: 'pages/index.tsx',
    file_content: 'export default function Page(){\n  return <main>Home</main>\n}\n',
  },
  {
    file_path: 'components/Stats.tsx',
    file_content: 'export function Stats(){ return null }\n',
  },
  {
    file_path: 'components/OldStats.tsx',
    file_content: 'export function OldStats(){ return null }\n',
  },
])

const newApp = frag([
  {
    file_path: 'pages/index.tsx',
    file_content:
      'export default function Page(){\n  return <main>Dashboard</main>\n}\n',
  },
  {
    file_path: 'components/Stats.tsx',
    file_content: 'export function Stats(){ return null }\n',
  },
  {
    file_path: 'components/AttendanceChart.tsx',
    file_content: 'export function AttendanceChart(){ return <div/> }\n',
  },
  {
    file_path: 'components/Dashboard.tsx',
    file_content: 'export function Dashboard(){ return <section/> }\n',
  },
])

// 1. Added file detection
{
  const diff = diffFragments(oldApp as any, newApp as any)
  assert.ok(diff.addedFiles.includes('components/AttendanceChart.tsx'))
  assert.ok(diff.addedFiles.includes('components/Dashboard.tsx'))
}

// 2. Removed file detection
{
  const diff = diffFragments(oldApp as any, newApp as any)
  assert.ok(diff.removedFiles.includes('components/OldStats.tsx'))
}

// 3. Modified file detection
{
  const diff = diffFragments(oldApp as any, newApp as any)
  assert.ok(diff.modifiedFiles.includes('pages/index.tsx'))
  const file = diff.files.find((f) => f.path === 'pages/index.tsx')
  assert.equal(file?.status, 'modified')
  assert.ok((file?.addedLines || 0) > 0)
  assert.ok((file?.removedLines || 0) > 0)
}

// 4. Unchanged file detection
{
  const diff = diffFragments(oldApp as any, newApp as any)
  assert.ok(diff.unchangedFiles.includes('components/Stats.tsx'))
}

// 5. Empty fragment handling
{
  const diff = diffFragments(null, null)
  assert.deepEqual(diff.addedFiles, [])
  assert.deepEqual(diff.removedFiles, [])
  assert.deepEqual(diff.modifiedFiles, [])
  assert.equal(diff.addedLines, 0)
  assert.equal(diff.removedLines, 0)

  const onlyNew = diffFragments(null, newApp as any)
  assert.ok(onlyNew.addedFiles.length >= 3)
  assert.equal(onlyNew.removedFiles.length, 0)
}

// 6. Identical fragment handling
{
  const diff = diffFragments(oldApp as any, oldApp as any)
  assert.equal(diff.addedFiles.length, 0)
  assert.equal(diff.modifiedFiles.length, 0)
  assert.equal(diff.removedFiles.length, 0)
  assert.equal(diff.unchangedFiles.length, 3)
  assert.equal(diff.addedLines, 0)
  assert.equal(diff.removedLines, 0)
}

// Line diff sanity
{
  const { lines, addedLines, removedLines } = diffLines('a\nb\n', 'a\nc\n')
  assert.equal(addedLines, 1)
  assert.equal(removedLines, 1)
  assert.ok(lines.some((l) => l.type === 'add' && l.text === 'c'))
  assert.ok(lines.some((l) => l.type === 'remove' && l.text === 'b'))
}

// 10. No secrets appear in diff data
{
  const secretOld = frag([
    {
      file_path: 'lib/config.ts',
      file_content: 'export const KEY = "sk-secretKEY1234567890abcdef"\n',
    },
  ])
  const secretNew = frag([
    {
      file_path: 'lib/config.ts',
      file_content:
        'export const KEY = "sk-secretKEY1234567890abcdef"\nexport const H = "Bearer abcdefghijklmnop"\n',
    },
  ])
  const diff = diffFragments(secretOld as any, secretNew as any)
  const raw = JSON.stringify(diff)
  assert.ok(!raw.includes('sk-secretKEY1234567890abcdef'))
  assert.ok(!raw.includes('Bearer abcdefghijklmnop'))
  assert.ok(raw.includes('[redacted]'))
  assert.equal(scrubSecrets('Bearer tokentokentoken'), 'Bearer [redacted]')
}

{
  const summary = summarizeSourceDiff(diffFragments(oldApp as any, newApp as any))
  assert.ok(!('files' in summary))
  assert.ok(summary.addedFiles.length > 0)
}

console.log('source-diff.test.ts: all tests passed')
