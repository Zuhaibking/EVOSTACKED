import assert from 'node:assert/strict'
import { sanitizeStyleHydration } from './hydrate-safe'

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

console.log('hydrate-safe-check ok')
