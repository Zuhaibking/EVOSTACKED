'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  clerkFieldErrors,
  continueSignInOrCreateAccount,
  isMissingAccountSignInError,
  isPasswordStrategyError,
} from '@/lib/clerk-auth-transfer'
import { useSignIn, useSignUp } from '@clerk/nextjs'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { type FormEvent, useEffect, useState } from 'react'

export type ViewType = 'sign_in' | 'sign_up'

const fieldClass =
  'h-10 rounded-none bg-card text-foreground border border-foreground/40 focus-visible:border-foreground focus-visible:ring-0 px-3 text-sm placeholder:text-muted-foreground'

const labelClass =
  'font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground'

function errorMessage(err: unknown, fallback: string) {
  return clerkFieldErrors(err)[0]?.message || fallback
}

export function AuthDialog({
  open,
  setOpen,
  view: _view = 'sign_in',
}: {
  open: boolean
  setOpen: (open: boolean) => void
  view?: ViewType
}) {
  const { signIn, fetchStatus: signInFetch } = useSignIn()
  const { signUp, fetchStatus: signUpFetch } = useSignUp()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<'form' | 'verify'>('form')
  const [verifyKind, setVerifyKind] = useState<'sign_up' | 'email_code' | 'mfa'>(
    'sign_up',
  )
  const [createdAccount, setCreatedAccount] = useState(false)

  useEffect(() => {
    if (open) return
    setStep('form')
    setError(null)
    setCode('')
    setBusy(false)
    setCreatedAccount(false)
    setVerifyKind('sign_up')
    setPassword('')
  }, [open])

  async function activateIfComplete() {
    if (signIn.status === 'complete') {
      await signIn.finalize()
      setOpen(false)
      return true
    }
    if (signUp.status === 'complete') {
      await signUp.finalize()
      setOpen(false)
      return true
    }
    return false
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const locale =
      typeof navigator !== 'undefined' ? navigator.language : undefined
    try {
      const result = await continueSignInOrCreateAccount({
        identifier,
        password,
        locale,
        signIn: async (input) => {
          const attempt = await signIn.password({
            emailAddress: input.identifier,
            password: input.password,
          })
          if (attempt.error) {
            if (
              isMissingAccountSignInError(attempt.error) ||
              !isPasswordStrategyError(attempt.error)
            ) {
              throw attempt.error
            }
            const retry = await signIn.emailCode.sendCode({
              emailAddress: input.identifier,
            })
            if (retry.error) throw retry.error
          }
          return {
            status: signIn.status,
            createdSessionId: signIn.createdSessionId,
          }
        },
        signUp: async (input) => {
          const attempt = await signUp.password({
            emailAddress: input.emailAddress,
            password: input.password,
            locale: input.locale,
          })
          if (attempt.error) throw attempt.error
          return {
            status: signUp.status,
            createdSessionId: signUp.createdSessionId,
            unverifiedFields: signUp.unverifiedFields,
            missingFields: signUp.missingFields,
          }
        },
        prepareEmailVerification: async () => {
          const sent = await signUp.verifications.sendEmailCode()
          if (sent.error) throw sent.error
        },
      })

      if (result.action === 'session') {
        const activated = await activateIfComplete()
        if (!activated) {
          setError('Signed in, but Clerk did not open a session. Try Continue again.')
        }
        return
      }
      if (result.action === 'verify_email') {
        if (result.source === 'sign_in') {
          if (signIn.status === 'needs_client_trust') {
            const sent = await signIn.mfa.sendEmailCode()
            if (sent.error) throw sent.error
            setVerifyKind('mfa')
          } else {
            const sent = await signIn.emailCode.sendCode({
              emailAddress: identifier.trim(),
            })
            if (sent.error) throw sent.error
            setVerifyKind('email_code')
          }
        } else {
          setVerifyKind('sign_up')
        }
        setCreatedAccount(result.source === 'sign_up')
        setStep('verify')
        return
      }
      setError(result.message)
    } catch (err) {
      setError(errorMessage(err, 'Could not continue.'))
    } finally {
      setBusy(false)
    }
  }

  async function onVerify(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (verifyKind === 'email_code') {
        const attempt = await signIn.emailCode.verifyCode({ code: code.trim() })
        if (attempt.error) throw attempt.error
      } else if (verifyKind === 'mfa') {
        const attempt = await signIn.mfa.verifyEmailCode({ code: code.trim() })
        if (attempt.error) throw attempt.error
      } else {
        const attempt = await signUp.verifications.verifyEmailCode({
          code: code.trim(),
        })
        if (attempt.error) throw attempt.error
      }
      const activated = await activateIfComplete()
      if (!activated) {
        setError('That code did not finish verification. Try again.')
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not verify that code.'))
    } finally {
      setBusy(false)
    }
  }

  async function resendCode() {
    setBusy(true)
    setError(null)
    try {
      if (verifyKind === 'email_code') {
        const sent = await signIn.emailCode.sendCode({
          emailAddress: identifier.trim(),
        })
        if (sent.error) throw sent.error
        return
      }
      if (verifyKind === 'mfa') {
        const sent = await signIn.mfa.sendEmailCode()
        if (sent.error) throw sent.error
        return
      }
      const sent = await signUp.verifications.sendEmailCode()
      if (sent.error) throw sent.error
    } catch (err) {
      setError(errorMessage(err, 'Could not resend the code.'))
    } finally {
      setBusy(false)
    }
  }

  const fetching = signInFetch === 'fetching' || signUpFetch === 'fetching'
  const canSubmit = Boolean(identifier.trim() && password) && !busy && !fetching

  return (
    <>
      <div
        id="clerk-captcha"
        data-cl-theme="dark"
        className="clerk-captcha-slot"
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[440px] w-[calc(100vw-2rem)] max-h-[min(90vh,42rem)] p-0 gap-0 overflow-y-auto rounded-none border border-foreground bg-background shadow-[10px_10px_0_0_hsl(var(--brand)/0.28)]">
          <VisuallyHidden>
            <DialogTitle>Sign in to EvoStack</DialogTitle>
            <DialogDescription>
              Sign in or create an account to enter the arena.
            </DialogDescription>
          </VisuallyHidden>

          <div className="flex items-center justify-between border-b border-border px-5 py-2.5">
            <span className="font-mono text-[10px] tracking-[0.24em] uppercase text-muted-foreground">
              § Credentials · Gate
            </span>
            <span className="font-mono text-[10px] tracking-[0.24em] uppercase text-brand-accent">
              {createdAccount ? 'New entrant' : 'Returning'}
            </span>
          </div>

          <div className="px-6 pt-6 pb-4 border-b border-border/60">
            <p className="font-mono text-[10px] tracking-[0.28em] uppercase text-muted-foreground mb-2">
              {step === 'verify' ? '§ 02.2 — Confirm' : '§ 02.1 — Identify'}
            </p>
            <h2 className="font-display text-3xl font-black tracking-tight leading-[1.05]">
              {createdAccount ? (
                <>
                  Enter <span className="italic font-normal">the arena.</span>
                </>
              ) : (
                <>
                  Welcome <span className="italic font-normal">back.</span>
                </>
              )}
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              {step === 'verify'
                ? createdAccount
                  ? `No account was on file for ${identifier}. We opened one with the same password and sent a code there.`
                  : `We sent a code to ${identifier}. Enter it to continue.`
                : 'Email and password on this step. If you are new, Continue creates the account here.'}
            </p>
          </div>

          <div className="px-6 py-5">
            {step === 'form' ? (
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="auth-identifier" className={labelClass}>
                    Email address
                  </label>
                  <Input
                    id="auth-identifier"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@studio.dev"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    className={fieldClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="auth-password" className={labelClass}>
                    Password
                  </label>
                  <Input
                    id="auth-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    placeholder="Password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className={fieldClass}
                  />
                </div>
                {error ? (
                  <p className="text-destructive text-xs">{error}</p>
                ) : null}
                <Button
                  type="submit"
                  disabled={!canSubmit}
                  className="h-10 w-full rounded-none border border-foreground bg-foreground text-background hover:bg-background hover:text-foreground font-mono uppercase tracking-[0.22em] text-[11px] shadow-none disabled:opacity-40"
                >
                  {busy || fetching ? 'Continuing…' : 'Continue'}
                </Button>
              </form>
            ) : (
              <form onSubmit={onVerify} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="auth-code" className={labelClass}>
                    Email code
                  </label>
                  <Input
                    id="auth-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    placeholder="6-digit code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    className={fieldClass}
                  />
                </div>
                {error ? (
                  <p className="text-destructive text-xs">{error}</p>
                ) : null}
                <Button
                  type="submit"
                  disabled={busy || fetching || !code.trim()}
                  className="h-10 w-full rounded-none border border-foreground bg-foreground text-background hover:bg-background hover:text-foreground font-mono uppercase tracking-[0.22em] text-[11px] shadow-none"
                >
                  {busy || fetching ? 'Verifying…' : 'Verify and enter'}
                </Button>
                <button
                  type="button"
                  onClick={resendCode}
                  disabled={busy || fetching}
                  className="font-mono text-[10px] tracking-[0.18em] uppercase text-brand-accent hover:text-foreground transition-colors"
                >
                  Resend code
                </button>
              </form>
            )}
          </div>

          <div className="border-t border-border px-5 py-3">
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
              {step === 'verify'
                ? 'Same sign-in. No second form.'
                : 'No record on file? Continue — we will create one here.'}
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
