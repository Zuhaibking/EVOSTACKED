/**
 * Per-template generation guardrails aligned with E2B sandbox start commands.
 * Injected into the system prompt before Product / Premium / Innovate style.
 */
import { getTemplateId, stackLabelForTemplate, type Templates } from '@/lib/templates'

export type TemplateGuardrail = {
  stackLabel: string
  fileStructure: string[]
  installCommand: string
  startCommand: string
  port: number | null
  pitfalls: string[]
  forbidden: string[]
}

const GUARDRAILS: Record<string, TemplateGuardrail> = {
  'nextjs-developer': {
    stackLabel: 'Next.js',
    fileStructure: [
      'Pages Router only: pages/index.tsx is the primary entry (plus extra pages/*.tsx as needed).',
      'Reusable UI under components/, helpers under lib/.',
      'When the plan needs an API, use pages/api/*.ts — do not switch to the App Router.',
      'Optional pages/_app.tsx only if you must wrap a provider.',
    ],
    installCommand:
      'Add extra npm packages via additional_dependencies and install_dependencies_command like `npm install <pkg>`. Never overwrite package.json or lockfiles.',
    startCommand: 'npx next --turbo (sandbox already running on port 3000)',
    port: 3000,
    pitfalls: [
      'Do not create app/layout.tsx or app/page.tsx — this sandbox is Pages Router (`--no-app`).',
      'Use next/router and next/link, not next/navigation.',
      'Next.js <Link> already renders <a>. Never nest <a>, <motion.a>, or another <Link> inside <Link>.',
      'No Date.now() / Math.random() / localStorage during render or useState initializers (hydration).',
      'Keep @import at the top of any CSS file. Do not truncate TSX or leave unclosed tags.',
    ],
    forbidden: [
      'streamlit, gradio, flask, django',
      'Rewriting package.json / next.config to change the bundler',
      'Prisma generate at runtime unless a schema file you generated is present',
    ],
  },
  'vue-developer': {
    stackLabel: 'Vue/Nuxt',
    fileStructure: [
      'Nuxt 3: primary entry app/app.vue; extra routes as app/pages/*.vue.',
      'Reusable pieces under app/components/; composables under app/composables/.',
      'Do not emit Next.js pages/ or React files.',
    ],
    installCommand:
      'Add extra npm packages via additional_dependencies and `npm install <pkg>`. Never overwrite package.json, lockfiles, or nuxt.config.',
    startCommand: 'npm run dev (sandbox already running on port 3000)',
    port: 3000,
    pitfalls: [
      'Use Vue SFCs (.vue), not .tsx React components.',
      'Do not import react / next / @mui.',
      'Keep Tailwind classes in Vue templates; do not add a second CSS framework.',
      'Client-only APIs (window, localStorage) belong in onMounted, not setup top-level.',
    ],
    forbidden: [
      'react, next, pages/index.tsx',
      'streamlit / gradio Python files as the UI',
    ],
  },
  'streamlit-developer': {
    stackLabel: 'Streamlit',
    fileStructure: [
      'Primary file MUST be app.py (Streamlit entry).',
      'Helpers as extra .py modules imported by app.py.',
      'No React/Next/Vue files.',
    ],
    installCommand:
      'Python extras via additional_dependencies (pip packages). Do not overwrite requirements.txt. Prefer libraries already on the template: pandas, numpy, matplotlib, seaborn, plotly, requests.',
    startCommand: 'streamlit run app.py (sandbox already running on port 8501)',
    port: 8501,
    pitfalls: [
      'Use st.set_page_config only once, before other Streamlit calls.',
      'Do not call Streamlit widgets inside cached functions incorrectly.',
      'Avoid blocking input() / Flask / FastAPI servers — the sandbox already serves Streamlit.',
      'Do not write package.json or start a Node server.',
    ],
    forbidden: [
      'next, react, vue, nuxt',
      'gradio.Interface as the main app',
      'Rewriting the process to listen on a different port',
    ],
  },
  'gradio-developer': {
    stackLabel: 'Gradio',
    fileStructure: [
      'Primary file MUST be app.py.',
      'The Blocks/Interface object MUST be named `demo` so `gradio app.py` can launch it.',
      'Helpers as extra .py modules.',
    ],
    installCommand:
      'Python extras via additional_dependencies. Prefer pandas, numpy, matplotlib, seaborn, plotly, requests already installed. Do not overwrite requirements.txt.',
    startCommand: 'gradio app.py (sandbox already running on port 7860)',
    port: 7860,
    pitfalls: [
      'Name the launched app `demo` (not `app` / `iface` unless you also assign demo = ...).',
      'Call demo.launch() only if needed; the sandbox start command already runs Gradio.',
      'Do not mix Streamlit `st.` APIs into this template.',
    ],
    forbidden: [
      'streamlit',
      'next, react, vue',
      'Listening on a port other than 7860',
    ],
  },
  'code-interpreter-v1': {
    stackLabel: 'Python',
    fileStructure: [
      'Primary file MUST be script.py.',
      'Optional helpers as extra .py modules.',
      'This is a data-analysis / notebook-style sandbox, not a web server.',
    ],
    installCommand:
      'Prefer numpy, pandas, matplotlib, seaborn, plotly already installed. Extra pip packages via additional_dependencies only.',
    startCommand: 'Python interpreter (no HTTP port)',
    port: null,
    pitfalls: [
      'Do not build Next.js or Streamlit UIs here.',
      'Print results / save figures instead of starting a web server.',
      'Avoid interactive input() that would hang the interpreter.',
    ],
    forbidden: [
      'flask/django/streamlit/gradio as the primary interface',
      'next, react, vue',
    ],
  },
}

export function guardrailForTemplate(templateId?: string | null): TemplateGuardrail | null {
  if (!templateId) return null
  const base = getTemplateId(templateId)
  return GUARDRAILS[base] || null
}

export function formatOneGuardrail(templateId: string): string {
  const g = guardrailForTemplate(templateId)
  const label = g?.stackLabel || stackLabelForTemplate(templateId)
  if (!g) {
    return `## Stack guardrails (mandatory for this candidate)
Assigned stack: ${label} (\`${templateId}\`). Follow that template's file conventions, port, and install path. Do not switch stacks.
`
  }
  const files = g.fileStructure.map((l) => `- ${l}`).join('\n')
  const pitfalls = g.pitfalls.map((l) => `- ${l}`).join('\n')
  const forbidden = g.forbidden.map((l) => `- ${l}`).join('\n')
  const port =
    g.port == null ? 'none (interpreter)' : String(g.port)
  return `## Stack guardrails (mandatory for this candidate)
Assigned stack: ${label} (\`${templateId}\`). Do not switch to another framework.

### File structure
${files}

### Install
- ${g.installCommand}

### Start / port
- Sandbox start command: ${g.startCommand}
- Port: ${port}

### Common pitfalls
${pitfalls}

### Forbidden
${forbidden}
`
}

/**
 * Guardrails for the candidate's assigned catalog (one template after Auto split).
 * Empty when multiple templates are still listed (caller should assign first).
 */
export function formatTemplateGuardrails(template: Templates): string {
  const ids = Object.keys(template || {})
  if (ids.length !== 1) return ''
  return formatOneGuardrail(ids[0])
}
