import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import ts from 'typescript'
import {
  extractImageQueries,
  extractLocalImages,
  isSafeImageUrl,
  parseImageRef,
  rankCandidates,
  resolveImages,
  rewriteImageRefs,
  scoreCandidate,
  searchQueries,
  sniffImage,
  stockRelevance,
  validateImageBytes,
} from './images'
import { AI_PROVIDER, planAiImage } from './images-ai'
import { imageCacheKey, readCachedImage } from './images-cache'
import { placeholderBytes, placeholderPng, placeholderSvg } from './images-placeholder'
import { providerAvailable, recordProvider, resetProviderBreakers, type ImageCandidate } from './images-shared'
import { parseCleveland } from './images-cleveland'
import { parseMetObject, parseMetSearch } from './images-met'
import { parseOpenverse } from './images-openverse'
import { parseWikimedia } from './images-wikimedia'

// Never touch the real cache, the real OpenAI key, or a shared rate-limit store from checks.
process.env.EVOSTACK_IMAGE_CACHE_DIR = mkdtempSync(path.join(tmpdir(), 'evo-image-cache-'))
delete process.env.OPENAI_API_KEY
delete process.env.EVOSTACK_IMAGE_MODE
delete process.env.EVOSTACK_IMAGE_MODELS
delete process.env.EVOSTACK_IMAGE_BUDGET_MS
delete process.env.EVOSTACK_IMAGE_TIMEOUT_MS
delete process.env.EVOSTACK_IMAGE_USER_HOURLY
delete process.env.EVOSTACK_IMAGE_GLOBAL_HOURLY
delete process.env.KV_REST_API_URL
delete process.env.KV_REST_API_TOKEN

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

