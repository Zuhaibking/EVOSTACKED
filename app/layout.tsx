import './globals.css'
import { PostHogProvider, ThemeProvider } from './providers'
import { Toaster } from '@/components/ui/toaster'
import { ClerkProvider } from '@clerk/nextjs'
import { dark } from '@clerk/themes'
import { Analytics } from '@vercel/analytics/next'
import type { Metadata } from 'next'
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'

const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600', '700', '900'],
  style: ['normal', 'italic'],
  display: 'swap',
})

const body = IBM_Plex_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
})

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['300', '400', '500', '600'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'EvoStack — Fifty specimens. One survives.',
  description:
    'A tournament engine for software architecture. EvoStack generates competing implementations of your idea, tests them under live load, and ships the survivor as deploy-ready code.',
}

const clerkReady = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
)

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const tree = (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <PostHogProvider>
        <body className="font-sans antialiased">
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            {children}
          </ThemeProvider>
          <Toaster />
          <Analytics />
        </body>
      </PostHogProvider>
    </html>
  )

  // Keyless Clerk (no env keys) mounts a configure widget that POSTs React
  // children into a server action — Next 14 throws on that. Skip Clerk until
  // real keys exist.
  if (!clerkReady) return tree

  return (
    <ClerkProvider
      appearance={{
        baseTheme: dark,
        variables: {
          colorPrimary: 'hsl(40 28% 92%)',
          colorBackground: 'hsl(30 12% 7%)',
          colorText: 'hsl(40 28% 92%)',
          colorTextSecondary: 'hsl(35 14% 62%)',
          colorInputBackground: 'hsl(30 10% 10%)',
          colorInputText: 'hsl(40 28% 92%)',
          colorNeutral: 'hsl(40 28% 92%)',
          colorDanger: 'hsl(8 76% 60%)',
          fontFamily: 'var(--font-body), ui-sans-serif, system-ui',
          fontFamilyButtons: 'var(--font-mono), ui-monospace, monospace',
          borderRadius: '0',
        },
      }}
    >
      {tree}
    </ClerkProvider>
  )
}
