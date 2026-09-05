import { WrittenFile } from './fragment-files'

const CODE = /\.(tsx?|jsx?)$/i
const LIST_FN = 'map|reduce|filter|forEach|find'

/** Idempotent first-paint guards. Does not invent UI or site-specific code. */
export function repairGeneratedSource(code: string): string {
  let next = code
  next = next.replace(
    /(?<![.\w$])([A-Za-z_$][\w$]*(?:\?\.[A-Za-z_$][\w$]*|\.[A-Za-z_$][\w$]*)*)\.toFixed\(/g,
    (_m, recv: string) => `Number(${recv} ?? 0).toFixed(`,
  )
  next = next.replace(
    /(\?\.[A-Za-z_$][\w$]*)\.(map|reduce|filter|forEach|find)\(/g,
    '$1?.$2(',
  )
  next = next.replace(
    new RegExp(`(?<![.\\w$?])([A-Za-z_$][\\w$]*)\\.(${LIST_FN})\\(`, 'g'),
    (m, ident: string, fn: string) => {
      if (ident === 'this' || ident === 'super') return m
      return `(${ident} ?? []).${fn}(`
    },
  )
  next = next.replace(
    /useContext\(\s*([A-Za-z_$][\w$]*)\s*\)(?!\s*\?\?)/g,
    'useContext($1) ?? {}',
  )
  next = next.replace(
    /=\s*(use[A-Z][\w$]*\(\s*\))\s*;/g,
    '= $1 ?? {};',
  )
  next = wrapMissingProviders(next)
  return next
}

function wrapMissingProviders(code: string): string {
  if (code.includes('/* evo:providers */')) return code
  const exported = code.match(/export default function ([A-Za-z_$][\w$]*)/)
  if (!exported) return code
  const name = exported[1]
  const providers = [
    ...new Set(
      [...code.matchAll(/function\s+([A-Z][\w$]*Provider)\s*\(/g)].map((m) => m[1]),
    ),
  ].filter((p) => p !== name)
  if (!providers.length) return code
  const inner = providers.reduceRight(
    (acc, p) => `<${p}>${acc}</${p}>`,
    `<${name} {...props} />`,
  )
  return `${code.replace(/export default function /, 'function ')}\n/* evo:providers */\nexport default function Page(props) {\n  return (${inner})\n}\n`
}

export function repairGeneratedFiles(files: WrittenFile[]): WrittenFile[] {
  return files.map((f) =>
    CODE.test(f.file_path)
      ? { ...f, file_content: repairGeneratedSource(f.file_content) }
      : f,
  )
}

export function parseNextError(html: string): string | undefined {
  try {
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
    if (m) {
      const data = JSON.parse(m[1]) as { err?: { message?: string } }
      if (typeof data?.err?.message === 'string' && data.err.message) {
        return data.err.message
      }
    }
  } catch {
    /* ignore */
  }
  const t = html.match(/Cannot read properties of [^<"\\]+/)
  return t?.[0]
}
