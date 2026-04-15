import { Footer } from '@/components/landing/footer'
import { Hero } from '@/components/landing/hero'
import { HowItWorks } from '@/components/landing/how-it-works'
import { LandingNav } from '@/components/landing/landing-nav'
import { LiveDemo } from '@/components/landing/live-demo'
import { Metrics } from '@/components/landing/metrics'
import { StackStrip } from '@/components/landing/stack-strip'
import { Team } from '@/components/landing/team'
import { Ticker } from '@/components/landing/ticker'

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-background text-foreground selection:bg-brand-accent/40">
      <LandingNav />
      <Ticker />
      <Hero />
      <HowItWorks />
      <LiveDemo />
      <StackStrip />
      <Metrics />
      <Team />
      <Footer />
    </main>
  )
}
