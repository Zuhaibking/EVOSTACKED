import { saveSubmission } from '@/lib/submissions'

export async function POST(req: Request) {
  let body: Record<string, unknown> = {}
  try {
    const raw = await req.text()
    if (raw.length > 50_000) {
      return Response.json({ ok: false, error: 'too large' }, { status: 413 })
    }
    body = JSON.parse(raw || '{}') as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }
  const row = await saveSubmission({
    project_id: typeof body.project_id === 'string' ? body.project_id : undefined,
    run_id: typeof body.run_id === 'string' ? body.run_id : undefined,
    candidate_id: typeof body.candidate_id === 'string' ? body.candidate_id : undefined,
    form_id: typeof body.form_id === 'string' ? body.form_id : undefined,
    payload: body.payload,
  })
  return Response.json({ ok: true, id: row.id })
}
