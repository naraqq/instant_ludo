import Phaser from 'phaser'
import { W, H, CONTENT_W } from '../config.js'
import { UIScene } from '../ui/UIScene.js'
import { DUR, EASE, dur, prefersReducedMotion } from '../ui/tokens.js'
import { store, xpForLevel } from '../store.js'
import { session, onSession, setDisplayName } from '../net/playfab.js'
import { sfx } from '../audio.js'
import { COLOR_HEX } from '@ludo/engine'
import { drawRestingDice } from '../ui/dice3d.js'
import { buildBoardCanvas } from './classic/boardArt.js'
import { powerRuneTexture, bonusRuneTexture, POWER_META } from './classic/powers.js'
import { t, getLocale, setLocale, LOCALES, LOCALE_LABEL } from '../i18n.js'

const FREE_COINS_AMOUNT = 5000
const GAME_FONT = '"Arial Rounded MT Bold", "Trebuchet MS", Arial, sans-serif'
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
    this.makeBackgroundTexture('bg-home-candy', '#203665', '#09142d', { stars: false })
    ELEMENTS.forEach(({ key }) => {
      if (!this.textures.exists(`hero-${key}`)) this.load.image(`hero-${key}`, `assets/sprites/pawn-${key}.png`)
      if (!this.textures.exists(`hero-${key}-sm`)) this.load.image(`hero-${key}-sm`, `assets/sprites/pawn-${key}-sm.png`)
      if (!this.textures.exists(`rune-${key}`)) this.load.image(`rune-${key}`, `assets/sprites/rune-${key}.png`)
    })
  }

  create() {
    this._leaving = false
    this.homeLocale = getLocale()
    const bg = this.add.image(W / 2, H / 2, 'bg-home-candy')
    this.createBackdrop()
    this.createTopPanel()
    this.createHero()
    this.createPlayButton()
    this.createSecondaryRow()
    this.createDailyStrip()
    this.createPowerLegend()
    this.createFooter()

    // Fit the 1280-tall layout to the real canvas (centre when taller, scale
    // down when shorter). Modals, added later, stay at the true centre.
    this.fitDesignRoot(bg)

    this.modalParts = null
    this.input.keyboard?.on('keydown-ESC', this.closeModal, this)
    this.events.once('shutdown', () => this.input.keyboard?.off('keydown-ESC', this.closeModal, this))
    this.enterScene()
    this.playEntrance()
  }

  // ---------- background ----------

  createBackdrop() {
    const g = this.add.graphics().setDepth(0)
    // Broad, soft shapes give the menu the depth of a modern mobile-game lobby.
    g.fillStyle(0x4a66ad, .10).fillCircle(W / 2, 340, 390)
    g.fillStyle(0x6a49a8, .07).fillCircle(90, 770, 280)
    g.fillStyle(0x24b9ae, .06).fillCircle(690, 930, 320)
    ELEMENTS.forEach(({ color }, i) => {
      const x = [125, 570, 180, 548][i]
      const y = [325, 365, 530, 545][i]
      for (let r = 5; r > 0; r--) {
        g.fillStyle(color, .018).fillCircle(x, y, r * 28)
      }
    })
    g.lineStyle(2, 0xa9c8ff, .10).strokeEllipse(W / 2, 439, 614, 316)
    g.lineStyle(2, 0xa9c8ff, .05).strokeEllipse(W / 2, 439, 658, 368)
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
    this.topPanel.add(this.add.circle(-290, 2, 34, 0x071b4a))
    this.topPanel.add(this.add.circle(-290, -2, 32, 0x168dff).setStrokeStyle(3, 0x64caff))
    this.topPanel.add(this.add.image(-290, 24, 'hero-water-sm').setOrigin(.5, 1).setScale(57 / 120))
    this.topPanel.add(this.add.text(-246, -14, t('home.level', { n: store.level }), {
      fontFamily: GAME_FONT, fontSize: 18, color: '#ffffff', fontStyle: 'bold',
      stroke: '#0b1735', strokeThickness: 4,
    }))
    const pct = Phaser.Math.Clamp(store.xp / xpForLevel(store.level), 0, 1)
    this.topPanel.add(this.add.rectangle(-246, 20, 144, 12, 0x07162f).setOrigin(0, .5).setStrokeStyle(2, 0x376aa6))
    this.topPanel.add(this.add.rectangle(-244, 20, Math.max(3, 140 * pct), 7, 0x70ef22).setOrigin(0, .5))
    this.topPanel.add(this.add.text(-94, 19, `${Math.round(store.xp)}/${xpForLevel(store.level)}`, {
      fontFamily: GAME_FONT, fontSize: 10, color: '#c9ddff', fontStyle: 'bold',
    }).setOrigin(0, .5))
    this.makeCandyTexture('home-wallet-candy', 194, 60, 0x7754dc, 0x382584, 24, 0x1a1557)
    this.topPanel.add(this.add.image(226, 3, 'home-wallet-candy'))
    this.topPanel.add(this.add.circle(157, 1, 17, 0xff9a16).setStrokeStyle(3, 0xffdc43))
    this.topPanel.add(this.add.text(157, -1, '★', { fontFamily: GAME_FONT, fontSize: 15, color: '#fff4a0', stroke: '#b15c00', strokeThickness: 2 }).setOrigin(.5))
    this.coinLabel = this.add.text(182, 0, store.coins.toLocaleString(), {
      fontFamily: GAME_FONT, fontSize: 21, color: '#ffffff', fontStyle: 'bold', stroke: '#241258', strokeThickness: 3,
    }).setOrigin(0, .5)
    this.topPanel.add(this.coinLabel)

    // PlayFab identity: name under the avatar, tap the avatar to rename.
    this.nameLabel = this.add.text(-290, 44, this.playerLabel(), {
      fontFamily: GAME_FONT, fontSize: 11, color: '#bfe5ff', align: 'center', fontStyle: 'bold',
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
      fontFamily: GAME_FONT, fontSize: 18, color: '#bde8ff', fontStyle: 'bold',
      stroke: '#10224c', strokeThickness: 4,
    }).setOrigin(.5))
    ;['L', 'U', 'D', 'O'].forEach((letter, i) => {
      const colors = [COLOR_HEX.red, COLOR_HEX.green, COLOR_HEX.blue, COLOR_HEX.yellow]
      this.wordmark.add(this.add.text(-108 + i * 72, 57, letter, {
        fontFamily: GAME_FONT, fontSize: 100,
        color: `#${colors[i].toString(16).padStart(6, '0')}`, fontStyle: 'bold',
        stroke: '#ffffff', strokeThickness: 3,
      }).setOrigin(.5).setShadow(0, 8, '#091336', 4, true, true))
    })
    this.wordmark.add(this.add.text(0, 121, t('home.tagline'), {
      fontFamily: GAME_FONT, fontSize: 17, color: '#ffffff', fontStyle: 'bold', stroke: '#15234b', strokeThickness: 3,
    }).setOrigin(.5))

    // Miniature of the real board, tilted like a card the mascots stand on.
    if (!this.textures.exists('board-v2')) this.textures.addCanvas('board-v2', buildBoardCanvas())
    this.add.image(W / 2 + 8, 470, 'board-v2').setDisplaySize(280, 280).setAngle(-8)
      .setTint(0x000000).setAlpha(0.4).setDepth(1)
    this.add.image(W / 2, 458, 'board-v2').setDisplaySize(280, 280).setAngle(-8).setDepth(2)

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
      fontFamily: GAME_FONT, fontSize: 15, color: '#dceaff', fontStyle: 'bold', stroke: '#0b1835', strokeThickness: 3,
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
    this.makeCandyTexture('home-play-candy', w, h, 0x8cf70c, 0x20c900, 34, 0x087c21)
    this.playBtn = this.add.container(W / 2, y).setDepth(8).setData('baseScale', 1)
    const shadow = this.add.graphics()
    shadow.fillStyle(0x04142c, .62).fillRoundedRect(-w / 2, -h / 2 + 11, w, h, 34)
    this.playBtn.add(shadow)
    this.playBtn.add(this.add.image(0, 0, 'home-play-candy'))
    const icon = this.add.graphics().setPosition(-263, 0).setScale(.6)
    drawRestingDice(icon, 6)
    this.playBtn.add(icon)
    this.playBtn.add(this.add.text(0, -1, t('home.play'), {
      fontFamily: GAME_FONT, fontSize: 34, color: '#ffffff', fontStyle: 'bold',
      stroke: '#168000', strokeThickness: 6,
    }).setOrigin(.5).setShadow(0, 3, '#0d7500', 0, true, true))
    this.playBtn.add(this.add.text(270, -1, '›', { fontFamily: GAME_FONT, fontSize: 45, color: '#ffffff', stroke: '#168000', strokeThickness: 4 }).setOrigin(.5))
    this.addPressFeedback(this.makeHitZone(W / 2, y, w, h).setDepth(8), this.playBtn, () => this.goTo('Setup'))
  }

  createSecondaryRow() {
    const y = 784
    const w = 314
    this.makeCandyTexture('home-secondary-candy', w, 78, 0x2498ff, 0x1163d5, 22, 0x083b91)
    const make = (x, icon, label, onClick) => {
      const c = this.add.container(x, y).setDepth(7).setData('baseScale', 1)
      c.add(this.add.image(0, 0, 'home-secondary-candy'))
      c.add(this.add.text(-w / 2 + 38, 0, icon, { fontFamily: GAME_FONT, fontSize: 25, color: '#e9f8ff', stroke: '#0752ae', strokeThickness: 3 }).setOrigin(.5))
      c.add(this.add.text(-w / 2 + 72, 0, label, {
        fontFamily: GAME_FONT, fontSize: 19, color: '#ffffff', fontStyle: 'bold', stroke: '#0752ae', strokeThickness: 3,
      }).setOrigin(0, .5))
      c.add(this.add.text(w / 2 - 26, -1, '›', { fontFamily: GAME_FONT, fontSize: 31, color: '#ffffff', stroke: '#0752ae', strokeThickness: 3 }).setOrigin(.5))
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
    this.makeCandyTexture('home-daily-candy', 648, 94, 0x8a49e8, 0x5121a9, 24, 0x2d126f)
    this.dailyStrip = this.add.container(W / 2, y).setDepth(7).setData('baseScale', 1)
    this.dailyStrip.add(this.add.image(0, 0, 'home-daily-candy'))
    this.dailyStrip.add(this.add.circle(-271, 0, 25, 0xff8b09).setStrokeStyle(3, 0xffdd3d))
    this.dailyStrip.add(this.add.text(-271, -1, '★', { fontFamily: GAME_FONT, fontSize: 16, color: '#fff6a5', stroke: '#b75800', strokeThickness: 2 }).setOrigin(.5))
    this.dailyStrip.add(this.add.text(-230, -16, t('home.dailyTitle'), {
      fontFamily: GAME_FONT, fontSize: 19, fontStyle: 'bold', color: '#ffffff', stroke: '#321071', strokeThickness: 3,
    }).setOrigin(0, .5))
    this.dailyText = this.add.text(-230, 13, '', {
      fontFamily: GAME_FONT, fontSize: 13, color: '#eadfff', fontStyle: 'bold',
    }).setOrigin(0, .5)
    this.dailyStrip.add(this.dailyText)
    this.dailyAmount = this.add.text(290, 0, ready ? `+${FREE_COINS_AMOUNT.toLocaleString()}` : '◷', {
      fontFamily: GAME_FONT, fontSize: ready ? 25 : 28, color: '#fff45a', fontStyle: 'bold', stroke: '#963d00', strokeThickness: 4,
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
      fontFamily: GAME_FONT, fontSize: 14, color: '#ffffff', fontStyle: 'bold', stroke: '#101d40', strokeThickness: 3,
    }))
    const items = [
      { key: 'fire', tex: powerRuneTexture(this, 'fire'), name: POWER_META.fire.name, blurb: POWER_META.fire.blurb },
      { key: 'water', tex: powerRuneTexture(this, 'water'), name: POWER_META.water.name, blurb: POWER_META.water.blurb },
      { key: 'earth', tex: powerRuneTexture(this, 'earth'), name: POWER_META.earth.name, blurb: POWER_META.earth.blurb },
      { key: 'air', tex: bonusRuneTexture(this), name: 'EXTRA ROLL', blurb: t('home.powerAir') },
    ]
    items.forEach(({ tex, name, blurb }, i) => {
      const x = -246 + i * 164
      const tops = [0xd85b50, 0x3696ef, 0x34b39c, 0xc99a35]
      const colors = [0xb43831, 0x126ac8, 0x168b75, 0x9a6b13]
      const edges = [0x6e1d23, 0x083b87, 0x075447, 0x604009]
      const texture = `home-power-card-${i}`
      this.makeCandyTexture(texture, 154, 150, tops[i], colors[i], 20, edges[i])
      this.legend.add(this.add.image(x, 101, texture))
      this.legend.add(this.add.image(x, 72, tex).setDisplaySize(52, 52))
      this.legend.add(this.add.text(x, 110, name, {
        fontFamily: GAME_FONT, fontSize: 13, color: '#ffffff', fontStyle: 'bold', stroke: '#152142', strokeThickness: 3,
      }).setOrigin(.5))
      this.legend.add(this.add.text(x, 142, blurb, {
        fontFamily: GAME_FONT, fontSize: 10, color: '#f1f6ff', align: 'center', fontStyle: 'bold',
        wordWrap: { width: 138 },
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
      fontFamily: GAME_FONT, fontSize: 14, color: '#bcd5ff', fontStyle: 'bold', stroke: '#0b1733', strokeThickness: 3,
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

    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x03091d, 0.78).setDepth(499)
    const dimZone = this.add.zone(W / 2, H / 2, W, H).setDepth(499).setInteractive()
    dimZone.on('pointerup', () => this.closeModal())

    const cardW = CONTENT_W - 6
    const key = `modal-card-${heightPx}`
    this.makeCandyTexture(key, cardW, heightPx, 0x3159a0, 0x142b5d, 32, 0x09183c)
    const card = this.add.container(W / 2, H / 2).setDepth(501)
    card.add(this.add.image(0, 0, key))
    card.add(this.add.rectangle(0, -heightPx / 2 + 10, cardW - 76, 5, 0x68bfff, .8))
    card.add(this.add.zone(0, 0, cardW, heightPx).setInteractive())
    card.add(this.add.text(0, -heightPx / 2 + 40, title, {
      fontFamily: GAME_FONT, fontSize: 31, color: '#fff352', fontStyle: 'bold',
      stroke: '#8e3d00', strokeThickness: 6,
    }).setOrigin(0.5).setShadow(0, 3, '#602100', 0, true, true))

    card.add(this.add.circle(cardW / 2 - 34, -heightPx / 2 + 34, 19, 0x0a1a45, .9).setStrokeStyle(2, 0x659de0))
    card.add(this.add.text(cardW / 2 - 34, -heightPx / 2 + 33, '✕', {
      fontFamily: GAME_FONT, fontSize: 17, color: '#ffffff', fontStyle: 'bold',
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
    const key = `candy-chip-${w}-${selected ? 'on' : 'off'}`
    this.makeCandyTexture(key, w, 76,
      selected ? 0x80ef13 : 0x3571bd,
      selected ? 0x22b905 : 0x193f83,
      17,
      selected ? 0x087321 : 0x0b285d)
    const visual = this.add.container(x, y).setData('baseScale', 1)
    card.add(visual)
    visual.add(this.add.image(0, 0, key))
    visual.add(this.add.text(0, 0, label, {
      fontFamily: GAME_FONT, fontSize: 20, color: '#ffffff', fontStyle: 'bold',
      stroke: selected ? '#177000' : '#102958', strokeThickness: 4,
    }).setOrigin(0.5))
    const z = this.add.zone(x, y, w, 84).setInteractive({ useHandCursor: true })
    this.addPressFeedback(z, visual, () => { sfx.tap(); onPick() })
    card.add(z)
  }

  modalLabel(card, y, text) {
    card.add(this.add.text(0, y, text, {
      fontFamily: GAME_FONT, fontSize: 18, color: '#bfeaff', fontStyle: 'bold', stroke: '#122654', strokeThickness: 3,
    }).setOrigin(0.5))
  }

  modalButton(card, x, y, w, label, primary, onClick) {
    const key = `candy-modal-btn-${w}-${primary ? 'p' : 'g'}`
    this.makeCandyTexture(key, w, 76,
      primary ? 0x85f20d : 0x28a4ff,
      primary ? 0x20c303 : 0x1268d6,
      20,
      primary ? 0x08791c : 0x073b8e)
    const visual = this.add.container(x, y).setData('baseScale', 1)
    card.add(visual)
    visual.add(this.add.image(0, 0, key))
    visual.add(this.add.text(0, 0, label, {
      fontFamily: GAME_FONT, fontSize: 22, color: '#ffffff', fontStyle: 'bold',
      stroke: primary ? '#167600' : '#084b9d', strokeThickness: 4,
    }).setOrigin(0.5))
    const z = this.add.zone(x, y, w, 84).setInteractive({ useHandCursor: true })
    this.addPressFeedback(z, visual, () => { sfx.tap(); onClick() })
    card.add(z)
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
        fontFamily: GAME_FONT, fontSize: 20, color: '#e4dbff', fontStyle: 'bold',
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
      fontFamily: GAME_FONT, fontSize: 24, color: '#d7e7f5', fontStyle: 'bold',
    }).setOrigin(.5))
    const barW = cardW - 120
    const pct = Phaser.Math.Clamp(store.xp / xpForLevel(store.level), 0, 1)
    card.add(this.add.rectangle(0, T + 126, barW, 14, 0x07162f).setStrokeStyle(2, 0x5590d2))
    card.add(this.add.rectangle(-barW / 2 + 3, T + 126, Math.max(3, (barW - 6) * pct), 8, 0x70ef22).setOrigin(0, .5))
    card.add(this.add.text(0, T + 150, t('home.xpOf', { a: Math.round(store.xp), b: xpForLevel(store.level) }), {
      fontFamily: GAME_FONT, fontSize: 16, color: '#9db6cb',
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
      panel.fillStyle(color, .22).fillRoundedRect(x - 134, y - 59, 268, 118, 21)
      panel.lineStyle(3, color, .72).strokeRoundedRect(x - 134, y - 59, 268, 118, 21)
      card.add(panel)
      card.add(this.add.text(x, y - 13, value.toLocaleString(), {
        fontFamily: GAME_FONT, fontSize: 42, color: '#ffffff', fontStyle: 'bold', stroke: '#11244d', strokeThickness: 4,
      }).setOrigin(.5))
      card.add(this.add.text(x, y + 34, label, {
        fontFamily: GAME_FONT, fontSize: 17, color: '#e5f1ff', fontStyle: 'bold',
      }).setOrigin(.5))
    })
    card.add(this.add.text(0, T + 478, `★  ${store.coins.toLocaleString()}`, {
      fontFamily: GAME_FONT, fontSize: 22, color: '#ffe3a0', fontStyle: 'bold',
    }).setOrigin(.5))
    this.modalButton(card, 0, T + 564, 300, t('common.done'), true, () => this.closeModal())
  }
}
