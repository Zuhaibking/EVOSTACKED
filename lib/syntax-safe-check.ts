import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fragmentFiles } from './fragment-files'
import { repairSyntax, sanitizeSyntaxFile } from './syntax-safe'

const require = createRequire(import.meta.url)
const { transformSync } = require('next/dist/build/swc/index.js') as {
  transformSync: (code: string, opts: object) => unknown
}

function parses(src: string) {
  transformSync(src, {
    filename: 'pages/index.tsx',
    jsc: {
      parser: { syntax: 'typescript', tsx: true, dynamicImport: true },
      target: 'es2017',
    },
  })
}

const broken = `const rootCss = \`
body { color: red; }
";
export default function Page() { return <div /> }
`
const fixed = sanitizeSyntaxFile('pages/index.tsx', broken)
assert.match(fixed, /`;\nexport default/)
assert.doesNotMatch(fixed, /";\nexport default/)
parses(fixed)

const quotedOpen = `const rootCss = "
body { color: red; }
";
export default function Page() { return <div /> }
`
const quotedFixed = sanitizeSyntaxFile('pages/index.tsx', quotedOpen)
assert.match(quotedFixed, /const rootCss = `/)
assert.match(quotedFixed, /`;\nexport default/)
parses(quotedFixed)

const ok = `export default function Page() {
  const value = "all"
  const css = \`
  .x { font-family: "Comfortaa", cursive; }
  \`
  const items = ["egg"]
  return (
    <div>
      <span>Sorry, no recipes found!<br />Try again.</span>
      <ul>
        {items.map((x: string, i: number) => <li key={i}>{x}</li>)}
      </ul>
      <button className={\`px \${value === "all" ? "a" : "b"} \`}>x</button>
    </div>
  )
}
`
assert.equal(repairSyntax(ok), ok)
parses(ok)

const generics = `import { useState } from "react"
function useFavorites(): [string[], (id: string) => void] {
  const [open, setOpen] = useState<string | undefined>(undefined)
  return [[], (id: string) => setOpen(id)]
}
export default function Page() { return <div>{String(useFavorites().length)}</div> }
`
assert.equal(repairSyntax(generics), generics)

const re = `export default function Page() {
  const re = /{/
  return <div />
}
`
assert.equal(repairSyntax(re), re)

const truncated = `export default function Page() {
  return (
    <div>
`
const closed = sanitizeSyntaxFile('pages/index.tsx', truncated)
assert.equal(closed, truncated + '</div>)}')
parses(closed)

const spotify = `import React, { useState } from 'react'
export default function Page() {
  return <div className={useState("a")[0]} />
}
`
assert.equal(
  fragmentFiles({ file_path: 'pages/index.tsx', code: spotify })[0].file_content,
  spotify,
)

console.log('syntax-safe-check ok')
