/**
 * EvoStack Platform — preset blueprints + seed data per business archetype (BLUEPRINT agent).
 *
 * Presets are the starting point the LLM adapts in `generateBlueprint` (lib/platform/blueprint.ts)
 * and the fallback when generation fails. Every preset is a complete, valid Blueprint.
 *
 * Conventions shared with the platform runtime (db / workflows / metrics):
 * - Enum fields: the FIRST option is the sensible default for new records (pending, new, requested…).
 * - Seed rows: relation fields hold the related record's TITLE (its titleField value);
 *   date = 'YYYY-MM-DD'; datetime = 'YYYY-MM-DDTHH:mm' (local, same as <input type="datetime-local">);
 *   tags = string[]; money/number = number; boolean = boolean. Rows may carry `created_at` (ISO)
 *   so timeseries charts have history from day one.
 * - Workflow actions:
 *   · notify        → `message` supports {{field}} placeholders from the triggering record.
 *   · set_field     → `collection` null = the triggering record; `field` + literal `value`.
 *   · adjust_number → `collection` = target; the target record is the one the triggering record
 *                     references through its relation field to that collection (orders.product →
 *                     products, matched by title); `value` = signed number string ('-1').
 *   · create_record → `collection` = target; `value` = JSON object string (field → value, {{field}} ok).
 */
import { PROJECT_TYPES } from './types'
import type {
  Blueprint, Chart, Collection, Field, FieldType, Metric, Module, ProjectType, SeedData, Setting, Workflow,
} from './types'

// ───────────────────────── Preset keys ─────────────────────────
export type PresetKey = 'ecommerce' | 'saas' | 'restaurant' | 'agency' | 'booking' | 'generic'
export const PRESET_KEYS: readonly PresetKey[] = ['ecommerce', 'saas', 'restaurant', 'agency', 'booking', 'generic']

/** Map a spec project type (or a preset key) onto the closest preset. */
export function presetKeyForType(type?: string | null): PresetKey {
  switch (type) {
    case 'ecommerce': case 'marketplace': return 'ecommerce'
    case 'saas': case 'community': return 'saas'
    case 'restaurant': return 'restaurant'
    case 'agency': case 'portfolio': return 'agency'
    case 'booking': case 'events': case 'education': return 'booking'
    default: return 'generic'
  }
}

// ───────────────────────── Shared module / group / icon heuristics ─────────────────────────
export const MODULE_GROUPS = ['Overview', 'Sales', 'Catalog', 'Operations', 'Customers', 'Insights', 'System'] as const
export type ModuleGroup = (typeof MODULE_GROUPS)[number]
export const CORE_MODULE_KINDS = ['overview', 'analytics', 'activity', 'workflows', 'settings'] as const
export type CoreModuleKind = (typeof CORE_MODULE_KINDS)[number]
export type CollectionModuleKind = 'table' | 'kanban' | 'calendar'

/** lucide-react icon names verified against the installed package. */
export const LUCIDE_ICONS = new Set<string>([
  'Activity', 'AlarmClock', 'Anchor', 'Archive', 'Armchair', 'AtSign', 'Award', 'Baby', 'BadgeCheck', 'BadgeDollarSign',
  'BadgePercent', 'Banknote', 'BarChart3', 'Bath', 'Bed', 'BedDouble', 'Beer', 'Bell', 'Bike', 'Bird', 'Blocks', 'Bone',
  'BookOpen', 'BookUser', 'Bookmark', 'Bot', 'Box', 'Boxes', 'Brain', 'Briefcase', 'Brush', 'Building', 'Building2', 'Bus',
  'Cake', 'Calendar', 'CalendarCheck', 'CalendarClock', 'CalendarDays', 'CalendarHeart', 'CalendarPlus', 'CalendarRange',
  'Camera', 'Car', 'CarFront', 'Cat', 'ChartColumn', 'ChartLine', 'ChartPie', 'CheckSquare', 'ChefHat', 'CircleDollarSign',
  'Clapperboard', 'Clipboard', 'ClipboardCheck', 'ClipboardList', 'Clock', 'Clock3', 'Cloud', 'Code', 'Coffee', 'Coins',
  'Compass', 'ConciergeBell', 'Construction', 'Contact', 'CookingPot', 'Cpu', 'CreditCard', 'Crown', 'Database',
  'DollarSign', 'DoorOpen', 'Droplets', 'Dumbbell', 'Eye', 'Factory', 'Feather', 'FileCheck', 'FileSignature',
  'FileSpreadsheet', 'FileText', 'Film', 'Filter', 'Fish', 'Flag', 'Flame', 'Flower2', 'Folder', 'FolderKanban', 'FolderOpen',
  'Footprints', 'Gamepad2', 'Gauge', 'Gem', 'Gift', 'Globe', 'GraduationCap', 'HandCoins', 'HandHeart', 'HandPlatter',
  'Handshake', 'Hash', 'Headphones', 'Heart', 'HeartHandshake', 'HeartPulse', 'History', 'Home', 'Hospital', 'Hotel',
  'Hourglass', 'House', 'IdCard', 'Image', 'Inbox', 'Kanban', 'KanbanSquare', 'Key', 'KeyRound', 'Landmark', 'Laptop',
  'Layers', 'LayoutDashboard', 'LayoutGrid', 'LayoutList', 'Leaf', 'LifeBuoy', 'Lightbulb', 'LineChart', 'Link', 'List',
  'ListChecks', 'ListOrdered', 'ListTodo', 'Lock', 'Luggage', 'Mail', 'MailOpen', 'Map', 'MapPin', 'Medal', 'Megaphone',
  'MessageCircle', 'MessageSquare', 'MessagesSquare', 'Mic', 'Monitor', 'Mountain', 'Music', 'Navigation', 'Network',
  'Newspaper', 'Notebook', 'NotebookPen', 'Package', 'PackageCheck', 'PackageOpen', 'Paintbrush', 'Palette', 'PartyPopper',
  'PawPrint', 'Pencil', 'Percent', 'Phone', 'PhoneCall', 'PieChart', 'PiggyBank', 'Pill', 'Pizza', 'Plane', 'Plug',
  'Presentation', 'Puzzle', 'Receipt', 'ReceiptText', 'Recycle', 'RefreshCw', 'Repeat', 'Rocket', 'Route', 'Salad',
  'Scale', 'School', 'Scissors', 'ScrollText', 'Search', 'Send', 'Server', 'Settings', 'Share2', 'Shield', 'Ship', 'Shirt',
  'ShoppingBag', 'ShoppingBasket', 'ShoppingCart', 'Smartphone', 'Smile', 'Sofa', 'Soup', 'Sparkles', 'SprayCan', 'Sprout',
  'SquareKanban', 'Star', 'StickyNote', 'Store', 'Stethoscope', 'Sun', 'Syringe', 'Table', 'Table2', 'Tag', 'Tags',
  'Target', 'Tent', 'Ticket', 'TicketCheck', 'Timer', 'Tractor', 'Train', 'Trees', 'TrendingUp', 'Trophy', 'Truck', 'Tv',
  'Umbrella', 'UserCheck', 'UserCog', 'UserPlus', 'UserRound', 'Users', 'Users2', 'UsersRound', 'Utensils',
  'UtensilsCrossed', 'Video', 'Wallet', 'Warehouse', 'Watch', 'Waves', 'Webhook', 'Wine', 'Workflow', 'Wrench', 'Zap',
])

const ICON_HINTS: [RegExp, string][] = [
  [/order|cart|checkout|purchase/, 'ShoppingCart'], [/product|inventory|stock|sku|merch|sneaker|shoe/, 'Package'],
  [/menu|dish|food|meal|recipe/, 'UtensilsCrossed'], [/appointment|reservation|booking|calendar|schedule|session|slot/, 'CalendarDays'],
  [/subscription|billing|payment|card/, 'CreditCard'], [/invoice|receipt|transaction/, 'Receipt'],
  [/discount|coupon|promo|voucher/, 'Percent'], [/lead|deal|opportunit|prospect/, 'Target'],
  [/project|pipeline|board/, 'FolderKanban'], [/ticket|support|issue|feedback|complaint/, 'LifeBuoy'],
  [/task|todo|checklist|job/, 'ListTodo'], [/staff|team|employee|stylist|groomer|therapist|instructor|driver/, 'UserCog'],
  [/service|treatment|package|offer/, 'Sparkles'], [/plan|tier|pricing/, 'Layers'], [/usage|metric|telemetry|analytic/, 'Gauge'],
  [/waitlist|signup|sign_up|registration|enrol/, 'UserPlus'], [/inquir|enquir|message|contact_request|request/, 'Inbox'],
  [/vehicle|van|truck|fleet|route|delivery/, 'Truck'], [/pet|dog|cat|animal|breed/, 'PawPrint'], [/review|rating|testimonial/, 'Star'],
  [/course|class|lesson|student|school/, 'GraduationCap'], [/donat|fundrais/, 'HandHeart'], [/volunteer/, 'HeartHandshake'],
  [/event|ticket/, 'Ticket'], [/property|room|listing|home|rental/, 'Home'], [/table|seat/, 'Armchair'],
  [/client|company|account|organization|business/, 'Building2'], [/customer|user|member|guest|people|person|contact|patient/, 'Users'],
  [/post|article|blog|content/, 'FileText'], [/supplier|vendor/, 'Truck'], [/location|store|branch|venue/, 'MapPin'],
]

/** Best-effort lucide icon for arbitrary text (collection key/label, metric key…). */
export function iconFor(text: string, fallback = 'Box'): string {
  const s = String(text || '').toLowerCase()
  for (const [re, icon] of ICON_HINTS) if (re.test(s)) return icon
  return fallback
}

const PIPELINE_RE = /lead|deal|opportunit|pipeline|project|ticket|task|todo|issue|request|inquir|enquir|application|applicant|candidate|job|case|feedback|support|proposal|work_order/
const APPOINTMENT_RE = /appointment|reservation|booking|session|class|lesson|visit|meeting|shift|schedule|slot|groom|consult|tour|rental|event/
const NON_CALENDAR_RE = /usage|log|analytic|telemetry|metric|audit|stat/

/** kanban when a pipeline-like status exists, calendar for appointment-like dates, otherwise table. */
export function inferModuleKind(c: Collection): CollectionModuleKind {
  const name = `${c.key} ${c.label}`.toLowerCase()
  const dateF = c.dateField ? c.fields.find(f => f.key === c.dateField) : undefined
  if (NON_CALENDAR_RE.test(name)) return c.statusField && PIPELINE_RE.test(name) ? 'kanban' : 'table'
  if (dateF && APPOINTMENT_RE.test(name)) return 'calendar'
  if (c.statusField && (PIPELINE_RE.test(name) || /stage|pipeline/.test(c.statusField))) return 'kanban'
  if (dateF?.type === 'datetime' && /start|scheduled|reserved|appointment|booking|slot/.test(dateF.key)) return 'calendar'
  return 'table'
}

const GROUP_HINTS: [RegExp, ModuleGroup][] = [
  [/usage|metric|analytic|telemetry|log|stat|report|survey/, 'Insights'],
  [/order|sale|lead|deal|invoice|payment|subscription|discount|coupon|quote|proposal|donation|transaction|refund|opportunit|checkout/, 'Sales'],
  [/product|item|menu|service|plan|package|catalog|course|listing|categor|dish|treatment|sku|collection|offer/, 'Catalog'],
  [/customer|client|user|member|contact|guest|patient|student|subscriber|signup|waitlist|donor|volunteer|attendee|pet|owner|people|person|review|testimonial|account/, 'Customers'],
]
export function inferGroup(c: Pick<Collection, 'key' | 'label'>): ModuleGroup {
  const name = `${c.key} ${c.label}`.toLowerCase()
  for (const [re, g] of GROUP_HINTS) if (re.test(name)) return g
  return 'Operations'
}

const CORE_MODULES: Record<CoreModuleKind, Omit<Module, 'key' | 'kind' | 'collection'>> = {
  overview: { label: 'Overview', icon: 'LayoutDashboard', group: 'Overview', description: 'Key numbers, trends and the latest activity' },
  analytics: { label: 'Analytics', icon: 'BarChart3', group: 'Insights', description: 'Charts and breakdowns across your data' },
  activity: { label: 'Activity', icon: 'Activity', group: 'Insights', description: 'Live feed of website submissions and changes' },
  workflows: { label: 'Workflows', icon: 'Workflow', group: 'System', description: 'Automations that run when records change' },
  settings: { label: 'Settings', icon: 'Settings', group: 'System', description: 'Business details, currency and preferences' },
}
export function coreModule(kind: CoreModuleKind): Module {
  return { key: kind, kind, collection: null, ...CORE_MODULES[kind] }
}
export function collectionModule(c: Collection, kind: CollectionModuleKind = inferModuleKind(c), group: string = inferGroup(c)): Module {
  return { key: c.key, label: c.label, icon: c.icon, kind, collection: c.key, group, description: c.description }
}
/** Overview first, then groups in MODULE_GROUPS order (stable within a group). */
export function sortModules(mods: Module[]): Module[] {
  const rank = (m: Module) => {
    if (m.kind === 'overview') return -1
    const i = (MODULE_GROUPS as readonly string[]).indexOf(m.group)
    return i < 0 ? MODULE_GROUPS.length - 1.5 : i
  }
  return mods.map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).map(x => x.m)
}
export function buildModules(cols: Collection[], overrides: Record<string, { kind?: CollectionModuleKind; group?: ModuleGroup }> = {}): Module[] {
  return sortModules([
    coreModule('overview'),
    ...cols.map(c => collectionModule(c, overrides[c.key]?.kind, overrides[c.key]?.group)),
    coreModule('analytics'), coreModule('activity'), coreModule('workflows'), coreModule('settings'),
  ])
}

