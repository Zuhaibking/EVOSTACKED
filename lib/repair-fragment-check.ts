import assert from 'node:assert/strict'
import { parseNextError, repairGeneratedFiles, repairGeneratedSource } from './repair-fragment'

const live = `
function formatPrice(amount: number) {
  return \`$\${amount.toFixed(2)}\`;
}
function ProductDialog({ product, open, onClose, onAddToCart }: any) {
  return (
    <Dialog open={open}>
      <p>{formatPrice(product?.price)}</p>
      <div>
        {product?.colors.map((c: string) => (
          <span key={c}>{c}</span>
        ))}
      </div>
    </Dialog>
  );
}
function CartDrawer({ cartItems, open, onClose, onClear, onRemove }: any) {
  const total = cartItems.reduce((sum: number, item: any) => sum + item.product.price * item.qty, 0);
  return <Sheet open={open}>{total}</Sheet>;
}
`

const fixed = repairGeneratedSource(live)
assert.match(fixed, /Number\(amount \?\? 0\)\.toFixed\(/)
assert.equal(fixed.includes('amount.toFixed('), false)
assert.match(fixed, /product\?\.colors\?\.map\(/)
assert.doesNotMatch(fixed, /product\?\.colors\.map\(/)
assert.match(fixed, /\(cartItems \?\? \[\]\)\.reduce\(/)
assert.equal(repairGeneratedSource(fixed), fixed)

const safe = 'export default function Page(){ return <h1>{(items ?? []).map(x => x)}</h1> }'
assert.equal(repairGeneratedSource(safe), safe)
assert.equal(
  repairGeneratedSource('const n = Number(price ?? 0).toFixed(2)'),
  'const n = Number(price ?? 0).toFixed(2)',
)
assert.equal(repairGeneratedSource('this.map(x => x)'), 'this.map(x => x)')
assert.match(repairGeneratedSource('foo.bar.map(x => x)'), /foo\.bar\.map/)

const files = repairGeneratedFiles([
  { file_path: 'pages/index.tsx', file_content: 'const x = n.toFixed(1)' },
  { file_path: 'public/generated.html', file_content: 'n.toFixed(1)' },
])
assert.match(files[0].file_content, /Number\(n \?\? 0\)\.toFixed/)
assert.equal(files[1].file_content, 'n.toFixed(1)')

const html =
  '<script id="__NEXT_DATA__" type="application/json">{"err":{"name":"TypeError","message":"Cannot read properties of undefined (reading \'toFixed\')"}}</script>'
assert.match(parseNextError(html) || '', /toFixed/)

const vivid = `
const AppContext = createContext(null);
function AppProvider({ children }) {
  const [regStatus, setRegStatus] = useState(null);
  return <AppContext.Provider value={{ regStatus, setRegStatus }}>{children}</AppContext.Provider>;
}
function useApp() { return useContext(AppContext); }
function useFlowState() {
  const [route, setRoute] = useState("home");
  return { route, setRoute };
}
export default function Home() {
  const { route, setRoute } = useFlowState();
  const { regStatus, setRegStatus } = useApp();
  return <main>{route}{regStatus}</main>;
}
`
const healed = repairGeneratedSource(vivid)
assert.match(healed, /\(useContext\(AppContext\) \?\? \{\}\)/)
assert.match(healed, /useFlowState\(\) \?\? \{\}/)
assert.match(healed, /useApp\(\) \?\? \{\}/)
assert.match(healed, /\/\* evo:providers \*\//)
assert.match(healed, /<AppProvider>/)
assert.match(healed, /function Home\(/)
assert.match(healed, /export default function EvoRoot/)
assert.equal(repairGeneratedSource(healed), healed)
assert.ok(!healed.includes('<AppProvider><AppProvider>'))

// usecontext-repair-precedence: member access binds tighter than ??, so the guard must parenthesize
assert.equal(
  repairGeneratedSource('const items = useContext(CartCtx).items;'),
  'const items = (useContext(CartCtx) ?? {}).items;',
)
assert.equal(
  repairGeneratedSource('<div>{useContext(AppCtx).name}</div>'),
  '<div>{(useContext(AppCtx) ?? {}).name}</div>'
)
assert.equal(
  repairGeneratedSource('const n = useContext(Ctx)?.name'),
  'const n = (useContext(Ctx) ?? {})?.name',
)
assert.equal(
  repairGeneratedSource('{(useContext(CartCtx) ?? {}).items.map(i => <li/>)}'),
  '{(useContext(CartCtx) ?? {}).items.map(i => <li/>)}',
)

// provider-wrap-duplicate-identifier: a default export already named Page must not collide
const pageNamed = `
function ThemeProvider({ children }) { return <Ctx.Provider>{children}</Ctx.Provider> }
export default function Page() { return <main>hi</main> }
`
const wrapped = repairGeneratedSource(pageNamed)
assert.equal(wrapped.match(/export default function/g)?.length, 1)
assert.match(wrapped, /export default function EvoRoot\(props\)/)
assert.match(wrapped, /<ThemeProvider><Page \{\.\.\.props\} \/><\/ThemeProvider>/)
assert.equal(wrapped.match(/^function Page\(/gm)?.length, 1)
assert.equal(repairGeneratedSource(wrapped), wrapped)

// already renders its own provider — wrapping again would double-mount state
const selfWrapped = `
function ThemeProvider({ children }) { return <Ctx.Provider>{children}</Ctx.Provider> }
export default function Page() { return <ThemeProvider><main>hi</main></ThemeProvider> }
`
assert.equal(repairGeneratedSource(selfWrapped), selfWrapped)

// provider-wrap-matches-comments: a commented-out export is left byte-identical
const commented = `// export default function Old() {}
function AppProvider({ children }) { return <Ctx.Provider>{children}</Ctx.Provider> }
export default function Home() { return <main>hi</main> }
`
const fromComment = repairGeneratedSource(commented)
assert.match(fromComment, /^\/\/ export default function Old\(\) \{\}$/m)
assert.equal(fromComment.includes('<Old {...props} />'), false)
assert.equal(fromComment.match(/^export default function/gm)?.length, 1)
assert.match(fromComment, /<AppProvider><Home \{\.\.\.props\} \/><\/AppProvider>/)
assert.equal(repairGeneratedSource(fromComment), fromComment)

console.log('repair-fragment-check ok')
