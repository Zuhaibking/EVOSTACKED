import { handleAPIError, createRateLimitResponse } from '@/lib/api-errors'
import { Duration } from '@/lib/duration'
import {
  applyFileUpdate,
  getFragmentFiles,
  getPrimaryFile,
} from '@/lib/fragment'
import { getModelClient, LLMModel, LLMModelConfig } from '@/lib/models'
import { applyPatch } from '@/lib/morph'
import { prepareFragmentIntegrity } from '@/lib/prepare-fragment-integrity'
import ratelimit from '@/lib/ratelimit'
import { FragmentSchema, morphEditSchema } from '@/lib/schema'
import { generateObject, LanguageModel, CoreMessage } from 'ai'

export const maxDuration = 300

const rateLimitMaxRequests = process.env.RATE_LIMIT_MAX_REQUESTS
  ? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS)
  : 10
const ratelimitWindow = process.env.RATE_LIMIT_WINDOW
  ? (process.env.RATE_LIMIT_WINDOW as Duration)
  : '1d'

export async function handleMorph(req: Request) {
  const {
    messages,
    model,
    config,
    currentFragment,
  }: {
    messages: CoreMessage[]
    model: LLMModel
    config: LLMModelConfig
    currentFragment: FragmentSchema
  } = (await req.json()) as {
    messages: CoreMessage[]
    model: LLMModel
    config: LLMModelConfig
    currentFragment: FragmentSchema
  }

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

  const { model: _modelNameString, apiKey: _modelApiKey, ...modelParams } =
    config

  try {
    const modelClient = getModelClient(model, config)
    const files = getFragmentFiles(currentFragment)
    const primary = getPrimaryFile(currentFragment)
    const fileTree = files.map((f) => `- ${f.file_path}`).join('\n')
    // Cap per-file context so multi-file projects fit the editor prompt.
    const filesContext = files
      .map((f) => {
        const content =
          f.file_content.length > 6000
            ? `${f.file_content.slice(0, 6000)}\n/* … truncated … */`
            : f.file_content
        return `### ${f.file_path}\n\`\`\`\n${content}\n\`\`\``
      })
      .join('\n\n')

    const contextualSystemPrompt = `You are a code editor for a multi-file application. Generate a JSON response with exactly these fields:

{
  "commentary": "Explain what changes you are making",
  "instruction": "One line description of the change",
  "edit": "The code changes with // ... existing code ... for unchanged parts",
  "file_path": "path of the file to edit"
}

Project files:
${fileTree || '(none)'}

Primary entry: ${primary?.file_path ?? currentFragment.file_path}

Current project source:
${filesContext}

Edit the single file that best implements the user's request. Prefer modifying an existing path from the list. You may target a new file_path only when a new module is clearly required.
`

    const result = await generateObject({
      model: modelClient as LanguageModel,
      system: contextualSystemPrompt,
      messages,
      schema: morphEditSchema,
      maxRetries: 0,
      ...modelParams,
    })

    const editInstructions = result.object
    const targetPath = editInstructions.file_path || primary?.file_path
    if (!targetPath) {
      throw new Error('No target file_path for morph edit')
    }

    const existing =
      files.find((f) => f.file_path === targetPath)?.file_content ?? ''

    const morphResult = await applyPatch({
      targetFile: targetPath,
      instructions: editInstructions.instruction,
      initialCode: existing,
      codeEdit: editInstructions.edit,
    })

    const updatedFragment: FragmentSchema = {
      ...currentFragment,
      architecture:
        currentFragment.architecture ||
        'Existing application; incremental edit applied.',
      file_path: targetPath,
      code: applyFileUpdate(currentFragment, targetPath, morphResult.code),
      commentary: editInstructions.commentary,
    }

    // validate → targeted integrity repair (max 1, only if invalid) → re-validate
    // Valid fragments: zero extra LLM calls.
    const prepared = await prepareFragmentIntegrity({
      fragment: updatedFragment,
      repair: { model, config },
    })

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        const json = JSON.stringify(prepared.fragment)
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
