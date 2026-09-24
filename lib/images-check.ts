import assert from 'node:assert/strict'
import {
  extractImageQueries,
  isSafeImageUrl,
  rankCandidates,
  rewriteImageRefs,
  validateImageBytes,
} from './images'
import type { ImageCandidate } from './images-shared'

const src = `
<img src="evo-image://Samsung Galaxy S25 product photograph" alt="Samsung Galaxy S25" />
<img src='evo-image://Goa beach sunset' alt="Goa" />
<Image src="evo-image://Samsung Galaxy S25 product photograph" />
<div style={{ backgroundImage: 'url("evo-image://modern architecture building facade")' }} />
div { background-image: url('evo-image://modern architecture building facade'); }
`

const queries = extractImageQueries(src)
assert.deepEqual(queries, [
  'Samsung Galaxy S25 product photograph',
  'Goa beach sunset',
  'modern architecture building facade',
])

const map = new Map([
  ['Samsung Galaxy S25 product photograph', '/evo-images/samsung-galaxy-s25-aaaa.jpg'],
  ['Goa beach sunset', '/evo-images/goa-beach-sunset-bbbb.jpg'],
  ['modern architecture building facade', '/evo-images/modern-architecture-cccc.jpg'],
])
const rewritten = rewriteImageRefs(src, map)
assert.doesNotMatch(rewritten, /evo-image:/)
assert.match(rewritten, /src="\/evo-images\/samsung-galaxy-s25-aaaa\.jpg"/)
assert.match(rewritten, /src='\/evo-images\/goa-beach-sunset-bbbb\.jpg'/)
assert.match(rewritten, /url\("\/evo-images\/modern-architecture-cccc\.jpg"\)/)
assert.match(rewritten, /url\('\/evo-images\/modern-architecture-cccc\.jpg'\)/)

const missing = rewriteImageRefs(
  '<img src="evo-image://unknown subject" />',
  new Map(),
)
assert.equal(missing.trim(), '')
assert.doesNotMatch(missing, /evo-image:/)
assert.doesNotMatch(missing, /data:image/)
const missingBg = rewriteImageRefs(
  'background-image: url("evo-image://unknown subject")',
  new Map(),
)
assert.match(missingBg, /background-image: none/)
assert.doesNotMatch(missingBg, /evo-image:/)
assert.doesNotMatch(missingBg, /data:image/)

assert.equal(isSafeImageUrl('https://upload.wikimedia.org/wikipedia/commons/a/aa/x.jpg'), true)
assert.equal(isSafeImageUrl('https://live.staticflickr.com/1/2.jpg'), true)
assert.equal(isSafeImageUrl('file:///etc/passwd'), false)
assert.equal(isSafeImageUrl('http://localhost/secret.jpg'), false)
assert.equal(isSafeImageUrl('http://127.0.0.1/x.jpg'), false)
assert.equal(isSafeImageUrl('http://192.168.1.9/x.jpg'), false)
assert.equal(isSafeImageUrl('http://10.0.0.2/x.jpg'), false)
assert.equal(isSafeImageUrl('javascript:alert(1)'), false)

const jpeg = new Uint8Array(3000)
jpeg[0] = 0xff
jpeg[1] = 0xd8
jpeg[2] = 0xff
jpeg[3] = 0xe0
assert.deepEqual(validateImageBytes(jpeg, 'image/jpeg'), {
  mime: 'image/jpeg',
  ext: 'jpg',
})
assert.equal(validateImageBytes(jpeg.subarray(0, 100), 'image/jpeg'), null)

const html = new Uint8Array(3000)
const htmlHead = new TextEncoder().encode('<!DOCTYPE html><html>')
html.set(htmlHead)
assert.equal(validateImageBytes(html, 'image/jpeg'), null)
assert.equal(validateImageBytes(jpeg, 'text/html'), null)

const tiny = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
assert.equal(validateImageBytes(tiny, 'image/png'), null)

const ranked = rankCandidates('samsung galaxy phone', [
  {
    title: 'Unrelated cat',
    url: 'https://example.com/cat.jpg',
    width: 200,
    height: 200,
    source: 'x',
    provider: 'openverse',
  },
  {
    title: 'Samsung Galaxy Phone',
    url: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/Samsung.jpg',
    width: 4032,
    height: 3024,
    source: 'wikimedia',
    license: 'by',
    provider: 'openverse',
  },
] satisfies ImageCandidate[])
assert.equal(ranked[0].title, 'Samsung Galaxy Phone')
assert.equal(ranked.length, 1)
assert.equal(
  rankCandidates('x', [
    { title: 'x', url: 'file:///tmp/x.jpg', source: 'x', provider: 'openverse' },
  ]).length,
  0,
)

console.log('images-check ok')
