import { z } from 'zod'

export const fragmentFileSchema = z.object({
  file_path: z
    .string()
    .describe(
      'Relative path including the file name (e.g. pages/index.tsx, components/Hero.tsx, lib/store.ts, app.py).',
    ),
  file_content: z
    .string()
    .describe(
      'Full contents of this file. Only runnable source — do not wrap in markdown fences.',
    ),
})

export const fragmentSchema = z.object({
  commentary: z
    .string()
    .describe(
      `Briefly state how you are implementing the product plan: type, key screens, and critical interactions. Match depth to complexity.`,
    ),
  template: z
    .string()
    .describe('Name of the template used to generate the application.'),
  title: z.string().describe('Short title of the application. Max 3 words.'),
  description: z
    .string()
    .describe('Short description of the application. Max 1 sentence.'),
  architecture: z
    .string()
    .describe(
      '2–4 sentences on application shape aligned to the plan: modules/pages, state/data approach, and why this complexity fits. Do not invent backend, database, or auth unless the plan requires them.',
    ),
  additional_dependencies: z
    .array(z.string())
    .describe(
      'Additional dependencies required beyond those already in the template. Empty array if none.',
    ),
  has_additional_dependencies: z
    .boolean()
    .describe(
      'True if additional dependencies that are not included in the template are required.',
    ),
  install_dependencies_command: z
    .string()
    .describe(
      'Shell command to install additional_dependencies (e.g. "npm install x y" or "pip install x"). Empty string if none.',
    ),
  port: z
    .number()
    .nullable()
    .describe(
      'Port number used by the running application. Null when no ports are exposed (e.g. code interpreter).',
    ),
  file_path: z
    .string()
    .describe(
      'Primary entry file path. Must match one file_path in code (e.g. pages/index.tsx or app.py). Used as the default file to open and edit.',
    ),
  code: z
    .array(fragmentFileSchema)
    .describe(
      'All source files to write into the sandbox. Complexity must follow the user request: a simple landing page may be 1–3 files; a richer product should split pages, components, hooks/helpers, and optional API routes. Always include at least the primary entry file. Prefer real application structure for the chosen template — not a single disposable HTML blob — unless the template is code-interpreter (then usually one script is enough). Include .env.example only when the app needs configuration.',
    ),
})

export type FragmentSchema = z.infer<typeof fragmentSchema>
export type FragmentFileSchema = z.infer<typeof fragmentFileSchema>

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
  file_path: z
    .string()
    .describe(
      'Path of the file being edited. Must be one of the existing project files unless you are intentionally adding a new file.',
    ),
})

export type MorphEditSchema = z.infer<typeof morphEditSchema>
