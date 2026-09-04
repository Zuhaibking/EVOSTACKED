export function getTemplateIdSuffix(id: string) {
  const isDev = process.env.NODE_ENV === 'development'
  return isDev ? `${id}-dev` : id
}

export function getTemplateId(id: string) {
  return id.replace(/-dev$/, '')
}

const SANDBOX_TEMPLATES = [
  'code-interpreter-v1',
  'nextjs-developer',
  'vue-developer',
  'streamlit-developer',
  'gradio-developer',
] as const

/** Map model-invented template names onto a real E2B template. */
export function resolveSandboxTemplate(
  id: string | undefined,
  filePath?: string,
): string {
  const stripped = getTemplateId((id || '').trim())
  if ((SANDBOX_TEMPLATES as readonly string[]).includes(stripped)) return stripped
  const lower = `${id || ''} ${filePath || ''}`.toLowerCase()
  if (lower.includes('vue') || lower.includes('nuxt')) return 'vue-developer'
  if (lower.includes('streamlit')) return 'streamlit-developer'
  if (lower.includes('gradio')) return 'gradio-developer'
  if (
    lower.includes('interpreter') ||
    lower.includes('jupyter') ||
    lower.includes('analyst')
  ) {
    return 'code-interpreter-v1'
  }
  if (filePath?.endsWith('.py')) return 'streamlit-developer'
  return 'nextjs-developer'
}

export function resolveSandboxPort(templateId: string): number {
  if (templateId === 'streamlit-developer') return 8501
  if (templateId === 'gradio-developer') return 7860
  return 3000
}

export function isStaticHtml(fragment: {
  file_path?: string
  code?: unknown
  template?: string
}): boolean {
  const path = (fragment.file_path || '').toLowerCase()
  if (path.endsWith('.html') || path.endsWith('.htm')) return true
  const code = typeof fragment.code === 'string' ? fragment.code.trimStart() : ''
  if (/^<!doctype html/i.test(code) || /^<html[\s>]/i.test(code)) return true
  const t = (fragment.template || '').toLowerCase()
  return t.includes('html') && !t.includes('next') && !t.includes('vue')
}

const templates = {
  'code-interpreter-v1': {
    name: 'Python data analyst',
    lib: [
      'python',
      'jupyter',
      'numpy',
      'pandas',
      'matplotlib',
      'seaborn',
      'plotly',
    ],
    file: 'script.py',
    instructions:
      'Runs code as a Jupyter notebook cell. Strong data analysis angle. Can use complex visualisation to explain results.',
    port: null,
  },
  [getTemplateIdSuffix('nextjs-developer')]: {
    name: 'Next.js developer',
    lib: [
      'nextjs@14.2.5',
      'typescript',
      '@types/node',
      '@types/react',
      '@types/react-dom',
      'postcss',
      'tailwindcss',
      'shadcn',
    ],
    file: 'pages/index.tsx',
    instructions:
      'A Next.js 13+ app that reloads automatically. Using the pages router. Write only pages/index.tsx. Inline all UI and mock data in that file. Do not import local files you did not write.',
    port: 3000,
  },
  [getTemplateIdSuffix('vue-developer')]: {
    name: 'Vue.js developer',
    lib: ['vue@latest', 'nuxt@3.13.0', 'tailwindcss'],
    file: 'app/app.vue',
    instructions:
      'A Vue.js 3+ app that reloads automatically. Only when asked specifically for a Vue app. Write only app/app.vue. Inline all UI and mock data in that file.',
    port: 3000,
  },
  [getTemplateIdSuffix('streamlit-developer')]: {
    name: 'Streamlit developer',
    lib: [
      'streamlit',
      'pandas',
      'numpy',
      'matplotlib',
      'requests',
      'seaborn',
      'plotly',
    ],
    file: 'app.py',
    instructions:
      'A streamlit app that reloads automatically. Keep the app in this one file. Do not import local modules you did not write.',
    port: 8501,
  },
  [getTemplateIdSuffix('gradio-developer')]: {
    name: 'Gradio developer',
    lib: [
      'gradio',
      'pandas',
      'numpy',
      'matplotlib',
      'requests',
      'seaborn',
      'plotly',
    ],
    file: 'app.py',
    instructions:
      'A gradio app. Gradio Blocks/Interface should be called demo. Keep the app in this one file. Do not import local modules you did not write.',
    port: 7860,
  },
}

export type Templates = typeof templates
export default templates

export function templatesToPrompt(templates: Templates) {
  return `${Object.entries(templates)
    .map(
      ([id, t], index) =>
        `${index + 1}. ${id}: "${t.instructions}". File: ${t.file || 'none'}. Dependencies installed: ${t.lib.join(', ')}. Port: ${t.port || 'none'}.`,
    )
    .join('\n')}`
}
