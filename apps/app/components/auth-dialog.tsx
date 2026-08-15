'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { SignIn, SignUp } from '@clerk/nextjs'
import { dark } from '@clerk/themes'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { useState } from 'react'

export type ViewType = 'sign_in' | 'sign_up'

const editorialAppearance = {
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
    fontSize: '14px',
    borderRadius: '0',
    spacingUnit: '0.875rem',
  },
  elements: {
    rootBox: 'w-full',
    cardBox: 'w-full shadow-none bg-transparent',
    card: 'bg-transparent shadow-none p-0 gap-3 w-full',
    header: 'hidden',
    footer: 'hidden',

    // Hide all social/SSO buttons — those redirect to accounts.dev and break
    // the in-page modal flow. Email-only keeps everything inside the dialog.
    socialButtonsRoot: 'hidden',
    socialButtons: 'hidden',
    socialButtonsBlockButton: 'hidden',
    socialButtonsIconButton: 'hidden',
    alternativeMethods: 'hidden',
    alternativeMethodsBlockButton: 'hidden',

    dividerRow: 'hidden',
    dividerLine: 'hidden',
    dividerText: 'hidden',

    formFieldRow: 'space-y-1.5',
    formFieldLabelRow: 'flex items-baseline justify-between',
    formFieldLabel:
      'font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground',
    formFieldAction:
      'font-mono text-[10px] tracking-[0.18em] uppercase text-brand-accent hover:text-foreground transition-colors no-underline',
    formFieldHintText:
      'font-mono text-[10px] tracking-[0.16em] uppercase text-muted-foreground/80',
    formFieldErrorText: 'text-destructive text-xs',
    formFieldInput:
      'h-10 rounded-none bg-transparent border border-border focus:border-foreground focus:ring-0 focus:outline-none px-3 text-sm placeholder:text-muted-foreground/50',
    formFieldInputShowPasswordButton: 'text-muted-foreground hover:text-foreground',

    formButtonPrimary:
      'h-10 rounded-none border border-foreground bg-foreground text-background hover:bg-background hover:text-foreground transition-colors font-mono uppercase tracking-[0.22em] text-[11px] shadow-none after:hidden',
    formButtonReset:
      'h-10 rounded-none border border-border bg-transparent text-foreground hover:bg-secondary/40 font-mono uppercase tracking-[0.18em] text-[11px]',

    formResendCodeLink:
      'font-mono text-[10px] tracking-[0.18em] uppercase text-brand-accent hover:text-foreground transition-colors no-underline',
    otpCodeFieldInput:
      'rounded-none bg-transparent border border-border focus:border-foreground',

    identityPreview:
      'rounded-none border border-border bg-transparent px-3 py-2',
    identityPreviewText: 'text-sm text-foreground',
    identityPreviewEditButton:
      'font-mono text-[10px] tracking-[0.18em] uppercase text-brand-accent hover:text-foreground',

    alert: 'rounded-none border border-border bg-secondary/40',
    alertText: 'text-xs text-foreground',

    formFieldSuccessText: 'text-brand-accent text-xs',

    userPreviewMainIdentifier: 'text-sm',
    userPreviewSecondaryIdentifier:
      'font-mono text-[10px] tracking-[0.16em] uppercase text-muted-foreground',

    spinner: 'text-foreground',
  },
  layout: {
    socialButtonsPlacement: 'top' as const,
    socialButtonsVariant: 'blockButton' as const,
    showOptionalFields: true,
  },
}

export function AuthDialog({
  open,
  setOpen,
  view = 'sign_in',
}: {
  open: boolean
  setOpen: (open: boolean) => void
  view?: ViewType
}) {
  const [mode, setMode] = useState<ViewType>(view)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="sm:max-w-[440px] w-[calc(100vw-2rem)] p-0 gap-0 overflow-visible rounded-none border border-foreground bg-background shadow-[10px_10px_0_0_hsl(var(--brand)/0.28)]"
      >
        <VisuallyHidden>
          <DialogTitle>Sign in to EvoStack</DialogTitle>
          <DialogDescription>
            Sign in or create an account to enter the arena.
          </DialogDescription>
        </VisuallyHidden>

        {/* Masthead strip — magazine binding */}
        <div className="flex items-center justify-between border-b border-border px-5 py-2.5">
          <span className="font-mono text-[10px] tracking-[0.24em] uppercase text-muted-foreground">
            § Credentials · Gate
          </span>
          <span className="font-mono text-[10px] tracking-[0.24em] uppercase text-brand-accent">
            {mode === 'sign_in' ? 'Returning' : 'New entrant'}
          </span>
        </div>

        {/* Title block */}
        <div className="px-6 pt-6 pb-4 border-b border-border/60">
          <p className="font-mono text-[10px] tracking-[0.28em] uppercase text-muted-foreground mb-2">
            § 02.1 — Identify
          </p>
          <h2 className="font-display text-3xl font-black tracking-tight leading-[1.05]">
            {mode === 'sign_in' ? (
              <>
                Welcome <span className="italic font-normal">back.</span>
              </>
            ) : (
              <>
                Enter <span className="italic font-normal">the arena.</span>
              </>
            )}
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Authentication dispatches a sandbox under your name. Identity
            travels with the run.
          </p>
        </div>

        {/* Clerk form — own its own paddings */}
        <div className="px-6 py-5">
          {mode === 'sign_in' ? (
            <SignIn
              routing="hash"
              signUpUrl="#"
              forceRedirectUrl="/app"
              fallbackRedirectUrl="/app"
              appearance={editorialAppearance}
            />
          ) : (
            <SignUp
              routing="hash"
              signInUrl="#"
              forceRedirectUrl="/app"
              fallbackRedirectUrl="/app"
              appearance={editorialAppearance}
            />
          )}
        </div>

        {/* Footer rule — view switch */}
        <div className="border-t border-border px-5 py-3 flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
            {mode === 'sign_in' ? 'No record on file?' : 'Already on file?'}
          </span>
          <button
            type="button"
            onClick={() => setMode(mode === 'sign_in' ? 'sign_up' : 'sign_in')}
            className="font-mono text-[10px] tracking-[0.22em] uppercase text-foreground hover:text-brand-accent transition-colors inline-flex items-center gap-1.5"
          >
            <span className="inline-block h-px w-6 bg-current" />
            {mode === 'sign_in' ? 'Sign up' : 'Sign in'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
