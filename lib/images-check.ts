import assert from 'node:assert/strict'
import {
  extractImageQueries,
  isSafeImageUrl,
  rankCandidates,
  resolveImages,
  rewriteImageRefs,
  scoreCandidate,
  searchQueries,
  validateImageBytes,
} from './images'
import type { ImageCandidate } from './images-shared'
import { parseCleveland } from './images-cleveland'
import { parseMetObject, parseMetSearch } from './images-met'
import { parseOpenverse } from './images-openverse'
import { parseWikimedia } from './images-wikimedia'

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

const wiki = parseWikimedia({
  query: {
    pages: {
      '1': {
        title: 'File:Moz kids sneakers. (51107416146).jpg',
        imageinfo: [
          {
            url: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/sneakers.jpg',
            mime: 'image/jpeg',
            size: 1000,
            width: 800,
            height: 600,
            extmetadata: {
              ObjectName: { value: 'Kids sneakers' },
              ImageDescription: {
                value: '<p>A pair of Vivobarefoot sneakers</p>',
              },
              Categories: {
                value:
                  'CC-Zero|Sneakers (footwear)|Self-published work|Flickr images reviewed by FlickreviewR 2|Vivobarefoot shoes',
              },
              Artist: { value: 'Xzpq' },
              LicenseShortName: { value: 'CC0' },
              LicenseUrl: { value: 'https://creativecommons.org/publicdomain/zero/1.0/' },
            },
          },
        ],
      },
    },
  },
})
assert.equal(wiki.length, 1)
assert.equal(wiki[0].title, 'Kids sneakers')
assert.equal(wiki[0].description, 'A pair of Vivobarefoot sneakers')
assert.deepEqual(wiki[0].tags, ['Sneakers (footwear)', 'Vivobarefoot shoes'])
assert.equal(wiki[0].fieldsMatched, undefined)
assert.equal(wiki[0].creator, 'Xzpq')
assert.equal(wiki[0].license, 'CC0')

const open = parseOpenverse({
  results: [
    {
      title: 'Galaxy phone',
      url: 'https://example.com/phone.jpg',
      description: '  A Samsung Galaxy on a desk  ',
      tags: [{ name: 'samsung' }, { name: 'phone' }, { name: '' }, 'android'],
      fields_matched: ['title', 'tags', 'description'],
      mature: false,
    },
  ],
})
assert.equal(open.length, 1)
assert.equal(open[0].description, 'A Samsung Galaxy on a desk')
assert.deepEqual(open[0].tags, ['samsung', 'phone', 'android'])
assert.deepEqual(open[0].fieldsMatched, ['title', 'tags', 'description'])

const sameQuality = { width: 800, height: 800, source: 'x', provider: 'openverse' }

const redCarA = scoreCandidate(
  {
    title: 'Red Sports Car',
    url: 'https://example.com/a.jpg',
    tags: ['car', 'red', 'sports'],
    description: 'A red sports car',
    ...sameQuality,
  },
  ['red', 'car'],
)
const redCarB = scoreCandidate(
  {
    title: 'Beautiful Car',
    url: 'https://example.com/b.jpg',
    tags: ['car'],
    description: 'A beautiful vehicle',
    ...sameQuality,
  },
  ['red', 'car'],
)
assert.ok(redCarA > redCarB)

const archA = scoreCandidate(
  {
    title: 'Modern Architecture',
    url: 'https://example.com/c.jpg',
    tags: ['architecture', 'modern'],
    ...sameQuality,
  },
  ['modern', 'architecture'],
)
const archB = scoreCandidate(
  {
    title: 'Old Building',
    url: 'https://example.com/d.jpg',
    tags: ['building'],
    ...sameQuality,
  },
  ['modern', 'architecture'],
)
assert.ok(archA > archB)

