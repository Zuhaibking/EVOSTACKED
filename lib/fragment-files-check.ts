import assert from 'node:assert/strict'
import {
  fragmentFiles,
  fragmentWithFiles,
  localImports,
  withMissingLocalModules,
} from './fragment-files'

const springCrash = `<motion.div animate={{ scale: [1.13, 0.97, 1] }} transition={{ type: "spring" }}>`
const springFixed = fragmentFiles({
  file_path: 'pages/index.tsx',
  code: springCrash,
})[0].file_content
assert.match(springFixed, /type: "tween"/)
assert.doesNotMatch(springFixed, /type: "spring"/)

const styled = fragmentFiles({
  file_path: 'pages/index.tsx',
  code: `<style>{\`.x { font-family: 'Montserrat'; }\`}</style>`,
})[0].file_content
assert.match(styled, /dangerouslySetInnerHTML/)
assert.doesNotMatch(styled, /<style>\{\`/)

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

const explicit = fragmentFiles({ file_path: './pages/index.tsx', code: spotify, files: [
  { file_path: 'components/Sidebar.tsx', file_content: 'export default function Sidebar(){ return <aside>Library</aside> }' },
  { file_path: 'styles/Sidebar.module.css', file_content: '.sidebar { display: flex; }' },
  { file_path: 'data/music.json', file_content: '{"title":"Library"}' },
] })
assert.equal(explicit.length, 4)
assert.equal(explicit[0].file_path, 'pages/index.tsx')
assert.equal(withMissingLocalModules(explicit, false), explicit, 'Explicit projects must never fabricate missing modules')
const returned = fragmentWithFiles({ file_path: './pages/index.tsx', code: spotify }, explicit)
assert.equal(returned.files.length, 3)
assert.deepEqual(fragmentFiles(returned), explicit, 'Returned project retains every source file')
for (const path of ['../steal.ts', '/tmp/steal.ts', 'data/../../steal.ts', 'package.json', 'src/next.config.js', '.env.local', 'public/evo-images/fake.jpg']) {
  assert.throws(() => fragmentFiles({ file_path: 'pages/index.tsx', code: spotify, files: [{ file_path: path, file_content: 'unsafe' }] }), path)
}
assert.throws(() => fragmentFiles({ file_path: 'pages/index.tsx', code: spotify, files: [{ file_path: './pages/index.tsx', file_content: spotify }] }), 'Entry duplication is rejected')
assert.throws(() => fragmentFiles({ file_path: 'pages/index.tsx', code: spotify, files: [{ file_path: 'data', file_content: 'file' }, { file_path: 'data/site.ts', file_content: 'data' }] }), 'File/folder collisions are rejected')
assert.throws(() => fragmentFiles({ file_path: 'pages/index.tsx', code: spotify, files: [{ file_path: 'components/Empty.tsx', file_content: ' ' }] }), 'Empty source is rejected')

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

function strip(p: string) {
  return p.replace(/\.ts$/, '')
}

console.log('fragment-files-check ok')
