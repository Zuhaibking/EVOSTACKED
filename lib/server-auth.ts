import { auth } from '@clerk/nextjs/server'
import { headers } from 'next/headers'

/** Dev-only identity for headless runs; NODE_ENV is never 'development' in a production build. */
async function devUserId(): Promise<string | null> {
  if (process.env.NODE_ENV !== 'development' || !process.env.EVOSTACK_DEV_USER) return null
  // Never let a cross-site page (e.g. a generated site in an E2B preview) ride the dev identity.
  try {
    const site = (await headers()).get('sec-fetch-site')
    if (site === 'cross-site' || site === 'same-site') return null
  } catch { /* outside a request scope (scripts): no browser context to forge */ }
  return process.env.EVOSTACK_DEV_USER
}

/** The verified Clerk user id, or null. Never trusts a client-supplied id. */
export async function getUserId(): Promise<string | null> {
  const dev = await devUserId()
  if (dev) return dev
  try {
    return (await auth()).userId || null
  } catch {
    // auth() throws without clerkMiddleware (Clerk unconfigured): treat as signed out.
    return null
  }
}

export async function requireUserId(): Promise<{ userId: string } | { response: Response }> {
  const userId = await getUserId()
  if (userId) return { userId }
  return { response: Response.json({ error: 'Sign in to continue.' }, { status: 401 }) }
}
