import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildExportCompose,
  buildExportDockerfile,
  buildExportReadme,
  buildExportScorecard,
  enrichProjectExportFiles,
} from './project-export'
import { buildProjectZip } from './project-zip'

const plan = {
  productName: 'Nexus Pass',
  applicationType: 'utility',
  productGoal: 'Issue visitor badges.',
  coreFeatures: ['Check-in', 'Badge print'],
  pages: [{ name: 'Home', path: '/', purpose: 'Landing' }],
}

describe('project export enrichment', () => {
  it('adds README, scorecard, and Next.js Docker files', () => {
    const files = enrichProjectExportFiles(
      [{ path: 'pages/index.tsx', content: 'export default function Page(){return null}' }],
      {
        prompt: 'Build a visitor check-in desk',
        plan,
        variantId: 'minimal',
        scores: { clarity: 0.8, fit: 0.7, polish: 0.9, composite: 0.8 },
        health: { score: 82, statusLabel: 'Good' },
        architectureSummary: 'pass · frontend-only',
        verificationSummary: 'passed · preview=yes',
        smokeSummary: '2/2 · ok',
        repairNotes: null,
        templateId: 'nextjs-developer',
      },
    )
    const paths = files.map((f) => f.path)
    assert.ok(paths.includes('README.md'))
    assert.ok(paths.includes('scorecard.md'))
    assert.ok(paths.includes('Dockerfile'))
    assert.ok(paths.includes('docker-compose.yml'))
    const readme = files.find((f) => f.path === 'README.md')?.content || ''
    assert.match(readme, /Build a visitor check-in desk/)
    assert.match(readme, /Nexus Pass/)
    assert.match(readme, /Product/)
    assert.match(readme, /82\/100/)
    const docker = files.find((f) => f.path === 'Dockerfile')?.content || ''
    assert.match(docker, /FROM node:20-alpine/)
    assert.match(docker, /0\.0\.0\.0/)
    const zip = buildProjectZip(files)
    assert.ok(zip.length > 100)
  })

  it('adds a Vue/Nuxt Dockerfile', () => {
    const docker = buildExportDockerfile('vue-developer')
    assert.ok(docker)
    assert.match(docker, /nuxi|npm run dev/)
    const compose = buildExportCompose('vue-developer')
    assert.match(compose || '', /3000:3000/)
  })

  it('keeps a generated README under docs/APP_README.md', () => {
    const files = enrichProjectExportFiles(
      [{ path: 'README.md', content: '# App notes' }],
      { prompt: 'hello', templateId: 'nextjs-developer' },
    )
    assert.equal(
      files.find((f) => f.path === 'docs/APP_README.md')?.content,
      '# App notes',
    )
    assert.match(files.find((f) => f.path === 'README.md')?.content || '', /hello/)
  })

  it('still writes README/scorecard when Docker is unknown', () => {
    const files = enrichProjectExportFiles([], {
      prompt: 'x',
      templateId: 'code-interpreter-v1',
    })
    assert.ok(files.some((f) => f.path === 'README.md'))
    assert.ok(files.some((f) => f.path === 'scorecard.md'))
    assert.equal(files.some((f) => f.path === 'Dockerfile'), false)
    assert.match(buildExportReadme({ prompt: 'x' }), /x/)
    assert.match(buildExportScorecard({ variantLabel: 'Premium' }), /Premium/)
  })
})
