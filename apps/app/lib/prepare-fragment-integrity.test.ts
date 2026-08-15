/**
 * Pre-deploy integrity prepare + sandbox gate — zero provider for valid paths.
 * Run: npm run test:prepare-fragment-integrity
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { applyRepairToFragment } from './repair'
import {
  buildSandboxIntegrityError,
  canDeployFragment,
  prepareFragmentIntegrity,
  serializeIntegrityResult,
} from './prepare-fragment-integrity'
import { validateFragmentIntegrity } from './fragment-integrity'
import type { FragmentSchema } from './schema'

function validFrag(): FragmentSchema {
  return {
    commentary: 'ok',
    template: 'nextjs-developer',
    title: 'Ok',
    description: 'ok',
    architecture: 'pages',
    additional_dependencies: [],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    file_path: 'pages/index.tsx',
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: `import Hero from '../components/Hero'\nexport default function H(){return <Hero/>}`,
      },
      {
        file_path: 'components/Hero.tsx',
        file_content: 'export default function Hero(){return <h1>Hi</h1>}',
      },
    ],
  }
}

function brokenImportFrag(): FragmentSchema {
  return {
    ...validFrag(),
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: `import Missing from '../components/Missing'\nexport default function H(){return <Missing/>}`,
      },
      {
        file_path: 'components/Other.tsx',
        file_content: 'export default function Other(){return null}',
      },
    ],
  }
}

async function main() {
  // 1. Valid fragment — no repair, can deploy
  {
    const frag = validFrag()
    const prepared = await prepareFragmentIntegrity({ fragment: frag })
    assert.equal(prepared.integrity.ok, true)
    assert.equal(prepared.repaired, false)
    assert.equal(prepared.repairAttempted, false)
    assert.equal(canDeployFragment(prepared.fragment).ok, true)
  }

  // 2. Broken import — validate-only leaves source, blocks deploy
  {
    const frag = brokenImportFrag()
    const prepared = await prepareFragmentIntegrity({ fragment: frag })
    assert.equal(prepared.integrity.ok, false)
    assert.equal(prepared.repairAttempted, false)
    assert.equal(canDeployFragment(prepared.fragment).ok, false)
    const err = buildSandboxIntegrityError(frag, prepared.integrity)
    assert.equal(err.code, 'FRAGMENT_INTEGRITY_FAILED')
    assert.ok(err.fragment)
    assert.equal(err.integrity.ok, false)
    assert.ok(serializeIntegrityResult(prepared.integrity).files.length >= 1)
  }

  // 3. Deterministic repair apply + revalidate (mirrors caller repair path, no LLM)
  {
    const broken = brokenImportFrag()
    const applied = applyRepairToFragment(broken, {
      explanation: 'Add missing component',
      changedFiles: ['components/Missing.tsx'],
      files: [
        {
          file_path: 'components/Missing.tsx',
          action: 'add',
          file_content:
            'export default function Missing(){ return <div>ok</div> }',
        },
      ],
    })
    assert.equal(applied.ok, true)
    if (applied.ok) {
      const again = await prepareFragmentIntegrity({
        fragment: applied.fragment,
      })
      assert.equal(again.integrity.ok, true)
      assert.equal(canDeployFragment(again.fragment).ok, true)
    }
  }

  // 4. prepare without repair never invents LLM calls (valid or invalid)
  {
    const broken = brokenImportFrag()
    const a = await prepareFragmentIntegrity({
      fragment: broken,
      repair: null,
    })
    assert.equal(a.repairAttempted, false)
    const b = await prepareFragmentIntegrity({ fragment: validFrag() })
    assert.equal(b.repairAttempted, false)
  }

  // 5. Routes wire shared helper / validator — no duplicated validator body
  {
    const chat = fs.readFileSync(
      path.join(process.cwd(), '../api/src/generation/chat.runner.ts'),
      'utf8',
    )
    const morph = fs.readFileSync(
      path.join(process.cwd(), '../api/src/generation/morph.runner.ts'),
      'utf8',
    )
    const sandbox = fs.readFileSync(
      path.join(process.cwd(), '../api/src/generation/sandbox.runner.ts'),
      'utf8',
    )
    const tournament = fs.readFileSync(
      path.join(process.cwd(), '../api/src/generation/tournament.runner.ts'),
      'utf8',
    )

    assert.match(chat, /prepareFragmentIntegrity/)
    assert.match(morph, /prepareFragmentIntegrity/)
    assert.match(
      sandbox,
      /canDeployFragment|validateFragmentIntegrity|buildSandboxIntegrityError/,
    )
    assert.doesNotMatch(
      sandbox,
      /repairFragmentIntegrity|generateObject|streamObject/,
    )
    // Tournament unchanged — still uses its own integrity path, not prepare helper
    assert.match(tournament, /validateFragmentIntegrity/)
    assert.doesNotMatch(tournament, /prepareFragmentIntegrity/)
    assert.doesNotMatch(chat, /extractLocalImports/)
    assert.doesNotMatch(morph, /extractLocalImports/)
    assert.doesNotMatch(sandbox, /extractLocalImports/)
  }

  // 6. Integrity failure does not fake success
  {
    const v = validateFragmentIntegrity(brokenImportFrag())
    assert.equal(v.ok, false)
    assert.equal(canDeployFragment(brokenImportFrag()).ok, false)
  }

  console.log('prepare-fragment-integrity.test.ts: all tests passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
