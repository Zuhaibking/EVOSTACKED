import { searchCleveland } from './images-cleveland'
import { searchMet } from './images-met'
import { searchOpenverse } from './images-openverse'
import { searchWikimedia } from './images-wikimedia'

const queries = [
  'red car',
  'modern architecture',
  'museum painting',
  'flower',
  'landscape',
]

const providers = [
  ['openverse', searchOpenverse],
  ['wikimedia', searchWikimedia],
  ['met', searchMet],
  ['cleveland', searchCleveland],
] as const

async function main() {
  const zeros: string[] = []
  const hitsByProvider = new Map<string, number>()

  for (const [name, search] of providers) {
    let total = 0
    for (const query of queries) {
      const hits = await search(query)
      total += hits.length
      const first = hits.slice(0, 3)
      console.log(
        JSON.stringify({
          provider: name,
          query,
          hits: hits.length,
          titles: first.map((h) => h.title),
          urlsPresent: first.every((h) => Boolean(h.url)),
          license: first.map((h) => h.license || ''),
        }),
      )
      if (!hits.length) zeros.push(`${name}:${query}`)
    }
    hitsByProvider.set(name, total)
  }

  // The resolver searches providers in parallel behind circuit breakers, so one
  // provider outage (Openverse 5xx/timeouts) degrades quality but never blanks photos.
  const dead = [...hitsByProvider].filter(([, total]) => !total).map(([name]) => name)
  if (dead.length === providers.length) {
    throw new Error('every stock image provider returned zero results for all test queries')
  }
  if (dead.length) console.warn(`[images-providers-check] no results from: ${dead.join(', ')}`)

  console.log(
    JSON.stringify({
      zeroResultQueries: zeros,
      totals: Object.fromEntries(hitsByProvider),
    }),
  )
  console.log('images-providers-check ok')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err)
  process.exit(1)
})
