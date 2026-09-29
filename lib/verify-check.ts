import assert from 'node:assert/strict'
import { extraNpmPackages, npmPackageName, packagesToInstall } from './fragment-deps'
import {
  MAX_REPAIR_ATTEMPTS,
  acceptPatch,
  candidateHealthLabel,
  classifyOutput,
  filesFromModel,
  healCandidate,
  regressed,
  repairPrompt,
} from './verify'
import type { ProbeResult } from './verify'
import type { WrittenFile } from './fragment-files'

function page(src: string): WrittenFile[] {
  return [{ file_path: 'pages/index.tsx', file_content: src }]
}

function okProbe(): ProbeResult {
  return { ok: true, output: '<html>ok</html>', httpStatus: 200, phase: 'preview' }
}

assert.equal(npmPackageName('react-icons/fa'), 'react-icons')
assert.equal(npmPackageName('@heroicons/react/24/solid'), '@heroicons/react')
assert.equal(npmPackageName('./local'), null)
assert.equal(npmPackageName('@/components/ui/button'), null)

assert.deepEqual(
  extraNpmPackages(page(`import { FaBars } from "react-icons/fa"\nimport { Carousel } from "react-responsive-carousel"\n`)),
  ['react-icons', 'react-responsive-carousel'],
)
assert.deepEqual(
  extraNpmPackages(page(`export { motion } from "framer-motion"\nconst g = import("gsap")\n`)),
  ['framer-motion', 'gsap'],
)
assert.deepEqual(
  packagesToInstall(page(`import { motion } from "framer-motion"`), [], ['framer-motion', 'react']),
  [],
)

assert.equal(classifyOutput(`Module not found: Can't resolve 'framer-motion'\n./pages/index.tsx:2:1`, 'preview').category, 'MODULE_NOT_FOUND')
assert.equal(classifyOutput(`Module not found: Can't resolve 'framer-motion'`, 'preview').package, 'framer-motion')
assert.equal(classifyOutput('npm ERR! code ERESOLVE', 'install').message, 'peer dependency conflict')
assert.equal(classifyOutput('ReferenceError: window is not defined\n./pages/index.tsx:4:3', 'preview').category, 'NEXT_SSR_ERROR')
assert.equal(classifyOutput('Hydration failed because the server HTML did not match', 'preview').category, 'HYDRATION_ERROR')
assert.equal(classifyOutput('Parsing ecmascript source code failed\nUnexpected eof', 'build').category, 'SYNTAX_ERROR')
assert.equal(classifyOutput("You're importing a component that needs useState. It only works in a Client Component.", 'build').category, 'NEXT_CLIENT_SERVER_ERROR')
assert.equal(classifyOutput('React Hook "useState" is called conditionally', 'preview').category, 'REACT_RUNTIME_ERROR')
assert.equal(classifyOutput('The default export is not a React Component', 'build').category, 'EXPORT_ERROR')
assert.equal(classifyOutput("Attempted import error: 'Foo' is not exported from 'bar'", 'build').category, 'IMPORT_ERROR')
assert.equal(regressed(
  { install: true, build: true, preview: false, http: true, runtime: false },
  { install: true, build: false, preview: false, http: true, runtime: false },
), true)