const packWords = ['luxury', 'black', 'condom', 'packaging']
const packA = scoreCandidate(
  {
    title: 'Luxury black condom packaging',
    url: 'https://example.com/e.jpg',
    tags: ['condom', 'packaging', 'black'],
    description: 'Luxury black condom product packaging on a studio backdrop',
    ...sameQuality,
  },
  packWords,
)
const packB = scoreCandidate(
  {
    title: 'Product photo',
    url: 'https://example.com/f.jpg',
    tags: ['product'],
    ...sameQuality,
  },
  packWords,
)
const packBlank = scoreCandidate(
  { title: '', url: 'https://example.com/g.jpg', ...sameQuality },
  packWords,
)
assert.ok(packA > packB)
assert.equal(packB, packBlank)

const kidsA = scoreCandidate(
  {
    title: '',
    url: 'https://example.com/h.jpg',
    description: "A pair of children's sneakers",
    tags: ['Sneakers (footwear)'],
    ...sameQuality,
  },
  ['kids', 'sneakers'],
)
const kidsB = scoreCandidate(
  {
    title: 'Product photo',
    url: 'https://example.com/i.jpg',
    tags: ['photo', 'image'],
    ...sameQuality,
  },
  ['kids', 'sneakers'],
)
assert.ok(kidsA > kidsB)

function assertSearchVariants(
  query: string,
  opts: { mustInclude: string[]; forbid: string[]; everyMustMatch?: RegExp },
) {
  const variants = searchQueries(query)
  assert.equal(variants[0], query)
  assert.equal(new Set(variants.map((v) => v.toLowerCase())).size, variants.length)
  assert.ok(variants.length >= 1 && variants.length <= 8)
  for (const v of opts.mustInclude) {
    assert.ok(
      variants.some((x) => x.toLowerCase() === v.toLowerCase()),
      `missing variant "${v}" in ${JSON.stringify(variants)}`,
    )
  }
  for (const v of opts.forbid) {
    assert.ok(
      !variants.some((x) => x.toLowerCase() === v.toLowerCase()),
      `forbidden variant "${v}" in ${JSON.stringify(variants)}`,
    )
  }
  for (const v of variants) {
    const words = v.split(/\s+/).filter(Boolean)
    assert.ok(words.length >= 2, `too short: "${v}"`)
    if (opts.everyMustMatch) {
      assert.match(v, opts.everyMustMatch)
    }
  }
}

assertSearchVariants('luxury black condom product packaging', {
  mustInclude: [
    'black condom packaging',
    'condom packaging',
    'black condom',
    'condom product',
  ],
  forbid: ['luxury black', 'luxury', 'black', 'packaging'],
  everyMustMatch: /condom/i,
})

assertSearchVariants('modern architecture building facade', {
  mustInclude: [
    'modern architecture building',
    'architecture building facade',
    'modern architecture',
    'architecture building',
  ],
  forbid: ['modern', 'luxury modern', 'modern beautiful'],
})

assertSearchVariants('Samsung Galaxy S25 product photograph', {
  mustInclude: ['Samsung Galaxy S25', 'Samsung Galaxy S25 product', 'Galaxy S25'],
  forbid: ['product photograph', 'photograph', 'Samsung'],
})

assertSearchVariants('Goa beach sunset', {
  mustInclude: ['Goa beach', 'beach sunset', 'Goa sunset'],
  forbid: ['Goa', 'sunset'],
})

assertSearchVariants('premium black packaging', {
  mustInclude: ['black packaging'],
  forbid: ['premium black', 'premium', 'black'],
  everyMustMatch: /packaging/i,
})

const metOk = parseMetObject({
  objectID: 436524,
  isPublicDomain: true,
  title: 'Sunflowers',
  objectName: 'Painting',
  culture: 'Dutch',
  period: '',
  classification: 'Paintings',
  department: 'European Paintings',
  artistDisplayName: 'Vincent van Gogh',
  medium: 'Oil on canvas',
  primaryImage:
    'https://images.metmuseum.org/CRDImages/ep/original/DP-41223-001.jpg',
  objectURL: 'https://www.metmuseum.org/art/collection/search/436524',
  tags: [{ term: 'Sunflowers' }, { term: 'Still Life' }],
})
assert.ok(metOk)
assert.equal(metOk.title, 'Sunflowers')
assert.equal(metOk.description, 'Oil on canvas')
assert.equal(metOk.creator, 'Vincent van Gogh')
assert.equal(metOk.license, 'CC0')
assert.equal(metOk.provider, 'met')
assert.ok(metOk.tags?.includes('Paintings'))
assert.ok(metOk.tags?.includes('Sunflowers'))

