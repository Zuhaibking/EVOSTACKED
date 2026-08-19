import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatSkillsForPrompt,
  loadSkills,
  parseSkill,
  selectSkills,
  type Skill,
} from './skills'

const fixture: Skill[] = [
  { name: 'craft', description: '', when: ['always'], body: 'A'.repeat(100) },
  {
    name: 'landing',
    description: '',
    when: ['landing-page'],
    body: 'B'.repeat(100),
  },
  {
    name: 'dash',
    description: '',
    when: ['data-dashboard'],
    body: 'C'.repeat(100),
  },
]

describe('parseSkill', () => {
  it('reads frontmatter and body', () => {
    const skill = parseSkill(
      '---\nname: demo\ndescription: A demo\nwhen: landing-page, data-dashboard\n---\n## Body\ntext',
      'fallback',
    )
    assert.ok(skill)
    assert.equal(skill.name, 'demo')
    assert.equal(skill.description, 'A demo')
    assert.deepEqual(skill.when, ['landing-page', 'data-dashboard'])
    assert.equal(skill.body, '## Body\ntext')
  })

  it('treats a market SKILL.md with no frontmatter as always-on', () => {
    const skill = parseSkill('# Some downloaded skill\nrules', 'find-skills')
    assert.ok(skill)
    assert.equal(skill.name, 'find-skills')
    assert.deepEqual(skill.when, ['always'])
  })

  it('rejects an empty file', () => {
    assert.equal(parseSkill('   ', 'x'), null)
    assert.equal(parseSkill('---\nname: x\n---\n', 'x'), null)
  })
})

describe('selectSkills', () => {
  it('puts the kind-specific skill before the always skill', () => {
    const picked = selectSkills({ kind: 'landing-page', skills: fixture })
    assert.deepEqual(
      picked.map((s) => s.name),
      ['landing', 'craft'],
    )
  })

  it('excludes skills scoped to a different kind', () => {
    const picked = selectSkills({ kind: 'data-dashboard', skills: fixture })
    assert.ok(!picked.some((s) => s.name === 'landing'))
  })

  it('enforces the char budget', () => {
    const picked = selectSkills({
      kind: 'landing-page',
      skills: fixture,
      maxChars: 150,
    })
    assert.deepEqual(
      picked.map((s) => s.name),
      ['landing'],
    )
  })

  it('falls back to always-on skills for an unknown kind', () => {
    const picked = selectSkills({ kind: 'unknown', skills: fixture })
    assert.deepEqual(
      picked.map((s) => s.name),
      ['craft'],
    )
  })
})

describe('formatSkillsForPrompt', () => {
  it('is empty when nothing applies', () => {
    assert.equal(formatSkillsForPrompt([]), '')
  })

  it('includes every selected body', () => {
    const text = formatSkillsForPrompt(fixture.slice(0, 2))
    assert.ok(text.includes('A'.repeat(100)))
    assert.ok(text.includes('B'.repeat(100)))
  })
})

describe('shipped skill packs', () => {
  const skills = loadSkills()

  it('loads the packs from disk', () => {
    assert.ok(skills.length >= 4, `expected 4+ packs, got ${skills.length}`)
  })

  it('every pack has a name and a body', () => {
    for (const skill of skills) {
      assert.ok(skill.name, 'skill missing name')
      assert.ok(skill.body.length > 200, `${skill.name} body too short`)
    }
  })

  it('every stack kind gets its domain pack plus both always-on packs', () => {
    // Regression: at a 9000 char cap the third pack was silently dropped for
    // every kind, including the hero/composition guidance.
    for (const kind of [
      'landing-page',
      'data-dashboard',
      'fullstack-webapp',
    ] as const) {
      const picked = selectSkills({ kind })
      const eligible = skills.filter(
        (s) => s.when.includes(kind) || s.when.includes('always'),
      )
      assert.equal(
        picked.length,
        eligible.length,
        `${kind} dropped ${eligible.length - picked.length} pack(s)`,
      )
      const chars = picked.reduce((sum, s) => sum + s.body.length, 0)
      assert.ok(chars <= 16000, `skills section too large: ${chars}`)
    }
  })

  it('always-on packs reach an unclassified brief', () => {
    const picked = selectSkills({ kind: 'unknown' })
    assert.deepEqual(
      picked.map((s) => s.name).sort(),
      skills.filter((s) => s.when.includes('always')).map((s) => s.name).sort(),
    )
  })
})
