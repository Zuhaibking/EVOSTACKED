/** Shared 501 until the next generation engine is wired in. */
export function generationNotImplemented(route: string): Response {
  return Response.json(
    {
      error: `Generation engine removed. Implement ${route} — see tasks/GENERATION.md`,
    },
    { status: 501 },
  )
}
