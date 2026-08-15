'use client'

import { ViewType } from '@/components/auth-dialog'
import { useAuth as useClerkAuth, useUser } from '@clerk/nextjs'
import { usePostHog } from 'posthog-js/react'
import { useEffect, useMemo, useRef, useState } from 'react'

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

export function useAuth(
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
    getAccessToken: async () => {
      const t = await getToken()
      if (t) setAccessToken(t)
      return t ?? undefined
    },
  }
}
