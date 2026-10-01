import assert from 'node:assert/strict'
import {
  detectPackageManager,
  extraNpmPackages,
  installCommand,
  npmInstallCommand,
  typePackagesForDiagnostics,
} from './fragment-deps'

const goa = `import React from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import Head from 'next/head'
import mock from '../data/data'
`

assert.deepEqual(
  extraNpmPackages([{ file_path: 'pages/index.tsx', file_content: goa }]),
  ['framer-motion'],
)

assert.deepEqual(
  extraNpmPackages(
    [{ file_path: 'pages/index.tsx', file_content: goa }],
    ['framer-motion', 'gsap@3.12.5', 'react'],
  ),
  ['framer-motion', 'gsap'],
)

assert.deepEqual(
  extraNpmPackages([
    {
      file_path: 'pages/index.tsx',
      file_content: `import { Canvas } from '@react-three/fiber'\nimport * as THREE from 'three'`,
    },
  ]),
  ['@react-three/fiber', 'three'],
)

assert.equal(
  extraNpmPackages([
    { file_path: 'pages/index.tsx', file_content: `import { useState } from 'react'` },
  ]).length,
  0,
)

assert.equal(npmInstallCommand(['framer-motion; rm -rf /']), null)
assert.equal(
  npmInstallCommand(['framer-motion', 'gsap']),
  'npm install --no-fund --no-audit framer-motion gsap',
)
assert.equal(
  detectPackageManager({ lockfiles: ['package-lock.json'], packageManager: 'pnpm@9.0.0' }),
  'npm',
)
assert.equal(detectPackageManager({ lockfiles: ['pnpm-lock.yaml'] }), 'pnpm')
assert.equal(detectPackageManager({ lockfiles: ['yarn.lock'] }), 'yarn')
assert.equal(detectPackageManager({ packageManager: 'pnpm@9.15.0' }), 'pnpm')
assert.equal(detectPackageManager({}), 'npm')
assert.equal(
  detectPackageManager({ lockfiles: ['pnpm-lock.yaml', 'package-lock.json'] }),
  null,
)
assert.equal(installCommand('pnpm', ['framer-motion']), 'pnpm add framer-motion')
assert.equal(installCommand('yarn', ['gsap']), 'yarn add gsap')
assert.equal(installCommand('yarn', ['gsap'], true), null)
assert.equal(
  installCommand('npm', ['framer-motion'], true),
  'npm install --no-fund --no-audit --legacy-peer-deps framer-motion',
)
assert.equal(
  extraNpmPackages([], ['foo && wget evil']).length,
  0,
)
assert.deepEqual(extraNpmPackages([], ['qrcode', '@types/qrcode', '@types/lodash@4.17.0']), ['@types/lodash', '@types/qrcode', 'qrcode'])
assert.equal(installCommand('npm', ['@types/qrcode']), 'npm install --no-fund --no-audit @types/qrcode')
assert.deepEqual(typePackagesForDiagnostics([
  "pages/index.tsx(2,20): error TS7016: Could not find a declaration file for module 'qrcode'. '/node_modules/qrcode/lib/index.js' implicitly has an 'any' type.",
  "components/Canvas.tsx(1,22): error TS7016: Could not find a declaration file for module '@scope/canvas/render'.",
  "components/Hero.tsx(1,18): error TS7016: Could not find a declaration file for module 'lodash/debounce'.",
  "pages/index.tsx(2,20): error TS7016: Could not find a declaration file for module 'qrcode'.",
].join('\n')), ['@types/lodash', '@types/qrcode', '@types/scope__canvas'])
assert.deepEqual(typePackagesForDiagnostics("error TS2307: Cannot find module 'qrcode' or its corresponding type declarations."), [], 'Missing runtime imports do not justify guessing declaration packages')
assert.deepEqual(typePackagesForDiagnostics("Could not find a declaration file for module 'qrcode'."), [], 'A generic model/runtime message is not compiler evidence')
for (const spec of ['../local', '@/components/Button', 'node:fs', 'https://evil.test/x', 'qrcode; touch /tmp/evil', '@types/qrcode']) {
  assert.deepEqual(typePackagesForDiagnostics(`error TS7016: Could not find a declaration file for module '${spec}'.`), [])
}

console.log('fragment-deps-check ok')
