import { Module } from '@nestjs/common'
import { MemoryModule } from '../memory/memory.module'
import { RunsController } from './runs.controller'
import { RunsService } from './runs.service'

@Module({
  imports: [MemoryModule],
  controllers: [RunsController],
  providers: [RunsService],
  exports: [RunsService],
})
export class RunsModule {}
