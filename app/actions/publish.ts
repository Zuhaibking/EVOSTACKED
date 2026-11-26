'use server'

import { Duration, ms } from '@/lib/duration'
import { getUserId } from '@/lib/server-auth'
import { Sandbox } from '@e2b/code-interpreter'
import { kv } from '@vercel/kv'
import { customAlphabet } from 'nanoid'

const nanoid = customAlphabet('1234567890abcdef', 7)

// teamID/accessToken are accepted for call compatibility only; nothing is forwarded to E2B.
export async function publish(
  url: string,
  sbxId: string,
  duration: Duration,
  _teamID?: string | undefined,
  _accessToken?: string | undefined,
) {
  const userId = await getUserId()
  if (!userId) throw new Error('Sign in to publish this preview.')
  if (typeof sbxId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(sbxId)) {
    throw new Error('Invalid preview.')
  }

  const parsedUrl = new URL(url)
  // Preview hosts are `<port>-<sbxId>.e2b.app`: the link must point at this sandbox.
  const label = parsedUrl.hostname.endsWith('.e2b.app') ? parsedUrl.hostname.slice(0, -'.e2b.app'.length) : ''
  if (parsedUrl.protocol !== 'https:' || !/^\d+-/.test(label) || label.slice(label.indexOf('-') + 1) !== sbxId) {
    throw new Error('URL must be this preview on the *.e2b.app domain')
  }

  const expiration = ms(duration)
  if (!Number.isFinite(expiration) || expiration <= 0 || expiration > ms('24h')) {
    throw new Error('Expiration must be 24 hours or less')
  }

  const info = await Sandbox.getInfo(sbxId, { requestTimeoutMs: 10_000 })
  if (info.metadata?.userID !== userId) {
    throw new Error('This preview belongs to another account.')
  }

  await Sandbox.setTimeout(sbxId, expiration)

  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const id = nanoid()
    await kv.set(`fragment:${id}`, url, { px: expiration })

    return {
      url: process.env.NEXT_PUBLIC_SITE_URL
        ? `https://${process.env.NEXT_PUBLIC_SITE_URL}/s/${id}`
        : `/s/${id}`,
    }
  }

  return {
    url,
  }
}