assert.equal(
  parseMetObject({
    objectID: 1,
    isPublicDomain: false,
    title: 'Copyrighted work',
    primaryImage: 'https://images.metmuseum.org/CRDImages/ep/original/x.jpg',
  }),
  null,
)

const cmaOk = parseCleveland({
  data: [
    {
      share_license_status: 'CC0',
      title: 'White Flower',
      description: 'A close-up flower painting',
      type: 'Painting',
      technique: 'oil on canvas',
      department: 'American Painting and Sculpture',
      culture: ['America'],
      creators: [{ description: "Georgia O'Keeffe (American, 1887–1986)" }],
      url: 'https://clevelandart.org/art/1930.2162',
      images: {
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1930.2162/1930.2162_print.jpg',
          width: '3400',
          height: '2836',
        },
        full: {
          url: 'https://openaccess-cdn.clevelandart.org/1930.2162/1930.2162_full.tif',
        },
      },
    },
  ],
})
assert.equal(cmaOk.length, 1)
assert.equal(cmaOk[0].title, 'White Flower')
assert.equal(cmaOk[0].description, 'A close-up flower painting')
assert.equal(cmaOk[0].creator, "Georgia O'Keeffe (American, 1887–1986)")
assert.equal(cmaOk[0].license, 'CC0')
assert.equal(cmaOk[0].provider, 'cleveland')
assert.match(cmaOk[0].url, /\.jpg$/)
assert.ok(cmaOk[0].tags?.includes('Painting'))

assert.equal(
  parseCleveland({
    data: [
      {
        share_license_status: 'CC0',
        title: 'No image work',
        images: {},
      },
    ],
  }).length,
  0,
)

assert.equal(parseMetObject(null), null)
assert.equal(parseMetObject('nope'), null)
assert.deepEqual(parseMetSearch(null), [])
assert.deepEqual(parseMetSearch({ objectIDs: 'nope' }), [])
assert.deepEqual(parseCleveland(null), [])
assert.deepEqual(parseCleveland({}), [])
assert.deepEqual(parseCleveland({ data: [null, 1, { title: 'x' }] }), [])

console.log('images-check ok')

async function checkPhotoBudget() {
  const originalFetch = globalThis.fetch
  const originalTimeout = AbortSignal.timeout
  const calls: string[] = []
  try {
    AbortSignal.timeout = ms => originalTimeout(ms === 30_000 ? 5 : ms)
    // This adapter deliberately ignores cancellation and responds late.
    globalThis.fetch = async url => {
      calls.push(String(url))
      await new Promise(resolve => setTimeout(resolve, 40))
      return Response.json({ results: [{ title: 'Campus courtyard', url: 'https://fixture.invalid/campus.jpg', mature: false }] })
    }
    const result = await resolveImages([{ file_path: 'components/Hero.tsx', file_content: '<main><h1>Welcome</h1><img src="evo-image://campus courtyard" /></main>' }])
    assert.equal(result.assets.length, 0)
    assert.doesNotMatch(result.files[0].file_content, /evo-image:/)
    assert.match(result.files[0].file_content, /<h1>Welcome<\/h1>/)
    assert.equal(calls.length, 1)
    await new Promise(resolve => setTimeout(resolve, 60))
    assert.equal(calls.length, 1, 'A late search response cannot trigger downloads or fallback providers')
    const canceled = new AbortController()
    canceled.abort()
    await resolveImages([{ file_path: 'styles/Hero.module.css', file_content: '.hero { background: url("evo-image://campus courtyard"); }' }], canceled.signal)
    assert.equal(calls.length, 1, 'Canceled photo batches cannot start requests')
    console.log('images-check photo budget ok: omission preserves app, ignored-abort response cannot continue searches/downloads')
  } finally { globalThis.fetch = originalFetch; AbortSignal.timeout = originalTimeout }
}

void checkPhotoBudget().catch(error => { console.error(error); process.exitCode = 1 })
