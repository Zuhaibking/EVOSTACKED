'use client'

import { FragmentInterpreter } from './fragment-interpreter'
import { FragmentWeb } from './fragment-web'
import { InspectDraft, InspectSelection } from '@/lib/inspect'
import { getTemplateId } from '@/lib/templates'
import {
  ExecutionResult,
  ExecutionResultInterpreter,
  ExecutionResultWeb,
} from '@/lib/types'

export function FragmentPreview({
  result,
  inspectEnabled,
  selection,
  onSelection,
  draft,
  compare,
  onDraft,
  onText,
  applying,
  guides,
  teamID,
  accessToken,
}: {
  result: ExecutionResult
  inspectEnabled?: boolean
  selection?: InspectSelection | null
  onSelection?: (selection: InspectSelection | null) => void
  draft?: InspectDraft | null
  compare?: boolean
  onDraft?: (draft: InspectDraft) => void
  onText?: (text: string) => void
  applying?: boolean
  guides?: boolean
  teamID?: string
  accessToken?: string
}) {
  if (getTemplateId(result.template) === 'code-interpreter-v1') {
    return <FragmentInterpreter result={result as ExecutionResultInterpreter} />
  }

  return (
    <FragmentWeb
      result={result as ExecutionResultWeb}
      inspectEnabled={inspectEnabled}
      selection={selection}
      onSelection={onSelection}
      draft={draft}
      compare={compare}
      onDraft={onDraft}
      onText={onText}
      applying={applying}
      guides={guides}
      teamID={teamID}
      accessToken={accessToken}
    />
  )
}
