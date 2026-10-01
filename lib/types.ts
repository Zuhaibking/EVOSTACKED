import { ExecutionError, Result } from '@e2b/code-interpreter'
import type { CandidateHealth } from './candidate-health'
import type { FragmentSchema } from './schema'

type ExecutionResultBase = {
  sbxId: string
}

export type ExecutionResultInterpreter = ExecutionResultBase & {
  template: string
  stdout: string[]
  stderr: string[]
  runtimeError?: ExecutionError
  cellResults: Result[]
}

export type ExecutionResultWeb = ExecutionResultBase & {
  template: string
  url: string
  /** Running lease expiry; a paused sandbox may still be resumed after this time. */
  expiresAt?: number
  health?: CandidateHealth
  /** The source actually written after sanitization, image resolution, and repairs. */
  fragment?: FragmentSchema
  /** Repaired source with portable image queries, used if the sandbox is gone. */
  recoveryFragment?: FragmentSchema
  /** Portable asset references allow rebuilding edited source without losing edits. */
  imageQueries?: { file: string; query: string }[]
}

export type ExecutionResult = ExecutionResultInterpreter | ExecutionResultWeb
