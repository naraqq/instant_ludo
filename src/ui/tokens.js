// Design tokens: one source of truth for spacing, type, radius, motion and
// chrome colour. Screens should pull from here instead of hand-tuned magic
// numbers so sizing stays consistent as the UI grows.

// 4px base spacing scale
export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 }

// type ramp (px) - name by role, not size
export const FS = {
  micro: 11,
  small: 13,
  body: 15,
  label: 17,
  title: 22,
  display: 30,
  hero: 44,
}

// corner radii
export const RAD = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 }

// motion — a small, opinionated set. Everything animates in one of these.
export const DUR = { instant: 90, fast: 150, base: 240, slow: 360, entrance: 520 }
export const EASE = {
  out: 'Cubic.easeOut',
  inOut: 'Cubic.easeInOut',
  pop: 'Back.easeOut',
  settle: 'Back.easeOut', // alias
  bounce: 'Bounce.easeOut',
  breathe: 'Sine.easeInOut',
}

// UI chrome palette (player colours stay in board.js)
export const UI = {
  surface: 0x271c58,
  surfaceDeep: 0x1a1140,
  surfaceRaised: 0x3b2c78,
  stroke: 0x5545a6,
  strokeSoft: 0x4c3d94,
  textHi: '#f3ecff',
  textMid: '#c6b8ee',
  textLow: '#9184c6',
  accent: 0x34c759,
  gold: '#ffe27a',
}

// Honour the OS "reduce motion" setting: callers scale durations through dur()
// and skip decorative loops when prefersReducedMotion is true.
export const prefersReducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function dur(ms) {
  return prefersReducedMotion ? Math.min(ms, 80) : ms
}
