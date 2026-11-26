import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { toAISDKMessages } from './messages'
import { toPrompt } from './prompt'
import { assertGeneratedFragment, fragmentSchema, fragmentSourceFiles, fragmentSourceText, generatedFragmentSchema, sameFragmentSource, type FragmentSchema } from './schema'
import templates from './templates'

async function check() {
  const project: FragmentSchema = {
    commentary: 'Build a portfolio', template: 'nextjs-developer', title: 'Portfolio', description: 'A portfolio.',
    additional_dependencies: [], has_additional_dependencies: false, install_dependencies_command: '', port: 3000,
    file_path: 'pages/index.tsx', code: "import Hero from '../components/Hero'; export default function Page(){return <Hero/>}",
    files: [
      { file_path: 'components/Hero.tsx', file_content: "import { title } from '../data/site'; export default function Hero(){return <main>{title}</main>}" },
      { file_path: 'data/site.ts', file_content: "export const title = 'Original portfolio'" },
    ],
  }
  const { files: _files, ...legacy } = project
  assert.ok(fragmentSchema.safeParse(legacy).success, 'Saved single-file projects remain readable')
  assert.ok(!generatedFragmentSchema.safeParse(legacy).success, 'New output must include supporting files field')
  assert.deepEqual(assertGeneratedFragment(project), project)
  assert.throws(() => assertGeneratedFragment({ ...project, files: [] }), /Web projects require/)
  assert.throws(() => assertGeneratedFragment({ ...project, files: [{ ...project.files![0], file_content: '// empty component' }, project.files![1]] }), /complete implementation/)
  assert.throws(() => assertGeneratedFragment({ ...project, files: [project.files![0], { file_path: 'data/site.ts', file_content: 'export {}' }] }), /complete implementation/)
  assert.throws(() => assertGeneratedFragment({ ...project, files: [project.files![0], { file_path: '../escape.ts', file_content: 'export const x = 1' }] }), /safe relative paths/)
  assert.throws(() => assertGeneratedFragment({ ...project, files: [...project.files!, { file_path: project.file_path, file_content: project.code }] }), /unique/)
  const python = { ...legacy, template: 'code-interpreter-v1', file_path: 'script.py', code: "print('analysis')", files: [] }
  assert.deepEqual(assertGeneratedFragment(python), python, 'Python can stay a single script')
  assert.equal(fragmentSourceFiles(project).length, 3)
  assert.ok(sameFragmentSource(project, { ...project, files: [...project.files!].reverse() }))
  assert.ok(!sameFragmentSource(project, { ...project, files: [project.files![0], { ...project.files![1], file_content: 'export const title = "Edited"' }] }))
  const legacyArray = { ...project, files: undefined, code: fragmentSourceFiles(project) }
  assert.ok(sameFragmentSource(project, legacyArray), 'Legacy array-code source has the same canonical bundle')
  const assistant = toAISDKMessages([{ role: 'assistant', object: project, content: [{ type: 'text', text: 'Changes' }, { type: 'code', text: project.code }] }])[0]
  assert.equal(typeof assistant.content, 'string')
  for (const file of fragmentSourceFiles(project)) assert.ok(String(assistant.content).includes(`FILE: ${file.file_path}\n${file.file_content}`))
  const partial = toAISDKMessages([{ role: 'assistant', object: { ...project, files: [{ file_path: 'components/Hero.tsx' }] }, content: [] }])[0]
  assert.ok(String(partial.content).includes('FILE: pages/index.tsx'), 'Incomplete streamed supporting file does not erase entry context')
  const prompt = toPrompt(templates)
  assert.doesNotMatch(prompt, /exactly one entry file|Write only pages\/index|Inline all UI|Never import from a relative path/)
  assert.match(prompt, /ALL supporting files/)
  assert.match(prompt, /first client render must match/)

  const fixture = {
    output: project,
    seen: [] as { system: string }[],
    edits: { commentary: 'Improve heading', edits: [{ file_path: 'components/Hero.tsx', instruction: 'Use an h1', edit: "import { title } from '../data/site'; export default function Hero(){return <main><h1>{title}</h1></main>}" }] },
    applied: [] as { targetFile: string; initialCode: string; codeEdit: string }[],
  }
  const globals = globalThis as typeof globalThis & { __evoProjectFixture?: typeof fixture }
  globals.__evoProjectFixture = fixture
  const load = async (entry: string) => {
    const result = await build({
      entryPoints: [entry], absWorkingDir: process.cwd(), platform: 'node', format: 'cjs', bundle: true, packages: 'external', write: false,
      plugins: [{ name: 'generated-project-fixture', setup(b) {
        const mocks: Record<string, string> = {
          '@clerk/nextjs/server': 'export async function auth(){return {userId:"fixture-user"}}',
          '@/lib/models': 'export function getModelClient(){return "fixture"};export function hasOwnApiKey(c){return Boolean(c&&c.apiKey)};export function modelRejection(){return null};export function sanitizeModelParams(){return {}}',
          '@/lib/ratelimit': 'export const OWN_KEY_LIMIT_MULTIPLIER=10;export function rateLimitKey(){return "fixture"};export default async function ratelimit(){return false}',
          '@/lib/morph': 'export async function applyPatch(args){globalThis.__evoProjectFixture.applied.push(args);return {code:args.codeEdit}}',
          '@/lib/api-errors': 'export function handleAPIError(error){return Response.json({error:error.message},{status:422})};export function createRateLimitResponse(){return new Response(null,{status:429})}',
          ai: `export async function generateObject(args){globalThis.__evoProjectFixture.seen.push(args);return {object:args.schema.parse(globalThis.__evoProjectFixture.edits)}}
            export async function streamObject(args){const object=args.schema.parse(globalThis.__evoProjectFixture.output);globalThis.__evoProjectFixture.seen.push(args);return {object:Promise.resolve(object),toTextStreamResponse(){return new Response(JSON.stringify(object),{headers:{'Content-Type':'text/plain'}})}}}`,
        }
        b.onResolve({ filter: /^(@clerk\/nextjs\/server|@\/lib\/(models|ratelimit|morph|api-errors)|ai)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }))
      } }],
    })
    const fixtureModule = { exports: {} as { POST: (req: Request) => Promise<Response> } }
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(resolve('lib/generated-project-check.ts')), fixtureModule, fixtureModule.exports)
    return fixtureModule.exports
  }
  const request = (body: unknown) => new Request('http://fixture.invalid/api', { method: 'POST', body: JSON.stringify(body) })
  const base = { messages: [{ role: 'user', content: 'Improve my portfolio' }], model: { id: 'fixture' }, config: { model: 'fixture', apiKey: 'fixture-key' }, template: templates }
  try {
    const morph = await load('app/api/morph-chat/route.ts')
    const updated = await (await morph.POST(request({ ...base, currentFragment: project }))).json() as FragmentSchema
    assert.equal(updated.code, project.code, 'Supporting-file edit preserves the entry')
    assert.equal(updated.files!.find(file => file.file_path === 'data/site.ts')!.file_content, project.files![1].file_content, 'Untouched data survives')
    assert.match(updated.files![0].file_content, /<h1>/)
    assert.equal(fixture.applied[0].targetFile, 'components/Hero.tsx')
    assert.equal(fixture.applied[0].initialCode, project.files![0].file_content)
    for (const file of fragmentSourceFiles(project)) assert.ok(fixture.seen[0].system.includes(file.file_content), 'Morph sees all source')
    fixture.edits = { commentary: 'Add styles', edits: [{ file_path: 'styles/Home.module.css', instruction: 'Add real style', edit: '.heading { color: blue; }' }] }
    const withStyle = await (await morph.POST(request({ ...base, currentFragment: updated }))).json() as FragmentSchema
    assert.equal(withStyle.files!.length, 3)
    assert.equal(fixture.applied.length, 1, 'New full files do not require an extra Morph apply call')
    fixture.edits = { commentary: 'Invalid', edits: [{ file_path: '../escape.ts', instruction: 'Invalid path', edit: 'export const x = 1' }] }
    assert.equal((await morph.POST(request({ ...base, currentFragment: project }))).status, 422)
    assert.equal(fixture.applied.length, 1, 'Invalid paths fail before Morph apply')
    const chat = await load('app/api/chat/route.ts')
    const generated = await (await chat.POST(request(base))).json() as FragmentSchema
    assert.deepEqual(generated, project)
    fixture.output = { ...project, files: [] }
    await assert.rejects((await chat.POST(request(base))).text(), /Web projects require/, 'Incomplete new web bundle cannot finish successfully')
    fixture.output = python
    assert.deepEqual(await (await chat.POST(request(base))).json(), python)
    assert.match(fragmentSourceText(project), /FILE: data\/site.ts/)
    console.log('generated-project-check ok: legacy compatibility, real web bundles, complete edit context, supporting-file Morph edits, source equality, Python and final stream validation')
  } finally { delete globals.__evoProjectFixture }
}

check().catch(error => { console.error(error); process.exitCode = 1 })
