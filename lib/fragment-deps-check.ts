import assert from 'node:assert/strict'
import { extraNpmPackages, npmInstallCommand } from './fragment-deps'

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
  extraNpmPackages([], ['foo && wget evil']).length,
  0,
)

console.log('fragment-deps-check ok')
