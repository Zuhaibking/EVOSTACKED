import assert from 'node:assert/strict'
import { config } from 'dotenv'
import { Sandbox } from '@e2b/code-interpreter'
import { searchOpenverse } from './images-openverse'
import { searchWikimedia } from './images-wikimedia'
import {
  downloadImage,
  resolveImages,
  sniffImage,
  validateImageBytes,
} from './images'
import { IMAGE_DIR } from './images-shared'

config({ path: '.env.local' })

async function main() {
  console.log('[e2e] search openverse')
  const ov = await searchOpenverse('Samsung Galaxy phone')
  assert.ok(ov.length > 0, 'openverse returned no results')
  assert.ok(ov[0].url.startsWith('https://'), 'openverse url not https')
  console.log(`[e2e] openverse hits=${ov.length} title=${ov[0].title}`)

  console.log('[e2e] search wikimedia')
  const wiki = await searchWikimedia('Goa beach')
  assert.ok(wiki.length > 0, 'wikimedia returned no results')
  assert.ok(wiki[0].url.startsWith('https://'), 'wikimedia url not https')
  console.log(`[e2e] wikimedia hits=${wiki.length} title=${wiki[0].title}`)

  console.log('[e2e] download validation')
  const got = await downloadImage(ov[0].url)
  assert.ok(got, 'download failed')
  assert.ok(got.bytes.byteLength > 2048, 'download too small')
  assert.ok(validateImageBytes(got.bytes, got.mime), 'bytes failed validation')
  console.log(`[e2e] downloaded ${got.bytes.byteLength} bytes ${got.mime}`)

  const code = `export default function Page() {
  return (
    <main>
      <img src="evo-image://Samsung Galaxy S25 product photograph" alt="Samsung Galaxy S25" />
      <img src="evo-image://Goa beach sunset" alt="Goa beach" />
      <div style={{ backgroundImage: 'url("evo-image://modern architecture building facade")' }} />
    </main>
  )
}
`

  console.log('[e2e] resolveImages')
  const resolved = await resolveImages([
    { file_path: 'pages/index.tsx', file_content: code },
  ])
  const page = resolved.files.find((f) => f.file_path === 'pages/index.tsx')
  assert.ok(page)
  assert.doesNotMatch(page.file_content, /evo-image:/)
  assert.match(page.file_content, /\/evo-images\//)
  assert.equal(resolved.assets.length, 3, 'expected 3 real images')
  assert.equal(resolved.binaries.length, 3)
  for (const asset of resolved.assets) {
    const kind = sniffImage(asset.bytes)
    assert.ok(kind, `${asset.file} is not image bytes`)
    assert.ok(asset.bytes.byteLength > 2048, `${asset.file} too small`)
    assert.match(asset.path, new RegExp(`^${IMAGE_DIR}/[a-z0-9.-]+$`))
    console.log(
      `[e2e] asset ${asset.file} ${kind.mime} ${asset.bytes.byteLength} license=${asset.license || 'n/a'}`,
    )
  }
  const manifest = resolved.files.find(
    (f) => f.file_path === `${IMAGE_DIR}/manifest.json`,
  )
  assert.ok(manifest)
  const entries = JSON.parse(manifest.file_content)
  assert.equal(entries.length, 3)
  assert.ok(entries.every((e: { source?: string }) => e.source))

  console.log('[e2e] sandbox write')
  const sbx = await Sandbox.create('nextjs-developer', { timeoutMs: 5 * 60 * 1000 })
  try {
    await sbx.files.write('pages/index.tsx', page.file_content)
    if (manifest) {
      await sbx.files.write(manifest.file_path, manifest.file_content)
    }
    for (const bin of resolved.binaries) {
      await sbx.files.write(bin.file_path, bin.data)
    }
    const listed = await sbx.files.list(IMAGE_DIR)
    const names = listed.map((e) => e.name)
    console.log(`[e2e] sandbox ${IMAGE_DIR}: ${names.join(', ')}`)
    for (const asset of resolved.assets) {
      const remote = await sbx.files.read(asset.path, { format: 'bytes' })
      const kind = sniffImage(remote)
      assert.ok(kind, `${asset.path} in sandbox is not image bytes`)
      assert.ok(remote.byteLength > 2048, `${asset.path} in sandbox too small`)
      const head = new TextDecoder().decode(remote.subarray(0, 20)).toLowerCase()
      assert.ok(!head.includes('<!doctype') && !head.includes('<html'))
    }
    const remotePage = await sbx.files.read('pages/index.tsx')
    assert.doesNotMatch(String(remotePage), /evo-image:/)
    assert.match(String(remotePage), /\/evo-images\//)
    console.log('images-e2e ok')
  } finally {
    await sbx.kill()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err)
  process.exit(1)
})
