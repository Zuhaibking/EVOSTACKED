import { loadProjectMeta } from './project-meta'
import { auth } from '@clerk/nextjs/server'

const clerkOn = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
)

export function clerkConfigured() {
  return clerkOn
}

export async function currentUserId(): Promise<string | null> {
  if (!clerkOn) return null
  try {
    const { userId } = await auth()
    return userId
  } catch {
    return null
  }
}

export async function requireSignedIn(): Promise<{
  userId: string | null
  ok: boolean
}> {
  if (!clerkOn) return { userId: null, ok: true }
  const userId = await currentUserId()
  return { userId, ok: Boolean(userId) }
}

export async function canAccessProject(projectId: string): Promise<boolean> {
  const { userId, ok } = await requireSignedIn()
  if (!ok) return false
  const meta = await loadProjectMeta(projectId)
  if (!meta?.ownerId || !userId) return true
  return meta.ownerId === userId
}