// ───────────────────────── Compact builders ─────────────────────────
/** flags: r = required, p = publicWritable (website may set), h = hidden from table */
function fld(key: string, label: string, type: FieldType, flags = '', extra: Partial<Field> = {}): Field {
  return {
    key, label, type, required: flags.includes('r'), options: [], relation: null,
    showInTable: !flags.includes('h'), publicWritable: flags.includes('p'), ...extra,
  }
}
const F = {
  text: (k: string, l: string, fl = '') => fld(k, l, 'text', fl),
  long: (k: string, l: string, fl = '') => fld(k, l, 'longtext', fl),
  num: (k: string, l: string, fl = '') => fld(k, l, 'number', fl),
  money: (k: string, l: string, fl = '') => fld(k, l, 'money', fl),
  bool: (k: string, l: string, fl = '') => fld(k, l, 'boolean', fl),
  date: (k: string, l: string, fl = '') => fld(k, l, 'date', fl),
  dt: (k: string, l: string, fl = '') => fld(k, l, 'datetime', fl),
  email: (k: string, l: string, fl = '') => fld(k, l, 'email', fl),
  phone: (k: string, l: string, fl = '') => fld(k, l, 'phone', fl),
  url: (k: string, l: string, fl = '') => fld(k, l, 'url', fl),
  img: (k: string, l: string, fl = '') => fld(k, l, 'image', fl),
  enum: (k: string, l: string, options: string[], fl = '') => fld(k, l, 'enum', fl, { options }),
  tags: (k: string, l: string, options: string[], fl = '') => fld(k, l, 'tags', fl, { options }),
  rel: (k: string, l: string, target: string, fl = '') => fld(k, l, 'relation', fl, { relation: target }),
}
type ColInput = Pick<Collection, 'key' | 'label' | 'singular' | 'icon' | 'description' | 'titleField' | 'fields'> &
  Partial<Pick<Collection, 'statusField' | 'dateField' | 'publicCreate' | 'publicRead'>>
function col(c: ColInput): Collection {
  return { statusField: null, dateField: null, publicCreate: false, publicRead: false, ...c }
}
function met(key: string, label: string, collection: string, op: Metric['op'], field: string | null, filter: [string, string] | null, format: Metric['format'], icon: string): Metric {
  return { key, label, collection, op, field, filter: filter ? { field: filter[0], equals: filter[1] } : null, format, icon }
}
function chart(key: string, label: string, kind: Chart['kind'], collection: string, op: Chart['op'], field: string | null, groupBy: string | null): Chart {
  return { key, label, kind, collection, op, field, groupBy }
}
type Action = Workflow['actions'][number]
const A = {
  notify: (message: string): Action => ({ type: 'notify', collection: null, field: null, value: null, message }),
  set: (field: string, value: string, collection: string | null = null): Action => ({ type: 'set_field', collection, field, value, message: null }),
  adjust: (collection: string, field: string, value: string): Action => ({ type: 'adjust_number', collection, field, value, message: null }),
}
function wf(key: string, name: string, description: string, trigger: [string, Workflow['trigger']['event'], string | null], actions: Action[], enabled = true): Workflow {
  return { key, name, description, trigger: { collection: trigger[0], event: trigger[1], toStatus: trigger[2] }, actions, enabled }
}
function setting(key: string, label: string, type: Setting['type'], value: string, group: string, description: string, options: string[] = []): Setting {
  return { key, label, type, value, options, group, description }
}
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'JPY']
const currencySetting = (group = 'General') => setting('currency', 'Currency', 'select', 'USD', group, 'Used for prices, totals and revenue', CURRENCIES)

