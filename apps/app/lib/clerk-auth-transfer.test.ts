import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildSignUpFromSignIn,
  clerkFieldErrors,
  continueSignInOrCreateAccount,
  isMissingAccountSignInError,
  isPasswordStrategyError,
  MISSING_ACCOUNT_CODE,
  nextAfterSignIn,
  nextAfterSignUp,
  throwIfClerkFailure,
} from './clerk-auth-transfer'

const missing = {
  status: 422,
  errors: [
    {
      message: "Couldn't find your account.",
      long_message: "Couldn't find your account.",
      code: MISSING_ACCOUNT_CODE,
      meta: { param_name: 'identifier' },
    },
  ],
}

describe('clerkFieldErrors', () => {
  it('reads Clerk Future { error: { code } } payloads', () => {
    assert.deepEqual(
      clerkFieldErrors({
        error: {
          code: MISSING_ACCOUNT_CODE,
          longMessage: "Couldn't find your account.",
        },
      }),
      [
        {
          code: MISSING_ACCOUNT_CODE,
          message: "Couldn't find your account.",
        },
      ],
    )
  })
})

describe('isMissingAccountSignInError', () => {
  it('matches the Clerk 422 identifier miss', () => {
    assert.equal(isMissingAccountSignInError(missing), true)
  })

  it('matches a Future API ClerkError without an errors array', () => {
    assert.equal(
      isMissingAccountSignInError({
        code: MISSING_ACCOUNT_CODE,
        message: "Couldn't find your account.",
      }),
      true,
    )
  })

  it('does not create an account on wrong password or captcha', () => {
    assert.equal(
      isMissingAccountSignInError({
        status: 422,
        errors: [{ code: 'form_password_incorrect', message: 'Password is incorrect.' }],
      }),
      false,
    )
    assert.equal(
      isMissingAccountSignInError({
        status: 403,
        errors: [{ code: 'captcha_invalid', message: 'Captcha failed.' }],
      }),
      false,
    )
  })
})

describe('isPasswordStrategyError', () => {
  it('detects a disallowed password first factor without treating it as a missing account', () => {
    assert.equal(
      isPasswordStrategyError({
        status: 422,
        errors: [{ code: 'strategy_for_user_invalid', message: 'Strategy is invalid.' }],
      }),
      true,
    )
    assert.equal(isPasswordStrategyError(missing), false)
  })
})

describe('throwIfClerkFailure', () => {
  it('throws nested Future API errors so the transfer catch can run', () => {
    assert.throws(() => {
      throwIfClerkFailure({
        error: { code: MISSING_ACCOUNT_CODE, message: "Couldn't find your account." },
      })
    })
  })
})

describe('buildSignUpFromSignIn', () => {
  it('reuses the sign-in identifier and password', () => {
    assert.deepEqual(
      buildSignUpFromSignIn({
        identifier: '  ada@arena.dev  ',
        password: 'same-secret',
        locale: 'en-GB',
      }),
      {
        emailAddress: 'ada@arena.dev',
        password: 'same-secret',
        locale: 'en-GB',
      },
    )
  })
})

describe('nextAfterSignUp', () => {
  it('activates a completed sign-up', () => {
    assert.deepEqual(
      nextAfterSignUp({
        status: 'complete',
        createdSessionId: 'sess_1',
      }),
      { action: 'session', sessionId: 'sess_1' },
    )
  })

  it('asks for email verification when Clerk still requires it', () => {
    assert.deepEqual(
      nextAfterSignUp({
        status: 'missing_requirements',
        createdSessionId: null,
        unverifiedFields: ['email_address'],
      }),
      { action: 'verify_email', source: 'sign_up' },
    )
  })
})

describe('nextAfterSignIn', () => {
  it('falls through to create-account when Clerk returns needs_identifier', () => {
    assert.equal(
      nextAfterSignIn({
        status: 'needs_identifier',
        createdSessionId: null,
      }),
      null,
    )
  })

  it('asks for an email code when password is not the first factor', () => {
    assert.deepEqual(
      nextAfterSignIn({
        status: 'needs_first_factor',
        createdSessionId: null,
      }),
      { action: 'verify_email', source: 'sign_in' },
    )
  })

  it('asks for a trust code on a new device', () => {
    assert.deepEqual(
      nextAfterSignIn({
        status: 'needs_client_trust',
        createdSessionId: null,
      }),
      { action: 'verify_email', source: 'sign_in' },
    )
  })
})

describe('continueSignInOrCreateAccount', () => {
  it('returns the session when sign-in succeeds', async () => {
    const result = await continueSignInOrCreateAccount({
      identifier: 'ada@arena.dev',
      password: 'pw',
      signIn: async () => ({ status: 'complete', createdSessionId: 'sess_ok' }),
      signUp: async () => {
        throw new Error('must not sign up')
      },
    })
    assert.deepEqual(result, { action: 'session', sessionId: 'sess_ok' })
  })

  it('creates the account on the same client when the identifier is missing', async () => {
    let signedUp: { emailAddress: string; password: string } | null = null
    let prepared = false
    const result = await continueSignInOrCreateAccount({
      identifier: 'new@arena.dev',
      password: 'pw-from-signin',
      locale: 'en-GB',
      signIn: async () => {
        throw missing
      },
      signUp: async (body) => {
        signedUp = body
        return {
          status: 'missing_requirements',
          createdSessionId: null,
          unverifiedFields: ['email_address'],
        }
      },
      prepareEmailVerification: async () => {
        prepared = true
      },
    })
    assert.deepEqual(result, { action: 'verify_email', source: 'sign_up' })
    assert.deepEqual(signedUp, {
      emailAddress: 'new@arena.dev',
      password: 'pw-from-signin',
      locale: 'en-GB',
    })
    assert.equal(prepared, true)
  })

  it('creates the account when Clerk returns needs_identifier instead of throwing', async () => {
    let signUpCalls = 0
    const result = await continueSignInOrCreateAccount({
      identifier: 'new@arena.dev',
      password: 'pw-from-signin',
      signIn: async () => ({
        status: 'needs_identifier',
        createdSessionId: null,
      }),
      signUp: async () => {
        signUpCalls += 1
        return {
          status: 'missing_requirements',
          createdSessionId: null,
          unverifiedFields: ['email_address'],
        }
      },
    })
    assert.equal(signUpCalls, 1)
    assert.equal(result.action, 'verify_email')
  })

  it('does not call sign-up for other sign-in failures', async () => {
    let signUpCalls = 0
    const result = await continueSignInOrCreateAccount({
      identifier: 'ada@arena.dev',
      password: 'wrong',
      signIn: async () => {
        throw {
          status: 422,
          errors: [{ code: 'form_password_incorrect', message: 'Password is incorrect.' }],
        }
      },
      signUp: async () => {
        signUpCalls += 1
        return { status: 'complete', createdSessionId: 'nope' }
      },
    })
    assert.equal(signUpCalls, 0)
    assert.equal(result.action, 'error')
    if (result.action === 'error') {
      assert.equal(result.code, 'form_password_incorrect')
    }
  })
})
