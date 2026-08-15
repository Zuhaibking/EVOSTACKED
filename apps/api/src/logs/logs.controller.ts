import { Controller, Get, Inject, Query } from '@nestjs/common'
import { AuthUser, CurrentUser } from '../auth/current-user'
import { PrismaService } from '../prisma/prisma.service'

@Controller('v1/logs')
export class LogsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('runId') runId?: string,
  ) {
    return this.prisma.requestLog.findMany({
      where: {
        userId: user.userId,
        ...(runId ? { runId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        method: true,
        path: true,
        status: true,
        durationMs: true,
        runId: true,
        createdAt: true,
        meta: true,
      },
    })
  }
}
