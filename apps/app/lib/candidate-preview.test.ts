/**
 * Deterministic tests: candidate Preview → existing workspace pane state.
 * Run: npm run test:candidate-preview
 */
import assert from 'node:assert/strict'
import {
  buildCandidatePreviewAction,
  previewActionUrl,
} from './candidate-preview'
import type { Candidate } from './tournament-client'
import { VARIANTS, type VariantId } from './tournament'
import type { ExecutionResult } from './types'
import type { VerificationResult } from './verification'

function frag(title: string) {
  return {
    title,
    template: 'nextjs-developer',
    file_path: 'pages/index.tsx',
    commentary: title,
    description: title,
    architecture: 'local',
    additional_dependencies: [] as string[],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: `export default function Page(){ return <main>${title}</main> }`,
      },
    ],
  }
}

function passed(url: string): VerificationResult {
  return {
    status: 'passed',
    filesWritten: true,
    dependenciesInstalled: true,
    processStarted: true,
    previewReachable: true,
    errors: [],
    warnings: [],
    durationMs: 50,
    sbxId: `sbx_${url}`,
    url,
    template: 'nextjs-developer',
  }
}

function candidate(
  id: VariantId,
  url: string,
  extra: Partial<Candidate> = {},
): Candidate {
  const v = VARIANTS.find((x) => x.id === id)!
  return {
    id,
    label: v.label,
    sigil: v.sigil,
    status: 'tested',
    fragment: frag(v.label),
    finalVerification: passed(url),
    execution: {
      sbxId: `sbx_${id}`,
      url,
      template: 'nextjs-developer',
    } as ExecutionResult,
    ...extra,
  }
}

const productUrl = 'https://product.e2b.dev'
const premiumUrl = 'https://premium.e2b.dev'
const innovateUrl = 'https://innovate.e2b.dev'

const product = candidate('minimal', productUrl)
const premium = candidate('rich', premiumUrl)
const innovate = candidate('playful', innovateUrl)

// 1–2. Product Preview selects Product and loads Product URL
{
  const action = buildCandidatePreviewAction(product)!
  assert.equal(action.candidateId, 'minimal')
  assert.equal(action.select, true)
  assert.equal(action.tab, 'fragment')
  assert.equal(action.showIframe, true)
  assert.equal(previewActionUrl(action), productUrl)
  assert.equal(action.promotesActiveVersion, false)
}

// 3. Premium Preview replaces Product URL
{
  const a = buildCandidatePreviewAction(product)!
  const b = buildCandidatePreviewAction(premium)!
  assert.equal(previewActionUrl(a), productUrl)
  assert.equal(previewActionUrl(b), premiumUrl)
  assert.notEqual(previewActionUrl(a), previewActionUrl(b))
  assert.equal(b.tab, 'fragment')
}

// 4. Innovate Preview replaces Premium URL
{
  const b = buildCandidatePreviewAction(premium)!
  const c = buildCandidatePreviewAction(innovate)!
  assert.equal(previewActionUrl(b), premiumUrl)
  assert.equal(previewActionUrl(c), innovateUrl)
  assert.notEqual(previewActionUrl(b), previewActionUrl(c))
}

// 5. Preview switches to Preview tab (fragment)
{
  for (const c of [product, premium, innovate]) {
    assert.equal(buildCandidatePreviewAction(c)!.tab, 'fragment')
  }
}

// 6–7. Isolation: Product ≠ Premium ≠ Innovate
{
  const urls = [product, premium, innovate].map((c) =>
    previewActionUrl(buildCandidatePreviewAction(c)),
  )
  assert.deepEqual(urls, [productUrl, premiumUrl, innovateUrl])
  assert.equal(new Set(urls).size, 3)
}

// 8. Preview does not require activeVersion
{
  const action = buildCandidatePreviewAction(product)!
  assert.equal(action.promotesActiveVersion, false)
  // No activeVersion field on the action at all
  assert.equal('activeVersion' in action, false)
}

// 9. Preview does not promote a candidate
{
  assert.equal(buildCandidatePreviewAction(product)!.promotesActiveVersion, false)
  assert.equal(buildCandidatePreviewAction(premium)!.promotesActiveVersion, false)
}

// 10. Missing execution URL → Preview unavailable
{
  const broken: Candidate = {
    ...product,
    execution: undefined,
    finalVerification: {
      status: 'failed',
      filesWritten: true,
      dependenciesInstalled: true,
      processStarted: false,
      previewReachable: false,
      errors: ['boot failed'],
      warnings: [],
      durationMs: 10,
    },
    status: 'verify_failed',
  }
  const action = buildCandidatePreviewAction(broken)!
  assert.equal(action.showIframe, false)
  assert.equal(action.result, undefined)
  assert.equal(action.tab, 'fragment')
  assert.match(action.unavailableReason || '', /boot failed|preview URL|runtime|deployment/i)
  assert.ok(action.fragment)
}

// 11. Source still available via fragment on action
{
  const action = buildCandidatePreviewAction(product)!
  assert.ok(action.fragment)
  assert.equal(
    (action.fragment as { file_path?: string }).file_path,
    'pages/index.tsx',
  )
}

// 12. Use-this-version is a separate concern (preview never promotes)
{
  assert.equal(buildCandidatePreviewAction(innovate)!.promotesActiveVersion, false)
  assert.equal(buildCandidatePreviewAction(innovate)!.select, true)
}

console.log('candidate-preview.test.ts: all tests passed')