async function main() {
const installed = new Set<string>(['react', 'next'])
let llmCalls = 0

async function installOk(pkgs: string[]) {
  pkgs.forEach((p) => installed.add(p))
  return { ok: true, output: '' }
}

async function probeInstalled(files: WrittenFile[]): Promise<ProbeResult> {
  const code = files[0]?.file_content || ''
  for (const m of code.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const name = npmPackageName(m[1])
    if (!name || name === 'react' || name === 'next') continue
    if (!installed.has(name)) {
      return {
        ok: false,
        output: `Module not found: Can't resolve '${m[1]}'\n./pages/index.tsx:1:1`,
        httpStatus: 500,
        phase: 'preview',
      }
    }
  }
  return okProbe()
}

for (const spec of [
  `import { motion } from "framer-motion"\nexport default function Page(){ return <div/> }\n`,
  `import gsap from "gsap"\nexport default function Page(){ return <div/> }\n`,
  `import { FaBars } from "react-icons/fa"\nexport default function Page(){ return <div/> }\n`,
  `import { Carousel } from "react-responsive-carousel"\nexport default function Page(){ return <div/> }\n`,
]) {
  installed.clear()
  installed.add('react')
  installed.add('next')
  const healed = await healCandidate({
    files: page(spec),
    present: ['react', 'next'],
    probe: probeInstalled,
    install: installOk,
    llmRepair: async () => {
      llmCalls++
      return null
    },
  })
  assert.equal(healed.health.verified, true, spec)
  assert.equal(healed.health.dependencyStatus, 'passed')
  assert.equal(llmCalls, 0)
  assert.ok(healed.health.log.some((l) => l.includes('Installing')))
}

installed.clear()
const denied = await healCandidate({
  files: page(`import { motion } from "framer-motion"\nexport default function Page(){ return <div/> }\n`),
  present: ['react', 'next'],
  probe: async () => okProbe(),
  install: async () => ({ ok: false, output: 'npm ERR! 404 Not Found - framer-motion' }),
})
assert.equal(denied.health.verified, false)
assert.equal(denied.health.state, 'FAILED')
assert.equal(denied.health.dependencyStatus, 'failed')
assert.equal(denied.probed, false)

const syntax = await healCandidate({
  files: page('const css = `\nbody {}\n";\nexport default function Page(){ return <div/> }\n'),
  present: ['react', 'next'],
  probe: async (files) =>
    files[0].file_content.includes('";\nexport')
      ? { ok: false, output: 'Parsing ecmascript source code failed\nUnexpected eof\n./pages/index.tsx:3:1', httpStatus: 500, phase: 'build' }
      : okProbe(),
  install: installOk,
})
assert.equal(syntax.health.verified, true)
assert.match(syntax.files[0].file_content, /`;\nexport default/)
assert.equal(syntax.health.repairAttempts >= 1, true)

const ssr = await healCandidate({
  files: page('export default function Page(){\n  const w = window.innerWidth\n  return <div>{w}</div>\n}\n'),
  present: ['react', 'next'],
  probe: async (files) =>
    files[0].file_content.includes('typeof window')
      ? okProbe()
      : { ok: false, output: 'ReferenceError: window is not defined\n./pages/index.tsx:2:3', httpStatus: 500, phase: 'preview' },
  install: installOk,
})
assert.equal(ssr.health.verified, true)
assert.match(ssr.files[0].file_content, /typeof window/)

const client = await healCandidate({
  files: page('import { useState } from "react"\nexport default function Page(){ return <div/> }\n'),
  present: ['react', 'next'],
  probe: async (files) =>
    files[0].file_content.includes('use client')
      ? okProbe()
      : { ok: false, output: "You're importing a component that needs useState. It only works in a Client Component.\n./pages/index.tsx:1:1", httpStatus: 500, phase: 'build' },
  install: installOk,
})
assert.equal(client.health.verified, true)
assert.match(client.files[0].file_content, /^'use client'/)

const exported = await healCandidate({
  files: page('export function Page(){ return null }\n'),
  present: ['react', 'next'],
  probe: async (files) =>
    /export\s+default\b/.test(files[0].file_content)
      ? okProbe()
      : { ok: false, output: 'The default export is not a React Component\n./pages/index.tsx:1:1', httpStatus: 500, phase: 'build' },
  install: installOk,
})
assert.equal(exported.health.verified, true)
assert.match(exported.files[0].file_content, /export default Page/)

const hydration = await healCandidate({
  files: page("export default function Page(){ return <style>{\`.x { font-family: 'A'; }\`}</style> }\n"),
  present: ['react', 'next'],
  probe: async (files) =>
    files[0].file_content.includes('dangerouslySetInnerHTML')
      ? okProbe()
      : { ok: false, output: 'Hydration failed because the server HTML did not match\n./pages/index.tsx:1:1', httpStatus: 500, phase: 'preview' },
  install: installOk,
})
assert.equal(hydration.health.verified, true)

const hooks = await healCandidate({
  files: page('export default function Page(){ if (true) { return null } return <div/> }\n'),
  present: ['react', 'next'],
  probe: async () => ({
    ok: false,
    output: 'React Hook "useState" is called conditionally\n./pages/index.tsx:1:1',
    httpStatus: 500,
    phase: 'preview',
  }),
  install: installOk,
})
assert.equal(hooks.health.verified, false)
assert.equal(hooks.health.state, 'FAILED')

let modelTries = 0
const modelFixed = await healCandidate({
  files: page('export default function Page(){ return <div/> }\n'),
  present: ['react', 'next'],
  probe: async (files) => (files[0].file_content.includes('FIXED') ? okProbe() : {
    ok: false,
    output: "Attempted import error: 'Foo' is not exported from 'bar'\n./pages/index.tsx:1:1",
    httpStatus: 500,
    phase: 'build',
  }),
  install: installOk,
  llmRepair: async (ctx) => {
    modelTries++
    assert.ok(repairPrompt(ctx).includes('smallest possible change'))
    return page(`export default function Page(){ return <div>FIXED</div> }\n`)
  },
})
assert.equal(modelFixed.health.verified, true)
assert.equal(modelTries, 1)
assert.ok(modelFixed.health.log.some((l) => l.includes('Attempt 1/3')))

let badTries = 0
const budget = await healCandidate({
  files: page('export default function Page(){ return <div/> }\n'),
  present: ['react', 'next'],
  probe: async () => ({
    ok: false,
    output: 'Application error: a client-side exception\n./pages/index.tsx:1:1',
    httpStatus: 500,
    phase: 'preview',
  }),
  install: installOk,
  llmRepair: async () => {
    badTries++
    return page('export default function Page(){ return <div>STILL</div> }\n')
  },
})
assert.equal(budget.health.verified, false)
assert.equal(badTries, MAX_REPAIR_ATTEMPTS)
assert.equal(budget.health.repairAttempts, MAX_REPAIR_ATTEMPTS)

const rolled = await healCandidate({
  files: page('export default function Page(){\n  const w = window.innerWidth\n  return <div/>\n}\n'),
  present: ['react', 'next'],
  probe: async (files) =>
    files[0].file_content.includes('typeof window')
      ? { ok: false, output: "Module not found: Can't resolve 'react'\n./pages/index.tsx:1:1", httpStatus: 500, phase: 'preview' }
      : { ok: false, output: 'ReferenceError: window is not defined\n./pages/index.tsx:2:3', httpStatus: 500, phase: 'preview' },
  install: installOk,
})
assert.equal(rolled.health.verified, false)
assert.ok(rolled.health.log.some((l) => l.includes('ROLLBACK')))
assert.equal(rolled.files[0].file_content.includes('typeof window'), false)

assert.equal(acceptPatch('export default function Page(){ return <div/> }', '@ts-nocheck\nexport default function Page(){ return null }'), false)
assert.equal(acceptPatch('x'.repeat(300), 'tiny'), false)
assert.equal(filesFromModel(page('export default function Page(){ return <div/> }\n'), classifyOutput('x', 'build'), 'no fence'), null)

let timeoutLlm = 0
const timedOut = await healCandidate({
  files: page('export default function Page(){ return <div/> }\n'),
  present: ['react', 'next'],
  probe: async () => ({ ok: false, output: 'The operation was aborted due to timeout', httpStatus: 0, phase: 'preview' }),
  install: installOk,
  llmRepair: async () => {
    timeoutLlm++
    return null
  },
})
assert.equal(timedOut.health.verified, false)
assert.equal(timedOut.health.state, 'UNVERIFIED')
assert.equal(timeoutLlm, 0)

assert.equal(candidateHealthLabel('done'), 'Unverified')
assert.equal(candidateHealthLabel('done', syntax.health), 'Verified')
assert.equal(candidateHealthLabel('done', hooks.health), 'Failed')
assert.equal(candidateHealthLabel('generating'), null)

console.log('verify-check ok')
}

main()
