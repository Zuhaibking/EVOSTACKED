import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Observable, tap } from 'rxjs'
import { PrismaService } from '../prisma/prisma.service'

const SECRET_KEY_RE =
  /^(apiKey|api_key|accessToken|access_token|authorization|password|secret|NVIDIA_API_KEY|OPENAI_API_KEY|GOOGLE_.*API_KEY|CLERK_.*|E2B_.*)$/i

function stripSecrets(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stripSecrets)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) continue
    if (
      k === 'code' ||
      k === 'fragment' ||
      k === 'messages' ||
      k === 'data' ||
      k === 'source' ||
      k === 'file_content'
    ) {
      out[k] = { omitted: true, size: JSON.stringify(v).length }
      continue
    }
    out[k] = stripSecrets(v)
  }
  return out
}

@Injectable()
export class RequestLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = Date.now()
    const req = context.switchToHttp().getRequest()
    const res = context.switchToHttp().getResponse()
    const userId = req.user?.userId as string | undefined
    const runId =
      (req.params?.id as string | undefined) ||
      (req.body?.runId as string | undefined) ||
      (req.headers['x-run-id'] as string | undefined)

    return next.handle().pipe(
      tap({
        next: () => {
          void this.write(req, res, started, userId, runId)
        },
        error: () => {
          void this.write(req, res, started, userId, runId)
        },
      }),
    )
  }

  private async write(
    req: any,
    res: any,
    started: number,
    userId: string | undefined,
    runId: string | undefined,
  ) {
    try {
      await this.prisma.requestLog.create({
        data: {
          userId: userId ?? null,
          runId: runId ?? null,
          method: String(req.method || 'GET'),
          path: String(req.originalUrl || req.url || ''),
          status: Number(res.statusCode || 500),
          durationMs: Date.now() - started,
          meta: stripSecrets({
            query: req.query,
            bodyKeys: req.body ? Object.keys(req.body) : [],
          }) as object,
        },
      })
    } catch {
      /* never fail the request because logging failed */
    }
  }
}
