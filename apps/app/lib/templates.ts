export function getTemplateIdSuffix(id: string) {
  const isDev = process.env.NODE_ENV === 'development'
  return isDev ? `${id}-dev` : id
}

export function getTemplateId(id: string) {
  return id.replace(/-dev$/, '')
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
      'Python data analysis / notebook-style execution. Prefer one primary script.py unless helpers clearly help. Strong analysis and visualisation angle.',
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
      'Next.js 13+ Pages Router app with Tailwind/shadcn already available. Split into pages/, components/, and lib/ as the request warrants. When the shared plan requires a backend/database/auth, add pages/api/ (or server modules), a clear data layer under lib/db or similar, and auth helpers — still do NOT overwrite package.json/lockfiles; add packages only via additional_dependencies. When the plan is frontend-only, keep it lean (no Prisma/DB/auth). Hot-reloads automatically. Primary entry is usually pages/index.tsx; add more pages under pages/ when needed.',
    port: 3000,
  },
  [getTemplateIdSuffix('vue-developer')]: {
    name: 'Vue.js developer',
    lib: ['vue@latest', 'nuxt@3.13.0', 'tailwindcss'],
    file: 'app/app.vue',
    instructions:
      'Nuxt 3 / Vue 3 app with Tailwind. Use app/ structure; split components and composables when the request warrants. Prefer this template only when the user asks for Vue/Nuxt. Hot-reloads automatically.',
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
      'Streamlit app (primary app.py). Split helpers into extra .py modules when the app grows beyond a simple page. Reloads automatically.',
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
      'Gradio app. Blocks/Interface must be named demo. Primary file app.py; split helpers into modules when useful.',
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
