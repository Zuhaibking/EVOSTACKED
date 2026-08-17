/**
 * Deterministic dependency-closure tests — zero provider / E2B.
 * Run: npm run test:dependency-closure
 */
import assert from 'node:assert/strict'
import {
  closeFragmentDependencies,
  extraPackagesRequired,
  isForbiddenManifestPath,
  isTemplateProvidedPackage,
  resolveInstallCommand,
  stripForbiddenManifests,
} from './dependency-closure'
import {
  canDeployIntegrity,
  validateFragmentIntegrity,
} from './fragment-integrity'
import {
  canDeployFragment,
  runGeneratedProjectPreflight,
} from './prepare-fragment-integrity'
import type { FragmentSchema } from './schema'

function baseFrag(code: FragmentSchema['code']): FragmentSchema {
  return {
    commentary: 'x',
    template: 'nextjs-developer',
    title: 'App',
    description: 'x',
    architecture: 'pages',
    additional_dependencies: [],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    file_path: 'pages/index.tsx',
    code,
  }
}

{
  const frag = baseFrag([
    {
      file_path: 'pages/api/login.ts',
      file_content: `import bcrypt from "bcryptjs"\nexport default function handler(){ return bcrypt.hashSync('x', 8) }`,
    },
    {
      file_path: 'pages/index.tsx',
      file_content: `export default function H(){return <main>ok</main>}`,
    },
  ])
  assert.deepEqual(extraPackagesRequired(frag), ['bcryptjs'])
  const closed = closeFragmentDependencies(frag)
  assert.ok(closed.added.includes('bcryptjs'))
  assert.ok(closed.fragment.additional_dependencies.includes('bcryptjs'))
  assert.equal(closed.fragment.has_additional_dependencies, true)
  assert.match(closed.fragment.install_dependencies_command, /npm install/)
  assert.match(closed.fragment.install_dependencies_command, /bcryptjs/)
  const integrity = validateFragmentIntegrity(closed.fragment)
  assert.equal(
    integrity.issues.some((i) => i.code === 'missing_npm_dependency'),
    false,
    JSON.stringify(integrity.issues),
  )
}

{
  const frag = baseFrag([
    {
      file_path: 'pages/api/token.ts',
      file_content: `import jwt from 'jsonwebtoken'\nexport const sign = (p: object) => jwt.sign(p, 'x')`,
    },
    {
      file_path: 'pages/index.tsx',
      file_content: `import { motion } from 'framer-motion'\nexport default function H(){return <motion.div>ok</motion.div>}`,
    },
  ])
  const closed = closeFragmentDependencies(frag)
  assert.ok(closed.added.includes('jsonwebtoken'))
  assert.ok(closed.added.includes('framer-motion'))
  assert.match(closed.fragment.install_dependencies_command, /framer-motion/)
  assert.match(closed.fragment.install_dependencies_command, /jsonwebtoken/)
}

{
  const frag = baseFrag([
    {
      file_path: 'pages/index.tsx',
      file_content: `import Link from 'next/link'
import { useState } from 'react'
import fs from 'node:fs'
import path from 'path'
import Hero from '../components/Hero'
export default function H(){ useState(0); return <Link href="/"><Hero/></Link> }`,
    },
    {
      file_path: 'components/Hero.tsx',
      file_content: 'export default function Hero(){return <h1>Hi</h1>}',
    },
  ])
  assert.equal(isTemplateProvidedPackage('next/link', 'nextjs-developer'), true)
  assert.equal(isTemplateProvidedPackage('react', 'nextjs-developer'), true)
  assert.deepEqual(extraPackagesRequired(frag), [])
  const closed = closeFragmentDependencies(frag)
  assert.deepEqual(closed.added, [])
  assert.equal(closed.fragment.has_additional_dependencies, false)
}

{
  const frag = baseFrag([
    {
      file_path: 'package.json',
      file_content: '{"name":"stolen"}',
    },
    {
      file_path: 'pages/index.tsx',
      file_content: 'export default function H(){return <main>ok</main>}',
    },
  ])
  assert.equal(isForbiddenManifestPath('package.json'), true)
  const stripped = stripForbiddenManifests(frag)
  assert.equal(
    stripped.code.some((f) => f.file_path === 'package.json'),
    false,
  )
}

{
  const raw = baseFrag([
    {
      file_path: 'pages/api/login.ts',
      file_content: `import bcrypt from "bcryptjs"\nexport default function handler(){ return bcrypt.hashSync('x', 8) }`,
    },
    {
      file_path: 'pages/index.tsx',
      file_content: `export default function H(){return <main>ok</main>}`,
    },
  ])
  assert.equal(validateFragmentIntegrity(raw).ok, false)
  assert.ok(
    validateFragmentIntegrity(raw).issues.some(
      (i) => i.code === 'missing_npm_dependency' && i.specifier === 'bcryptjs',
    ),
  )
  const pre = runGeneratedProjectPreflight(raw)
  assert.ok(pre.fragment.additional_dependencies.includes('bcryptjs'))
  assert.ok(canDeployIntegrity(pre.integrity), JSON.stringify(pre.integrity.issues))
  const gate = canDeployFragment(raw)
  assert.equal(gate.ok, true)
  assert.ok(gate.fragment.additional_dependencies.includes('bcryptjs'))
  assert.ok(resolveInstallCommand(gate.fragment).includes('bcryptjs'))
}

{
  const py: FragmentSchema = {
    ...baseFrag([
      {
        file_path: 'app.py',
        file_content: 'import streamlit as st\nst.write("ok")',
      },
    ]),
    template: 'streamlit-developer',
    file_path: 'app.py',
  }
  const closed = closeFragmentDependencies(py)
  assert.deepEqual(closed.added, [])
}

console.log('dependency-closure.test.ts: all tests passed')
