import { Module } from '@nestjs/common'
import { MemoryModule } from '../memory/memory.module'
import { RunsModule } from '../runs/runs.module'
import { ChatController } from './chat.controller'

@Module({
  imports: [RunsModule, MemoryModule],
  controllers: [ChatController],
})
export class ChatModule {}
