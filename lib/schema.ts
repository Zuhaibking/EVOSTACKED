import { z } from 'zod'

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
      'Additional dependencies required by the fragment. Do not include dependencies that are already included in the template.',
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
      'The template entry file to write (e.g. pages/index.tsx). Do not invent other paths.',
    ),
  code: z
    .string()
    .describe(
      'Full source of that single file. Must compile as-is. Inline all mock data, components, and helpers in this string. Do not import from relative paths such as ../data/data or ./foo — those files are never written. Allowed imports: react, next/*, and @/components/ui/*. First paint must not call methods on null or undefined (empty selection, empty list). Guard .toFixed, .map, and .reduce.',
    ),
  // code: z.array(z.object({
  //   file_name: z.string().describe('Name of the file.'),
  //   file_path: z.string().describe('Relative path to the file, including the file name.'),
  //   file_content: z.string().describe('Content of the file.'),
  //   file_finished: z.boolean().describe('Detect if finished generating the file.'),
  // })),
  // code_finished: z.boolean().describe('Detect if finished generating the code.'),
  // error: z.string().optional().describe('Error message if the fragment is not valid.'),
})

export type FragmentSchema = z.infer<typeof fragmentSchema>

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
