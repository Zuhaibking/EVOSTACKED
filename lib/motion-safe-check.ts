import assert from 'node:assert/strict'
import { sanitizeMotionKeyframes } from './motion-safe'

const hero = `<motion.div
  initial={{ opacity: 0, y: 50, scale: 1.13 }}
  animate={{ opacity: 1, y: 0, scale: [1.13, 0.97, 1] }}
  transition={{ duration: 1.1, type: "spring", delay: 0.1 }}
  className="relative"
>`
const heroFixed = sanitizeMotionKeyframes(hero)
assert.match(heroFixed, /type: "tween"/)
assert.doesNotMatch(heroFixed, /type: "spring"/)
assert.match(heroFixed, /scale: \[1\.13, 0\.97, 1\]/)

const tight = `<motion.div
  animate={{ opacity: 1, y: 0, scale:[1.12,0.99,1] }}
  transition={{ type: "spring", duration: 1.2, delay:0.24 }}
>`
assert.match(sanitizeMotionKeyframes(tight), /type: "tween"/)
assert.doesNotMatch(sanitizeMotionKeyframes(tight), /type: "spring"/)

const pulse = `<motion.div animate={{ scale: [1, 1.1, 1] }}>`
assert.equal(
  sanitizeMotionKeyframes(pulse),
  `<motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ type: "tween" }}>`,
)

const wiggle = `<motion.div
  whileHover={{ scale: 1.04, rotate: [0, idx % 2 === 0 ? 2 : -2, 0] }}
  className="card"
>`
const wiggleFixed = sanitizeMotionKeyframes(wiggle)
assert.match(wiggleFixed, /type: "tween"/)
assert.match(wiggleFixed, /rotate: \[0, idx % 2/)

const hoverSpring = `<motion.div
  whileHover={{ scale: 1.07, rotate: -2 }}
  transition={{ type: "spring", stiffness: 220, damping: 15 }}
>`
assert.equal(sanitizeMotionKeyframes(hoverSpring), hoverSpring)

const cart = `<motion.div
  initial={{ x: "100%" }}
  animate={{ x: 0 }}
  exit={{ x: "100%" }}
  transition={{ type: "spring", stiffness: 180, damping: 19 }}
>`
assert.equal(sanitizeMotionKeyframes(cart), cart)

const durationOnly = `<motion.div animate={{ opacity: [0, 0.5, 1] }} transition={{ duration: 1.1 }}>`
assert.match(sanitizeMotionKeyframes(durationOnly), /type: "tween"/)

const ident = `<motion.div animate={{ scale: [1, 1.1, 1] }} transition={bounce}>`
assert.equal(
  sanitizeMotionKeyframes(ident),
  `<motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ ...bounce, type: "tween" }}>`,
)

const products = `const PRODUCTS = [{ flavorProfiles: ["TROPICAL", "SPICY", "CITRUS"] }]`
assert.equal(sanitizeMotionKeyframes(products), products)

const selfClose = `<motion.span animate={{ opacity: [0, 1, 0] }} />`
assert.equal(
  sanitizeMotionKeyframes(selfClose),
  `<motion.span animate={{ opacity: [0, 1, 0] }}  transition={{ type: "tween" }} />`,
)

console.log('motion-safe-check ok')
