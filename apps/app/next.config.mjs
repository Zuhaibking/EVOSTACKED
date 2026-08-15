import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  transpilePackages: ['@evostack/shared'],
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
  env: {
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333',
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
        ],
      },
    ]
  },
}

export default nextConfig
