import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { verifyToken } from '@clerk/backend'
import { IS_PUBLIC_KEY } from './public.decorator'

@Injectable()
export class ClerkJwtGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest()
    const path = String(req.originalUrl || req.url || '').split('?')[0]
    if (path === '/health') return true

    const isPublic = this.reflector?.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true
    const header = String(req.headers.authorization || '')
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) {
      throw new UnauthorizedException('Missing Clerk bearer token')
    }

    const secretKey = process.env.CLERK_SECRET_KEY
    if (!secretKey) {
      throw new UnauthorizedException('CLERK_SECRET_KEY is not configured')
    }

    try {
      const payload = await verifyToken(token, { secretKey })
      const userId = payload.sub
      if (!userId) {
        throw new UnauthorizedException('Token missing sub')
      }
      req.user = {
        userId,
        email:
          typeof payload.email === 'string'
            ? payload.email
            : typeof (payload as { email?: string }).email === 'string'
              ? (payload as { email?: string }).email
              : undefined,
      }
      return true
    } catch (err: any) {
      if (err instanceof UnauthorizedException) throw err
      throw new UnauthorizedException('Invalid Clerk token')
    }
  }
}
