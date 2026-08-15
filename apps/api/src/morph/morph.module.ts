import { Module } from '@nestjs/common'
import { MemoryModule } from '../memory/memory.module'
import { RunsModule } from '../runs/runs.module'
import { MorphController } from './morph.controller'

@Module({
  imports: [RunsModule, MemoryModule],
  controllers: [MorphController],
})
export class MorphModule {}
