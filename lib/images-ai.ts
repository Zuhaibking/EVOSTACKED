import { imageCacheKey } from './images-cache'
import {
  providerAvailable,
  recordProvider,
  validateImageBytes,
  type ImageAspect,
} from './images-shared'

const OPENAI_IMAGES = 'https://api.openai.com/v1/images/generations'
const DEFAULT_MODELS = 'gpt-image-2.6-flare,gpt-image-1-mini'
/** One image, whole model chain included (flare answers in ~6 s, gpt-image-1-mini in ~13 s). */
export const AI_IMAGE_TIMEOUT_MS = 20_000
/** A rate-limit burst pauses AI briefly; outages and timeouts use the default 5 minutes. */
const RATE_LIMIT_COOLDOWN_MS = 60_000
/** Breaker name shared by every model in the chain. */
export const AI_PROVIDER = 'openai-images'

/**
 * Why no image came back. 'refused' (content policy) is a verdict on the
 * subject; everything else is the service, the key, or the clock.
 */
export type AiFailure = 'refused' | 'unavailable' | 'failed' | 'aborted'

export type AiImageResult = { image: AiImage; reason?: undefined } | { image: null; reason: AiFailure }

export type ImageContext = { title?: string; description?: string; brand?: string }

export type AiImagePlan = {
  query: string
  aspect: ImageAspect
  size: string
  prompt: string
  /** sha256(model chain + size + final prompt): the disk cache key. */
  key: string
}

export type AiImage = AiImagePlan & {
  bytes: Uint8Array
  mime: string
  ext: string
  model: string
}

const SIZES: Record<ImageAspect, string> = {
  landscape: '1536x1024',
  portrait: '1024x1536',
  square: '1024x1024',
}

const HEADSHOT_RE = /\b(portraits?|headshots?|head shots?|avatars?|profile (?:photo|picture|pic)s?)\b/i
const PEOPLE_RE = /\b(team members?|founders?|co-?founders?|ceo|cto|coo|cfo|testimonials?|staff photos?|employees?|instructors?|doctors?|dentists?|therapists?|lawyers?|attorneys?|stylists?|person|man|woman|girl|boy)\b/i
const GROUP_RE = /\b(people|team|teams|friends|couples?|family|families|customers|crowd|group|students|colleagues|guests|diners|shoppers|workers)\b/i
const FOOD_RE = /\b(food|foods|dish|dishes|meal|meals|cuisine|pizza|burgers?|sushi|ramen|noodles?|pasta|salads?|desserts?|cakes?|pastr(?:y|ies)|croissants?|bread|bakery|breakfast|brunch|lunch|dinner|steak|tacos?|curry|biryani|dumplings?|coffee|espresso|latte|cappuccino|tea|cocktails?|wine|beer|smoothies?|juice|plated|plating|menu)\b/i
const PLACE_RE = /\b(interiors?|rooms?|lobby|lobbies|office|offices|showroom|restaurant|caf[eé]s?|bar|lounge|kitchen|bedroom|living room|hotel|resort|spa|gym|store|shop|boutique|gallery|building|architecture|facade|façade|house|home|villa|apartment|venue|hall|campus|classroom|clinic|workspace|coworking|exterior|courtyard|terrace|warehouse|factory)\b/i

/** Comma-separated chain from EVOSTACK_IMAGE_MODELS; the first model that answers wins. */
export function aiImageModels(): string[] {
  const raw = process.env.EVOSTACK_IMAGE_MODELS || DEFAULT_MODELS
  const models = raw.split(',').map((m) => m.trim()).filter((m) => /^[\w.-]{1,64}$/.test(m))
  return models.length ? models : DEFAULT_MODELS.split(',')
}

export function aiImageQuality(): string {
  const q = (process.env.EVOSTACK_IMAGE_QUALITY || 'medium').trim().toLowerCase()
  return ['low', 'medium', 'high', 'auto'].includes(q) ? q : 'medium'
}

