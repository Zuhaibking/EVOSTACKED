import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  inspectGeneratedProjectDatabase,
  isSecretEnvName,
  resolveGeneratedDatabaseView,
} from './generated-project-database'

describe('inspectGeneratedProjectDatabase', () => {
  it('returns empty when the generated project has no database artifacts', () => {
    const result = inspectGeneratedProjectDatabase({
      file_path: 'app/page.tsx',
      code: 'export default function Page(){return <main>Hi</main>}',
    })
    assert.equal(result.configured, false)
    assert.equal(result.files.length, 0)
    assert.equal(result.models.length, 0)
    assert.equal(result.tables.length, 0)
  })

  it('detects prisma schema in generated files only', () => {
    const result = inspectGeneratedProjectDatabase({
      file_path: 'app/page.tsx',
      code: [
        {
          file_path: 'app/page.tsx',
          file_content: 'export default function Page(){return null}',
        },
        {
          file_path: 'prisma/schema.prisma',
          file_content: 'datasource db { provider = "postgresql" }\nmodel User {\n  id String @id\n}\nmodel Event {\n  id String @id\n}\n',
        },
      ],
    })
    assert.equal(result.configured, true)
    assert.equal(result.files.length, 1)
    assert.deepEqual(result.models, ['User', 'Event'])
    assert.equal(result.provider, 'postgresql')
    assert.equal(result.tables.length, 2)
    assert.deepEqual(result.tables[0].primaryKeys, ['id'])
  })

  it('detects DATABASE_URL usage in generated source', () => {
    const result = inspectGeneratedProjectDatabase({
      file_path: '.env.example',
      code: 'DATABASE_URL=postgresql://localhost/app',
    })
    assert.equal(result.configured, true)
    assert.equal(result.envVars.length, 1)
    assert.equal(result.envVars[0].name, 'DATABASE_URL')
    assert.equal(result.envVars[0].secret, true)
    assert.equal(result.envVars[0].configured, true)
    assert.ok(!JSON.stringify(result.envVars).includes('postgresql://'))
  })

  it('parses prisma columns, relations, and composite keys', () => {
    const result = inspectGeneratedProjectDatabase({
      file_path: 'prisma/schema.prisma',
      code: `
datasource db { provider = "postgresql" }
model User {
  id    String @id
  email String @unique
  posts Post[]
  @@map("users")
}
model Post {
  id     String @id
  userId String
  user   User   @relation(fields: [userId], references: [id])
}
`,
    })
    const user = result.tables.find((t) => t.name === 'User')
    const post = result.tables.find((t) => t.name === 'Post')
    assert.ok(user && post)
    assert.equal(user.mappedName, 'users')
    assert.equal(user.columns.find((c) => c.name === 'email')?.isUnique, true)
    assert.equal(user.relations[0]?.to, 'Post')
    assert.equal(user.relations[0]?.kind, 'many')
    assert.equal(post.relations.find((r) => r.field === 'user')?.to, 'User')
  })

  it('detects generated App Router endpoints without inventing others', () => {
    const result = inspectGeneratedProjectDatabase({
      file_path: 'app/api/items/route.ts',
      code: 'export async function GET(){return Response.json([])}\nexport async function POST(){return Response.json({})}',
    })
    assert.equal(result.endpoints.length, 2)
    assert.deepEqual(
      result.endpoints.map((e) => `${e.method} ${e.route}`).sort(),
      ['GET /api/items', 'POST /api/items'],
    )
  })

  it('reads JSON records from project files and redacts secret fields', () => {
    const result = inspectGeneratedProjectDatabase({
      file_path: 'data/users.json',
      code: JSON.stringify([
        { id: 'u1', email: 'ada@example.com', apiKey: 'sk-secret-value' },
      ]),
    })
    assert.equal(result.fileRecords.length, 1)
    assert.equal(result.fileRecords[0].records[0].email, 'ada@example.com')
    assert.equal(result.fileRecords[0].records[0].apiKey, 'configured')
    assert.ok(!JSON.stringify(result.fileRecords).includes('sk-secret-value'))
  })

  it('detects integrations only when they appear in generated files', () => {
    const empty = inspectGeneratedProjectDatabase({
      file_path: 'app/page.tsx',
      code: 'export default function Page(){return null}',
    })
    assert.equal(empty.integrations.length, 0)

    const hit = inspectGeneratedProjectDatabase({
      file_path: 'package.json',
      code: '{"dependencies":{"stripe":"16.0.0","@clerk/nextjs":"6.0.0"}}',
    })
    assert.ok(hit.integrations.some((i) => i.name === 'Stripe'))
    assert.ok(hit.integrations.some((i) => i.name === 'Clerk'))
  })
})

describe('resolveGeneratedDatabaseView', () => {
  it('shows no-project for an empty Untitled workspace', () => {
    const view = resolveGeneratedDatabaseView(undefined)
    assert.equal(view.status, 'no-project')
  })

  it('shows no-database when the generated project has no schema', () => {
    const view = resolveGeneratedDatabaseView({
      file_path: 'app/page.tsx',
      code: 'export default function Page(){return <main>Hi</main>}',
    })
    assert.equal(view.status, 'no-database')
  })

  it('shows generated schema only when the project has one', () => {
    const view = resolveGeneratedDatabaseView({
      file_path: 'prisma/schema.prisma',
      code: 'datasource db { provider = "postgresql" }\nmodel User {\n  id String @id\n}\n',
    })
    assert.equal(view.status, 'ready')
    if (view.status !== 'ready') return
    assert.deepEqual(view.inspection.models, ['User'])
    assert.equal(view.inspection.tables.length, 1)
  })
})

describe('isSecretEnvName', () => {
  it('flags credential names and leaves public names alone', () => {
    assert.equal(isSecretEnvName('DATABASE_URL'), true)
    assert.equal(isSecretEnvName('OPENAI_API_KEY'), true)
    assert.equal(isSecretEnvName('JWT_SECRET'), true)
    assert.equal(isSecretEnvName('NEXT_PUBLIC_API_URL'), false)
    assert.equal(isSecretEnvName('NEXT_PUBLIC_VERCEL_ENV'), false)
  })
})
