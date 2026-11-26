import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { candidateHealthLabel } from './candidate-health'
import { injectInspectBridge, inspectBridgeSource } from './inspect-bridge'
import {
  draftFromSelection,
  isValidPatchedFragment,
  locateSourceSnippet,
  locateProjectSourceSnippet,
  pillInstruction,
  serializeInspectApply,
  stableInspectSrc,
  toColorInput,
  toCompleteFragment,
} from './inspect'
import { FragmentSchema, fragmentSourceFiles } from './schema'

const fragment: FragmentSchema = {
  commentary: '',
  template: 'nextjs-developer',
  title: 'App',
  description: '',
  additional_dependencies: [],
  has_additional_dependencies: false,
  install_dependencies_command: '',
  port: 3000,
  file_path: 'pages/index.tsx',
  code: 'export default function Page() {\n  return <button className="play">Play</button>\n}\n',
}

assert.equal(toCompleteFragment(fragment)?.file_path, 'pages/index.tsx')
assert.equal(toCompleteFragment({ ...fragment, code: '' }), null)
assert.equal(
  locateSourceSnippet(fragment.code, {
    tag: 'button',
    id: '',
    className: 'play',
    selector: 'button.play',
    text: 'Play',
    html: '<button class="play">Play</button>',
    rect: { top: 0, left: 0, width: 10, height: 10 },
    styles: {
      fontFamily: 'system-ui',
      fontSize: '14px',
      fontWeight: '600',
      fontStyle: 'normal',
      lineHeight: '20px',
      letterSpacing: '0',
      textAlign: 'center',
      textTransform: 'none',
      textDecoration: 'none',
      color: 'rgb(0,0,0)',
      backgroundColor: 'rgb(255,0,0)',
      display: 'flex',
      width: '80px',
      height: '32px',
      padding: '8px',
      margin: '0px',
      borderRadius: '8px',
      opacity: '1',
      boxShadow: 'none',
      borderWidth: '0px',
      borderStyle: 'none',
      borderColor: 'transparent',
    },
  }).line,
  2,
)
assert.equal(
  isValidPatchedFragment(fragment, { ...fragment, code: 'export default function Page() { return null }' }),
  true,
)
assert.equal(
  isValidPatchedFragment(fragment, { ...fragment, file_path: 'other.tsx', code: 'x' }),
  false,
)
assert.ok(pillInstruction('/modern').includes('modern'))
assert.equal(toColorInput('rgb(255, 0, 0)'), '#ff0000')
const sel = {
  tag: 'button',
  id: '',
  className: 'play',
  selector: 'button.play',
  text: 'Play',
  html: '<button>Play</button>',
  rect: { top: 0, left: 0, width: 10, height: 10 },
  styles: {
    fontFamily: 'system-ui',
    fontSize: '14px',
    fontWeight: '400',
    fontStyle: 'normal',
    lineHeight: '20px',
    letterSpacing: '0',
    textAlign: 'center',
    textTransform: 'none',
    textDecoration: 'none',
    color: 'rgb(0,0,0)',
    backgroundColor: 'rgb(255,0,0)',
    display: 'flex',
    width: '80px',
    height: '32px',
    padding: '8px',
    margin: '0px',
    borderRadius: '8px',
    opacity: '1',
    boxShadow: 'none',
    borderWidth: '0px',
    borderStyle: 'none',
    borderColor: 'transparent',
  },
}
const base = draftFromSelection(sel)
const project: FragmentSchema = {
  ...fragment,
  code: "import Action from '../components/Action'; export default function Page(){return <Action/>}",
  files: [
    { file_path: 'components/Action.tsx', file_content: 'export default function Action(){return <button className="play">Play</button>}' },
    { file_path: 'styles/Action.module.css', file_content: '.action { color: red; }' },
    { file_path: 'data/site.ts', file_content: 'export const title = "Portfolio"' },
  ],
}
assert.deepEqual(toCompleteFragment(project)?.files, project.files, 'Completion retains all supporting source')
assert.equal(toCompleteFragment({ ...project, files: [{ file_path: 'components/Incomplete.tsx' }] }), null, 'Incomplete streamed files must not be dropped')
assert.equal(toCompleteFragment({ ...project, files: [{ file_path: '../escape.ts', file_content: 'x' }] }), null)
assert.equal(toCompleteFragment({ ...project, files: [...project.files!, { file_path: project.file_path, file_content: 'x' }] }), null)
assert.equal(isValidPatchedFragment(project, { ...project, files: project.files!.slice(0, 1) }), false, 'A patch cannot drop old source files')
assert.equal(isValidPatchedFragment(project, { ...project, files: undefined }), false)
assert.equal(isValidPatchedFragment(project, { ...project, files: [...project.files!.slice(0, 2), { file_path: '../escape.ts', file_content: 'x' }] }), false)
assert.equal(isValidPatchedFragment(project, { ...project, files: project.files!.map(file => file.file_path.endsWith('.css') ? { ...file, file_content: '.action { color: blue; }' } : file) }), true)
assert.equal(locateProjectSourceSnippet(project, sel).filePath, 'components/Action.tsx')
assert.equal(locateProjectSourceSnippet(project, sel, 'styles/Action.module.css').filePath, 'styles/Action.module.css')
assert.equal(locateProjectSourceSnippet({ ...project, files: [...project.files!, { file_path: 'components/Other.tsx', file_content: 'export const name = "Play"' }] }, sel).filePath, undefined, 'Ambiguous source matches must not force a target')
assert.equal(locateProjectSourceSnippet(project, null).filePath, undefined)
const next = { ...base, text: 'Listen now' }
const prompt = serializeInspectApply(sel, base, next, '')
assert.ok(prompt.includes('Listen now'))
assert.ok(!prompt.includes('Additional instructions'))
const locked = 'https://sandbox.test/page'
let src = stableInspectSrc(locked, locked, true)
src = stableInspectSrc(src, 'https://sandbox.test/after-a', true)
src = stableInspectSrc(src, 'https://sandbox.test/after-b', true)
src = stableInspectSrc(src, 'https://sandbox.test/after-c', true)
assert.equal(src, locked)
assert.equal(stableInspectSrc(locked, 'https://sandbox.test/after-a', false), 'https://sandbox.test/after-a')

