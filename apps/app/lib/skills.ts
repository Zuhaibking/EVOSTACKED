/**
 * Skill packs — domain guidance injected into the generation system prompt.
 *
 * One SKILL.md per file in lib/skills/. Format matches the agent-skills
 * convention (`npx skills add <pkg>`), so a downloaded SKILL.md can be dropped
 * into lib/skills/ and is picked up with no code change.
 *
 * Server-side only (reads from disk). ZERO network / LLM calls.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AppStackKind } from '@/lib/stack-advisor'

export type Skill = {
  name: string
  description: string
  /** Stack kinds this applies to. 'always' matches every generation. */
  when: string[]
  body: string
}

/**
 * Keeps skills from crowding out the plan + template sections.
 * Sized so a domain pack + both always-on packs fit — at 9000 the third pack
 * was silently dropped for every stack kind.
 */
export const SKILL_PROMPT_MAX_CHARS = 16000

const SKILLS_DIR = join(__dirname, 'skills')

/**
 * Minimal frontmatter reader — `key: value` lines between --- fences.
 * Avoids a YAML dependency for a 3-key header.
 */
export function parseSkill(source: string, fallbackName: string): Skill | null {
  const body = source.trim()
  if (!body) return null

  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(body)
  const meta: Record<string, string> = {}
  let content = body

  if (match) {
    content = match[2].trim()
    for (const line of match[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(line.trim())
      if (kv) meta[kv[1].toLowerCase()] = kv[2].trim()
    }
  }

  if (!content) return null

  return {
    name: meta.name || fallbackName,
    description: meta.description || '',
    // A market SKILL.md has no `when` — treat it as generally applicable and
    // let the char budget decide whether it makes the cut.
    when: (meta.when || 'always')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    body: content,
  }
}

let cached: Skill[] | null = null

/** All skills on disk, name-sorted for deterministic prompts. */
export function loadSkills(): Skill[] {
  if (cached) return cached
  let files: string[] = []
  try {
    files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.md'))
  } catch {
    // No skills directory — generation still works, just without packs.
    cached = []
    return cached
  }

  const skills: Skill[] = []
  for (const file of files.sort()) {
    try {
      const parsed = parseSkill(
        readFileSync(join(SKILLS_DIR, file), 'utf8'),
        file.replace(/\.md$/, ''),
      )
      if (parsed) skills.push(parsed)
    } catch {
      /* unreadable skill file is skipped, never fatal */
    }
  }
  cached = skills
  return cached
}

/** Test hook — drops the module-level cache. */
export function clearSkillCache(): void {
  cached = null
}

/**
 * Kind-specific skills first, then 'always', capped by char budget.
 * Deterministic: same inputs produce the same prompt (and the same cache key).
 */
export function selectSkills(opts: {
  kind?: AppStackKind | null
  maxChars?: number
  skills?: Skill[]
}): Skill[] {
  const all = opts.skills ?? loadSkills()
  const kind = (opts.kind || 'unknown').toLowerCase()
  const budget = opts.maxChars ?? SKILL_PROMPT_MAX_CHARS

  const specific = all.filter((s) => s.when.includes(kind))
  const general = all.filter(
    (s) => s.when.includes('always') && !specific.includes(s),
  )

  const picked: Skill[] = []
  const dropped: string[] = []
  let used = 0
  for (const skill of [...specific, ...general]) {
    if (used + skill.body.length > budget) {
      dropped.push(skill.name)
      continue
    }
    picked.push(skill)
    used += skill.body.length
  }
  // Never drop guidance silently — a missing pack looks identical to a pack
  // the model ignored, and that is very expensive to debug from output alone.
  if (dropped.length) {
    console.warn(
      `[evostack:skills] budget ${budget} exceeded for kind "${kind}" — dropped: ${dropped.join(', ')}`,
    )
  }
  return picked
}

/** Prompt section for the selected skills. Empty string when none apply. */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (!skills.length) return ''
  return `## Applied skill packs
Treat these as craft standards for this build. The shared product spec still wins on scope.

${skills.map((s) => s.body).join('\n\n---\n\n')}
`
}

/** One-call helper for the generation prompt builders. */
export function buildSkillsSection(opts: {
  kind?: AppStackKind | null
  maxChars?: number
}): string {
  return formatSkillsForPrompt(selectSkills(opts))
}
