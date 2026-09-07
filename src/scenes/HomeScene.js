import Phaser from 'phaser'
import { W, H, CONTENT_W } from '../config.js'
import { UIScene } from '../ui/UIScene.js'
import { DUR, EASE, dur, prefersReducedMotion } from '../ui/tokens.js'
import { store, xpForLevel } from '../store.js'
import { sfx } from '../audio.js'
import { COLOR_HEX } from './board.js'
import { t, getLocale, setLocale, LOCALES, LOCALE_LABEL } from '../i18n.js'

const FREE_COINS_AMOUNT = 5000
const ELEMENTS = [
  { key: 'fire', color: 0xe94a42 },
  { key: 'water', color: 0x2f87e8 },
  { key: 'earth', color: 0x25bd5c },
  { key: 'air', color: 0xf0c433 },
]

export class HomeScene extends UIScene {
  constructor() {
    super('Home')
  }

  preload() {
    this.makeBackgroundTexture('bg-home', '#241a4a', '#7a45b4')
    ELEMENTS.forEach(({ key }) => {
      this.load.image(`hero-${key}`, `assets/sprites/pawn-${key}.png`)
      this.load.image(`hero-${key}-sm`, `assets/sprites/pawn-${key}-sm.png`)
      this.load.image(`rune-${key}`, `assets/sprites/rune-${key}.png`)
    })
  }

  create() {
    this.add.image(W / 2, H / 2, 'bg-home')
    this.createBackdrop()
    this.createTopPanel()
    this.createHero()
    this.createPlayButton()
    this.createSecondaryRow()
    this.createDailyStrip()
    this.createPowerLegend()
    this.createFooter()

    this.enterScene()
    this.playEntrance()
  }

  // ---------- background ----------

  createBackdrop() {
    const g = this.add.graphics().setDepth(0)
    g.fillStyle(0x080520, 0.28)
    g.fillRect(0, 0, W, H)
    g.fillStyle(0xffffff, 0.03)
    g.fillCircle(110, 240, 150)
    g.fillCircle(630, 1040, 190)

    // faint 4-colour pinwheel behind the hero
    const cx = W / 2
    const cy = 372
    const r = 220
    const quads = [
      [COLOR_HEX.red, 180, 270],
      [COLOR_HEX.green, 270, 360],
      [COLOR_HEX.yellow, 0, 90],
      [COLOR_HEX.blue, 90, 180],
    ]
    quads.forEach(([col, a0, a1]) => {
      const cg = this.add.graphics().setDepth(0)
      cg.fillStyle(col, 0.05)
      cg.slice(cx, cy, r, Phaser.Math.DegToRad(a0), Phaser.Math.DegToRad(a1))
      cg.fillPath()
    })
  }

  // ---------- top panel: avatar · level · xp · coins ----------

