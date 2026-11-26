import { runDiscovery } from '@/lib/discovery/engine'
import { projectSpecSchema } from '@/lib/platform/types'
import ratelimit, { rateLimitKey } from '@/lib/ratelimit'
import { requireUserId } from '@/lib/server-auth'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BODY_BYTES = 128 * 1024

const bodySchema = z.object({
  idea: z.string().trim().min(3, 'Describe your idea in a few words.').max(4000, 'Keep the idea under 4000 characters.'),
  spec: z.unknown().optional(),
  answers: z
    .array(
      z.object({
        questionId: z.string().trim().min(1).max(80),
        question: z.string().trim().max(400),
        answer: z.string().trim().max(1500),
      }),
    )
    .max(30, 'Too many answers (max 30).')
    .default([]),
  model: z.unknown().optional(),
  config: z.unknown().optional(),
})

const fail = (error: string, status: number, headers?: HeadersInit) => Response.json({ error }, { status, headers })

export async function POST(req: Request) {
  const auth = await requireUserId()
  if ('response' in auth) return auth.response

  try {
    const limited = await ratelimit(`${rateLimitKey(req, auth.userId)}:discovery`, 60, '1h')
    if (limited) {
      return fail('Too many discovery requests — try again shortly.', 429, {
        'X-RateLimit-Limit': String(limited.amount),
        'X-RateLimit-Remaining': String(limited.remaining),
        'X-RateLimit-Reset': String(limited.reset),
      })
    }
  } catch (error) {
    console.warn('[discovery] rate limiter unavailable:', error instanceof Error ? error.message : error)
  }

  const raw = await req.text().catch(() => '')
  if (raw.length > MAX_BODY_BYTES) return fail('Request body too large.', 413)
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return fail('Body must be valid JSON.', 400)
  }
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || 'Invalid discovery request.', 400)

  const { idea, answers, spec } = parsed.data
  const validSpec = spec == null ? null : projectSpecSchema.safeParse(spec)
  if (validSpec && !validSpec.success) return fail('spec does not match the ProjectSpec schema.', 400)

  try {
    // model/config are accepted for contract parity but ignored: discovery always runs on the server model + key.
    const result = await runDiscovery({ idea, answers, spec: validSpec ? validSpec.data : null })
    return Response.json(result)
  } catch (error) {
    console.error('[discovery] failed:', error)
    return fail('Discovery failed — please try again.', 500)
  }
}
