/**
 * One-shot generate → deploy → open in browser.
 *
 * Runs the real pipeline (routed plan → skills-injected generation → preflight
 * → E2B deploy) for a single prompt so you can look at what the new skill packs
 * actually produce.
 *
 *   pnpm --filter @evostack/app preview
 *   pnpm --filter @evostack/app preview -- --prompt="a dashboard for X"
 *   pnpm --filter @evostack/app preview -- --no-open --template=nextjs-developer
 *
 * Spends OpenAI tokens and E2B sandbox time.
 */
import { config as loadEnv } from 'dotenv'
import { execFile } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

for (const path of [
  resolve(__dirname, '../.env.local'),
  resolve(__dirname, '../.env'),
  resolve(__dirname, '../../api/.env'),
]) {
  if (existsSync(path)) loadEnv({ path, override: false })
}

import { generateObject, streamObject, type LanguageModel } from 'ai'
import { checkArchitectureCompliance } from '@/lib/architecture-compliance'
import { costUsd, ratesForModel, readProviderUsage } from '@/lib/generation-cost'
import { withGenerationTokenBudget } from '@/lib/generation-budget'
import { findCatalogModel } from '@/lib/model-catalog'
import { describeRoute, routeModel, routedConfig } from '@/lib/model-router'
import { getModelClient } from '@/lib/models'
import {
  applicationPlanSchema,
  buildFallbackApplicationPlan,
  normalizeApplicationPlan,
  PLANNING_SYSTEM_PROMPT,
} from '@/lib/plan'
import { prepareFragmentIntegrity } from '@/lib/prepare-fragment-integrity'
import { buildGenerationPrompt } from '@/lib/prompt'
import { fragmentSchema, type FragmentSchema } from '@/lib/schema'
import { selectSkills } from '@/lib/skills'
import { classifyAppStack } from '@/lib/stack-advisor'
import templates, { type Templates } from '@/lib/templates'
import { VARIANTS } from '@/lib/tournament'
import { deployAndVerify } from '@/lib/verify-candidate'

const DEFAULT_PROMPT =
  'A landing page for a specialty coffee roastery in Bangalore — single-origin beans, a subscription plan, brewing guides, and a store locator.'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

function catalogFor(templateId?: string): Templates {
  const all = templates as Templates
  if (!templateId) return all
  const key = Object.keys(all).find((k) => k === templateId)
  return key ? ({ [key]: all[key as keyof Templates] } as Templates) : all
}

