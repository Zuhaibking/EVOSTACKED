(function () {
  if (window.__EVO_INSPECT__) return
  window.__EVO_INSPECT__ = true

  var SOURCE = 'evostack-inspect'
  var TEXT_TAGS = {
    H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1,
    P: 1, SPAN: 1, A: 1, BUTTON: 1, LABEL: 1, LI: 1,
    TD: 1, TH: 1, STRONG: 1, EM: 1, SMALL: 1, B: 1, I: 1,
    CITE: 1, CODE: 1, TIME: 1, FIGCAPTION: 1, DT: 1, DD: 1,
  }
  var enabled = false
  var guides = false
  var selected = null
  var hoverEl = null
  var editEl = null
  var box = null
  var pad = null

  function send(type, payload) {
    try {
      parent.postMessage({ source: SOURCE, type: type, payload: payload }, '*')
    } catch (e) {}
  }

  var reportedErrors = new Set()
  function errorText(value) {
    try {
      if (value && typeof value.message === 'string') return value.message
      return typeof value === 'string' ? value : JSON.stringify(value) || String(value)
    } catch (e) {
      try { return String(value) } catch (err) { return '[unserializable error]' }
    }
  }

  function reportError(value) {
    var message = errorText(value).trim().slice(0, 2000)
    if (!message || reportedErrors.has(message)) return
    reportedErrors.add(message)
    if (reportedErrors.size > 50) reportedErrors.delete(reportedErrors.values().next().value)
    send('runtime-error', { message: message })
  }

  window.addEventListener('error', function (e) {
    if (e.message || e.error) reportError(e.message || e.error)
  })
  window.addEventListener('unhandledrejection', function (e) {
    reportError(e.reason || 'Unhandled promise rejection')
  })
  var originalConsoleError = console.error
  console.error = function () {
    originalConsoleError.apply(console, arguments)
    var args = Array.prototype.slice.call(arguments)
    var message = args.map(errorText).join(' ')
    if (/hydration (?:failed|error)|error[^\n]*hydrat|during hydration|did not match|didn't match|Text content does not match|Expected server HTML|Did not expect server HTML|Extra attributes from the server|validateDOMNesting|Rendered (?:more|fewer) hooks|Invalid hook call|Unhandled Runtime|Uncaught|(?:Reference|Type|Syntax|Range)Error|The above error occurred/i.test(message) || args.some(function (arg) { return arg instanceof Error })) {
      reportError(message)
    }
  }

  // Inspector availability in <Head> does not mean the application rendered.
  // A separate acknowledgement requires visible content in its mounted root.
  var renderedContent = false
  var renderObserver = null
  var renderChecks = null
  function hasVisibleContent() {
    // ponytail: React 18 mount marker and 1500-node scan; use a template mount hook if either ceiling changes.
    var root = document.getElementById('__next') || document.getElementById('__nuxt') || document.getElementById('root') || document.getElementById('app') || document.body
    if (!root) return false
    if (root.id === '__next' && !Object.keys(root).some(function (key) { return key.indexOf('__reactContainer') === 0 })) return false
    var nodes = root.querySelectorAll('*')
    for (var index = 0; index < Math.min(nodes.length, 1500); index++) {
      var element = nodes[index]
      if (/^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE)$/.test(element.tagName) || isChrome(element)) continue
      var rect = element.getBoundingClientRect()
      if (!rect.width || !rect.height) continue
      var visible = true
      for (var parentNode = element; parentNode && parentNode !== document.documentElement; parentNode = parentNode.parentElement) {
        var style = getComputedStyle(parentNode)
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) { visible = false; break }
      }
      if (!visible) continue
      if (/^(SVG|CANVAS|VIDEO|IFRAME|INPUT|TEXTAREA|SELECT)$/.test(element.tagName) || (element.tagName === 'IMG' && element.naturalWidth > 0)) return true
      for (var child = 0; child < element.childNodes.length; child++) {
        if (element.childNodes[child].nodeType === 3 && element.childNodes[child].textContent.trim()) return true
      }
    }
    return false
  }
  function reportRendered() {
    if (!renderedContent && !hasVisibleContent()) return
    renderedContent = true
    if (renderChecks) clearInterval(renderChecks)
    if (renderObserver) renderObserver.disconnect()
    send('rendered', { hasContent: true })
  }
  function checkAfterPaint() {
    requestAnimationFrame(function () { requestAnimationFrame(reportRendered) })
  }
  renderObserver = new MutationObserver(checkAfterPaint)
  if (document.documentElement) renderObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true })
  renderChecks = setInterval(reportRendered, 250)
  document.addEventListener('DOMContentLoaded', checkAfterPaint)
  window.addEventListener('load', checkAfterPaint)

  function cssPath(el) {
    if (!el || !el.tagName) return ''
    if (el.id) return el.tagName.toLowerCase() + '#' + el.id
    var parts = []
    var node = el
    var depth = 0
    while (node && node.nodeType === 1 && depth < 8) {
      var tag = node.tagName.toLowerCase()
      if (tag === 'html') break
      var cls = ''
      if (typeof node.className === 'string' && node.className.trim()) {
        cls =
          '.' +
          node.className
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .join('.')
      }
      var nth = ''
      if (node.parentElement) {
        var kids = node.parentElement.children
        var same = 0
        var idx = 0
        for (var i = 0; i < kids.length; i++) {
          if (kids[i].tagName === node.tagName) {
            same++
            if (kids[i] === node) idx = same
          }
        }
        if (same > 1) nth = ':nth-of-type(' + idx + ')'
      }
      parts.unshift(tag + cls + nth)
      node = node.parentElement
      depth++
    }
    return parts.join(' > ')
  }

  function isChrome(el) {
    return el && (el.id === '__evo_inspect_box' || el.id === '__evo_inspect_pad' || el.id === '__evo_data_toast')
  }

  function pick(el) {
    if (!el || el === document.documentElement || el === document.body) return null
    if (isChrome(el)) return selected
    return el
  }

  function stylesOf(el) {
    var cs = getComputedStyle(el)
    return {
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      textAlign: cs.textAlign,
      textTransform: cs.textTransform,
      textDecoration: cs.textDecorationLine || cs.textDecoration,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      display: cs.display,
      width: cs.width,
      height: cs.height,
      padding: cs.padding,
      margin: cs.margin,
      borderRadius: cs.borderRadius,
      opacity: cs.opacity,
      boxShadow: cs.boxShadow,
      borderWidth: cs.borderWidth,
      borderStyle: cs.borderStyle,
      borderColor: cs.borderColor,
    }
  }

  function visibleText(el) {
    return (el.innerText || '').replace(/\s+/g, ' ').trim()
  }

  function collect(el) {
    var r = el.getBoundingClientRect()
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      className: typeof el.className === 'string' ? el.className : '',
      selector: cssPath(el),
      text: visibleText(el).slice(0, 2000),
      html: (el.outerHTML || '').slice(0, 800),
      rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      styles: stylesOf(el),
    }
  }

  function firstTextLeaf(el) {
    if (!el) return null
    if (el.childElementCount === 0) return el
    var n = el.querySelector('h1,h2,h3,h4,h5,h6,p,span,a,button,label,li,strong,em,small')
    return n || el
  }

  function editTarget(el) {
    if (!el) return null
    if (el.childElementCount === 0) return el
    if (TEXT_TAGS[el.tagName] && el.children.length <= 1) return el
    return null
  }

  function remember(el) {
    if (!el || el.__evo_saved) return
    el.__evo_saved = true
    el.__evo_origStyle = el.getAttribute('style') || ''
    el.__evo_origText = el.childElementCount === 0 ? el.textContent : visibleText(el)
  }

  function commit(el) {
    if (!el || !el.__evo_saved) return
    el.__evo_origStyle = el.getAttribute('style') || ''
    if (el.childElementCount === 0) el.__evo_origText = el.textContent
    var leaf = firstTextLeaf(el)
    if (leaf && leaf !== el && leaf.__evo_saved) {
      leaf.__evo_origStyle = leaf.getAttribute('style') || ''
      if (leaf.childElementCount === 0) leaf.__evo_origText = leaf.textContent
    }
  }

  function restore(el) {
    if (!el || !el.__evo_saved) return
    if (el.__evo_origStyle) el.setAttribute('style', el.__evo_origStyle)
    else el.removeAttribute('style')
    if (el.childElementCount === 0 && typeof el.__evo_origText === 'string') {
      el.textContent = el.__evo_origText
    }
  }

  function setText(el, text) {
    if (!el) return
    remember(el)
    if (el.childElementCount === 0) {
      el.textContent = text
      return
    }
    var leaf = firstTextLeaf(el)
    if (leaf && leaf !== el && leaf.childElementCount === 0) {
      remember(leaf)
      leaf.textContent = text
      return
    }
  }

  function applyStyles(el, styles) {
    if (!el || !styles) return
    remember(el)
    var keys = Object.keys(styles)
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i]
      if (styles[k] != null && styles[k] !== '') el.style[k] = styles[k]
    }
  }

  function onEditInput() {
    if (!editEl) return
    send('text', visibleText(editEl))
    paint()
    if (selected) send('rect', selected.getBoundingClientRect())
  }

  function disableEdit() {
    if (!editEl) return
    editEl.removeEventListener('input', onEditInput)
    editEl.contentEditable = 'false'
    editEl = null
  }

  function enableEdit(el) {
    disableEdit()
    var target = editTarget(el)
    if (!target) return
    remember(target)
    editEl = target
    target.contentEditable = 'true'
    target.spellcheck = false
    target.style.outline = 'none'
    target.style.cursor = 'text'
    target.addEventListener('input', onEditInput)
    setTimeout(function () {
      try {
        target.focus()
      } catch (e) {}
    }, 0)
  }

  function ensureChrome() {
    if (!box) {
      box = document.createElement('div')
      box.id = '__evo_inspect_box'
      box.style.cssText =
        'position:fixed;pointer-events:none;z-index:2147483646;border:1.5px solid #3b6cff;box-shadow:0 0 0 1px rgba(59,108,255,0.25);display:none;'
      document.documentElement.appendChild(box)
    }
    if (!pad) {
      pad = document.createElement('div')
      pad.id = '__evo_inspect_pad'
      pad.style.cssText =
        'position:fixed;pointer-events:none;z-index:2147483645;display:none;background:rgba(59,108,255,0.12);box-shadow:inset 0 0 0 1px rgba(59,108,255,0.35);'
      document.documentElement.appendChild(pad)
    }
  }

  function place(el, node) {
    var r = el.getBoundingClientRect()
    node.style.display = 'block'
    node.style.top = r.top + 'px'
    node.style.left = r.left + 'px'
    node.style.width = Math.max(0, r.width) + 'px'
    node.style.height = Math.max(0, r.height) + 'px'
  }

  function paint() {
    ensureChrome()
    var el = selected || hoverEl
    if (!enabled || !el || !el.getBoundingClientRect) {
      box.style.display = 'none'
      pad.style.display = 'none'
      return
    }
    place(el, box)
    box.style.borderColor = selected === el ? '#3b6cff' : 'rgba(59,108,255,0.45)'
    if (guides && selected) {
      var cs = getComputedStyle(selected)
      var pt = parseFloat(cs.paddingTop) || 0
      var pr = parseFloat(cs.paddingRight) || 0
      var pb = parseFloat(cs.paddingBottom) || 0
      var pl = parseFloat(cs.paddingLeft) || 0
      var r = selected.getBoundingClientRect()
      pad.style.display = 'block'
      pad.style.top = r.top + 'px'
      pad.style.left = r.left + 'px'
      pad.style.width = r.width + 'px'
      pad.style.height = r.height + 'px'
      pad.style.boxShadow =
        'inset ' +
        pl +
        'px ' +
        pt +
        'px 0 0 rgba(59,108,255,0.18), inset -' +
        pr +
        'px -' +
        pb +
        'px 0 0 rgba(59,108,255,0.18)'
    } else {
      pad.style.display = 'none'
    }
  }

  function onMove(e) {
    if (!enabled) return
    hoverEl = pick(e.target)
    paint()
  }

  function onClick(e) {
    if (!enabled) return
    var el = pick(e.target)
    if (!el) return
    if (
      selected &&
      editEl &&
      (el === selected || selected.contains(el)) &&
      editEl.contains(e.target)
    ) {
      e.stopPropagation()
      return
    }
    e.preventDefault()
    e.stopPropagation()
    if (selected && selected !== el) commit(selected)
    selected = el
    hoverEl = el
    enableEdit(el)
    paint()
    send('select', collect(el))
  }

  function onKey(e) {
    if (!enabled) return
    if (e.key === 'Escape') {
      disableEdit()
      selected = null
      paint()
      send('select', null)
    }
  }

  function onScroll() {
    paint()
    if (selected) send('rect', selected.getBoundingClientRect())
  }

  function matches(el, selector) {
    if (!selector || !el) return !selector
    if (cssPath(el) === selector) return true
    return !!(el.id && selector === el.tagName.toLowerCase() + '#' + el.id)
  }

  function applyLive(d) {
    if (!selected) return
    if (d.selector && !matches(selected, d.selector)) return
    if (d.reset) {
      restore(selected)
      var leaf = firstTextLeaf(selected)
      if (leaf && leaf !== selected) restore(leaf)
      selected.style.visibility = ''
      paint()
      return
    }
    if (typeof d.text === 'string') {
      if (!editEl || document.activeElement !== editEl) setText(selected, d.text)
    }
    applyStyles(selected, d.styles)
    if (d.hidden) selected.style.visibility = 'hidden'
    else if (d.hidden === false) selected.style.visibility = ''
    paint()
    send('rect', selected.getBoundingClientRect())
  }

  window.addEventListener('message', function (e) {
    var d = e.data
    if (!d || d.source !== SOURCE) return
    if (d.type === 'preview-status') {
      send('ready')
      checkAfterPaint()
    }
    if (d.type === 'enable') {
      enabled = true
      document.documentElement.style.cursor = 'crosshair'
      paint()
    }
    if (d.type === 'disable') {
      enabled = false
      disableEdit()
      selected = null
      hoverEl = null
      document.documentElement.style.cursor = ''
      paint()
    }
    if (d.type === 'guides') {
      guides = !!d.on
      paint()
    }
    if (d.type === 'clear') {
      disableEdit()
      selected = null
      paint()
    }
    if (d.type === 'live') applyLive(d)
    if (d.type === 'focus-edit' && editEl) {
      try {
        editEl.focus()
      } catch (err) {}
    }
  })

  document.addEventListener('mousemove', onMove, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onScroll)

  send('ready')
})()

