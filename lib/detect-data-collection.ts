import { WrittenFile } from './fragment-files'

const FORM = /<form[\s>]/i
const ON_SUBMIT = /\bonSubmit\s*=/
const EMAIL_INPUT = /type\s*=\s*['"]email['"]/i
const TEL_INPUT = /type\s*=\s*['"]tel['"]/i
const NAME_HINT =
  /name\s*=\s*['"][^'"]*(email|e-mail|phone|tel|register|signup|sign[-_ ]?up)[^'"]*['"]/i

/** Conservative: only treat an app as collecting data when the source shows a form. */
export function detectDataCollection(files: WrittenFile[]): boolean {
  const blob = files.map((f) => f.file_content || '').join('\n')
  if (!blob.trim()) return false
  return (
    FORM.test(blob) ||
    ON_SUBMIT.test(blob) ||
    EMAIL_INPUT.test(blob) ||
    TEL_INPUT.test(blob) ||
    NAME_HINT.test(blob)
  )
}
