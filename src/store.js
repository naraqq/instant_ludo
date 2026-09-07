// Player progression + settings, persisted to localStorage.
// One module-level singleton so every scene reads the same live values.

const KEY = 'instant_ludo_save_v2'
const FREE_COINS_COOLDOWN = 20 * 60 * 60 * 1000 // 20h

const DEFAULTS = {
  coins: 200,
  level: 1,
  xp: 0,
  sound: true,
  haptics: true,
  difficulty: 'normal', // 'easy' | 'normal' | 'hard'
  locale: 'en', // 'en' | 'mn'
  lastFreeCoins: 0,
  stats: { games: 0, wins: 0, captures: 0, bestStreak: 0, streak: 0 },
}

// XP needed to advance *from* the given level to the next one.
export function xpForLevel(level) {
  return 180 + level * 30
}

function read() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS, stats: { ...DEFAULTS.stats } }
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULTS,
      ...parsed,
      stats: { ...DEFAULTS.stats, ...(parsed.stats || {}) },
    }
  } catch {
    return { ...DEFAULTS, stats: { ...DEFAULTS.stats } }
  }
}

class Store {
  constructor() {
    this.data = read()
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data))
    } catch {
      // Private mode / quota - progression just won't persist this session.
    }
  }

  get coins() { return this.data.coins }
  get level() { return this.data.level }
  get xp() { return this.data.xp }
  get sound() { return this.data.sound }
  get haptics() { return this.data.haptics }
  get difficulty() { return this.data.difficulty }
  get locale() { return this.data.locale }
  get stats() { return this.data.stats }

  setSetting(key, value) {
    this.data[key] = value
    this.save()
  }

  addCoins(amount) {
    this.data.coins = Math.max(0, this.data.coins + amount)
    this.save()
    return this.data.coins
  }

  // Returns how many levels were gained so the UI can celebrate.
  addXp(amount) {
    let gained = 0
    this.data.xp += amount
    while (this.data.xp >= xpForLevel(this.data.level)) {
      this.data.xp -= xpForLevel(this.data.level)
      this.data.level++
      gained++
    }
    this.save()
    return gained
  }

  recordGame({ won, captures }) {
    const s = this.data.stats
    s.games++
    s.captures += captures
    if (won) {
      s.wins++
      s.streak++
      s.bestStreak = Math.max(s.bestStreak, s.streak)
    } else {
      s.streak = 0
    }
    this.save()
  }

  freeCoinsReady() {
    return Date.now() - this.data.lastFreeCoins >= FREE_COINS_COOLDOWN
  }

  // ms until the next free-coins claim (0 when ready)
  freeCoinsRemaining() {
    return Math.max(0, this.data.lastFreeCoins + FREE_COINS_COOLDOWN - Date.now())
  }

  claimFreeCoins(amount) {
    this.data.lastFreeCoins = Date.now()
    return this.addCoins(amount)
  }

  reset() {
    this.data = { ...DEFAULTS, stats: { ...DEFAULTS.stats } }
    this.save()
  }
}

export const store = new Store()
