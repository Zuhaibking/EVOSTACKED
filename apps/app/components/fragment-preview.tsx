'use client'

import { FragmentInterpreter } from './fragment-interpreter'
import { FragmentWeb } from './fragment-web'
import { getTemplateId } from '@/lib/templates'
import {
  ExecutionResult,
  ExecutionResultInterpreter,
  ExecutionResultWeb,
} from '@/lib/types'

export function FragmentPreview({
  result,
  viewport = 'desktop',
}: {
  result: ExecutionResult
  viewport?: 'desktop' | 'tablet' | 'mobile'
}) {
  if (getTemplateId(result.template) === 'code-interpreter-v1') {
    return <FragmentInterpreter result={result as ExecutionResultInterpreter} />
  }

  return (
    <FragmentWeb
      result={result as ExecutionResultWeb}
      viewport={viewport}
    />
  )
}
