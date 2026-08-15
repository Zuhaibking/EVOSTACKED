import { Module } from '@nestjs/common'
import { MemoryModule } from '../memory/memory.module'
import { RunsModule } from '../runs/runs.module'
import { TournamentController } from './tournament.controller'

@Module({
  imports: [RunsModule, MemoryModule],
  controllers: [TournamentController],
})
export class TournamentModule {}
