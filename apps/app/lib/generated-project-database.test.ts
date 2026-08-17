import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { inspectGeneratedProjectDatabase } from './generated-project-database'

describe('inspectGeneratedProjectDatabase', () => {
  it('returns empty when the generated project has no database artifacts', () => {
    const result = inspectGeneratedProjectDatabase({
      file_path: 'app/page.tsx',
      code: 'export default function Page(){return <main>Hi</main>}',
    })
    assert.equal(result.configured, false)
    assert.equal(result.files.length, 0)
    assert.equal(result.models.length, 0)
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
  })

  it('detects DATABASE_URL usage in generated source', () => {
    const result = inspectGeneratedProjectDatabase({
      file_path: '.env.example',
      code: 'DATABASE_URL=postgresql://localhost/app',
    })
    assert.equal(result.configured, true)
  })
})
