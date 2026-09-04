import { WrittenFile } from './fragment-files'

export type CaptureMeta = {
  projectId: string
  candidateId: string
  runId: string
}

const CAPTURE_SRC = '/evostack-capture.js'

export function captureScript(meta: CaptureMeta): string {
  const projectId = JSON.stringify(meta.projectId)
  const candidateId = JSON.stringify(meta.candidateId)
  const runId = JSON.stringify(meta.runId)
  return `;(function(){
  var meta = { projectId: ${projectId}, candidateId: ${candidateId}, runId: ${runId} }
  window.__EVOSTACK__ = meta
  window.evostack = {
    submit: function(formId, data){
      var body = {
        project_id: meta.projectId,
        run_id: meta.runId,
        candidate_id: meta.candidateId,
        form_id: formId || 'form',
        payload: data || {}
      }
      try {
        window.parent.postMessage({ source: 'evostack-capture', type: 'submit', payload: body }, '*')
        if (window.top && window.top !== window.parent) {
          window.top.postMessage({ source: 'evostack-capture', type: 'submit', payload: body }, '*')
        }
      } catch (e) {}
      fetch('/api/evostack/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).catch(function(){})
    }
  }
  document.addEventListener('submit', function(e){
    var form = e.target
    if (!form || form.tagName !== 'FORM') return
    if (form.getAttribute('data-evostack') === 'off') return
    var data = {}
    var fd = new FormData(form)
    fd.forEach(function(v, k){ data[k] = v })
    window.evostack.submit(form.id || form.getAttribute('name') || 'form', data)
    var action = form.getAttribute('action') || ''
    if (!action || /evostack\\/submit/.test(action)) e.preventDefault()
  }, true)
})();
`
}

export function captureSubmitRoute(): string {
  return `import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false })
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
  if (!body.project_id && process.env.EVOSTACK_PROJECT_ID) body.project_id = process.env.EVOSTACK_PROJECT_ID
  if (!body.run_id && process.env.EVOSTACK_RUN_ID) body.run_id = process.env.EVOSTACK_RUN_ID
  const target = process.env.EVOSTACK_CAPTURE_URL
  if (target) {
    try {
      await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      /* preview still notifies the parent iframe */
    }
  }
  return res.status(200).json({ ok: true })
}
`
}

const DOCUMENT = `import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <script src="${CAPTURE_SRC}" defer />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
`

function injectHtmlScript(html: string): string {
  if (html.includes(CAPTURE_SRC)) return html
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `<script src="${CAPTURE_SRC}" defer></script></body>`)
  }
  return `${html}\n<script src="${CAPTURE_SRC}" defer></script>\n`
}

function injectDocument(src: string): string {
  if (src.includes(CAPTURE_SRC)) return src
  if (/<Head[\s>]/.test(src)) {
    return src.replace(/<Head([^>]*)>/, `<Head$1>\n        <script src="${CAPTURE_SRC}" defer />`)
  }
  return DOCUMENT
}

/** Idempotent. Adds the shared capture route + helper only; never invents an app schema. */
export function withCaptureLayer(files: WrittenFile[], meta: CaptureMeta): WrittenFile[] {
  const map = new Map(files.map((f) => [f.file_path, { ...f }]))
  map.set('public/evostack-capture.js', {
    file_path: 'public/evostack-capture.js',
    file_content: captureScript(meta),
  })
  map.set('pages/api/evostack/submit.ts', {
    file_path: 'pages/api/evostack/submit.ts',
    file_content: captureSubmitRoute(),
  })
  const doc =
    map.get('pages/_document.tsx') ||
    map.get('pages/_document.jsx')
  if (doc) {
    map.set(doc.file_path, {
      ...doc,
      file_content: injectDocument(doc.file_content),
    })
  } else {
    map.set('pages/_document.tsx', {
      file_path: 'pages/_document.tsx',
      file_content: DOCUMENT,
    })
  }
  for (const f of [...map.values()]) {
    if (/\.html?$/i.test(f.file_path)) {
      map.set(f.file_path, {
        ...f,
        file_content: injectHtmlScript(f.file_content),
      })
    }
  }
  return [...map.values()]
}