// Unresolved references point at their deterministic SVG placeholder: never empty, deleted, or `none`.
const missing = rewriteImageRefs(
  '<img src="evo-image://unknown subject" />',
  new Map(),
)
assert.match(missing, /^<img src="\/evo-images\/unknown-subject-landscape-[0-9a-f]{10}\.svg" \/>$/)
assert.equal(missing, rewriteImageRefs('<img src="evo-image://unknown subject" />', new Map()))
const missingBg = rewriteImageRefs(
  'background-image: url("evo-image://unknown subject")',
  new Map(),
)
assert.match(missingBg, /background-image: url\("\/evo-images\/unknown-subject-landscape-[0-9a-f]{10}\.svg"\)/)
assert.doesNotMatch(missingBg, /evo-image:|none|data:image/)
// A bare quoted scheme is completed at runtime (src += slug): PNG placeholder + "?" keeps any suffix harmless.
assert.match(rewriteImageRefs('<img src="evo-image://" />', new Map()), /src="\/evo-images\/image-landscape-[0-9a-f]{10}\.png\?"/)
assert.match(rewriteImageRefs('.x { background: url(evo-image://); }', new Map()), /url\(\/evo-images\/image-landscape-[0-9a-f]{10}\.svg\)/)
assert.match(rewriteImageRefs('<img src="evo-image://team headshot of a smiling founder" />', new Map()), /-square-[0-9a-f]{10}\.svg"/)
assert.deepEqual(parseImageRef('cozy cafe interior#portrait'), { query: 'cozy cafe interior', aspect: 'portrait' })
assert.deepEqual(parseImageRef('cozy cafe interior'), { query: 'cozy cafe interior' })
assert.deepEqual(extractLocalImages('<img src="/evo-images/a-1.webp"/> url(/evo-images/b.svg) "/evo-images/manifest.json"'), ['a-1.webp', 'b.svg'])
const svgA = placeholderSvg('0123456789', 'portrait')
assert.equal(svgA, placeholderSvg('0123456789', 'portrait'))
assert.match(svgA, /viewBox="0 0 1024 1536"/)
assert.doesNotMatch(svgA, /<text|<image|href=/)

// References completed at runtime never extend a placeholder into a missing file, and never buy a photo for a fragment.
const concatSrc = [
  "const car = { slug: 'ghost', name: 'Ghost', make: 'Rolls', model: 'Ghost', tags: ['a'], photo: 'p' }",
  "export const a = <img src={'evo-image://' + car.slug} alt={car.name} />",
  'export const b = <img src={"evo-image://luxury " + car.name} alt={car.name} />',
  'export const c = `evo-image://${car.make}`.concat(car.model)',
  "export let d = 'evo-image://'; d += car.slug",
  "export const e = <img src={`evo-image://${car.tags.join(', ')} sedan`} alt='Tags' />",
  'export const f = <div style={{ backgroundImage: `url(evo-image://${encodeURIComponent(car.photo)})` }} />',
  "export const g = <img src={'evo-image://black Rolls-Royce Ghost sedan in a showroom'} alt='Ghost' />",
  "export const h = <div style={{ backgroundImage: 'url(evo-image://' + car.slug + ')' }} />",
  'export const i = <div style={{ backgroundImage: "url(\'evo-image://luxury " + car.name + "\')" }} />',
  'export const j = <p>Don\'t miss it <img src={"evo-image://" + car.slug} alt="x" /> it\'s here</p>',
].join('\n')
assert.deepEqual(extractImageQueries(concatSrc), [
  "${car.tags.join(', ')} sedan",
  '${encodeURIComponent(car.photo)}',
  'black Rolls-Royce Ghost sedan in a showroom',
])
const concatOut = rewriteImageRefs(concatSrc, new Map([['black Rolls-Royce Ghost sedan in a showroom', '/evo-images/ghost-0123456789ab.webp']]))
assert.doesNotMatch(concatOut, /evo-image:/)
assert.match(concatOut, /src=\{'\/evo-images\/image-landscape-[0-9a-f]{10}\.png\?' \+ car\.slug\}/)
assert.match(concatOut, /src=\{"\/evo-images\/luxury-landscape-[0-9a-f]{10}\.png\?" \+ car\.name\}/)
assert.match(concatOut, /`\/evo-images\/image-landscape-[0-9a-f]{10}\.png\?`\.concat\(car\.model\)/)
assert.match(concatOut, /let d = '\/evo-images\/image-landscape-[0-9a-f]{10}\.png\?'; d \+= car\.slug/)
assert.match(concatOut, /src=\{`\/evo-images\/car-tags-join-sedan-landscape-[0-9a-f]{10}\.svg`\}/)
assert.match(concatOut, /url\(\/evo-images\/encodeuricomponent-car-photo-landscape-[0-9a-f]{10}\.svg\)` \}\}/)
assert.match(concatOut, /src=\{'\/evo-images\/ghost-0123456789ab\.webp'\}/)
assert.match(concatOut, /backgroundImage: 'url\(\/evo-images\/image-landscape-[0-9a-f]{10}\.png\?' \+ car\.slug \+ '\)'/)
assert.match(concatOut, /backgroundImage: "url\('\/evo-images\/luxury-landscape-[0-9a-f]{10}\.png\?" \+ car\.name \+ "'\)"/)
assert.match(concatOut, /<p>Don't miss it <img src=\{"\/evo-images\/image-landscape-[0-9a-f]{10}\.png\?" \+ car\.slug\} alt="x" \/> it's here<\/p>/)
const tsx = ts.transpileModule(concatOut, { fileName: 'page.tsx', reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve } })
assert.deepEqual(tsx.diagnostics?.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
const appendedPath = /'(\/evo-images\/image-landscape-[0-9a-f]{10}\.png)\?' \+ car\.slug/.exec(concatOut)![1]
assert.equal(new URL(`${appendedPath}?ghost`, 'http://preview.invalid').pathname, appendedPath, 'the appended slug lands in the query string')

// The runtime placeholder is a real PNG at the right aspect ratio (no SVG: next/image 14 would send it to the optimizer).
const png = placeholderPng('0123456789', 'landscape')
assert.deepEqual(sniffImage(png), { mime: 'image/png', ext: 'png' })
assert.deepEqual([new DataView(png.buffer).getUint32(16), new DataView(png.buffer).getUint32(20)], [240, 160])
assert.equal(inflateSync(png.subarray(41, 41 + new DataView(png.buffer).getUint32(33))).length, 160 * (1 + 240 * 3))
assert.deepEqual(placeholderPng('0123456789', 'landscape'), png)
assert.equal(placeholderBytes('x-portrait-0123456789.png').mime, 'image/png')
assert.equal(new DataView(placeholderBytes('x-portrait-0123456789.png').bytes.buffer).getUint32(20), 240)
assert.equal(placeholderBytes('x-portrait-0123456789.svg').mime, 'image/svg+xml')

// Stock relevance: the subject's head noun or proper names, as whole words.
const candidate = (title: string): ImageCandidate => ({ title, url: 'https://upload.wikimedia.org/x.jpg', source: 'wikimedia', provider: 'wikimedia' })
const mechanic = stockRelevance('senior male mechanic working on an engine')
assert.equal(mechanic(candidate('Smiling senior woman with curly hair portrait')), false)
assert.equal(mechanic(candidate('Mechanics repairing a car engine')), true)
assert.equal(stockRelevance('portrait of a female sales director in a navy suit#portrait')(candidate('Self-portrait')), false)
const maybach = stockRelevance('two-tone Mercedes-Maybach S-Class at a glass villa at dusk')
assert.equal(maybach(candidate('Rank Badge with Decoration of Two Cranes among Clouds')), false)
assert.equal(maybach(candidate('Mercedes-Maybach S 680 (Z223) at IAA 2021')), true)
const ghostRelevant = stockRelevance('black Rolls-Royce Ghost sedan in a dark luxury showroom, studio lighting')
assert.equal(ghostRelevant(candidate('Ghost costume')), false)
assert.equal(ghostRelevant(candidate('2021 Rolls-Royce Ghost')), true)
assert.equal(ghostRelevant(candidate('Black sedan parked downtown')), true)
assert.equal(stockRelevance('fresh croissants and coffee on a marble counter')(candidate('Croissants')), true)
assert.equal(stockRelevance('barista pouring latte art in a cafe')(candidate('Latte art')), true)
// A template literal that never closes on its line fails fast (no exponential backtracking).
const unclosed = `<img src={\`evo-image://${'${a}'.repeat(40)}\n`
const regexStarted = Date.now()
assert.deepEqual(extractImageQueries(unclosed), ['${a}'.repeat(40)])
assert.ok(Date.now() - regexStarted < 200, 'linear-time reference scan')
const ghostPlan = planAiImage('black Rolls-Royce Ghost sedan in a dark luxury showroom, studio lighting', { title: 'Ghost Motors' })
assert.equal(ghostPlan.size, '1536x1024')
assert.match(ghostPlan.prompt, /Ghost Motors/)
assert.match(ghostPlan.prompt, /commercial photography/)
assert.match(ghostPlan.prompt, /No text/)
assert.equal(planAiImage('portrait headshot of a smiling dentist').size, '1024x1024')
assert.equal(planAiImage('portrait headshot of a smiling dentist', {}, 'portrait').size, '1024x1536')
assert.match(planAiImage('wood-fired margherita pizza on a rustic table').prompt, /food photography/)
assert.match(planAiImage('sunlit coworking space with plants').prompt, /interior photography/)
assert.notEqual(planAiImage('x y', { title: 'A' }).key, planAiImage('x y', { title: 'B' }).key)

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
    assert.equal(result.assets.length, 1)
    assert.equal(result.assets[0].source, 'placeholder')
    assert.doesNotMatch(result.files[0].file_content, /evo-image:/)
    assert.match(result.files[0].file_content, /<h1>Welcome<\/h1><img src="\/evo-images\/campus-courtyard-landscape-[0-9a-f]{10}\.svg" \/>/)
    assert.equal(result.binaries[0].file_path, `public/evo-images/${result.assets[0].file}`)
    assert.equal(result.manifest[0].source, 'placeholder')
    const started = calls.length
    assert.ok(started <= 4, 'one parallel search per provider at most')
    await new Promise(resolve => setTimeout(resolve, 60))
    assert.equal(calls.length, started, 'A late search response cannot trigger downloads or fallback providers')
    const canceled = new AbortController()
    canceled.abort()
    const css = await resolveImages([{ file_path: 'styles/Hero.module.css', file_content: '.hero { background: url("evo-image://campus courtyard"); }' }], canceled.signal)
    assert.equal(calls.length, started, 'Canceled photo batches cannot start requests')
    assert.match(css.files[0].file_content, /url\("\/evo-images\/campus-courtyard-landscape-[0-9a-f]{10}\.svg"\)/)
    console.log('images-check photo budget ok: a spent budget becomes placeholders, ignored-abort responses cannot continue searches/downloads')
  } finally { globalThis.fetch = originalFetch; AbortSignal.timeout = originalTimeout }
}

// Mocked requests wait on unref'd AbortSignal.timeout timers; keep the loop alive and fail closed
// unless every async check reaches the end (a drained loop would otherwise exit 0 mid-check).
process.exitCode = 1
const keepAlive = setInterval(() => {}, 1_000)
void checkPhotoBudget()
  .then(() => checkQueryConcurrency())
  .then(() => checkProviderBreaker())
  .then(() => checkAiImages())
  .then(() => checkAiHangFallsBackToStock())
  .then(() => checkStockFallbackCache())
  .then(() => checkAiQuota())
  .then(() => checkMuseumGate())
  .then(() => { process.exitCode = 0; console.log('images-check async ok') })
  .catch(error => { console.error(error); process.exitCode = 1 })
  .finally(() => clearInterval(keepAlive))

async function checkQueryConcurrency() {
  const originalFetch = globalThis.fetch
  let active = 0
  let max = 0
  const jpeg = new Uint8Array(3000)
  jpeg[0] = 0xff
  jpeg[1] = 0xd8
  jpeg[2] = 0xff
  jpeg[3] = 0xe0
  const queries = [
    'alpha courtyard photograph',
    'beta harbor photograph',
    'gamma mountain photograph',
    'delta forest photograph',
  ]
  try {
    globalThis.fetch = async (url) => {
      const href = String(url)
      if (href.includes('api.openverse.org')) {
        active++
        max = Math.max(max, active)
        await new Promise(resolve => setTimeout(resolve, 20))
        active--
        return Response.json({
          results: [{ title: 'courtyard harbor mountain forest', url: 'https://images.example.com/shared.jpg', mature: false, width: 1200, height: 800 }],
        })
      }
      if (href === 'https://images.example.com/shared.jpg') {
        return new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } })
      }
      return Response.json({ results: [] })
    }
    const result = await resolveImages([{
      file_path: 'pages/index.tsx',
      file_content: queries.map(query => `<img src="evo-image://${query}" />`).join(''),
    }])
    assert.ok(max >= 2 && max <= 3, `image queries overlapped ${max} at once`)
    assert.ok(result.manifest.every(row => row.source === 'openverse' && row.url === 'https://images.example.com/shared.jpg'))
    const paths = queries.map(query => {
      const file = result.files[0].file_content.match(new RegExp(`evo-image://${query.replace(/ /g, ' ')}`))
      assert.equal(file, null)
      return result.manifest.find(row => row.query === query)?.file
    })
    assert.ok(paths[0]?.startsWith('alpha-courtyard-'))
    assert.deepEqual(paths, [paths[0], paths[0], paths[0], paths[0]])
    assert.equal(result.binaries.length, 1)
    console.log('images-check query concurrency ok: cap 3, earliest query keeps the shared file')
  } finally { globalThis.fetch = originalFetch }
}

