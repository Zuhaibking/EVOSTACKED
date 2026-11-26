'use client'

import { ViewType } from '@/components/auth-dialog'
import { useAuth as useClerkAuth, useUser } from '@clerk/nextjs'
import { usePostHog } from 'posthog-js/react'
import { useEffect, useMemo, useRef, useState } from 'react'

export const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)

export type AuthSession = {
  user: {
    id: string
    email: string
    user_metadata: {
      avatar_url?: string
      is_fragments_user?: boolean
    }
  }
  access_token?: string
}

type UserTeam = {
  email: string
  id: string
  name: string
  tier: string
}

function useStubAuth(
  _setAuthDialog: (value: boolean) => void,
  _setAuthView: (value: ViewType) => void,
) {
  return {
    session: null as AuthSession | null,
    userTeam: undefined as UserTeam | undefined,
    signOut: async () => {},
  }
}

function useClerkBackedAuth(
  setAuthDialog: (value: boolean) => void,
  _setAuthView: (value: ViewType) => void,
) {
  const { isSignedIn, isLoaded, signOut: clerkSignOut, getToken } = useClerkAuth()
  const { user } = useUser()
  const posthog = usePostHog()
  const [accessToken, setAccessToken] = useState<string | undefined>(undefined)
  const identifiedRef = useRef(false)
  const lastSignedInRef = useRef<boolean | undefined>(undefined)

  useEffect(() => {
    if (!isLoaded) return
    if (isSignedIn) {
      // Pull a JWT for downstream API calls (sandbox/headers)
      getToken().then((t) => setAccessToken(t ?? undefined))
      if (!identifiedRef.current && user) {
        posthog?.identify(user.id, {
          email: user.primaryEmailAddress?.emailAddress,
          clerk_id: user.id,
        })
        posthog?.capture('sign_in')
        identifiedRef.current = true
      }
      // Close auth dialog once signed in (covers both fresh sign-in and
      // pages opened with an already-active session).
      setAuthDialog(false)
    } else {
      setAccessToken(undefined)
      if (identifiedRef.current) {
        posthog?.capture('sign_out')
        posthog?.reset()
        identifiedRef.current = false
      }
    }
    lastSignedInRef.current = !!isSignedIn
  }, [isLoaded, isSignedIn, user, getToken, posthog, setAuthDialog])

  const session: AuthSession | null = useMemo(() => {
    if (!isSignedIn || !user) return null
    return {
      user: {
        id: user.id,
        email: user.primaryEmailAddress?.emailAddress ?? '',
        user_metadata: {
          avatar_url: user.imageUrl,
          is_fragments_user: true,
        },
      },
      access_token: accessToken,
    }
  }, [isSignedIn, user, accessToken])

  // Clerk doesn't have the team concept by default — return a stub team
  // shaped like the previous Supabase one so downstream code keeps working.
  const userTeam: UserTeam | undefined = session
    ? {
        id: session.user.id,
        email: session.user.email,
        name: user?.fullName ?? session.user.email,
        tier: 'free',
      }
    : undefined

  return {
    session,
    userTeam,
    signOut: () => clerkSignOut(),
  }
}

// Dev-only headless session. Next inlines NODE_ENV, so production builds fold this to undefined.
const devUserId =
  process.env.NODE_ENV === 'development'
    ? process.env.NEXT_PUBLIC_EVOSTACK_DEV_USER || undefined
    : undefined

function useDevAuth(
  setAuthDialog: (value: boolean) => void,
  _setAuthView: (value: ViewType) => void,
) {
  useEffect(() => setAuthDialog(false), [setAuthDialog])
  const session = useMemo<AuthSession>(
    () => ({
      user: {
        id: devUserId!,
        email: `${devUserId}@dev.local`,
        user_metadata: { is_fragments_user: true },
      },
    }),
    [],
  )
  const userTeam = useMemo<UserTeam>(
    () => ({ id: devUserId!, email: session.user.email, name: devUserId!, tier: 'free' }),
    [session],
  )
  return { session: session as AuthSession | null, userTeam: userTeam as UserTeam | undefined, signOut: async () => {} }
}

export const useAuth = devUserId
  ? useDevAuth
  : clerkEnabled
    ? useClerkBackedAuth
    : useStubAuth
