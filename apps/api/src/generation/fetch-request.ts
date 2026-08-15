import type { IncomingHttpHeaders } from 'node:http'

export function toFetchRequest(
  headers: IncomingHttpHeaders,
  body: unknown,
): Request {
  const h = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue
    h.set(key, Array.isArray(value) ? value.join(',') : value)
  }
  return new Request('http://127.0.0.1/internal', {
    method: 'POST',
    headers: h,
    body: JSON.stringify(body),
  })
}

export async function pipeWebResponse(
  web: Response,
  res: {
    status: (code: number) => unknown
    setHeader: (k: string, v: string) => unknown
    write: (chunk: unknown) => unknown
    end: () => unknown
  },
) {
  res.status(web.status)
  web.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  if (!web.body) {
    const text = await web.text()
    res.write(text)
    res.end()
    return
  }
  const reader = web.body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    res.write(decoder.decode(value, { stream: true }))
  }
  res.end()
}
