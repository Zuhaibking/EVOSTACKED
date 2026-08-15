import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { AuthUser, CurrentUser } from '../auth/current-user'
import { pipeWebResponse, toFetchRequest } from '../generation/fetch-request'
import { handleSandbox } from '../generation/sandbox.runner'
import { RunsService } from '../runs/runs.service'

@Controller('v1')
export class SandboxController {
  constructor(@Inject(RunsService) private readonly runs: RunsService) {}

  @Post('sandbox')
  async sandbox(
    @CurrentUser() user: AuthUser,
    @Body() body: any,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const runId = String(body.runId || '')
    if (runId) {
      await this.runs.ensure(user.userId, user.email, runId)
    }
    const web = await handleSandbox(
      toFetchRequest(req.headers, {
        ...body,
        userID: user.userId,
      }),
    )
    await pipeWebResponse(web, res)
  }
}
