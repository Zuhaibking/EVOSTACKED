import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'
import {
  collectProjectFiles,
  downloadAccess,
  projectRelativePath,
  projectZipName,
  readProjectZip,
  type ListedEntry,
  type ProjectFs,
} from './project-archive'

const hero = 'export default function Hero(){return <h1>Cafe</h1>}\n'
const page = "import Hero from '../components/Hero'\nexport default function Page(){return <Hero/>}\n"
const manifest = JSON.stringify({
  name: 'cafe',
  dependencies: { next: '14.2.5', react: '18.3.1', 'framer-motion': '^11.0.0' },
}, null, 2)
const image = Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22])
const tree = new Map<string, Uint8Array | 'dir'>([
  ['/home/user/package.json', new TextEncoder().encode(manifest)],
  ['/home/user/package-lock.json', new TextEncoder().encode('{"lockfileVersion":3,"packages":{}}\n')],
  ['/home/user/next.config.js', new TextEncoder().encode('module.exports = { reactStrictMode: true }\n')],
  ['/home/user/tsconfig.json', new TextEncoder().encode('{"compilerOptions":{}}\n')],
  ['/home/user/components.json', new TextEncoder().encode('{}\n')],
  ['/home/user/pages/index.tsx', new TextEncoder().encode(page)],
  ['/home/user/components/Hero.tsx', new TextEncoder().encode(hero)],
  ['/home/user/components/ui/button.tsx', new TextEncoder().encode('export function Button(){return null}\n')],
  ['/home/user/public/evo-images/campus.jpg', image],
  ['/home/user/public/__evo_inspect.js', new TextEncoder().encode('inspect')],
  ['/home/user/plugins/evo-inspect.client.ts', new TextEncoder().encode('export default {}')],
  ['/home/user/.env.local', new TextEncoder().encode('SECRET=1')],
  ['/home/user/node_modules/react/index.js', new TextEncoder().encode('module.exports = {}')],
  ['/home/user/.next/server/pages/index.js', new TextEncoder().encode('compiled')],
  ['/etc/passwd', new TextEncoder().encode('root')],
])

function fixture(): ProjectFs & { reads: string[] } {
  const reads: string[] = []
  const list = async (dir: string): Promise<ListedEntry[]> => {
    const prefix = dir.replace(/\/$/, '')
    const children = new Map<string, ListedEntry>()
    for (const path of tree.keys()) {
      if (path === prefix || !path.startsWith(`${prefix}/`)) continue
      const rest = path.slice(prefix.length + 1)
      const name = rest.split('/')[0]
      const full = `${prefix}/${name}`
      const type = rest.includes('/') || tree.get(full) === 'dir' ? 'dir' : 'file'
      children.set(full, { name, path: full, type })
    }
    return [...children.values()]
  }
  return {
    reads,
    list,
    read: async (path) => {
      reads.push(path)
      const value = tree.get(path)
      if (!value || value === 'dir') throw new Error(`Missing ${path}`)
      return value
    },
  }
}

function unzipStore(zip: Uint8Array) {
  const buf = Buffer.from(zip)
  const out = new Map<string, Buffer>()
  let offset = 0
  while (offset + 30 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const flags = buf.readUInt16LE(offset + 6)
    const method = buf.readUInt16LE(offset + 8)
    const crc = buf.readUInt32LE(offset + 14)
    const size = buf.readUInt32LE(offset + 18)
    const nameLen = buf.readUInt16LE(offset + 26)
    const extraLen = buf.readUInt16LE(offset + 28)
    const start = offset + 30 + nameLen + extraLen
    const data = buf.subarray(start, start + size)
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8')
    assert.equal(method, 0, name)
    assert.equal(flags & 0x800, 0x800, name)
    assert.equal(crc32(data) >>> 0, crc, name)
    out.set(name, Buffer.from(data))
    offset = start + size
  }
  assert.equal(buf.readUInt32LE(offset), 0x02014b50)
  return out
}