function fakeWebp(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set(new TextEncoder().encode('RIFF'), 0)
  bytes.set(new TextEncoder().encode('WEBPVP8 '), 8)
  return bytes
}

async function checkProviderBreaker() {
  const originalFetch = globalThis.fetch
  const jpeg = new Uint8Array(3000)
  jpeg.set([0xff, 0xd8, 0xff, 0xe0])
  let openverse = 0
  resetProviderBreakers()
  try {
    globalThis.fetch = async (url) => {
      const href = String(url)
      if (href.includes('api.openverse.org')) {
        openverse++
        return new Response('upstream timeout', { status: 504 })
      }
      if (href.includes('commons.wikimedia.org')) {
        return Response.json({ query: { pages: { 1: { title: 'File:Harbor.jpg', imageinfo: [{
          url: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/Harbor.jpg', mime: 'image/jpeg', size: 3000, width: 1600, height: 1000,
          extmetadata: { ObjectName: { value: 'Harbor boats' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: 'Ana' } },
        }] } } } })
      }
      if (href.startsWith('https://upload.wikimedia.org/')) return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } })
      return Response.json({})
    }
    const queries = ['harbor boats at dawn', 'harbor boats fishing at sea', 'harbor boats near a lighthouse', 'harbor boats by the seawall']
    const result = await resolveImages([{
      file_path: 'pages/index.tsx',
      file_content: queries.map(query => `<img src="evo-image://${query}" />`).join(''),
    }], undefined, { mode: 'stock' })
    assert.equal(openverse, 3, 'three consecutive failures open the openverse breaker')
    assert.equal(providerAvailable('openverse'), false)
    assert.ok(result.manifest.every(row => row.source === 'wikimedia'), JSON.stringify(result.manifest))
    assert.match(result.manifest[0].note, /^CC BY-SA 4\.0 — by Ana — /)
    assert.doesNotMatch(result.files[0].file_content, /evo-image:|\.svg/)
    console.log('images-check provider breaker ok: a dead provider is skipped and parallel providers still fill every photo')
  } finally {
    globalThis.fetch = originalFetch
    resetProviderBreakers()
  }
}

