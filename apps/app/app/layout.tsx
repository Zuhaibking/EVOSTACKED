import './globals.css'
import { PostHogProvider, ThemeProvider } from './providers'
import { Toaster } from '@/components/ui/toaster'
import { ClerkProvider } from '@clerk/nextjs'
import { dark } from '@clerk/themes'
import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'EvoStack — Fifty specimens. One survives.',
  description:
    'A tournament engine for software architecture. EvoStack generates competing implementations of your idea, tests them under live load, and ships the survivor as deploy-ready code.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <ClerkProvider
      appearance={{
        theme: dark,
        variables: {
          colorPrimary: 'hsl(40 28% 92%)',
          colorBackground: 'hsl(30 12% 7%)',
          colorForeground: 'hsl(40 28% 92%)',
          colorMutedForeground: 'hsl(35 14% 62%)',
          colorInput: 'hsl(30 10% 10%)',
          colorInputForeground: 'hsl(40 28% 92%)',
          colorNeutral: 'hsl(40 28% 92%)',
          colorDanger: 'hsl(8 76% 60%)',
          fontFamily: 'var(--font-body), ui-sans-serif, system-ui',
          fontFamilyButtons: 'var(--font-mono), ui-monospace, monospace',
          borderRadius: '0',
        },
      }}
    >
      <html lang="en" suppressHydrationWarning>
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin="anonymous"
          />
          <link
            href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;0,500;0,600;0,700;0,900;1,400&family=IBM+Plex+Mono:wght@300;400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap"
            rel="stylesheet"
          />
        </head>
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
    </ClerkProvider>
  )
}
