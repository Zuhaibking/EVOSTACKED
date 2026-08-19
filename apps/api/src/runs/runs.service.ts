import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { nanoid } from 'nanoid'
import { PrismaService } from '../prisma/prisma.service'
import { MemoryService } from '../memory/memory.service'
import { textFromStoredContent, titleFromRunSources } from './run-title'

@Injectable()
export class RunsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MemoryService) private readonly memory: MemoryService,
  ) {}

  async ensureUser(userId: string, email?: string) {
    return this.prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, email },
      update: email ? { email } : {},
    })
  }

  async create(userId: string, email?: string, id?: string) {
    await this.ensureUser(userId, email)
    const runId = id || `run_${Date.now().toString(36)}_${nanoid(8)}`
    return this.prisma.run.create({
      data: { id: runId, userId, status: 'active' },
    })
  }

  /** Create the run if missing. Client-supplied ids are accepted only for this JWT user. */
  async ensure(userId: string, email?: string, runId?: string) {
    await this.ensureUser(userId, email)
    if (!runId) return this.create(userId, email)
    const existing = await this.prisma.run.findFirst({
      where: { id: runId, userId },
    })
    if (existing) return existing
    try {
      return await this.prisma.run.create({
        data: { id: runId, userId, status: 'active' },
      })
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new NotFoundException('Run not found')
      }
      throw err
    }
  }

  async list(userId: string) {
    const rows = await this.prisma.run.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        memoryVersion: true,
        selectedCandidate: true,
        activeVersion: true,
        hasTournament: true,
        status: true,
        updatedAt: true,
        messages: {
          where: { role: 'user' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { content: true },
        },
        projectBrain: { select: { data: true } },
      },
    })
    return rows.map((row) => {
      const brain = (row.projectBrain?.data || {}) as {
        plan?: { productName?: string; productGoal?: string }
      }
      const preview = textFromStoredContent(row.messages[0]?.content)
      return {
        id: row.id,
        memoryVersion: row.memoryVersion,
        selectedCandidate: row.selectedCandidate,
        activeVersion: row.activeVersion,
        hasTournament: row.hasTournament,
        status: row.status,
        updatedAt: row.updatedAt,
        title: titleFromRunSources({
          productName: brain.plan?.productName,
          firstUserText: preview,
        }),
        preview: (brain.plan?.productGoal || preview).slice(0, 180),
      }
    })
  }

  async get(userId: string, runId: string) {
    const run = await this.prisma.run.findFirst({
      where: { id: runId, userId },
    })
    if (!run) throw new NotFoundException('Run not found')
    return {
      runId: run.id,
      memoryRevision: run.memoryVersion,
      selectedCandidate: run.selectedCandidate,
      activeVersion: run.activeVersion,
      hasTournament: run.hasTournament,
      status: run.status,
    }
  }

  async listMessages(userId: string, runId: string) {
    await this.get(userId, runId)
    const rows = await this.prisma.message.findMany({
      where: { userId, runId },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map((r) => r.content)
  }

  async addMessage(
    userId: string,
    runId: string,
    role: string,
    content: unknown,
  ) {
    await this.get(userId, runId)
    const row = await this.prisma.message.create({
      data: {
        userId,
        runId,
        role,
        content: content as object,
      },
    })
    await this.memory.bumpAndInvalidate(userId, runId)
    return row
  }

  async addMemoryItem(
    userId: string,
    runId: string,
    kind: string,
    text: string,
    sourceMessageId?: string,
  ) {
    await this.get(userId, runId)
    return this.prisma.memoryItem.create({
      data: { userId, runId, kind, text, sourceMessageId },
    })
  }

  async createCandidate(
    userId: string,
    runId: string,
    variantId: string,
    status: string,
    data: unknown,
  ) {
    await this.get(userId, runId)
    return this.prisma.candidate.create({
      data: {
        userId,
        runId,
        variantId,
        status,
        data: (data ?? {}) as object,
      },
    })
  }

  async updateCandidate(
    userId: string,
    runId: string,
    id: string,
    status: string,
    data: unknown,
  ) {
    const updated = await this.prisma.candidate.updateMany({
      where: { id, userId, runId },
      data: { status, data: (data ?? {}) as object },
    })
    if (updated.count === 0) throw new NotFoundException('Candidate not found')
    return { id, status }
  }

  async saveFragment(userId: string, runId: string, data: unknown, candidateId?: string) {
    await this.get(userId, runId)
    return this.prisma.fragment.create({
      data: {
        userId,
        runId,
        candidateId,
        data: data as object,
      },
    })
  }

  async saveBrain(userId: string, runId: string, data: unknown) {
    await this.get(userId, runId)
    return this.prisma.projectBrain.upsert({
      where: { runId },
      create: { userId, runId, data: data as object },
      update: { data: data as object },
    })
  }

  async getBrain(userId: string, runId: string) {
    await this.get(userId, runId)
    return this.prisma.projectBrain.findFirst({ where: { userId, runId } })
  }

  async listCandidates(runId: string, userId?: string) {
    return this.prisma.candidate.findMany({
      where: userId ? { runId, userId } : { runId },
      orderBy: { updatedAt: 'desc' },
    })
  }

  async listCandidatesForUser(userId: string, runId: string) {
    await this.get(userId, runId)
    const rows = await this.listCandidates(runId, userId)
    return rows.map((c) => ({
      variantId: c.variantId,
      status: c.status,
      data: c.data,
    }))
  }

  async getLatestFragment(userId: string, runId: string) {
    await this.get(userId, runId)
    const row = await this.prisma.fragment.findFirst({
      where: { userId, runId },
      orderBy: { createdAt: 'desc' },
    })
    return row?.data ?? null
  }

  /** Unlisted public share — run id is the capability. */
  async getPublicShare(runId: string) {
    const run = await this.prisma.run.findFirst({ where: { id: runId } })
    if (!run) return null
    const [messages, brain, candidates] = await Promise.all([
      this.prisma.message.findMany({
        where: { runId },
        orderBy: { createdAt: 'asc' },
        take: 40,
      }),
      this.prisma.projectBrain.findFirst({ where: { runId } }),
      this.listCandidates(runId),
    ])
    return {
      run,
      messages: messages.map((m) => m.content),
      brain: brain?.data ?? null,
      candidates: candidates.map((c) => ({
        variantId: c.variantId,
        status: c.status,
        data: c.data,
      })),
    }
  }

  async listVersions(userId: string, runId: string) {
    await this.get(userId, runId)
    const rows = await this.prisma.versionSnapshot.findMany({
      where: { userId, runId },
      orderBy: { version: 'asc' },
    })
    return rows.map((r) => {
      const data = (r.data || {}) as Record<string, unknown>
      return {
        ...data,
        version: r.version,
        createdAt: r.createdAt.toISOString(),
      }
    })
  }

  async saveVersion(userId: string, runId: string, version: number, data: unknown) {
    await this.get(userId, runId)
    return this.prisma.versionSnapshot.upsert({
      where: { runId_version: { runId, version } },
      create: { userId, runId, version, data: data as object },
      update: { data: data as object },
    })
  }

  async getVersion(userId: string, runId: string, version: number) {
    await this.get(userId, runId)
    const row = await this.prisma.versionSnapshot.findFirst({
      where: { userId, runId, version },
    })
    if (!row) throw new NotFoundException('Version not found')
    return row
  }

  async patchMeta(
    userId: string,
    runId: string,
    patch: {
      selectedCandidate?: string | null
      hasTournament?: boolean
      activeVersion?: number | null
      status?: string
    },
  ) {
    const updated = await this.prisma.run.updateMany({
      where: { id: runId, userId },
      data: patch,
    })
    if (updated.count === 0) throw new NotFoundException('Run not found')
    return this.get(userId, runId)
  }
}
