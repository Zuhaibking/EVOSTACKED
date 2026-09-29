import { ExecutionError, Result } from '@e2b/code-interpreter'
import type { CandidateHealth } from './candidate-health'

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
  health?: CandidateHealth
}

export type ExecutionResult = ExecutionResultInterpreter | ExecutionResultWeb
