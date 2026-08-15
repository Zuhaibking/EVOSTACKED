import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ClerkJwtGuard } from './clerk-jwt.guard'

function ctx(auth?: string, publicRoute = false) {
  const reflector = {
    getAllAndOverride: () => publicRoute,
  } as unknown as Reflector
  const req: any = { headers: { authorization: auth || '' } }
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as any
  return { guard: new ClerkJwtGuard(reflector), req, context }
}

describe('ClerkJwtGuard', () => {
  it('allows public routes', async () => {
    const { guard, context } = ctx(undefined, true)
    assert.equal(await guard.canActivate(context), true)
  })

  it('rejects missing bearer token', async () => {
    const { guard, context } = ctx()
    await assert.rejects(
      () => guard.canActivate(context),
      (err: unknown) => err instanceof UnauthorizedException,
    )
  })

  it('rejects when CLERK_SECRET_KEY is missing', async () => {
    const prev = process.env.CLERK_SECRET_KEY
    delete process.env.CLERK_SECRET_KEY
    const { guard, context } = ctx('Bearer tok')
    await assert.rejects(
      () => guard.canActivate(context),
      (err: unknown) => err instanceof UnauthorizedException,
    )
    if (prev) process.env.CLERK_SECRET_KEY = prev
  })
})

void mock
