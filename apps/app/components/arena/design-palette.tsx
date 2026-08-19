'use client'

import type { DesignInspectController } from '@/lib/design-mode/controller'
import type { StyleProp } from '@/lib/design-mode/protocol'
import { type FormEvent, useState } from 'react'

const FIELD =
  'h-8 w-full px-2 font-mono text-[13px] border border-border bg-transparent rounded-none text-foreground'
const CHIP =
  'h-7 px-2.5 font-mono text-[11px] tracking-[0.18em] uppercase border border-border text-muted-foreground hover:text-foreground disabled:opacity-35'

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="grid gap-1 min-w-0">
      <span className="font-mono text-[11px] tracking-[0.18em] uppercase text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  )
}

function valueFor(
  inspect: DesignInspectController,
  prop: StyleProp,
  fallback = '',
): string {
  const patch = inspect.patches.find((item) => item.prop === prop)
  if (patch) return patch.value
  if (prop === 'content') return inspect.node?.text || fallback
  return inspect.node?.computed[prop] || fallback
}

function hexForColor(value: string): string {
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (rgb) {
    const to = (n: string) => Number(n).toString(16).padStart(2, '0')
    return `#${to(rgb[1])}${to(rgb[2])}${to(rgb[3])}`
  }
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) {
    const v = value.trim()
    if (v.length === 4) {
      return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
    }
    return v
  }
  return '#000000'
}

function ColorField({
  label,
  prop,
  inspect,
}: {
  label: string
  prop: 'color' | 'background'
  inspect: DesignInspectController
}) {
  const raw = valueFor(inspect, prop)
  return (
    <Field label={label}>
      <div className="flex gap-1">
        <input
          type="color"
          aria-label={label}
          className="h-8 w-8 shrink-0 border border-border bg-transparent p-0 rounded-none"
          value={hexForColor(raw)}
          onChange={(event) =>
            inspect.patch({ prop, value: event.target.value })
          }
        />
        <input
          className={FIELD}
          value={raw}
          onChange={(event) =>
            inspect.patch({ prop, value: event.target.value })
          }
        />
      </div>
    </Field>
  )
}

function TextField({
  label,
  prop,
  inspect,
  placeholder,
}: {
  label: string
  prop: StyleProp
  inspect: DesignInspectController
  placeholder?: string
}) {
  return (
    <Field label={label}>
      <input
        className={FIELD}
        value={valueFor(inspect, prop)}
        placeholder={placeholder}
        onChange={(event) =>
          inspect.patch({ prop, value: event.target.value })
        }
      />
    </Field>
  )
}

