import { Module } from '@nestjs/common'
import { MemoryController } from './memory.controller'
import { MemoryService } from './memory.service'

@Module({
  providers: [MemoryService],
  controllers: [MemoryController],
  exports: [MemoryService],
})
export class MemoryModule {}
