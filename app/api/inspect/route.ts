import { handleAPIError, createRateLimitResponse } from '@/lib/api-errors'
import { Duration } from '@/lib/duration'
import {
  InspectSelection,
  isValidPatchedFragment,
} from '@/lib/inspect'
import { getModelClient, LLMModel, LLMModelConfig } from '@/lib/models'
import { applyPatch } from '@/lib/morph'
import ratelimit from '@/lib/ratelimit'
import {
  FragmentSchema,
  fragmentCodeText,
  morphEditSchema,
} from '@/lib/schema'
import { generateObject, LanguageModel, CoreMessage } from 'ai'

export const maxDuration = 300

const rateLimitMaxRequests = process.env.RATE_LIMIT_MAX_REQUESTS
  ? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS)
  : 10
const ratelimitWindow = process.env.RATE_LIMIT_WINDOW
  ? (process.env.RATE_LIMIT_WINDOW as Duration)
  : '1d'

async function mergeEdit(args: {
  filePath: string
  instruction: string
  initialCode: string
  edit: string
}) {
  const morphKey = process.env.MORPH_API_KEY
  if (morphKey) {
    const merged = await applyPatch({
      targetFile: args.filePath,
      instructions: args.instruction,
      initialCode: args.initialCode,
      codeEdit: args.edit,
      apiKey: morphKey,
    })
    return merged.code
  }
  // ponytail: no Morph — accept a full-file edit; partial markers need Morph
  if (!args.edit.includes('... existing code ...')) {
    return args.edit
  }
  throw new Error(
    'Partial edits need MORPH_API_KEY. The model returned a patch, not a full file.',
  )
}

export async function POST(req: Request) {
  const {
    fragment,
    selection,
    instruction,
    model,
    config,
  }: {
    fragment: FragmentSchema
    selection: InspectSelection | null
    instruction: string
    model: LLMModel
    config: LLMModelConfig
  } = await req.json()

  const limit = !config.apiKey
    ? await ratelimit(
        req.headers.get('x-forwarded-for'),
        rateLimitMaxRequests,
        ratelimitWindow,
      )
    : false

  if (limit) {
    return createRateLimitResponse(limit)
  }

  const prompt = (instruction || '').trim()
  const initialCode = fragmentCodeText(fragment.code)
  if (!prompt) {
    return new Response('Instruction is required.', { status: 400 })
  }
  if (!initialCode || !fragment.file_path) {
    return new Response('Active project has no source to patch.', { status: 400 })
  }

  const { model: _modelName, apiKey: _modelApiKey, ...modelParams } = config
  const modelClient = getModelClient(model, config)
  const useMorph = Boolean(process.env.MORPH_API_KEY)

  const target = selection
    ? `TARGET ELEMENT — change only this, leave sibling candidates and unrelated UI alone:
- tag: ${selection.tag}
- selector: ${selection.selector}
- id: ${selection.id || '(none)'}
- class: ${selection.className || '(none)'}
- text: ${selection.text || '(none)'}
- html: ${selection.html}
- styles: ${JSON.stringify(selection.styles)}`
    : 'No element selected. Apply the instruction to the most relevant existing UI in this file only.'

  const editShape = useMorph
    ? `Put a Morph-style edit in "edit" using // ... existing code ... for unchanged spans.`
    : `Put the COMPLETE updated file in "edit". Do not use // ... existing code ... markers.`

  const system = `You are a surgical code editor for one file in an already-running project.
Return JSON only. Do not generate a new app. Do not mention other variants or candidates.

{
  "commentary": "What you changed",
  "instruction": "One line description",
  "edit": "The edit payload",
  "file_path": "${fragment.file_path}"
}

${editShape}

Current file: ${fragment.file_path}
${target}

Current code:
\`\`\`
${initialCode}
\`\`\`
`

  try {
    const messages: CoreMessage[] = [{ role: 'user', content: prompt }]
    const result = await generateObject({
      model: modelClient as LanguageModel,
      system,
      messages,
      schema: morphEditSchema,
      maxRetries: 0,
      ...modelParams,
    })

    const edit = result.object
    const code = await mergeEdit({
      filePath: fragment.file_path,
      instruction: edit.instruction || prompt,
      initialCode,
      edit: edit.edit,
    })

    const updated: FragmentSchema = {
      ...fragment,
      file_path: fragment.file_path,
      code,
      commentary: edit.commentary || prompt,
    }

    if (!isValidPatchedFragment(fragment, updated)) {
      return new Response('Patch failed validation.', { status: 422 })
    }

    return Response.json(updated)
  } catch (error: unknown) {
    return handleAPIError(error, { hasOwnApiKey: !!config.apiKey })
  }
}
