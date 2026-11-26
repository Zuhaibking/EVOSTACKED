'use client'

/**
 * RecordDrawer — right-side sheet with a create/edit form generated from the collection's fields.
 * Create → POST /records/{collection} {data}; edit → PATCH /records/{collection}/{id} {changed fields};
 * delete (with confirm) → DELETE. API field errors render inline under each input.
 */
import { FieldInput } from './field-input'
import { DateValue } from './field-value'
import { ApiError, apiFetch, currencyOf, formatAbsolute, isBlank, lowerNoun, ModuleStyles, parseDate, recordsUrl, StatusPill, statusFieldOf, titleOf } from './shared'
import { Button } from '@/components/ui/button'
import type { Blueprint, Collection, Field, RecordRow } from '@/lib/platform/types'
import { cn } from '@/lib/utils'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { CircleAlert, LoaderCircle, Trash2, X } from 'lucide-react'
import * as React from 'react'

export type RecordDrawerProps = {
  projectId: string
  collection: Collection
  blueprint: Blueprint
  /** null → create mode */
  record: RecordRow | null
  open: boolean
  onClose: () => void
  onSaved: (r: RecordRow) => void
  /** Called after a successful delete (drawer closes itself). */
  onDeleted?: (id: string) => void
  /** Prefill values in create mode (e.g. calendar slot → dateField, kanban column → statusField). */
  defaults?: Record<string, unknown>
}

// Drawer content only renders client-side (portal, closed on SSR), so navigator is safe here.
const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

const WIDE_TYPES = new Set<Field['type']>(['text', 'longtext', 'tags', 'image', 'url', 'email', 'relation'])

export function RecordDrawer(props: RecordDrawerProps) {
  const { open, onClose, collection } = props
  // Freeze what we show while the sheet animates out, so the form doesn't flip to "create" mid-exit.
  const [shown, setShown] = React.useState({ record: props.record, defaults: props.defaults })
  if (open && (shown.record !== props.record || shown.defaults !== props.defaults)) {
    setShown({ record: props.record, defaults: props.defaults })
  }
  const contentRef = React.useRef<HTMLDivElement>(null)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="evo-overlay fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          ref={contentRef}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            const first = contentRef.current?.querySelector<HTMLElement>('[data-autofocus] input, [data-autofocus] textarea, [data-autofocus] button')
            ;(first ?? contentRef.current)?.focus()
          }}
          className="evo-sheet fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col border-l bg-background shadow-[0_0_0_1px_hsl(var(--border)),-24px_0_80px_-20px_rgba(0,0,0,0.45)] outline-none sm:max-w-[31rem]"
        >
          <ModuleStyles />
          <DrawerForm key={shown.record?.id ?? `new:${collection.key}`} {...props} record={shown.record} defaults={shown.defaults} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function initialValues(fields: Field[], record: RecordRow | null, defaults?: Record<string, unknown>, statusKey?: string) {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (record) out[f.key] = record[f.key] ?? null
    else if (defaults && f.key in defaults) out[f.key] = defaults[f.key]
    else if (f.type === 'boolean') out[f.key] = false
    else if (f.type === 'tags') out[f.key] = []
    else if (f.key === statusKey && f.options.length) out[f.key] = f.options[0]
    else out[f.key] = null
  }
  return out
}

const norm = (v: unknown) => (isBlank(v) ? null : v)
const same = (a: unknown, b: unknown) => JSON.stringify(norm(a)) === JSON.stringify(norm(b))

