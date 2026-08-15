import { Module } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { AuthModule } from './auth/auth.module'
import { ClerkJwtGuard } from './auth/clerk-jwt.guard'
import { ChatModule } from './chat/chat.module'
import { HealthController } from './health.controller'
import { LogsModule } from './logs/logs.module'
import { RequestLogInterceptor } from './logs/request-log.interceptor'
import { MemoryModule } from './memory/memory.module'
import { MorphModule } from './morph/morph.module'
import { PrismaModule } from './prisma/prisma.module'
import { RunsModule } from './runs/runs.module'
import { SandboxModule } from './sandbox/sandbox.module'
import { TournamentModule } from './tournament/tournament.module'

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    MemoryModule,
    LogsModule,
    RunsModule,
    ChatModule,
    TournamentModule,
    MorphModule,
    SandboxModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ClerkJwtGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestLogInterceptor },
  ],
})
export class AppModule {}
