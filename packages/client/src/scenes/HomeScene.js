import Phaser from 'phaser'
import { W, H, CONTENT_W } from '../config.js'
import { UIScene } from '../ui/UIScene.js'
import { DUR, EASE, dur, prefersReducedMotion } from '../ui/tokens.js'
import { store, xpForLevel } from '../store.js'
import { session, onSession, setDisplayName } from '../net/playfab.js'
import { sfx } from '../audio.js'
import { COLOR_HEX, COLOR_DARK, COLOR_SURFACE, BOARD_PALETTE, TRACK, HOME_LANES, YARDS, SAFE_STOPS, START_INDEX } from '@ludo/engine'
import { drawRestingDice } from '../ui/dice3d.js'
import { t, getLocale, setLocale, LOCALES, LOCALE_LABEL } from '../i18n.js'

const FREE_COINS_AMOUNT = 5000
const ELEMENTS = [
  { key: 'fire', color: COLOR_HEX.red },
  { key: 'water', color: COLOR_HEX.blue },
  { key: 'earth', color: COLOR_HEX.green },
  { key: 'air', color: COLOR_HEX.yellow },
]

export class HomeScene extends UIScene {
  constructor() {
    super('Home')
  }

  preload() {
    this.makeBackgroundTexture('bg-home', '#0b1526', '#17233d')
    ELEMENTS.forEach(({ key }) => {
      this.load.image(`hero-${key}`, `assets/sprites/pawn-${key}.png`)
      this.load.image(`hero-${key}-sm`, `assets/sprites/pawn-${key}-sm.png`)
      this.load.image(`rune-${key}`, `assets/sprites/rune-${key}.png`)
    })
  }

  create() {
    this._leaving = false
    this.homeLocale = getLocale()
    this.add.image(W / 2, H / 2, 'bg-home')
    this.createBackdrop()
    this.createTopPanel()
    this.createHero()
    this.createPlayButton()
    this.createSecondaryRow()
    this.createDailyStrip()
    this.createPowerLegend()
    this.createFooter()

    this.modalParts = null
    this.input.keyboard?.on('keydown-ESC', this.closeModal, this)
    this.events.once('shutdown', () => this.input.keyboard?.off('keydown-ESC', this.closeModal, this))
    this.enterScene()
    this.playEntrance()
  }

  // ---------- background ----------

  createBackdrop() {
    const g = this.add.graphics().setDepth(0)
    // Four elemental orbits frame the arena, baked into a single graphics object.
    ELEMENTS.forEach(({ color }, i) => {
      const x = [125, 570, 180, 548][i]
      const y = [325, 365, 530, 545][i]
      for (let r = 5; r > 0; r--) {
        g.fillStyle(color, .018).fillCircle(x, y, r * 28)
      }
    })
    g.lineStyle(1, 0x91b6d3, .12).strokeEllipse(W / 2, 439, 614, 316)
    g.lineStyle(1, 0x91b6d3, .06).strokeEllipse(W / 2, 439, 658, 368)
    // Soft concentric washes add depth without competing with the characters.
    for (let i = 6; i > 0; i--) {
      g.fillStyle(0x54b5bc, .012)
      g.fillCircle(W / 2, 410, 100 + i * 38)
    }
    ELEMENTS.forEach(({ color }, i) => {
      g.fillStyle(color, .75)
      g.fillCircle(290 + i * 46, 1232, 3)
    })
  }

