import assert from 'node:assert/strict'
import {
  draftFromSelection,
  isValidPatchedFragment,
  locateSourceSnippet,
  pillInstruction,
  serializeInspectApply,
  toColorInput,
  toCompleteFragment,
} from './inspect'
import { FragmentSchema } from './schema'

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
const next = { ...base, text: 'Listen now' }
const prompt = serializeInspectApply(sel, base, next, '')
assert.ok(prompt.includes('Listen now'))
assert.ok(!prompt.includes('Additional instructions'))
console.log('inspect-check ok')
