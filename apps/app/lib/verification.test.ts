/**
 * Deterministic verification diagnostics — zero E2B.
 * Run: npm run test:verification
 */
import assert from 'node:assert/strict'
import {
  extractCompileErrorFromHtml,
  extractHydrationErrorFromHtml,
  extractPreviewOverlayErrorFromHtml,
  extractUsefulError,
  isCompileOrBuildFailure,
  isHydrationOverlayFailure,
  isPreviewOverlayFailure,
  isServerRuntimeFailure,
} from './verification'
import { formatCandidateBuildDiagnostics } from './build-failure-diagnostics'

{
  const msg = extractUsefulError(
    '',
    'Error: @import rules must precede all rules aside from @charset and @layer statements.',
  )
  assert.match(msg, /@import rules must precede/)
  assert.equal(isCompileOrBuildFailure(msg), true)
}

{
  const msg = extractUsefulError('Failed to compile\n./styles/globals.css', '')
  assert.match(msg, /Failed to compile/)
  assert.equal(isCompileOrBuildFailure(msg), true)
}

{
  const html = `<html><body><div>Failed to compile</div><pre>styles/globals.css:1785:8
@import rules must precede all rules aside from @charset and @layer statements.
</pre></body></html>`
  const extracted = extractCompileErrorFromHtml(html)
  assert.ok(extracted)
  assert.match(extracted!, /@import rules must precede/i)
}

{
  const lines = formatCandidateBuildDiagnostics({
    finalVerification: {
      status: 'failed',
      filesWritten: true,
      dependenciesInstalled: true,
      processStarted: false,
      previewReachable: false,
      errors: [
        'styles/globals.css:1785: @import rules must precede all rules aside from @charset and @layer statements.',
      ],
      warnings: [],
      durationMs: 10,
    },
    repairAttempt: { attempted: true, success: false },
  })
  assert.equal(lines[0], 'BUILD FAILED')
  assert.ok(lines.some((l) => l.includes('styles/globals.css:1785')))
  assert.ok(lines.includes('Repair attempted: YES'))
  assert.ok(lines.includes('Repair result: FAILED'))
  assert.equal(lines.includes('passed'), false)
}

{
  assert.equal(isCompileOrBuildFailure('Preview host ready'), false)
}

{
  const html = `<html><body>
  <div>Failed to compile</div>
  <pre>./components/MenuSection.tsx:5:6
Parsing ecmascript source code failed
Unexpected token 'section'. Expected jsx identifier
</pre></body></html>`
  const extracted = extractCompileErrorFromHtml(html)
  assert.ok(extracted)
  assert.match(extracted!, /Parsing ecmascript|jsx identifier|MenuSection/i)
  assert.equal(isCompileOrBuildFailure(extracted), true)
}

{
  const html = `<html><body>
  <h1>Unhandled Runtime Error</h1>
  <p>Error: Hydration failed because the initial UI does not match what was rendered on the server.</p>
  <p>Expected server HTML to contain a matching &lt;a&gt; in &lt;a&gt;.</p>
</body></html>`
  const extracted = extractHydrationErrorFromHtml(html)
  assert.ok(extracted)
  assert.match(extracted!, /Hydration failed|matching <a> in <a>/i)
  assert.equal(isHydrationOverlayFailure(extracted), true)
  assert.equal(isPreviewOverlayFailure(extracted), true)
  assert.equal(isCompileOrBuildFailure(extracted), false)
  const overlay = extractPreviewOverlayErrorFromHtml(html)
  assert.ok(overlay)
  assert.equal(isPreviewOverlayFailure(overlay), true)
}

{
  assert.equal(isHydrationOverlayFailure('Preview host ready'), false)
  assert.equal(isPreviewOverlayFailure('Preview host ready'), false)
}

{
  // Innovate vague-run shape: HTTP 500 + SSR ReferenceError in __NEXT_DATA__ only.
  const html = `<!DOCTYPE html><html lang="en"><head>
<style data-next-hide-fouc="true">body{display:none}</style>
</head><body class="antialiased"><div id="__next"></div>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"statusCode":500}},"page":"/_error","query":{},"buildId":"development","isFallback":false,"err":{"name":"ReferenceError","source":"server","message":"React is not defined","stack":"ReferenceError: React is not defined\\n    at Home (/home/user/.next/server/chunks/ssr/_42f4a7._.js:1112:5)\\n    at renderWithHooks (/home/user/node_modules/react-dom/cjs/react-dom-server.browser.development.js:5658:16)"}}</script>
</body></html>`
  const extracted = extractPreviewOverlayErrorFromHtml(html)
  assert.ok(extracted, 'must extract SSR err from __NEXT_DATA__')
  assert.match(extracted!, /React is not defined/)
  assert.match(extracted!, /ReferenceError/)
  assert.match(extracted!, /at Home/)
  assert.equal(isServerRuntimeFailure(extracted), true)
  assert.equal(isPreviewOverlayFailure(extracted), true)
  assert.equal(isCompileOrBuildFailure(extracted), false)
}

{
  assert.equal(isServerRuntimeFailure('Preview host ready'), false)
  assert.equal(isServerRuntimeFailure('ReferenceError: React is not defined'), true)
}

console.log('verification.test.ts: all tests passed')
