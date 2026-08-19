import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseApiJsonText } from './api/client'
import {
  DATABASE_SECTIONS,
  EVOSTACK_PLATFORM_ENDPOINTS,
  EVOSTACK_PLATFORM_TABLES,
  deriveWorkflowSteps,
  filterRecords,
  humanizeRequestLog,
  inspectSafeClientEnv,
  messageToRecord,
  sortRecords,
  workflowInputFromWorkspace,
} from './database-control-center'

describe('database control center catalogs', () => {
  it('keeps the Database tab section list stable', () => {
    assert.deepEqual([...DATABASE_SECTIONS], [
      'overview',
      'tables',
      'data',
      'users',
      'analytics',
      'api',
      'integrations',
      'environment',
      'logs',
      'workflows',
      'security',
      'settings',
    ])
  })

  it('only lists real EvoStack tables and endpoints', () => {
    assert.ok(EVOSTACK_PLATFORM_TABLES.some((t) => t.id === 'runs'))
    assert.ok(EVOSTACK_PLATFORM_TABLES.some((t) => t.id === 'request_logs'))
    assert.ok(
      EVOSTACK_PLATFORM_ENDPOINTS.some(
        (e) => e.method === 'GET' && e.route === '/v1/logs',
      ),
    )
    assert.ok(
      EVOSTACK_PLATFORM_ENDPOINTS.some(
        (e) => e.method === 'GET' && e.route === '/v1/public/runs/:id',
      ),
    )
    assert.ok(
      EVOSTACK_PLATFORM_ENDPOINTS.every((e) => e.route.startsWith('/')),
    )
  })
})

describe('humanizeRequestLog', () => {
  it('turns status codes into readable levels and messages', () => {
    const error = humanizeRequestLog({
      id: '1',
      method: 'POST',
      path: '/v1/chat?x=1',
      status: 500,
      durationMs: 42,
      createdAt: '2026-08-19T00:00:00.000Z',
    })
    assert.equal(error.level, 'error')
    assert.equal(error.source, 'chat')
    assert.match(error.message, /POST \/v1\/chat failed/)
    assert.ok(!error.message.includes('x=1'))

    const ok = humanizeRequestLog({
      method: 'GET',
      path: '/v1/runs/run_1',
      status: 200,
      durationMs: 8,
    })
    assert.equal(ok.level, 'info')
    assert.equal(ok.source, 'runs')
  })
})

describe('deriveWorkflowSteps', () => {
  it('never marks later steps done without observed data', () => {
    const steps = deriveWorkflowSteps({
      hasUserPrompt: true,
      hasGeneratedFiles: true,
    })
    assert.equal(steps.find((s) => s.id === 'prompt')?.status, 'done')
    assert.equal(steps.find((s) => s.id === 'generate')?.status, 'done')
    assert.equal(steps.find((s) => s.id === 'plan')?.status, 'pending')
    assert.equal(steps.find((s) => s.id === 'publish')?.status, 'unavailable')
  })

  it('reads only real fragment/run signals', () => {
    const steps = workflowInputFromWorkspace({
      fragment: {
        title: 'Notes',
        architecture: 'Local-only notes app',
        file_path: 'app/page.tsx',
        code: 'export default function Page(){return null}',
      },
      messages: [{ role: 'user', content: 'Build notes' }],
      result: { sbxId: 'sbx_1', template: 'nextjs-developer', url: 'https://preview.example' },
    })
    assert.equal(steps.find((s) => s.id === 'prompt')?.status, 'done')
    assert.equal(steps.find((s) => s.id === 'plan')?.status, 'done')
    assert.equal(steps.find((s) => s.id === 'generate')?.status, 'done')
    assert.equal(steps.find((s) => s.id === 'build')?.status, 'done')
    assert.equal(steps.find((s) => s.id === 'preview')?.status, 'done')
    assert.equal(steps.find((s) => s.id === 'publish')?.status, 'unavailable')
  })
})

describe('parseApiJsonText', () => {
  it('treats an empty brain body as null instead of throwing', () => {
    assert.equal(parseApiJsonText(''), null)
    assert.equal(parseApiJsonText('   '), null)
    assert.equal(parseApiJsonText('null'), null)
  })

  it('parses real JSON and rejects invalid payloads', () => {
    assert.deepEqual(parseApiJsonText('{"updatedAt":"2026-01-01"}'), {
      updatedAt: '2026-01-01',
    })
    assert.throws(() => parseApiJsonText('{'), /not valid JSON/)
  })
})

describe('record helpers', () => {
  it('filters and sorts without inventing rows', () => {
    const rows = [
      { name: 'Zed', count: 2 },
      { name: 'Ada', count: 10 },
    ]
    assert.deepEqual(
      sortRecords(rows, 'name', 'asc').map((r) => r.name),
      ['Ada', 'Zed'],
    )
    assert.equal(filterRecords(rows, 'ada').length, 1)
    assert.equal(filterRecords(rows, 'missing').length, 0)
  })

  it('flattens message content for the data grid', () => {
    const row = messageToRecord(
      { role: 'user', content: [{ type: 'text', text: 'Hello arena' }] },
      0,
    )
    assert.equal(row.role, 'user')
    assert.equal(row.preview, 'Hello arena')
  })

  it('reports public env names without values', () => {
    const vars = inspectSafeClientEnv({
      NEXT_PUBLIC_API_URL: 'http://localhost:3333',
      NEXT_PUBLIC_ENABLE_POSTHOG: '',
    })
    const api = vars.find((v) => v.name === 'NEXT_PUBLIC_API_URL')
    assert.equal(api?.configured, true)
    assert.ok(!JSON.stringify(vars).includes('localhost:3333'))
  })
})