/** Server key only; a client-supplied key never reaches this module. */
export function aiImagesConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim())
}

/** Portrait/headshot/avatar wording, or a single person or role ("smiling dentist"), not a group scene. */
export function isHeadshot(subject: string): boolean {
  return HEADSHOT_RE.test(subject) || (PEOPLE_RE.test(subject) && !GROUP_RE.test(subject))
}

/** People shots default to a square headshot; everything else to landscape. */
export function defaultImageAspect(query: string): ImageAspect {
  return isHeadshot(subjectPhrase(query)) ? 'square' : 'landscape'
}

export function aspectSize(aspect: ImageAspect): string {
  return SIZES[aspect] || SIZES.landscape
}

/** Deterministic prompt, size and cache key for one image (no network). */
export function planAiImage(query: string, context: ImageContext = {}, aspect?: ImageAspect): AiImagePlan {
  const subject = clip(query, 400)
  const head = subjectPhrase(subject)
  const people = isHeadshot(head)
  const finalAspect: ImageAspect = aspect || (people ? 'square' : 'landscape')
  const size = aspectSize(finalAspect)
  const style = people
    ? 'Professional portrait headshot: a single person, head and shoulders, facing the camera with a natural friendly expression, soft studio lighting, softly blurred neutral background, shallow depth of field, 85mm lens.'
    : GROUP_RE.test(head)
      ? 'Candid lifestyle photography: real people in a natural moment, genuine expressions, soft natural light, authentic and diverse.'
      : FOOD_RE.test(subject)
      ? 'Appetizing food photography: styled and freshly prepared, natural window light, shallow depth of field, rich true-to-life colors.'
      : PLACE_RE.test(head)
        ? 'Architectural and interior photography: balanced natural light, straight verticals, wide but natural perspective, inviting atmosphere.'
        : 'Professional commercial photography: well-lit subject, considered composition, clean uncluttered background.'
  const site = [clip(context.title, 80), clip(context.description, 220)].filter(Boolean).join(' — ')
  const brand = clip(context.brand, 160)
  const prompt = [
    site ? `Professional photograph for the website of ${site}.` : 'Professional photograph for a modern business website.',
    brand ? `Brand mood: ${brand}.` : '',
    `Subject: ${subject}.`,
    style,
    'Photorealistic, editorial look, high detail, sharp focus, natural colors, realistic proportions.',
    'No text, no letters, no captions, no watermark, no signage text, no added logos or brand marks, no borders, no collage.',
  ].filter(Boolean).join(' ')
  return {
    query: subject,
    aspect: finalAspect,
    size,
    prompt,
    key: imageCacheKey(aiImageModels().join(','), size, prompt),
  }
}

type AiImageArgs = {
  query: string
  context?: ImageContext
  aspect?: ImageAspect
  signal?: AbortSignal
  /** Window for the whole model chain. */
  timeoutMs?: number
  /** The resolver shortened the window to keep budget for stock; its expiry is not a provider failure. */
  shortened?: boolean
}

/**
 * Generates one photo with the OpenAI Images API. Returns null (the caller
 * falls back to stock, then a placeholder) on content-policy rejections, auth
 * errors, an exhausted model chain, a timeout, or invalid bytes.
 */
export async function generateAiImage(args: AiImageArgs): Promise<AiImage | null> {
  return (await generateAiImageResult(args)).image
}

/**
 * generateAiImage with the failure reason. The chain moves to the next model
 * only when a model is missing or unsupported (404 / model errors); a
 * timeout, 429, 5xx or network error ends the attempt so the caller can use
 * stock while it still has time.
 */
