import { FragmentSchema } from '@/lib/schema'
import { deployAndVerify } from '@/lib/verify-candidate'

export const maxDuration = 60

export async function POST(req: Request) {
  const {
    fragment,
    userID,
    teamID,
    accessToken,
  }: {
    fragment: FragmentSchema
    userID: string | undefined
    teamID: string | undefined
    accessToken: string | undefined
  } = await req.json()

  console.log('fragment', {
    title: fragment?.title,
    template: fragment?.template,
    file_path: fragment?.file_path,
  })
  console.log('userID', userID)

  try {
    // Shared deploy path with tournament verification. Preview requests still
    // return ExecutionResult; verification is included for diagnostics.
    const { verification, execution } = await deployAndVerify(fragment, {
      userID,
      teamID,
      accessToken,
    })

    if (!execution) {
      return new Response(
        JSON.stringify({
          error:
            verification.errors[0] ||
            'Sandbox failed runtime verification',
          verification,
        }),
        { status: 502 },
      )
    }

    return new Response(
      JSON.stringify({
        ...execution,
        verification,
      }),
    )
  } catch (e: any) {
    return new Response(
      JSON.stringify({
        error: e?.message || 'Sandbox deploy failed',
      }),
      { status: 500 },
    )
  }
}
