import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common'
import { AuthUser, CurrentUser } from '../auth/current-user'
import { RunsService } from './runs.service'

@Controller('v1/runs')
export class RunsController {
  constructor(@Inject(RunsService) private readonly runs: RunsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body?: { id?: string }) {
    return this.runs.ensure(user.userId, user.email, body?.id)
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.runs.list(user.userId)
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.runs.get(user.userId, id)
  }

  @Patch(':id')
  patch(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      selectedCandidate?: string | null
      hasTournament?: boolean
      activeVersion?: number | null
      status?: string
    },
  ) {
    return this.runs.patchMeta(user.userId, id, body)
  }

  @Get(':id/messages')
  listMessages(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.runs.listMessages(user.userId, id)
  }

  @Post(':id/messages')
  addMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { role: string; content: unknown },
  ) {
    return this.runs.addMessage(user.userId, id, body.role, body.content)
  }

  @Get(':id/brain')
  async getBrain(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const row = await this.runs.getBrain(user.userId, id)
    return row?.data ?? null
  }

  @Get(':id/candidates')
  listCandidates(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.runs.listCandidatesForUser(user.userId, id)
  }

  @Get(':id/fragment')
  getLatestFragment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.runs.getLatestFragment(user.userId, id)
  }

  @Post(':id/brain')
  saveBrain(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { data: unknown },
  ) {
    return this.runs.saveBrain(user.userId, id, body.data)
  }

  @Get(':id/versions')
  listVersions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.runs.listVersions(user.userId, id)
  }

  @Post(':id/versions')
  saveVersion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { version: number; data: unknown },
  ) {
    return this.runs.saveVersion(user.userId, id, body.version, body.data)
  }

  @Get(':id/versions/:version')
  getVersion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.runs.getVersion(user.userId, id, version)
  }
}