export async function generateAiImageResult({
  query,
  context,
  aspect,
  signal,
  timeoutMs = AI_IMAGE_TIMEOUT_MS,
  shortened = false,
}: AiImageArgs): Promise<AiImageResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey || !query.trim()) return { image: null, reason: 'unavailable' }
  const plan = planAiImage(query, context, aspect)
  const window = AbortSignal.timeout(Math.max(1, timeoutMs))
  const attempt = signal ? AbortSignal.any([signal, window]) : window
  for (const model of aiImageModels()) {
    if (signal?.aborted) return { image: null, reason: 'aborted' }
    if (window.aborted) break
    // Another request may have opened the breaker while this one waited.
    if (!providerAvailable(AI_PROVIDER)) return { image: null, reason: 'unavailable' }
    const started = Date.now()
    try {
      const res = await fetch(OPENAI_IMAGES, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: plan.prompt,
          size: plan.size,
          quality: aiImageQuality(),
          output_format: 'webp',
          output_compression: 80,
          n: 1,
        }),
        signal: attempt,
      })
      const data = (await res.json().catch(() => null)) as {
        data?: { b64_json?: unknown }[]
        error?: { code?: unknown; type?: unknown; message?: unknown }
      } | null
      attempt.throwIfAborted()
      if (!res.ok) {
        const code = String(data?.error?.code || data?.error?.type || '')
        const message = String(data?.error?.message || '').slice(0, 200)
        console.warn(`[images] ai ${model} http ${res.status}${code ? ` ${code}` : ''}${message ? `: ${message}` : ''}`)
        if (/moderation|content_policy|safety/i.test(`${code} ${message}`)) {
          recordProvider(AI_PROVIDER, true)
          return { image: null, reason: 'refused' }
        }
        if (modelUnsupported(res.status, code, message)) continue
        if (res.status === 401 || res.status === 429 || res.status >= 500) {
          recordProvider(AI_PROVIDER, false, res.status === 429 ? RATE_LIMIT_COOLDOWN_MS : undefined)
          return { image: null, reason: 'unavailable' }
        }
        return { image: null, reason: 'failed' }
      }
      const b64 = data?.data?.[0]?.b64_json
      const bytes = typeof b64 === 'string' ? new Uint8Array(Buffer.from(b64, 'base64')) : new Uint8Array()
      const valid = validateImageBytes(bytes, 'image/webp')
      if (!valid) {
        console.warn(`[images] ai ${model} returned invalid image bytes`)
        continue
      }
      recordProvider(AI_PROVIDER, true)
      console.log(`[images] ai ${model} ${plan.size} ${Math.round(bytes.byteLength / 1024)}KB in ${Date.now() - started}ms: ${plan.query}`)
      return { image: { ...plan, bytes, mime: valid.mime, ext: valid.ext, model } }
    } catch (err) {
      if (signal?.aborted) return { image: null, reason: 'aborted' }
      const timedOut = window.aborted
      if (!timedOut || !shortened) recordProvider(AI_PROVIDER, false)
      console.warn(timedOut
        ? `[images] ai ${model} timed out after ${timeoutMs}ms`
        : `[images] ai ${model} failed: ${err instanceof Error ? err.message : String(err)}`)
      return { image: null, reason: 'unavailable' }
    }
  }
  // Every model in the chain is missing or returned junk: a configuration problem, not this subject.
  if (!window.aborted) recordProvider(AI_PROVIDER, false)
  return { image: null, reason: 'unavailable' }
}

/** Missing model, no access to it, or a parameter it does not support: try the next model. */
function modelUnsupported(status: number, code: string, message: string): boolean {
  if (status === 404) return true
  if (status !== 400 && status !== 403) return false
  return /model|unsupported|not supported|does not exist|verif/i.test(`${code} ${message}`)
}

/** "black sedan in a dark showroom, studio lighting" → "black sedan": the photo's subject, not its setting. */
export function subjectPhrase(query: string): string {
  const head = query.split(/[,;|]/)[0]
  const cut = head.search(/\s(?:in|on|at|inside|against|with|near|under|over|by|from|during)\s/i)
  return (cut > 0 ? head.slice(0, cut) : head).trim() || query.trim()
}

function clip(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}