// ───────────────────────── Seed helpers ─────────────────────────
const DAY = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')
/** Date helpers relative to `now` (deterministic offsets; UTC calendar parts). */
export function seedClock(now = Date.now()) {
  const parts = (offset: number) => { const d = new Date(now + offset * DAY); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` }
  return {
    now,
    /** 'YYYY-MM-DD' `offset` days from now */
    day: (offset: number) => parts(offset),
    /** 'YYYY-MM-DDTHH:mm' `offset` days from now at hh:mm */
    at: (offset: number, hh: number, mm = 0) => `${parts(offset)}T${pad(hh)}:${pad(mm)}`,
    /** ISO timestamp `days` (fractional ok) before now */
    ago: (days: number) => new Date(now - days * DAY).toISOString(),
  }
}
export type SeedClock = ReturnType<typeof seedClock>
function rows(keys: string[], data: unknown[][]): Record<string, unknown>[] {
  return data.map(r => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? null])))
}
/** Stamp `created_at` (newest first, spread over ~`spanDays`) on rows that don't carry one. */
export function stampCreatedAt(list: Record<string, unknown>[], clock: SeedClock, spanDays = 42): Record<string, unknown>[] {
  const n = Math.max(1, list.length)
  return list.map((r, i) => (r.created_at ? r : { ...r, created_at: clock.ago(0.08 + (i * spanDays) / n + ((i * 7) % 5) * 0.13) }))
}
const pic = (slug: string) => `https://picsum.photos/seed/${slug}/640/480`

// ───────────────────────── ECOMMERCE ─────────────────────────
function ecommerce(): Blueprint {
  const collections = [
    col({
      key: 'products', label: 'Products', singular: 'Product', icon: 'Package', description: 'Catalog, pricing and inventory',
      titleField: 'name', statusField: 'status', publicRead: true,
      fields: [
        F.text('name', 'Name', 'r'), F.text('sku', 'SKU', 'r'), F.money('price', 'Price', 'r'), F.num('stock', 'Stock'),
        F.enum('inventory', 'Inventory', ['in_stock', 'low_stock', 'out_of_stock']),
        F.enum('category', 'Category', ['Apparel', 'Footwear', 'Accessories', 'Home', 'Beauty'], 'r'),
        F.enum('status', 'Status', ['active', 'draft', 'archived']), F.bool('featured', 'Featured'),
        F.img('image', 'Image', 'h'), F.long('description', 'Description', 'h'),
      ],
    }),
    col({
      key: 'orders', label: 'Orders', singular: 'Order', icon: 'ShoppingCart', description: 'Checkout orders, payment and fulfillment',
      titleField: 'customer_name', statusField: 'status', publicCreate: true,
      fields: [
        F.text('customer_name', 'Customer', 'rp'), F.email('customer_email', 'Email', 'rp'), F.phone('customer_phone', 'Phone', 'ph'),
        F.rel('product', 'Product', 'products', 'p'), F.num('quantity', 'Qty', 'p'), F.long('items', 'Items', 'ph'),
        F.money('total', 'Total', 'rp'),
        F.enum('status', 'Status', ['pending', 'paid', 'fulfilled', 'shipped', 'refunded']),
        F.enum('payment_status', 'Payment', ['unpaid', 'paid', 'refunded']),
        F.long('shipping_address', 'Shipping address', 'ph'), F.long('notes', 'Notes', 'ph'),
      ],
    }),
    col({
      key: 'customers', label: 'Customers', singular: 'Customer', icon: 'Users', description: 'Shoppers created at checkout or signup',
      titleField: 'name', publicCreate: true,
      fields: [
        F.text('name', 'Name', 'rp'), F.email('email', 'Email', 'rp'), F.phone('phone', 'Phone', 'p'), F.text('city', 'City', 'p'),
        F.enum('segment', 'Segment', ['new', 'returning', 'vip']), F.num('orders_count', 'Orders'), F.money('total_spent', 'Total spent'),
        F.bool('accepts_marketing', 'Marketing opt-in', 'p'),
      ],
    }),
    col({
      key: 'discounts', label: 'Discounts', singular: 'Discount', icon: 'Percent', description: 'Promo codes and campaigns',
      titleField: 'code', dateField: 'expires',
      fields: [
        F.text('code', 'Code', 'r'), F.num('percent', 'Percent off', 'r'), F.bool('active', 'Active'), F.date('expires', 'Expires'),
        F.num('uses', 'Uses'), F.text('description', 'Description', 'h'),
      ],
    }),
  ]
  return {
    projectType: 'ecommerce', appName: 'Northwind Goods', collections,
    modules: buildModules(collections, { orders: { kind: 'table', group: 'Sales' }, discounts: { kind: 'table', group: 'Sales' } }),
    metrics: [
      met('revenue', 'Revenue', 'orders', 'sum', 'total', ['payment_status', 'paid'], 'money', 'DollarSign'),
      met('orders', 'Orders', 'orders', 'count', null, null, 'number', 'ShoppingCart'),
      met('avg_order_value', 'Avg. order value', 'orders', 'avg', 'total', ['payment_status', 'paid'], 'money', 'Receipt'),
      met('pending_orders', 'To fulfil', 'orders', 'count', null, ['status', 'paid'], 'number', 'PackageOpen'),
      met('low_stock', 'Low stock', 'products', 'count', null, ['inventory', 'low_stock'], 'number', 'PackageCheck'),
      met('customers', 'Customers', 'customers', 'count', null, null, 'number', 'Users'),
    ],
    charts: [
      chart('revenue_over_time', 'Revenue', 'timeseries', 'orders', 'sum', 'total', null),
      chart('orders_over_time', 'Orders', 'timeseries', 'orders', 'count', null, null),
      chart('orders_by_status', 'Orders by status', 'breakdown', 'orders', 'count', null, 'status'),
      chart('products_by_category', 'Products by category', 'breakdown', 'products', 'count', null, 'category'),
    ],
    workflows: [
      wf('order_created', 'New order → update stock & notify', 'Decrements the ordered product\'s stock and alerts the team',
        ['orders', 'created', null], [A.adjust('products', 'stock', '-1'), A.notify('New order from {{customer_name}} · {{total}}')]),
      wf('order_paid', 'Order paid → mark payment', 'Marks the payment as captured when an order moves to paid',
        ['orders', 'status_changed', 'paid'], [A.set('payment_status', 'paid'), A.notify('Payment received for {{customer_name}}\'s order')]),
      wf('order_shipped', 'Order shipped → notify', 'Lets the team know an order left the warehouse',
        ['orders', 'status_changed', 'shipped'], [A.notify('Order for {{customer_name}} has shipped')]),
      wf('order_refunded', 'Order refunded → flag payment', 'Flags the payment as refunded and alerts finance',
        ['orders', 'status_changed', 'refunded'], [A.set('payment_status', 'refunded'), A.notify('Order for {{customer_name}} was refunded ({{total}})')]),
      wf('customer_created', 'New customer → notify', 'Celebrates every new customer account',
        ['customers', 'created', null], [A.notify('New customer: {{name}} ({{email}})')]),
    ],
    settings: [
      setting('store_name', 'Store name', 'text', 'Northwind Goods', 'Store', 'Shown in receipts and emails'),
      currencySetting('Store'),
      setting('tax_rate', 'Tax %', 'number', '8.5', 'Checkout', 'Applied to taxable orders'),
      setting('free_shipping_threshold', 'Free shipping over', 'money', '75', 'Checkout', 'Orders above this ship free'),
      setting('flat_shipping', 'Flat shipping rate', 'money', '6.95', 'Checkout', 'Charged below the free-shipping threshold'),
      setting('low_stock_threshold', 'Low-stock threshold', 'number', '10', 'Inventory', 'Products at or below this count are flagged'),
      setting('order_notifications', 'Order notifications', 'boolean', 'true', 'Notifications', 'Notify the team about new orders'),
      setting('support_email', 'Support email', 'text', 'support@northwindgoods.com', 'Store', 'Reply-to address for customers'),
    ],
  }
}
function ecommerceSeed(c: SeedClock): SeedData {
  const products = rows(['name', 'sku', 'price', 'stock', 'inventory', 'category', 'status', 'featured', 'description'], [
    ['Everyday Linen Shirt', 'NW-AP-1001', 68, 42, 'in_stock', 'Apparel', 'active', true, 'Breathable washed linen with a relaxed fit.'],
    ['Merino Crew Sweater', 'NW-AP-1002', 118, 7, 'low_stock', 'Apparel', 'active', true, 'Fine-gauge merino, warm without the bulk.'],
    ['Relaxed Chino Pant', 'NW-AP-1003', 84, 26, 'in_stock', 'Apparel', 'active', false, 'Garment-dyed stretch twill.'],
    ['Recycled Puffer Vest', 'NW-AP-1004', 135, 15, 'in_stock', 'Apparel', 'draft', false, 'Recycled shell and fill. Launching next drop.'],
    ['Canvas Weekender Bag', 'NW-AC-2001', 145, 12, 'in_stock', 'Accessories', 'active', true, 'Waxed canvas with leather handles.'],
    ['Leather Card Wallet', 'NW-AC-2002', 39, 64, 'in_stock', 'Accessories', 'active', false, 'Vegetable-tanned, four card slots.'],
    ['Waxed Cotton Cap', 'NW-AC-2003', 32, 0, 'out_of_stock', 'Accessories', 'active', false, 'Six-panel cap, water resistant.'],
    ['Court Classic Sneaker', 'NW-FW-3001', 110, 18, 'in_stock', 'Footwear', 'active', true, 'Full-grain leather low-top.'],
    ['Suede Chelsea Boot', 'NW-FW-3002', 189, 4, 'low_stock', 'Footwear', 'active', false, 'Crepe sole, water-repellent suede.'],
    ['Stoneware Mug Set', 'NW-HM-4001', 36, 55, 'in_stock', 'Home', 'active', false, 'Set of two hand-glazed mugs.'],
    ['Wool Throw Blanket', 'NW-HM-4002', 96, 9, 'low_stock', 'Home', 'active', true, 'Herringbone lambswool throw.'],
    ['Soy Candle — Cedar & Smoke', 'NW-HM-4003', 28, 80, 'in_stock', 'Home', 'active', false, '50-hour burn, cotton wick.'],
    ['Botanical Hand Cream', 'NW-BT-5001', 22, 71, 'in_stock', 'Beauty', 'active', false, 'Shea butter and calendula.'],
    ['Daily Face Serum', 'NW-BT-5002', 48, 33, 'in_stock', 'Beauty', 'active', false, 'Niacinamide + hyaluronic acid.'],
  ]).map(r => ({ ...r, image: pic(String(r.sku).toLowerCase()) }))
  const orders = rows(['customer_name', 'customer_email', 'product', 'quantity', 'items', 'total', 'status', 'payment_status', 'shipping_address'], [
    ['Ava Thompson', 'ava.thompson@example.com', 'Merino Crew Sweater', 1, '1 × Merino Crew Sweater (M)', 118, 'pending', 'unpaid', '214 Elm St, Portland, OR 97205'],
    ['Marcus Lee', 'marcus.lee@example.com', 'Court Classic Sneaker', 1, '1 × Court Classic Sneaker (US 10)\n1 × Leather Card Wallet', 149, 'paid', 'paid', '88 Pine Ave, Seattle, WA 98101'],
    ['Priya Patel', 'priya.patel@example.org', 'Wool Throw Blanket', 1, '1 × Wool Throw Blanket (Oat)\n2 × Soy Candle — Cedar & Smoke', 152, 'fulfilled', 'paid', '5 Harbor Rd, Boston, MA 02110'],
    ['Daniel Kim', 'daniel.kim@example.com', 'Canvas Weekender Bag', 1, '1 × Canvas Weekender Bag (Olive)', 145, 'shipped', 'paid', '402 Market St, San Francisco, CA 94105'],
    ['Sofia Rossi', 'sofia.rossi@example.net', 'Daily Face Serum', 2, '2 × Daily Face Serum\n1 × Botanical Hand Cream', 118, 'shipped', 'paid', '17 Bleecker St, New York, NY 10012'],
    ['Ethan Brooks', 'ethan.brooks@example.com', 'Everyday Linen Shirt', 2, '2 × Everyday Linen Shirt (L)', 136, 'fulfilled', 'paid', '930 Congress Ave, Austin, TX 78701'],
    ['Chloe Martin', 'chloe.martin@example.org', 'Stoneware Mug Set', 1, '1 × Stoneware Mug Set\n1 × Soy Candle — Cedar & Smoke', 64, 'shipped', 'paid', '61 Lake Shore Dr, Chicago, IL 60611'],
    ['Liam O\'Connor', 'liam.oconnor@example.com', 'Suede Chelsea Boot', 1, '1 × Suede Chelsea Boot (US 11)', 189, 'refunded', 'refunded', '12 Beacon St, Denver, CO 80202'],
    ['Hannah Schmidt', 'hannah.schmidt@example.net', 'Relaxed Chino Pant', 1, '1 × Relaxed Chino Pant (32/32)\n1 × Waxed Cotton Cap', 116, 'shipped', 'paid', '300 Peachtree St, Atlanta, GA 30308'],
    ['Noah Williams', 'noah.williams@example.com', 'Leather Card Wallet', 1, '1 × Leather Card Wallet (Tan)', 39, 'pending', 'unpaid', '45 Ocean Blvd, Miami, FL 33139'],
    ['Mia Johnson', 'mia.johnson@example.org', 'Botanical Hand Cream', 3, '3 × Botanical Hand Cream', 66, 'paid', 'paid', '700 Nicollet Mall, Minneapolis, MN 55402'],
    ['Lucas Garcia', 'lucas.garcia@example.com', 'Merino Crew Sweater', 1, '1 × Merino Crew Sweater (L)\n1 × Everyday Linen Shirt (M)', 186, 'fulfilled', 'paid', '1200 Broadway, Nashville, TN 37203'],
    ['Isabella Nguyen', 'isabella.nguyen@example.net', 'Wool Throw Blanket', 1, '1 × Wool Throw Blanket (Charcoal)', 96, 'shipped', 'paid', '55 Mission St, San Diego, CA 92101'],
    ['James Wilson', 'james.wilson@example.com', 'Court Classic Sneaker', 1, '1 × Court Classic Sneaker (US 9)', 110, 'shipped', 'paid', '9 Liberty Pl, Philadelphia, PA 19103'],
    ['Olivia Brown', 'olivia.brown@example.org', 'Canvas Weekender Bag', 1, '1 × Canvas Weekender Bag (Navy)\n1 × Leather Card Wallet', 184, 'fulfilled', 'paid', '150 Main St, Salt Lake City, UT 84101'],
    ['Ava Thompson', 'ava.thompson@example.com', 'Soy Candle — Cedar & Smoke', 2, '2 × Soy Candle — Cedar & Smoke', 56, 'shipped', 'paid', '214 Elm St, Portland, OR 97205'],
  ])
  const customers = rows(['name', 'email', 'phone', 'city', 'segment', 'orders_count', 'total_spent', 'accepts_marketing'], [
    ['Ava Thompson', 'ava.thompson@example.com', '+1 503 555 0114', 'Portland', 'vip', 6, 742, true],
    ['Marcus Lee', 'marcus.lee@example.com', '+1 206 555 0187', 'Seattle', 'returning', 3, 389, true],
    ['Priya Patel', 'priya.patel@example.org', '+1 617 555 0142', 'Boston', 'returning', 2, 248, false],
    ['Daniel Kim', 'daniel.kim@example.com', '+1 415 555 0163', 'San Francisco', 'new', 1, 145, true],
    ['Sofia Rossi', 'sofia.rossi@example.net', '+1 212 555 0129', 'New York', 'vip', 7, 918, true],
    ['Ethan Brooks', 'ethan.brooks@example.com', '+1 512 555 0171', 'Austin', 'new', 1, 136, false],
    ['Chloe Martin', 'chloe.martin@example.org', '+1 312 555 0155', 'Chicago', 'returning', 2, 131, true],
    ['Liam O\'Connor', 'liam.oconnor@example.com', '+1 303 555 0108', 'Denver', 'new', 1, 0, false],
    ['Hannah Schmidt', 'hannah.schmidt@example.net', '+1 404 555 0196', 'Atlanta', 'returning', 3, 342, true],
    ['Noah Williams', 'noah.williams@example.com', '+1 305 555 0133', 'Miami', 'new', 1, 39, false],
    ['Mia Johnson', 'mia.johnson@example.org', '+1 612 555 0177', 'Minneapolis', 'returning', 4, 296, true],
    ['Lucas Garcia', 'lucas.garcia@example.com', '+1 615 555 0119', 'Nashville', 'new', 1, 186, true],
    ['Isabella Nguyen', 'isabella.nguyen@example.net', '+1 619 555 0148', 'San Diego', 'returning', 2, 175, false],
    ['James Wilson', 'james.wilson@example.com', '+1 215 555 0182', 'Philadelphia', 'new', 1, 110, true],
    ['Olivia Brown', 'olivia.brown@example.org', '+1 801 555 0124', 'Salt Lake City', 'vip', 5, 655, true],
  ])
  const discounts = rows(['code', 'percent', 'active', 'expires', 'uses', 'description'], [
    ['WELCOME10', 10, true, c.day(60), 128, 'First order for newsletter subscribers'],
    ['SPRING20', 20, true, c.day(21), 46, 'Seasonal sale on apparel'],
    ['VIP15', 15, true, c.day(180), 31, 'Always-on code for VIP customers'],
    ['BUNDLE25', 25, true, c.day(14), 9, 'Home bundle promotion'],
    ['LOYAL5', 5, true, c.day(365), 302, 'Loyalty program members'],
    ['STUDENT10', 10, true, c.day(240), 64, 'Verified students'],
    ['HOLIDAY30', 30, false, c.day(-30), 212, 'Holiday campaign (ended)'],
    ['FLASH40', 40, false, c.day(-62), 87, '48-hour flash sale (ended)'],
  ])
  return { products, orders, customers, discounts }
}

// ───────────────────────── SAAS ─────────────────────────
function saas(): Blueprint {
  const planOpts = ['free', 'starter', 'pro', 'business']
  const collections = [
    col({
      key: 'users', label: 'Users', singular: 'User', icon: 'Users', description: 'Accounts, roles and plans',
      titleField: 'name', statusField: 'status',
      fields: [
        F.text('name', 'Name', 'r'), F.email('email', 'Email', 'r'), F.text('company', 'Company'),
        F.enum('role', 'Role', ['member', 'admin', 'owner', 'viewer']), F.enum('plan', 'Plan', planOpts),
        F.enum('status', 'Status', ['invited', 'active', 'suspended']), F.dt('last_seen', 'Last seen'),
      ],
    }),
    col({
      key: 'subscriptions', label: 'Subscriptions', singular: 'Subscription', icon: 'CreditCard', description: 'Recurring revenue by account',
      titleField: 'account', statusField: 'status', dateField: 'renews_at',
      fields: [
        F.text('account', 'Account', 'r'), F.rel('user', 'Owner', 'users'), F.enum('plan', 'Plan', ['starter', 'pro', 'business'], 'r'),
        F.money('mrr', 'MRR', 'r'), F.enum('status', 'Status', ['trialing', 'active', 'past_due', 'canceled']),
        F.num('seats', 'Seats'), F.date('started_at', 'Started'), F.date('renews_at', 'Renews'),
      ],
    }),
    col({
      key: 'plans', label: 'Plans', singular: 'Plan', icon: 'Layers', description: 'Pricing tiers shown on the website',
      titleField: 'name', publicRead: true,
      fields: [
        F.text('name', 'Name', 'r'), F.money('price', 'Price', 'r'), F.enum('interval', 'Billing', ['monthly', 'yearly']),
        F.num('seats_included', 'Seats'), F.long('features', 'Features', 'h'), F.bool('highlighted', 'Highlighted'), F.bool('active', 'Active'),
      ],
    }),
    col({
      key: 'usage_events', label: 'Usage', singular: 'Usage event', icon: 'Gauge', description: 'Feature usage by account',
      titleField: 'account', dateField: 'occurred_at',
      fields: [
        F.text('account', 'Account', 'r'), F.enum('feature', 'Feature', ['api_calls', 'dashboards', 'exports', 'ai_insights', 'integrations'], 'r'),
        F.num('count', 'Count', 'r'), F.dt('occurred_at', 'When'),
      ],
    }),
    col({
      key: 'tickets', label: 'Feedback & tickets', singular: 'Ticket', icon: 'LifeBuoy', description: 'Support requests and product feedback from the website',
      titleField: 'subject', statusField: 'status', publicCreate: true,
      fields: [
        F.text('subject', 'Subject', 'rp'), F.text('name', 'Name', 'p'), F.email('email', 'Email', 'rp'),
        F.enum('category', 'Category', ['question', 'bug', 'feature_request', 'billing'], 'p'),
        F.enum('priority', 'Priority', ['normal', 'low', 'high', 'urgent']),
        F.enum('status', 'Status', ['open', 'in_progress', 'waiting', 'resolved']), F.long('message', 'Message', 'rph'),
      ],
    }),
    col({
      key: 'waitlist', label: 'Waitlist', singular: 'Signup', icon: 'UserPlus', description: 'Early-access signups from the website',
      titleField: 'email', statusField: 'status', publicCreate: true,
      fields: [
        F.email('email', 'Email', 'rp'), F.text('name', 'Name', 'p'), F.text('company', 'Company', 'p'),
        F.enum('team_size', 'Team size', ['1-10', '11-50', '51-200', '200+'], 'p'),
        F.enum('source', 'Source', ['website', 'referral', 'product_hunt', 'twitter', 'newsletter'], 'p'),
        F.enum('status', 'Status', ['waiting', 'invited', 'converted']), F.long('use_case', 'Use case', 'ph'),
      ],
    }),
  ]
  return {
    projectType: 'saas', appName: 'Lumen Analytics', collections,
    modules: buildModules(collections, { tickets: { kind: 'kanban', group: 'Operations' }, waitlist: { kind: 'table', group: 'Customers' }, users: { group: 'Customers' }, usage_events: { kind: 'table', group: 'Insights' } }),
    metrics: [
      met('mrr', 'MRR', 'subscriptions', 'sum', 'mrr', ['status', 'active'], 'money', 'DollarSign'),
      met('active_subscriptions', 'Active subscriptions', 'subscriptions', 'count', null, ['status', 'active'], 'number', 'CreditCard'),
      met('trials', 'Trials', 'subscriptions', 'count', null, ['status', 'trialing'], 'number', 'Hourglass'),
      met('churned', 'Churned', 'subscriptions', 'count', null, ['status', 'canceled'], 'number', 'TrendingUp'),
      met('users', 'Users', 'users', 'count', null, null, 'number', 'Users'),
      met('open_tickets', 'Open tickets', 'tickets', 'count', null, ['status', 'open'], 'number', 'LifeBuoy'),
      met('waitlist', 'Waitlist', 'waitlist', 'count', null, ['status', 'waiting'], 'number', 'UserPlus'),
    ],
    charts: [
      chart('signups_over_time', 'Waitlist signups', 'timeseries', 'waitlist', 'count', null, null),
      chart('mrr_by_plan', 'MRR by plan', 'breakdown', 'subscriptions', 'sum', 'mrr', 'plan'),
      chart('subscriptions_by_status', 'Subscriptions by status', 'breakdown', 'subscriptions', 'count', null, 'status'),
      chart('usage_over_time', 'Feature usage', 'timeseries', 'usage_events', 'sum', 'count', null),
      chart('usage_by_feature', 'Usage by feature', 'breakdown', 'usage_events', 'sum', 'count', 'feature'),
    ],
    workflows: [
      wf('waitlist_signup', 'Waitlist signup → notify', 'Pings the team for every early-access signup',
        ['waitlist', 'created', null], [A.notify('{{email}} joined the waitlist ({{team_size}} people)')]),
      wf('ticket_created', 'New ticket → notify support', 'Routes new website tickets to support',
        ['tickets', 'created', null], [A.notify('New {{category}} ticket: {{subject}}')]),
      wf('ticket_resolved', 'Ticket resolved → notify', 'Confirms when a ticket is closed out',
        ['tickets', 'status_changed', 'resolved'], [A.notify('Resolved: {{subject}}')]),
      wf('subscription_past_due', 'Payment failed → alert', 'Flags accounts whose payment failed',
        ['subscriptions', 'status_changed', 'past_due'], [A.notify('Payment failed for {{account}} ({{plan}}, {{mrr}}/mo)')]),
      wf('subscription_canceled', 'Churn → alert', 'Alerts the team when an account cancels',
        ['subscriptions', 'status_changed', 'canceled'], [A.notify('{{account}} canceled their {{plan}} plan')]),
      wf('subscription_active', 'Trial converted → celebrate', 'Celebrates trials converting to paid',
        ['subscriptions', 'status_changed', 'active'], [A.notify('{{account}} is now a paying {{plan}} customer')]),
    ],
    settings: [
      setting('product_name', 'Product name', 'text', 'Lumen Analytics', 'General', 'Shown in emails and the app'),
      currencySetting('Billing'),
      setting('trial_days', 'Trial length (days)', 'number', '14', 'Billing', 'Free trial before the first charge'),
      setting('default_plan', 'Default plan', 'select', 'starter', 'Billing', 'Plan new signups start on', planOpts),
      setting('annual_discount', 'Annual discount %', 'number', '17', 'Billing', 'Discount for yearly billing'),
      setting('allow_signups', 'Open signups', 'boolean', 'true', 'Access', 'Allow self-serve signups from the website'),
      setting('waitlist_mode', 'Waitlist mode', 'boolean', 'false', 'Access', 'Collect signups without granting access'),
      setting('support_email', 'Support email', 'text', 'support@lumenanalytics.io', 'General', 'Where ticket replies come from'),
    ],
  }
}
function saasSeed(c: SeedClock): SeedData {
  const users = rows(['name', 'email', 'company', 'role', 'plan', 'status', 'last_seen'], [
    ['Elena Vasquez', 'elena@brightloop.io', 'Brightloop', 'owner', 'pro', 'active', c.at(0, 9, 12)],
    ['Tom Becker', 'tom@brightloop.io', 'Brightloop', 'admin', 'pro', 'active', c.at(-1, 16, 40)],
    ['Aisha Rahman', 'aisha@northwind.dev', 'Northwind Dev', 'owner', 'business', 'active', c.at(0, 11, 5)],
    ['Kenji Watanabe', 'kenji@paperplane.co', 'Paperplane', 'owner', 'starter', 'active', c.at(-2, 14, 22)],
    ['Grace Liu', 'grace@lumora.app', 'Lumora', 'owner', 'pro', 'active', c.at(0, 8, 47)],
    ['Oliver Hughes', 'oliver@stackfield.io', 'Stackfield', 'member', 'business', 'active', c.at(-3, 10, 15)],
    ['Fatima Zahra', 'fatima@orbitly.com', 'Orbitly', 'owner', 'starter', 'active', c.at(-1, 13, 30)],
    ['Ben Carter', 'ben@quillhq.com', 'Quill', 'owner', 'free', 'active', c.at(-19, 17, 2)],
    ['Sara Lindqvist', 'sara@fjordlabs.se', 'Fjord Labs', 'owner', 'pro', 'suspended', c.at(-6, 9, 55)],
    ['Marcus Bell', 'marcus@heliohealth.com', 'Helio Health', 'owner', 'business', 'active', c.at(0, 7, 31)],
    ['Nina Petrova', 'nina@copperline.co', 'Copperline', 'owner', 'pro', 'active', c.at(-1, 18, 9)],
    ['Sam Okafor', 'sam@driftwood.studio', 'Driftwood Studio', 'owner', 'free', 'active', c.at(-4, 12, 0)],
    ['Lena Fischer', 'lena@vantageretail.de', 'Vantage Retail', 'owner', 'pro', 'active', c.at(0, 10, 20)],
    ['Raj Mehta', 'raj@northwind.dev', 'Northwind Dev', 'viewer', 'business', 'invited', null],
  ])
  const subscriptions = rows(['account', 'user', 'plan', 'mrr', 'status', 'seats', 'started_at', 'renews_at'], [
    ['Brightloop', 'Elena Vasquez', 'pro', 99, 'active', 8, c.day(-214), c.day(12)],
    ['Northwind Dev', 'Aisha Rahman', 'business', 299, 'active', 22, c.day(-402), c.day(5)],
    ['Paperplane', 'Kenji Watanabe', 'starter', 29, 'active', 3, c.day(-95), c.day(20)],
    ['Lumora', 'Grace Liu', 'pro', 99, 'trialing', 6, c.day(-6), c.day(8)],
    ['Stackfield', 'Oliver Hughes', 'business', 299, 'active', 25, c.day(-331), c.day(18)],
    ['Orbitly', 'Fatima Zahra', 'starter', 29, 'trialing', 2, c.day(-3), c.day(11)],
    ['Fjord Labs', 'Sara Lindqvist', 'pro', 99, 'past_due', 9, c.day(-182), c.day(-2)],
    ['Quill', 'Ben Carter', 'starter', 29, 'canceled', 3, c.day(-150), c.day(-20)],
    ['Helio Health', 'Marcus Bell', 'business', 299, 'active', 18, c.day(-120), c.day(9)],
    ['Copperline', 'Nina Petrova', 'pro', 99, 'active', 7, c.day(-64), c.day(26)],
    ['Driftwood Studio', 'Sam Okafor', 'starter', 29, 'canceled', 2, c.day(-88), c.day(-28)],
    ['Vantage Retail', 'Lena Fischer', 'pro', 99, 'trialing', 5, c.day(-9), c.day(5)],
  ])
  const plans = rows(['name', 'price', 'interval', 'seats_included', 'features', 'highlighted', 'active'], [
    ['Free', 0, 'monthly', 1, '1 project · 10k events/mo · 7-day history', false, true],
    ['Starter', 29, 'monthly', 3, '5 projects · 250k events/mo · 90-day history · Email support', false, true],
    ['Pro', 99, 'monthly', 10, 'Unlimited projects · 2M events/mo · AI insights · Priority support', true, true],
    ['Business', 299, 'monthly', 25, '10M events/mo · SSO & audit logs · Dedicated success manager', false, true],
    ['Starter (annual)', 290, 'yearly', 3, 'Starter billed yearly — 2 months free', false, true],
    ['Pro (annual)', 990, 'yearly', 10, 'Pro billed yearly — 2 months free', false, true],
    ['Business (annual)', 2990, 'yearly', 25, 'Business billed yearly — 2 months free', false, true],
    ['Legacy Team', 49, 'monthly', 5, 'Grandfathered 2023 plan', false, false],
  ])
  const feats = ['api_calls', 'dashboards', 'exports', 'ai_insights', 'integrations']
  const accts = ['Brightloop', 'Northwind Dev', 'Stackfield', 'Helio Health', 'Copperline', 'Lumora', 'Paperplane', 'Vantage Retail']
  const usage_events = Array.from({ length: 16 }, (_, i) => {
    const feature = feats[i % feats.length]
    const base = feature === 'api_calls' ? 18_000 : feature === 'dashboards' ? 40 : feature === 'exports' ? 120 : feature === 'ai_insights' ? 260 : 12
    return { account: accts[(i * 3) % accts.length], feature, count: Math.round(base * (0.55 + ((i * 37) % 11) / 10)), occurred_at: c.at(-Math.floor(i * 1.8), 8 + (i % 9), (i * 13) % 60), created_at: c.ago(i * 1.8 + 0.1) }
  })
  const tickets = rows(['subject', 'name', 'email', 'category', 'priority', 'status', 'message'], [
    ['CSV export times out on large dashboards', 'Tom Becker', 'tom@brightloop.io', 'bug', 'high', 'in_progress', 'Exports over ~50k rows fail after 30s.'],
    ['Can we get a Slack integration?', 'Grace Liu', 'grace@lumora.app', 'feature_request', 'normal', 'open', 'Would love alerts piped into Slack channels.'],
    ['Charged twice this month', 'Sara Lindqvist', 'sara@fjordlabs.se', 'billing', 'urgent', 'waiting', 'Two charges of $99 on the 3rd.'],
    ['How do I invite my team?', 'Fatima Zahra', 'fatima@orbitly.com', 'question', 'low', 'resolved', 'Looking for the seat invite flow.'],
    ['Funnel chart shows wrong totals', 'Oliver Hughes', 'oliver@stackfield.io', 'bug', 'high', 'open', 'Step 3 count exceeds step 2.'],
    ['Dark mode for embedded dashboards', 'Nina Petrova', 'nina@copperline.co', 'feature_request', 'low', 'open', 'Our app is dark-only.'],
    ['SSO setup with Okta', 'Marcus Bell', 'marcus@heliohealth.com', 'question', 'normal', 'in_progress', 'Need the SAML metadata URL.'],
    ['Upgrade to annual billing', 'Kenji Watanabe', 'kenji@paperplane.co', 'billing', 'normal', 'resolved', 'Please switch us to yearly.'],
    ['API rate limit too low for backfill', 'Aisha Rahman', 'aisha@northwind.dev', 'feature_request', 'high', 'waiting', 'Backfilling 6 months of events.'],
    ['AI insights missing for last week', 'Lena Fischer', 'lena@vantageretail.de', 'bug', 'normal', 'open', 'Insights panel is empty since Monday.'],
  ])
  const waitlist = rows(['email', 'name', 'company', 'team_size', 'source', 'status', 'use_case'], [
    ['maya@fernway.com', 'Maya Chen', 'Fernway', '11-50', 'product_hunt', 'waiting', 'Product analytics for our mobile app'],
    ['jordan@pixelcraft.io', 'Jordan Reyes', 'Pixelcraft', '1-10', 'twitter', 'invited', 'Replace our spreadsheet KPIs'],
    ['amir@cartwheel.co', 'Amir Haddad', 'Cartwheel', '51-200', 'referral', 'converted', 'Checkout funnel analysis'],
    ['lucy@greenline.org', 'Lucy Park', 'Greenline', '11-50', 'newsletter', 'waiting', 'Donor journey tracking'],
    ['victor@hexa.dev', 'Victor Moreau', 'Hexa', '1-10', 'website', 'waiting', 'Self-serve dashboards for clients'],
    ['zoe@brightpath.ai', 'Zoe Adams', 'Brightpath AI', '11-50', 'product_hunt', 'invited', 'LLM feature usage tracking'],
    ['kofi@tradewind.com', 'Kofi Mensah', 'Tradewind', '200+', 'referral', 'waiting', 'Enterprise reporting'],
    ['ines@solace.health', 'Inês Costa', 'Solace Health', '51-200', 'website', 'waiting', 'Patient app engagement'],
    ['ryan@loopkit.dev', 'Ryan Walsh', 'Loopkit', '1-10', 'twitter', 'converted', 'API usage billing'],
    ['hana@kumo.jp', 'Hana Sato', 'Kumo', '11-50', 'website', 'waiting', 'Retention cohorts'],
    ['leo@baseframe.io', 'Leo Novak', 'Baseframe', '1-10', 'newsletter', 'waiting', 'Weekly investor metrics'],
    ['eva@northpeak.co', 'Eva Lindgren', 'Northpeak', '51-200', 'website', 'invited', 'Marketing attribution'],
  ])
  return { users, subscriptions, plans, usage_events, tickets, waitlist }
}

// ───────────────────────── RESTAURANT ─────────────────────────
function restaurant(): Blueprint {
  const collections = [
    col({
      key: 'menu_items', label: 'Menu', singular: 'Menu item', icon: 'UtensilsCrossed', description: 'Dishes, prices and availability shown on the website',
      titleField: 'name', publicRead: true,
      fields: [
        F.text('name', 'Name', 'r'), F.enum('category', 'Category', ['Starters', 'Pasta', 'Pizza', 'Mains', 'Desserts', 'Drinks'], 'r'),
        F.money('price', 'Price', 'r'), F.tags('dietary', 'Dietary', ['vegetarian', 'vegan', 'gluten_free', 'spicy', 'nut_free']),
        F.bool('available', 'Available'), F.bool('popular', 'Popular'), F.long('description', 'Description', 'h'), F.img('image', 'Photo', 'h'),
      ],
    }),
    col({
      key: 'reservations', label: 'Reservations', singular: 'Reservation', icon: 'CalendarDays', description: 'Table bookings from the website and phone',
      titleField: 'guest_name', statusField: 'status', dateField: 'reserved_for', publicCreate: true,
      fields: [
        F.text('guest_name', 'Guest', 'rp'), F.dt('reserved_for', 'Date & time', 'rp'), F.num('party_size', 'Party', 'rp'),
        F.email('email', 'Email', 'p'), F.phone('phone', 'Phone', 'p'),
        F.enum('status', 'Status', ['requested', 'confirmed', 'seated', 'completed', 'no_show']),
        F.rel('table', 'Table', 'tables'), F.enum('occasion', 'Occasion', ['none', 'birthday', 'anniversary', 'business', 'date_night'], 'p'),
        F.long('notes', 'Notes', 'ph'),
      ],
    }),
    col({
      key: 'orders', label: 'Orders', singular: 'Order', icon: 'ShoppingBag', description: 'Pickup and delivery orders for the kitchen',
      titleField: 'customer_name', statusField: 'status', publicCreate: true,
      fields: [
        F.text('customer_name', 'Customer', 'rp'), F.phone('phone', 'Phone', 'p'), F.email('email', 'Email', 'ph'),
        F.enum('fulfillment', 'Type', ['pickup', 'delivery'], 'p'), F.long('items', 'Items', 'rp'), F.money('total', 'Total', 'rp'),
        F.enum('status', 'Status', ['received', 'preparing', 'ready', 'out_for_delivery', 'completed', 'canceled']),
        F.dt('pickup_time', 'Ready by', 'p'), F.text('address', 'Delivery address', 'ph'),
      ],
    }),
    col({
      key: 'tables', label: 'Tables', singular: 'Table', icon: 'Armchair', description: 'Floor plan and table status',
      titleField: 'name', statusField: 'status',
      fields: [
        F.text('name', 'Table', 'r'), F.num('seats', 'Seats', 'r'), F.enum('area', 'Area', ['Main room', 'Patio', 'Bar', 'Private room']),
        F.enum('status', 'Status', ['available', 'reserved', 'occupied', 'out_of_service']),
      ],
    }),
  ]
  return {
    projectType: 'restaurant', appName: 'Osteria Lumi', collections,
    modules: buildModules(collections, { orders: { kind: 'kanban', group: 'Sales' }, reservations: { kind: 'calendar', group: 'Operations' }, menu_items: { group: 'Catalog' } }),
    metrics: [
      met('revenue', 'Order revenue', 'orders', 'sum', 'total', ['status', 'completed'], 'money', 'DollarSign'),
      met('orders', 'Orders', 'orders', 'count', null, null, 'number', 'ShoppingBag'),
      met('in_kitchen', 'In the kitchen', 'orders', 'count', null, ['status', 'preparing'], 'number', 'ChefHat'),
      met('reservations', 'Reservations', 'reservations', 'count', null, null, 'number', 'CalendarDays'),
      met('confirmed_covers', 'Confirmed covers', 'reservations', 'sum', 'party_size', ['status', 'confirmed'], 'number', 'Users'),
      met('avg_ticket', 'Avg. order', 'orders', 'avg', 'total', null, 'money', 'Receipt'),
    ],
    charts: [
      chart('order_revenue', 'Order revenue', 'timeseries', 'orders', 'sum', 'total', null),
      chart('reservations_over_time', 'Reservations booked', 'timeseries', 'reservations', 'count', null, null),
      chart('reservations_by_status', 'Reservations by status', 'breakdown', 'reservations', 'count', null, 'status'),
      chart('orders_by_type', 'Pickup vs delivery', 'breakdown', 'orders', 'count', null, 'fulfillment'),
      chart('menu_by_category', 'Menu by category', 'breakdown', 'menu_items', 'count', null, 'category'),
    ],
    workflows: [
      wf('reservation_created', 'New reservation → notify host', 'Alerts the host stand about every new booking',
        ['reservations', 'created', null], [A.notify('New reservation: {{guest_name}}, party of {{party_size}} on {{reserved_for}}')]),
      wf('reservation_no_show', 'No-show → notify', 'Logs no-shows so the host can follow up',
        ['reservations', 'status_changed', 'no_show'], [A.notify('{{guest_name}} did not show up (party of {{party_size}})')]),
      wf('order_created', 'New order → notify kitchen', 'Sends incoming pickup/delivery orders to the kitchen',
        ['orders', 'created', null], [A.notify('New {{fulfillment}} order from {{customer_name}} · {{total}}')]),
      wf('order_ready', 'Order ready → notify', 'Tells front-of-house an order is ready to hand off',
        ['orders', 'status_changed', 'ready'], [A.notify('Order for {{customer_name}} is ready')]),
    ],
    settings: [
      setting('restaurant_name', 'Restaurant name', 'text', 'Osteria Lumi', 'General', 'Shown on confirmations'),
      currencySetting('General'),
      setting('tax_rate', 'Tax %', 'number', '8.875', 'Orders', 'Sales tax on food and drinks'),
      setting('opening_hours', 'Opening hours', 'text', 'Tue–Sun · 17:00–23:00', 'Reservations', 'Displayed on the website'),
      setting('max_party_size', 'Max online party size', 'number', '8', 'Reservations', 'Larger groups must call'),
      setting('seating_duration', 'Seating duration (min)', 'number', '90', 'Reservations', 'How long a table is held'),
      setting('accept_online_orders', 'Accept online orders', 'boolean', 'true', 'Orders', 'Pause when the kitchen is slammed'),
      setting('delivery_fee', 'Delivery fee', 'money', '4.99', 'Orders', 'Flat fee for delivery orders'),
      setting('delivery_radius_km', 'Delivery radius (km)', 'number', '5', 'Orders', 'Maximum delivery distance'),
    ],
  }
}
function restaurantSeed(c: SeedClock): SeedData {
  const menu_items = rows(['name', 'category', 'price', 'dietary', 'available', 'popular', 'description'], [
    ['Burrata & Heirloom Tomatoes', 'Starters', 16, ['vegetarian', 'gluten_free'], true, true, 'Basil oil, aged balsamic, sea salt.'],
    ['Crispy Calamari', 'Starters', 15, [], true, false, 'Lemon aioli, Calabrian chili.'],
    ['Arancini al Tartufo', 'Starters', 13, ['vegetarian'], true, false, 'Truffle risotto, fontina, saffron.'],
    ['Cacio e Pepe', 'Pasta', 21, ['vegetarian'], true, true, 'Tonnarelli, pecorino romano, black pepper.'],
    ['Pappardelle al Ragù', 'Pasta', 26, [], true, true, 'Slow-braised beef and pork ragù.'],
    ['Lobster Linguine', 'Pasta', 34, ['spicy'], true, false, 'Half lobster, cherry tomato, chili.'],
    ['Margherita DOP', 'Pizza', 18, ['vegetarian'], true, true, 'San Marzano, fior di latte, basil.'],
    ['Diavola', 'Pizza', 21, ['spicy'], true, false, 'Spicy salami, chili honey, mozzarella.'],
    ['Funghi & Truffle', 'Pizza', 24, ['vegetarian'], false, false, 'Wild mushrooms, truffle cream, thyme.'],
    ['Branzino al Forno', 'Mains', 36, ['gluten_free'], true, false, 'Whole roasted sea bass, salsa verde.'],
    ['Pollo alla Diavola', 'Mains', 29, ['gluten_free', 'spicy'], true, false, 'Brick chicken, charred lemon.'],
    ['Eggplant Parmigiana', 'Mains', 24, ['vegetarian'], true, false, 'Layered eggplant, tomato, parmesan.'],
    ['Tiramisù', 'Desserts', 11, ['vegetarian'], true, true, 'Mascarpone, espresso, cocoa.'],
    ['Olive Oil Cake', 'Desserts', 10, ['vegetarian', 'nut_free'], true, false, 'Citrus glaze, crème fraîche.'],
    ['Aperol Spritz', 'Drinks', 14, ['vegan'], true, true, 'Aperol, prosecco, orange.'],
    ['Montepulciano d\'Abruzzo (glass)', 'Drinks', 13, ['vegan'], true, false, 'Medium-bodied red.'],
  ]).map(r => ({ ...r, image: pic(String(r.name).toLowerCase().replace(/[^a-z]+/g, '-')) }))
  const tables = rows(['name', 'seats', 'area', 'status'], [
    ['T1', 2, 'Main room', 'available'], ['T2', 2, 'Main room', 'occupied'], ['T3', 4, 'Main room', 'reserved'],
    ['T4', 4, 'Main room', 'available'], ['T5', 6, 'Main room', 'occupied'], ['P1', 2, 'Patio', 'available'],
    ['P2', 4, 'Patio', 'out_of_service'], ['B1', 2, 'Bar', 'occupied'], ['B2', 2, 'Bar', 'available'], ['PR1', 10, 'Private room', 'reserved'],
  ])
  const reservations = rows(['guest_name', 'reserved_for', 'party_size', 'email', 'phone', 'status', 'table', 'occasion', 'notes'], [
    ['Sophie Laurent', c.at(0, 19, 30), 2, 'sophie.laurent@example.com', '+1 646 555 0110', 'confirmed', 'T1', 'anniversary', 'Window seat if possible'],
    ['The Okafor family', c.at(0, 18, 0), 5, 'chidi.okafor@example.com', '+1 646 555 0121', 'confirmed', 'T5', 'birthday', 'High chair needed'],
    ['Daniel Rivera', c.at(0, 20, 15), 4, 'daniel.rivera@example.net', '+1 917 555 0132', 'requested', null, 'none', ''],
    ['Grace Holloway', c.at(1, 19, 0), 2, 'grace.h@example.org', '+1 347 555 0143', 'confirmed', 'P1', 'date_night', ''],
    ['Kensington Partners', c.at(1, 12, 30), 8, 'events@kensington.example.com', '+1 212 555 0154', 'confirmed', 'PR1', 'business', 'Set menu, invoice to company'],
    ['Marco Bianchi', c.at(2, 20, 0), 3, 'marco.bianchi@example.com', '+1 718 555 0165', 'requested', null, 'none', 'Gluten-free guest'],
    ['Aiko Tanaka', c.at(3, 18, 45), 2, 'aiko.tanaka@example.net', '+1 646 555 0176', 'confirmed', 'T2', 'none', ''],
    ['Rachel Green', c.at(4, 21, 0), 6, 'rachel.green@example.com', '+1 917 555 0187', 'requested', null, 'birthday', 'Bringing a cake'],
    ['Omar Haddad', c.at(6, 19, 15), 4, 'omar.haddad@example.org', '+1 347 555 0198', 'confirmed', 'T4', 'none', ''],
    ['Emily Clarke', c.at(-1, 19, 0), 2, 'emily.clarke@example.com', '+1 646 555 0109', 'completed', 'B1', 'date_night', ''],
    ['Henrik Larsen', c.at(-1, 20, 30), 4, 'henrik.larsen@example.net', '+1 212 555 0118', 'no_show', 'T3', 'none', 'Called twice, no answer'],
    ['Priya Desai', c.at(-2, 18, 30), 3, 'priya.desai@example.com', '+1 718 555 0127', 'completed', 'T4', 'birthday', ''],
    ['Lucas Moreau', c.at(-3, 19, 45), 2, 'lucas.moreau@example.org', '+1 917 555 0136', 'completed', 'P1', 'anniversary', 'Champagne on arrival'],
    ['Nadia Petrov', c.at(0, 18, 15), 2, 'nadia.petrov@example.com', '+1 646 555 0145', 'seated', 'B1', 'none', ''],
  ])
  const orders = rows(['customer_name', 'phone', 'email', 'fulfillment', 'items', 'total', 'status', 'pickup_time', 'address'], [
    ['Jake Morrison', '+1 646 555 0201', 'jake.m@example.com', 'pickup', '2 × Margherita DOP\n1 × Tiramisù', 47, 'received', c.at(0, 18, 40), null],
    ['Leila Ahmadi', '+1 917 555 0212', 'leila.a@example.com', 'delivery', '1 × Cacio e Pepe\n1 × Burrata & Heirloom Tomatoes', 42, 'preparing', c.at(0, 18, 55), '22 Bedford St, Apt 4B'],
    ['Chris Donovan', '+1 347 555 0223', 'chris.d@example.net', 'pickup', '1 × Diavola\n1 × Crispy Calamari', 36, 'preparing', c.at(0, 19, 5), null],
    ['Ana Souza', '+1 718 555 0234', 'ana.souza@example.org', 'delivery', '2 × Pappardelle al Ragù\n2 × Olive Oil Cake', 72, 'ready', c.at(0, 18, 30), '145 Grand St'],
    ['Tom Fischer', '+1 646 555 0245', 'tom.f@example.com', 'delivery', '1 × Lobster Linguine', 34, 'out_for_delivery', c.at(0, 18, 20), '9 Charlton St'],
    ['Mei Lin', '+1 917 555 0256', 'mei.lin@example.com', 'pickup', '1 × Eggplant Parmigiana\n1 × Aperol Spritz', 38, 'completed', c.at(-1, 19, 10), null],
    ['Samuel Adeyemi', '+1 347 555 0267', 'sam.adeyemi@example.net', 'delivery', '3 × Margherita DOP\n1 × Arancini al Tartufo', 67, 'completed', c.at(-1, 20, 0), '301 W 4th St'],
    ['Isla McKenzie', '+1 718 555 0278', 'isla.mck@example.org', 'pickup', '1 × Branzino al Forno', 36, 'completed', c.at(-2, 19, 30), null],
    ['Victor Hugo', '+1 646 555 0289', 'victor.h@example.com', 'delivery', '1 × Pollo alla Diavola\n1 × Tiramisù', 40, 'canceled', c.at(-2, 20, 15), '77 Perry St'],
    ['Zara Khan', '+1 917 555 0290', 'zara.khan@example.com', 'pickup', '2 × Cacio e Pepe', 42, 'completed', c.at(-3, 18, 45), null],
    ['Ben Turner', '+1 347 555 0301', 'ben.turner@example.net', 'delivery', '1 × Funghi & Truffle\n1 × Diavola', 45, 'completed', c.at(-4, 19, 50), '18 Barrow St'],
    ['Olga Ivanova', '+1 718 555 0312', 'olga.i@example.org', 'pickup', '1 × Margherita DOP\n2 × Aperol Spritz', 46, 'completed', c.at(-5, 20, 20), null],
    ['Paolo Conti', '+1 646 555 0323', 'paolo.c@example.com', 'delivery', '2 × Lobster Linguine\n1 × Burrata & Heirloom Tomatoes', 84, 'completed', c.at(-6, 19, 40), '50 Morton St'],
    ['Hailey Brooks', '+1 917 555 0334', 'hailey.b@example.com', 'pickup', '1 × Tiramisù\n1 × Olive Oil Cake', 21, 'completed', c.at(-8, 17, 30), null],
  ])
  return { menu_items, tables, reservations, orders }
}

// ───────────────────────── AGENCY ─────────────────────────
function agency(): Blueprint {
  const collections = [
    col({
      key: 'clients', label: 'Clients', singular: 'Client', icon: 'Building2', description: 'Accounts you work with',
      titleField: 'name', statusField: 'status',
      fields: [
        F.text('name', 'Company', 'r'), F.text('contact_name', 'Contact'), F.email('email', 'Email'), F.phone('phone', 'Phone', 'h'),
        F.text('industry', 'Industry'), F.enum('status', 'Status', ['active', 'paused', 'former']), F.money('retainer', 'Monthly retainer'),
        F.url('website', 'Website', 'h'),
      ],
    }),
    col({
      key: 'leads', label: 'Leads', singular: 'Lead', icon: 'Target', description: 'New business pipeline from the website and referrals',
      titleField: 'name', statusField: 'stage', dateField: 'next_follow_up', publicCreate: true,
      fields: [
        F.text('name', 'Name', 'rp'), F.email('email', 'Email', 'rp'), F.text('company', 'Company', 'p'), F.phone('phone', 'Phone', 'ph'),
        F.enum('service', 'Service', ['branding', 'web_design', 'development', 'seo', 'content', 'paid_media'], 'p'),
        F.money('value', 'Est. value', 'p'), F.enum('source', 'Source', ['website', 'referral', 'linkedin', 'dribbble', 'event', 'outbound'], 'p'),
        F.enum('stage', 'Stage', ['new', 'contacted', 'proposal', 'won', 'lost']), F.date('next_follow_up', 'Follow up'),
        F.long('message', 'Message', 'ph'),
      ],
    }),
    col({
      key: 'projects', label: 'Projects', singular: 'Project', icon: 'FolderKanban', description: 'Active engagements and delivery status',
      titleField: 'name', statusField: 'status', dateField: 'due_date',
      fields: [
        F.text('name', 'Project', 'r'), F.rel('client', 'Client', 'clients', 'r'), F.money('budget', 'Budget'),
        F.enum('status', 'Status', ['planning', 'in_progress', 'review', 'delivered', 'on_hold']), F.date('due_date', 'Due'),
        F.text('owner', 'Lead'), F.num('progress', 'Progress %'),
      ],
    }),
    col({
      key: 'invoices', label: 'Invoices', singular: 'Invoice', icon: 'Receipt', description: 'Billing and payments',
      titleField: 'number', statusField: 'status', dateField: 'due_on',
      fields: [
        F.text('number', 'Invoice #', 'r'), F.rel('client', 'Client', 'clients', 'r'), F.rel('project', 'Project', 'projects'),
        F.money('amount', 'Amount', 'r'), F.enum('status', 'Status', ['draft', 'sent', 'paid', 'overdue']),
        F.date('issued_on', 'Issued'), F.date('due_on', 'Due'),
      ],
    }),
  ]
  return {
    projectType: 'agency', appName: 'Northbeam Studio', collections,
    modules: buildModules(collections, { leads: { kind: 'kanban', group: 'Sales' }, projects: { kind: 'kanban', group: 'Operations' }, invoices: { kind: 'table', group: 'Sales' }, clients: { kind: 'table', group: 'Customers' } }),
    metrics: [
      met('pipeline_value', 'Open proposals', 'leads', 'sum', 'value', ['stage', 'proposal'], 'money', 'Target'),
      met('won_value', 'Won business', 'leads', 'sum', 'value', ['stage', 'won'], 'money', 'Trophy'),
      met('new_leads', 'New leads', 'leads', 'count', null, ['stage', 'new'], 'number', 'Inbox'),
      met('active_projects', 'Active projects', 'projects', 'count', null, ['status', 'in_progress'], 'number', 'FolderKanban'),
      met('outstanding', 'Outstanding invoices', 'invoices', 'sum', 'amount', ['status', 'sent'], 'money', 'Receipt'),
      met('collected', 'Collected', 'invoices', 'sum', 'amount', ['status', 'paid'], 'money', 'DollarSign'),
    ],
    charts: [
      chart('leads_over_time', 'Leads', 'timeseries', 'leads', 'count', null, null),
      chart('leads_by_stage', 'Pipeline by stage', 'breakdown', 'leads', 'sum', 'value', 'stage'),
      chart('leads_by_source', 'Leads by source', 'breakdown', 'leads', 'count', null, 'source'),
      chart('invoiced_over_time', 'Invoiced', 'timeseries', 'invoices', 'sum', 'amount', null),
      chart('projects_by_status', 'Projects by status', 'breakdown', 'projects', 'count', null, 'status'),
    ],
    workflows: [
      wf('lead_created', 'New lead → notify', 'Alerts the team about inbound inquiries',
        ['leads', 'created', null], [A.notify('New lead: {{name}} ({{company}}) — {{service}}')]),
      wf('lead_won', 'Deal won → celebrate', 'Shares wins with the whole studio',
        ['leads', 'status_changed', 'won'], [A.notify('Won: {{company}} · {{value}}')]),
      wf('project_delivered', 'Project delivered → notify', 'Prompts invoicing when a project ships',
        ['projects', 'status_changed', 'delivered'], [A.notify('{{name}} delivered — time to send the final invoice'), A.set('progress', '100')]),
      wf('invoice_paid', 'Invoice paid → notify', 'Confirms incoming payments',
        ['invoices', 'status_changed', 'paid'], [A.notify('Invoice {{number}} paid · {{amount}}')]),
      wf('invoice_overdue', 'Invoice overdue → alert', 'Flags late payments for follow-up',
        ['invoices', 'status_changed', 'overdue'], [A.notify('Invoice {{number}} is overdue ({{amount}})')]),
    ],
    settings: [
      setting('agency_name', 'Agency name', 'text', 'Northbeam Studio', 'General', 'Shown on proposals and invoices'),
      currencySetting('Billing'),
      setting('hourly_rate', 'Default hourly rate', 'money', '150', 'Billing', 'Used for estimates'),
      setting('payment_terms_days', 'Payment terms (days)', 'number', '30', 'Billing', 'Invoice due date offset'),
      setting('tax_rate', 'Tax %', 'number', '0', 'Billing', 'VAT / sales tax on invoices'),
      setting('lead_auto_reply', 'Auto-reply to leads', 'boolean', 'true', 'Sales', 'Send a confirmation email to new leads'),
      setting('min_project_budget', 'Minimum project budget', 'money', '5000', 'Sales', 'Shown on the contact form'),
    ],
  }
}
function agencySeed(c: SeedClock): SeedData {
  const clients = rows(['name', 'contact_name', 'email', 'phone', 'industry', 'status', 'retainer', 'website'], [
    ['Fernway Outdoors', 'Maya Chen', 'maya@fernway.com', '+1 503 555 0140', 'Retail', 'active', 6500, 'https://fernway.com'],
    ['Helio Health', 'Marcus Bell', 'marcus@heliohealth.com', '+1 617 555 0151', 'Healthcare', 'active', 9000, 'https://heliohealth.com'],
    ['Copperline Coffee', 'Nina Petrova', 'nina@copperline.co', '+1 206 555 0162', 'Food & Beverage', 'active', 3500, 'https://copperline.co'],
    ['Atlas Robotics', 'Sam Okafor', 'sam@atlasrobotics.io', '+1 415 555 0173', 'Technology', 'active', 12000, 'https://atlasrobotics.io'],
    ['Greenline Trust', 'Lucy Park', 'lucy@greenline.org', '+1 202 555 0184', 'Nonprofit', 'paused', 0, 'https://greenline.org'],
    ['Vantage Retail', 'Lena Fischer', 'lena@vantageretail.de', '+49 30 5550 195', 'Retail', 'active', 4800, 'https://vantageretail.de'],
    ['Solace Health', 'Inês Costa', 'ines@solace.health', '+351 21 555 0106', 'Healthcare', 'active', 5200, 'https://solace.health'],
    ['Brightpath AI', 'Zoe Adams', 'zoe@brightpath.ai', '+1 646 555 0117', 'Technology', 'active', 7500, 'https://brightpath.ai'],
    ['Harbor & Co.', 'Elliot Shaw', 'elliot@harborandco.com', '+1 312 555 0128', 'Hospitality', 'former', 0, 'https://harborandco.com'],
    ['Kumo Studio', 'Hana Sato', 'hana@kumo.jp', '+81 3 5550 1139', 'Design', 'active', 2500, 'https://kumo.jp'],
  ])
  const leads = rows(['name', 'email', 'company', 'phone', 'service', 'value', 'source', 'stage', 'next_follow_up', 'message'], [
    ['Jordan Reyes', 'jordan@pixelcraft.io', 'Pixelcraft', '+1 512 555 0201', 'web_design', 18000, 'website', 'new', c.day(1), 'Need a new marketing site before our Series A.'],
    ['Amir Haddad', 'amir@cartwheel.co', 'Cartwheel', '+1 312 555 0212', 'development', 42000, 'referral', 'proposal', c.day(3), 'Shopify Plus migration + custom app.'],
    ['Lucía Romero', 'lucia@solmar.es', 'Solmar Hotels', '+34 91 555 0223', 'branding', 26000, 'linkedin', 'contacted', c.day(2), 'Rebrand for 4 boutique hotels.'],
    ['Victor Moreau', 'victor@hexa.dev', 'Hexa', '+33 1 5550 0234', 'seo', 9000, 'website', 'new', c.day(0), 'Organic traffic dropped 40%.'],
    ['Kofi Mensah', 'kofi@tradewind.com', 'Tradewind Logistics', '+1 404 555 0245', 'development', 65000, 'event', 'proposal', c.day(5), 'Customer portal and tracking dashboard.'],
    ['Eva Lindgren', 'eva@northpeak.co', 'Northpeak', '+46 8 555 0256', 'paid_media', 15000, 'referral', 'won', null, 'Q1 launch campaign.'],
    ['Leo Novak', 'leo@baseframe.io', 'Baseframe', '+1 415 555 0267', 'branding', 22000, 'dribbble', 'contacted', c.day(4), 'Loved your Kumo identity work.'],
    ['Ryan Walsh', 'ryan@loopkit.dev', 'Loopkit', '+1 646 555 0278', 'web_design', 12000, 'website', 'lost', null, 'Went with an in-house hire.'],
    ['Priya Nair', 'priya@meadowfoods.com', 'Meadow Foods', '+1 617 555 0289', 'content', 8000, 'outbound', 'contacted', c.day(6), 'Monthly content retainer.'],
    ['Ben Alvarez', 'ben@ridgeline.bike', 'Ridgeline Bikes', '+1 303 555 0290', 'web_design', 24000, 'website', 'new', c.day(1), 'E-commerce redesign with configurator.'],
    ['Clara Weiss', 'clara@weissarchitects.de', 'Weiss Architects', '+49 89 555 0301', 'branding', 14000, 'linkedin', 'proposal', c.day(2), 'Identity + portfolio site.'],
    ['Daniel Osei', 'daniel@farmlink.africa', 'FarmLink', '+233 30 555 0312', 'development', 38000, 'referral', 'won', null, 'Farmer onboarding app.'],
    ['Sofia Marino', 'sofia@velaswim.com', 'Vela Swim', '+1 305 555 0323', 'paid_media', 11000, 'website', 'new', c.day(0), 'Summer collection launch ads.'],
    ['Hugo Becker', 'hugo@lumenlabs.ai', 'Lumen Labs', '+1 650 555 0334', 'seo', 7000, 'event', 'lost', null, 'Budget frozen until next year.'],
  ])
  const projects = rows(['name', 'client', 'budget', 'status', 'due_date', 'owner', 'progress'], [
    ['Fernway e-commerce rebuild', 'Fernway Outdoors', 48000, 'in_progress', c.day(24), 'Alex Rivera', 62],
    ['Helio patient portal UX', 'Helio Health', 36000, 'review', c.day(6), 'Priya Shah', 90],
    ['Copperline brand refresh', 'Copperline Coffee', 18000, 'delivered', c.day(-12), 'Jonas Berg', 100],
    ['Atlas product launch site', 'Atlas Robotics', 52000, 'in_progress', c.day(38), 'Alex Rivera', 35],
    ['Vantage SEO sprint', 'Vantage Retail', 9600, 'in_progress', c.day(15), 'Mia Torres', 55],
    ['Solace app onboarding', 'Solace Health', 27000, 'planning', c.day(52), 'Priya Shah', 10],
    ['Brightpath design system', 'Brightpath AI', 31000, 'in_progress', c.day(29), 'Jonas Berg', 48],
    ['Greenline donor campaign', 'Greenline Trust', 12000, 'on_hold', c.day(60), 'Mia Torres', 20],
    ['Kumo portfolio site', 'Kumo Studio', 8500, 'review', c.day(3), 'Jonas Berg', 85],
    ['Harbor & Co. menu redesign', 'Harbor & Co.', 4200, 'delivered', c.day(-45), 'Mia Torres', 100],
  ])
  const invoices = rows(['number', 'client', 'project', 'amount', 'status', 'issued_on', 'due_on'], [
    ['INV-1041', 'Fernway Outdoors', 'Fernway e-commerce rebuild', 16000, 'paid', c.day(-58), c.day(-28)],
    ['INV-1042', 'Helio Health', 'Helio patient portal UX', 12000, 'paid', c.day(-50), c.day(-20)],
    ['INV-1043', 'Copperline Coffee', 'Copperline brand refresh', 9000, 'paid', c.day(-40), c.day(-10)],
    ['INV-1044', 'Atlas Robotics', 'Atlas product launch site', 17500, 'sent', c.day(-12), c.day(18)],
    ['INV-1045', 'Vantage Retail', 'Vantage SEO sprint', 4800, 'overdue', c.day(-38), c.day(-8)],
    ['INV-1046', 'Brightpath AI', 'Brightpath design system', 10500, 'sent', c.day(-6), c.day(24)],
    ['INV-1047', 'Fernway Outdoors', 'Fernway e-commerce rebuild', 16000, 'sent', c.day(-4), c.day(26)],
    ['INV-1048', 'Kumo Studio', 'Kumo portfolio site', 4250, 'draft', c.day(0), c.day(30)],
    ['INV-1049', 'Helio Health', 'Helio patient portal UX', 12000, 'sent', c.day(-2), c.day(28)],
    ['INV-1050', 'Harbor & Co.', 'Harbor & Co. menu redesign', 4200, 'paid', c.day(-44), c.day(-14)],
    ['INV-1051', 'Copperline Coffee', 'Copperline brand refresh', 9000, 'overdue', c.day(-35), c.day(-5)],
    ['INV-1052', 'Solace Health', 'Solace app onboarding', 9000, 'draft', c.day(0), c.day(30)],
  ])
  return { clients, leads, projects, invoices }
}

// ───────────────────────── BOOKING ─────────────────────────
function booking(): Blueprint {
  const collections = [
    col({
      key: 'services', label: 'Services', singular: 'Service', icon: 'Sparkles', description: 'Bookable services, durations and prices',
      titleField: 'name', publicRead: true,
      fields: [
        F.text('name', 'Service', 'r'), F.enum('category', 'Category', ['Massage', 'Facial', 'Body', 'Wellness']),
        F.num('duration', 'Duration (min)', 'r'), F.money('price', 'Price', 'r'), F.bool('active', 'Bookable'), F.long('description', 'Description', 'h'),
      ],
    }),
    col({
      key: 'staff', label: 'Staff', singular: 'Staff member', icon: 'UserCog', description: 'Team members and their specialties',
      titleField: 'name', statusField: 'status',
      fields: [
        F.text('name', 'Name', 'r'), F.text('role', 'Role'), F.email('email', 'Email'), F.phone('phone', 'Phone', 'h'),
        F.tags('specialties', 'Specialties', ['Massage', 'Facial', 'Body', 'Wellness']), F.enum('status', 'Status', ['active', 'on_leave', 'inactive']),
      ],
    }),
    col({
      key: 'appointments', label: 'Appointments', singular: 'Appointment', icon: 'CalendarDays', description: 'Bookings from the website and front desk',
      titleField: 'customer_name', statusField: 'status', dateField: 'starts_at', publicCreate: true,
      fields: [
        F.text('customer_name', 'Customer', 'rp'), F.email('email', 'Email', 'rp'), F.phone('phone', 'Phone', 'ph'),
        F.rel('service', 'Service', 'services', 'rp'), F.rel('staff', 'With', 'staff', 'p'), F.dt('starts_at', 'Starts', 'rp'),
        F.enum('status', 'Status', ['requested', 'confirmed', 'completed', 'canceled', 'no_show']), F.money('price', 'Price'),
        F.long('notes', 'Notes', 'ph'),
      ],
    }),
    col({
      key: 'customers', label: 'Customers', singular: 'Customer', icon: 'Users', description: 'Client list and visit history',
      titleField: 'name',
      fields: [
        F.text('name', 'Name', 'r'), F.email('email', 'Email'), F.phone('phone', 'Phone'), F.num('visits', 'Visits'),
        F.money('lifetime_value', 'Lifetime value'), F.date('last_visit', 'Last visit'), F.bool('marketing_opt_in', 'Marketing opt-in'),
        F.long('notes', 'Notes', 'h'),
      ],
    }),
  ]
  return {
    projectType: 'booking', appName: 'Haven Studio', collections,
    modules: buildModules(collections, { appointments: { kind: 'calendar', group: 'Operations' }, staff: { kind: 'table', group: 'Operations' } }),
    metrics: [
      met('upcoming', 'Confirmed bookings', 'appointments', 'count', null, ['status', 'confirmed'], 'number', 'CalendarCheck'),
      met('requests', 'Pending requests', 'appointments', 'count', null, ['status', 'requested'], 'number', 'Inbox'),
      met('revenue', 'Revenue', 'appointments', 'sum', 'price', ['status', 'completed'], 'money', 'DollarSign'),
      met('avg_ticket', 'Avg. booking value', 'appointments', 'avg', 'price', null, 'money', 'Receipt'),
      met('no_shows', 'No-shows', 'appointments', 'count', null, ['status', 'no_show'], 'number', 'Clock'),
      met('customers', 'Customers', 'customers', 'count', null, null, 'number', 'Users'),
    ],
    charts: [
      chart('bookings_over_time', 'Bookings', 'timeseries', 'appointments', 'count', null, null),
      chart('revenue_over_time', 'Booked revenue', 'timeseries', 'appointments', 'sum', 'price', null),
      chart('appointments_by_status', 'Appointments by status', 'breakdown', 'appointments', 'count', null, 'status'),
      chart('services_by_category', 'Services by category', 'breakdown', 'services', 'count', null, 'category'),
    ],
    workflows: [
      wf('appointment_requested', 'New booking → notify front desk', 'Alerts the team about new website bookings',
        ['appointments', 'created', null], [A.notify('{{customer_name}} booked {{service}} for {{starts_at}}')]),
      wf('appointment_confirmed', 'Booking confirmed → notify', 'Logs confirmations sent to customers',
        ['appointments', 'status_changed', 'confirmed'], [A.notify('Confirmed: {{customer_name}} · {{service}} with {{staff}}')]),
      wf('appointment_canceled', 'Cancellation → notify', 'Frees the slot and alerts the team',
        ['appointments', 'status_changed', 'canceled'], [A.notify('{{customer_name}} canceled {{service}} ({{starts_at}})')]),
      wf('appointment_no_show', 'No-show → notify', 'Flags no-shows for the cancellation policy',
        ['appointments', 'status_changed', 'no_show'], [A.notify('No-show: {{customer_name}} for {{service}}')]),
    ],
    settings: [
      setting('business_name', 'Business name', 'text', 'Haven Studio', 'General', 'Shown on confirmations'),
      currencySetting('General'),
      setting('timezone', 'Timezone', 'select', 'America/New_York', 'General', 'Used for the calendar', ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Australia/Sydney']),
      setting('opening_hours', 'Opening hours', 'text', 'Mon–Sat · 09:00–19:00', 'Booking', 'Bookable window shown on the website'),
      setting('booking_buffer', 'Buffer between bookings (min)', 'number', '15', 'Booking', 'Cleanup time after each appointment'),
      setting('min_notice_hours', 'Minimum notice (hours)', 'number', '2', 'Booking', 'How soon customers can book'),
      setting('cancellation_window', 'Free cancellation (hours)', 'number', '24', 'Booking', 'Late cancellations may be charged'),
      setting('auto_confirm', 'Auto-confirm bookings', 'boolean', 'false', 'Booking', 'Skip manual confirmation'),
    ],
  }
}
function bookingSeed(c: SeedClock): SeedData {
  const services = rows(['name', 'category', 'duration', 'price', 'active', 'description'], [
    ['Swedish Massage', 'Massage', 60, 95, true, 'Long, flowing strokes to release tension.'],
    ['Deep Tissue Massage', 'Massage', 90, 140, true, 'Targets chronic knots and tight muscles.'],
    ['Hot Stone Massage', 'Massage', 75, 125, true, 'Warm basalt stones melt away stress.'],
    ['Signature Facial', 'Facial', 60, 110, true, 'Cleanse, exfoliate, mask and massage.'],
    ['Hydrafacial', 'Facial', 45, 165, true, 'Deep hydration with instant glow.'],
    ['Express Facial', 'Facial', 30, 65, true, 'A quick refresh between meetings.'],
    ['Body Scrub & Wrap', 'Body', 75, 120, true, 'Sea-salt polish and nourishing wrap.'],
    ['Prenatal Massage', 'Massage', 60, 105, true, 'Gentle, side-lying support for mums-to-be.'],
    ['Infrared Sauna Session', 'Wellness', 30, 35, true, 'Private infrared sauna suite.'],
    ['Couples Retreat', 'Wellness', 120, 320, false, 'Side-by-side massage with champagne.'],
  ])
  const staff = rows(['name', 'role', 'email', 'phone', 'specialties', 'status'], [
    ['Maya Thompson', 'Lead Therapist', 'maya@havenstudio.com', '+1 212 555 0410', ['Massage', 'Body'], 'active'],
    ['Jonah Reed', 'Massage Therapist', 'jonah@havenstudio.com', '+1 212 555 0421', ['Massage'], 'active'],
    ['Priya Kapoor', 'Esthetician', 'priya@havenstudio.com', '+1 212 555 0432', ['Facial'], 'active'],
    ['Lena Ortiz', 'Esthetician', 'lena@havenstudio.com', '+1 212 555 0443', ['Facial', 'Body'], 'active'],
    ['Sam Whitaker', 'Massage Therapist', 'sam@havenstudio.com', '+1 212 555 0454', ['Massage', 'Wellness'], 'on_leave'],
    ['Aiko Mori', 'Wellness Coach', 'aiko@havenstudio.com', '+1 212 555 0465', ['Wellness'], 'active'],
    ['Daniel Brooks', 'Front Desk Manager', 'daniel@havenstudio.com', '+1 212 555 0476', [], 'active'],
    ['Rosa Delgado', 'Massage Therapist', 'rosa@havenstudio.com', '+1 212 555 0487', ['Massage'], 'inactive'],
  ])
  const appointments = rows(['customer_name', 'email', 'phone', 'service', 'staff', 'starts_at', 'status', 'price', 'notes'], [
    ['Emma Collins', 'emma.collins@example.com', '+1 646 555 0510', 'Swedish Massage', 'Maya Thompson', c.at(0, 10, 0), 'confirmed', 95, 'Prefers medium pressure'],
    ['Noah Patel', 'noah.patel@example.com', '+1 646 555 0521', 'Deep Tissue Massage', 'Jonah Reed', c.at(0, 13, 30), 'confirmed', 140, ''],
    ['Olivia Grant', 'olivia.grant@example.org', '+1 917 555 0532', 'Hydrafacial', 'Priya Kapoor', c.at(0, 16, 0), 'requested', 165, 'First visit'],
    ['Liam Carter', 'liam.carter@example.net', '+1 347 555 0543', 'Hot Stone Massage', 'Maya Thompson', c.at(1, 11, 0), 'confirmed', 125, ''],
    ['Sophia Nguyen', 'sophia.nguyen@example.com', '+1 718 555 0554', 'Signature Facial', 'Lena Ortiz', c.at(1, 15, 30), 'requested', 110, 'Sensitive skin'],
    ['Ethan Moore', 'ethan.moore@example.com', '+1 646 555 0565', 'Infrared Sauna Session', 'Aiko Mori', c.at(2, 9, 0), 'confirmed', 35, ''],
    ['Ava Rossi', 'ava.rossi@example.org', '+1 917 555 0576', 'Prenatal Massage', 'Maya Thompson', c.at(3, 14, 0), 'confirmed', 105, '28 weeks'],
    ['Mason Lee', 'mason.lee@example.net', '+1 347 555 0587', 'Body Scrub & Wrap', 'Lena Ortiz', c.at(4, 12, 0), 'requested', 120, ''],
    ['Isabella Kim', 'isabella.kim@example.com', '+1 718 555 0598', 'Express Facial', 'Priya Kapoor', c.at(5, 17, 30), 'confirmed', 65, ''],
    ['Lucas Wright', 'lucas.wright@example.com', '+1 646 555 0509', 'Deep Tissue Massage', 'Jonah Reed', c.at(7, 10, 30), 'requested', 140, 'Lower back focus'],
    ['Mia Hernandez', 'mia.hernandez@example.org', '+1 917 555 0518', 'Swedish Massage', 'Jonah Reed', c.at(-1, 11, 0), 'completed', 95, ''],
    ['James Turner', 'james.turner@example.net', '+1 347 555 0527', 'Signature Facial', 'Lena Ortiz', c.at(-1, 15, 0), 'completed', 110, ''],
    ['Charlotte Diaz', 'charlotte.diaz@example.com', '+1 718 555 0536', 'Hot Stone Massage', 'Maya Thompson', c.at(-2, 13, 0), 'no_show', 125, 'No answer on reminder call'],
    ['Benjamin Hall', 'benjamin.hall@example.com', '+1 646 555 0545', 'Hydrafacial', 'Priya Kapoor', c.at(-3, 10, 0), 'completed', 165, ''],
    ['Amelia Scott', 'amelia.scott@example.org', '+1 917 555 0554', 'Deep Tissue Massage', 'Jonah Reed', c.at(-4, 16, 30), 'canceled', 140, 'Rescheduling next month'],
    ['Henry Adams', 'henry.adams@example.net', '+1 347 555 0563', 'Swedish Massage', 'Maya Thompson', c.at(-6, 12, 0), 'completed', 95, ''],
  ])
  const customers = rows(['name', 'email', 'phone', 'visits', 'lifetime_value', 'last_visit', 'marketing_opt_in', 'notes'], [
    ['Emma Collins', 'emma.collins@example.com', '+1 646 555 0510', 9, 855, c.day(-21), true, 'Member since 2023'],
    ['Noah Patel', 'noah.patel@example.com', '+1 646 555 0521', 4, 560, c.day(-35), true, ''],
    ['Olivia Grant', 'olivia.grant@example.org', '+1 917 555 0532', 0, 0, null, false, 'New client'],
    ['Liam Carter', 'liam.carter@example.net', '+1 347 555 0543', 6, 750, c.day(-14), true, ''],
    ['Sophia Nguyen', 'sophia.nguyen@example.com', '+1 718 555 0554', 2, 220, c.day(-60), false, 'Sensitive skin'],
    ['Ethan Moore', 'ethan.moore@example.com', '+1 646 555 0565', 12, 420, c.day(-7), true, 'Sauna regular'],
    ['Ava Rossi', 'ava.rossi@example.org', '+1 917 555 0576', 3, 315, c.day(-28), true, ''],
    ['Mia Hernandez', 'mia.hernandez@example.org', '+1 917 555 0518', 7, 665, c.day(-1), true, ''],
    ['James Turner', 'james.turner@example.net', '+1 347 555 0527', 2, 220, c.day(-1), false, ''],
    ['Charlotte Diaz', 'charlotte.diaz@example.com', '+1 718 555 0536', 5, 625, c.day(-40), true, 'One no-show'],
    ['Benjamin Hall', 'benjamin.hall@example.com', '+1 646 555 0545', 3, 495, c.day(-3), false, ''],
    ['Henry Adams', 'henry.adams@example.net', '+1 347 555 0563', 8, 760, c.day(-6), true, 'Prefers Maya'],
  ])
  return { services, staff, appointments, customers }
}

// ───────────────────────── GENERIC ─────────────────────────
function generic(): Blueprint {
  const collections = [
    col({
      key: 'inquiries', label: 'Inquiries', singular: 'Inquiry', icon: 'Inbox', description: 'Contact form submissions and leads from the website',
      titleField: 'name', statusField: 'status', publicCreate: true,
      fields: [
        F.text('name', 'Name', 'rp'), F.email('email', 'Email', 'rp'), F.phone('phone', 'Phone', 'ph'), F.text('company', 'Company', 'p'),
        F.text('subject', 'Subject', 'p'), F.enum('source', 'Source', ['website', 'referral', 'social', 'email', 'phone'], 'p'),
        F.enum('status', 'Status', ['new', 'in_progress', 'responded', 'closed']), F.enum('priority', 'Priority', ['normal', 'low', 'high']),
        F.money('value', 'Est. value'), F.long('message', 'Message', 'ph'),
      ],
    }),
    col({
      key: 'items', label: 'Items', singular: 'Item', icon: 'Box', description: 'Products, services or listings shown on the website',
      titleField: 'name', statusField: 'status', publicRead: true,
      fields: [
        F.text('name', 'Name', 'r'), F.enum('category', 'Category', ['Standard', 'Premium', 'Custom']), F.money('price', 'Price'),
        F.enum('status', 'Status', ['active', 'draft', 'archived']), F.bool('featured', 'Featured'), F.img('image', 'Image', 'h'),
        F.long('description', 'Description', 'h'),
      ],
    }),
    col({
      key: 'tasks', label: 'Tasks', singular: 'Task', icon: 'ListTodo', description: 'Follow-ups and internal to-dos',
      titleField: 'title', statusField: 'status', dateField: 'due_date',
      fields: [
        F.text('title', 'Task', 'r'), F.enum('status', 'Status', ['todo', 'in_progress', 'review', 'done']),
        F.enum('priority', 'Priority', ['medium', 'low', 'high', 'urgent']), F.text('assignee', 'Assignee'), F.date('due_date', 'Due'),
        F.rel('inquiry', 'Inquiry', 'inquiries'), F.long('notes', 'Notes', 'h'),
      ],
    }),
  ]
  return {
    projectType: 'custom', appName: 'My Business', collections,
    modules: buildModules(collections, { inquiries: { kind: 'kanban', group: 'Sales' }, tasks: { kind: 'kanban', group: 'Operations' }, items: { kind: 'table', group: 'Catalog' } }),
    metrics: [
      met('inquiries', 'Inquiries', 'inquiries', 'count', null, null, 'number', 'Inbox'),
      met('new_inquiries', 'Awaiting reply', 'inquiries', 'count', null, ['status', 'new'], 'number', 'MailOpen'),
      met('pipeline_value', 'Pipeline value', 'inquiries', 'sum', 'value', null, 'money', 'DollarSign'),
      met('open_tasks', 'Open tasks', 'tasks', 'count', null, ['status', 'todo'], 'number', 'ListTodo'),
      met('items', 'Active items', 'items', 'count', null, ['status', 'active'], 'number', 'Box'),
    ],
    charts: [
      chart('inquiries_over_time', 'Inquiries', 'timeseries', 'inquiries', 'count', null, null),
      chart('inquiries_by_status', 'Inquiries by status', 'breakdown', 'inquiries', 'count', null, 'status'),
      chart('inquiries_by_source', 'Inquiries by source', 'breakdown', 'inquiries', 'count', null, 'source'),
      chart('tasks_by_status', 'Tasks by status', 'breakdown', 'tasks', 'count', null, 'status'),
    ],
    workflows: [
      wf('inquiry_created', 'New inquiry → notify', 'Alerts the team about every website inquiry',
        ['inquiries', 'created', null], [A.notify('New inquiry from {{name}}: {{subject}}')]),
      wf('inquiry_closed', 'Inquiry closed → notify', 'Logs when a conversation is wrapped up',
        ['inquiries', 'status_changed', 'closed'], [A.notify('Closed inquiry from {{name}}')]),
      wf('task_done', 'Task done → notify', 'Celebrates finished work',
        ['tasks', 'status_changed', 'done'], [A.notify('Done: {{title}} ({{assignee}})')]),
    ],
    settings: [
      setting('business_name', 'Business name', 'text', 'My Business', 'General', 'Shown in emails and the dashboard'),
      currencySetting('General'),
      setting('contact_email', 'Contact email', 'text', 'hello@example.com', 'General', 'Where inquiries are forwarded'),
      setting('timezone', 'Timezone', 'select', 'America/New_York', 'General', 'Used for dates and reminders', ['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Australia/Sydney']),
      setting('response_time_hours', 'Target response time (h)', 'number', '24', 'Inquiries', 'Promised on the contact page'),
      setting('auto_reply', 'Auto-reply to inquiries', 'boolean', 'true', 'Inquiries', 'Send an acknowledgement email'),
    ],
  }
}
function genericSeed(c: SeedClock): SeedData {
  const inquiries = rows(['name', 'email', 'phone', 'company', 'subject', 'source', 'status', 'priority', 'value', 'message'], [
    ['Hannah Wright', 'hannah.wright@example.com', '+1 415 555 0601', 'Wright & Co.', 'Pricing for a team of 12', 'website', 'new', 'high', 4800, 'Could you send pricing for 12 people?'],
    ['Diego Fernández', 'diego.f@example.net', '+1 305 555 0612', 'Solaris', 'Partnership opportunity', 'referral', 'in_progress', 'normal', 12000, 'We would love to explore a partnership.'],
    ['Grace Kim', 'grace.kim@example.org', '+1 206 555 0623', '', 'Availability next month?', 'social', 'responded', 'normal', 900, 'Are you available the week of the 14th?'],
    ['Tom Becker', 'tom.becker@example.com', '+1 312 555 0634', 'Becker Logistics', 'Custom quote request', 'website', 'new', 'high', 7500, 'Need a custom quote for recurring work.'],
    ['Aisha Bello', 'aisha.bello@example.com', '+1 404 555 0645', 'Bello Events', 'Question about delivery', 'email', 'closed', 'low', 0, 'How long does delivery usually take?'],
    ['Liam Murphy', 'liam.murphy@example.net', '+1 617 555 0656', '', 'Gift card', 'website', 'responded', 'low', 150, 'Do you sell gift cards?'],
    ['Yuki Tanaka', 'yuki.tanaka@example.org', '+1 646 555 0667', 'Tanaka Design', 'Bulk order', 'phone', 'in_progress', 'high', 6200, 'Bulk order for our studio.'],
    ['Carlos Mendes', 'carlos.mendes@example.com', '+1 512 555 0678', 'Mendes Group', 'Demo request', 'website', 'new', 'normal', 3000, 'Could we book a demo?'],
    ['Sara Ali', 'sara.ali@example.net', '+1 303 555 0689', '', 'Feedback', 'social', 'closed', 'low', 0, 'Loved the experience — thank you!'],
    ['Peter Novak', 'peter.novak@example.com', '+1 718 555 0690', 'Novak Studio', 'Collaboration', 'referral', 'responded', 'normal', 2500, 'Interested in collaborating on a project.'],
    ['Julia Costa', 'julia.costa@example.org', '+1 619 555 0701', 'Costa Retail', 'Wholesale pricing', 'website', 'new', 'high', 9800, 'Do you offer wholesale pricing?'],
    ['Ahmed Khan', 'ahmed.khan@example.com', '+1 832 555 0712', '', 'Booking question', 'email', 'in_progress', 'normal', 600, 'Can I change my booking date?'],
  ])
  const items = rows(['name', 'category', 'price', 'status', 'featured', 'description'], [
    ['Starter Package', 'Standard', 49, 'active', false, 'Everything you need to get going.'],
    ['Growth Package', 'Premium', 149, 'active', true, 'Our most popular option.'],
    ['Pro Package', 'Premium', 299, 'active', true, 'For teams that need more.'],
    ['Custom Engagement', 'Custom', 0, 'active', false, 'Tailored scope — priced on request.'],
    ['Consultation (60 min)', 'Standard', 120, 'active', false, 'One-hour strategy session.'],
    ['Maintenance Plan', 'Standard', 79, 'active', false, 'Monthly care and updates.'],
    ['Gift Card', 'Standard', 100, 'active', false, 'Redeemable on any package.'],
    ['Workshop Seat', 'Premium', 249, 'draft', false, 'Half-day hands-on workshop.'],
    ['Legacy Bundle', 'Standard', 99, 'archived', false, 'Retired bundle.'],
    ['Enterprise Retainer', 'Custom', 4500, 'active', true, 'Dedicated monthly capacity.'],
  ]).map(r => ({ ...r, image: pic(String(r.name).toLowerCase().replace(/[^a-z]+/g, '-')) }))
  const tasks = rows(['title', 'status', 'priority', 'assignee', 'due_date', 'inquiry', 'notes'], [
    ['Send pricing to Hannah Wright', 'todo', 'high', 'Alex', c.day(1), 'Hannah Wright', ''],
    ['Prepare partnership deck for Solaris', 'in_progress', 'high', 'Jordan', c.day(3), 'Diego Fernández', ''],
    ['Quote for Becker Logistics', 'todo', 'urgent', 'Alex', c.day(0), 'Tom Becker', ''],
    ['Schedule demo with Mendes Group', 'todo', 'medium', 'Sam', c.day(2), 'Carlos Mendes', ''],
    ['Bulk order proposal for Tanaka Design', 'review', 'high', 'Jordan', c.day(1), 'Yuki Tanaka', ''],
    ['Update website pricing page', 'in_progress', 'medium', 'Sam', c.day(5), null, ''],
    ['Reply to wholesale request', 'todo', 'high', 'Alex', c.day(1), 'Julia Costa', ''],
    ['Monthly newsletter', 'review', 'low', 'Riley', c.day(4), null, ''],
    ['Reschedule Ahmed Khan', 'in_progress', 'medium', 'Riley', c.day(0), 'Ahmed Khan', ''],
    ['Archive legacy bundle', 'done', 'low', 'Sam', c.day(-3), null, ''],
    ['Send collaboration terms to Novak Studio', 'done', 'medium', 'Jordan', c.day(-1), 'Peter Novak', ''],
    ['Thank-you note to Sara Ali', 'done', 'low', 'Riley', c.day(-5), 'Sara Ali', ''],
  ])
  return { inquiries, items, tasks }
}

// ───────────────────────── Registry ─────────────────────────
const PRESETS: Record<PresetKey, { blueprint: () => Blueprint; seed: (c: SeedClock) => SeedData }> = {
  ecommerce: { blueprint: ecommerce, seed: ecommerceSeed },
  saas: { blueprint: saas, seed: saasSeed },
  restaurant: { blueprint: restaurant, seed: restaurantSeed },
  agency: { blueprint: agency, seed: agencySeed },
  booking: { blueprint: booking, seed: bookingSeed },
  generic: { blueprint: generic, seed: genericSeed },
}

/** Raw preset blueprint (fresh object every call). `type` may be a ProjectType or a PresetKey. */
export function rawPresetBlueprint(type?: ProjectType | PresetKey | string | null): Blueprint {
  const key = (PRESET_KEYS as readonly string[]).includes(String(type)) ? (type as PresetKey) : presetKeyForType(type)
  const bp = PRESETS[key].blueprint()
  const projectType = (PROJECT_TYPES as readonly string[]).includes(String(type)) ? (type as ProjectType) : bp.projectType
  return { ...bp, projectType }
}

/** Preset seed rows (8–20 per collection) with `created_at` history, dates relative to `now`. */
export function rawPresetSeed(type?: ProjectType | PresetKey | string | null, now = Date.now()): SeedData {
  const key = (PRESET_KEYS as readonly string[]).includes(String(type)) ? (type as PresetKey) : presetKeyForType(type)
  const clock = seedClock(now)
  const seed = PRESETS[key].seed(clock)
  return Object.fromEntries(Object.entries(seed).map(([k, list]) => [k, stampCreatedAt(list, clock)]))
}
