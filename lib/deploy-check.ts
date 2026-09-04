import assert from 'node:assert/strict'
import { isStaticSite, withDeployScaffold } from './deploy-scaffold'
import { deploySlug } from './project-meta'

assert.equal(deploySlug('AbC-123_xyz', 'minimal'), 'evo-abc123xyz-minimal')
assert.ok(deploySlug('p', 'solo').startsWith('evo-'))
assert.ok(deploySlug('p', 'solo').length <= 52)

const pages = withDeployScaffold([
  { file_path: 'pages/index.tsx', file_content: 'export default function P(){return null}' },
])
assert.ok(pages.some((f) => f.file_path === 'package.json'))
assert.ok(pages.some((f) => f.file_path === 'next.config.js'))
assert.ok(pages.some((f) => f.file_path === 'pages/_app.jsx'))
assert.equal(isStaticSite(pages), false)

const again = withDeployScaffold(pages)
assert.equal(again.filter((f) => f.file_path === 'package.json').length, 1)

const html = withDeployScaffold([
  { file_path: 'index.html', file_content: '<html><body>hi</body></html>' },
])
assert.equal(isStaticSite(html), true)
assert.ok(!html.some((f) => f.file_path === 'package.json'))

console.log('deploy-check ok')
