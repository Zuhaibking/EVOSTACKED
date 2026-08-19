import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RunsService } from './runs.service'

describe('RunsService chat persist', () => {
  it('addMessage increments memory_version and stores the turn', async () => {
    const run = {
      id: 'run1',
      userId: 'userA',
      memoryVersion: 0,
      selectedCandidate: null,
      activeVersion: null,
      hasTournament: false,
      status: 'active',
    }
    const messages: any[] = []
    const prisma = {
      run: {
        findFirst: async ({ where }: any) =>
          where.id === run.id && where.userId === run.userId ? run : null,
        updateMany: async ({ where, data }: any) => {
          if (where.id !== run.id || where.userId !== run.userId) {
            return { count: 0 }
          }
          if (data.memoryVersion?.increment) {
            run.memoryVersion += data.memoryVersion.increment
          }
          return { count: 1 }
        },
      },
      message: {
        create: async ({ data }: any) => {
          const row = { id: 'm1', ...data }
          messages.push(row)
          return row
        },
        findMany: async () => messages,
      },
      memoryCache: { deleteMany: async () => ({ count: 0 }) },
      llmResponseCache: { deleteMany: async () => ({ count: 0 }) },
    } as any

    const memory = {
      bumpAndInvalidate: async (userId: string, runId: string) => {
        run.memoryVersion += 1
        return run.memoryVersion
      },
    } as any

    const svc = new RunsService(prisma, memory)
    await svc.addMessage('userA', 'run1', 'user', {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    })
    assert.equal(run.memoryVersion, 1)
    assert.equal(messages.length, 1)
    const listed = await svc.listMessages('userA', 'run1')
    assert.deepEqual(listed[0], {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    })
  })

  it('ensure creates a missing run for the JWT user only', async () => {
    const runs: any[] = []
    const prisma = {
      user: {
        upsert: async ({ where, create }: any) => ({ id: where.id, ...create }),
      },
      run: {
        findFirst: async ({ where }: any) =>
          runs.find((r) => r.id === where.id && r.userId === where.userId) ||
          null,
        create: async ({ data }: any) => {
          if (runs.some((r) => r.id === data.id && r.userId !== data.userId)) {
            throw new Error('unique')
          }
          const row = { ...data, memoryVersion: 0 }
          runs.push(row)
          return row
        },
      },
    } as any
    const svc = new RunsService(prisma, {} as any)
    const created = await svc.ensure('userA', 'a@x.com', 'run_local')
    assert.equal(created.id, 'run_local')
    assert.equal(created.userId, 'userA')
    const again = await svc.ensure('userA', 'a@x.com', 'run_local')
    assert.equal(again.id, 'run_local')
    assert.equal(runs.length, 1)
  })

  it('createCandidate writes a row for the run', async () => {
    const run = {
      id: 'run1',
      userId: 'userA',
      memoryVersion: 1,
      selectedCandidate: null,
      activeVersion: null,
      hasTournament: true,
      status: 'active',
    }
    const rows: any[] = []
    const prisma = {
      run: {
        findFirst: async ({ where }: any) =>
          where.id === run.id && where.userId === run.userId ? run : null,
      },
      candidate: {
        create: async ({ data }: any) => {
          const row = { id: 'cand_1', ...data }
          rows.push(row)
          return row
        },
        updateMany: async ({ where, data }: any) => {
          const row = rows.find((r) => r.id === where.id)
          if (!row) return { count: 0 }
          Object.assign(row, data)
          return { count: 1 }
        },
      },
    } as any
    const svc = new RunsService(prisma, {} as any)
    const created = await svc.createCandidate('userA', 'run1', 'minimal', 'tested', {
      variant: 'Product',
      scores: { composite: 0.8 },
      template: 'nextjs-developer',
      stackLabel: 'Next.js',
    })
    assert.equal(created.variantId, 'minimal')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].data.template, 'nextjs-developer')
    assert.equal(rows[0].data.stackLabel, 'Next.js')
    await svc.updateCandidate('userA', 'run1', 'cand_1', 'tested', {
      scores: { composite: 0.9 },
    })
    assert.equal(rows[0].status, 'tested')
    assert.equal(rows[0].data.scores.composite, 0.9)
  })

  it('getPublicShare returns run artifacts without requiring a user', async () => {
    const prisma = {
      run: {
        findFirst: async ({ where }: any) =>
          where.id === 'run_pub' ? { id: 'run_pub', userId: 'userA' } : null,
      },
      message: {
        findMany: async () => [
          {
            content: {
              role: 'user',
              content: [{ type: 'text', text: 'Build a CRM' }],
            },
          },
        ],
      },
      projectBrain: {
        findFirst: async () => ({ data: { plan: { productName: 'CRM' } } }),
      },
      candidate: {
        findMany: async () => [
          {
            variantId: 'minimal',
            status: 'tested',
            data: { variant: 'Product' },
          },
        ],
      },
    } as any
    const svc = new RunsService(prisma, {} as any)
    const missing = await svc.getPublicShare('nope')
    assert.equal(missing, null)
    const row = await svc.getPublicShare('run_pub')
    assert.ok(row)
    assert.equal(row!.candidates.length, 1)
    assert.equal((row!.brain as any).plan.productName, 'CRM')
  })
})
