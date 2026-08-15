import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from 'dotenv'

const name = (process.argv[2] || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_]+/g, '_')
  .replace(/^_+|_+$/g, '')

if (!name) {
  console.error('Usage: pnpm prisma:migrate:new <name>')
  process.exit(1)
}

const apiRoot = resolve(import.meta.dirname, '..')
config({ path: resolve(apiRoot, '.env') })

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to author a migration against the live database.')
  process.exit(1)
}

const require = createRequire(import.meta.url)
const prismaCli = require.resolve('prisma/build/index.js')

function runPrisma(args) {
  return spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: apiRoot,
    encoding: 'utf8',
    env: process.env,
  })
}

const status = runPrisma(['migrate', 'status'])
if (status.status !== 0) {
  process.stderr.write(status.stderr || status.stdout || 'prisma migrate status failed\n')
  console.error('Apply pending migrations with `pnpm db:migrate` before authoring a new one.')
  process.exit(status.status || 1)
}

const result = runPrisma([
  'migrate',
  'diff',
  '--from-schema-datasource',
  'prisma/schema.prisma',
  '--to-schema-datamodel',
  'prisma/schema.prisma',
  '--script',
])

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'prisma migrate diff failed\n')
  process.exit(result.status || 1)
}

const sql = (result.stdout || '').trim()
const empty =
  !sql ||
  /^-- This is an empty migration\.?$/i.test(sql) ||
  !/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i.test(sql)

if (empty) {
  console.log('Schema already matches the applied migrations. No new migration.')
  process.exit(0)
}

const stamp = new Date()
  .toISOString()
  .replace(/[-:TZ.]/g, '')
  .slice(0, 14)
const folder = `${stamp}_${name}`
const dir = resolve(apiRoot, 'prisma/migrations', folder)
if (existsSync(dir)) {
  console.error(`Migration folder already exists: ${folder}`)
  process.exit(1)
}
mkdirSync(dir, { recursive: true })
writeFileSync(resolve(dir, 'migration.sql'), `${sql}\n`)
console.log(`Wrote prisma/migrations/${folder}/migration.sql`)
console.log('Apply it locally and in production with: pnpm db:migrate')
