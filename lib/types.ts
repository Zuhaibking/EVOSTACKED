import { ExecutionError, Result } from '@e2b/code-interpreter'

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
  rehydrated?: boolean
  installError?: string
  runError?: string
  // Verification signal. 'unknown' = never probed / probe could not decide.
  health?: 'unknown' | 'ok' | 'broken'
  rolledBack?: boolean
  diagnosis?: string
}

export type ExecutionResult = ExecutionResultInterpreter | ExecutionResultWeb
