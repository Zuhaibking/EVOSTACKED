import { Controller, Get, Inject, Param } from '@nestjs/common'
import { AuthUser, CurrentUser } from '../auth/current-user'
import { MemoryService } from './memory.service'

@Controller('v1/runs')
export class MemoryController {
  constructor(@Inject(MemoryService) private readonly memory: MemoryService) {}

  @Get(':id/memory')
  async getMemory(@CurrentUser() user: AuthUser, @Param('id') runId: string) {
    const pack = await this.memory.getLatest(user.userId, runId)
    return {
      memoryVersion: pack.memoryVersion,
      runId: pack.runId,
      memoryItemIds: pack.memoryItems.map((i) => i.id),
      recentMessageCount: pack.recentMessages.length,
    }
  }
}
