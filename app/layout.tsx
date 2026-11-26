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
  title: 'EvoStack — Find your best direction.',
  description:
    'Turn your idea into three distinct app designs. Compare the directions, preview your favorite, and refine it with AI.',
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
            storageKey="evostack-appearance"
            defaultTheme="dark"
            enableSystem={false}
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
        theme: dark,
        variables: {
          colorPrimary: 'hsl(var(--brand))',
          colorBackground: 'hsl(var(--card))',
          colorForeground: 'hsl(var(--foreground))',
          colorMutedForeground: 'hsl(var(--muted-foreground))',
          colorInput: 'hsl(var(--background))',
          colorInputForeground: 'hsl(var(--foreground))',
          colorNeutral: 'hsl(var(--foreground))',
          colorDanger: 'hsl(var(--destructive))',
          fontFamily: 'var(--font-body), ui-sans-serif, system-ui',
          fontFamilyButtons: 'var(--font-body), ui-sans-serif, system-ui',
          borderRadius: '8px',
        },
      }}
    >
      {tree}
    </ClerkProvider>
  )
}