  createTopPanel() {
    const y = 52
    this.makeRoundedRectTexture('home-top', CONTENT_W, 78, 0x2a1e5c, 0x201646, 24, 0x5847a0)
    this.topPanel = this.add.container(W / 2, y).setDepth(6)
    this.topPanel.add(this.add.image(0, 0, 'home-top').setAlpha(0.97))

    const left = -CONTENT_W / 2
    // avatar
    this.topPanel.add(this.add.circle(left + 44, 0, 26, 0x1c1440).setStrokeStyle(3, 0x6f5cc4))
    this.topPanel.add(this.add.image(left + 44, 20, 'hero-water-sm').setOrigin(0.5, 1).setScale(52 / 120))

    // level + xp
    this.topPanel.add(this.add.text(left + 82, -14, t('home.level', { n: store.level }), {
      fontFamily: 'Verdana, sans-serif', fontSize: 15, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0, 0.5))
    const barW = 170
    const pct = Phaser.Math.Clamp(store.xp / xpForLevel(store.level), 0, 1)
    this.topPanel.add(this.add.rectangle(left + 82, 12, barW, 8, 0x120c30).setOrigin(0, 0.5).setStrokeStyle(1, 0x4a3d8f))
    const fill = this.add.rectangle(left + 82, 12, 1, 8, 0x7cffb2).setOrigin(0, 0.5)
    this.topPanel.add(fill)
    this.tweens.add({ targets: fill, width: Math.max(2, barW * pct), duration: dur(600), delay: dur(300), ease: EASE.out })
    this.topPanel.add(this.add.text(left + 82 + barW + 10, 12, `${Math.round(store.xp)}/${xpForLevel(store.level)}`, {
      fontFamily: 'Verdana, sans-serif', fontSize: 10, color: '#9d8fd6',
    }).setOrigin(0, 0.5))

    // coins
    const cRight = CONTENT_W / 2 - 20
    this.topPanel.add(this.add.circle(cRight - 96, 0, 14, 0xffcf3f).setStrokeStyle(2, 0xffe9a3))
    this.topPanel.add(this.add.text(cRight - 96, -1, '★', { fontSize: 14, color: '#8a5a00' }).setOrigin(0.5))
    this.coinLabel = this.add.text(cRight - 74, 0, store.coins.toLocaleString(), {
      fontFamily: 'Verdana, sans-serif', fontSize: 18, color: '#ffe27a', fontStyle: 'bold',
    }).setOrigin(0, 0.5)
    this.topPanel.add(this.coinLabel)
  }

  // ---------- hero ----------

  createHero() {
    this.wordmark = this.add.container(W / 2, 168).setDepth(5)
    this.wordmark.add(this.add.text(0, 0, 'INSTANT', {
      fontFamily: 'Verdana, sans-serif', fontSize: 40, color: '#ffd54d', fontStyle: 'bold',
    }).setOrigin(0.5, 1).setStroke('#3a1e00', 6))
    this.wordmark.add(this.add.text(0, 6, 'LUDO', {
      fontFamily: 'Verdana, sans-serif', fontSize: 64, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5, 0).setStroke('#241452', 8))
    this.wordmark.add(this.add.text(0, 84, t('home.tagline'), {
      fontFamily: 'Verdana, sans-serif', fontSize: 14, color: '#d6c8ff',
    }).setOrigin(0.5))

    // four element characters standing on one baseline
    this.heroChars = []
    const xs = [W / 2 - 204, W / 2 - 68, W / 2 + 68, W / 2 + 204]
    const baseline = 462
    ELEMENTS.forEach(({ key }, i) => {
      const img = this.add.image(xs[i], baseline, `hero-${key}`).setOrigin(0.5, 1).setScale(0.56).setDepth(4)
      img.setData('homeY', baseline)
      this.heroChars.push(img)
    })
  }

  startHeroIdle() {
    if (prefersReducedMotion) return
    this.heroChars.forEach((img, i) => {
      this.tweens.add({
        targets: img,
        y: img.getData('homeY') - 10,
        duration: 1400 + i * 160,
        yoyo: true,
        repeat: -1,
        ease: EASE.breathe,
        delay: i * 180,
      })
    })
  }

  // ---------- play ----------

  createPlayButton() {
    const y = 640
    const w = 344
    const h = 96
    this.makeRoundedRectTexture('home-play', w, h, 0x3ddc6b, 0x1f9d43, 22, 0xa9f6b4)
    this.playBtn = this.add.container(W / 2, y).setDepth(8).setData('baseScale', 1)
    this.playBtn.add(this.add.image(0, 5, 'home-play').setAlpha(0.28).setTint(0x000000)) // soft shadow
    this.playBtn.add(this.add.image(0, 0, 'home-play'))
    const playLabel = this.add.text(-14, 0, t('home.play'), {
      fontFamily: 'Verdana, sans-serif', fontSize: 34, color: '#08240f', fontStyle: 'bold',
    }).setOrigin(0.5)
    this.playBtn.add(playLabel)
    this.playBtn.add(this.add.text(playLabel.width / 2 + 26, 1, '▶', { fontSize: 30, color: '#08240f' }).setOrigin(0.5))

    const zone = this.makeHitZone(W / 2, y, w, h)
    this.addPressFeedback(zone, this.playBtn, () => this.openGameSetup())

    if (!prefersReducedMotion) {
      this.tweens.add({
        targets: this.playBtn, scale: 1.03, duration: 1100, yoyo: true, repeat: -1, ease: EASE.breathe,
      })
    }
  }

  // ---------- settings / stats ----------

  createSecondaryRow() {
    const y = 772
    const w = 168
    const gap = 16
    this.makeRoundedRectTexture('home-ghost', w, 62, 0x342a68, 0x281f52, 16, 0x5b4aa6)
    const make = (x, icon, label, onClick) => {
      const c = this.add.container(x, y).setDepth(7).setData('baseScale', 1)
      c.add(this.add.image(0, 0, 'home-ghost'))
      c.add(this.add.text(-w / 2 + 30, 0, icon, { fontSize: 22 }).setOrigin(0.5))
      c.add(this.add.text(6, 0, label, {
        fontFamily: 'Verdana, sans-serif', fontSize: 16, color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5))
      this.addPressFeedback(this.makeHitZone(x, y, w, 62), c, onClick)
      return c
    }
    this.secButtons = [
      make(W / 2 - w / 2 - gap / 2, '⚙', t('home.settings'), () => this.openSettings()),
      make(W / 2 + w / 2 + gap / 2, '📊', t('home.stats'), () => this.openStats()),
    ]
  }

  // ---------- daily bonus ----------

  createDailyStrip() {
    const y = 876
    const ready = store.freeCoinsReady()
    this.makeRoundedRectTexture(
      `home-daily-${ready ? 'on' : 'off'}`,
      CONTENT_W, 60,
      ready ? 0xffd85e : 0x2f2556,
      ready ? 0xffb020 : 0x241c46,
      20,
      ready ? 0xffe9a3 : 0x4a3d8f
    )
    this.dailyStrip = this.add.container(W / 2, y).setDepth(7).setData('baseScale', 1)
    this.dailyStrip.add(this.add.image(0, 0, `home-daily-${ready ? 'on' : 'off'}`))
    this.dailyStrip.add(this.add.text(-CONTENT_W / 2 + 34, 0, '🎁', { fontSize: 24 }).setOrigin(0.5))
    this.dailyText = this.add.text(-CONTENT_W / 2 + 62, 0, '', {
      fontFamily: 'Verdana, sans-serif', fontSize: 15,
      color: ready ? '#5a3d00' : '#c6b8ee', fontStyle: 'bold',
    }).setOrigin(0, 0.5)
    this.dailyStrip.add(this.dailyText)
    this.refreshDaily()

    this.addPressFeedback(this.makeHitZone(W / 2, y, CONTENT_W, 60), this.dailyStrip, () => {
      if (!store.freeCoinsReady()) {
        this.showToast(t('home.dailyRecharge'))
        return
      }
      store.claimFreeCoins(FREE_COINS_AMOUNT)
      sfx.rune()
      this.countUp(this.coinLabel, store.coins, { format: (n) => Math.round(n).toLocaleString() })
      this.pulseOnce(this.coinLabel, { scale: 1.4 })
      this.showToast(t('home.coinsGained', { n: FREE_COINS_AMOUNT.toLocaleString() }))
      this.time.delayedCall(300, () => this.scene.restart())
    })

    // keep the countdown fresh while the player lingers
    this.time.addEvent({ delay: 30000, loop: true, callback: () => this.refreshDaily() })
  }

  refreshDaily() {
    if (!this.dailyText) return
    if (store.freeCoinsReady()) {
      this.dailyText.setText(t('home.dailyReady', { n: FREE_COINS_AMOUNT.toLocaleString() }))
      return
    }
    const ms = store.freeCoinsRemaining()
    const hrs = Math.floor(ms / 3600000)
    const mins = Math.floor((ms % 3600000) / 60000)
    this.dailyText.setText(t('home.dailyWait', { h: hrs, m: mins }))
  }

  // ---------- power legend (also serves as a mini how-to) ----------

  createPowerLegend() {
    const y = 1040
    const h = 150
    this.makeRoundedRectTexture('home-legend', CONTENT_W, h, 0x241b4c, 0x1b1440, 20, 0x453a7e)
    this.legend = this.add.container(W / 2, y).setDepth(6)
    this.legend.add(this.add.image(0, 0, 'home-legend').setAlpha(0.9))
    this.legend.add(this.add.text(0, -h / 2 + 20, t('home.powersTitle'), {
      fontFamily: 'Verdana, sans-serif', fontSize: 11, color: '#9d8fd6', fontStyle: 'bold',
    }).setOrigin(0.5))

    const powers = [
      ['fire', t('home.powerFire')],
      ['water', t('home.powerWater')],
      ['earth', t('home.powerEarth')],
      ['air', t('home.powerAir')],
    ]
    powers.forEach(([key, desc], i) => {
      const col = i % 2
      const row = Math.floor(i / 2)
      const px = col === 0 ? -CONTENT_W / 2 + 34 : 24
      const py = -h / 2 + 58 + row * 44
      this.legend.add(this.add.image(px, py, `rune-${key}`).setScale(46 / 240).setOrigin(0.5))
      this.legend.add(this.add.text(px + 26, py, desc, {
        fontFamily: 'Verdana, sans-serif', fontSize: 13, color: '#d6c8ff',
      }).setOrigin(0, 0.5))
    })
  }

  // ---------- footer ----------

  createFooter() {
    const st = store.stats
    const line = st.games
      ? t('home.record', { n: st.games, p: Math.round((st.wins / st.games) * 100), s: st.bestStreak })
      : t('home.firstMatch')
    this.footer = this.add.text(W / 2, 1160, line, {
      fontFamily: 'Verdana, sans-serif', fontSize: 13, color: '#8f80c8',
    }).setOrigin(0.5).setDepth(6)
  }

  // ---------- entrance ----------

  playEntrance() {
    if (prefersReducedMotion) {
      this.startHeroIdle()
      return
    }
    this.slideIn(this.topPanel, { dy: -30, duration: DUR.entrance })
    this.popIn(this.wordmark, { from: 0.7, delay: 120, duration: DUR.slow })
    this.heroChars.forEach((img) => img.setData('baseScale', 0.56))
    this.heroChars.forEach((img, i) => {
      img.setAlpha(0).setScale(0.28)
      this.tweens.add({
        targets: img, alpha: 1, scale: 0.56,
        delay: dur(260 + i * 90), duration: dur(DUR.base), ease: EASE.pop,
      })
    })
    this.time.delayedCall(dur(260 + 4 * 90 + 240), () => this.startHeroIdle())
    this.slideIn(this.playBtn, { dy: 40, delay: 360, duration: DUR.slow })
    this.enterStagger(this.secButtons, { dy: 24, step: 70, delay: 500 })
    this.slideIn(this.dailyStrip, { dy: 20, delay: 620, duration: DUR.base })
    this.slideIn(this.legend, { dy: 20, delay: 700, duration: DUR.base })
    this.slideIn(this.footer, { dy: 12, delay: 780, duration: DUR.base })
  }

  formatCoins(n) {
    return n.toLocaleString('en-US')
  }

  // ---------- modal helpers ----------

  buildModal(title, heightPx) {
    this.destroyModal()

    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x05060f, 0.72).setDepth(499)
    const dimZone = this.add.zone(W / 2, H / 2, W, H).setDepth(499).setInteractive()
    dimZone.on('pointerup', () => this.closeModal())

    const cardW = CONTENT_W - 6
    const key = `modal-card-${heightPx}`
    this.makeRoundedRectTexture(key, cardW, heightPx, 0x2a1f52, 0x150d30, 26, 0x5a49a8)
    const card = this.add.container(W / 2, H / 2).setDepth(501)
    card.add(this.add.image(0, 0, key))
    card.add(this.add.zone(0, 0, cardW, heightPx).setInteractive())
    card.add(this.add.text(0, -heightPx / 2 + 40, title, {
      fontFamily: 'Verdana, sans-serif', fontSize: 23, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5))

    card.add(this.add.circle(cardW / 2 - 34, -heightPx / 2 + 34, 16, 0x0c1330, 0.7))
    card.add(this.add.text(cardW / 2 - 34, -heightPx / 2 + 33, '✕', {
      fontFamily: 'Verdana, sans-serif', fontSize: 16, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5))
    const closeZone = this.add.zone(cardW / 2 - 34, -heightPx / 2 + 34, 48, 48).setInteractive({ useHandCursor: true })
    closeZone.on('pointerup', () => this.closeModal())
    card.add(closeZone)

    card.setScale(0.85).setAlpha(0)
    this.tweens.add({ targets: card, scale: 1, alpha: 1, duration: dur(DUR.base), ease: EASE.pop })

    this.modalParts = [dim, dimZone, card]
    return { card, cardW, cardH: heightPx }
  }

  destroyModal() {
    if (!this.modalParts) return
    this.modalParts.forEach((part) => part.destroy())
    this.modalParts = null
  }

  closeModal() {
    this.destroyModal()
  }

  modalChip(card, x, y, w, label, selected, onPick) {
    const key = `chip-${w}-${selected ? 'on' : 'off'}`
    this.makeRoundedRectTexture(
      key, w, 46,
      selected ? 0x6d5ce0 : 0x2c2258,
      selected ? 0x5647c4 : 0x241d4c,
      12,
      selected ? 0xb9adff : 0x40356f
    )
    card.add(this.add.image(x, y, key))
    card.add(this.add.text(x, y, label, {
      fontFamily: 'Verdana, sans-serif', fontSize: 14, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5))
    const z = this.add.zone(x, y, w, 46).setInteractive({ useHandCursor: true })
    z.on('pointerup', () => { sfx.tap(); onPick() })
    card.add(z)
  }

  modalLabel(card, y, text) {
    card.add(this.add.text(0, y, text, {
      fontFamily: 'Verdana, sans-serif', fontSize: 12, color: '#9d8fd6', fontStyle: 'bold',
    }).setOrigin(0.5))
  }

  modalButton(card, x, y, w, label, primary, onClick) {
    const key = `modal-btn-${w}-${primary ? 'p' : 'g'}`
    this.makeRoundedRectTexture(
      key, w, 58,
      primary ? 0x34c759 : 0x3a2c66,
      primary ? 0x1f9d43 : 0x2a2050,
      15,
      primary ? 0x9affc0 : 0x6a5aa8
    )
    card.add(this.add.image(x, y, key))
    card.add(this.add.text(x, y, label, {
      fontFamily: 'Verdana, sans-serif', fontSize: 18, color: primary ? '#08240f' : '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5))
    const z = this.add.zone(x, y, w, 58).setInteractive({ useHandCursor: true })
    z.on('pointerup', () => { sfx.tap(); onClick() })
    card.add(z)
  }

  // ---------- new game setup ----------

  openGameSetup(state) {
    const s = state || { opponents: 3, mode: 'cpu', difficulty: store.difficulty }
    const cardH = 430
    const { card } = this.buildModal(t('setup.title'), cardH)
    const T = -cardH / 2
    const reopen = () => this.openGameSetup({ ...s })

    this.modalLabel(card, T + 84, t('setup.opponents'))
    ;[1, 2, 3].forEach((n, i) => {
      this.modalChip(card, -96 + i * 96, T + 118, 80, `${n}`, s.opponents === n, () => {
        s.opponents = n
        reopen()
      })
    })

    this.modalLabel(card, T + 172, t('setup.playAgainst'))
    this.modalChip(card, -84, T + 206, 156, t('setup.computer'), s.mode === 'cpu', () => { s.mode = 'cpu'; reopen() })
    this.modalChip(card, 84, T + 206, 156, t('setup.local'), s.mode === 'local', () => { s.mode = 'local'; reopen() })

    if (s.mode === 'cpu') {
      this.modalLabel(card, T + 260, t('setup.difficulty'))
      ;['easy', 'normal', 'hard'].forEach((d, i) => {
        this.modalChip(card, -116 + i * 116, T + 294, 108, t(`common.${d}`), s.difficulty === d, () => {
          s.difficulty = d
          reopen()
        })
      })
    }

    this.modalButton(card, 0, cardH / 2 - 46, 300, t('setup.start'), true, () => {
      const order = ['blue', 'green', 'yellow', 'red']
      const players = {}
      order.forEach((c, i) => {
        if (i === 0) players[c] = 'human'
        else if (i <= s.opponents) players[c] = s.mode === 'cpu' ? 'ai' : 'human'
        else players[c] = 'off'
      })
      if (s.mode === 'cpu') store.setSetting('difficulty', s.difficulty)
      this.closeModal()
      this.goTo('Classic', { players, difficulty: s.difficulty })
    })
  }

  // ---------- settings ----------

  openSettings() {
    const cardH = 476
    const { card, cardW } = this.buildModal(t('settings.title'), cardH)
    const T = -cardH / 2
    const rowLabelX = -cardW / 2 + 44
    const reopen = () => this.openSettings()

    const toggleRow = (y, label, value, onOn, onOff) => {
      card.add(this.add.text(rowLabelX, y, label, {
        fontFamily: 'Verdana, sans-serif', fontSize: 14, color: '#e4dbff', fontStyle: 'bold',
      }).setOrigin(0, 0.5))
      this.modalChip(card, cardW / 2 - 128, y, 76, t('common.on'), value, onOn)
      this.modalChip(card, cardW / 2 - 46, y, 76, t('common.off'), !value, onOff)
    }

    toggleRow(T + 76, t('settings.sound'), store.sound,
      () => { store.setSetting('sound', true); sfx.tap(); reopen() },
      () => { store.setSetting('sound', false); reopen() })
    toggleRow(T + 124, t('settings.haptics'), store.haptics,
      () => { store.setSetting('haptics', true); sfx.buzz(20); reopen() },
      () => { store.setSetting('haptics', false); reopen() })

    this.modalLabel(card, T + 176, t('settings.language'))
    LOCALES.forEach((loc, i) => {
      this.modalChip(card, -60 + i * 120, T + 210, 108, LOCALE_LABEL[loc], getLocale() === loc, () => {
        setLocale(loc)
        reopen()
      })
    })

    this.modalLabel(card, T + 264, t('settings.difficulty'))
    ;['easy', 'normal', 'hard'].forEach((d, i) => {
      this.modalChip(card, -116 + i * 116, T + 298, 108, t(`common.${d}`), store.difficulty === d, () => {
        store.setSetting('difficulty', d)
        reopen()
      })
    })

    this.modalButton(card, 0, cardH / 2 - 108, 300, t('settings.reset'), false, () => {
      if (this.confirmReset) {
        store.reset()
        this.closeModal()
        this.scene.restart()
        return
      }
      this.confirmReset = true
      this.showToast(t('settings.resetConfirm'))
      this.time.delayedCall(2500, () => { this.confirmReset = false })
    })
    this.modalButton(card, 0, cardH / 2 - 46, 300, t('common.done'), true, () => this.closeModal())
  }

  // ---------- stats ----------

  openStats() {
    const cardH = 452
    const { card, cardW } = this.buildModal(t('stats.title'), cardH)
    const T = -cardH / 2
    const st = store.stats
    const winRate = st.games ? Math.round((st.wins / st.games) * 100) : 0

    card.add(this.add.text(0, T + 82, t('home.level', { n: store.level }), {
      fontFamily: 'Verdana, sans-serif', fontSize: 26, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5))
    const barW = cardW - 120
    const pct = Phaser.Math.Clamp(store.xp / xpForLevel(store.level), 0, 1)
    card.add(this.add.rectangle(0, T + 116, barW, 10, 0x120c30).setStrokeStyle(1, 0x4a3d8f))
    card.add(this.add.rectangle(-barW / 2, T + 116, Math.max(2, barW * pct), 10, 0x7cffb2).setOrigin(0, 0.5))
    card.add(this.add.text(0, T + 136, t('home.xpOf', { a: Math.round(store.xp), b: xpForLevel(store.level) }), {
      fontFamily: 'Verdana, sans-serif', fontSize: 11, color: '#a99cd6',
    }).setOrigin(0.5))

    const rows = [
      [t('stats.matches'), `${st.games}`],
      [t('stats.wins'), `${st.wins}  (${winRate}%)`],
      [t('stats.captures'), `${st.captures}`],
      [t('stats.streak'), `${st.bestStreak}`],
      [t('stats.coins'), store.coins.toLocaleString()],
    ]
    this.makeRoundedRectTexture('stats-row', cardW - 64, 40, 0x33265f, 0x2a1f52, 10)
    rows.forEach(([k, v], i) => {
      const y = T + 176 + i * 46
      card.add(this.add.image(0, y, 'stats-row'))
      card.add(this.add.text(-cardW / 2 + 44, y, k, {
        fontFamily: 'Verdana, sans-serif', fontSize: 13, color: '#c9bdf2',
      }).setOrigin(0, 0.5))
      card.add(this.add.text(cardW / 2 - 44, y, v, {
        fontFamily: 'Verdana, sans-serif', fontSize: 14, color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(1, 0.5))
    })

    this.modalButton(card, 0, cardH / 2 - 46, 300, t('common.done'), true, () => this.closeModal())
  }
}
