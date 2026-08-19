export const MISSING_ACCOUNT_CODE = 'form_identifier_not_found'

export type ClerkFieldError = {
  code: string
  message: string
}

export type SignInAttempt = {
  status: string | null
  createdSessionId: string | null
  errors?: ClerkFieldError[]
}

export type SignUpAttempt = {
  status: string | null
  createdSessionId: string | null
  unverifiedFields?: string[]
  missingFields?: string[]
}

export type AuthContinueResult =
  | { action: 'session'; sessionId: string }
  | { action: 'verify_email'; source: 'sign_in' | 'sign_up' }
  | { action: 'error'; code?: string; message: string }

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

function readErrorItem(item: unknown): ClerkFieldError | null {
  const rec = asRecord(item)
  if (!rec) return null
  const code = String(rec.code || rec.errorCode || '').trim()
  if (!code) return null
  const message = String(
    rec.long_message || rec.longMessage || rec.message || code,
  )
  return { code, message }
}

export function clerkFieldErrors(err: unknown): ClerkFieldError[] {
  const rec = asRecord(err)
  if (!rec) return []

  const buckets: unknown[] = [
    rec.errors,
    asRecord(rec.data)?.errors,
    asRecord(rec.response)?.errors,
    rec.error,
    asRecord(rec.cause) ? rec.cause : null,
  ]

  const out: ClerkFieldError[] = []
  const seen = new Set<string>()
  const push = (item: unknown) => {
    if (Array.isArray(item)) {
      for (const nested of item) push(nested)
      return
    }
    const parsed = readErrorItem(item)
    if (!parsed || seen.has(parsed.code)) return
    seen.add(parsed.code)
    out.push(parsed)
  }

  for (const bucket of buckets) push(bucket)

  const self = readErrorItem(rec)
  if (self && !seen.has(self.code)) out.push(self)

  return out
}

export function isMissingAccountSignInError(err: unknown): boolean {
  const rec = asRecord(err)
  const status = rec?.status
  if (typeof status === 'number' && status !== 422) return false
  if (clerkFieldErrors(err).some((e) => e.code === MISSING_ACCOUNT_CODE)) {
    return true
  }
  const message = String(rec?.message || rec?.longMessage || rec?.long_message || '')
  return /couldn'?t find your account/i.test(message)
}

export function isPasswordStrategyError(err: unknown): boolean {
  if (isMissingAccountSignInError(err)) return false
  return clerkFieldErrors(err).some((e) => {
    if (e.code === 'form_password_incorrect') return false
    return (
      e.code.includes('strategy') ||
      e.code === 'form_param_unknown' ||
      e.code === 'strategy_for_user_invalid'
    )
  })
}

export function throwIfClerkFailure(result: unknown): void {
  const rec = asRecord(result)
  if (!rec) return
  const nested = rec.error
  if (nested) {
    const errors = clerkFieldErrors(nested)
    if (errors.length || asRecord(nested)?.code) {
      throw nested
    }
  }
  const errors = clerkFieldErrors(result)
  if (errors.length && (rec.clerkError === true || rec.status === 422)) {
    throw result
  }
}

export function buildSignUpFromSignIn(input: {
  identifier: string
  password: string
  locale?: string
}): { emailAddress: string; password: string; locale?: string } {
  const emailAddress = input.identifier.trim()
  const body: { emailAddress: string; password: string; locale?: string } = {
    emailAddress,
    password: input.password,
  }
  if (input.locale) body.locale = input.locale
  return body
}

export function nextAfterSignUp(signUp: SignUpAttempt): AuthContinueResult {
  if (signUp.status === 'complete' && signUp.createdSessionId) {
    return { action: 'session', sessionId: signUp.createdSessionId }
  }
  const unverified = signUp.unverifiedFields || []
  if (
    signUp.status === 'missing_requirements' &&
    (unverified.includes('email_address') || unverified.length === 0)
  ) {
    return { action: 'verify_email', source: 'sign_up' }
  }
  if (unverified.includes('email_address')) {
    return { action: 'verify_email', source: 'sign_up' }
  }
  return {
    action: 'error',
    message: 'Account was created but needs another step in Clerk.',
  }
}

export function nextAfterSignIn(signIn: SignInAttempt): AuthContinueResult | null {
  if (signIn.status === 'complete' && signIn.createdSessionId) {
    return { action: 'session', sessionId: signIn.createdSessionId }
  }
  if (
    signIn.status === 'needs_identifier' ||
    (signIn.errors || []).some((e) => e.code === MISSING_ACCOUNT_CODE)
  ) {
    return null
  }
  if (
    signIn.status === 'needs_first_factor' ||
    signIn.status === 'needs_client_trust'
  ) {
    return { action: 'verify_email', source: 'sign_in' }
  }
  return {
    action: 'error',
    message: 'Sign-in needs another factor. Use the code Clerk sent, or try again.',
  }
}

export async function continueSignInOrCreateAccount(opts: {
  identifier: string
  password: string
  locale?: string
  signIn: (input: {
    identifier: string
    password: string
  }) => Promise<SignInAttempt>
  signUp: (input: {
    emailAddress: string
    password: string
    locale?: string
  }) => Promise<SignUpAttempt>
  prepareEmailVerification?: () => Promise<void>
}): Promise<AuthContinueResult> {
  const identifier = opts.identifier.trim()
  const password = opts.password
  if (!identifier || !password) {
    return { action: 'error', message: 'Email and password are required.' }
  }

  let missingAccount = false
  try {
    const signedIn = await opts.signIn({ identifier, password })
    const next = nextAfterSignIn(signedIn)
    if (next) return next
    missingAccount = true
  } catch (err) {
    if (!isMissingAccountSignInError(err)) {
      const first = clerkFieldErrors(err)[0]
      return {
        action: 'error',
        code: first?.code,
        message: first?.message || 'Could not sign in.',
      }
    }
    missingAccount = true
  }

  if (!missingAccount) {
    return { action: 'error', message: 'Could not sign in.' }
  }

  try {
    const created = await opts.signUp(
      buildSignUpFromSignIn({
        identifier,
        password,
        locale: opts.locale,
      }),
    )
    const next = nextAfterSignUp(created)
    if (next.action === 'verify_email') {
      await opts.prepareEmailVerification?.()
    }
    return next
  } catch (err) {
    const first = clerkFieldErrors(err)[0]
    return {
      action: 'error',
      code: first?.code,
      message: first?.message || 'Could not create the account.',
    }
  }
}
