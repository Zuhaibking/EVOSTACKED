import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildProjectZip, crc32, zipFilename } from './project-zip'

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0
}

describe('buildProjectZip', () => {
  it('writes a valid empty archive', () => {
    const zip = buildProjectZip([])
    assert.equal(readU32(zip, zip.length - 22), 0x06054b50)
  })

  it('stores file names and contents without inventing extra files', () => {
    const zip = buildProjectZip([
      { path: 'app/page.tsx', content: 'export default function Page(){return null}' },
      { path: 'lib/db.ts', content: 'export const db = {}' },
    ])
    const text = new TextDecoder().decode(zip)
    assert.equal(text.includes('app/page.tsx'), true)
    assert.equal(text.includes('lib/db.ts'), true)
    assert.equal(text.includes('export const db = {}'), true)
    assert.equal(text.includes('prisma/schema.prisma'), false)
    assert.equal(readU32(zip, 0), 0x04034b50)
  })

  it('skips duplicate and empty paths', () => {
    const zip = buildProjectZip([
      { path: 'a.ts', content: 'one' },
      { path: 'a.ts', content: 'two' },
      { path: '', content: 'nope' },
    ])
    const text = new TextDecoder().decode(zip)
    assert.equal(text.includes('one'), true)
    assert.equal(text.includes('two'), false)
  })

  it('matches crc32 of stored bytes', () => {
    const content = 'hello zip'
    const bytes = new TextEncoder().encode(content)
    const zip = buildProjectZip([{ path: 'hello.txt', content }])
    const nameLen = 'hello.txt'.length
    const crcOffset = 14
    const stored = readU32(zip, crcOffset)
    assert.equal(stored, crc32(bytes))
    assert.equal(zip[30 + nameLen], bytes[0])
  })
})

describe('zipFilename', () => {
  it('slugifies the project name', () => {
    assert.equal(zipFilename('NEXUS PASS'), 'nexus-pass.zip')
  })
})
