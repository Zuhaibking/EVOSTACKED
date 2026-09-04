import { clerkMiddleware } from '@clerk/nextjs/server'
import { kv } from '@vercel/kv'
import { NextRequest, NextResponse } from 'next/server'

async function shortLinkRedirect(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith('/s/')) return null
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const id = req.nextUrl.pathname.split('/').pop()
    const url = await kv.get(`fragment:${id}`)
    if (url) return NextResponse.redirect(url as string)
    return NextResponse.redirect(new URL('/', req.url))
  }
  return NextResponse.redirect(new URL('/', req.url))
}

const clerkReady = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
)

export default clerkReady
  ? clerkMiddleware(async (_auth, req) => {
      return (await shortLinkRedirect(req)) ?? undefined
    })
  : async (req: NextRequest) => {
      return (await shortLinkRedirect(req)) ?? NextResponse.next()
    }

export const config = {
  matcher: [
    // Run on all routes except Next internals & static files, and always on API.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
