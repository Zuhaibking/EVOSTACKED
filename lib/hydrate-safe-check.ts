import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { sanitizeHydrationFile, sanitizeStateHydration, sanitizeStyleHydration } from './hydrate-safe'

const template = `<style>{\`
  .blend-header-big { font-family: 'Montserrat',sans-serif; }
\`}</style>`
const tFixed = sanitizeStyleHydration(template)
assert.match(tFixed, /dangerouslySetInnerHTML=\{\{ __html:/)
assert.doesNotMatch(tFixed, /<style>\{\`/)
assert.match(tFixed, /font-family: 'Montserrat'/)

const raw = `<div>
      <style>
        html { scroll-behavior: smooth; }
        .blend-header-big { font-family: 'Montserrat',sans-serif; }
      </style>
    </div>`
const rFixed = sanitizeStyleHydration(raw)
assert.match(rFixed, /dangerouslySetInnerHTML/)
assert.doesNotMatch(rFixed, /<style>\s*html/)
assert.equal(rFixed.includes("&#x27;"), false)

const already = `<style dangerouslySetInnerHTML={{ __html: css }} />`
assert.equal(sanitizeStyleHydration(already), already)

const styledJsx = `<style jsx>{\`.x { color: red }\`}</style>`
assert.equal(sanitizeStyleHydration(styledJsx), styledJsx)

const typed = `<style type="text/css">{\`.x { font-family: 'Arial'; }\`}</style>`
assert.match(
  sanitizeStyleHydration(typed),
  /<style type="text\/css" dangerouslySetInnerHTML=\{\{ __html: `/,
)

const none = `export default function Page() { return <main>Hi</main> }`
assert.equal(sanitizeStyleHydration(none), none)

function renderFixture(source: string, browser: boolean) {
  const values: unknown[] = []
  let cursor = 0
  let effects: (() => void)[] = []
  const react = {
    ...React,
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial
      return [values[index], (value: unknown) => { values[index] = value }]
    },
    useEffect(effect: () => void) { effects.push(effect) },
  }
  const storage = { getItem: () => 'dark' }
  const output = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    reportDiagnostics: true,
  })
  assert.equal(output.diagnostics?.length, 0)
  const fixtureModule = { exports: {} as { default: React.ComponentType } }
  const requireFixture = (name: string) => {
    if (name === 'react') return react
    if (name === 'next-themes') return { useTheme: () => ({ theme: browser ? 'dark' : undefined, resolvedTheme: browser ? 'dark' : undefined, setTheme: () => {} }) }
    throw new Error(`Unexpected fixture import: ${name}`)
  }
  new Function('require', 'module', 'exports', 'window', 'localStorage', output.outputText)(requireFixture, fixtureModule, fixtureModule.exports, browser ? { localStorage: storage } : undefined, browser ? storage : undefined)
  return {
    render() {
      cursor = 0
      effects = []
      return renderToStaticMarkup(React.createElement(fixtureModule.exports.default))
    },
    mount() { effects.forEach((effect) => effect()) },
  }
}

const themeFixture = `import React from 'react';
import { useTheme } from 'next-themes';
export default function FreshersParty() {
  const {theme,setTheme}=useTheme();
  return <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀️' : '🌙'}</button>;
}`
const storedFixture = `import React, { useState, useEffect } from 'react';
export default function FreshersParty() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
    return 'light';
  });
  useEffect(() => { /* existing preference persistence */ }, [theme]);
  return <button>{theme === 'dark' ? '☀️' : '🌙'}</button>;
}`
for (const source of [themeFixture, storedFixture]) {
  assert.notEqual(renderFixture(source, false).render(), renderFixture(source, true).render())
  const safe = sanitizeHydrationFile('pages/index.tsx', source)
  const server = renderFixture(safe, false)
  const client = renderFixture(safe, true)
  assert.equal(server.render(), '<button>🌙</button>')
  assert.equal(client.render(), server.render())
  client.mount()
  assert.equal(client.render(), '<button>☀️</button>')
  assert.equal(sanitizeHydrationFile('pages/index.tsx', safe), safe)
  assert.doesNotMatch(safe, /suppressHydrationWarning|ssr:\s*false/)
}
assert.match(sanitizeStateHydration(storedFixture), /existing preference persistence/)
const alias = themeFixture.replace('{theme,setTheme}', '{resolvedTheme: theme,setTheme}')
const aliasClient = renderFixture(sanitizeStateHydration(alias), true)
assert.equal(aliasClient.render(), '<button>🌙</button>')
aliasClient.mount()
assert.equal(aliasClient.render(), '<button>☀️</button>')
const boolean = storedFixture.replace(/theme, setTheme/g, 'isDark, setIsDark').replace(/useState<'light' \| 'dark'>/, 'useState').replace(/return localStorage.getItem\('theme'\) === 'dark' \? 'dark' : 'light'/, "return window.localStorage.getItem('theme') === 'dark'").replace(/return 'light'/, 'return false').replace(/\[theme\]/, '[isDark]').replace(/theme === 'dark'/, 'isDark')
const booleanClient = renderFixture(sanitizeStateHydration(boolean), true)
assert.equal(booleanClient.render(), '<button>🌙</button>')
booleanClient.mount()
assert.equal(booleanClient.render(), '<button>☀️</button>')
const unrelated = `const [count, setCount] = useState(() => localStorage.getItem('count'));`
assert.equal(sanitizeStateHydration(unrelated), unrelated)
const objectTheme = `const [theme, setTheme] = useState(() => JSON.parse(localStorage.getItem('theme') || '{"color":"light"}'));`
assert.equal(sanitizeStateHydration(objectTheme), objectTheme)
const comments = `// const [theme, setTheme] = useState(window.localStorage.getItem('theme') || 'light');\nconst text = "const {theme}=useTheme()";`
assert.equal(sanitizeStateHydration(comments), comments)
assert.equal(sanitizeHydrationFile('app.py', storedFixture), storedFixture)
assert.equal(sanitizeStateHydration("const [theme, setTheme] = useState('light');"), "const [theme, setTheme] = useState('light');")
assert.equal(sanitizeStateHydration('const {theme = "light"} = useTheme();'), 'const {theme = "light"} = useTheme();')
const laterEdit = sanitizeStateHydration(themeFixture) + "\nfunction Other() { const {resolvedTheme} = useTheme(); return resolvedTheme }"
const laterFixed = sanitizeStateHydration(laterEdit)
assert.match(laterFixed, /__evoMounted1/)
assert.equal(laterFixed.match(/import \* as __evoHydrationReact/g)?.length, 1)
assert.equal(sanitizeStateHydration(laterFixed), laterFixed)

console.log('hydrate-safe-check ok')