async function checkAiImages() {
  const originalFetch = globalThis.fetch
  const webp = fakeWebp(4096)
  const calls: { model: string; prompt: string; size: string; quality: string; output_format: string; output_compression: number; n: number; auth: string }[] = []
  process.env.OPENAI_API_KEY = 'sk-fixture'
  const context = { title: 'Ghost Motors', description: 'Luxury car dealership' }
  try {
    globalThis.fetch = async (url, init) => {
      const href = String(url)
      if (href === 'https://api.openai.com/v1/images/generations') {
        const body = JSON.parse(String(init?.body))
        calls.push({ ...body, auth: new Headers(init?.headers).get('authorization') || '' })
        if (body.prompt.includes('forbidden subject')) {
          return Response.json({ error: { code: 'moderation_blocked', message: 'Rejected by the safety system.' } }, { status: 400 })
        }
        if (body.model === 'gpt-image-2.6-flare' && body.prompt.includes('fallback model')) {
          return Response.json({ error: { message: 'The model does not exist.' } }, { status: 404 })
        }
        return Response.json({ data: [{ b64_json: Buffer.from(webp).toString('base64') }] })
      }
      return Response.json({ results: [] })
    }
    const code = [
      '<img src="evo-image://black Rolls-Royce Ghost sedan in a dark luxury showroom, studio lighting" alt="Ghost" />',
      '<img src="evo-image://portrait headshot of a smiling chef#square" alt="Chef" />',
      '<img src="evo-image://fallback model test car" alt="Car" />',
      '<img src="evo-image://forbidden subject" alt="Blocked" />',
      '<div style={{ backgroundImage: `url(evo-image://${item.photo})` }} />',
      "<img src={'evo-image://luxury ' + car.name} alt={car.name} />",
    ].join('\n')
    const result = await resolveImages([{ file_path: 'pages/index.tsx', file_content: code }], undefined, { context })
    const page = result.files[0].file_content
    assert.doesNotMatch(page, /evo-image:|src=""/)
    assert.equal(calls.filter(call => /Subject: luxury\b/.test(call.prompt)).length, 0, 'a concatenation prefix is never sent as a paid image')
    const runtime = result.manifest.find(row => row.portable === false)!
    assert.match(runtime.file, /^luxury-landscape-[0-9a-f]{10}\.png$/)
    assert.equal(runtime.source, 'placeholder')
    assert.match(page, new RegExp(`src=\\{'/evo-images/${runtime.file.replace(/\./g, '\\.')}\\?' \\+ car\\.name\\}`))
    assert.deepEqual(sniffImage(new Uint8Array(result.binaries.find(bin => bin.file_path === `public/evo-images/${runtime.file}`)!.data)), { mime: 'image/png', ext: 'png' })
    const ghost = result.manifest.find(row => row.query.startsWith('black Rolls-Royce Ghost'))!
    assert.equal(ghost.source, 'ai')
    assert.match(ghost.file, /^black-rolls-royce-ghost-sedan-[a-z-]+-[0-9a-f]{12}\.webp$/)
    assert.equal(ghost.note, 'AI-generated (gpt-image-2.6-flare)')
    assert.match(ghost.prompt || '', /Ghost Motors/)
    const first = calls.find(call => call.prompt.includes('Rolls-Royce'))!
    assert.deepEqual({ ...first, prompt: '' }, { model: 'gpt-image-2.6-flare', prompt: '', size: '1536x1024', quality: 'medium', output_format: 'webp', output_compression: 80, n: 1, auth: 'Bearer sk-fixture' })
    const chef = calls.find(call => call.prompt.includes('chef'))!
    assert.equal(chef.size, '1024x1024')
    assert.match(chef.prompt, /headshot/)
    assert.equal(result.manifest.find(row => row.query === 'portrait headshot of a smiling chef#square')?.source, 'ai')
    assert.equal(result.manifest.find(row => row.query === 'fallback model test car')?.model, 'gpt-image-1-mini')
    const blocked = result.manifest.find(row => row.query === 'forbidden subject')!
    assert.equal(blocked.source, 'placeholder')
    assert.equal(calls.filter(call => call.prompt.includes('forbidden subject')).length, 1, 'content-policy rejections skip the rest of the model chain')
    assert.match(page, /url\(\/evo-images\/item-photo-landscape-[0-9a-f]{10}\.svg\)/)
    for (const file of extractLocalImages(page)) {
      assert.ok(result.binaries.some(bin => bin.file_path === `public/evo-images/${file}`), `missing bytes for ${file}`)
    }
    const cacheFiles = readdirSync(process.env.EVOSTACK_IMAGE_CACHE_DIR!)
    assert.ok(cacheFiles.some(name => name.startsWith(ghost.file.slice(-17, -5)) && name.endsWith('.webp')))

    // Cache hits are free: only the rejected query is retried.
    const before = calls.length
    const again = await resolveImages([{ file_path: 'pages/index.tsx', file_content: code }], undefined, { context })
    assert.equal(calls.length - before, 1)
    assert.equal(again.files[0].file_content, page)

    // Chat/inspector edits resend rewritten source without the image map: bytes restore by hash.
    const edited = page.replace('alt="Ghost"', 'alt="Rolls-Royce Ghost"')
    const restoreCalls = calls.length
    const restored = await resolveImages([{ file_path: 'pages/index.tsx', file_content: edited }])
    assert.equal(calls.length, restoreCalls, 'restoring never calls the API')
    assert.equal(restored.files[0].file_content, edited)
    for (const file of extractLocalImages(edited)) {
      assert.ok(restored.binaries.some(bin => bin.file_path === `public/evo-images/${file}`), `not restored: ${file}`)
    }
    assert.ok(restored.manifest.some(row => row.source === 'ai' && row.query.startsWith('black Rolls-Royce Ghost') && row.file === ghost.file))
    // Placeholder names are lossy; the cache remembers each exact reference so restores stay portable.
    assert.ok(restored.manifest.some(row => row.source === 'placeholder' && row.query === '${item.photo}' && row.portable !== false), 'restored placeholders keep their exact query')
    assert.ok(restored.manifest.some(row => row.source === 'placeholder' && row.query === 'forbidden subject' && row.portable !== false))
    assert.ok(restored.manifest.some(row => row.portable === false && row.file === runtime.file), 'runtime placeholders restore and stay out of portable source')
    const unknown = await resolveImages([{ file_path: 'a.tsx', file_content: '<img src="/evo-images/item-photo-landscape-0123456789.svg" />' }])
    assert.deepEqual(unknown.manifest.map(row => [row.query, row.portable]), [['item photo#landscape', false]], 'a placeholder with no recorded reference is never guessed into a paid query')

    // A lost file (evicted or legacy) is re-resolved and its reference rewritten, never left broken.
    const legacy = await resolveImages([{ file_path: 'components/Card.tsx', file_content: '<img src="/evo-images/vintage-leather-armchair-1a2b3c4d.jpg" alt="Armchair" />' }])
    const card = legacy.files[0].file_content
    assert.doesNotMatch(card, /1a2b3c4d/)
    const [file] = extractLocalImages(card)
    assert.match(file, /^vintage-leather-armchair-[0-9a-f]{12}\.webp$/)
    assert.ok(legacy.binaries.some(bin => bin.file_path === `public/evo-images/${file}`))
    assert.match(calls[calls.length - 1].prompt, /vintage leather armchair/)
    console.log('images-check ai ok: model chain, content-policy fallback, cache hits, restore by hash, lost-file re-resolve, placeholders')
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.OPENAI_API_KEY
  }
}

