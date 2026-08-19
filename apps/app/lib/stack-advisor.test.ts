import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import templates, { getTemplateId } from './templates'
import {
  adviseStacks,
  classifyAppStack,
  clearStackAdvisorCache,
} from './stack-advisor'
import { assignDiverseTemplates } from './tournament-generation'

describe('stack advisor', () => {
  it('classifies CSV analysis as a data dashboard', () => {
    assert.equal(
      classifyAppStack({ prompt: 'CSV analyzer for sales exports with charts' }),
      'data-dashboard',
    )
  })

  it('classifies a CRM plan as fullstack', () => {
    assert.equal(
      classifyAppStack({
        prompt: 'Build it',
        plan: {
          applicationType: 'CRM',
          architectureRequirements: {
            backend: { required: true },
            database: { required: true },
            authentication: { required: true },
          },
        } as any,
      }),
      'fullstack-webapp',
    )
  })

  it('falls back to unknown for a generic budget tracker', () => {
    assert.equal(
      classifyAppStack({ prompt: 'A personal budget tracker' }),
      'unknown',
    )
  })

  it('assigns Streamlit, Gradio, Next.js for a CSV analyzer', () => {
    clearStackAdvisorCache()
    const advice = adviseStacks({
      prompt: 'CSV analyzer with charts',
      catalog: templates,
    })
    assert.equal(advice.kind, 'data-dashboard')
    const bases = advice.picks.map((p) => p.baseId)
    assert.deepEqual(bases, [
      'streamlit-developer',
      'gradio-developer',
      'nextjs-developer',
    ])
    assert.equal(new Set(bases).size, 3)
  })

  it('repeats a web stack when only Next/Vue fit fullstack', () => {
    clearStackAdvisorCache()
    const assigned = assignDiverseTemplates({
      catalog: templates,
      variantIds: ['minimal', 'rich', 'playful'],
      prompt: 'Team CRM',
      plan: {
        applicationType: 'CRM',
        architectureRequirements: {
          backend: { required: true },
          database: { required: true },
          authentication: { required: true },
        },
      } as any,
    })
    const ids = ['minimal', 'rich', 'playful'].map((id) =>
      getTemplateId(assigned[id as 'minimal'].id),
    )
    assert.ok(ids.every((id) => id === 'nextjs-developer' || id === 'vue-developer'))
    assert.equal(new Set(ids).size, 2)
    assert.equal(assigned.playful.repeated, true)
    assert.match(assigned.playful.stackLabel, /repeat/i)
  })

  it('skips the advisor when the user picked one template', () => {
    const key = Object.keys(templates).find((k) =>
      getTemplateId(k).includes('streamlit'),
    )!
    const single = {
      [key]: templates[key as keyof typeof templates],
    } as typeof templates
    const assigned = assignDiverseTemplates({
      catalog: single,
      variantIds: ['minimal', 'rich', 'playful'],
      prompt: 'CSV analyzer with charts',
    })
    assert.equal(getTemplateId(assigned.minimal.id), 'streamlit-developer')
    assert.equal(assigned.minimal.id, assigned.rich.id)
    assert.equal(assigned.rich.id, assigned.playful.id)
  })

  it('repeats a web stack for landing pages when only Next/Vue fit', () => {
    clearStackAdvisorCache()
    const advice = adviseStacks({
      prompt: 'landing page for a waitlist',
      catalog: templates,
    })
    assert.equal(advice.kind, 'landing-page')
    const bases = advice.picks.map((p) => p.baseId)
    assert.ok(bases.every((id) => id === 'nextjs-developer' || id === 'vue-developer'))
    assert.equal(new Set(bases).size, 2)
    assert.equal(advice.picks[2]?.repeated, true)
    assert.match(advice.picks[2]?.stackLabel || '', /repeat/i)
  })

  it('caches identical prompt + plan + catalog', () => {
    clearStackAdvisorCache()
    const a = adviseStacks({ prompt: 'landing page for a waitlist', catalog: templates })
    const b = adviseStacks({ prompt: 'landing page for a waitlist', catalog: templates })
    assert.equal(a, b)
    assert.equal(a.kind, 'landing-page')
  })
})
