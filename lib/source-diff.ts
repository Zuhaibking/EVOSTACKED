/**
 * Deterministic source diff between two fragments.
 * No LLM / external diff services — pure local comparison.
 */
import { getFragmentFiles, type FragmentFile } from '@/lib/fragment'
import type { FragmentSchema } from '@/lib/schema'
import type { DeepPartial } from 'ai'

export type LineOp = {
  type: 'equal' | 'add' | 'remove'
  text: string
  /** 1-based line numbers; undefined when not applicable for that side. */
  oldLine?: number
  newLine?: number
}

export type FileDiff = {
  path: string
  status: 'added' | 'removed' | 'modified' | 'unchanged'
  oldContent?: string
  newContent?: string
  addedLines: number
  removedLines: number
  /** Unified line ops for readable comparison (capped for large files). */
  lines: LineOp[]
}

export type SourceDiff = {
  addedFiles: string[]
  removedFiles: string[]
  modifiedFiles: string[]
  unchangedFiles: string[]
  addedLines: number
  removedLines: number
  files: FileDiff[]
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [redacted]'],
  [/sk-[A-Za-z0-9]{10,}/g, '[redacted]'],
  [
    /((?:api[_-]?key|secret|token|password)\s*[=:]\s*)([^"\\s]+)/gi,
    '$1[redacted]',
  ],
]

/** Scrub secret-looking substrings from text used in diffs/reports. */
export function scrubSecrets(text: string): string {
  let out = text
  for (const [re, rep] of SECRET_PATTERNS) {
    out = out.replace(re, rep)
  }
  return out
}

function splitLines(content: string): string[] {
  if (!content) return []
  // Preserve empty trailing line semantics without inventing an extra blank.
  const normalized = content.replace(/\r\n/g, '\n')
  if (normalized === '') return []
  return normalized.split('\n')
}

/**
 * Classic LCS line diff — deterministic, no randomness.
 * Caps output ops for very large files while still counting totals accurately.
 */
export function diffLines(
  oldText: string,
  newText: string,
  opts: { maxOps?: number } = {},
): { lines: LineOp[]; addedLines: number; removedLines: number } {
  const a = splitLines(oldText)
  const b = splitLines(newText)
  const n = a.length
  const m = b.length

  // DP LCS lengths
  const dp: Uint32Array[] = Array.from(
    { length: n + 1 },
    () => new Uint32Array(m + 1),
  )
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const ops: LineOp[] = []
  let addedLines = 0
  let removedLines = 0
  let i = 0
  let j = 0
  let oldLine = 1
  let newLine = 1
  const maxOps = opts.maxOps ?? 4000

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      if (ops.length < maxOps) {
        ops.push({
          type: 'equal',
          text: scrubSecrets(a[i]),
          oldLine,
          newLine,
        })
      }
      i++
      j++
      oldLine++
      newLine++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      removedLines++
      if (ops.length < maxOps) {
        ops.push({
          type: 'remove',
          text: scrubSecrets(a[i]),
          oldLine,
        })
      }
      i++
      oldLine++
    } else {
      addedLines++
      if (ops.length < maxOps) {
        ops.push({
          type: 'add',
          text: scrubSecrets(b[j]),
          newLine,
        })
      }
      j++
      newLine++
    }
  }
  while (i < n) {
    removedLines++
    if (ops.length < maxOps) {
      ops.push({
        type: 'remove',
        text: scrubSecrets(a[i]),
        oldLine,
      })
    }
    i++
    oldLine++
  }
  while (j < m) {
    addedLines++
    if (ops.length < maxOps) {
      ops.push({
        type: 'add',
        text: scrubSecrets(b[j]),
        newLine,
      })
    }
    j++
    newLine++
  }

  return { lines: ops, addedLines, removedLines }
}

function fileMap(
  fragment?: DeepPartial<FragmentSchema> | FragmentSchema | null,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const f of getFragmentFiles(fragment)) {
    map.set(f.file_path, f.file_content ?? '')
  }
  return map
}

/**
 * Diff two fragments into a structured, serializable SourceDiff.
 */
export function diffFragments(
  oldFragment?: DeepPartial<FragmentSchema> | FragmentSchema | null,
  newFragment?: DeepPartial<FragmentSchema> | FragmentSchema | null,
): SourceDiff {
  const oldMap = fileMap(oldFragment)
  const newMap = fileMap(newFragment)
  const allPaths = Array.from(
    new Set([...Array.from(oldMap.keys()), ...Array.from(newMap.keys())]),
  ).sort()

  const addedFiles: string[] = []
  const removedFiles: string[] = []
  const modifiedFiles: string[] = []
  const unchangedFiles: string[] = []
  const files: FileDiff[] = []
  let addedLines = 0
  let removedLines = 0

  for (const path of allPaths) {
    const oldContent = oldMap.get(path)
    const newContent = newMap.get(path)

    if (oldContent === undefined && newContent !== undefined) {
      const lineDiff = diffLines('', newContent)
      addedFiles.push(path)
      addedLines += lineDiff.addedLines
      files.push({
        path,
        status: 'added',
        newContent: scrubSecrets(newContent),
        addedLines: lineDiff.addedLines,
        removedLines: 0,
        lines: lineDiff.lines,
      })
      continue
    }

    if (oldContent !== undefined && newContent === undefined) {
      const lineDiff = diffLines(oldContent, '')
      removedFiles.push(path)
      removedLines += lineDiff.removedLines
      files.push({
        path,
        status: 'removed',
        oldContent: scrubSecrets(oldContent),
        addedLines: 0,
        removedLines: lineDiff.removedLines,
        lines: lineDiff.lines,
      })
      continue
    }

    if (oldContent === newContent) {
      unchangedFiles.push(path)
      files.push({
        path,
        status: 'unchanged',
        oldContent: scrubSecrets(oldContent ?? ''),
        newContent: scrubSecrets(newContent ?? ''),
        addedLines: 0,
        removedLines: 0,
        lines: [],
      })
      continue
    }

    const lineDiff = diffLines(oldContent ?? '', newContent ?? '')
    modifiedFiles.push(path)
    addedLines += lineDiff.addedLines
    removedLines += lineDiff.removedLines
    files.push({
      path,
      status: 'modified',
      oldContent: scrubSecrets(oldContent ?? ''),
      newContent: scrubSecrets(newContent ?? ''),
      addedLines: lineDiff.addedLines,
      removedLines: lineDiff.removedLines,
      lines: lineDiff.lines,
    })
  }

  return {
    addedFiles,
    removedFiles,
    modifiedFiles,
    unchangedFiles,
    addedLines,
    removedLines,
    files,
  }
}

/** Compact summary without file bodies — safe for lightweight UI lists. */
export function summarizeSourceDiff(diff: SourceDiff): {
  addedFiles: string[]
  removedFiles: string[]
  modifiedFiles: string[]
  unchangedFiles: string[]
  addedLines: number
  removedLines: number
} {
  return {
    addedFiles: [...diff.addedFiles],
    removedFiles: [...diff.removedFiles],
    modifiedFiles: [...diff.modifiedFiles],
    unchangedFiles: [...diff.unchangedFiles],
    addedLines: diff.addedLines,
    removedLines: diff.removedLines,
  }
}

/** Path-only listing helper for empty/identical checks in tests. */
export function listFragmentPaths(
  fragment?: DeepPartial<FragmentSchema> | FragmentSchema | null,
): string[] {
  return getFragmentFiles(fragment)
    .map((f: FragmentFile) => f.file_path)
    .sort()
}
