import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryService, memoryCacheKey } from './memory.service'

function makePrisma(store: {
  run?: { id: string; userId: string; memoryVersion: number }
  messages?: any[]
  memoryItems?: any[]
  brain?: any
  memoryCaches?: any[]
  llmCaches?: any[]
}) {
  const memoryCaches = store.memoryCaches || []
  const llmCaches = store.llmCaches || []
  return {
    run: {
      findFirst: async ({ where }: any) => {
        if (!store.run) return null
        if (where.id !== store.run.id || where.userId !== store.run.userId) {
          return null
        }
        return store.run
      },
      updateMany: async ({ where, data }: any) => {
        if (!store.run || store.run.id !== where.id || store.run.userId !== where.userId) {
          return { count: 0 }
        }
        store.run.memoryVersion += data.memoryVersion.increment
        return { count: 1 }
      },
    },
    message: {
      findMany: async ({ where }: any) => {
        if (where.userId !== store.run?.userId) return []
        return (store.messages || []).slice().reverse()
      },
    },
    memoryItem: {
      findMany: async ({ where }: any) => {
        if (where.userId !== store.run?.userId) return []
        return (store.memoryItems || [])
          .slice()
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      },
    },
    projectBrain: {
      findFirst: async ({ where }: any) => {
        if (where.userId !== store.run?.userId) return null
        return store.brain || null
      },
    },
    memoryCache: {
      findFirst: async ({ where }: any) => {
        return (
          memoryCaches.find(
            (c) =>
              c.userId === where.userId &&
              c.runId === where.runId &&
              c.memoryVersion === where.memoryVersion,
          ) || null
        )
      },
      create: async ({ data }: any) => {
        memoryCaches.push(data)
        return data
      },
      deleteMany: async ({ where }: any) => {
        const next = memoryCaches.filter(
          (c) => !(c.userId === where.userId && c.runId === where.runId),
        )
        memoryCaches.length = 0
        memoryCaches.push(...next)
        return { count: 1 }
      },
    },
    llmResponseCache: {
      findFirst: async ({ where }: any) => {
        return (
          llmCaches.find(
            (c) =>
              c.userId === where.userId &&
              c.runId === where.runId &&
              c.memoryVersion === where.memoryVersion &&
              c.cacheKey === where.cacheKey,
          ) || null
        )
      },
      create: async ({ data }: any) => {
        llmCaches.push(data)
        return data
      },
      deleteMany: async ({ where }: any) => {
        const next = llmCaches.filter(
          (c) => !(c.userId === where.userId && c.runId === where.runId),
        )
        llmCaches.length = 0
        llmCaches.push(...next)
        return { count: 1 }
      },
    },
  } as any
}

describe('MemoryService', () => {
  it('rebuilds from newest memory_items by time, never nearest-neighbor', async () => {
    const store = {
      run: { id: 'run1', userId: 'userA', memoryVersion: 2 },
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: { text: 'hi' },
          createdAt: new Date('2026-01-01'),
        },
      ],
      memoryItems: [
        {
          id: 'old',
          kind: 'fact',
          text: 'older',
          sourceMessageId: null,
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'new',
          kind: 'fact',
          text: 'newest',
          sourceMessageId: null,
          createdAt: new Date('2026-01-02'),
        },
      ],
    }
    const svc = new MemoryService(makePrisma(store))
    const pack = await svc.getLatest('userA', 'run1')
    assert.equal(pack.memoryVersion, 2)
    assert.equal(pack.memoryItems[0].id, 'new')
    assert.equal(pack.memoryItems[1].id, 'old')
  })

  it('L1 miss then L2 hit returns the cached pack', async () => {
    const pack = {
      memoryVersion: 3,
      runId: 'run1',
      userId: 'userA',
      recentMessages: [],
      memoryItems: [],
    }
    const store = {
      run: { id: 'run1', userId: 'userA', memoryVersion: 3 },
      memoryCaches: [
        {
          userId: 'userA',
          runId: 'run1',
          memoryVersion: 3,
          payload: pack,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
    }
    const svc = new MemoryService(makePrisma(store))
    const got = await svc.getLatest('userA', 'run1')
    assert.equal(got.memoryVersion, 3)
    assert.ok(svc.peekL1(memoryCacheKey('userA', 'run1', 3)))
  })

  it('stale memory_version is a miss', async () => {
    const store = {
      run: { id: 'run1', userId: 'userA', memoryVersion: 5 },
      memoryCaches: [
        {
          userId: 'userA',
          runId: 'run1',
          memoryVersion: 4,
          payload: {
            memoryVersion: 4,
            runId: 'run1',
            userId: 'userA',
            recentMessages: [],
            memoryItems: [],
          },
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
      messages: [],
      memoryItems: [],
    }
    const svc = new MemoryService(makePrisma(store))
    svc.seedL1(memoryCacheKey('userA', 'run1', 4), {
      memoryVersion: 4,
      runId: 'run1',
      userId: 'userA',
      recentMessages: [],
      memoryItems: [],
    })
    const got = await svc.getLatest('userA', 'run1')
    assert.equal(got.memoryVersion, 5)
  })

  it('user A cannot read user B run', async () => {
    const store = {
      run: { id: 'run1', userId: 'userA', memoryVersion: 1 },
    }
    const svc = new MemoryService(makePrisma(store))
    await assert.rejects(() => svc.getLatest('userB', 'run1'), /Run not found/)
  })

  it('bump increments version and drops L1', async () => {
    const store = {
      run: { id: 'run1', userId: 'userA', memoryVersion: 1 },
    }
    const svc = new MemoryService(makePrisma(store))
    svc.seedL1(memoryCacheKey('userA', 'run1', 1), {
      memoryVersion: 1,
      runId: 'run1',
      userId: 'userA',
      recentMessages: [],
      memoryItems: [],
    })
    const next = await svc.bumpAndInvalidate('userA', 'run1')
    assert.equal(next, 2)
    assert.equal(svc.peekL1(memoryCacheKey('userA', 'run1', 1)), undefined)
  })

  it('stores and reads LLM response cache for the current memory version', async () => {
    const store = {
      run: { id: 'run1', userId: 'userA', memoryVersion: 3 },
      llmCaches: [] as any[],
    }
    const svc = new MemoryService(makePrisma(store))
    await svc.setLlmCached({
      userId: 'userA',
      runId: 'run1',
      memoryVersion: 3,
      model: 'nvidia:test',
      promptHash: 'abc123',
      payload: { productName: 'Cached Plan' },
    })
    const hit = await svc.getLlmCached({
      userId: 'userA',
      runId: 'run1',
      memoryVersion: 3,
      model: 'nvidia:test',
      promptHash: 'abc123',
    })
    assert.deepEqual(hit, { productName: 'Cached Plan' })
    const miss = await svc.getLlmCached({
      userId: 'userA',
      runId: 'run1',
      memoryVersion: 4,
      model: 'nvidia:test',
      promptHash: 'abc123',
    })
    assert.equal(miss, null)
  })
})
