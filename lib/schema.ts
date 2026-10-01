import { z } from 'zod'
import { validateProjectFiles } from './project-paths'

export const fragmentFileSchema = z.object({
  file_path: z.string().min(1).describe('Project-relative supporting source path, e.g. components/Hero.tsx, data/site.ts, or styles/Home.module.css. Never repeat the entry path or overwrite template configuration.'),
  file_content: z.string().min(1).describe('Complete, working source of this supporting file. Include real implementation or data, never an empty module, placeholder component, or omitted-code marker.'),
})
export type FragmentFile = z.infer<typeof fragmentFileSchema>

export const fragmentSchema = z.object({
  commentary: z
    .string()
    .describe(
      `Describe what you're about to do and the steps you want to take for generating the fragment in great detail.`,
    ),
  template: z
    .string()
    .describe('Name of the template used to generate the fragment.'),
  // template_ready: z.boolean().describe('Detect if finished identifying the template.'),
  title: z.string().describe('Short title of the fragment. Max 3 words.'),
  description: z
    .string()
    .describe('Short description of the fragment. Max 1 sentence.'),
  additional_dependencies: z
    .array(z.string())
    .describe(
      'Additional npm/pip packages required by the fragment (e.g. framer-motion). Always list every import that is not already in the template. Do not include react, next, or @/ modules.',
    ),
  has_additional_dependencies: z
    .boolean()
    .describe(
      'Detect if additional dependencies that are not included in the template are required by the fragment.',
    ),
  install_dependencies_command: z
    .string()
    .describe(
      'Command to install additional dependencies required by the fragment.',
    ),
  // install_dependencies_ready: z.boolean().describe('Detect if finished identifying additional dependencies.'),
  port: z
    .number()
    .nullable()
    .describe(
      'Port number used by the resulted fragment. Null when no ports are exposed.',
    ),
  file_path: z
    .string()
    .describe(
      'The template entry path (e.g. pages/index.tsx). Its complete source belongs in code; additional project source belongs in files.',
    ),
  code: z
    .string()
    .describe(
      'Complete entry source. For web projects keep this page focused on composing real components imported from files. Include every imported local module in files unless it already exists in the template. Put reusable UI in components/, content and mock datasets in data/ or lib/, and custom styles in CSS modules when needed. Relative imports are allowed when their targets are included. If using framer-motion/motion, never combine spring or inertia with 3+ keyframe arrays; use a single target or type: "tween". For real photographs use evo-image://<specific query>, never invented remote URLs or placeholder services. Next.js: prefer CSS modules; for inline style tags use dangerouslySetInnerHTML. The server and FIRST client render must be identical. Initialize theme/UI state with deterministic literals; use browser APIs, dates, and randomness only in useEffect or event handlers. Gate useTheme/resolvedTheme-dependent icons on a mounted flag. Never suppressHydrationWarning or disable SSR to hide a mismatch.',
    ),
  files: z.array(fragmentFileSchema).optional().describe('Supporting source files only. New web projects must include at least two meaningful supporting files: a real reusable component and content/data, a helper, or a stylesheet. Entry source stays in code. Preserve all unchanged files during edits. Python scripts may use an empty array.'),
})

export type FragmentSchema = z.infer<typeof fragmentSchema>

// A plain object schema converts reliably to provider JSON schemas. Conditional
// web-project checks run after generation; legacy saved projects use fragmentSchema.
export const generatedFragmentSchema = fragmentSchema.extend({
  files: z.array(fragmentFileSchema).describe('Required generated project source bundle. Web: at least two useful supporting files, including a real component plus data/helper/styles; every custom local import must resolve. Python may return []. Never duplicate the entry path.'),
})

export function assertGeneratedFragment(value: unknown): FragmentSchema {
  const fragment = generatedFragmentSchema.parse(value)
  validateProjectFiles(fragmentSourceFiles(fragment))
  const python = /\.py$/i.test(fragment.file_path) || /^(code-interpreter|streamlit|gradio)/.test(fragment.template)
  if (!fragment.code.trim()) throw new Error('Generated project entry is empty.')
  if (!python && fragment.files.length < 2) throw new Error('Web projects require a real component and supporting data, helpers, or styles.')
  if (!python && !fragment.files.some(file => /(?:^|\/)components\/.+\.(?:tsx|jsx|ts|js|vue)$/i.test(file.file_path))) {
    throw new Error('Web projects require a reusable component in components/.')
  }
  for (const file of fragment.files) {
    const source = file.file_content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').trim()
    if (!source || /^export\s*\{\s*\}\s*;?$/.test(source) || /\.\.\. existing code \.\.\./.test(source)) {
      throw new Error(`Generated supporting file ${file.file_path} must contain complete implementation.`)
    }
  }
  return fragment
}