function wikimediaFixture(title: string) {
  return { query: { pages: { 1: { title: `File:${title}.jpg`, imageinfo: [{
    url: `https://upload.wikimedia.org/wikipedia/commons/a/aa/${encodeURIComponent(title)}.jpg`, mime: 'image/jpeg', size: 4096, width: 1600, height: 1000,
    extmetadata: { ObjectName: { value: title }, LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: 'Ana' } },
  }] } } } }
}

function hangUntilAbort(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

/** OpenAI hangs, stock answers: the AI window ends, the breaker opens, stock fills every photo well inside the budget. */
async function checkAiHangFallsBackToStock() {
  const originalFetch = globalThis.fetch
  const jpeg = new Uint8Array(4096)
  jpeg.set([0xff, 0xd8, 0xff, 0xe0])
  const ai: string[] = []
  let stock = 0
  process.env.OPENAI_API_KEY = 'sk-fixture'
  resetProviderBreakers()
  try {
    globalThis.fetch = async (url, init) => {
      const href = String(url)
      if (href.startsWith('https://api.openai.com/')) {
        ai.push(JSON.parse(String(init?.body)).model)
        return hangUntilAbort(init?.signal)
      }
      if (href.includes('commons.wikimedia.org')) {
        stock++
        return Response.json(wikimediaFixture('Fishing boats in the harbor'))
      }
      if (href.startsWith('https://upload.wikimedia.org/')) return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } })
      return new Response('down', { status: 503 })
    }
    const queries = ['red', 'blue', 'green', 'white', 'wooden', 'old', 'small', 'large'].map(kind => `${kind} fishing boats in a quiet harbor`)
    const timing = { budgetMs: 1_500, aiTimeoutMs: 200, stockReserveMs: 400, minAiWindowMs: 60 }
    const started = Date.now()
    const result = await resolveImages([{ file_path: 'pages/index.tsx', file_content: queries.map(q => `<img src="evo-image://${q}" />`).join('') }], undefined, { timing })
    const took = Date.now() - started
    assert.ok(took < 1_000, `stock filled the photos in ${took}ms; the budget was not spent waiting on AI`)
    assert.deepEqual(ai, Array(5).fill('gpt-image-2.6-flare'), 'one wave of AI attempts; a timeout never falls through to the next model')
    assert.equal(providerAvailable(AI_PROVIDER), false, 'AI timeouts open the breaker')
    assert.ok(stock >= 1)
    assert.ok(result.manifest.every(row => row.source === 'wikimedia'), JSON.stringify(result.manifest.map(row => row.source)))
    console.log(`images-check ai hang ok: ${took}ms, ${ai.length} AI attempts, every photo from stock`)
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.OPENAI_API_KEY
    resetProviderBreakers()
  }
}