/* ═════════════════════════════════════════════════════════════════════════════
 * EvoStack DATA BRIDGE: website actions → the project's Control Center.
 * Independent of the inspector above (own guard, own listeners). No wiring needed.
 *  config   GET /__evo_platform.json (written by POST /api/p/{id}/connect) or the
 *           parent's {source:'evostack-inspect', type:'platform-config', config}.
 *  capture  every <form> submit (capture phase), plus formless "Book / Send /
 *           Subscribe" buttons next to inputs. preventDefault only when the form
 *           would navigate away (no action / '#'). Opt out: data-evo-ignore.
 *  target   [data-evo-collection] › keyword + field-overlap score › first
 *           publicCreate collection. Inputs fuzzy-map onto publicWritable fields
 *           ([data-evo-field] pins one); leftovers go to a longtext notes field.
 *  send     embedded → parent {source:'evostack-data', type:'submit', id, collection, data},
 *           ack {source:'evostack-inspect', type:'data-ack', id, ok} within 2 s;
 *           otherwise / no ack → POST {apiBase}/api/p/{projectId}/records/{collection}
 *           with x-evo-source: website. A small toast reports the result.
 *  sdk      window.evo = {config, ready(), collections(), list(collection, params),
 *           submit(collection, data, {toast}), capture(el), autoCapture}
 * ═════════════════════════════════════════════════════════════════════════════ */
