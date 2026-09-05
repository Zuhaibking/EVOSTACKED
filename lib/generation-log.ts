import { promises as fs } from 'fs'
import path from 'path'

const ROOT = path.join(process.cwd(), '.data', 'generation-logs')
const ID = /^[a-zA-Z0-9._-]+$/

export type GenerationStage =
  | 'provider_start'
  | 'provider_stream'
  | 'provider_done'
  | 'provider_error'
  | 'salvaged'
  | 'persist'
  | 'persist_error'
  | 'install'
  | 'install_error'
  | 'write'
  | 'run'

export async function appendGenerationLog(
  runId: string,
  entry: {
    candidateId?: string
    stage: GenerationStage | string
    ok?: boolean
    ms?: number
    error?: string
    [k: string]: unknown
  },
) {
  const id = ID.test(runId) ? runId : 'run'
  try {
    await fs.mkdir(ROOT, { recursive: true })
    await fs.appendFile(
      path.join(ROOT, `${id}.jsonl`),
      `${JSON.stringify({ t: Date.now(), ...entry })}\n`,
    )
  } catch {
    /* logging must never fail generation */
  }
}
