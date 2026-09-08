// A tiny seeded PRNG so the whole game is deterministic and replayable - the
// authoritative server owns the seed and never ships `rng` to clients, so rolls
// stay unpredictable. Functional style: every draw returns [value, nextRng].

// mulberry32 - one uint32 of state, good enough for dice and loot.
export function makeRng(seed) {
  return { s: (seed >>> 0) || 1 }
}

function next(rng) {
  let t = (rng.s + 0x6d2b79f5) >>> 0
  const nextState = { s: t }
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  return [value, nextState]
}

// integer in [min, max] inclusive
export function rngInt(rng, min, max) {
  const [v, r] = next(rng)
  return [min + Math.floor(v * (max - min + 1)), r]
}

// uniform pick from a non-empty array
export function rngPick(rng, arr) {
  const [i, r] = rngInt(rng, 0, arr.length - 1)
  return [arr[i], r]
}
