import assert from 'node:assert/strict'
import {
  collectInstallPackages,
  npmPackageName,
  npmPackagesFromCode,
  safeInstallCommand,
} from './safe-install'

assert.equal(npmPackageName('framer-motion'), 'framer-motion')
assert.equal(npmPackageName('@radix-ui/react-dialog'), null)
assert.equal(npmPackageName('react'), null)
assert.equal(npmPackageName('next/link'), null)
assert.equal(npmPackageName('@/components/ui/button'), null)
assert.equal(npmPackageName('../data/data'), null)
assert.equal(npmPackageName('lucide-react'), null)
assert.equal(npmPackageName('rm -rf /'), null)

const code = `
import { motion } from 'framer-motion'
import { LineChart } from 'recharts'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
`
assert.deepEqual(npmPackagesFromCode(code).sort(), ['framer-motion', 'recharts'])

assert.equal(
  safeInstallCommand({
    code,
    additional_dependencies: ['framer-motion'],
    install_dependencies_command: 'npm install framer-motion && rm -rf /',
  }),
  'npm install framer-motion recharts',
)

assert.equal(
  safeInstallCommand({
    code: 'import React from "react"\nexport default function Page(){return <div/>}',
    has_additional_dependencies: true,
    install_dependencies_command: 'npm install lucide-react',
  }),
  null,
)

assert.deepEqual(
  collectInstallPackages({
    additional_dependencies: ['recharts'],
    install_dependencies_command: 'yarn add zod',
  }).sort(),
  ['recharts', 'zod'],
)

console.log('safe-install-check ok')