  createTopPanel() {
    this.topPanel = this.add.container(W / 2, 66).setDepth(6)
    this.topPanel.add(this.add.circle(-290, 0, 29, 0x283654))
    this.topPanel.add(this.add.image(-290, 24, 'hero-water-sm').setOrigin(.5, 1).setScale(57 / 120))
    this.topPanel.add(this.add.text(-246, -14, t('home.level', { n: store.level }), {
      fontFamily: 'Verdana, sans-serif', fontSize: 17, color: '#f5f7fc', fontStyle: 'bold',
    }))
    const pct = Phaser.Math.Clamp(store.xp / xpForLevel(store.level), 0, 1)
    this.topPanel.add(this.add.rectangle(-246, 19, 140, 5, 0x34314e).setOrigin(0, .5))
    this.topPanel.add(this.add.rectangle(-246, 19, Math.max(2, 140 * pct), 5, COLOR_HEX.green).setOrigin(0, .5))
    this.topPanel.add(this.add.text(-94, 19, `${Math.round(store.xp)}/${xpForLevel(store.level)}`, {
      fontFamily: 'Verdana, sans-serif', fontSize: 10, color: '#a6a7bf',
    }).setOrigin(0, .5))
    this.makeRoundedRectTexture('home-wallet-v3', 194, 56, 0x263a4e, 0x192b3f, 20)
    this.topPanel.add(this.add.image(226, 0, 'home-wallet-v3'))
    this.topPanel.add(this.add.circle(157, 0, 14, COLOR_HEX.yellow))
    this.topPanel.add(this.add.text(157, -1, '★', { fontSize: 13, color: '#87540d' }).setOrigin(.5))
    this.coinLabel = this.add.text(182, 0, store.coins.toLocaleString(), {
      fontFamily: 'Verdana, sans-serif', fontSize: 19, color: '#ffe4a1', fontStyle: 'bold',
    }).setOrigin(0, .5)
    this.topPanel.add(this.coinLabel)

    // PlayFab identity: name under the avatar, tap the avatar to rename.
    this.nameLabel = this.add.text(-290, 44, this.playerLabel(), {
      fontFamily: 'Verdana, sans-serif', fontSize: 10, color: '#b9a9ef', align: 'center',
    }).setOrigin(0.5, 0)
    this.topPanel.add(this.nameLabel)
    this.makeHitZone(W / 2 - 290, 62, 74, 96).setDepth(7)
      .on('pointerup', () => this.promptRename())
    this._unsubSession = onSession(() => this.nameLabel?.setText(this.playerLabel()))
    this.events.once('shutdown', () => this._unsubSession?.())
  }

  playerLabel() {
    if (!session.enabled) return ''
    if (!session.ready) return '…'
    return session.displayName || t('home.setName')
  }

  promptRename() {
    sfx.tap()
    this.openTextInput({
      title: t('home.namePrompt'), value: session.displayName || '', maxLength: 25,
      submit: t('common.done'),
      onSubmit: async next => {
        const name = await setDisplayName(next)
        this.showToast(t('home.nameSaved', { name }))
      },
    })
  }

