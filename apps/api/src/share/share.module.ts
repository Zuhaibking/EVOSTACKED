import { Module } from '@nestjs/common'
import { RunsModule } from '../runs/runs.module'
import { ShareController } from './share.controller'

@Module({
  imports: [RunsModule],
  controllers: [ShareController],
})
export class ShareModule {}
