import assert from 'node:assert/strict'
import {
  coerceDeps,
  coercePort,
  isTransientProviderError,
  looksUsableCode,
  salvageFragment,
} from './salvage-fragment'

const page = `import React from 'react'
export default function Page() {
  return <main><h1>Hello</h1></main>
}
`

assert.equal(coercePort('3000'), 3000)
assert.equal(coercePort(3000), 3000)
assert.equal(coercePort(null), 3000)
assert.deepEqual(coerceDeps('framer-motion, recharts'), ['framer-motion', 'recharts'])
assert.equal(looksUsableCode('x'), false)
assert.equal(looksUsableCode(page), true)

const fromPartial = salvageFragment({
  code: page,
  port: '3000',
  additional_dependencies: 'framer-motion',
  has_additional_dependencies: 'true',
})
assert.ok(fromPartial)
assert.equal(fromPartial.port, 3000)
assert.deepEqual(fromPartial.additional_dependencies, ['framer-motion'])
assert.equal(fromPartial.file_path, 'pages/index.tsx')
assert.equal(fromPartial.template, 'nextjs-developer')

const fromArray = salvageFragment({
  file_path: 'pages/index.tsx',
  code: [{ file_path: 'pages/index.tsx', file_content: page }],
})
assert.ok(fromArray)
assert.match(fromArray.code, /export default/)

assert.equal(salvageFragment({ code: 'short' }), null)
assert.equal(isTransientProviderError({ statusCode: 429, message: 'rate' }), true)
assert.equal(isTransientProviderError({ name: 'AbortError', message: 'aborted' }), false)

console.log('salvage-fragment-check ok')
