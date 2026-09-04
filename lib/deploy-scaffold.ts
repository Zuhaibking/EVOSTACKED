import { WrittenFile } from './fragment-files'

const PKG = `{
  "name": "evostack-app",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "14.2.35",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  }
}
`

const NEXT_CONFIG = `/** @type {import('next').NextConfig} */
module.exports = { reactStrictMode: true }
`

const TSCONFIG = `{
  "compilerOptions": {
    "target": "es5",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": false,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
  "exclude": ["node_modules"]
}
`

const APP = `export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />
}
`

export function isStaticSite(files: WrittenFile[]): boolean {
  const hasPage = files.some((f) =>
    /^(pages|app|src\/pages|src\/app)\//.test(f.file_path),
  )
  const hasHtml = files.some((f) => /\.html?$/i.test(f.file_path))
  return hasHtml && !hasPage
}

/** Add the minimum Next.js pages-router files Vercel needs. Never overwrites existing. */
export function withDeployScaffold(files: WrittenFile[]): WrittenFile[] {
  const map = new Map(files.map((f) => [f.file_path.replace(/\\/g, '/'), { ...f }]))
  if (isStaticSite([...map.values()])) {
    const html =
      map.get('index.html') ||
      map.get('public/generated.html') ||
      [...map.values()].find((f) => /\.html?$/i.test(f.file_path))
    if (html && !map.has('index.html') && !map.has('public/index.html')) {
      map.set('index.html', { file_path: 'index.html', file_content: html.file_content })
    }
    return [...map.values()]
  }
  if (!map.has('package.json')) {
    map.set('package.json', { file_path: 'package.json', file_content: PKG })
  }
  if (!map.has('next.config.js') && !map.has('next.config.mjs') && !map.has('next.config.ts')) {
    map.set('next.config.js', { file_path: 'next.config.js', file_content: NEXT_CONFIG })
  }
  const hasTs = [...map.keys()].some((p) => /\.tsx?$/.test(p))
  if (hasTs && !map.has('tsconfig.json')) {
    map.set('tsconfig.json', { file_path: 'tsconfig.json', file_content: TSCONFIG })
  }
  if (!map.has('pages/_app.tsx') && !map.has('pages/_app.jsx') && !map.has('pages/_app.js')) {
    map.set('pages/_app.jsx', { file_path: 'pages/_app.jsx', file_content: APP })
  }
  return [...map.values()]
}
