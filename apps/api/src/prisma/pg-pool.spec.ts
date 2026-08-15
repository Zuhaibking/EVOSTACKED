import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createPgPoolConfig } from './pg-pool'

describe('createPgPoolConfig', () => {
  it('throws when DATABASE_URL is missing', () => {
    assert.throws(() => createPgPoolConfig(undefined), /DATABASE_URL is required/)
  })

  it('uses the pg connection string as the runtime pool', () => {
    const config = createPgPoolConfig('postgresql://evostack:evostack@localhost:5432/evostack')
    assert.equal(
      config.connectionString,
      'postgresql://evostack:evostack@localhost:5432/evostack',
    )
    assert.equal(config.max, 10)
  })
})
