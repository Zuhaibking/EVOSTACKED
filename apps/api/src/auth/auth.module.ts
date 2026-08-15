import { Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ClerkJwtGuard } from './clerk-jwt.guard'

@Module({
  providers: [Reflector, ClerkJwtGuard],
  exports: [ClerkJwtGuard],
})
export class AuthModule {}
