import { readFileSync } from 'fs'
import { join } from 'path'

export const INSPECT_BRIDGE_FILENAME = '__evo_inspect.js'
/** Same-origin data-bridge config the bridge fetches on load (see POST /api/p/{id}/connect). */
export const PLATFORM_CONFIG_FILENAME = '__evo_platform.json'
/** Served until the project is connected, so unconnected sites never log a 404 on load. */
const PLATFORM_CONFIG_PLACEHOLDER = '{"connected":false}\n'

const NEXT_DOCUMENT = `import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <script src="/${INSPECT_BRIDGE_FILENAME}" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
`

const NUXT_PLUGIN = `export default defineNuxtPlugin(() => {
  if (typeof document === 'undefined') return
  if (document.querySelector('script[data-evo-inspect]')) return
  const s = document.createElement('script')
  s.src = '/${INSPECT_BRIDGE_FILENAME}'
  s.defer = true
  s.setAttribute('data-evo-inspect', '1')
  document.head.appendChild(s)
})
`

export function inspectBridgeSource(): string {
  return readFileSync(join(process.cwd(), 'lib/inspect-bridge-script.js'), 'utf8')
}

type SandboxFiles = {
  files: {
    write: (path: string, content: string) => Promise<unknown>
    read: (path: string) => Promise<string>
  }
}

async function tryRead(sbx: SandboxFiles, path: string): Promise<string | null> {
  try {
    return String(await sbx.files.read(path))
  } catch {
    return null
  }
}

async function ensureScriptTag(sbx: SandboxFiles, path: string) {
  const cur = await tryRead(sbx, path)
  if (cur == null) return false
  if (cur.includes(INSPECT_BRIDGE_FILENAME)) {
    const synchronous = cur.replace(
      /<script\b[^>]*__evo_inspect\.js[^>]*>/g,
      (tag) => tag.replace(/\s+(?:defer|async)(?:=\{?(?:true|false)\}?|=['"][^'"]*['"])?/g, ''),
    )
    if (synchronous !== cur) await sbx.files.write(path, synchronous)
    return true
  }
  if (/<Head[\s>]/.test(cur) && !cur.includes(INSPECT_BRIDGE_FILENAME)) {
    await sbx.files.write(
      path,
      cur.replace(
        /<Head([^>]*)>/,
        `<Head$1>\n        <script src="/${INSPECT_BRIDGE_FILENAME}" />`,
      ),
    )
    return true
  }
  return true
}

/** Connect a sandboxed site to its project backend: the bridge picks this up on load / next submit. */
export async function writePlatformConfig(sbx: SandboxFiles, config: unknown) {
  await sbx.files.write(`public/${PLATFORM_CONFIG_FILENAME}`, `${JSON.stringify(config, null, 2)}\n`)
}

export async function injectInspectBridge(sbx: SandboxFiles) {
  const js = inspectBridgeSource()
  if (await tryRead(sbx, `public/${INSPECT_BRIDGE_FILENAME}`) !== js) {
    await sbx.files.write(`public/${INSPECT_BRIDGE_FILENAME}`, js)
  }
  if (await tryRead(sbx, `public/${PLATFORM_CONFIG_FILENAME}`) == null) {
    try {
      await sbx.files.write(`public/${PLATFORM_CONFIG_FILENAME}`, PLATFORM_CONFIG_PLACEHOLDER)
    } catch {
      // the placeholder only silences a 404; the bridge works without it
    }
  }

  const nextDoc =
    (await tryRead(sbx, 'pages/_document.tsx')) ??
    (await tryRead(sbx, 'pages/_document.jsx'))
  if (nextDoc == null) {
    try {
      await sbx.files.write('pages/_document.tsx', NEXT_DOCUMENT)
    } catch {
      // not a Next pages app
    }
  } else {
    await ensureScriptTag(sbx, 'pages/_document.tsx')
    await ensureScriptTag(sbx, 'pages/_document.jsx')
  }

  const plugin = await tryRead(sbx, 'plugins/evo-inspect.client.ts')
  if (plugin == null) {
    try {
      await sbx.files.write('plugins/evo-inspect.client.ts', NUXT_PLUGIN)
    } catch {
      // not Nuxt
    }
  }
}