;(function () {
  if (typeof window === 'undefined' || window.__EVO_DATA__) return
  window.__EVO_DATA__ = true

  var DATA_SOURCE = 'evostack-data'
  var HOST_SOURCE = 'evostack-inspect'
  var CONFIG_PATH = '/__evo_platform.json'
  var ACK_MS = 2000
  var MATCH_MIN = 55
  var PROJECT_RE = /^[A-Za-z0-9_-]{1,128}$/
  var IDENT_RE = /^[a-z][a-z0-9_]{0,39}$/
  var CONTROL_TAGS = { INPUT: 1, SELECT: 1, TEXTAREA: 1 }
  var SKIP_TYPES = { submit: 1, button: 1, reset: 1, image: 1, file: 1, password: 1 }
  // Never forwarded: credentials, payment data, identity numbers, anti-forgery tokens.
  var SENSITIVE = /pass(word|wd|code)?\b|\bpwd\b|\bpin\b|\bcvc\b|\bcvv\b|\bcsc\b|security code|\bcard (number|num|no)\b|\bcc (number|num|no|csc|exp)\b|cardnumber|expir|\bssn\b|social security|\biban\b|routing|account (number|num|no)\b|secret|token|\botp\b|csrf|captcha|nonce/
  var HONEYPOT = /^(_hp|_gotcha|_honeypot|honeypot|hp_?field|bot_?field)$/i
  var TEXTLIKE = { text: 1, email: 1, tel: 1, textarea: 1, date: 1, 'datetime-local': 1, number: 1, url: 1, hidden: 0 }
  var ACTION_TEXT = /\b(book|reserve|reservation|submit|send|subscribe|sign me up|sign up|signup|join|notify me|get notified|request|enquire|inquire|contact|apply|register|rsvp|place order|order now|checkout|check out|confirm|get quote|donate|enrol|enroll|schedule|get started|claim|get access|count me|let s talk|lets talk)\b/
  var NOT_ACTION = /\b(add to (cart|bag|basket)|search|filter|next|back|previous|prev|cancel|close|menu|log ?in|sign ?in|more|learn|view|see|read|show|open|toggle|play|pause|share|like|copy|clear|reset|remove|delete|edit)\b/

  var config = null
  var configFrom = ''
  var fileOrigin = ''
  var parentOrigin = ''
  var loading = null
  var waiters = []
  var pending = {}
  var seq = 0
  var sdkCalls = 0
  var recent = { sig: '', at: 0, promise: null }

  function str(v) { return v == null ? '' : String(v) }
  function now() { return Date.now() }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k) }
  function later(fn, ms) { return typeof setTimeout === 'function' ? setTimeout(fn, ms) : 0 }
  function cancel(t) { if (t && typeof clearTimeout === 'function') clearTimeout(t) }
  function isEmbedded() { try { return !!window.parent && window.parent !== window } catch (e) { return true } }
  function originOf(url) { try { return new URL(url).origin } catch (e) { return '' } }
  function attr(el, name) { try { return el && el.getAttribute ? str(el.getAttribute(name)) : '' } catch (e) { return '' } }
  function closest(el, selector) { try { return el && el.closest ? el.closest(selector) : null } catch (e) { return null } }
  function safeJson(v) { try { return JSON.stringify(v) } catch (e) { return '' } }

  // ── text normalisation ────────────────────────────────────────────────────
  var STOP = /\b(your|the|a|an|enter|please|optional|required|here|of|for|you|my|our|us|we|in|on|at|and|or|with|is|this|to|be|will|if|any|eg)\b/g
  function words(raw) {
    return str(raw)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/e-mail/g, 'email')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(STOP, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
  // Plural count words stay plural: "Guests" (a number) must not collapse into "Guest" (a person).
  var NO_STEM = { guests: 1, people: 1, persons: 1, seats: 1, covers: 1, diners: 1, attendees: 1, tickets: 1, adults: 1, kids: 1, children: 1 }
  function stem(t) {
    if (NO_STEM[t]) return t
    if (t.length > 4 && t.slice(-3) === 'ies') return t.slice(0, -3) + 'y'
    if (t.length > 3 && t.charAt(t.length - 1) === 's' && !/(ss|us|is)$/.test(t)) return t.slice(0, -1)
    return t
  }
  var NORM = {}
  function norm(raw) {
    var key = str(raw)
    if (own(NORM, key)) return NORM[key]
    var w = words(key)
    return (NORM[key] = w ? w.split(' ').map(stem).join(' ') : '')
  }
  function cleanKey(raw) { return str(raw).replace(/\s+/g, ' ').replace(/\s*[*:]+\s*$/, '').trim().slice(0, 60) }
  function identOf(raw) {
    var s = str(raw).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40)
    return IDENT_RE.test(s) ? s : ''
  }

  // Synonym groups: [canonical, 'phrase|phrase|…'] (normalised with norm()).
  var GROUPS = [
    ['name', 'name|full name|fullname|customer name|guest name|client name|contact name|attendee name|person name|buyer name|your name'],
    ['first', 'first name|firstname|given name|fname|forename'],
    ['last', 'last name|lastname|surname|family name|lname'],
    ['email', 'email|email address|mail|emailaddress|work email|business email'],
    ['phone', 'phone|phone number|tel|telephone|mobile|mobile number|cell|cell phone|whatsapp|contact number|phonenumber'],
    ['date', 'date|day|preferred date|reservation date|booking date|appointment date|event date|visit date|arrival date|check in|checkin|start date|when'],
    ['time', 'time|hour|slot|time slot|timeslot|preferred time|arrival time|reservation time|booking time|appointment time|start time'],
    ['datetime', 'datetime|date time|date and time|scheduled|scheduled at|start|starts at|start at|when'],
    ['party', 'party size|partysize|guests|guest count|number guests|no guests|people|number people|persons|party|covers|seats|pax|headcount|group size|diners|how many|attendees|number attendees|tickets|ticket count'],
    ['message', 'message|notes|note|comments|comment|details|special requests|requests|request|inquiry|enquiry|question|questions|description|project details|tell about|additional info|additional information|info|body|feedback|requirements|brief|how can help|what can help|anything else'],
    ['company', 'company|company name|business|business name|organization|organisation|organization name|org|brand|employer|agency|studio'],
    ['quantity', 'quantity|qty|count|units|item count|number items|how many items'],
    ['address', 'address|street|street address|shipping address|delivery address|billing address|address line|address line 1|location'],
    ['city', 'city|town'],
    ['zip', 'zip|zip code|zipcode|postcode|postal code'],
    ['country', 'country'],
    ['total', 'total|amount|price|order total|subtotal|cost|grand total'],
    ['budget', 'budget|budget range|estimated budget|price range|investment'],
    ['service', 'service|services|service type|treatment|package|plan|tier|service needed|interested in|interest'],
    ['product', 'product|item|items|product name|item name|sku|dish|menu item'],
    ['website', 'website|url|site|web|link|portfolio|website url|company website'],
    ['subject', 'subject|topic|reason|regarding|inquiry type|enquiry type'],
    ['source', 'source|channel|referral|how did hear|hear about|heard about'],
  ]
  var GROUP_LIST = []
  for (var gi = 0; gi < GROUPS.length; gi++) {
    var gparts = GROUPS[gi][1].split('|')
    var glist = []
    for (var gj = 0; gj < gparts.length; gj++) if (norm(gparts[gj])) glist.push(norm(gparts[gj]))
    GROUP_LIST.push([GROUPS[gi][0], glist])
  }
  var GCACHE = {}
  function groupsOf(p) {
    if (!p) return {}
    if (own(GCACHE, p)) return GCACHE[p]
    var out = {}
    var padded = ' ' + p + ' '
    for (var i = 0; i < GROUP_LIST.length; i++) {
      var g = GROUP_LIST[i][0]
      var list = GROUP_LIST[i][1]
      for (var j = 0; j < list.length; j++) {
        if (list[j] === p) { out[g] = 2; break }
        if (padded.indexOf(' ' + list[j] + ' ') >= 0) out[g] = 1
      }
    }
    return (GCACHE[p] = out)
  }
  function groupsOfAll(list) {
    var out = {}
    for (var i = 0; i < list.length; i++) {
      var g = groupsOf(list[i])
      for (var k in g) if (own(g, k) && (!out[k] || g[k] > out[k])) out[k] = g[k]
    }
    return out
  }

  // ── value coercion ────────────────────────────────────────────────────────
  function flat(v) {
    if (Array.isArray(v)) return v.map(str).filter(Boolean).join(', ').slice(0, 4000)
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    return str(v).slice(0, 4000)
  }
  function looksEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(v).trim()) }
  function looksPhone(v) { return /^[+()\d][\d\s().-]{5,}$/.test(str(v).trim()) }
  function asNumber(v) {
    var m = str(Array.isArray(v) ? v[0] : v).replace(/[,\s_]/g, '').match(/-?\d+(\.\d+)?/)
    return m ? Number(m[0]) : NaN
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n }
  function asDate(v) {
    var s = str(v).trim()
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
    if (m) return m[0]
    if (!s || !/\d/.test(s)) return ''
    var d = new Date(s)
    return isNaN(d.getTime()) ? '' : d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
  }
  function asDateTime(v) {
    var s = str(v).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
    if (!s || !/\d/.test(s)) return ''
    var d = new Date(s)
    return isNaN(d.getTime()) ? '' : d.toISOString()
  }
  function to24h(v) {
    var m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i.exec(str(v).trim())
    if (!m) return ''
    var h = Number(m[1])
    if (m[3] && /p/i.test(m[3]) && h < 12) h += 12
    if (m[3] && /a/i.test(m[3]) && h === 12) h = 0
    return h > 23 ? '' : pad2(h) + ':' + (m[2] || '00')
  }
  function asBool(v) {
    if (typeof v === 'boolean') return v
    var s = str(v).trim().toLowerCase()
    if (/^(true|yes|on|1|y|checked|agree|agreed|accept|accepted)$/.test(s)) return true
    if (/^(false|no|off|0|n)$/.test(s)) return false
    return null
  }
  function asEnum(field, v) {
    var raw = str(Array.isArray(v) ? v[0] : v).trim()
    if (!raw) return ''
    var opts = field.options
    var n = norm(raw)
    var hit = ''
    for (var i = 0; i < opts.length; i++) if (opts[i].toLowerCase() === raw.toLowerCase() || norm(opts[i]) === n) return opts[i]
    for (var j = 0; j < opts.length; j++) {
      var o = norm(opts[j])
      if (n && o && ((' ' + n + ' ').indexOf(' ' + o + ' ') >= 0 || (' ' + o + ' ').indexOf(' ' + n + ' ') >= 0) && opts[j].length > hit.length) hit = opts[j]
    }
    return hit
  }
  function coerce(field, ctl) {
    var v = ctl.value
    var t = field.type
    if (t === 'boolean') {
      if (ctl.type === 'checkbox' && !Array.isArray(v)) return !!ctl.checked
      var b = asBool(v)
      return b === null ? undefined : b
    }
    if (t === 'number' || t === 'money') { var n = asNumber(v); return isNaN(n) ? undefined : n }
    if (t === 'date') return asDate(v) || undefined
    if (t === 'datetime') return asDateTime(v) || undefined
    if (t === 'enum') return field.options.length ? asEnum(field, v) || undefined : flat(v) || undefined
    if (t === 'tags') {
      var list = Array.isArray(v) ? v.map(str) : flat(v).split(/\s*[,;]\s*/)
      list = list.filter(Boolean).slice(0, 50)
      return list.length ? list : undefined
    }
    if (t === 'relation') return undefined
    if (t === 'email') return looksEmail(v) ? str(v).trim() : undefined
    if (t === 'url' || t === 'image') {
      var u = flat(v).trim()
      return !u ? undefined : /^[a-z][a-z0-9+.-]*:/i.test(u) || u.indexOf('.') < 0 ? u : 'https://' + u
    }
    return flat(v).slice(0, t === 'longtext' ? 10000 : t === 'phone' ? 40 : 500) || undefined
  }

  // ── field matching ───────────────────────────────────────────────────────
  var TYPE_HINT = { email: 'email', tel: 'phone', url: 'website', date: 'date', 'datetime-local': 'datetime', time: 'time', textarea: 'message' }
  var TYPE_LABEL = { email: 'Email', tel: 'Phone', url: 'Website', date: 'Date', 'datetime-local': 'Date & time', time: 'Time', number: 'Number', textarea: 'Message', select: 'Choice', radio: 'Choice', checkbox: 'Option' }
  var GENERIC = { name: 1, number: 1, no: 1, date: 1, time: 1, type: 1, info: 1, detail: 1, field: 1, text: 1, value: 1, id: 1, count: 1, total: 1 }
  function pairScore(h, f) {
    if (!h || !f) return 0
    if (h === f) return 100
    if (h.replace(/ /g, '') === f.replace(/ /g, '')) return 95
    var ht = h.split(' ')
    var ft = f.split(' ')
    var inter = 0
    var specific = 0
    var extra = 0
    for (var i = 0; i < ft.length; i++) if (ht.indexOf(ft[i]) >= 0) { inter++; if (!GENERIC[ft[i]]) specific++ }
    for (var k = 0; k < ht.length; k++) if (ft.indexOf(ht[k]) < 0 && !GENERIC[ht[k]]) extra++
    var s = 0
    if (inter) {
      if (!specific && extra) s = 45
      else if (inter === ft.length) s = 80 + Math.round(10 * inter / ht.length)
      else if (inter === ht.length) s = 72 + Math.round(10 * inter / ft.length)
      else s = 40 + Math.round(30 * inter / (ht.length + ft.length - inter))
    }
    var gh = groupsOf(h)
    var gf = groupsOf(f)
    for (var g in gh) {
      if (own(gh, g) && gf[g]) s = Math.max(s, gh[g] === 2 && gf[g] === 2 ? 76 : gh[g] + gf[g] >= 3 ? 66 : 58)
    }
    return s
  }
  function fieldNames(field) {
    if (!field.__names) {
      var a = norm(field.key.replace(/_/g, ' '))
      var b = norm(field.label)
      field.__names = b && b !== a ? [a, b] : [a]
      field.__groups = groupsOfAll(field.__names)
    }
    return field.__names
  }
  function fieldGroups(field) { fieldNames(field); return field.__groups }
  function typeFit(ctl, field) {
    var ct = ctl.type
    var ft = field.type
    var v = ctl.value
    var fit = 0
    if (ct === 'email') fit = ft === 'email' ? 30 : ft === 'text' || ft === 'longtext' ? -10 : -50
    else if (ct === 'tel') fit = ft === 'phone' ? 30 : ft === 'text' ? -5 : -50
    else if (ct === 'date') fit = ft === 'date' ? 20 : ft === 'datetime' ? 10 : ft === 'text' ? -5 : -50
    else if (ct === 'datetime-local') fit = ft === 'datetime' ? 20 : ft === 'date' ? 8 : ft === 'text' ? -5 : -50
    else if (ct === 'time') fit = ft === 'text' ? 0 : -50
    else if (ct === 'number' || ct === 'range') fit = ft === 'number' || ft === 'money' ? 12 : ft === 'text' || ft === 'enum' ? -5 : -40
    else if (ct === 'textarea') fit = ft === 'longtext' ? 12 : ft === 'text' ? 0 : -30
    else if (ct === 'checkbox') fit = ft === 'boolean' ? 18 : ft === 'tags' ? 8 : 0
    else if (ct === 'url') fit = ft === 'url' ? 25 : 0
    if (ft === 'email' && ct !== 'email') fit += looksEmail(v) ? 15 : -35
    if (ft === 'phone' && ct !== 'tel') fit += looksPhone(v) ? 8 : -20
    if ((ft === 'number' || ft === 'money') && ct !== 'number' && ct !== 'range' && isNaN(asNumber(v))) fit -= 45
    if (ft === 'date' && ct !== 'date' && ct !== 'datetime-local' && !asDate(v)) fit -= 45
    if (ft === 'datetime' && ct !== 'date' && ct !== 'datetime-local' && !asDateTime(v)) fit -= 45
    if (ft === 'boolean' && ct !== 'checkbox' && asBool(v) === null) fit -= 45
    if (ft === 'enum' && field.options.length) fit += asEnum(field, v) ? 10 : -25
    if (ft === 'relation') fit -= 60
    if (ft === 'text' && /^\d+([.,]\d+)?$/.test(str(v).trim())) {
      var named = fieldGroups(field)
      if (named.name || named.first || named.last || named.company || named.city || named.country) fit -= 40 // names are never bare numbers
    }
    return fit
  }
  function score(ctl, field) {
    if (ctl.explicitField && ctl.explicitField === field.key) return 200
    var names = fieldNames(field)
    var best = 0
    for (var i = 0; i < ctl.hints.length; i++) {
      for (var j = 0; j < names.length; j++) {
        var s = pairScore(ctl.hints[i], names[j])
        if (s > best) best = s
      }
    }
    // Unlabelled <input type="email"> / bare <textarea>: the control type is a weaker hint.
    var th = TYPE_HINT[ctl.type]
    if (th) for (var k = 0; k < names.length; k++) best = Math.max(best, pairScore(th, names[k]) - 15)
    return best > 0 ? best + typeFit(ctl, field) : 0
  }
  function hasValue(ctl) {
    var v = ctl.value
    if (v == null || v === '' || v === false) return ctl.keepFalse && v === false
    if (Array.isArray(v)) return v.length > 0
    return true
  }
  function writableFields(coll) {
    var all = coll.fields || []
    var out = all.filter(function (f) { return f.publicWritable })
    return out.length ? out : all
  }
  function findField(fields, pred) { for (var i = 0; i < fields.length; i++) if (pred(fields[i])) return fields[i]; return null }
  function findControl(controls, pred) { for (var i = 0; i < controls.length; i++) if (pred(controls[i])) return controls[i]; return null }
  function synthetic(key, hints, type, value) {
    var names = []
    for (var i = 0; i < hints.length; i++) names.push(norm(hints[i]))
    return { key: key, hints: names, groups: groupsOfAll(names), type: type, value: value, checked: false, explicitField: '' }
  }
  // First + last name → name; date + time → datetime, when the collection wants the combined field.
  function withCombos(fields, controls) {
    var out = controls.slice()
    var first = findControl(out, function (c) { return c.groups.first && c.type !== 'email' })
    var last = findControl(out, function (c) { return c.groups.last && c.type !== 'email' })
    if (first && last && first !== last &&
        !findField(fields, function (f) { var g = fieldGroups(f); return g.first || g.last }) &&
        findField(fields, function (f) { return fieldGroups(f).name === 2 })) {
      out.splice(out.indexOf(first), 1)
      out.splice(out.indexOf(last), 1)
      out.unshift(synthetic('Name', ['name'], 'text', (flat(first.value) + ' ' + flat(last.value)).trim()))
    }
    var date = findControl(out, function (c) { return c.type === 'date' || (c.groups.date && c.type !== 'datetime-local' && !!asDate(c.value) && !/:/.test(str(c.value))) })
    var time = findControl(out, function (c) { return c.type === 'time' || (c.groups.time && !!to24h(c.value)) })
    if (date && time && date !== time &&
        findField(fields, function (f) { return f.type === 'datetime' }) &&
        !findField(fields, function (f) { return f.type === 'date' || (f.type !== 'datetime' && fieldGroups(f).time) })) {
      var hm = to24h(time.value)
      var day = asDate(date.value)
      if (hm && day) {
        out.splice(out.indexOf(date), 1)
        out.splice(out.indexOf(time), 1)
        out.push(synthetic('Date & time', ['datetime', 'date time', 'when', 'start', 'scheduled'], 'datetime-local', day + 'T' + hm))
      }
    }
    return out
  }
  function notesField(fields) {
    var best = null
    var rank = 0
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i]
      var msg = !!fieldGroups(f).message
      var r = f.type === 'longtext' ? (msg ? 3 : 2) : f.type === 'text' && msg ? 1 : 0
      if (r > rank) { best = f; rank = r }
    }
    return best
  }
  /** Map captured controls onto a collection → {data, mapped, strong, missing}. */
  function mapControls(coll, rawControls) {
    var fields = writableFields(coll)
    var controls = withCombos(fields, rawControls.filter(hasValue))
    var pairs = []
    for (var i = 0; i < controls.length; i++) {
      for (var j = 0; j < fields.length; j++) {
        var s = score(controls[i], fields[j])
        if (s >= MATCH_MIN) pairs.push([s, i, j])
      }
    }
    pairs.sort(function (a, b) { return b[0] - a[0] || a[1] - b[1] || a[2] - b[2] })
    var usedC = {}
    var usedF = {}
    var data = {}
    var mapped = 0
    var strong = 0
    for (var p = 0; p < pairs.length; p++) {
      var ci = pairs[p][1]
      var fj = pairs[p][2]
      if (usedC[ci] || usedF[fj]) continue
      var value = coerce(fields[fj], controls[ci])
      if (value === undefined) continue
      data[fields[fj].key] = value
      usedC[ci] = usedF[fj] = 1
      mapped++
      if (pairs[p][0] >= 90) strong++
    }
    for (var s2 = 0; s2 < fields.length; s2++) {
      var src = fields[s2]
      if (data[src.key] === undefined && src.type === 'enum' && fieldGroups(src).source) {
        var web = asEnum(src, 'website') || asEnum(src, 'web') || asEnum(src, 'online')
        if (web) data[src.key] = web
      }
    }
    var lines = []
    for (var l = 0; l < controls.length; l++) {
      if (usedC[l]) continue
      var text = flat(controls[l].value)
      if (text && text !== 'No') lines.push(controls[l].key + ': ' + text)
    }
    var notes = lines.length ? notesField(fields) : null
    if (notes) {
      var prior = typeof data[notes.key] === 'string' ? data[notes.key] : ''
      data[notes.key] = ((prior ? prior + '\n\n' : '') + lines.join('\n')).slice(0, 8000)
    }
    var missing = 0
    for (var r = 0; r < fields.length; r++) if (fields[r].required && fields[r].type !== 'boolean' && data[fields[r].key] === undefined) missing++
    return { data: data, mapped: mapped, strong: strong, missing: missing }
  }

  // ── collection choice ────────────────────────────────────────────────────
  // [cue in the form's words, primary collection pattern, secondary collection pattern]
  var INTENTS = [
    [/\b(reserv|book|appointment|table|guest|party size|seat|slot|visit|schedul|check in|tour)/g, /reserv|appoint|booking/, /session|visit|schedul|event|class|tour|rsvp/],
    [/\b(contact|message|inquir|enquir|question|quote|get in touch|talk|consult|project)/g, /lead|inquir|enquir|contact|message/, /request|ticket|quote|prospect|consult|client/],
    [/\b(cart|checkout|order|quantit|qty|buy|purchase|shipping|deliver|payment)/g, /order|purchase/, /sale|cart|invoice/],
    [/\b(subscri|newsletter|waitlist|wait list|notify|early access|join|updates|launch|sign up|signup)/g, /signup|sign_up|subscri|newsletter|waitlist|wait_list/, /lead|member|contact|user|customer/],
    [/\b(apply|application|resume|cv|position|job|career|hiring)/g, /application|applicant|candidate/, /lead|contact/],
    [/\b(donat|pledge|contribut|sponsor)/g, /donation|pledge|contribution/, /sponsor|supporter/],
    [/\b(review|rating|testimonial|feedback)/g, /review|feedback|testimonial|rating/, /message|contact/],
    [/\b(register|registration|ticket|attend|enrol|rsvp)/g, /registration|attendee|rsvp|enrol/, /ticket|student|participant|booking/],
  ]
  function findCollection(cfg, name) {
    var raw = str(name).trim()
    if (!raw || !cfg) return null
    var cols = cfg.collections
    for (var i = 0; i < cols.length; i++) if (cols[i].key === raw) return cols[i]
    var n = norm(raw.replace(/_/g, ' '))
    for (var j = 0; j < cols.length; j++) {
      var c = cols[j]
      if (n && (norm(c.key.replace(/_/g, ' ')) === n || norm(c.label) === n || norm(c.singular) === n)) return c
    }
    return null
  }
  function chooseCollection(cfg, snap) {
    if (snap.explicit) {
      var hit = findCollection(cfg, snap.explicit)
      if (hit) return hit
      return IDENT_RE.test(snap.explicit) ? { key: snap.explicit, label: snap.explicit, singular: snap.explicit, publicCreate: true, publicRead: false, fields: [] } : null
    }
    var corpus = snap.corpus || ''
    var best = null
    var bestScore = -Infinity
    for (var i = 0; i < cfg.collections.length; i++) {
      var c = cfg.collections[i]
      if (!c.publicCreate) continue
      var text = (c.key + ' ' + c.label + ' ' + c.singular).toLowerCase()
      var s = 0
      for (var k = 0; k < INTENTS.length; k++) {
        var hits = Math.min(4, (corpus.match(INTENTS[k][0]) || []).length)
        if (hits) s += INTENTS[k][1].test(text) ? hits * 10 : INTENTS[k][2].test(text) ? hits * 4 : 0
      }
      var stemWord = (words(c.singular || c.label).split(' ')[0] || '').slice(0, 6)
      if (stemWord.length >= 4 && corpus.indexOf(stemWord) >= 0) s += 8
      var m = mapControls(c, snap.controls || [])
      s += m.mapped * 4 + m.strong * 2 - m.missing * 3
      if (s > bestScore) { best = c; bestScore = s }
    }
    return best
  }

  // ── DOM capture ──────────────────────────────────────────────────────────
  function textOf(node) {
    var out = []
    function walk(n, depth) {
      var kids = n && n.childNodes
      if (!kids || depth > 8) return
      for (var i = 0; i < kids.length && out.length < 80; i++) {
        var k = kids[i]
        if (k.nodeType === 3) out.push(k.nodeValue)
        else if (k.nodeType === 1 && !/^(INPUT|SELECT|TEXTAREA|OPTION|SCRIPT|STYLE|SVG|TEMPLATE|NOSCRIPT)$/i.test(k.tagName)) walk(k, depth + 1)
      }
    }
    try { walk(node, 0) } catch (e) {}
    return out.join(' ').replace(/\s+/g, ' ').trim().replace(/\s*[*:]+\s*$/, '').trim().slice(0, 600)
  }
  function labelledBy(el) {
    var ids = attr(el, 'aria-labelledby').split(/\s+/)
    var doc = el.ownerDocument || document
    var out = []
    for (var i = 0; i < ids.length; i++) {
      var n = ids[i] && doc.getElementById ? doc.getElementById(ids[i]) : null
      if (n) out.push(textOf(n))
    }
    return out.join(' ').trim()
  }
  function labelOf(el) {
    try {
      var t = ''
      if (el.labels && el.labels.length && (t = textOf(el.labels[0]))) return t
      var doc = el.ownerDocument || document
      if (el.id && doc.querySelector) {
        var forLabel = doc.querySelector('label[for="' + str(el.id).replace(/["\\]/g, '\\$&') + '"]')
        if (forLabel && (t = textOf(forLabel))) return t
      }
      var wrap = closest(el, 'label')
      if (wrap && (t = textOf(wrap))) return t
      if (attr(el, 'aria-labelledby') && (t = labelledBy(el))) return t
      var prev = el.previousElementSibling
      for (var hop = 0; prev && hop < 2; hop++, prev = prev.previousElementSibling) {
        if (CONTROL_TAGS[prev.tagName]) break
        t = textOf(prev)
        if (t && t.length <= 60) return t
      }
      var parent = el.parentElement
      if (parent && parent.querySelectorAll && parent.querySelectorAll('input,select,textarea').length === 1) {
        prev = parent.previousElementSibling
        if (prev && !(prev.querySelectorAll && prev.querySelectorAll('input,select,textarea').length)) {
          t = textOf(prev)
          if (t && t.length <= 60) return t
        }
      }
    } catch (e) {}
    return ''
  }
  function groupLabel(el) {
    var fs = closest(el, 'fieldset')
    var legend = fs && fs.querySelector ? fs.querySelector('legend') : null
    if (legend) return textOf(legend)
    var rg = closest(el, '[role="radiogroup"],[role="group"]')
    if (rg) return attr(rg, 'aria-label') || labelledBy(rg)
    return ''
  }
  function controlRecord(el, type, value, checked, label) {
    var name = str(el.name || attr(el, 'name'))
    var auto = attr(el, 'autocomplete').replace(/^section-\S+\s+/, '').replace(/^(shipping|billing)\s+/, '')
    var raw = [name, str(el.id), label, attr(el, 'placeholder'), attr(el, 'aria-label'), auto === 'on' || auto === 'off' ? '' : auto, attr(el, 'data-field')]
    var hints = []
    for (var i = 0; i < raw.length; i++) {
      var n = norm(raw[i])
      if (n && hints.indexOf(n) < 0) hints.push(n)
    }
    var key = cleanKey(label || attr(el, 'aria-label') || attr(el, 'placeholder') || name || el.id) || TYPE_LABEL[type] || 'Details'
    return {
      key: key, hints: hints, groups: groupsOfAll(hints), hintText: raw.join(' '), type: type,
      value: typeof value === 'string' ? value.trim().slice(0, 4000) : value, checked: !!checked,
      explicitField: identOf(attr(el, 'data-evo-field')), name: name, el: el,
    }
  }
  function collectControls(container, formless) {
    var list = container.tagName === 'FORM' && container.elements ? container.elements : container.querySelectorAll('input,select,textarea')
    var out = []
    var seenNames = {}
    var groups = {}
    var order = []
    out.sensitive = false
    for (var i = 0; i < list.length; i++) {
      var el = list[i]
      if (!el || !CONTROL_TAGS[el.tagName]) continue
      var name = str(el.name || attr(el, 'name'))
      if (name) seenNames[name] = 1
      if (el.disabled || (formless && (el.form || closest(el, 'form')))) continue
      var type = el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? (el.multiple ? 'select-multiple' : 'select') : str(el.type || attr(el, 'type') || 'text').toLowerCase()
      if (HONEYPOT.test(name)) { if (str(el.value).trim()) out.honeypot = true; continue }
      if (type === 'password') { out.sensitive = true; continue }
      var hintWords = words([name, el.id, attr(el, 'placeholder'), attr(el, 'aria-label'), attr(el, 'autocomplete')].join(' '))
      if (SENSITIVE.test(hintWords) || /^cc-/.test(attr(el, 'autocomplete'))) continue
      if (SKIP_TYPES[type]) continue
      if (type === 'hidden' && (!name || /^(_|\$|utm_)/i.test(name) || /redirect|next|return|honeypot/i.test(name))) continue
      if ((type === 'radio' || type === 'checkbox') && name) {
        var gk = type + ':' + name
        if (!groups[gk]) { groups[gk] = []; order.push(gk); out.push(gk) }
        groups[gk].push(el)
        continue
      }
      var value
      var checked = false
      if (type === 'checkbox' || type === 'radio') {
        checked = !!el.checked
        if (!checked) continue
        value = el.value && el.value !== 'on' ? el.value : type === 'checkbox' ? true : labelOf(el)
      } else if (type === 'select-multiple') {
        value = []
        var opts = el.options || []
        for (var o = 0; o < opts.length; o++) if (opts[o].selected) value.push(str(opts[o].value || opts[o].text))
      } else {
        value = str(el.value)
      }
      out.push(controlRecord(el, type, value, checked, labelOf(el)))
    }
    for (var g = 0; g < order.length; g++) {
      var members = groups[order[g]]
      var first = members[0]
      var isRadio = order[g].indexOf('radio:') === 0
      var picked = []
      for (var m = 0; m < members.length; m++) {
        if (!members[m].checked) continue
        var v = members[m].value
        picked.push(v && v !== 'on' ? v : labelOf(members[m]) || 'Yes')
      }
      var slot = out.indexOf(order[g])
      if (!picked.length) { out.splice(slot, 1); continue }
      var single = members.length === 1 && !isRadio
      var value2 = isRadio ? picked[0] : single ? (first.value && first.value !== 'on' ? first.value : true) : picked
      var label = single ? labelOf(first) : groupLabel(first) || labelOf(first)
      out[slot] = controlRecord(first, isRadio ? 'radio' : 'checkbox', value2, true, label)
    }
    if (container.tagName === 'FORM' && typeof FormData === 'function') {
      try {
        var fd = new FormData(container)
        fd.forEach(function (val, key) {
          if (seenNames[key] || typeof val !== 'string' || !val.trim() || /^(_|\$)/.test(key) || HONEYPOT.test(key) || SENSITIVE.test(words(key))) return
          seenNames[key] = 1
          out.push(synthetic(cleanKey(key), [key], 'text', val.trim().slice(0, 4000)))
        })
      } catch (e) {}
    }
    return out
  }
  function corpusOf(container, submitter, controls) {
    var parts = [attr(container, 'id'), attr(container, 'name'), attr(container, 'action'), attr(container, 'aria-label'), attr(container, 'title'), attr(container, 'data-evo-intent')]
    if (submitter) parts.push(textOf(submitter), str(submitter.value), attr(submitter, 'aria-label'))
    parts.push(textOf(container))
    // Nearest section heading, without crossing into page-level containers or sibling forms.
    var node = container.parentElement
    for (var d = 0; node && d < 4 && !/^(BODY|HTML|MAIN)$/.test(node.tagName); d++, node = node.parentElement) {
      if (node.querySelectorAll && node.querySelectorAll('form').length > (container.tagName === 'FORM' ? 1 : 0)) break
      parts.push(attr(node, 'id'), attr(node, 'aria-label'))
      var h = node.querySelector ? node.querySelector('h1,h2,h3') : null
      if (h) { parts.push(textOf(h)); break }
    }
    for (var i = 0; i < controls.length; i++) parts.push(controls[i].hintText)
    return words(parts.join(' '))
  }
  function optedOut(el) { return !!closest(el, '[data-evo-ignore],[data-evo="off"]') }
  function explicitCollection(el) { return attr(closest(el, '[data-evo-collection]'), 'data-evo-collection').trim() }
  function isSearch(form, controls) {
    if (attr(form, 'role').toLowerCase() === 'search' || /search/i.test(attr(form, 'action'))) return true
    var filled = controls.filter(hasValue)
    return filled.length === 1 && (filled[0].type === 'search' || /^(q|query|search|s|keywords?|term)$/i.test(filled[0].name || ''))
  }
  function meaningful(ctl) { return hasValue(ctl) && !!TEXTLIKE[ctl.type] }
  function plain(controls) {
    var data = {}
    for (var i = 0; i < controls.length; i++) {
      if (!hasValue(controls[i])) continue
      var k = identOf(controls[i].name || controls[i].key) || 'field_' + (i + 1)
      var v = controls[i].value
      data[k] = typeof v === 'number' || typeof v === 'boolean' || Array.isArray(v) ? v : flat(v)
    }
    return data
  }

  function onSubmitCapture(e) {
    try {
      if (!api.autoCapture || !e || e.__evoSeen) return
      e.__evoSeen = true
      var form = e.target
      if (!form || form.tagName !== 'FORM' || optedOut(form)) return
      var submitter = e.submitter || null
      var explicit = explicitCollection(form)
      var controls = collectControls(form, false)
      if (!explicit && (controls.sensitive || isSearch(form, controls))) return
      if (!controls.some(hasValue)) return
      var action = str(attr(submitter, 'formaction') || attr(form, 'action')).trim()
      var method = str(attr(submitter, 'formmethod') || attr(form, 'method')).toLowerCase()
      var leaving = false
      if (method !== 'dialog') {
        if (!action || action.charAt(0) === '#') e.preventDefault()
        else if (!/^javascript:/i.test(action)) leaving = true
      }
      capture({ container: form, submitter: submitter, controls: controls, explicit: explicit, corpus: corpusOf(form, submitter, controls), leaving: leaving, formless: false })
    } catch (err) {}
  }
  function onClickCapture(e) {
    try {
      if (!api.autoCapture || !e || e.defaultPrevented) return
      var btn = closest(e.target, 'button,[role="button"],input[type="button"],input[type="submit"],a')
      if (!btn || btn.form || closest(btn, 'form') || optedOut(btn)) return
      if (btn.tagName === 'A') {
        var href = attr(btn, 'href').trim()
        if (href && href !== '#' && !/^javascript:/i.test(href)) return
      }
      if (btn.disabled || attr(btn, 'aria-disabled') === 'true' || attr(btn, 'aria-haspopup') || attr(btn, 'aria-expanded') || attr(btn, 'aria-controls')) return
      var label = words(textOf(btn) + ' ' + str(btn.tagName === 'INPUT' ? btn.value : '') + ' ' + attr(btn, 'aria-label'))
      if (!label || label.length > 60 || NOT_ACTION.test(label) || !ACTION_TEXT.test(label)) return
      var box = null
      var node = btn.parentElement
      for (var d = 0; node && d < 5 && node.tagName !== 'BODY' && node.tagName !== 'HTML'; d++, node = node.parentElement) {
        var count = node.querySelectorAll ? node.querySelectorAll('input,select,textarea').length : 0
        if (count) { if (count <= 16) box = node; break }
      }
      if (!box) return
      var controls = collectControls(box, true)
      var explicit = explicitCollection(box)
      if (!controls.some(meaningful) || (!explicit && controls.sensitive)) return
      capture({ container: box, submitter: btn, controls: controls, explicit: explicit, corpus: corpusOf(box, btn, controls), leaving: false, formless: true })
    } catch (err) {}
  }
  function capture(snap) {
    var mark = sdkCalls
    function run() {
      if (sdkCalls !== mark) return // the site already sent it through window.evo
      ensureConfig().then(function (cfg) {
        if (!cfg) return
        var coll = chooseCollection(cfg, snap)
        if (!coll) return
        var m = coll.fields && coll.fields.length ? mapControls(coll, snap.controls) : { data: plain(snap.controls), missing: 0 }
        if (!Object.keys(m.data).length || (snap.formless && m.missing)) return
        if (snap.controls.honeypot) m.data._hp = '1'
        deliver(coll.key, m.data, { leaving: snap.leaving }).then(function (res) { report(res, snap.container, coll) })
      })
    }
    if (snap.leaving) run()
    else later(run, 30)
  }

  // ── transport ────────────────────────────────────────────────────────────
  function normConfig(c) {
    if (!c || typeof c !== 'object' || !PROJECT_RE.test(str(c.projectId)) || !Array.isArray(c.collections)) return null
    var cols = []
    for (var i = 0; i < c.collections.length && cols.length < 60; i++) {
      var col = c.collections[i]
      if (!col || !IDENT_RE.test(str(col.key))) continue
      var fields = []
      var raw = Array.isArray(col.fields) ? col.fields : []
      for (var j = 0; j < raw.length && fields.length < 80; j++) {
        var f = raw[j]
        if (!f || !IDENT_RE.test(str(f.key))) continue
        fields.push({
          key: f.key, label: str(f.label) || f.key, type: str(f.type) || 'text',
          options: Array.isArray(f.options) ? f.options.map(str).slice(0, 100) : [],
          publicWritable: f.publicWritable !== false, required: f.required === true,
        })
      }
      cols.push({
        key: col.key, label: str(col.label) || col.key, singular: str(col.singular) || str(col.label) || col.key,
        publicCreate: col.publicCreate === true, publicRead: col.publicRead === true, fields: fields,
      })
    }
    return { projectId: str(c.projectId), apiBase: str(c.apiBase).replace(/\/+$/, ''), appName: str(c.appName), collections: cols }
  }
  function setConfig(raw, from, origin) {
    var next = normConfig(raw)
    if (!next) return false
    if (from === 'file') fileOrigin = originOf(next.apiBase)
    if (from === 'file' && configFrom === 'parent') return false // the embedding EvoStack app is authoritative
    config = next
    configFrom = from
    if (from === 'parent' && origin) parentOrigin = origin
    try { window.dispatchEvent(new CustomEvent('evo:config', { detail: config })) } catch (e) {}
    return true
  }
  function flushWaiters() {
    var list = waiters
    waiters = []
    for (var i = 0; i < list.length; i++) list[i]()
  }
  function loadFile() {
    if (typeof fetch !== 'function') return Promise.resolve(config)
    return fetch(CONFIG_PATH, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (j) { if (j) setConfig(j, 'file'); return config }, function () { return config })
  }
  function askParent() {
    if (!isEmbedded()) return Promise.resolve(config)
    return new Promise(function (resolve) {
      var done = false
      function finish() { if (!done) { done = true; resolve(config) } }
      waiters.push(finish)
      later(finish, 1200)
      try { window.parent.postMessage({ source: DATA_SOURCE, type: 'config-request' }, '*') } catch (e) { finish() }
    })
  }
  function ensureConfig() {
    if (config) return Promise.resolve(config)
    if (loading && now() - loading.at < 3000) return loading.promise
    var promise = new Promise(function (resolve) {
      var left = 2
      function settle() { left--; if (config || left <= 0) resolve(config) }
      loadFile().then(settle, settle)
      askParent().then(settle, settle)
    })
    loading = { at: now(), promise: promise }
    return promise
  }
  function relayTarget() {
    if (!isEmbedded()) return ''
    if (parentOrigin) return parentOrigin
    var base = config ? originOf(config.apiBase) : ''
    if (!base) return ''
    var actual = ''
    try {
      var anc = window.location && window.location.ancestorOrigins
      if (anc && anc.length) actual = anc[0]
    } catch (e) {}
    if (!actual) {
      try { actual = originOf(document.referrer) } catch (e) {}
      try { if (actual && window.location && actual === window.location.origin) actual = '' } catch (e) {}
    }
    return actual && actual !== base ? '' : base
  }
  function relay(target, type, payload, fireAndForget) {
    return new Promise(function (resolve) {
      var id = 'evo_' + now().toString(36) + '_' + (++seq)
      var msg = { source: DATA_SOURCE, type: type, id: id }
      for (var k in payload) if (own(payload, k)) msg[k] = payload[k]
      var timer = 0
      if (!fireAndForget) {
        timer = later(function () { delete pending[id]; resolve(null) }, ACK_MS)
        pending[id] = { origin: target, done: function (ack) { cancel(timer); delete pending[id]; resolve(ack) } }
      }
      try {
        window.parent.postMessage(msg, target)
      } catch (e) {
        cancel(timer)
        delete pending[id]
        resolve(null)
        return
      }
      if (fireAndForget) resolve({ ok: true, status: 202, result: null })
    })
  }
  function human(err, status) {
    var e = typeof err === 'string' ? err : err && typeof err.message === 'string' ? err.message : ''
    if (status === 429 || /rate.?limit/i.test(e)) return 'Too many requests. Try again in a minute.'
    if (e === 'not_provisioned' || e === 'not_connected' || (status === 404 && !e)) return 'This site is not connected to its backend yet.'
    if ((status === 403 && (!e || e === 'forbidden')) || (status === 404 && e === 'not_found')) return 'This form is not accepting submissions.'
    if (status === 413 || e === 'payload_too_large') return 'That submission is too large.'
    if (e) return e.replace(/_/g, ' ').replace(/^\w/, function (c) { return c.toUpperCase() }).slice(0, 160)
    return status ? 'Request failed (' + status + ').' : 'Network error. Please try again.'
  }
  function fromAck(ack) {
    var result = ack.result === undefined ? null : ack.result
    return {
      ok: !!ack.ok, status: Number(ack.status) || (ack.ok ? 200 : 0), result: result,
      record: (result && result.record) || ack.record || null,
      error: ack.ok ? '' : human((result && (result.message || result.error)) || ack.error, Number(ack.status) || 0),
    }
  }
  function direct(method, path, body, keepalive) {
    if (!config || !config.apiBase || typeof fetch !== 'function') return Promise.resolve({ ok: false, status: 0, result: null, error: human('not_connected', 0) })
    var init = { method: method, mode: 'cors', credentials: 'omit', cache: 'no-store' }
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json', 'x-evo-source': 'website' }
      init.body = JSON.stringify(body)
    }
    if (keepalive) init.keepalive = true
    return fetch(config.apiBase + path, init).then(function (r) {
      return r.text().then(function (t) {
        var j = null
        try { j = t ? JSON.parse(t) : null } catch (e) {}
        return { ok: r.ok, status: r.status, result: j, record: (j && j.record) || null, error: r.ok ? '' : human(j && (j.message || j.error), r.status) }
      })
    }, function () { return { ok: false, status: 0, result: null, error: human('', 0) } })
  }
  function recordsPath(collection) { return '/api/p/' + encodeURIComponent(config.projectId) + '/records/' + encodeURIComponent(collection) }
  function deliver(collection, data, opts) {
    var sig = collection + '|' + safeJson(data)
    if (recent.promise && recent.sig === sig && now() - recent.at < 1500) {
      return recent.promise.then(function (r) { var c = {}; for (var k in r) if (own(r, k)) c[k] = r[k]; c.deduped = true; return c })
    }
    var leaving = !!(opts && opts.leaving)
    var target = relayTarget()
    var promise = (target ? relay(target, 'submit', { collection: collection, data: data }, leaving) : Promise.resolve(null)).then(function (ack) {
      if (ack && (ack.ok || !ack.fallback)) return fromAck(ack)
      return direct('POST', recordsPath(collection), { data: data }, leaving)
    })
    recent = { sig: sig, at: now(), promise: promise }
    return promise
  }

  // ── feedback ─────────────────────────────────────────────────────────────
  var toastEl = null
  var toastTimer = 0
  function toast(text, kind) {
    try {
      var root = document.body || document.documentElement
      if (!root || !document.createElement) return
      if (!toastEl) {
        toastEl = document.createElement('div')
        toastEl.id = '__evo_data_toast'
        toastEl.setAttribute('role', 'status')
        toastEl.setAttribute('aria-live', 'polite')
        toastEl.style.cssText = [
          'position:fixed', 'left:50%', 'bottom:24px', 'z-index:2147483647', 'box-sizing:border-box',
          'transform:translate(-50%,10px)', 'opacity:0', 'pointer-events:none', 'max-width:min(92vw,380px)',
          'padding:9px 16px', 'font:500 13px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
          'letter-spacing:.01em', 'text-align:center', 'white-space:normal',
          'box-shadow:0 12px 32px -12px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.08)',
          '-webkit-backdrop-filter:blur(8px)', 'backdrop-filter:blur(8px)', 'transition:opacity .2s ease,transform .2s ease',
        ].join(';')
      }
      if (toastEl.parentNode !== root) root.appendChild(toastEl)
      var error = kind === 'error'
      toastEl.textContent = text
      toastEl.style.borderRadius = text.length > 44 ? '14px' : '999px'
      toastEl.style.background = error ? 'rgba(69,10,10,.95)' : 'rgba(24,24,27,.94)'
      toastEl.style.color = error ? '#fecaca' : '#fafafa'
      var el = toastEl
      later(function () { el.style.opacity = '1'; el.style.transform = 'translate(-50%,0)' }, 16)
      cancel(toastTimer)
      toastTimer = later(function () { el.style.opacity = '0'; el.style.transform = 'translate(-50%,10px)' }, error ? 4500 : 2600)
    } catch (e) {}
  }
  function report(res, el, coll) {
    if (!res || res.deduped) return
    toast(res.ok ? 'Sent \u2713' : 'Couldn\u2019t send \u00b7 ' + res.error, res.ok ? 'ok' : 'error')
    try {
      if (el && el.dispatchEvent && typeof CustomEvent === 'function') {
        el.dispatchEvent(new CustomEvent(res.ok ? 'evo:submitted' : 'evo:error', { bubbles: true, detail: { collection: coll.key, record: res.record, error: res.error } }))
      }
    } catch (e) {}
  }

  // ── SDK for generated code ───────────────────────────────────────────────
  function controlsFromObject(data) {
    var out = []
    if (!data || typeof data !== 'object') return out
    for (var k in data) {
      if (!own(data, k)) continue
      var v = data[k]
      if (v == null || v === '' || typeof v === 'function') continue
      if (typeof v === 'object' && !Array.isArray(v)) v = safeJson(v)
      var c = synthetic(cleanKey(k), [k.replace(/_/g, ' ')], typeof v === 'boolean' ? 'checkbox' : typeof v === 'number' ? 'number' : 'text', v)
      c.checked = v === true
      c.keepFalse = true
      c.explicitField = IDENT_RE.test(k) ? k : ''
      c.name = k
      out.push(c)
    }
    return out
  }
  function query(params) {
    var parts = []
    for (var k in params) if (own(params, k)) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    return parts.length ? '?' + parts.join('&') : ''
  }
  function fail(res) {
    var err = new Error(res.error || 'Request failed.')
    err.status = res.status
    throw err
  }
  var api = {
    version: 1,
    autoCapture: true,
    ready: function () { return ensureConfig() },
    collections: function () { return config ? config.collections.slice() : [] },
    submit: function (collection, data, opts) {
      sdkCalls++
      opts = opts || {}
      return ensureConfig().then(function (cfg) {
        if (!cfg) throw new Error(human('not_connected', 0))
        var controls = controlsFromObject(data)
        var coll = collection
          ? findCollection(cfg, collection) || (IDENT_RE.test(str(collection)) ? { key: str(collection), fields: [] } : null)
          : chooseCollection(cfg, { controls: controls, corpus: words(Object.keys(data || {}).join(' ')) })
        if (!coll) throw new Error('No collection accepts website submissions.')
        var payload = coll.fields && coll.fields.length ? mapControls(coll, controls).data : plain(controls)
        return deliver(coll.key, payload, {}).then(function (res) {
          if (opts.toast !== false) report(res, null, coll)
          if (!res.ok) fail(res)
          return res.record || (res.result && res.result.record) || res.result
        })
      })
    },
    list: function (collection, params) {
      return ensureConfig().then(function (cfg) {
        if (!cfg) throw new Error(human('not_connected', 0))
        var coll = findCollection(cfg, collection)
        var key = coll ? coll.key : str(collection)
        if (!IDENT_RE.test(key)) throw new Error('Unknown collection: ' + key)
        var clean = {}
        if (params && typeof params === 'object') {
          for (var k in params) if (own(params, k) && /^(q|sort|dir|limit|offset|status)$/.test(k) && params[k] != null) clean[k] = str(params[k])
        }
        var target = relayTarget()
        return (target ? relay(target, 'list', { collection: key, params: clean }, false) : Promise.resolve(null)).then(function (ack) {
          if (ack && (ack.ok || !ack.fallback)) return fromAck(ack)
          return direct('GET', recordsPath(key) + query(clean))
        }).then(function (res) {
          if (!res.ok) fail(res)
          var r = res.result || {}
          var rows = Array.isArray(r.rows) ? r.rows : []
          return { rows: rows, total: typeof r.total === 'number' ? r.total : rows.length }
        })
      })
    },
    /** Capture a form or any container of inputs on demand (custom widgets). */
    capture: function (el, collection) {
      if (!el) return
      var controls = collectControls(el, el.tagName !== 'FORM')
      capture({ container: el, submitter: null, controls: controls, explicit: str(collection) || explicitCollection(el), corpus: corpusOf(el, null, controls), leaving: false, formless: false })
    },
  }
  try { Object.defineProperty(api, 'config', { enumerable: true, get: function () { return config } }) } catch (e) { api.config = null }
  window.evo = api

  window.addEventListener('message', function (e) {
    var d = e && e.data
    if (!d || d.source !== HOST_SOURCE) return
    try { if (e.source && window.parent && e.source !== window.parent) return } catch (err) { return }
    if (d.type === 'platform-config') {
      if (d.config && !(fileOrigin && e.origin && e.origin !== fileOrigin)) setConfig(d.config, 'parent', e.origin)
      flushWaiters()
    } else if (d.type === 'data-ack' && typeof d.id === 'string' && own(pending, d.id)) {
      var slot = pending[d.id]
      if (slot.origin && slot.origin !== '*' && e.origin && e.origin !== slot.origin) return
      slot.done(d)
    }
  })

  function hook(doc) {
    try {
      if (!doc || doc.__evoDataHooked || !doc.addEventListener) return
      doc.__evoDataHooked = true
      doc.addEventListener('submit', onSubmitCapture, true)
      doc.addEventListener('click', onClickCapture, true)
    } catch (e) {}
  }
  // Same-origin child frames (static HTML previews are mounted in one) get the same capture.
  function hookFrames() {
    try {
      var frames = document.getElementsByTagName ? document.getElementsByTagName('iframe') : []
      for (var i = 0; i < frames.length; i++) {
        var f = frames[i]
        if (!f.__evoDataLoad && f.addEventListener) {
          f.__evoDataLoad = true
          f.addEventListener('load', function (ev) { try { hook(ev.target.contentDocument) } catch (e) {} })
        }
        try { hook(f.contentDocument) } catch (e) {}
      }
    } catch (e) {}
  }
  hook(document)
  if (document.addEventListener) document.addEventListener('DOMContentLoaded', hookFrames)
  window.addEventListener('load', hookFrames)
  var frameChecks = 0
  var frameTimer = typeof setInterval === 'function' ? setInterval(function () {
    hookFrames()
    if (++frameChecks >= 20 && typeof clearInterval === 'function') clearInterval(frameTimer)
  }, 1000) : 0
  loadFile()
})()