// Run the real browser bridge without a DOM or external sandbox.
const events = new Map<string, (event: any) => void>()
const reports: any[] = []
const logged: unknown[][] = []
const bridgeConsole = { error: (...args: unknown[]) => logged.push(args) }
runInNewContext(inspectBridgeSource(), {
  window: { addEventListener: (type: string, listener: (event: any) => void) => events.set(type, listener) },
  document: { addEventListener: () => {} },
  parent: { postMessage: (message: unknown) => reports.push(message) },
  console: bridgeConsole,
  Error,
  // The bridge watches renders (1f4a1d8); this fake DOM has no documentElement, so it never observes.
  MutationObserver: class { observe() {} disconnect() {} takeRecords() { return [] } },
  // Inert timers: the bridge polls renders every 250 ms, and a real interval would keep this process alive.
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout: () => 0,
  clearTimeout: () => {},
})
events.get('error')!({ message: 'ReferenceError: window is not defined' })
events.get('unhandledrejection')!({ reason: new Error('Promise crashed') })
events.get('error')!({ message: 'ReferenceError: window is not defined' })
bridgeConsole.error('Warning: Text content did not match. Server: %s Client: %s', 'before', 'after')
bridgeConsole.error('Warning: Text content did not match. Server: %s Client: %s', 'before', 'after')
bridgeConsole.error('Ordinary diagnostic output')
bridgeConsole.error('Hydrating local cache')
const circular: any = {}
circular.self = circular
bridgeConsole.error('Hydration failed', circular)
const errors = reports.filter((message) => message.type === 'runtime-error')
assert.equal(errors.length, 4, 'runtime reports must dedupe and exclude ordinary console messages')
assert.ok(errors.every((message) => message.source === 'evostack-inspect' && typeof message.payload.message === 'string'))
assert.equal(errors[1].payload.message, 'Promise crashed')
assert.ok(errors[2].payload.message.includes('before after'))
assert.equal(logged.length, 5, 'the original console.error must still receive every call')
assert.equal(candidateHealthLabel('done', undefined, 'starting'), 'Preparing preview')
assert.equal(candidateHealthLabel('done', undefined, 'ready'), 'Preview ready')
assert.equal(candidateHealthLabel('done', undefined, 'error'), 'Preview failed')