async function main() {
  const prompt = arg('prompt') || DEFAULT_PROMPT
  const variantId = arg('variant') || 'rich'
  const variant = VARIANTS.find((v) => v.id === variantId) || VARIANTS[1]
  const catalog = catalogFor(arg('template') || 'nextjs-developer')

  const userModel = findCatalogModel(arg('model') || 'gpt-4.1')
  if (!userModel) {
    console.error(`Unknown model: ${arg('model')}`)
    process.exit(1)
  }

  const planRoute = routeModel({ role: 'plan', userModel })
  const genRoute = routeModel({ role: 'generate', userModel })
  console.log(`prompt:  ${prompt}`)
  console.log(`variant: ${variant.label}`)
  console.log(`models:  ${describeRoute(planRoute)}, ${describeRoute(genRoute)}\n`)

  // ---- plan (cheap role) ----
  const t0 = Date.now()
  process.stdout.write('planning… ')
  const planClient = getModelClient(planRoute.model, routedConfig({}, planRoute))
  const runPlan = () =>
    generateObject({
      model: planClient as LanguageModel,
      schema: applicationPlanSchema,
      system: PLANNING_SYSTEM_PROMPT,
      prompt: `User request / conversation brief:\n\n${prompt}\n\nProduce the shared ApplicationPlan that the implementation must satisfy.`,
      maxRetries: 0,
      temperature: 0.2,
      abortSignal: AbortSignal.timeout(120_000),
    })

  // Same retry → fallback ladder as the tournament, so this script fails the
  // way the product does instead of dying on one schema slip.
  let plan
  try {
    plan = normalizeApplicationPlan((await runPlan()).object)
  } catch (first: any) {
    console.log(`retry (${String(first?.message).slice(0, 80)})`)
    try {
      plan = normalizeApplicationPlan((await runPlan()).object)
    } catch {
      console.log('fallback plan')
      plan = buildFallbackApplicationPlan(prompt)
    }
  }
  console.log(`${plan.productName} · ${plan.complexity} · ${Date.now() - t0}ms`)

  // ---- which skills the prompt pulled in ----
  const kind = classifyAppStack({ prompt, plan })
  const skills = selectSkills({ kind })
  console.log(`skills:  ${kind} → ${skills.map((s) => s.name).join(', ') || '(none)'}\n`)

  // ---- generate (user model) ----
  const t1 = Date.now()
  process.stdout.write('generating')
  const genClient = getModelClient(genRoute.model, routedConfig({}, genRoute))
  // ai@3 returns a Promise from streamObject — must await before iterating.
  const stream = await streamObject({
    model: genClient as LanguageModel,
    schema: fragmentSchema,
    system: buildGenerationPrompt({
      template: catalog,
      plan,
      brief: prompt,
      variantDirection: variant.systemSuffix,
    }),
    prompt,
    maxRetries: 0,
    temperature: variant.temperature,
    abortSignal: AbortSignal.timeout(300_000),
    ...withGenerationTokenBudget({}, plan),
  })

  let last: any
  for await (const partial of stream.partialObjectStream) {
    last = partial
    process.stdout.write('.')
  }
  const fragment = ((await stream.object) ?? last) as FragmentSchema
  const usage = readProviderUsage(await Promise.resolve(stream.usage))
  const files = fragment.code || []
  console.log(
    `\n${files.length} files · ${Date.now() - t1}ms · $${costUsd(usage, ratesForModel(genRoute.model.id)).toFixed(4)}`,
  )
  for (const f of files) console.log(`   ${f.file_path}`)

  // ---- validate → one repair pass if broken (same as the tournament) ----
  const repairRoute = routeModel({ role: 'repair', userModel })
  const preflighted = await prepareFragmentIntegrity({
    fragment,
    repair: { model: repairRoute.model, config: routedConfig({}, repairRoute) },
  })
  const arch = checkArchitectureCompliance({
    fragment: preflighted.fragment,
    plan,
  })
  console.log(
    `\nintegrity=${preflighted.integrity.ok ? 'ok' : `${preflighted.integrity.issues.length} issues`}` +
      `${preflighted.repairAttempted ? ` repair=${preflighted.repaired ? 'fixed' : 'failed'} (${repairRoute.model.id})` : ''}` +
      ` architecture=${arch.status}`,
  )

  const out = resolve(process.cwd(), `preview-${variant.id}.json`)
  writeFileSync(out, JSON.stringify(preflighted.fragment, null, 2))
  console.log(`fragment → ${out}`)

  if (process.argv.includes('--no-deploy')) return

  // ---- deploy ----
  process.stdout.write('\ndeploying to E2B… ')
  const t2 = Date.now()
  const { verification, execution } = await deployAndVerify(preflighted.fragment, {})
  const url =
    execution && 'url' in execution
      ? (execution as { url?: string }).url
      : verification.url
  console.log(`${verification.status} · ${Date.now() - t2}ms`)
  for (const e of verification.errors || []) console.log(`   error: ${e}`)
  for (const w of verification.warnings || []) console.log(`   warn:  ${w}`)

  if (!url) {
    console.log('\nNo preview URL — deploy failed.')
    process.exit(1)
  }

  console.log(`\n${url}\n`)
  if (!process.argv.includes('--no-open')) {
    execFile('open', [url], (err) => {
      if (err) console.log('(could not open a browser; use the URL above)')
    })
  }
}

main().catch((err) => {
  console.error(`\n${err?.message || err}`)
  process.exit(1)
})
