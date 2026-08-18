'use client'

import {
  getApiHealth,
  getRequestLogs,
  getRun,
  getRunBrain,
  getRunMemory,
  getRunMessages,
  getRunVersions,
  listRuns,
} from '@/lib/api/client'
import type { RequestLogRow } from '@/lib/database-control-center'
import { useCallback, useEffect, useState } from 'react'

export type PlatformRun = {
  runId: string
  memoryRevision: number
  selectedCandidate?: string | null
  activeVersion?: number | null
  hasTournament: boolean
  status?: string
}

export type PlatformRunListItem = {
  id: string
  memoryVersion: number
  selectedCandidate?: string | null
  activeVersion?: number | null
  hasTournament: boolean
  status: string
  updatedAt: string
}

export type PlatformMemory = {
  memoryVersion: number
  runId: string
  memoryItemIds: string[]
  recentMessageCount: number
}

export type PlatformSnapshot = {
  loading: boolean
  health: { ok: boolean; service?: string } | null
  healthError: string | null
  run: PlatformRun | null
  runs: PlatformRunListItem[]
  messages: unknown[]
  versions: unknown[]
  brain: Record<string, unknown> | null
  memory: PlatformMemory | null
  logs: RequestLogRow[]
  errors: string[]
  refresh: () => void
}

async function settle<T>(
  label: string,
  task: Promise<T>,
): Promise<{ value: T | null; error?: string }> {
  try {
    return { value: await task }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { value: null, error: `${label}: ${message.slice(0, 180)}` }
  }
}

export function useDatabasePlatform(
  runId?: string | null,
  token?: string,
): PlatformSnapshot {
  const [loading, setLoading] = useState(false)
  const [health, setHealth] = useState<{ ok: boolean; service?: string } | null>(
    null,
  )
  const [healthError, setHealthError] = useState<string | null>(null)
  const [run, setRun] = useState<PlatformRun | null>(null)
  const [runs, setRuns] = useState<PlatformRunListItem[]>([])
  const [messages, setMessages] = useState<unknown[]>([])
  const [versions, setVersions] = useState<unknown[]>([])
  const [brain, setBrain] = useState<Record<string, unknown> | null>(null)
  const [memory, setMemory] = useState<PlatformMemory | null>(null)
  const [logs, setLogs] = useState<RequestLogRow[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErrors([])

    async function load() {
      const healthResult = await settle('Health', getApiHealth())
      if (!cancelled) {
        setHealth(healthResult.value)
        setHealthError(healthResult.error || null)
      }

      if (!token || !runId) {
        if (!cancelled) {
          setRun(null)
          setRuns([])
          setMessages([])
          setVersions([])
          setBrain(null)
          setMemory(null)
          setLogs([])
          setLoading(false)
        }
        return
      }

      const [runRes, runsRes, messagesRes, versionsRes, brainRes, memoryRes, logsRes] =
        await Promise.all([
          settle('Run', getRun(runId, token)),
          settle('Runs', listRuns(token)),
          settle('Messages', getRunMessages(runId, token)),
          settle('Versions', getRunVersions(runId, token)),
          settle('Brain', getRunBrain(runId, token)),
          settle('Memory', getRunMemory(runId, token)),
          settle('Logs', getRequestLogs(token, runId)),
        ])

      if (cancelled) return

      const nextErrors = [
        runRes.error,
        runsRes.error,
        messagesRes.error,
        versionsRes.error,
        brainRes.error,
        memoryRes.error,
        logsRes.error,
      ].filter((e): e is string => !!e)

      setRun(runRes.value)
      setRuns(Array.isArray(runsRes.value) ? runsRes.value : [])
      setMessages(Array.isArray(messagesRes.value) ? messagesRes.value : [])
      setVersions(Array.isArray(versionsRes.value) ? versionsRes.value : [])
      setBrain(
        brainRes.value && typeof brainRes.value === 'object'
          ? (brainRes.value as Record<string, unknown>)
          : null,
      )
      setMemory(memoryRes.value)
      setLogs(Array.isArray(logsRes.value) ? logsRes.value : [])
      setErrors(nextErrors)
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [runId, token, tick])

  return {
    loading,
    health,
    healthError,
    run,
    runs,
    messages,
    versions,
    brain,
    memory,
    logs,
    errors,
    refresh,
  }
}
