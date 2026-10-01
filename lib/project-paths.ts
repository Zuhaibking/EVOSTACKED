/** Source paths are relative to the hosted template and cannot replace its configuration. */
const CONFIG_FILE = /^(?:package\.json|(?:package-lock|npm-shrinkwrap)\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|(?:ts|js)config(?:\.[\w-]+)?\.json|next-env\.d\.ts|components\.json|(?:next|nuxt|vite|tailwind|postcss|webpack|babel|eslint|prettier)\.config\.[\w.]+)$/i

export function normalizeProjectPath(path: string): string {
  if (typeof path !== 'string' || !path || path.length > 240 || /[\x00-\x1f\x7f:%]/.test(path)) throw new Error('Invalid project file path.')
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '')
  const parts = normalized.split('/')
  if (parts.some(part => !part || part === '..' || part.startsWith('.') || !/^[\w@()[\] -]+(?:\.[\w-]+)*$/.test(part))) throw new Error('Project files must use safe relative paths.')
  if (parts.some(part => /^(?:node_modules|__pycache__)$/i.test(part)) || CONFIG_FILE.test(parts.at(-1)!)) throw new Error('Generated source cannot overwrite template configuration.')
  if (/^(?:public\/evo-images(?:\/|$)|public\/__evo_inspect\.js$|plugins\/evo-inspect\.client\.ts$)/.test(normalized)) throw new Error('Generated source cannot overwrite preview assets.')
  return normalized
}

export function validateProjectFiles(files: { file_path: string; file_content: string }[]): void {
  if (!files.length || files.length > 80) throw new Error('A project must contain 1–80 source files.')
  const paths = new Set<string>()
  for (const file of files) {
    const path = normalizeProjectPath(file.file_path)
    if (typeof file.file_content !== 'string' || !file.file_content.trim()) throw new Error('Project source files cannot be empty.')
    if (paths.has(path)) throw new Error('Project source paths must be unique.')
    paths.add(path)
  }
  for (const path of paths) {
    if ([...paths].some(other => other !== path && other.startsWith(`${path}/`))) throw new Error('Project files cannot overwrite a source folder.')
  }
}
