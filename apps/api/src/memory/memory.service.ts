import { Injectable, NotFoundException } from '@nestjs/common'
import type { MemoryPack } from '@evostack/shared'
import { PrismaService } from '../prisma/prisma.service'

const L1_TTL_MS = 90_000
const L2_TTL_MS = 6 * 60 * 60 * 1000
const L1_MAX_ENTRIES = 200
const RECENT_MESSAGE_LIMIT = 40
const MEMORY_ITEM_LIMIT = 40

type L1Entry = { pack: MemoryPack; expiresAt: number }

export function memoryCacheKey(
  userId: string,
  runId: string,
  memoryVersion: number,
): string {
  return `mem:${userId}:${runId}:${memoryVersion}`
}

export function llmCacheKey(parts: {
  userId: string
  runId: string
  memoryVersion: number
  model: string
  promptHash: string
}): string {
  return `llm:${parts.userId}:${parts.runId}:${parts.memoryVersion}:${parts.model}:${parts.promptHash}`
}

@Injectable()
export class MemoryService {
  private readonly l1 = new Map<string, L1Entry>()

  constructor(private readonly prisma: PrismaService) {}

  async getLatest(userId: string, runId: string): Promise<MemoryPack> {
    const run = await this.prisma.run.findFirst({
      where: { id: runId, userId },
    })
    if (!run) {
      throw new NotFoundException('Run not found')
    }

    const version = run.memoryVersion
    const key = memoryCacheKey(userId, runId, version)

    const l1hit = this.l1.get(key)
    if (
      l1hit &&
      l1hit.expiresAt > Date.now() &&
      l1hit.pack.memoryVersion === version
    ) {
      return l1hit.pack
    }

    const l2 = await this.prisma.memoryCache.findFirst({
      where: {
        userId,
        runId,
        memoryVersion: version,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (l2) {
      const pack = l2.payload as MemoryPack
      if (pack.memoryVersion === version) {
        this.writeL1(key, pack)
        return pack
      }
    }

    const pack = await this.rebuild(userId, runId, version)
    await this.writeL2(userId, runId, version, pack)
    this.writeL1(key, pack)
    return pack
  }

  async bumpAndInvalidate(userId: string, runId: string): Promise<number> {
    const updated = await this.prisma.run.updateMany({
      where: { id: runId, userId },
      data: { memoryVersion: { increment: 1 } },
    })
    if (updated.count === 0) {
      throw new NotFoundException('Run not found')
    }
    await this.invalidate(userId, runId)
    const run = await this.prisma.run.findFirst({
      where: { id: runId, userId },
    })
    return run?.memoryVersion ?? 0
  }

  async invalidate(userId: string, runId: string): Promise<void> {
    const prefix = `mem:${userId}:${runId}:`
    const llmPrefix = `llm:${userId}:${runId}:`
    for (const key of this.l1.keys()) {
      if (key.startsWith(prefix) || key.startsWith(llmPrefix)) {
        this.l1.delete(key)
      }
    }
    await this.prisma.memoryCache.deleteMany({ where: { userId, runId } })
    await this.prisma.llmResponseCache.deleteMany({ where: { userId, runId } })
  }

  async getLlmCached(args: {
    userId: string
    runId: string
    memoryVersion: number
    model: string
    promptHash: string
  }): Promise<unknown | null> {
    const run = await this.prisma.run.findFirst({
      where: { id: args.runId, userId: args.userId },
    })
    if (!run || run.memoryVersion !== args.memoryVersion) return null

    const key = llmCacheKey(args)
    const l1hit = this.l1.get(key)
    if (l1hit && l1hit.expiresAt > Date.now()) {
      return l1hit.pack as unknown
    }

    const row = await this.prisma.llmResponseCache.findFirst({
      where: {
        userId: args.userId,
        runId: args.runId,
        memoryVersion: args.memoryVersion,
        cacheKey: key,
        expiresAt: { gt: new Date() },
      },
    })
    return row ? row.payload : null
  }

  async setLlmCached(args: {
    userId: string
    runId: string
    memoryVersion: number
    model: string
    promptHash: string
    payload: unknown
  }): Promise<void> {
    const run = await this.prisma.run.findFirst({
      where: { id: args.runId, userId: args.userId },
    })
    if (!run || run.memoryVersion !== args.memoryVersion) return

    const key = llmCacheKey(args)
    const expiresAt = new Date(Date.now() + L2_TTL_MS)
    await this.prisma.llmResponseCache.create({
      data: {
        cacheKey: key,
        userId: args.userId,
        runId: args.runId,
        memoryVersion: args.memoryVersion,
        model: args.model,
        payload: args.payload as object,
        expiresAt,
      },
    })
    this.writeL1(key, args.payload as MemoryPack)
  }

  /** Test helper — inspect L1 without going through HTTP. */
  peekL1(key: string): MemoryPack | undefined {
    const hit = this.l1.get(key)
    if (!hit || hit.expiresAt <= Date.now()) return undefined
    return hit.pack
  }

  seedL1(key: string, pack: MemoryPack): void {
    this.writeL1(key, pack)
  }

  private writeL1(key: string, pack: MemoryPack): void {
    if (this.l1.has(key)) this.l1.delete(key)
    this.l1.set(key, { pack, expiresAt: Date.now() + L1_TTL_MS })
    while (this.l1.size > L1_MAX_ENTRIES) {
      const oldest = this.l1.keys().next().value
      if (!oldest) break
      this.l1.delete(oldest)
    }
  }

  private async writeL2(
    userId: string,
    runId: string,
    memoryVersion: number,
    pack: MemoryPack,
  ): Promise<void> {
    await this.prisma.memoryCache.create({
      data: {
        cacheKey: memoryCacheKey(userId, runId, memoryVersion),
        userId,
        runId,
        memoryVersion,
        payload: pack as object,
        expiresAt: new Date(Date.now() + L2_TTL_MS),
      },
    })
  }

  private async rebuild(
    userId: string,
    runId: string,
    memoryVersion: number,
  ): Promise<MemoryPack> {
    const [messages, memoryItems, brain] = await Promise.all([
      this.prisma.message.findMany({
        where: { userId, runId },
        orderBy: { createdAt: 'desc' },
        take: RECENT_MESSAGE_LIMIT,
      }),
      this.prisma.memoryItem.findMany({
        where: { userId, runId },
        orderBy: { createdAt: 'desc' },
        take: MEMORY_ITEM_LIMIT,
      }),
      this.prisma.projectBrain.findFirst({
        where: { userId, runId },
      }),
    ])

    return {
      memoryVersion,
      runId,
      userId,
      recentMessages: messages.reverse().map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
      memoryItems: memoryItems.map((item) => ({
        id: item.id,
        kind: item.kind as MemoryPack['memoryItems'][number]['kind'],
        text: item.text,
        sourceMessageId: item.sourceMessageId,
        createdAt: item.createdAt.toISOString(),
      })),
      brain: brain?.data ?? undefined,
    }
  }
}
