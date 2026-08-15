import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { AuthUser, CurrentUser } from '../auth/current-user'
import { toFetchRequest } from '../generation/fetch-request'
import { handleTournament } from '../generation/tournament.runner'
import { MemoryService } from '../memory/memory.service'
import { RunsService } from '../runs/runs.service'

function firstUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown }
    if (m?.role !== 'user') continue
    if (typeof m.content === 'string') return m.content.slice(0, 2000)
    if (Array.isArray(m.content)) {
      const text = m.content
        .map((c: any) => (c?.type === 'text' ? c.text : ''))
        .join('\n')
        .trim()
      if (text) return text.slice(0, 2000)
    }
  }
  return ''
}

@Controller('v1')
export class TournamentController {
  constructor(
    @Inject(RunsService) private readonly runs: RunsService,
    @Inject(MemoryService) private readonly memory: MemoryService,
  ) {}

  @Post('tournament')
  async tournament(
    @CurrentUser() user: AuthUser,
    @Body() body: any,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.runs.ensureUser(user.userId, user.email)
    const ensured = await this.runs.ensure(
      user.userId,
      user.email,
      body.runId ? String(body.runId) : undefined,
    )
    const runId = ensured.id

    const userText = firstUserText(body.messages) || body.evolution?.userRequest
    if (userText) {
      await this.runs.addMessage(user.userId, runId, 'user', {
        role: 'user',
        content: [{ type: 'text', text: userText }],
      })
      await this.runs.addMemoryItem(
        user.userId,
        runId,
        'user_request',
        userText,
      )
    }
    await this.runs.patchMeta(user.userId, runId, { hasTournament: true })
    const pack = await this.memory.getLatest(user.userId, runId)

    const web = await handleTournament(
      toFetchRequest(req.headers, {
        ...body,
        runId,
        userID: user.userId,
        memoryVersion: pack.memoryVersion,
        memoryItems: pack.memoryItems,
      }),
    )

    res.status(web.status)
    web.headers.forEach((value, key) => res.setHeader(key, value))
    res.setHeader('x-run-id', runId)
    res.setHeader('x-memory-revision', String(pack.memoryVersion))
    if (!web.body) {
      res.end(await web.text())
      return
    }
    const reader = web.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(decoder.decode(value, { stream: true }))
    }
    res.end()
  }
}
