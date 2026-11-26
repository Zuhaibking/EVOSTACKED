// Flat config (ESLint 9+). Replaces .eslintrc.json, which ESLint 10 no longer
// reads, and `next lint`, which Next 16 removed. Mirrors the old
// `extends: "next/core-web-vitals"`.
import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = defineConfig([
  ...nextVitals,
  globalIgnores([
    // Default ignores of eslint-config-next (restated because globalIgnores replaces them).
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Agent scratch files, not app code.
    '.context/**',
  ]),
])

export default eslintConfig
