import assert from 'node:assert/strict'
import {
  createImageUrlValidator,
  looksLikeImageBytes,
  placeholderDataUri,
  replaceBrokenRemoteImages,
} from './images-validate'

const good = 'https://images.pexels.com/photos/ok/iphone.jpeg'
const bad = 'https://images.pexels.com/photos/dead/missing.jpeg'

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const html = new TextEncoder().encode('<!doctype html><html>')
assert.equal(looksLikeImageBytes(jpeg), true)
assert.equal(looksLikeImageBytes(html), false)

async function main() {
  const seen: string[] = []
  const validator = createImageUrlValidator({
    probe: async (url) => {
      seen.push(url)
      return url === good
    },
  })

  assert.equal(await validator.validate(good), true)
  assert.equal(await validator.validate(bad), false)
  assert.equal(await validator.validate(good), true)
  assert.equal(seen.filter((u) => u === good).length, 1)

  let concurrent = 0
  const slow = createImageUrlValidator({
    probe: async (url) => {
      concurrent += 1
      await new Promise((r) => setTimeout(r, 25))
      return url === good
    },
  })
  const [a, b] = await Promise.all([slow.validate(good), slow.validate(good)])
  assert.equal(a, true)
  assert.equal(b, true)
  assert.equal(concurrent, 1)

  const leftover = await replaceBrokenRemoteImages(
    `<img src="${bad}" /><img src="${good}" />`,
    createImageUrlValidator({ probe: async (url) => url === good }),
  )
  assert.ok(leftover.text.includes(placeholderDataUri()))
  assert.ok(leftover.text.includes(good))
  assert.ok(!leftover.text.includes(bad))
  assert.deepEqual(leftover.removed, [bad])

  const nokey = createImageUrlValidator({
    probe: async () => false,
  })
  const fallback = await replaceBrokenRemoteImages(
    `<img src="${bad}" />`,
    nokey,
  )
  assert.ok(fallback.text.includes(placeholderDataUri()))
  assert.ok(!fallback.text.includes(bad))

  console.log('images-validate-check ok')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