function SelectField({
  label,
  prop,
  inspect,
  options,
}: {
  label: string
  prop: StyleProp
  inspect: DesignInspectController
  options: { value: string; label: string }[]
}) {
  return (
    <Field label={label}>
      <select
        className={FIELD}
        value={valueFor(inspect, prop)}
        onChange={(event) =>
          inspect.patch({ prop, value: event.target.value })
        }
      >
        <option value="">—</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

function Group({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-muted-foreground">
        {title}
      </p>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </section>
  )
}

export function DesignPalette({
  inspect,
}: {
  inspect: DesignInspectController
}) {
  const [structural, setStructural] = useState('')
  const node = inspect.node

  function onStructural(event: FormEvent) {
    event.preventDefault()
    inspect.seedStructural(structural)
    setStructural('')
  }

  return (
    <div className="space-y-5 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="font-mono text-[13px] tracking-[0.22em] uppercase text-muted-foreground">
          Palette
        </p>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            className={CHIP}
            disabled={inspect.patches.length === 0}
            onClick={inspect.undo}
          >
            Undo
          </button>
          <button
            type="button"
            className={CHIP}
            disabled={inspect.patches.length === 0}
            onClick={inspect.reset}
          >
            Reset
          </button>
          <button
            type="button"
            className={`${CHIP} ${
              inspect.canStyleApply
                ? 'border-foreground bg-foreground text-background'
                : ''
            }`}
            disabled={!node || inspect.patches.length === 0}
            onClick={inspect.apply}
          >
            Apply
          </button>
        </div>
      </div>

      {!node ? (
        <p className="text-[15px] text-muted-foreground">
          Turn on Inspect in the preview and click an element. Sliders stay
          local — Apply writes Tailwind into source.
        </p>
      ) : (
        <>
          <p className="font-mono text-[13px] text-foreground">
            {'<'}
            {node.tag}
            {'>'}
            {node.text ? `  ${node.text}` : ''}
          </p>
          {inspect.applyHint ? (
            <p className="text-[13px] text-muted-foreground">{inspect.applyHint}</p>
          ) : null}
          {!inspect.canStyleApply ? (
            <p className="text-[13px] text-muted-foreground">
              Style apply is Next.js + Tailwind. You can still inspect; Apply
              seeds Improve.
            </p>
          ) : null}

          <Group title="Content">
            <div className="col-span-2">
              <TextField
                label="Text"
                prop="content"
                inspect={inspect}
                placeholder={node.text}
              />
            </div>
          </Group>

          <Group title="Type">
            <TextField label="Family" prop="fontFamily" inspect={inspect} />
            <TextField label="Size" prop="fontSize" inspect={inspect} />
            <SelectField
              label="Weight"
              prop="fontWeight"
              inspect={inspect}
              options={[
                { value: '400', label: '400' },
                { value: '500', label: '500' },
                { value: '600', label: '600' },
                { value: '700', label: '700' },
              ]}
            />
            <TextField label="Line" prop="lineHeight" inspect={inspect} />
            <TextField label="Track" prop="letterSpacing" inspect={inspect} />
            <SelectField
              label="Align"
              prop="textAlign"
              inspect={inspect}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Center' },
                { value: 'right', label: 'Right' },
                { value: 'justify', label: 'Justify' },
              ]}
            />
            <SelectField
              label="Decoration"
              prop="textDecoration"
              inspect={inspect}
              options={[
                { value: 'none', label: 'None' },
                { value: 'underline', label: 'Underline' },
                { value: 'line-through', label: 'Strike' },
              ]}
            />
          </Group>

          <Group title="Color">
            <ColorField label="Text" prop="color" inspect={inspect} />
            <ColorField label="Fill" prop="background" inspect={inspect} />
          </Group>

          <Group title="Layout">
            <TextField label="Margin" prop="margin" inspect={inspect} />
            <TextField label="Padding" prop="padding" inspect={inspect} />
            <TextField label="Width" prop="width" inspect={inspect} />
            <TextField label="Height" prop="height" inspect={inspect} />
            <SelectField
              label="Display"
              prop="display"
              inspect={inspect}
              options={[
                { value: 'block', label: 'Block' },
                { value: 'flex', label: 'Flex' },
                { value: 'grid', label: 'Grid' },
                { value: 'inline-flex', label: 'Inline flex' },
                { value: 'none', label: 'Hidden' },
              ]}
            />
            <SelectField
              label="Direction"
              prop="flexDirection"
              inspect={inspect}
              options={[
                { value: 'row', label: 'Row' },
                { value: 'column', label: 'Column' },
                { value: 'row-reverse', label: 'Row reverse' },
                { value: 'column-reverse', label: 'Column reverse' },
              ]}
            />
            <TextField label="Gap" prop="gap" inspect={inspect} />
            <SelectField
              label="Justify"
              prop="justifyContent"
              inspect={inspect}
              options={[
                { value: 'flex-start', label: 'Start' },
                { value: 'center', label: 'Center' },
                { value: 'flex-end', label: 'End' },
                { value: 'space-between', label: 'Between' },
                { value: 'space-around', label: 'Around' },
              ]}
            />
            <SelectField
              label="Align"
              prop="alignItems"
              inspect={inspect}
              options={[
                { value: 'flex-start', label: 'Start' },
                { value: 'center', label: 'Center' },
                { value: 'flex-end', label: 'End' },
                { value: 'stretch', label: 'Stretch' },
                { value: 'baseline', label: 'Baseline' },
              ]}
            />
          </Group>

          <Group title="Chrome">
            <TextField label="Border" prop="border" inspect={inspect} />
            <TextField label="Radius" prop="borderRadius" inspect={inspect} />
            <TextField label="Opacity" prop="opacity" inspect={inspect} />
            <TextField label="Shadow" prop="boxShadow" inspect={inspect} />
          </Group>

          <form className="space-y-2" onSubmit={onStructural}>
            <Field label="Structural">
              <input
                className={FIELD}
                value={structural}
                placeholder="Make this a three-column grid"
                onChange={(event) => setStructural(event.target.value)}
              />
            </Field>
            <button type="submit" className={CHIP} disabled={!structural.trim()}>
              Seed Improve
            </button>
          </form>
        </>
      )}
    </div>
  )
}