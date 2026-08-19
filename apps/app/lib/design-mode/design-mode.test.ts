import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import {
  buildStructuralPrompt,
  parseInspectChildMessage,
  parseInspectParentMessage,
  supportsStyleApply,
} from './protocol'
import { coveredStyleProps, mergeClasses, patchToClass } from './tailwind-map'
import { applyPatchesToFragment, rewriteNodeInSource, stampDataOids } from './rewrite-classes'
import { parseGeneratedSource } from '../source-syntax'
import { buildInspectInjectFiles, shouldInjectInspect } from './inject'

const node = {
  tag: 'button',
  text: 'Shop',
  className: 'rounded-full bg-black text-white',
  xpath: '/div[1]/button[1]',
  computed: {},
  rect: { top: 0, left: 0, width: 80, height: 32 },
}

describe('protocol', () => {
  it('accepts child select messages and ignores noise', () => {
    const parsed = parseInspectChildMessage({
      channel: 'evo.inspect',
      type: 'select',
      node,
    })
    assert.equal(parsed?.type, 'select')
    assert.equal(parseInspectChildMessage({ type: 'select' }), null)
  })

  it('parses parent pending patches', () => {
    const parsed = parseInspectParentMessage({
      channel: 'evo.inspect',
      type: 'applyPending',
      patches: [{ prop: 'color', value: '#fff' }, { prop: 'nope', value: 'x' }],
    })
    assert.equal(parsed?.type, 'applyPending')
    if (parsed?.type === 'applyPending') {
      assert.equal(parsed.patches.length, 1)
      assert.equal(parsed.patches[0].prop, 'color')
    }
  })

  it('gates Tailwind apply to Next/Vue', () => {
    assert.equal(supportsStyleApply('nextjs-developer'), true)
    assert.equal(supportsStyleApply('nextjs-developer-dev'), true)
    assert.equal(supportsStyleApply('streamlit-developer'), false)
  })
})

describe('tailwind-map', () => {
  it('covers every palette prop', () => {
    assert.deepEqual(coveredStyleProps().sort(), [
      'alignItems',
      'background',
      'border',
      'borderRadius',
      'boxShadow',
      'color',
      'content',
      'display',
      'flexDirection',
      'fontFamily',
      'fontSize',
      'fontWeight',
      'gap',
      'height',
      'justifyContent',
      'letterSpacing',
      'lineHeight',
      'margin',
      'opacity',
      'padding',
      'textAlign',
      'textDecoration',
      'width',
    ])
  })

  it('maps color, type, layout, and chrome to Tailwind', () => {
    assert.equal(patchToClass({ prop: 'color', value: '#112233' }), 'text-[#112233]')
    assert.equal(patchToClass({ prop: 'background', value: 'rgb(0, 0, 0)' }), 'bg-[#000000]')
    assert.equal(patchToClass({ prop: 'fontWeight', value: '700' }), 'font-bold')
    assert.equal(patchToClass({ prop: 'textAlign', value: 'center' }), 'text-center')
    assert.equal(patchToClass({ prop: 'display', value: 'flex' }), 'flex')
    assert.equal(patchToClass({ prop: 'padding', value: '8px' }), 'p-[8px]')
    assert.equal(patchToClass({ prop: 'borderRadius', value: '0px' }), 'rounded-none')
    assert.equal(patchToClass({ prop: 'content', value: 'Hi' }), null)
  })

  it('replaces conflicting classes instead of stacking', () => {
    const merged = mergeClasses('rounded-full bg-black text-white p-4', [
      { prop: 'background', value: '#fff' },
      { prop: 'padding', value: '12px' },
    ])
    assert.equal(merged.className.includes('bg-black'), false)
    assert.equal(merged.className.includes('bg-[#fff]'), true)
    assert.equal(merged.className.includes('p-4'), false)
    assert.equal(merged.className.includes('p-[12px]'), true)
    assert.equal(merged.className.includes('rounded-full'), true)
  })
})

