/**
 * Deterministic CSS integrity — zero provider / E2B / network.
 * Run: npm run test:css-integrity
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  normalizeFragmentStylesheets,
  normalizeStylesheet,
  validateFragmentStylesheets,
  validateStylesheet,
} from './css-integrity'

const TAILWIND_VALID = `@import "tailwindcss";

@theme {
  --color-brand: #111;
}

@layer base {
  body { margin: 0; }
}
`

const MULTI_IMPORT_VALID = `@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap");
@import "tailwindcss";

:root { --fg: #111; }

@keyframes fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.hero { animation: fade 400ms ease; }
`

const IMPORT_AFTER_RULES = `:root {
  --bg: #0a0a0a;
  --fg: #fafafa;
}

body { color: var(--fg); }

@keyframes spin {
  to { transform: rotate(360deg); }
}

.card { animation: spin 2s linear infinite; }

@import url("https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&display=swap");
`

const LAYER_STATEMENT_THEN_IMPORT = `@layer theme, base, components, utilities;
@import "tailwindcss";

@theme {
  --font-sans: Inter, sans-serif;
}
`

const THEME_THEN_IMPORT = `@theme {
  --color-brand: #c00;
}

@import url("https://fonts.googleapis.com/css2?family=Inter&display=swap");
`

const TRUNCATED = `:root { --x: 1;

.hero { color: red;
`

const MALFORMED = `:root { --x: 1; }
}
body { color: red; }
`

{
  const r = validateStylesheet(IMPORT_AFTER_RULES, 'styles/globals.css')
  assert.equal(r.ok, false)
  assert.ok(r.issues.some((i) => i.code === 'invalid_css_import_order'))
  assert.ok(r.issues[0]?.message.includes('styles/globals.css:'))
  assert.ok(/@import after CSS rules/i.test(r.issues[0]?.message || ''))
}

{
  const r = validateStylesheet(MULTI_IMPORT_VALID)
  assert.equal(r.ok, true, r.issues.map((i) => i.message).join('; '))
}

{
  const r = validateStylesheet(LAYER_STATEMENT_THEN_IMPORT)
  assert.equal(r.ok, true, r.issues.map((i) => i.message).join('; '))
}

{
  const r = validateStylesheet(TAILWIND_VALID)
  assert.equal(r.ok, true, r.issues.map((i) => i.message).join('; '))
  assert.equal(
    r.issues.some((i) => /@theme|@layer/.test(i.message) && i.code !== 'invalid_css_import_order'),
    false,
  )
}

{
  const r = validateStylesheet(MULTI_IMPORT_VALID)
  assert.equal(r.ok, true)
}

{
  const r = validateStylesheet(TRUNCATED, 'app/globals.css')
  assert.equal(r.ok, false)
  assert.ok(r.issues.some((i) => i.code === 'truncated_css'))
}

{
  const r = validateStylesheet(MALFORMED)
  assert.equal(r.ok, false)
  assert.ok(r.issues.some((i) => i.code === 'malformed_css'))
}

{
  const r = validateStylesheet(THEME_THEN_IMPORT, 'styles/globals.css')
  assert.equal(r.ok, false)
  assert.ok(r.issues.some((i) => i.code === 'invalid_css_import_order'))
}

{
  const hoisted = normalizeStylesheet(IMPORT_AFTER_RULES)
  assert.equal(hoisted.changed, true)
  assert.match(hoisted.css, /^@import url\("https:\/\/fonts\.googleapis\.com/)
  assert.ok(hoisted.css.includes(':root {'))
  assert.ok(hoisted.css.includes('--bg: #0a0a0a'))
  assert.ok(hoisted.css.includes('@keyframes spin'))
  assert.ok(hoisted.css.includes('.card { animation: spin 2s linear infinite; }'))
  const after = validateStylesheet(hoisted.css, 'styles/globals.css')
  assert.equal(after.ok, true, after.issues.map((i) => i.message).join('; '))
}

{
  const already = normalizeStylesheet(MULTI_IMPORT_VALID)
  assert.equal(already.changed, false)
  assert.equal(already.css, MULTI_IMPORT_VALID)
}

{
  const layerOk = normalizeStylesheet(LAYER_STATEMENT_THEN_IMPORT)
  assert.equal(layerOk.changed, false)
}

{
  const truncated = normalizeStylesheet(TRUNCATED)
  assert.equal(truncated.changed, false)
  assert.equal(truncated.css, TRUNCATED)
}

{
  const files = [
    {
      file_path: 'app/globals.css',
      file_content: '@import "tailwindcss";\nbody{margin:0}',
    },
    {
      file_path: 'styles/globals.css',
      file_content: '@tailwind base;\n@tailwind components;\n@tailwind utilities;',
    },
  ]
  const r = validateFragmentStylesheets(files)
  assert.equal(r.ok, false)
  assert.ok(r.issues.some((i) => i.code === 'duplicate_stylesheet'))
}

{
  const files = [
    {
      file_path: 'styles/globals.css',
      file_content: '@import "tailwindcss";\n',
    },
    {
      file_path: 'styles/components.css',
      file_content: '.btn { color: red; }',
    },
  ]
  const r = validateFragmentStylesheets(files)
  assert.equal(r.ok, true, r.issues.map((i) => i.message).join('; '))
}

{
  const fragment = {
    file_path: 'pages/index.tsx',
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: 'export default function H(){return <main/>}',
      },
      { file_path: 'styles/globals.css', file_content: IMPORT_AFTER_RULES },
    ],
  }
  const { fragment: next, changed } = normalizeFragmentStylesheets(fragment)
  assert.equal(changed, true)
  const css = (next.code as Array<{ file_path: string; file_content: string }>).find(
    (f) => f.file_path === 'styles/globals.css',
  )
  assert.ok(css)
  assert.match(css!.file_content, /^@import url\(/)
  assert.ok(css!.file_content.includes('@keyframes spin'))
  const revalidated = validateStylesheet(css!.file_content, 'styles/globals.css')
  assert.equal(revalidated.ok, true)
}

{
  const withLineComments = `@import "tailwindcss";

// Festival theme tokens
:root { --bg: #0a0a0a; }

// Hero
.hero { color: white; }
`
  const r = validateStylesheet(withLineComments, 'styles/globals.css')
  assert.equal(r.ok, true, r.issues.map((i) => i.message).join('; '))
  const unchanged = normalizeStylesheet(withLineComments)
  assert.equal(unchanged.changed, false)
  assert.equal(unchanged.css, withLineComments)
}

{
  const commentThenImport = `:root { --fg: #111; }

// fonts
@import url("https://fonts.googleapis.com/css2?family=Inter&display=swap");
`
  const before = validateStylesheet(commentThenImport, 'styles/globals.css')
  assert.equal(before.ok, false)
  assert.ok(before.issues.some((i) => i.code === 'invalid_css_import_order'))
  const hoisted = normalizeStylesheet(commentThenImport)
  assert.equal(hoisted.changed, true)
  assert.match(hoisted.css, /^@import url\(/)
  assert.ok(hoisted.css.includes(':root { --fg: #111; }'))
  const after = validateStylesheet(hoisted.css, 'styles/globals.css')
  assert.equal(after.ok, true, after.issues.map((i) => i.message).join('; '))
}

{
  const src = fs.readFileSync(
    path.join(process.cwd(), 'lib/css-integrity.ts'),
    'utf8',
  )
  assert.doesNotMatch(src, /coffee|AquaClub|gym|swimming pool|portfolio/i)
}

console.log('css-integrity.test.ts: all tests passed')