async function check() {
  assert.equal(projectRelativePath('/home/user', '/home/user/node_modules/react/index.js'), null)
  assert.equal(projectRelativePath('/home/user', '/home/user/../../etc/passwd'), null)
  assert.equal(projectRelativePath('/home/user', '/etc/passwd'), null)
  assert.equal(projectRelativePath('/home/user', '/home/user/public/__evo_inspect.js'), null)
  assert.equal(projectZipName('Café Menu'), 'cafe-menu.zip')
  assert.equal(projectZipName(''), 'project.zip')

  assert.deepEqual(downloadAccess({ clerk: true, userId: '', metadata: { userID: 'owner' } }), { ok: false, status: 401, error: 'Sign in to download this project.' })
  assert.equal(downloadAccess({ clerk: true, userId: 'other', metadata: { userID: 'owner' } }).ok, false)
  assert.equal(downloadAccess({ clerk: true, userId: 'owner', metadata: { userID: 'owner', projectID: 'a' }, projectID: 'b' }).ok, false)
  assert.equal(downloadAccess({ clerk: true, userId: 'owner', metadata: { userID: 'owner', candidateID: 'minimal' }, candidateID: 'minimal' }).ok, true)
  assert.equal(downloadAccess({ clerk: false, userId: '', metadata: { userID: 'owner' } }).ok, true)

  const fs = fixture()
  const files = await collectProjectFiles(fs)
  const paths = files.map(file => file.path)
  for (const path of ['package.json', 'package-lock.json', 'next.config.js', 'tsconfig.json', 'components.json', 'pages/index.tsx', 'components/Hero.tsx', 'components/ui/button.tsx', 'public/evo-images/campus.jpg']) {
    assert.ok(paths.includes(path), path)
  }
  for (const path of ['node_modules/react/index.js', '.next/server/pages/index.js', 'public/__evo_inspect.js', 'plugins/evo-inspect.client.ts', '.env.local']) {
    assert.equal(paths.includes(path), false, path)
  }
  assert.ok(!fs.reads.some(path => path.includes('node_modules') || path.includes('/.next/') || path.endsWith('__evo_inspect.js')))
  assert.deepEqual(files.find(file => file.path === 'public/evo-images/campus.jpg')!.data, image)
  assert.match(new TextDecoder().decode(files.find(file => file.path === 'package.json')!.data), /framer-motion/)
  assert.equal(new TextDecoder().decode(files.find(file => file.path === 'components/Hero.tsx')!.data), hero)

  const zip = await readProjectZip(fs)
  const unpacked = unzipStore(zip)
  assert.equal(unpacked.get('components/Hero.tsx')!.toString('utf8'), hero)
  assert.deepEqual(unpacked.get('public/evo-images/campus.jpg'), Buffer.from(image))
  const dir = mkdtempSync(join(tmpdir(), 'evo-download-'))
  try {
    const zipPath = join(dir, 'cafe.zip')
    writeFileSync(zipPath, zip)
    const listed = execFileSync('tar', ['-tf', zipPath], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000, windowsHide: true }).toString().trim().split(/\r?\n/)
    assert.deepEqual(listed.sort(), paths.slice().sort())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  await assert.rejects(collectProjectFiles({
    list: async () => [{ name: 'pages', path: '/home/user/pages', type: 'dir' }, { name: 'index.tsx', path: '/home/user/pages/index.tsx', type: 'file' }],
    read: async () => 'export default function Page(){return null}',
  }), /missing package\.json/)

  const route = readFileSync(join(process.cwd(), 'app/api/download/route.ts'), 'utf8')
  assert.match(route, /readProjectZip/)
  assert.match(route, /downloadAccess/)
  assert.match(route, /files\.list/)
  assert.match(route, /files\.read/)
  assert.doesNotMatch(route, /tournament|toPrompt|healCandidate|streamObject|generateObject/)
  const preview = readFileSync(join(process.cwd(), 'components/preview.tsx'), 'utf8')
  assert.match(preview, /Download Project/)
  assert.match(preview, /\/api\/download/)
  console.log('project-archive-check ok: zip includes source, components, assets, config, and package.json; skips installs, preview helpers, and other accounts')
}

check().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exit(1)
})
