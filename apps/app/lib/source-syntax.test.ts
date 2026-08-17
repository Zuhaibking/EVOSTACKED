/**
 * Generated TS/TSX syntax — zero provider / E2B.
 * Run: npm run test:source-syntax
 */
import assert from 'node:assert/strict'
import {
  normalizeFragmentSourceFiles,
  parseGeneratedSource,
  sourceLooksLikeJsx,
  stripWrappingMarkdownFence,
  validateFragmentSourceSyntax,
} from './source-syntax'
import { canDeployIntegrity, validateFragmentIntegrity } from './fragment-integrity'
import { prepareFragmentForValidation } from './prepare-fragment-integrity'
import type { FragmentSchema } from './schema'

const valid = `export default function MenuSection() {
  return (
    <section id="menu" className="py-24">
      <h2>Menu</h2>
    </section>
  )
}
`

const truncated = `export default function BuildYourOwn() {
  return (
    <div className="max-w-3xl mx-auto">
      <button
`

{
  assert.equal(sourceLooksLikeJsx(valid), true)
  assert.equal(parseGeneratedSource('components/MenuSection.tsx', valid).length, 0)
  const broken = parseGeneratedSource('components/BuildYourOwn.tsx', truncated)
  assert.ok(broken.length > 0)
  assert.ok(
    broken.some(
      (i) => i.code === 'truncated_source' || i.code === 'invalid_source',
    ),
  )
}

{
  const stripped = stripWrappingMarkdownFence('```tsx\nexport const x = 1\n```')
  assert.equal(stripped.trim(), 'export const x = 1')
}

{
  const fragment: FragmentSchema = {
    commentary: 'menu',
    template: 'nextjs-developer',
    title: 'Menu',
    description: 'Menu',
    architecture: 'pages',
    additional_dependencies: [],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    file_path: 'pages/index.tsx',
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content:
          'import MenuSection from "../components/MenuSection"\nexport default function H(){return <MenuSection/>}',
      },
      {
        file_path: 'components/MenuSection.ts',
        file_content: valid,
      },
    ],
  }
  const prepared = prepareFragmentForValidation(fragment)
  const menu = prepared.code.find((f) =>
    String(f.file_path).includes('MenuSection'),
  )
  assert.equal(menu?.file_path, 'components/MenuSection.tsx')
  const integrity = validateFragmentIntegrity(prepared)
  assert.equal(canDeployIntegrity(integrity), true)
}

{
  const fragment: FragmentSchema = {
    commentary: 'broken',
    template: 'nextjs-developer',
    title: 'Broken',
    description: 'Broken',
    architecture: 'pages',
    additional_dependencies: [],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    file_path: 'pages/index.tsx',
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: 'import Build from "../components/BuildYourOwn"\nexport default function H(){return <Build/>}',
      },
      {
        file_path: 'components/BuildYourOwn.tsx',
        file_content: truncated,
      },
    ],
  }
  const result = validateFragmentSourceSyntax(fragment.code)
  assert.equal(result.ok, false)
  const integrity = validateFragmentIntegrity(fragment)
  assert.equal(canDeployIntegrity(integrity), false)
  assert.ok(
    integrity.issues.some(
      (i) =>
        i.code === 'truncated_source' || i.code === 'invalid_source',
    ),
  )
}

{
  const renamed = normalizeFragmentSourceFiles({
    file_path: 'components/Hero.ts',
    code: [
      {
        file_path: 'components/Hero.ts',
        file_content: 'export default function Hero(){return <section>Hi</section>}',
      },
    ],
  })
  assert.equal(renamed.changed, true)
  assert.equal(renamed.fragment.file_path, 'components/Hero.tsx')
}

console.log('source-syntax.test.ts: all tests passed')
