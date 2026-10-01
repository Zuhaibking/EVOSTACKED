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
    return el && (el.id === '__evo_inspect_box' || el.id === '__evo_inspect_pad')
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
