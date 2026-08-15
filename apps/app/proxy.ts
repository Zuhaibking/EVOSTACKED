import { clerkMiddleware } from '@clerk/nextjs/server'
import { kv } from '@vercel/kv'
import { NextResponse } from 'next/server'

const handler = clerkMiddleware(async (auth, req) => {
  if (req.nextUrl.pathname.startsWith('/s/')) {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      const id = req.nextUrl.pathname.split('/').pop()
      const url = await kv.get(`fragment:${id}`)
      if (url) return NextResponse.redirect(url as string)
      return NextResponse.redirect(new URL('/', req.url))
    }
    return NextResponse.redirect(new URL('/', req.url))
  }
})

export default handler
export const proxy = handler

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
}
