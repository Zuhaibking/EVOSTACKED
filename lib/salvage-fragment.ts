import { fragmentCodeText, type FragmentSchema } from './schema'

/** Below this, a streamed partial is a stub, not a site. */
const MIN_CODE = 60

export function coercePort(value: unknown): number | null {
  if (value == null || value === '') return 3000
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return 3000
}

export function coerceDeps(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return []
}

export function looksUsableCode(code: unknown): boolean {
  const t = fragmentCodeText(code).trim()
  if (t.length < MIN_CODE) return false
  if (/^<!doctype html/i.test(t) || /^<html[\s>]/i.test(t)) return t.length >= 80
  if (
    /export\s+default/.test(t) ||
    /function\s+[A-Z]/.test(t) ||
    /import streamlit|import gradio/.test(t)
  ) {
    return true
  }
  return t.length >= 200
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function defaultFile(template: string): string {
  if (template.includes('vue')) return 'app/app.vue'
  if (template.includes('streamlit') || template.includes('gradio')) return 'app.py'
  return 'pages/index.tsx'
}

/**
 * Turn a streamObject partial / failed Zod final into a usable fragment.
 * Does not invent site content — only fills required metadata defaults.
 */
export function salvageFragment(partial: unknown): FragmentSchema | null {
  if (!partial || typeof partial !== 'object') return null
  const p = partial as Record<string, unknown>
  const code = fragmentCodeText(p.code)
  if (!looksUsableCode(code)) return null
  const deps = coerceDeps(p.additional_dependencies)
  const template = asString(p.template) || 'nextjs-developer'
  return {
    commentary: asString(p.commentary),
    template,
    title: asString(p.title) || 'Generated',
    description: asString(p.description),
    additional_dependencies: deps,
    has_additional_dependencies:
      p.has_additional_dependencies === true ||
      p.has_additional_dependencies === 'true' ||
      deps.length > 0,
    install_dependencies_command: asString(p.install_dependencies_command),
    port: coercePort(p.port),
    file_path: asString(p.file_path) || defaultFile(template),
    code,
  }
}

export function isTransientProviderError(error: unknown): boolean {
  const err = error as { message?: string; name?: string; statusCode?: number; status?: number }
  const status = Number(err?.statusCode || err?.status || 0)
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 529) {
    return true
  }
  const msg = String(err?.message || error || '').toLowerCase()
  if (err?.name === 'AbortError' || msg.includes('aborted') || msg.includes('timed out')) {
    return false
  }
  return (
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('econnrefused') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('overloaded') ||
    msg.includes('temporarily unavailable')
  )
}