type SourceFragment = { template?: string; file_path?: string; code?: unknown; files?: unknown }

/** Pure source enumeration; legacy array-code payloads remain readable by clients. */
export function fragmentSourceFiles(fragment: SourceFragment | null | undefined): FragmentFile[] {
  if (!fragment) return []
  const path = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '')
  const read = (value: unknown): FragmentFile[] => !Array.isArray(value) ? [] : value.flatMap(file => {
    if (!file || typeof file !== 'object') return []
    const record = file as Record<string, unknown>
    const filePath = record.file_path ?? record.file_name
    const content = record.file_content ?? record.content
    return typeof filePath === 'string' && typeof content === 'string' ? [{ file_path: path(filePath), file_content: content }] : []
  })
  const entry = typeof fragment.code === 'string'
    ? [{ file_path: path(fragment.file_path || 'pages/index.tsx'), file_content: fragment.code }]
    : read(fragment.code)
  return [...entry, ...read(fragment.files)]
}

/** Path labels keep edit/judge context unambiguous without dropping supporting source. */
export function fragmentSourceText(fragment: SourceFragment | null | undefined): string {
  return fragmentSourceFiles(fragment).map(file => `FILE: ${file.file_path}\n${file.file_content}`).join('\n\n')
}

/** Source equality includes every supporting file and ignores only array order. */
export function sameFragmentSource(first: SourceFragment | null | undefined, second: SourceFragment | null | undefined): boolean {
  if (!first || !second) return first === second
  const sorted = (fragment: SourceFragment) => fragmentSourceFiles(fragment).map(file => [file.file_path, file.file_content]).sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
  return first.template === second.template && first.file_path === second.file_path && JSON.stringify(sorted(first)) === JSON.stringify(sorted(second))
}

/** streamObject partials and legacy multi-file payloads can emit non-string `code`. */
export function fragmentCodeText(code: unknown): string {
  if (typeof code === 'string') return code
  if (Array.isArray(code)) {
    return code
      .map((f) => {
        if (typeof f === 'string') return f
        if (f && typeof f === 'object' && 'file_content' in f) {
          const content = (f as { file_content?: unknown }).file_content
          return typeof content === 'string' ? content : ''
        }
        return ''
      })
      .join('\n')
  }
  return ''
}

// Schema for morph edit instructions
export const morphEditSchema = z.object({
  commentary: z
    .string()
    .describe('Explain what changes you are making and why'),
  instruction: z
    .string()
    .describe('One line instruction on what the change is'),
  edit: z
    .string()
    .describe(
      "You should make it clear what the edit is, while also minimizing the unchanged code you write. When writing the edit, you should specify each edit in sequence, with the special comment // ... existing code ... to represent unchanged code in between edited lines. For example: // ... existing code ... FIRST_EDIT // ... existing code ... SECOND_EDIT // ... existing code ... THIRD_EDIT // ... existing code ... Be Lazy when outputting code, rely heavily on the exisitng code comments, but each edit should contain minimally sufficient context of unchanged lines around the code you're editing to resolve ambiguity. DO NOT omit spans of pre-existing code (or comments) without using the // ... existing code ... comment to indicate its absence. If you omit the existing code comment, the model may inadvertently delete these lines. If you plan on deleting a section, you must provide context before and after to delete it. If the initial code is ```code \\n Block 1 \\n Block 2 \\n Block 3 \\n code```, and you want to remove Block 2, you would output ```// ... existing code ... \\n Block 1 \\n  Block 3 \\n // ... existing code ...```. ",
    ),
  file_path: z.string().describe('Path to the file being edited'),
})

export type MorphEditSchema = z.infer<typeof morphEditSchema>

export const morphProjectEditSchema = z.object({
  commentary: morphEditSchema.shape.commentary,
  edits: z.array(z.object({
    file_path: morphEditSchema.shape.file_path,
    instruction: morphEditSchema.shape.instruction,
    edit: morphEditSchema.shape.edit,
  })).min(1).describe('Edits to the entry or supporting files. Include every file needed for the requested change. Existing files use Morph patches; new files must contain full source. Preserve untouched files.'),
})
