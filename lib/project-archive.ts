/** Zip the sandbox project tree. STORE only: no compression, 4,000 files / 40MB. Upgrade path is deflate once a real project exceeds that. */

import { crc32 } from 'node:zlib'

export type ListedEntry = { name: string; path?: string; type?: string }
export type ProjectFs = {
  list: (path: string) => Promise<ListedEntry[]>
  read: (path: string) => Promise<Uint8Array | string>
}
export type ArchiveFile = { path: string; data: Uint8Array }

const SKIP_DIR = new Set(['node_modules', '.next', '.git', '__pycache__', '.venv', 'venv', 'dist', '.turbo', '.cache', 'coverage', '.vercel', '.output', '.nuxt'])
const SKIP_FILE = /^(?:public\/__evo_inspect\.js|plugins\/evo-inspect\.client\.ts|\.env(?:\.|$))/

export function projectRelativePath(root: string, entryPath: string): string | null {
  const norm = (value: string) => value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
  const base = norm(root)
  let path = norm(entryPath)
  if (base && base !== '.' && (path === base || path.startsWith(`${base}/`))) path = path.slice(base.length + 1)
  else if (path.startsWith('./')) path = path.slice(2)
  if (!path || path === '.' || path.startsWith('/')) return null
  const parts = path.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.') || SKIP_DIR.has(part))) return null
  if (SKIP_FILE.test(path)) return null
  return path
}

export function projectZipName(title?: string): string {
  const slug = (title || 'project').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return `${slug || 'project'}.zip`
}

export function downloadAccess(opts: {
  clerk: boolean
  userId: string
  metadata: Record<string, string>
  projectID?: string
  candidateID?: string
}): { ok: true } | { ok: false; status: number; error: string } {
  if (opts.clerk && !opts.userId) return { ok: false, status: 401, error: 'Sign in to download this project.' }
  if (opts.clerk && opts.metadata.userID !== opts.userId) return { ok: false, status: 403, error: 'This preview belongs to another account.' }
  if (opts.projectID && opts.metadata.projectID && opts.metadata.projectID !== opts.projectID) return { ok: false, status: 403, error: 'This preview belongs to another workspace.' }
  if (opts.candidateID && opts.metadata.candidateID && opts.metadata.candidateID !== opts.candidateID) return { ok: false, status: 403, error: 'This preview belongs to another workspace.' }
  return { ok: true }
}

function joinPath(dir: string, name: string) {
  if (!dir || dir === '.') return name
  return `${dir.replace(/\/$/, '')}/${name}`
}

function entryKind(entry: ListedEntry): 'dir' | 'link' | 'file' {
  const type = String(entry.type || '').toLowerCase()
  if (type === 'dir' || type === 'directory') return 'dir'
  if (type === 'symlink' || type === 'link') return 'link'
  return 'file'
}

export async function collectProjectFiles(fs: ProjectFs, root = '/home/user'): Promise<ArchiveFile[]> {
  const selected: { path: string; full: string }[] = []
  const dirs = [root]
  const seen = new Set<string>()
  let spins = 0
  while (dirs.length) {
    // ponytail: a directory that lists itself only requeues once; 8k stops a cycle that the seen set missed
    if (++spins > 8000 || seen.size > 4000) throw new Error('This project has too many files to download.')
    const dir = dirs.pop()!
    if (!seen.add(dir)) continue
    let entries: ListedEntry[]
    try {
      entries = await fs.list(dir)
    } catch (error) {
      if (dir === root) throw error
      continue
    }
    for (const entry of entries) {
      const full = entry.path || joinPath(dir, entry.name)
      const rel = projectRelativePath(root, full)
      if (!rel) continue
      const kind = entryKind(entry)
      if (kind === 'dir') {
        if (!seen.has(full)) dirs.push(full)
      } else if (kind === 'file') selected.push({ path: rel, full })
    }
  }
  if (selected.length > 4000) throw new Error('This project has too many files to download.')
  selected.sort((a, b) => a.path.localeCompare(b.path))
  const unique = selected.filter((file, index) => index === 0 || file.path !== selected[index - 1].path)
  const out: ArchiveFile[] = []
  let cursor = 0
  let total = 0
  async function worker() {
    while (cursor < unique.length) {
      const item = unique[cursor++]
      const raw = await fs.read(item.full)
      const data = typeof raw === 'string' ? new TextEncoder().encode(raw) : new Uint8Array(raw)
      if (data.byteLength > 12 * 1024 * 1024) throw new Error(`Cannot download ${item.path}: the file is too large.`)
      total += data.byteLength
      if (total > 40 * 1024 * 1024) throw new Error('This project is too large to download.')
      out.push({ path: item.path, data })
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, unique.length) }, () => worker()))
  out.sort((a, b) => a.path.localeCompare(b.path))
  if (!out.length) throw new Error('This preview has no project files to download.')
  const nodeApp = out.some(file => file.path.startsWith('pages/') || file.path.startsWith('components/') || file.path.endsWith('.vue'))
  if (nodeApp && !out.some(file => file.path === 'package.json')) throw new Error('This preview is missing package.json, so the download would not run.')
  return out
}

export function zipStore(files: ArchiveFile[]): Uint8Array {
  const now = new Date()
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const parts: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.path, 'utf8')
    if (name.length > 65535) throw new Error(`Cannot download ${file.path}: the path is too long.`)
    const data = Buffer.from(file.data)
    const crc = crc32(data) >>> 0
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    parts.push(local, data)
    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)
    offset += local.length + data.length
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  parts.push(...centrals, end)
  const zip = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let cursor = 0
  for (const part of parts) {
    zip.set(part, cursor)
    cursor += part.length
  }
  return zip
}

export async function readProjectZip(fs: ProjectFs, root = '/home/user'): Promise<Uint8Array> {
  return zipStore(await collectProjectFiles(fs, root))
}
