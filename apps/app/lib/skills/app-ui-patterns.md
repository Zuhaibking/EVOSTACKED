---
name: app-ui-patterns
description: Multi-screen product UI — navigation, forms, tables, modals, and the interaction details that make an app feel shipped.
when: fullstack-webapp
---

## Application UI patterns

Tools are judged on the tenth use, not the first. Optimize for the operator who lives here.

### Navigation
- Pick one primary pattern and commit: sidebar (many sections, deep), top bar (few sections),
  or command palette + minimal chrome (power users).
- The current location is always obvious — active state, breadcrumb, or title. "Where am I"
  should never require a guess.
- Nested navigation beyond two levels means the information architecture is wrong.
- Mobile: the nav must actually open, close, trap focus, and close on route change.

### Forms
- One column. Multi-column forms break scan order and are worse on every screen size.
- Label above the input. Placeholder is an example, never the label.
- Validate on blur and on submit — not on every keystroke, which fights the user mid-typing.
- Errors sit next to the field that failed, name the fix ("Password needs 8+ characters"), and
  the first invalid field takes focus on submit.
- The submit button shows pending state and disables to prevent double-submit.
- Destructive actions confirm, and the confirm button names the action ("Delete project"),
  never "OK".

### Tables and lists
- Sticky header. Right-aligned numbers with tabular figures. Left-aligned text.
- Row actions are reachable without a hover-only reveal on touch.
- Sorting, filtering, and search must actually change the visible rows.
- Paginate or virtualize past ~50 rows; show the total count.
- Empty state explains how to create the first row and offers the button to do it.

### Modals and overlays
- Modal for a focused decision. Drawer for context alongside. Inline edit for small changes.
  Do not stack modals.
- Escape closes, backdrop click closes, focus is trapped inside and returns to the trigger on
  close.
- Never put a long form or a whole workflow in a modal — that is a page.

### Feedback and time
- Any action over ~400ms shows progress. Optimistic updates need a rollback path on failure.
- Toasts for transient confirmation, inline for anything the user must act on.
- Never leave a click with no visible response.

### State that survives
- Filters, sort, tab, and pagination belong in the URL so a view can be shared and restored.
- Preserve unsaved work across accidental navigation, or warn before dropping it.
- Loading skeletons match the real layout so the page does not jump when data lands.

### Keyboard
- Every interactive element is reachable by Tab in a sensible order.
- Enter submits the focused form. Escape backs out of the current layer.
- If the product is used daily, add shortcuts for the top 3 actions and a way to discover them.
