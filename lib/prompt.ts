import { fragmentCodeText } from '@/lib/schema'
import { Templates, templatesToPrompt } from '@/lib/templates'

/** Only what the prompt needs from the fragment being edited; a full FragmentSchema satisfies it. */
export type PromptFragment = { file_path?: string; code?: unknown }

const RULES = `
    You are a skilled software engineer.
    You do not make mistakes.
    Generate an fragment.
    You can install additional dependencies.
    Do not touch project dependencies files like package.json, package-lock.json, requirements.txt, etc.
    Do not wrap code in backticks.
    Always break the lines correctly.
    The sandbox writes exactly one entry file. Put every component, helper, style, and mock dataset in that file. Never import from a relative path (../data, ./utils, ./components) — those files are not created. Existing template modules are fine (react, next, @/components/ui/*, @/lib/utils).
    First paint must not crash: do not read properties of values that may be null or undefined (empty selection, empty cart, closed dialog).`

const IMAGES = `
    IMAGES:
    Never invent a stock photo URL. Never use source.unsplash.com (it has answered 503 since 2024) and never hardcode an images.unsplash.com/photo-<id> URL — those ids are guesses and render as broken images.
    For every photo write src="https://picsum.photos/seed/<slug>/<width>/<height>", where <slug> is 3 to 6 hyphenated lowercase words naming the subject, concrete noun first — for example https://picsum.photos/seed/sourdough-loaf-bakery-counter/1200/800. The slug is the search query a later pass uses to swap in a matching real photo, so make it specific to that one image and never repeat a slug.
    Always use a plain <img>, never next/image: the sandbox runs a stock create-next-app whose next.config declares no images.remotePatterns, so next/image throws on any remote host and takes the whole page down.
    Give every <img> a real alt describing that specific photo, and onError={(e) => { e.currentTarget.src = IMG_FALLBACK }} where IMG_FALLBACK is a single local constant declared once in the file (an inline data: SVG or a solid-colour block) so an image that dies later degrades instead of breaking.`

/**
 * The file the user is editing. Absent on a first generation.
 * ponytail: pastes the whole file with no truncation — fine for the single entry file this
 * schema emits; if fragments ever get big, send a diff instead (that is what /api/morph-chat does).
 */
function toCurrentFileBlock(fragment?: PromptFragment) {
  const code = fragmentCodeText(fragment?.code)
  if (!code.trim()) return ''
  return `
    CURRENT FILE: ${fragment?.file_path || 'pages/index.tsx'}
    \`\`\`
${code}
    \`\`\`
    Edit this file. Return the COMPLETE updated file, not a diff and not an excerpt. Keep everything the user did not ask you to change, including the existing image URLs.`
}

export function toPrompt(template: Templates, currentFragment?: PromptFragment) {
  return `${RULES}
${IMAGES}
    You can use one of the following templates:
    ${templatesToPrompt(template)}${toCurrentFileBlock(currentFragment)}
  `
}
