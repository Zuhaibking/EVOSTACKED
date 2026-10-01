import { handleAPIError, createRateLimitResponse } from '@/lib/api-errors'
import { Duration } from '@/lib/duration'
import {
  InspectSelection,
  isValidPatchedFragment,
  locateProjectSourceSnippet,
} from '@/lib/inspect'
import { getModelClient, LLMModel, LLMModelConfig } from '@/lib/models'
import { applyPatch } from '@/lib/morph'
import ratelimit from '@/lib/ratelimit'
import { normalizeProjectPath, validateProjectFiles } from '@/lib/project-paths'
import {
  FragmentSchema,
  fragmentSchema,
  fragmentSourceFiles,
  fragmentSourceText,
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
    fragment: currentInput,
    selection,
    instruction,
    targetFile,
    model,
    config,
  }: {
    fragment: FragmentSchema
    selection: InspectSelection | null
    instruction: string
    targetFile?: string
    model: LLMModel
    config: LLMModelConfig
  } = await req.json()

  const parsed = fragmentSchema.safeParse(currentInput)
  if (!parsed.success) return new Response('Active project has invalid source.', { status: 400 })
  const fragment = parsed.data
  let requestedTarget: string | undefined
  const files = fragmentSourceFiles(fragment)
  try {
    validateProjectFiles(files)
    if (targetFile !== undefined) {
      requestedTarget = normalizeProjectPath(targetFile)
      if (!files.some(file => normalizeProjectPath(file.file_path) === requestedTarget)) throw new Error('Selected source file does not exist in this project.')
    }
  } catch (error) { return new Response(error instanceof Error ? error.message : 'Invalid project files.', { status: 400 }) }

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
  if (!prompt) {
    return new Response('Instruction is required.', { status: 400 })
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
    : 'No element selected. Apply the instruction to the most relevant existing source file.'

  const editShape = useMorph
    ? `Put a Morph-style edit in "edit" using // ... existing code ... for unchanged spans.`
    : `Put the COMPLETE updated file in "edit". Do not use // ... existing code ... markers.`

  const hint = locateProjectSourceSnippet(fragment, selection, requestedTarget)
  const sourceTarget = requestedTarget
    ? `You must edit exactly this existing file: ${requestedTarget}.`
    : `Choose the one existing source file that implements the selected element or requested change. Components, styles and data are valid targets. ${hint.filePath ? `Source match suggests ${hint.filePath}; verify against the complete project.` : 'Use the complete project context to find the correct file.'}`

  const system = `You are a surgical code editor for one existing file in an already-running project.
Return JSON only. Do not generate a new app. Do not mention other variants or candidates.
${sourceTarget}
Preserve all unrelated files. Never invent a new file path, move the app into its entry, or overwrite configuration. Keep server and first-client rendering deterministic; restore browser preferences in effects. Keep custom local imports valid within this project.

{
  "commentary": "What you changed",
  "instruction": "One line description",
  "edit": "The edit payload",
  "file_path": "${requestedTarget || 'Choose an existing project source path'}"
}

${editShape}

Project entry: ${fragment.file_path}
${target}

COMPLETE PROJECT SOURCE:
${fragmentSourceText(fragment)}
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
    let editPath: string
    try { editPath = normalizeProjectPath(edit.file_path) }
    catch { return new Response('Patch must target a valid existing source file.', { status: 422 }) }
    const original = files.find(file => normalizeProjectPath(file.file_path) === editPath)
    if (!original || (requestedTarget && editPath !== requestedTarget)) return new Response('Patch must target the selected existing source file.', { status: 422 })
    const code = await mergeEdit({
      filePath: editPath,
      instruction: edit.instruction || prompt,
      initialCode: original.file_content,
      edit: edit.edit,
    })

    const updatedFiles = files.map(file => ({ ...file, file_content: normalizeProjectPath(file.file_path) === editPath ? code : file.file_content }))
    const entryPath = normalizeProjectPath(fragment.file_path)
    const updated: FragmentSchema = {
      ...fragment,
      code: updatedFiles.find(file => normalizeProjectPath(file.file_path) === entryPath)!.file_content,
      ...(fragment.files !== undefined ? { files: updatedFiles.filter(file => normalizeProjectPath(file.file_path) !== entryPath) } : {}),
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