function DrawerForm({ projectId, collection, blueprint, record, defaults, onClose, onSaved, onDeleted }: RecordDrawerProps) {
  const isNew = !record
  const fields = collection.fields
  const statusField = statusFieldOf(collection)
  const currency = React.useMemo(() => currencyOf(blueprint), [blueprint])
  const [initial] = React.useState(() => initialValues(fields, record, defaults, statusField?.key))
  const [values, setValues] = React.useState(initial)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const formRef = React.useRef<HTMLFormElement>(null)

  const dirtyKeys = fields.filter((f) => !same(values[f.key], initial[f.key])).map((f) => f.key)
  const dirty = dirtyKeys.length > 0
  const title = isNew ? `New ${lowerNoun(collection.singular || 'record')}` : titleOf(collection, { ...record, ...values } as RecordRow)
  const status = statusField ? values[statusField.key] : null

  const ordered = React.useMemo(() => {
    const t = fields.find((f) => f.key === collection.titleField)
    return t ? [t, ...fields.filter((f) => f !== t)] : fields
  }, [fields, collection.titleField])

  const setValue = (key: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [key]: v }))
    if (errors[key]) setErrors(({ [key]: _drop, ...rest }) => rest)
  }

  const focusField = (key: string) => {
    requestAnimationFrame(() => {
      const el = formRef.current?.querySelector<HTMLElement>(`[data-field="${key}"] input, [data-field="${key}"] textarea, [data-field="${key}"] button`)
      el?.focus()
    })
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    if (saving) return
    const missing: Record<string, string> = {}
    for (const f of fields) {
      if (f.required && f.type !== 'boolean' && isBlank(values[f.key]) && (isNew || dirtyKeys.includes(f.key))) missing[f.key] = `${f.label} is required`
    }
    if (Object.keys(missing).length) {
      setErrors(missing)
      setFormError(null)
      focusField(Object.keys(missing)[0])
      return
    }
    if (!isNew && !dirty) return onClose()

    setSaving(true)
    setErrors({})
    setFormError(null)
    try {
      const data = isNew
        ? Object.fromEntries(Object.entries(values).filter(([, v]) => !isBlank(v) || typeof v === 'boolean'))
        : Object.fromEntries(dirtyKeys.map((k) => [k, norm(values[k])]))
      const res = await apiFetch<{ record: RecordRow }>(isNew ? recordsUrl(projectId, collection.key) : recordsUrl(projectId, collection.key, record!.id), {
        method: isNew ? 'POST' : 'PATCH',
        json: { data },
      })
      if (!res?.record) throw new ApiError(500, 'The server returned an unexpected response.')
      // No toast here: hosts notify in onSaved (the shell does) and modules flash the saved row.
      onSaved(res.record)
      onClose()
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError(0, 'Something went wrong. Try again.')
      const known = Object.fromEntries(Object.entries(apiErr.fieldErrors).filter(([k]) => fields.some((f) => f.key === k)))
      const unknown = Object.entries(apiErr.fieldErrors).filter(([k]) => !(k in known))
      setErrors(known)
      setFormError(
        Object.keys(known).length
          ? `Please fix ${Object.keys(known).length === 1 ? 'the highlighted field' : `${Object.keys(known).length} highlighted fields`}.`
          : unknown.length
            ? unknown.map(([k, m]) => `${k}: ${m}`).join(' · ')
            : apiErr.message,
      )
      if (Object.keys(known).length) focusField(Object.keys(known)[0])
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!record || deleting) return
    setDeleting(true)
    setFormError(null)
    try {
      await apiFetch(recordsUrl(projectId, collection.key, record.id), { method: 'DELETE' })
      onDeleted?.(record.id)
      onClose()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Delete failed. Try again.')
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  const created = parseDate(record?.created_at)
  const updated = parseDate(record?.updated_at)

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          void submit()
        }
      }}
      className="flex min-h-0 flex-1 flex-col"
      noValidate
    >
      {/* header */}
      <header className="border-b px-6 pb-4 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
              {collection.label}
              {!isNew && <span className="text-muted-foreground/60"> / {String(record!.id).slice(0, 8)}</span>}
            </p>
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
              <DialogPrimitive.Title className="truncate text-lg font-semibold leading-tight tracking-tight text-foreground">{title}</DialogPrimitive.Title>
              {statusField && !isBlank(status) && <StatusPill value={status} />}
            </div>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {isNew ? (
                collection.description || `Fill in the details for this ${lowerNoun(collection.singular || 'record')}.`
              ) : (
                <>
                  Created <DateValue value={record!.created_at} className="text-foreground/80" />
                  {updated && created && updated.getTime() - created.getTime() > 1000 && (
                    <>
                      {' · '}Updated <DateValue value={record!.updated_at} className="text-foreground/80" />
                    </>
                  )}
                </>
              )}
            </p>
          </div>
          <DialogPrimitive.Close
            type="button"
            className="-mr-2 -mt-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
      </header>

      {/* body */}
      <div className="evo-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {formError && (
          <div role="alert" className="evo-rise mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.07] px-3 py-2.5 text-[13px] text-destructive">
            <CircleAlert className="mt-px size-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-3 gap-y-4">
          {ordered.map((f, i) => {
            const id = `evo-f-${collection.key}-${f.key}`
            const err = errors[f.key]
            return (
              <div key={f.key} data-field={f.key} data-autofocus={isNew && i === 0 ? '' : undefined} className={cn('min-w-0 space-y-1.5', (WIDE_TYPES.has(f.type) || i === 0) && 'col-span-2')}>
                <label htmlFor={id} className="flex items-center gap-1 text-[12.5px] font-medium text-foreground/80">
                  {f.label}
                  {f.required && <span className="text-destructive/80" aria-hidden>*</span>}
                  {dirtyKeys.includes(f.key) && !isNew && <span className="ml-auto size-1.5 rounded-full bg-brand" title="Edited" />}
                </label>
                <FieldInput field={f} value={values[f.key]} onChange={(v) => setValue(f.key, v)} id={id} invalid={!!err} currency={currency} projectId={projectId} blueprint={blueprint} />
                {err && (
                  <p className="evo-rise flex items-center gap-1 text-xs text-destructive">
                    <CircleAlert className="size-3 shrink-0" />
                    {err}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {!isNew && (
          <dl className="mt-7 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t pt-4 text-[12.5px]">
            <dt className="text-muted-foreground">Record ID</dt>
            <dd className="select-all truncate text-right font-mono text-[11.5px] text-foreground/80">{record!.id}</dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd className="text-right tabular text-foreground/80">{created ? formatAbsolute(created) : '—'}</dd>
            <dt className="text-muted-foreground">Last updated</dt>
            <dd className="text-right tabular text-foreground/80">{updated ? formatAbsolute(updated) : '—'}</dd>
          </dl>
        )}
      </div>

      {/* footer */}
      <footer className="flex items-center justify-between gap-3 border-t bg-muted/25 px-6 py-3">
        {!isNew && confirmDelete ? (
          <div className="evo-rise flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] text-foreground">Delete this {lowerNoun(collection.singular || 'record')}?</span>
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button type="button" size="sm" variant="destructive" className="h-7 px-2.5" onClick={remove} disabled={deleting}>
              {deleting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              Delete
            </Button>
          </div>
        ) : !isNew ? (
          <Button type="button" size="sm" variant="ghost" className="-ml-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        ) : (
          <span className="hidden items-center gap-1 text-[11.5px] text-muted-foreground sm:inline-flex">
            <kbd className="rounded border bg-background px-1 py-px font-sans text-[10px] font-medium">{isMac() ? 'Cmd' : 'Ctrl'}</kbd>
            <kbd className="rounded border bg-background px-1 py-px font-sans text-[10px] font-medium">Enter</kbd>
            to save
          </span>
        )}
        {!(confirmDelete && !isNew) && (
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || (!isNew && !dirty)} className="min-w-[6.5rem]">
              {saving && <LoaderCircle className="size-3.5 animate-spin" />}
              {isNew ? `Create ${lowerNoun(collection.singular || 'record')}` : 'Save changes'}
            </Button>
          </div>
        )}
      </footer>
    </form>
  )
}
