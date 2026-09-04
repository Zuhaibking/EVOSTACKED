import assert from 'node:assert/strict'
import { withCaptureLayer } from './capture-layer'
import { detectDataCollection } from './detect-data-collection'

const files = [
  {
    file_path: 'pages/index.tsx',
    file_content: '<form><input name="email" /></form>',
  },
]

assert.equal(detectDataCollection(files), true)

const once = withCaptureLayer(files, {
  projectId: 'p1',
  candidateId: 'minimal',
  runId: 'r1',
})
const twice = withCaptureLayer(once, {
  projectId: 'p1',
  candidateId: 'minimal',
  runId: 'r1',
})

assert.ok(once.some((f) => f.file_path === 'public/evostack-capture.js'))
assert.ok(once.some((f) => f.file_path === 'pages/api/evostack/submit.ts'))
assert.ok(once.some((f) => f.file_path === 'pages/_document.tsx'))
assert.equal(once.length, twice.length)
assert.ok(once.find((f) => f.file_path === 'public/evostack-capture.js')?.file_content.includes('evostack-capture'))

const html = withCaptureLayer(
  [{ file_path: 'index.html', file_content: '<html><body><form></form></body></html>' }],
  { projectId: 'p1', candidateId: 'solo', runId: 'r1' },
)
assert.ok(html.find((f) => f.file_path === 'index.html')?.file_content.includes('/evostack-capture.js'))

console.log('capture-layer-check ok')
