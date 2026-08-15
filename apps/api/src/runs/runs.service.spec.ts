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
})
