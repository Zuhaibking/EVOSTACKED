import { Footer } from '@/components/landing/footer'
import { Hero } from '@/components/landing/hero'
import { HowItWorks } from '@/components/landing/how-it-works'
import { LandingNav } from '@/components/landing/landing-nav'
import { StackStrip } from '@/components/landing/stack-strip'

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-background text-foreground selection:bg-brand-accent/40">
      <LandingNav />
      <Hero />
      <HowItWorks />
      <StackStrip />
      <Footer />
    </main>
  )
}
