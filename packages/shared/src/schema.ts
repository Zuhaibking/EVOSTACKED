import { z } from 'zod'

export const fragmentFileSchema = z.object({
  file_path: z.string(),
  file_content: z.string(),
})

export const fragmentSchema = z.object({
  commentary: z.string(),
  template: z.string(),
  title: z.string(),
  description: z.string(),
  architecture: z.string(),
  additional_dependencies: z.array(z.string()),
  has_additional_dependencies: z.boolean(),
  install_dependencies_command: z.string(),
  port: z.number().nullable(),
  file_path: z.string(),
  code: z.array(fragmentFileSchema),
})

export type FragmentSchema = z.infer<typeof fragmentSchema>
export type FragmentFileSchema = z.infer<typeof fragmentFileSchema>

export const morphEditSchema = z.object({
  commentary: z.string(),
  instruction: z.string(),
  edit: z.string(),
  file_path: z.string(),
})

export type MorphEditSchema = z.infer<typeof morphEditSchema>
