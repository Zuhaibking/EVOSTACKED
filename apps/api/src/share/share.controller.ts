import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common'
import { Public } from '../auth/public.decorator'
import { calculateAppHealth } from '@/lib/app-health'
import { buildPublicSharePayload } from '@/lib/public-share'
import type { ProjectBrain } from '@/lib/project-brain'
import { RunsService } from '../runs/runs.service'

@Controller('v1/public')
export class ShareController {
  constructor(@Inject(RunsService) private readonly runs: RunsService) {}

  @Public()
  @Get('runs/:id')
  async getRun(@Param('id') id: string) {
    const row = await this.runs.getPublicShare(id)
    if (!row) throw new NotFoundException('Run not found')
    const payload = buildPublicSharePayload({
      runId: id,
      messages: row.messages,
      brain: row.brain,
      candidates: row.candidates,
    })
    if (!payload.health && row.brain && typeof row.brain === 'object') {
      try {
        const report = calculateAppHealth({ brain: row.brain as ProjectBrain })
        return {
          ...payload,
          health: {
            score: report.score,
            statusLabel: report.statusLabel,
          },
        }
      } catch {
        /* brain may be a partial snapshot */
      }
    }
    return payload
  }
}
