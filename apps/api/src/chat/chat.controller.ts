import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { AuthUser, CurrentUser } from '../auth/current-user'
import { handleChat } from '../generation/chat.runner'
import { toFetchRequest } from '../generation/fetch-request'
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
export class ChatController {
  constructor(
    @Inject(RunsService) private readonly runs: RunsService,
    @Inject(MemoryService) private readonly memory: MemoryService,
  ) {}

  @Post('chat')
  async chat(
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

    const userText = firstUserText(body.messages)
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

    const pack = await this.memory.getLatest(user.userId, runId)
    const web = await handleChat(
      toFetchRequest(req.headers, {
        ...body,
        runId,
        userID: user.userId,
        memoryVersion: pack.memoryVersion,
        memoryItems: pack.memoryItems,
      }),
    )

    const text = await web.text()
    let fragment: any = null
    try {
      fragment = JSON.parse(text)
    } catch {
      fragment = null
    }

    if (web.status < 400 && (fragment?.title || fragment?.code)) {
      await this.runs.saveFragment(user.userId, runId, fragment)
      await this.runs.addMessage(user.userId, runId, 'assistant', {
        role: 'assistant',
        content: [
          { type: 'text', text: fragment.commentary || '' },
          { type: 'code', text: fragment.file_path || '' },
        ],
        object: fragment,
      })
      const summary = [fragment.title, fragment.commentary]
        .filter(Boolean)
        .join(': ')
        .slice(0, 2000)
      if (summary) {
        await this.runs.addMemoryItem(
          user.userId,
          runId,
          'file_summary',
          summary,
        )
      }
    }

    const messages = await this.runs.listMessages(user.userId, runId)
    const meta = await this.runs.get(user.userId, runId)
    const status = web.status >= 400 ? web.status : 200
    res.status(status).json({
      runId,
      memoryRevision: meta.memoryRevision,
      messages,
      fragment: status >= 400 ? null : fragment,
      error:
        status >= 400
          ? fragment?.error || fragment?.message || text || 'Chat failed'
          : undefined,
    })
  }
}