/** Stock photos cached while AI was down never pin a subject once AI is back; a refused subject reuses its stock photo. */
async function checkStockFallbackCache() {
  const originalFetch = globalThis.fetch
  const jpeg = new Uint8Array(4096)
  jpeg.set([0xff, 0xd8, 0xff, 0xe0])
  const webp = fakeWebp(4096)
  let aiUp = false
  let aiCalls = 0
  let searches = 0
  process.env.OPENAI_API_KEY = 'sk-fixture'
  resetProviderBreakers()
  try {
    globalThis.fetch = async (url, init) => {
      const href = String(url)
      if (href.startsWith('https://api.openai.com/')) {
        aiCalls++
        const prompt = String(JSON.parse(String(init?.body)).prompt)
        if (prompt.includes('vintage tattoo')) return Response.json({ error: { code: 'moderation_blocked', message: 'Rejected by the safety system.' } }, { status: 400 })
        return aiUp ? Response.json({ data: [{ b64_json: Buffer.from(webp).toString('base64') }] })
          : Response.json({ error: { type: 'server_error', message: 'overloaded' } }, { status: 503 })
      }
      if (href.includes('commons.wikimedia.org')) {
        searches++
        return Response.json(wikimediaFixture(href.includes('tattoo') ? 'Vintage tattoo flash sheet' : 'Mercedes-Maybach S-Class sedan'))
      }
      if (href.startsWith('https://upload.wikimedia.org/')) return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } })
      return new Response('down', { status: 503 })
    }
    const car = [{ file_path: 'components/Car.tsx', file_content: '<img src="evo-image://two-tone Mercedes-Maybach S-Class sedan at a glass villa at dusk" alt="Maybach" />' }]
    const site = { context: { title: 'Ghost and Grace Motors', description: 'Luxury showroom' } }
    const outage = await resolveImages(car, undefined, site)
    assert.equal(outage.manifest[0].source, 'wikimedia', 'AI outage: stock fills the photo')
    const stockKey = imageCacheKey('stock', 'two-tone mercedes-maybach s-class sedan at a glass villa at dusk')
    assert.equal((await readCachedImage(stockKey))?.meta.aiFallback, 'unavailable')

    // AI still down (breaker open): the cached stock photo is reused without a new search.
    for (let i = 0; i < 3; i++) recordProvider(AI_PROVIDER, false)
    const searched = searches
    const stillDown = await resolveImages(car, undefined, site)
    assert.equal(stillDown.manifest[0].source, 'wikimedia')
    assert.equal(searches, searched, 'cached stock photo reused while AI is unavailable')

    // AI back: the same site and another site both get AI photos; the outage pick does not pin the subject.
    resetProviderBreakers()
    aiUp = true
    aiCalls = 0
    const recovered = await resolveImages(car, undefined, site)
    assert.equal(recovered.manifest[0].source, 'ai')
    const otherSite = await resolveImages(car, undefined, { context: { title: 'Another Dealer', description: 'Different site' } })
    assert.equal(otherSite.manifest[0].source, 'ai')
    assert.equal(aiCalls, 2)

    // A refusal is a verdict on the subject: its stock photo is reused, AI is not asked again.
    const tattoo = [{ file_path: 'components/Art.tsx', file_content: '<img src="evo-image://vintage tattoo flash sheet on a parlour wall" alt="Flash" />' }]
    const refused = await resolveImages(tattoo, undefined, site)
    assert.equal(refused.manifest[0].source, 'wikimedia')
    const afterRefusal = aiCalls
    const reused = await resolveImages(tattoo, undefined, site)
    assert.equal(reused.manifest[0].source, 'wikimedia')
    assert.equal(aiCalls, afterRefusal, 'a refused subject reuses its stock photo without another AI call')
    console.log('images-check stock fallback cache ok: outage picks are retried with AI once it recovers, refusals stay stock')
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.OPENAI_API_KEY
    resetProviderBreakers()
  }
}

