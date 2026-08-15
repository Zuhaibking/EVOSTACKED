import { ApplicationPlan } from '@/lib/plan'
import {
  SmokeAction,
  SmokeSuiteResult,
  SmokeTest,
  SmokeTestResult,
  deriveSmokeTests,
  isBrowserTestableTemplate,
  notTestableSuite,
  shouldSmokeTest,
  validateSmokeSuiteResult,
} from '@/lib/smoke'
import { truncateDiagnostic } from '@/lib/verification'
import { VerificationResult } from '@/lib/verification'
import type { Page } from 'playwright'

const NAV_TIMEOUT_MS = 20_000
const ACTION_TIMEOUT_MS = 8_000
const SUITE_TIMEOUT_MS = 90_000
const TEST_TIMEOUT_MS = 35_000

function roleNamePattern(name?: string): string | RegExp | undefined {
  if (!name) return undefined
  // Treat /(a|b)/ style as RegExp; otherwise exact-ish case-insensitive match.
  if (name.startsWith('(') && name.endsWith(')')) {
    try {
      return new RegExp(name, 'i')
    } catch {
      return name
    }
  }
  return new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
}

async function runAction(page: Page, action: SmokeAction): Promise<string> {
  switch (action.type) {
    case 'goto': {
      const url = new URL(action.path, page.url()).toString()
      const res = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      })
      if (res && res.status() >= 500) {
        throw new Error(`Navigation returned HTTP ${res.status()}`)
      }
      return `goto ${action.path}`
    }
    case 'clickRole': {
      const locator = page.getByRole(action.role as any, {
        name: roleNamePattern(action.name),
      })
      await locator.first().click({ timeout: ACTION_TIMEOUT_MS })
      return `clickRole ${action.role}${action.name ? `:${action.name}` : ''}`
    }
    case 'fillRole': {
      // Prefer accessible name; fall back to placeholder when provided by contract.
      if (action.name) {
        const byName = page.getByRole(action.role as any, {
          name: roleNamePattern(action.name),
        })
        if ((await byName.count()) > 0) {
          await byName.first().fill(action.value, { timeout: ACTION_TIMEOUT_MS })
          return `fillRole ${action.role}:${action.name}`
        }
      }
      if (action.placeholder) {
        const byPh = page.getByPlaceholder(action.placeholder, { exact: false })
        await byPh.first().fill(action.value, { timeout: ACTION_TIMEOUT_MS })
        return `fillPlaceholder ${action.placeholder}`
      }
      const locator = page.getByRole(action.role as any, {
        name: roleNamePattern(action.name),
      })
      await locator.first().fill(action.value, { timeout: ACTION_TIMEOUT_MS })
      return `fillRole ${action.role}`
    }
    case 'clickText': {
      await page
        .getByText(action.text, { exact: true })
        .first()
        .click({ timeout: ACTION_TIMEOUT_MS })
      return `clickText ${action.text}`
    }
    case 'clickTestId': {
      await page
        .getByTestId(action.testId)
        .first()
        .click({ timeout: ACTION_TIMEOUT_MS })
      return `clickTestId ${action.testId}`
    }
    case 'press': {
      await page.keyboard.press(action.key)
      return `press ${action.key}`
    }
    case 'expectText': {
      await page
        .getByText(action.text, { exact: false })
        .first()
        .waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
      return `expectText ${action.text}`
    }
    case 'expectUrl': {
      if (!action.includes) return 'expectUrl (skipped empty)'
      const deadline = Date.now() + ACTION_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (page.url().includes(action.includes)) {
          return `expectUrl ${action.includes}`
        }
        await page.waitForTimeout(200)
      }
      throw new Error(
        `URL did not include "${action.includes}" (was ${page.url()})`,
      )
    }
    case 'expectHeading': {
      const heading = page.getByRole('heading')
      if (action.text) {
        await page
          .getByRole('heading', { name: roleNamePattern(action.text) })
          .first()
          .waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
        return `expectHeading ${action.text}`
      }
      // Any heading OR substantial body text proves the app rendered.
      const count = await heading.count()
      if (count > 0) {
        await heading.first().waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
        return 'expectHeading (any)'
      }
      const body = (await page.locator('body').innerText()).trim()
      if (body.length < 8) {
        throw new Error('Page body appears empty')
      }
      return 'expectHeading (body content)'
    }
    default: {
      const _exhaustive: never = action
      throw new Error(`Unknown action ${(_exhaustive as any).type}`)
    }
  }
}