describe('rewrite-classes', () => {
  it('rewrites a unique className in source', () => {
    const source = `export default function Page(){return <button className="rounded-full bg-black text-white">Shop</button>}`
    const result = rewriteNodeInSource(source, node, [
      { prop: 'background', value: '#fff' },
      { prop: 'content', value: 'Buy' },
    ])
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.match(result.nextContent, /bg-\[#fff\]/)
      assert.match(result.nextContent, />Buy</)
    }
  })

  it('refuses ambiguous classNames and uses oid when present', () => {
    const source = `<button className="btn">A</button><button className="btn">B</button><span data-oid="x:1" className="btn">C</span>`
    const amb = rewriteNodeInSource(source, { ...node, className: 'btn' }, [
      { prop: 'color', value: '#f00' },
    ])
    assert.equal(amb.ok, false)
    if (!amb.ok) assert.equal(amb.reason, 'ambiguous')
    const oid = rewriteNodeInSource(
      source,
      { ...node, className: 'btn', oid: 'x:1' },
      [{ prop: 'color', value: '#f00' }],
    )
    assert.equal(oid.ok, true)
    const byIndex = rewriteNodeInSource(
      `<main><button className="btn">A</button><button className="btn">B</button></main>`,
      { ...node, className: 'btn', oid: 'pages/index.tsx:3' },
      [{ prop: 'color', value: '#111' }],
    )
    assert.equal(byIndex.ok, true)
    if (byIndex.ok) {
      assert.match(byIndex.nextContent, /btn text-\[#111\]">B</)
      assert.match(byIndex.nextContent, /className="btn">A</)
    }
  })

  it('applies into a fragment code array', () => {
    const fragment = {
      template: 'nextjs-developer',
      title: 'Shop',
      description: 'x',
      commentary: 'x',
      architecture: 'x',
      additional_dependencies: [],
      has_additional_dependencies: false,
      install_dependencies_command: '',
      port: 3000,
      file_path: 'pages/index.tsx',
      code: [
        {
          file_path: 'pages/index.tsx',
          file_content:
            'export default function Page(){return <button className="rounded-full bg-black text-white">Shop</button>}',
        },
      ],
    }
    const result = applyPatchesToFragment(fragment, node, [
      { prop: 'color', value: '#111' },
    ])
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.match(String(result.code?.[0] && 'file_content' in result.code[0] ? result.code[0].file_content : ''), /text-\[#111\]/)
    }
  })

  it('stamps data-oid on JSX tags once', () => {
    const stamped = stampDataOids(
      'pages/index.tsx',
      '<main><button className="x">Hi</button></main>',
    )
    assert.match(stamped, /data-oid="pages\/index.tsx:1"/)
    assert.equal(stampDataOids('pages/index.tsx', stamped), stamped)
  })

  it('does not stamp TypeScript generic parameters as JSX tags', () => {
    const source = [
      'const scrollTo = (ref: React.RefObject<HTMLDivElement>) => {',
      '  return <section><div>Hi</div></section>',
      '}',
    ].join('\n')
    const stamped = stampDataOids('pages/index.tsx', source)
    assert.match(stamped, /RefObject<HTMLDivElement>/)
    assert.doesNotMatch(stamped, /HTMLDivElement data-oid/)
    assert.match(stamped, /<section data-oid="pages\/index.tsx:1">/)
    assert.match(stamped, /<div data-oid="pages\/index.tsx:2">/)
  })

  it('heals existing generic data-oid stamps from prior runs', () => {
    const broken = [
      'const scrollTo = (ref: React.RefObject<HTMLDivElement data-oid="pages/index.tsx:4">) => {',
      '  return <section><div>Hi</div></section>',
      '}',
    ].join('\n')
    const healed = stampDataOids('pages/index.tsx', broken)
    assert.match(healed, /RefObject<HTMLDivElement>/)
    assert.doesNotMatch(healed, /HTMLDivElement data-oid/)
    assert.match(healed, /<section data-oid="pages\/index.tsx:1">/)
    assert.equal(parseGeneratedSource('pages/index.tsx', healed).length, 0)
  })
})

describe('inject', () => {
  it('adds the probe and a document hook when missing', () => {
    const files = buildInspectInjectFiles(['pages/index.tsx'])
    assert.ok(files.some((f) => f.file_path === 'public/evo-inspect.js'))
    assert.ok(files.some((f) => f.file_path === 'pages/_document.tsx'))
    assert.equal(buildInspectInjectFiles(['pages/_document.tsx']).length, 1)
    const vue = buildInspectInjectFiles(['app/app.vue'])
    assert.ok(vue.some((f) => f.file_path === 'plugins/evo-inspect.client.ts'))
    assert.ok(!vue.some((f) => f.file_path.includes('_document')))
  })

  it('does not inject on interpreter templates', () => {
    assert.equal(shouldInjectInspect('code-interpreter-v1'), false)
    assert.equal(shouldInjectInspect('nextjs-developer-dev'), true)
  })
})

describe('structural prompt', () => {
  it('keeps Improve on the selected node', () => {
    assert.match(
      buildStructuralPrompt(node, 'Make this a three-column grid'),
      /selected element/,
    )
  })
})

describe('wiring', () => {
  const appRoot = process.cwd()

  function read(rel: string) {
    return fs.readFileSync(path.join(appRoot, rel), 'utf8')
  }

  it('does not import Stagewise or vendor Onlook', () => {
    const files = [
      'lib/design-mode/inject.ts',
      'lib/design-mode/protocol.ts',
      'lib/verify-candidate.ts',
      'components/fragment-web.tsx',
      'components/arena/design-palette.tsx',
      'package.json',
    ]
    for (const file of files) {
      const src = read(file)
      assert.doesNotMatch(src, /@stagewise/)
      assert.doesNotMatch(src, /onlook-dev\/onlook/)
    }
  })

  it('injects the probe at sandbox write, not into fragment.code', () => {
    const verify = read('lib/verify-candidate.ts')
    assert.match(verify, /shouldInjectInspect/)
    assert.match(verify, /buildInspectInjectFiles/)
    assert.match(verify, /stampDataOids/)
    assert.match(verify, /withSandboxCreateLock/)
    assert.match(verify, /shouldRetrySandboxDeploy/)
    assert.match(verify, /warnings\.push\('Inspect probe was not injected/)
  })

  it('keeps Improve chips and docks the palette', () => {
    const design = read('components/arena/design-workspace.tsx')
    const web = read('components/fragment-web.tsx')
    const page = read('app/app/page.tsx')
    assert.match(design, /ASK_QUICK_ACTIONS/)
    assert.match(design, /DESIGN_STARTER_PROMPTS/)
    assert.match(design, /DesignPalette/)
    assert.match(web, /parentMessage/)
    assert.match(web, /Inspect/)
    assert.match(page, /useDesignInspect/)
    assert.match(page, /inspect=\{designInspect\}/)
  })
})
