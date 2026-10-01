import { handleAPIError, createRateLimitResponse } from '@/lib/api-errors'
import { Duration } from '@/lib/duration'
import { getModelClient, LLMModel, LLMModelConfig } from '@/lib/models'
import { applyPatch } from '@/lib/morph'
import ratelimit from '@/lib/ratelimit'
import { normalizeProjectPath, validateProjectFiles } from '@/lib/project-paths'
import { FragmentSchema, fragmentSchema, fragmentSourceFiles, fragmentSourceText, morphProjectEditSchema } from '@/lib/schema'
import { generateObject, LanguageModel, CoreMessage } from 'ai'

export const maxDuration = 300

const rateLimitMaxRequests = process.env.RATE_LIMIT_MAX_REQUESTS
  ? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS)
  : 10
const ratelimitWindow = process.env.RATE_LIMIT_WINDOW
  ? (process.env.RATE_LIMIT_WINDOW as Duration)
  : '1d'

// System prompt is constructed dynamically below using the current file context

export async function POST(req: Request) {
  const {
    messages,
    model,
    config,
    currentFragment: currentInput,
  }: {
    messages: CoreMessage[]
    model: LLMModel
    config: LLMModelConfig
    currentFragment: FragmentSchema
  } = await req.json()

  const parsed = fragmentSchema.safeParse(currentInput)
  if (!parsed.success) return Response.json({ error: 'Active project source is invalid.' }, { status: 400 })
  const currentFragment = parsed.data
  try { validateProjectFiles(fragmentSourceFiles(currentFragment)) }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid project files.' }, { status: 400 }) }

  // Rate limiting (same as chat route)
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

  const { model: modelNameString, apiKey: modelApiKey, ...modelParams } = config
  const modelClient = getModelClient(model, config)

  try {
    const contextualSystemPrompt = `You are a code editor for an existing project. Return these JSON fields:

{
  "commentary": "Explain what changes you are making",
  "edits": [{
    "instruction": "One line description of this file's change",
    "edit": "Code changes with // ... existing code ... for unchanged spans",
    "file_path": "An entry or supporting file path"
  }]
}

Entry: ${currentFragment.file_path}. Edit the appropriate existing components, data, or styles instead of moving the entire app into the entry page. Include all edits needed across files; untouched files are preserved. A newly added file must contain full working source without existing-code markers. Never overwrite configuration/package/environment files or use absolute/traversal paths. Preserve deterministic server and first-client rendering; browser preferences belong in effects. Every new local import must have a real module in this project or one of your new files.

CURRENT PROJECT SOURCE:
${fragmentSourceText(currentFragment)}
`

    const result = await generateObject({
      model: modelClient as LanguageModel,
      system: contextualSystemPrompt,
      messages,
      schema: morphProjectEditSchema,
      maxRetries: 0,
      ...modelParams,
    })

    const editInstructions = result.object

    const files = new Map(fragmentSourceFiles(currentFragment).map(file => [normalizeProjectPath(file.file_path), file.file_content]))
    const edits = editInstructions.edits.map(edit => ({ ...edit, file_path: normalizeProjectPath(edit.file_path) }))
    if (new Set(edits.map(edit => edit.file_path)).size !== edits.length) throw new Error('Each file must have only one edit.')
    for (const edit of edits) {
      const initialCode = files.get(edit.file_path)
      if (initialCode === undefined) {
        if (!edit.edit.trim() || edit.edit.includes('... existing code ...')) throw new Error('New files require complete source.')
        files.set(edit.file_path, edit.edit)
      } else {
        const merged = await applyPatch({ targetFile: edit.file_path, instructions: edit.instruction, initialCode, codeEdit: edit.edit })
        files.set(edit.file_path, merged.code)
      }
    }
    const entryPath = normalizeProjectPath(currentFragment.file_path)
    const allFiles = [...files].map(([file_path, file_content]) => ({ file_path, file_content }))
    validateProjectFiles(allFiles)
    const supporting = allFiles.filter(file => file.file_path !== entryPath)

    // Return updated fragment in standard format
    const updatedFragment: FragmentSchema = {
      ...currentFragment,
      code: files.get(entryPath)!,
      ...(currentFragment.files !== undefined || supporting.length ? { files: supporting } : {}),
      commentary: editInstructions.commentary,
    }

    // Create a streaming response that matches the AI SDK format
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        const json = JSON.stringify(updatedFragment)
        controller.enqueue(encoder.encode(json))
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    })
  } catch (error: any) {
    return handleAPIError(error, { hasOwnApiKey: !!config.apiKey })
  }
}
