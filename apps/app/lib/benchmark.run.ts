/**
 * Benchmark CLI.
 *
 *   pnpm --filter @evostack/app bench                       # all keyed models, no deploy
 *   pnpm --filter @evostack/app bench -- --models=gpt-4.1,minimaxai/minimax-m3
 *   pnpm --filter @evostack/app bench -- --tasks=landing --deploy
 *
 * Costs real tokens. --deploy also spends E2B sandbox time.
 */
import { config as loadEnv } from 'dotenv'
import { existsSync } from 'node:fs'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

for (const path of [
  resolve(__dirname, '../.env.local'),
  resolve(__dirname, '../.env'),
  resolve(__dirname, '../../api/.env'),
]) {
  if (existsSync(path)) loadEnv({ path, override: false })
}

import {
  BenchmarkRow,
  DEFAULT_SUITE,
  buildSharedPlan,
  formatTable,
  runBenchmarkTask,
  summarize,
} from '@/lib/benchmark'
import { getModelsCatalog } from '@/lib/model-catalog'
import { isRoutableModel } from '@/lib/model-router'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

async function main() {
  const deploy = process.argv.includes('--deploy')
  const requested = arg('models')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // Default: everything we actually hold a key for.
  const models =
    requested ??
    getModelsCatalog()
      .filter((m) => isRoutableModel(m.id))
      .map((m) => m.id)

  if (!models.length) {
    console.error('No models available. Set provider keys in apps/api/.env.')
    process.exit(1)
  }

  const taskFilter = arg('tasks')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const tasks = taskFilter
    ? DEFAULT_SUITE.filter((t) => taskFilter.includes(t.id))
    : DEFAULT_SUITE

  if (!tasks.length) {
    console.error(`No tasks matched. Available: ${DEFAULT_SUITE.map((t) => t.id).join(', ')}`)
    process.exit(1)
  }

  const planner = arg('planner') || models[0]
  console.log(
    `benchmarking ${models.length} model(s) × ${tasks.length} task(s)` +
      `${deploy ? ' with E2B deploy' : ' (no deploy)'}\nplanner: ${planner}\n`,
  )

  const rows: BenchmarkRow[] = []
  for (const task of tasks) {
    process.stdout.write(`[${task.id}] planning… `)
    let plan
    try {
      plan = await buildSharedPlan({ brief: task.brief, plannerModelId: planner })
    } catch (err: any) {
      console.log(`plan failed: ${err?.message || err}`)
      continue
    }
    console.log(`ok (${plan.complexity})`)

    // Sequential on purpose: parallel models across one task blow provider TPM
    // and make the latency column meaningless.
    for (const modelId of models) {
      process.stdout.write(`  ${modelId} … `)
      const row = await runBenchmarkTask({ modelId, task, plan, deploy })
      rows.push(row)
      console.log(
        row.ok
          ? `q=${row.quality.toFixed(3)} files=${row.files} $${row.usd.toFixed(4)} ${row.latencyMs}ms`
          : `FAILED — ${row.error}`,
      )
    }
  }

  if (!rows.length) {
    console.error('\nNo results.')
    process.exit(1)
  }

  const summaries = summarize(rows)
  console.log(`\n${formatTable(summaries)}\n`)
  console.log(`recommended generate model: ${summaries[0].modelId}`)

  const out = resolve(process.cwd(), 'benchmark-results.json')
  writeFileSync(out, JSON.stringify({ rows, summaries }, null, 2))
  console.log(`wrote ${out}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