async function runOneTest(
  page: Page,
  baseUrl: string,
  test: SmokeTest,
): Promise<SmokeTestResult> {
  const started = Date.now()
  let completed = 0
  try {
    await Promise.race([
      (async () => {
        // Ensure we start from base for relative navigations.
        if (!page.url().startsWith(baseUrl)) {
          await page.goto(baseUrl, {
            waitUntil: 'domcontentloaded',
            timeout: NAV_TIMEOUT_MS,
          })
        }
        for (const action of test.actions) {
          await runAction(page, action)
          completed++
        }
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(Object.assign(new Error('Test timeout'), { isTimeout: true })),
          TEST_TIMEOUT_MS,
        ),
      ),
    ])

    const title = await page.title().catch(() => '')
    return {
      status: 'passed',
      testName: test.name,
      durationMs: Date.now() - started,
      completedActions: completed,
      contractId: test.contractId,
      priority: test.priority,
      evidence: truncateDiagnostic(
        `OK: ${test.expectedOutcome}; title="${title}"`,
        300,
      ),
    }
  } catch (e: any) {
    const isTimeout = e?.isTimeout || /timeout/i.test(e?.message || '')
    return {
      status: isTimeout ? 'timeout' : 'failed',
      testName: test.name,
      durationMs: Date.now() - started,
      completedActions: completed,
      contractId: test.contractId,
      priority: test.priority,
      failedAction: test.actions[completed]
        ? JSON.stringify(test.actions[completed])
        : undefined,
      error: truncateDiagnostic(e?.message || 'Smoke test failed', 400),
      evidence: truncateDiagnostic(e?.message || '', 400),
    }
  }
}

export type RunSmokeSuiteInput = {
  previewUrl: string
  templateId?: string
  plan: ApplicationPlan | null
  verification?: VerificationResult
}

/**
 * Deterministic Playwright smoke suite against an existing E2B preview URL.
 * Does not create/destroy sandboxes. Does not call an LLM.
 */
export async function runSmokeSuite(
  input: RunSmokeSuiteInput,
): Promise<SmokeSuiteResult> {
  const started = Date.now()

  if (!shouldSmokeTest(input.verification)) {
    return notTestableSuite('Skipped — final runtime verification was not runnable')
  }
  if (!isBrowserTestableTemplate(input.templateId)) {
    return notTestableSuite(
      'Template is not browser-testable (e.g. code interpreter)',
    )
  }
  if (!input.previewUrl?.startsWith('http')) {
    return notTestableSuite('Missing preview URL for browser smoke testing')
  }

  // Only allow navigating to the candidate's own host (E2B preview).
  let base: URL
  try {
    base = new URL(input.previewUrl)
  } catch {
    return notTestableSuite('Invalid preview URL')
  }
  if (!base.hostname.endsWith('.e2b.app') && !base.hostname.includes('e2b')) {
    // Allow local/dev hosts too for manual testing
    if (
      base.hostname !== 'localhost' &&
      base.hostname !== '127.0.0.1'
    ) {
      return notTestableSuite('Preview host is not an allowed sandbox host')
    }
  }

  const tests = deriveSmokeTests(input.plan)
  if (!tests.length) {
    return notTestableSuite('No smoke tests could be derived from the plan')
  }

  let chromium: typeof import('playwright').chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    return notTestableSuite('Playwright is not available in this environment')
  }

  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  const results: SmokeTestResult[] = []

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage'],
    })
    const context = await browser.newContext({
      // Do not send host credentials to the untrusted app.
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 720 },
      javaScriptEnabled: true,
    })
    const page = await context.newPage()
    page.setDefaultTimeout(ACTION_TIMEOUT_MS)

    await Promise.race([
      (async () => {
        for (const test of tests) {
          results.push(await runOneTest(page, base.toString(), test))
        }
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              Object.assign(new Error('Smoke suite timeout'), {
                isTimeout: true,
              }),
            ),
          SUITE_TIMEOUT_MS,
        ),
      ),
    ])
  } catch (e: any) {
    const msg = truncateDiagnostic(e?.message || 'Browser smoke failed', 400)
    if (/Executable doesn't exist|browserType\.launch/i.test(msg)) {
      return notTestableSuite(
        'Chromium not installed for Playwright (run npx playwright install chromium)',
      )
    }
    if (results.length === 0) {
      return {
        status: e?.isTimeout ? 'timeout' : 'failed',
        tests: [
          {
            status: e?.isTimeout ? 'timeout' : 'failed',
            testName: 'Browser smoke suite',
            durationMs: Date.now() - started,
            completedActions: 0,
            error: msg,
            evidence: msg,
          },
        ],
        durationMs: Date.now() - started,
        summary: msg,
      }
    }
  } finally {
    try {
      await browser?.close()
    } catch {
      /* ignore */
    }
  }

  const durationMs = Date.now() - started
  const anyTimeout = results.some((r) => r.status === 'timeout')
  const anyFail = results.some((r) => r.status === 'failed')
  const allPass = results.every((r) => r.status === 'passed')

  const suite: SmokeSuiteResult = {
    status: allPass
      ? 'passed'
      : anyTimeout && !anyFail
        ? 'timeout'
        : anyFail || anyTimeout
          ? 'failed'
          : 'failed',
    tests: results,
    durationMs,
    summary: allPass
      ? `${results.length} smoke test(s) passed`
      : `${results.filter((r) => r.status === 'passed').length}/${results.length} smoke tests passed`,
  }

  const validated = validateSmokeSuiteResult(suite)
  if (!validated.ok) {
    return notTestableSuite(`Malformed smoke result: ${validated.error}`)
  }
  return validated.result
}