async function checkBridgeInjection() {
  const files = new Map([
    ['pages/_document.tsx', '<Head><script src="/__evo_inspect.js" defer /></Head>'],
  ])
  await injectInspectBridge({ files: {
    read: async (path) => {
      if (!files.has(path)) throw new Error('missing')
      return files.get(path)!
    },
    write: async (path, content) => { files.set(path, content) },
  } })
  assert.equal(files.get('pages/_document.tsx'), '<Head><script src="/__evo_inspect.js" /></Head>')
  assert.ok(files.get('public/__evo_inspect.js')?.includes("send('runtime-error'"))
}
async function checkProjectAPI() {
  const fixture = {
    edit: { commentary: 'Improve action', instruction: 'Change button text', file_path: 'components/Action.tsx', edit: 'export default function Action(){return <button className="play">Listen</button>}' },
    prompts: [] as string[],
    applies: [] as { targetFile: string; initialCode: string; codeEdit: string }[],
  }
  const globals = globalThis as typeof globalThis & { __evoInspectFixture?: typeof fixture }
  globals.__evoInspectFixture = fixture
  const bundled = await build({
    entryPoints: ['app/api/inspect/route.ts'], absWorkingDir: process.cwd(), platform: 'node', format: 'cjs', bundle: true, packages: 'external', write: false,
    define: { 'process.env.MORPH_API_KEY': '"fixture-only-key"' },
    plugins: [{ name: 'inspect-project-fixture', setup(b) {
      const mocks: Record<string, string> = {
        '@clerk/nextjs/server': 'export async function auth(){return {userId:"fixture-user"}}',
        '@/lib/models': 'export function getModelClient(){return "fixture"};export function hasOwnApiKey(c){return Boolean(c&&c.apiKey)};export function modelRejection(){return null};export function sanitizeModelParams(){return {}}',
        '@/lib/ratelimit': 'export const OWN_KEY_LIMIT_MULTIPLIER=10;export function rateLimitKey(){return "fixture"};export default async function ratelimit(){return false}',
        '@/lib/morph': 'export async function applyPatch(args){globalThis.__evoInspectFixture.applies.push(args);return {code:args.codeEdit}}',
        '@/lib/api-errors': 'export function handleAPIError(error){return Response.json({error:error.message},{status:422})};export function createRateLimitResponse(){return new Response(null,{status:429})}',
        ai: 'export async function generateObject(args){globalThis.__evoInspectFixture.prompts.push(args.system);return {object:args.schema.parse(globalThis.__evoInspectFixture.edit)}}',
      }
      b.onResolve({ filter: /^(@clerk\/nextjs\/server|@\/lib\/(models|ratelimit|morph|api-errors)|ai)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }))
    } }],
  })
  const fixtureModule = { exports: {} as { POST: (req: Request) => Promise<Response> } }
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(resolve('lib/inspect-check.ts')), fixtureModule, fixtureModule.exports)
  const post = (targetFile?: string) => fixtureModule.exports.POST(new Request('http://fixture.invalid/api/inspect', { method: 'POST', body: JSON.stringify({ fragment: project, selection: sel, instruction: 'Improve selected element', targetFile, model: { id: 'fixture' }, config: { model: 'fixture', apiKey: 'fixture-key' } }) }))
  try {
    const response = await post('components/Action.tsx')
    assert.equal(response.status, 200)
    const updated = await response.json() as FragmentSchema
    assert.equal(updated.code, project.code, 'Component edit preserves the entry')
    assert.match(updated.files![0].file_content, /Listen/)
    assert.deepEqual(updated.files!.slice(1), project.files!.slice(1), 'Untouched styles/data remain exact')
    assert.equal(fixture.applies[0].targetFile, 'components/Action.tsx')
    assert.equal(fixture.applies[0].initialCode, project.files![0].file_content)
    for (const file of fragmentSourceFiles(project)) assert.ok(fixture.prompts[0].includes(file.file_content), 'Model sees every source file')
    assert.equal((await post('../escape.ts')).status, 400)
    assert.equal((await post('components/Missing.tsx')).status, 400)
    assert.equal(fixture.prompts.length, 1, 'Invalid requested targets fail before model calls')
    fixture.edit = { ...fixture.edit, file_path: 'styles/Action.module.css', edit: '.action { color: blue; }' }
    assert.equal((await post('components/Action.tsx')).status, 422, 'An explicit target cannot be overridden')
    assert.equal(fixture.applies.length, 1)
    const style = await (await post()).json() as FragmentSchema
    assert.equal(style.code, project.code)
    assert.equal(style.files![1].file_content, '.action { color: blue; }', 'Automatic selection can patch a supporting stylesheet')
    assert.equal(fixture.applies.at(-1)!.initialCode, project.files![1].file_content)
    fixture.edit = { ...fixture.edit, file_path: 'data/site.ts', edit: 'export const title = "Revised portfolio"' }
    const data = await (await post('data/site.ts')).json() as FragmentSchema
    assert.equal(data.files![2].file_content, 'export const title = "Revised portfolio"')
    assert.equal(data.files![0].file_content, project.files![0].file_content)
    fixture.edit = { ...fixture.edit, file_path: '../escape.ts' }
    assert.equal((await post()).status, 422)
  } finally { delete globals.__evoInspectFixture }
}
Promise.all([checkBridgeInjection(), checkProjectAPI()]).then(() => console.log('inspect-check ok: bridge, complete project preservation, component/styles/data targets and source validation')).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