  createHero() {
    this.wordmark = this.add.container(W / 2, 150).setDepth(5)
    this.wordmark.add(this.add.text(0, 0, 'E L E M E N T A L', {
      fontFamily: 'Verdana, sans-serif', fontSize: 17, color: '#93b2c9', fontStyle: 'bold',
    }).setOrigin(.5))
    ;['L', 'U', 'D', 'O'].forEach((letter, i) => {
      const colors = [COLOR_HEX.red, COLOR_HEX.green, COLOR_HEX.blue, COLOR_HEX.yellow]
      this.wordmark.add(this.add.text(-108 + i * 72, 57, letter, {
        fontFamily: 'Verdana, sans-serif', fontSize: 96,
        color: `#${colors[i].toString(16).padStart(6, '0')}`, fontStyle: 'bold',
      }).setOrigin(.5).setShadow(0, 5, '#090b22', 0, true, true))
    })
    this.wordmark.add(this.add.text(0, 121, t('home.tagline'), {
      fontFamily: 'Verdana, sans-serif', fontSize: 16, color: '#c0bbd5',
    }).setOrigin(.5))

    // Miniature of the actual board, using the same paths and palette.
    const board = this.add.graphics().setPosition(W / 2, 450).setScale(1.65, .72).setAngle(-10).setDepth(2)
    const cell = 16
    board.fillStyle(0x080c22, .5).fillRoundedRect(-134, -119, 268, 268, 18)
    board.fillStyle(0xe4e9f4, 1).fillRoundedRect(-132, -132, 264, 264, 18)
    board.fillStyle(BOARD_PALETTE.track, 1).fillRect(-120, -120, 240, 240)
    Object.entries(YARDS).forEach(([color, yard]) => {
      const [x, y] = yard.box.map(n => n * cell - 120)
      board.fillStyle(COLOR_HEX[color], 1).fillRect(x, y, cell * 6, cell * 6)
      board.fillStyle(COLOR_SURFACE[color], 1).fillRoundedRect(x + 16, y + 16, 64, 64, 7)
      for (const dx of [32, 64]) for (const dy of [32, 64]) {
        board.fillStyle(COLOR_HEX[color], .22).fillCircle(x + dx, y + dy, 7)
      }
    })
    const owners = Object.fromEntries(Object.entries(START_INDEX).map(([c, index]) => [index, c]))
    TRACK.forEach(([x, y], index) => {
      board.fillStyle(owners[index] ? COLOR_HEX[owners[index]] : SAFE_STOPS.has(index) ? BOARD_PALETTE.safe : BOARD_PALETTE.track)
      board.fillRect(x * cell - 120, y * cell - 120, cell, cell)
      board.lineStyle(.7, BOARD_PALETTE.grid, .55).strokeRect(x * cell - 120, y * cell - 120, cell, cell)
    })
    Object.entries(HOME_LANES).forEach(([color, cells]) => cells.forEach(([x, y]) => {
      board.fillStyle(COLOR_HEX[color]).fillRect(x * cell - 120, y * cell - 120, cell, cell)
      board.lineStyle(.7, COLOR_DARK[color], .4).strokeRect(x * cell - 120, y * cell - 120, cell, cell)
    }))
    board.fillStyle(COLOR_HEX.red).fillTriangle(-24, -24, 0, 0, -24, 24)
    board.fillStyle(COLOR_HEX.green).fillTriangle(-24, -24, 24, -24, 0, 0)
    board.fillStyle(COLOR_HEX.yellow).fillTriangle(24, -24, 24, 24, 0, 0)
    board.fillStyle(COLOR_HEX.blue).fillTriangle(-24, 24, 24, 24, 0, 0)

    this.heroChars = []
    const poses = [[170, 478, .48], [298, 510, .64], [438, 497, .56], [556, 467, .45]]
    ELEMENTS.forEach(({ key, color }, i) => {
      const [x, baseline, scale] = poses[i]
      this.add.ellipse(x, baseline - 3, 65, 15, 0x0b1025, .35).setDepth(3)
      const img = this.add.image(x, baseline, `hero-${key}`).setOrigin(.5, 1).setScale(scale).setDepth(4)
      img.setData('homeY', baseline).setData('baseScale', scale)
      this.heroChars.push(img)
      this.add.circle(x + 25, baseline - 180, 3, color, .6).setDepth(3)
    })
    const heroDie = this.add.graphics().setPosition(589, 320).setAngle(12).setScale(.72).setDepth(4)
    drawRestingDice(heroDie, 5)
    this.add.text(W / 2, 602, t('home.modeHint'), {
      fontFamily: 'Verdana, sans-serif', fontSize: 14, color: '#b6b2cc',
    }).setOrigin(.5).setDepth(5)
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
    const y = 674
    const w = 648
    const h = 94
    this.makeRoundedRectTexture('home-play-v3', w, h, 0x22c48d, COLOR_HEX.green, 24)
    this.playBtn = this.add.container(W / 2, y).setDepth(8).setData('baseScale', 1)
    const shadow = this.add.graphics()
    shadow.fillStyle(0x071d22, .45).fillRoundedRect(-w / 2, -h / 2 + 8, w, h, 24)
    this.playBtn.add(shadow)
    this.playBtn.add(this.add.image(0, 0, 'home-play-v3'))
    const icon = this.add.graphics().setPosition(-263, 0).setScale(.6)
    drawRestingDice(icon, 6)
    this.playBtn.add(icon)
    this.playBtn.add(this.add.text(0, -1, t('home.play'), {
      fontFamily: 'Verdana, sans-serif', fontSize: 31, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(.5))
    this.playBtn.add(this.add.text(270, -1, '→', { fontFamily: 'Arial', fontSize: 32, color: '#e5fff4' }).setOrigin(.5))
    this.addPressFeedback(this.makeHitZone(W / 2, y, w, h).setDepth(8), this.playBtn, () => this.openGameSetup())
  }

  createSecondaryRow() {
    const y = 784
    const w = 314
    this.makeRoundedRectTexture('home-secondary-v3', w, 78, 0x21344c, 0x17263b, 20)
    const make = (x, icon, label, onClick) => {
      const c = this.add.container(x, y).setDepth(7).setData('baseScale', 1)
      c.add(this.add.image(0, 0, 'home-secondary-v3'))
      c.add(this.add.text(-w / 2 + 38, 0, icon, { fontFamily: 'Arial', fontSize: 25, color: '#a99cdb' }).setOrigin(.5))
      c.add(this.add.text(-w / 2 + 72, 0, label, {
        fontFamily: 'Verdana, sans-serif', fontSize: 17, color: '#f0edf8', fontStyle: 'bold',
      }).setOrigin(0, .5))
      c.add(this.add.text(w / 2 - 26, -1, '›', { fontFamily: 'Arial', fontSize: 28, color: '#8f87a9' }).setOrigin(.5))
      this.addPressFeedback(this.makeHitZone(x, y, w, 78).setDepth(7), c, onClick)
      return c
    }
    this.secButtons = [
      make(193, '⚙', t('home.settings'), () => this.openSettings()),
      make(527, '↗', t('home.stats'), () => this.openStats()),
    ]
  }

  createDailyStrip() {
    const y = 894
    const ready = store.freeCoinsReady()
    this.makeRoundedRectTexture('home-daily-v3', 648, 94, 0x273344, 0x192737, 22)
    this.dailyStrip = this.add.container(W / 2, y).setDepth(7).setData('baseScale', 1)
    this.dailyStrip.add(this.add.image(0, 0, 'home-daily-v3'))
    this.dailyStrip.add(this.add.circle(-271, 0, 24, 0x5b4535))
    this.dailyStrip.add(this.add.circle(-271, 0, 14, COLOR_HEX.yellow))
    this.dailyStrip.add(this.add.text(-271, -1, '★', { fontSize: 14, color: '#87540d' }).setOrigin(.5))
    this.dailyStrip.add(this.add.text(-230, -16, t('home.dailyTitle'), {
      fontFamily: 'Verdana, sans-serif', fontSize: 17, fontStyle: 'bold', color: '#fff0cd',
    }).setOrigin(0, .5))
    this.dailyText = this.add.text(-230, 13, '', {
      fontFamily: 'Verdana, sans-serif', fontSize: 12, color: '#c9bba8',
    }).setOrigin(0, .5)
    this.dailyStrip.add(this.dailyText)
    this.dailyAmount = this.add.text(290, 0, ready ? `+${FREE_COINS_AMOUNT.toLocaleString()}` : '◷', {
      fontFamily: 'Verdana, sans-serif', fontSize: ready ? 23 : 28, color: '#ffda70', fontStyle: 'bold',
    }).setOrigin(1, .5)
    this.dailyStrip.add(this.dailyAmount)
    this.refreshDaily()
    this.addPressFeedback(this.makeHitZone(W / 2, y, 648, 94).setDepth(7), this.dailyStrip, () => {
      if (!store.freeCoinsReady()) { this.showToast(t('home.dailyRecharge')); return }
      store.claimFreeCoins(FREE_COINS_AMOUNT)
      sfx.rune()
      this.countUp(this.coinLabel, store.coins, { format: n => Math.round(n).toLocaleString() })
      this.pulseOnce(this.coinLabel, { scale: 1.4 })
      this.showToast(t('home.coinsGained', { n: FREE_COINS_AMOUNT.toLocaleString() }))
      this.refreshDaily()
    })
    this.time.addEvent({ delay: 30000, loop: true, callback: () => this.refreshDaily() })
  }

  refreshDaily() {
    if (!this.dailyText) return
    this.dailyAmount?.setText(store.freeCoinsReady() ? `+${FREE_COINS_AMOUNT.toLocaleString()}` : '◷')
    if (store.freeCoinsReady()) {
      this.dailyText.setText(t('home.dailyClaim'))
      return
    }
    const ms = store.freeCoinsRemaining()
    const hrs = Math.floor(ms / 3600000)
    const mins = Math.floor((ms % 3600000) / 60000)
    this.dailyText.setText(t('home.dailyWait', { h: hrs, m: mins }))
  }

  // ---------- power legend (also serves as a mini how-to) ----------

  createPowerLegend() {
    this.legend = this.add.container(W / 2, 988).setDepth(6)
    this.legend.add(this.add.text(-324, 0, t('home.powersTitle'), {
      fontFamily: 'Verdana, sans-serif', fontSize: 12, color: '#a9a0c0', fontStyle: 'bold',
    }))
    const powers = ['home.powerFire', 'home.powerWater', 'home.powerEarth', 'home.powerAir']
    ELEMENTS.forEach(({ key, color }, i) => {
      const x = -246 + i * 164
      const panel = this.add.graphics()
      panel.fillStyle(color, .08).fillRoundedRect(x - 77, 33, 154, 133, 18)
      this.legend.add(panel)
      this.legend.add(this.add.image(x, 80, `rune-${key}`).setScale(62 / 240))
      this.legend.add(this.add.text(x, 128, t(powers[i]), {
        fontFamily: 'Verdana, sans-serif', fontSize: 12, color: '#d4cfe3', align: 'center',
        wordWrap: { width: 132 },
      }).setOrigin(.5))
    })
  }

  // ---------- footer ----------

  createFooter() {
    const st = store.stats
    const line = st.games
      ? t('home.record', { n: st.games, p: Math.round((st.wins / st.games) * 100), s: st.bestStreak })
      : t('home.firstMatch')
    this.footer = this.add.text(W / 2, 1196, line, {
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
    this.heroChars.forEach((img, i) => {
      img.setAlpha(0).setScale(img.getData('baseScale') * .8)
      this.tweens.add({
        targets: img, alpha: 1, scale: img.getData('baseScale'),
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
    const replacing = Boolean(this.modalParts)
    this.destroyModal()

    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x05060f, 0.72).setDepth(499)
    const dimZone = this.add.zone(W / 2, H / 2, W, H).setDepth(499).setInteractive()
    dimZone.on('pointerup', () => this.closeModal())

    const cardW = CONTENT_W - 6
    const key = `modal-card-${heightPx}`
    this.makeRoundedRectTexture(key, cardW, heightPx, 0x21344c, 0x101e31, 26, 0x3b5269)
    const card = this.add.container(W / 2, H / 2).setDepth(501)
    card.add(this.add.image(0, 0, key))
    ELEMENTS.forEach(({ color }, i) => {
      card.add(this.add.rectangle(-54 + i * 36, -heightPx / 2 + 12, 26, 3, color, .9))
    })
    card.add(this.add.zone(0, 0, cardW, heightPx).setInteractive())
    card.add(this.add.text(0, -heightPx / 2 + 40, title, {
      fontFamily: 'Verdana, sans-serif', fontSize: 28, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5))

    card.add(this.add.circle(cardW / 2 - 34, -heightPx / 2 + 34, 16, 0x0c1330, 0.7))
    card.add(this.add.text(cardW / 2 - 34, -heightPx / 2 + 33, '✕', {
      fontFamily: 'Verdana, sans-serif', fontSize: 16, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5))
    const closeZone = this.add.zone(cardW / 2 - 34, -heightPx / 2 + 34, 88, 88).setInteractive({ useHandCursor: true })
    closeZone.on('pointerup', () => this.closeModal())
    card.add(closeZone)

    if (!replacing) {
      card.setScale(.97).setAlpha(0)
      this.tweens.add({ targets: card, scale: 1, alpha: 1, duration: dur(180), ease: EASE.out })
    }

    this.modalParts = [dim, dimZone, card]
    return { card, cardW, cardH: heightPx }
  }

  destroyModal() {
    if (!this.modalParts) return
    this.modalParts.forEach((part) => { this.tweens.killTweensOf(part); part.destroy() })
    this.modalParts = null
  }

  closeModal() {
    this.destroyModal()
    if (getLocale() !== this.homeLocale) this.scene.restart()
  }

  modalChip(card, x, y, w, label, selected, onPick) {
    const key = `chip-${w}-${selected ? 'on' : 'off'}`
    this.makeRoundedRectTexture(
      key, w, 76,
      selected ? COLOR_HEX.blue : 0x23364c,
      selected ? COLOR_DARK.blue : 0x17263a,
      12,
      selected ? 0x7aafff : 0x3c526c
    )
    const visual = this.add.container(x, y).setData('baseScale', 1)
    card.add(visual)
    visual.add(this.add.image(0, 0, key))
    visual.add(this.add.text(0, 0, label, {
      fontFamily: 'Verdana, sans-serif', fontSize: 20, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5))
    const z = this.add.zone(x, y, w, 84).setInteractive({ useHandCursor: true })
    this.addPressFeedback(z, visual, () => { sfx.tap(); onPick() })
    card.add(z)
  }

  modalLabel(card, y, text) {
    card.add(this.add.text(0, y, text, {
      fontFamily: 'Verdana, sans-serif', fontSize: 18, color: '#9d8fd6', fontStyle: 'bold',
    }).setOrigin(0.5))
  }

  modalButton(card, x, y, w, label, primary, onClick) {
    const key = `modal-btn-${w}-${primary ? 'p' : 'g'}`
    this.makeRoundedRectTexture(
      key, w, 76,
      primary ? 0x22c48d : 0x23364c,
      primary ? COLOR_HEX.green : 0x17263a,
      15,
      primary ? 0x64dfad : 0x3c526c
    )
    const visual = this.add.container(x, y).setData('baseScale', 1)
    card.add(visual)
    visual.add(this.add.image(0, 0, key))
    visual.add(this.add.text(0, 0, label, {
      fontFamily: 'Verdana, sans-serif', fontSize: 22, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5))
    const z = this.add.zone(x, y, w, 84).setInteractive({ useHandCursor: true })
    this.addPressFeedback(z, visual, () => { sfx.tap(); onClick() })
    card.add(z)
  }

  // ---------- new game setup ----------

  openGameSetup(state) {
    const s = state || { opponents: 3, mode: 'cpu', difficulty: store.difficulty }
    const online = s.mode === 'online'
    const cardH = 620
    const { card } = this.buildModal(t('setup.title'), cardH)
    const T = -cardH / 2
    const reopen = () => this.openGameSetup({ ...s })

    this.modalLabel(card, T + 100, t('setup.playAgainst'))
    this.modalChip(card, -160, T + 150, 148, t('setup.computer'), s.mode === 'cpu', () => { s.mode = 'cpu'; reopen() })
    this.modalChip(card, 0, T + 150, 148, t('setup.local'), s.mode === 'local', () => { s.mode = 'local'; reopen() })
    this.modalChip(card, 160, T + 150, 148, t('setup.online'), online, () => { s.mode = 'online'; reopen() })

    if (online) {
      // Solo vs a bot on the real server - starts instantly, no lobby wait.
      this.modalButton(card, 0, T + 254, 300, t('net.quick'), true, () => {
        this.closeModal(); this.goTo('NetLudo', { mode: 'quick', maxPlayers: 4 })
      })
      this.modalButton(card, 0, T + 346, 300, t('net.solo'), false, () => {
        this.closeModal(); this.goTo('NetLudo', { mode: 'solo', maxPlayers: 2 })
      })
      this.modalButton(card, 0, T + 438, 300, t('net.create'), false, () => {
        this.closeModal(); this.goTo('NetLudo', { mode: 'create', maxPlayers: 2 })
      })
      this.modalButton(card, 0, T + 530, 300, t('net.joinCode'), false, () => {
        this.openTextInput({
          title: t('net.joinCode'), placeholder: '000000', maxLength: 6,
          numeric: true, submit: t('net.joinCode'),
          onSubmit: code => {
            if (!/^\d{6}$/.test(code)) throw new Error(t('net.codePrompt'))
            this.closeModal(); this.goTo('NetLudo', { mode: 'code', code })
          },
        })
      })
      return
    }

    this.modalLabel(card, T + 216, t('setup.opponents'))
    ;[1, 2, 3].forEach((n, i) => {
      this.modalChip(card, -96 + i * 96, T + 270, 80, `${n}`, s.opponents === n, () => { s.opponents = n; reopen() })
    })
    if (s.mode === 'cpu') {
      this.modalLabel(card, T + 338, t('setup.difficulty'))
      ;['easy', 'normal', 'hard'].forEach((d, i) => {
        this.modalChip(card, -116 + i * 116, T + 392, 108, t(`common.${d}`), s.difficulty === d, () => { s.difficulty = d; reopen() })
      })
    }

    this.modalButton(card, 0, cardH / 2 - 68, 300, t('setup.start'), true, () => {
      this.closeModal()
      const order = ['blue', 'green', 'yellow', 'red']
      const players = {}
      order.forEach((c, i) => {
        if (i === 0) players[c] = 'human'
        else if (i <= s.opponents) players[c] = s.mode === 'cpu' ? 'ai' : 'human'
        else players[c] = 'off'
      })
      if (s.mode === 'cpu') store.setSetting('difficulty', s.difficulty)
      this.goTo('Classic', { players, difficulty: s.difficulty })
    })
  }

  // ---------- settings ----------

  openSettings() {
    const cardH = 676
    const { card, cardW } = this.buildModal(t('settings.title'), cardH)
    const T = -cardH / 2
    const rowLabelX = -cardW / 2 + 44
    const reopen = () => this.openSettings()

    const toggleRow = (y, label, value, onOn, onOff) => {
      card.add(this.add.text(rowLabelX, y, label, {
        fontFamily: 'Verdana, sans-serif', fontSize: 20, color: '#e4dbff', fontStyle: 'bold',
      }).setOrigin(0, 0.5))
      this.modalChip(card, cardW / 2 - 128, y, 76, t('common.on'), value, onOn)
      this.modalChip(card, cardW / 2 - 46, y, 76, t('common.off'), !value, onOff)
    }

    toggleRow(T + 112, t('settings.sound'), store.sound,
      () => { store.setSetting('sound', true); sfx.tap(); reopen() },
      () => { store.setSetting('sound', false); reopen() })
    toggleRow(T + 198, t('settings.haptics'), store.haptics,
      () => { store.setSetting('haptics', true); sfx.buzz(20); reopen() },
      () => { store.setSetting('haptics', false); reopen() })

    this.modalLabel(card, T + 268, t('settings.language'))
    LOCALES.forEach((loc, i) => {
      this.modalChip(card, -60 + i * 120, T + 322, 108, LOCALE_LABEL[loc], getLocale() === loc, () => {
        setLocale(loc)
        reopen()
      })
    })

    this.modalLabel(card, T + 386, t('settings.difficulty'))
    ;['easy', 'normal', 'hard'].forEach((d, i) => {
      this.modalChip(card, -116 + i * 116, T + 442, 108, t(`common.${d}`), store.difficulty === d, () => {
        store.setSetting('difficulty', d)
        reopen()
      })
    })

    this.modalButton(card, 0, cardH / 2 - 138, 300, t('settings.reset'), false, () => {
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
    this.modalButton(card, 0, cardH / 2 - 52, 300, t('common.done'), true, () => this.closeModal())
  }

  // ---------- stats ----------

  openStats() {
    const cardH = 620
    const { card, cardW } = this.buildModal(t('stats.title'), cardH)
    const T = -cardH / 2
    const st = store.stats
    const winRate = st.games ? Math.round((st.wins / st.games) * 100) : 0
    card.add(this.add.text(0, T + 88, t('home.level', { n: store.level }), {
      fontFamily: 'Verdana, sans-serif', fontSize: 24, color: '#d7e7f5', fontStyle: 'bold',
    }).setOrigin(.5))
    const barW = cardW - 120
    const pct = Phaser.Math.Clamp(store.xp / xpForLevel(store.level), 0, 1)
    card.add(this.add.rectangle(0, T + 126, barW, 6, 0x0c192a))
    card.add(this.add.rectangle(-barW / 2, T + 126, Math.max(2, barW * pct), 6, 0x62e5ba).setOrigin(0, .5))
    card.add(this.add.text(0, T + 150, t('home.xpOf', { a: Math.round(store.xp), b: xpForLevel(store.level) }), {
      fontFamily: 'Verdana, sans-serif', fontSize: 16, color: '#9db6cb',
    }).setOrigin(.5))
    const stats = [
      [t('stats.matches'), st.games, COLOR_HEX.blue],
      [`${t('stats.wins')} · ${winRate}%`, st.wins, COLOR_HEX.green],
      [t('stats.captures'), st.captures, COLOR_HEX.red],
      [t('stats.streak'), st.bestStreak, COLOR_HEX.yellow],
    ]
    stats.forEach(([label, value, color], i) => {
      const x = i % 2 ? 146 : -146
      const y = T + 240 + Math.floor(i / 2) * 138
      const panel = this.add.graphics()
      panel.fillStyle(color, .08).fillRoundedRect(x - 134, y - 59, 268, 118, 18)
      panel.lineStyle(1, color, .28).strokeRoundedRect(x - 134, y - 59, 268, 118, 18)
      card.add(panel)
      card.add(this.add.text(x, y - 13, value.toLocaleString(), {
        fontFamily: 'Verdana, sans-serif', fontSize: 42, color: '#f2f7ff', fontStyle: 'bold',
      }).setOrigin(.5))
      card.add(this.add.text(x, y + 34, label, {
        fontFamily: 'Verdana, sans-serif', fontSize: 17, color: '#b8cede',
      }).setOrigin(.5))
    })
    card.add(this.add.text(0, T + 478, `★  ${store.coins.toLocaleString()}`, {
      fontFamily: 'Verdana, sans-serif', fontSize: 22, color: '#ffe3a0', fontStyle: 'bold',
    }).setOrigin(.5))
    this.modalButton(card, 0, T + 564, 300, t('common.done'), true, () => this.closeModal())
  }
}
