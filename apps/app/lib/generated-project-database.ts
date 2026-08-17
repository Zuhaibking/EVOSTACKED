/**
 * Inspect generated project files for database artifacts.
 * Never reads or mutates EvoStack's own Prisma/Postgres.
 */
import {
  getFragmentFiles,
  type FragmentFile,
} from '@/lib/fragment'

const DB_PATH =
  /(?:^|\/)(prisma\/schema\.prisma|drizzle(\.|\/)|migrations?\/|schema\.sql)$/i

const DB_CONTENT =
  /\b(DATABASE_URL|PrismaClient|prisma\.\w+\.|drizzle(-orm)?|mongoose|TypeORM|DataSource|sequelize|sqlalchemy|createClient\s*\([^)]*supabase|new\s+Pool\s*\(|pg\.Pool|from\s+['"]pg['"]|mongodb(\+srv)?:\/\/)\b/i

export type GeneratedProjectDatabase = {
  configured: boolean
  files: FragmentFile[]
  models: string[]
}

function prismaModels(content: string): string[] {
  const names: string[] = []
  const re = /^\s*model\s+([A-Za-z_][A-Za-z0-9_]*)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) {
    names.push(m[1])
  }
  return names
}

export function inspectGeneratedProjectDatabase(
  fragment: Parameters<typeof getFragmentFiles>[0],
): GeneratedProjectDatabase {
  const files = getFragmentFiles(fragment)
  const matched: FragmentFile[] = []
  const models: string[] = []

  for (const file of files) {
    const path = file.file_path.replace(/\\/g, '/')
    const byPath = DB_PATH.test(path)
    const byContent = DB_CONTENT.test(file.file_content)
    if (byPath || byContent) {
      matched.push(file)
      if (/prisma\/schema\.prisma$/i.test(path)) {
        models.push(...prismaModels(file.file_content))
      }
    }
  }

  return {
    configured: matched.length > 0,
    files: matched,
    models: [...new Set(models)],
  }
}