/** Paid images stop at the per-user and global hourly quotas; the rest use stock or placeholders. */
async function checkAiQuota() {
  const originalFetch = globalThis.fetch
  const webp = fakeWebp(4096)
  let aiCalls = 0
  process.env.OPENAI_API_KEY = 'sk-fixture'
  process.env.EVOSTACK_IMAGE_USER_HOURLY = '2'
  resetProviderBreakers()
  try {
    globalThis.fetch = async (url) => {
      if (String(url).startsWith('https://api.openai.com/')) {
        aiCalls++
        return Response.json({ data: [{ b64_json: Buffer.from(webp).toString('base64') }] })
      }
      return Response.json({ results: [] })
    }
    const page = (subjects: string[]) => [{ file_path: 'pages/index.tsx', file_content: subjects.map(q => `<img src="evo-image://${q}" />`).join('') }]
    const first = await resolveImages(page(['quota test lantern', 'quota test kettle', 'quota test teapot']), undefined, { userId: 'quota-user' })
    assert.equal(aiCalls, 2)
    assert.deepEqual(first.manifest.map(row => row.source).sort(), ['ai', 'ai', 'placeholder'])
    const again = await resolveImages(page(['quota test saucepan']), undefined, { userId: 'quota-user' })
    assert.equal(aiCalls, 2, 'the user is over the hourly quota')
    assert.equal(again.manifest[0].source, 'placeholder')
    await resolveImages(page(['quota test skillet']), undefined, { userId: 'another-user' })
    assert.equal(aiCalls, 3, 'quotas are per user')
    process.env.EVOSTACK_IMAGE_GLOBAL_HOURLY = '1'
    await resolveImages(page(['quota test colander']), undefined, { userId: 'third-user' })
    assert.equal(aiCalls, 3, 'the server-wide quota caps every user')
    console.log('images-check ai quota ok: per-user and global hourly ceilings fall back to stock/placeholders')
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.OPENAI_API_KEY
    delete process.env.EVOSTACK_IMAGE_USER_HOURLY
    delete process.env.EVOSTACK_IMAGE_GLOBAL_HOURLY
  }
}

/** Museum collections are searched for art and heritage subjects only. */
async function checkMuseumGate() {
  const originalFetch = globalThis.fetch
  const hosts: string[] = []
  resetProviderBreakers()
  try {
    globalThis.fetch = async (url) => {
      hosts.push(new URL(String(url)).host)
      return Response.json({ results: [] })
    }
    await resolveImages([{ file_path: 'a.tsx', file_content: '<img src="evo-image://silver Aston Martin DB12 on a coastal road at sunset" />' }], undefined, { mode: 'stock' })
    assert.ok(!hosts.some(host => /metmuseum|clevelandart/.test(host)), hosts.join(','))
    hosts.length = 0
    await resolveImages([{ file_path: 'b.tsx', file_content: '<img src="evo-image://antique blue and white porcelain vase on a plinth" />' }], undefined, { mode: 'stock' })
    assert.ok(hosts.some(host => host.includes('metmuseum')) && hosts.some(host => host.includes('clevelandart')), hosts.join(','))
    console.log('images-check museum gate ok')
  } finally {
    globalThis.fetch = originalFetch
  }
}
