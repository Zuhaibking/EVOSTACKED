import assert from 'node:assert/strict'
import { detectDataCollection } from './detect-data-collection'

assert.equal(
  detectDataCollection([
    { file_path: 'pages/index.tsx', file_content: 'export default function Page(){return <h1>Hi</h1>}' },
  ]),
  false,
)

assert.equal(
  detectDataCollection([
    {
      file_path: 'pages/index.tsx',
      file_content: '<form onSubmit={send}><input name="email" /></form>',
    },
  ]),
  true,
)

assert.equal(
  detectDataCollection([
    { file_path: 'index.html', file_content: '<input type="email" name="email" />' },
  ]),
  true,
)

assert.equal(
  detectDataCollection([
    { file_path: 'pages/index.tsx', file_content: '<input type="tel" name="phone" />' },
  ]),
  true,
)

console.log('detect-data-collection-check ok')
