import assert from 'node:assert/strict'
import {
  fragmentFiles,
  localImports,
  withMissingLocalModules,
} from './fragment-files'

const spotify = `import React, { useState } from 'react'
import Head from 'next/head'
import mockData from '../data/data'
import Sidebar from '../components/Sidebar'
import { songs, playlists } from '../data/tracks'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export default function Page() {
  return <Sidebar items={mockData.playlists} songs={songs} lists={playlists} />
}
`

assert.deepEqual(fragmentFiles({ file_path: 'pages/index.tsx', code: spotify }), [
  { file_path: 'pages/index.tsx', file_content: spotify },
])

const multi = fragmentFiles({
  file_path: 'pages/index.tsx',
  code: [
    { file_path: 'pages/index.tsx', file_content: 'import x from "../data/data"' },
    { file_path: 'data/data.ts', file_content: 'export default { playlists: [] }' },
  ],
})
assert.equal(multi.length, 2)
assert.equal(multi[1].file_path, 'data/data.ts')

const imports = localImports(spotify, 'pages/index.tsx')
assert.deepEqual(
  imports.map((i) => i.resolved).sort(),
  ['components/Sidebar', 'data/data', 'data/tracks'].sort(),
)
assert.equal(imports.find((i) => i.resolved === 'data/data')?.defaultName, 'mockData')
assert.deepEqual(imports.find((i) => i.resolved === 'data/tracks')?.names, [
  'songs',
  'playlists',
])

const patched = withMissingLocalModules([
  { file_path: 'pages/index.tsx', file_content: spotify },
])
assert.ok(patched.some((f) => f.file_path === 'data/data.ts'))
assert.ok(patched.some((f) => f.file_path === 'components/Sidebar.ts'))
assert.ok(patched.some((f) => f.file_path === 'data/tracks.ts'))
assert.ok(!patched.some((f) => f.file_path.includes('lib/utils')))
assert.ok(!patched.some((f) => f.file_path.includes('components/ui')))

const already = withMissingLocalModules([
  { file_path: 'pages/index.tsx', file_content: 'import mockData from "../data/data"\n' },
  { file_path: 'data/data.ts', file_content: 'export default { ok: true }\n' },
])
assert.equal(already.filter((f) => strip(f.file_path) === 'data/data').length, 1)
assert.match(already[1].file_content, /ok: true/)

const hooks = withMissingLocalModules([
  {
    file_path: 'pages/index.tsx',
    file_content: 'import { useApp, useFlowState } from "../state/app"\n',
  },
])
const hookFile = hooks.find((f) => f.file_path.includes('state/app'))
assert.ok(hookFile)
assert.match(hookFile.file_content, /export function useApp/)
assert.match(hookFile.file_content, /export function useFlowState/)
assert.match(hookFile.file_content, /Proxy/)

function strip(p: string) {
  return p.replace(/\.ts$/, '')
}

console.log('fragment-files-check ok')
