'use client'

import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type Submission = {
  id: string
  project_id: string
  run_id: string
  candidate_id: string
  form_id: string
  payload: Record<string, unknown>
  created_at: number
}

function cell(value: unknown) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function SubmissionsAdmin({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Submission[]>([])
  const [needed, setNeeded] = useState<boolean | null>(null)
  const [run, setRun] = useState('all')
  const [candidate, setCandidate] = useState('all')
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/evostack/submissions?projectId=${encodeURIComponent(projectId)}`)
      .then(async (r) => {
        const data = await r.json()
        if (r.status === 401 || r.status === 403) {
          return { denied: true, data }
        }
        if (!r.ok) throw new Error(data.error || 'Could not load submissions')
        return { denied: false, data }
      })
      .then(({ denied: no, data }) => {
        if (cancelled) return
        if (no) {
          setDenied(true)
          return
        }
        setNeeded(Boolean(data.requires_data_layer))
        setRows(Array.isArray(data.submissions) ? data.submissions : [])
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Load failed')
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const runs = useMemo(
    () => [...new Set(rows.map((r) => r.run_id).filter(Boolean))],
    [rows],
  )
  const candidates = useMemo(
    () => [...new Set(rows.map((r) => r.candidate_id).filter(Boolean))],
    [rows],
  )
  const payloadKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const r of rows) {
      for (const k of Object.keys(r.payload || {})) keys.add(k)
    }
    return [...keys].sort()
  }, [rows])

  const filtered = rows.filter(
    (r) =>
      (run === 'all' || r.run_id === run) &&
      (candidate === 'all' || r.candidate_id === candidate),
  )

  function downloadCsv() {
    const headers = [
      'created_at',
      'form_id',
      'candidate_id',
      'run_id',
      ...payloadKeys,
    ]
    const lines = [
      headers.join(','),
      ...filtered.map((r) =>
        [
          new Date(r.created_at).toISOString(),
          r.form_id,
          r.candidate_id,
          r.run_id,
          ...payloadKeys.map((k) => cell(r.payload?.[k])),
        ]
          .map((v) => csvEscape(String(v ?? '')))
          .join(','),
      ),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `submissions-${projectId}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <main className="min-h-screen px-6 py-10">
      {denied ? (
        <div>
          <h1 className="font-display text-3xl font-black tracking-tight">
            Sign in required
          </h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Open the arena and sign in to view submissions.
          </p>
          <Link
            href="/app"
            className="mt-5 inline-block font-mono text-[10px] tracking-[0.22em] uppercase underline underline-offset-4"
          >
            Back to arena
          </Link>
        </div>
      ) : error ? (
        <p className="text-[13px] text-destructive">{error}</p>
      ) : needed === null ? (
        <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
          Loading
        </p>
      ) : !needed ? (
        <div>
          <Link
            href="/app"
            className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground hover:text-foreground"
          >
            Back to arena
          </Link>
          <p className="mt-10 font-mono text-[10px] tracking-[0.28em] uppercase text-muted-foreground">
            Submissions
          </p>
          <h1 className="mt-3 font-display text-3xl font-black tracking-tight">
            No database needed
          </h1>
          <p className="mt-2 max-w-md text-[13px] text-muted-foreground">
            This project does not collect form data, so there is no admin table.
          </p>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              href="/app"
              className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground hover:text-foreground"
            >
              Back to arena
            </Link>
            <Button type="button" variant="outline" size="sm" onClick={downloadCsv}>
              Export CSV
            </Button>
          </div>
          <p className="mt-8 font-mono text-[10px] tracking-[0.28em] uppercase text-muted-foreground">
            Submissions
          </p>
          <h1 className="mt-3 font-display text-3xl font-black tracking-tight">
            Project data
          </h1>
          <p className="mt-2 max-w-xl text-[13px] text-muted-foreground">
            Shared capture table for this project. {filtered.length} shown
            {filtered.length !== rows.length ? ` of ${rows.length}` : ''}.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <label className="flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
              Run
              <select
                value={run}
                onChange={(e) => setRun(e.target.value)}
                className="h-8 border border-border bg-background px-2 text-foreground"
              >
                <option value="all">All</option>
                {runs.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
              Candidate
              <select
                value={candidate}
                onChange={(e) => setCandidate(e.target.value)}
                className="h-8 border border-border bg-background px-2 text-foreground"
              >
                <option value="all">All</option>
                {candidates.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-6 overflow-x-auto border border-border">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-border bg-foreground/[0.03] font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-normal">Time</th>
                  <th className="px-3 py-2 font-normal">Form</th>
                  <th className="px-3 py-2 font-normal">Candidate</th>
                  <th className="px-3 py-2 font-normal">Run</th>
                  {payloadKeys.map((k) => (
                    <th key={k} className="px-3 py-2 font-normal">
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-8 text-muted-foreground"
                      colSpan={4 + payloadKeys.length}
                    >
                      No submissions yet.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">{r.form_id}</td>
                      <td className="px-3 py-2">{r.candidate_id}</td>
                      <td className="px-3 py-2 truncate max-w-[140px]">{r.run_id}</td>
                      {payloadKeys.map((k) => (
                        <td key={k} className="px-3 py-2 max-w-[220px] truncate">
                          {cell(r.payload?.[k])}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  )
}
