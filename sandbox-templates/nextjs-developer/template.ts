import { Template, waitForPort } from 'e2b'

// shadcn@2.1.7 add --all installs every live registry name, then fetches
// styles/new-york/<name>.json. attachment and eight other names 404 there,
// and the first miss aborts the build. These are the names that exist.
const shadcnComponents = [
  'accordion',
  'alert',
  'alert-dialog',
  'aspect-ratio',
  'avatar',
  'badge',
  'breadcrumb',
  'button',
  'button-group',
  'calendar',
  'card',
  'carousel',
  'chart',
  'checkbox',
  'collapsible',
  'command',
  'context-menu',
  'dialog',
  'drawer',
  'dropdown-menu',
  'empty',
  'field',
  'form',
  'hover-card',
  'input',
  'input-group',
  'input-otp',
  'item',
  'kbd',
  'label',
  'menubar',
  'navigation-menu',
  'pagination',
  'popover',
  'progress',
  'radio-group',
  'scroll-area',
  'select',
  'separator',
  'sheet',
  'sidebar',
  'skeleton',
  'slider',
  'sonner',
  'spinner',
  'switch',
  'table',
  'tabs',
  'textarea',
  'toast',
  'toggle',
  'toggle-group',
  'tooltip',
].join(' ')

export const template = Template()
  .fromNodeImage('24-slim')
  .aptInstall('curl')
  .setWorkdir('/home/user/nextjs-app')
  .runCmd(
    'npx create-next-app@14.2.33 . --ts --tailwind --no-eslint --import-alias "@/*" --use-npm --no-app --no-src-dir',
  )
  .runCmd('npx shadcn@2.1.7 init -d')
  .runCmd(`npx shadcn@2.1.7 add ${shadcnComponents}`)
  .runCmd(
    'mv /home/user/nextjs-app/* /home/user/ && rm -rf /home/user/nextjs-app',
  )
  .setWorkdir('/home/user')
  .setStartCmd('npx next --turbo', waitForPort(3000))
