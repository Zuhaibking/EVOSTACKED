import { Module } from '@nestjs/common'
import { RunsModule } from '../runs/runs.module'
import { SandboxController } from './sandbox.controller'

@Module({
  imports: [RunsModule],
  controllers: [SandboxController],
})
export class SandboxModule {}
