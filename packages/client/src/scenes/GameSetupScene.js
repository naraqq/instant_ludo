import Phaser from 'phaser'
import { W, H } from '../config.js'
import { UIScene } from '../ui/UIScene.js'
import { DUR, EASE, dur, prefersReducedMotion } from '../ui/tokens.js'
import { store } from '../store.js'
import { sfx } from '../audio.js'
import { t } from '../i18n.js'

const GAME_FONT = '"Arial Rounded MT Bold", "Trebuchet MS", Arial, sans-serif'

// Coin stakes offered by the bet stepper. The winner of the match takes the pot
// (client-side only for now); everyone else forfeits their entry.
const BET_TIERS = [100, 250, 500, 1000, 2000, 5000]
const winFor = (entry) => Math.round((entry * 1.9) / 10) * 10

// The screen the PLAY button opens: pick a player count, pick a stake, start an
// online match. "2v2 Team up" runs against the computer in the background so it
// never waits on a thin team queue.
export class GameSetupScene extends UIScene {
  constructor() {
    super('Setup')
  }

  preload() {
    this.makeBackgroundTexture('bg-home-candy', '#203665', '#09142d', { stars: false })
  }

  create() {
    this._leaving = false
    this.sel = '2p'
    this.betIdx = this.defaultBetIdx()
    this._chips = []

    const bg = this.add.image(W / 2, H / 2, 'bg-home-candy')
    this.createBackdrop()
    this.buildHeader()
    this.buildPlayers()
    this.buildBet()
    this.buildStart()
    this.buildFriends()
    this.refreshChips()
    this.refreshBet()

    // Fit the 1280-tall layout to the real canvas.
    this.fitDesignRoot(bg)

    this._esc = () => { if (!this._leaving) { sfx.tap(); this.goTo('Home') } }
    this.input.keyboard?.on('keydown-ESC', this._esc)
    this.events.once('shutdown', () => this.input.keyboard?.off('keydown-ESC', this._esc))
    this.enterScene()
    this.playEntrance()
  }

  // ---------- bet helpers ----------

  maxBetIdx() {
    let m = 0
    for (let i = 0; i < BET_TIERS.length; i++) if (BET_TIERS[i] <= store.coins) m = i
    return m
  }

  defaultBetIdx() {
    const max = this.maxBetIdx()
    const pref = BET_TIERS.indexOf(500)
    return Math.min(pref === -1 ? 0 : pref, max)
  }

  // ---------- backdrop ----------

  createBackdrop() {
    const g = this.add.graphics().setDepth(0)
    g.fillStyle(0x4a66ad, 0.1).fillCircle(W / 2, 300, 380)
    g.fillStyle(0x6a49a8, 0.08).fillCircle(90, 760, 300)
    g.fillStyle(0x24b9ae, 0.06).fillCircle(690, 980, 320)
  }

  // ---------- header ----------

  buildHeader() {
    const y = 72
    const c = this.add.container(0, y).setDepth(6)
    this.header = c

    this.makeRoundedRectTexture('setup-topbtn', 58, 58, 0x2b4a6b, 0x1a3450, 16, 0x5f86b8)
    const back = this.add.image(52, 0, 'setup-topbtn').setData('baseScale', 1)
    c.add(back)
    c.add(this.add.text(52, -3, '‹', {
      fontFamily: GAME_FONT, fontSize: 32, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5))
    c.add(this.add.text(96, -1, t('setup.header'), {
      fontFamily: GAME_FONT, fontSize: 26, color: '#bde8ff', fontStyle: 'bold',
      stroke: '#10224c', strokeThickness: 4,
    }).setOrigin(0, 0.5))
    const backZone = this.add.zone(52, 0, 70, 70).setInteractive({ useHandCursor: true })
    c.add(backZone)
    this.addPressFeedback(backZone, back, () => { sfx.tap(); this.goTo('Home') })

    this.makeCandyTexture('setup-wallet', 208, 62, 0x7754dc, 0x382584, 24, 0x1a1557)
    c.add(this.add.image(W - 120, 2, 'setup-wallet'))
    c.add(this.add.circle(W - 192, 0, 17, 0xff9a16).setStrokeStyle(3, 0xffdc43))
    c.add(this.add.text(W - 192, -2, '★', {
      fontFamily: GAME_FONT, fontSize: 15, color: '#fff4a0', stroke: '#b15c00', strokeThickness: 2,
    }).setOrigin(0.5))
    this.coinLabel = this.add.text(W - 168, -1, store.coins.toLocaleString(), {
      fontFamily: GAME_FONT, fontSize: 21, color: '#ffffff', fontStyle: 'bold',
      stroke: '#241258', strokeThickness: 3,
    }).setOrigin(0, 0.5)
    c.add(this.coinLabel)
  }

  // ---------- section panel ----------

  panel(cy, hPx, title) {
    const w = 664
    const key = `setup-panel-${hPx}`
    this.makeCandyTexture(key, w, hPx, 0x5578c4, 0x39549e, 28, 0x243c86)
    const c = this.add.container(W / 2, cy).setDepth(4).setData('baseScale', 1)
    c.add(this.add.image(0, 0, key))
    c.add(this.add.text(0, -hPx / 2 + 34, title, {
      fontFamily: GAME_FONT, fontSize: 22, color: '#ffffff', fontStyle: 'bold',
      stroke: '#1a2c63', strokeThickness: 4,
    }).setOrigin(0.5))
    return { c, w, h: hPx }
  }

  // ---------- select players ----------

  buildPlayers() {
    const { c } = this.panel(322, 228, t('setup.players'))
    this.playersPanel = c
    const chipW = 198
    const chipH = 128
    this.makeCandyTexture(`setup-chip-on-${chipW}`, chipW, chipH, 0x86ef1e, 0x27ba06, 20, 0x0b7a20)
    this.makeCandyTexture(`setup-chip-off-${chipW}`, chipW, chipH, 0x3f74c8, 0x2350a0, 20, 0x123a7e)

    const defs = [
      { key: '2p', big: '2', sub: t('setup.playersWord') },
      { key: '4p', big: '4', sub: t('setup.playersWord') },
      { key: '2v2', big: '2v2', sub: t('setup.teamUp') },
    ]
    const xs = [-224, 0, 224]
    defs.forEach((d, i) => {
      const chip = this.add.container(xs[i], 22).setData('baseScale', 1).setData('key', d.key)
      chip.add(this.add.image(0, 0, `setup-chip-off-${chipW}`).setName('bg'))
      chip.add(this.add.text(0, d.key === '2v2' ? -14 : -12, d.big, {
        fontFamily: GAME_FONT, fontSize: d.key === '2v2' ? 40 : 46, color: '#ffffff',
        fontStyle: 'bold', stroke: '#0f2a55', strokeThickness: 6,
      }).setOrigin(0.5))
      chip.add(this.add.text(0, 30, d.sub, {
        fontFamily: GAME_FONT, fontSize: 15, color: '#eaf3ff', fontStyle: 'bold',
      }).setOrigin(0.5))
      chip.add(this.add.circle(chipW / 2 - 22, -chipH / 2 + 22, 15, 0xffb020)
        .setStrokeStyle(3, 0xffe08a).setName('checkBg').setVisible(false))
      chip.add(this.add.text(chipW / 2 - 22, -chipH / 2 + 21, '✓', {
        fontFamily: GAME_FONT, fontSize: 15, color: '#5a2e00', fontStyle: 'bold',
      }).setOrigin(0.5).setName('checkTick').setVisible(false))
      c.add(chip)
      this._chips.push(chip)

      const z = this.add.zone(xs[i], 22, chipW, chipH).setInteractive({ useHandCursor: true })
      c.add(z)
      this.addPressFeedback(z, chip, () => {
        if (this.sel === d.key) return
        sfx.tap()
        this.sel = d.key
        this.refreshChips()
      })
    })
  }

  refreshChips() {
    this._chips.forEach((chip) => {
      const on = chip.getData('key') === this.sel
      const w = 198
      chip.getByName('bg').setTexture(`setup-chip-${on ? 'on' : 'off'}-${w}`)
      chip.getByName('checkBg').setVisible(on)
      chip.getByName('checkTick').setVisible(on)
      if (on && !prefersReducedMotion) this.pulseOnce(chip, { scale: 1.06 })
    })
  }

  // ---------- choose bet ----------

  buildBet() {
    const { c } = this.panel(586, 228, t('setup.bet'))
    this.betPanel = c

    const stepper = (x, glyph, delta) => {
      const btn = this.add.container(x, 18).setData('baseScale', 1)
      btn.add(this.add.circle(0, 0, 34, 0x2f8bff).setStrokeStyle(4, 0x7cc0ff))
      btn.add(this.add.circle(0, -4, 28, 0x53a2ff))
      btn.add(this.add.text(0, -3, glyph, {
        fontFamily: GAME_FONT, fontSize: 40, color: '#ffffff', fontStyle: 'bold',
        stroke: '#0c47a0', strokeThickness: 4,
      }).setOrigin(0.5))
      c.add(btn)
      const z = this.add.zone(x, 18, 82, 82).setInteractive({ useHandCursor: true })
      c.add(z)
      this.addPressFeedback(z, btn, () => this.stepBet(delta))
      return btn
    }
    this.minusBtn = stepper(-262, '−', -1)
    this.plusBtn = stepper(262, '+', 1)

    this.makeRoundedRectTexture('setup-bet-readout', 320, 128, 0x1c356a, 0x122549, 18, 0x3f63b0)
    this.betReadout = this.add.container(0, 18).setData('baseScale', 1)
    this.betReadout.add(this.add.image(0, 0, 'setup-bet-readout'))
    this.betReadout.add(this.add.text(-96, -26, `${t('setup.win')}:`, {
      fontFamily: GAME_FONT, fontSize: 19, color: '#cfe0ff', fontStyle: 'bold',
    }).setOrigin(0, 0.5))
    this.betReadout.add(this.add.text(-96, 26, `${t('setup.entry')}:`, {
      fontFamily: GAME_FONT, fontSize: 19, color: '#cfe0ff', fontStyle: 'bold',
    }).setOrigin(0, 0.5))
    this.betReadout.add(this.add.circle(28, -26, 13, 0xffb020).setStrokeStyle(2, 0xffe08a))
    this.betReadout.add(this.add.text(28, -27, '★', { fontFamily: GAME_FONT, fontSize: 12, color: '#5a2e00' }).setOrigin(0.5))
    this.betReadout.add(this.add.circle(28, 26, 13, 0xffb020).setStrokeStyle(2, 0xffe08a))
    this.betReadout.add(this.add.text(28, 25, '★', { fontFamily: GAME_FONT, fontSize: 12, color: '#5a2e00' }).setOrigin(0.5))
    this.winValue = this.add.text(52, -26, '', {
      fontFamily: GAME_FONT, fontSize: 26, color: '#8effa8', fontStyle: 'bold', stroke: '#0c3a1a', strokeThickness: 3,
    }).setOrigin(0, 0.5)
    this.entryValue = this.add.text(52, 26, '', {
      fontFamily: GAME_FONT, fontSize: 26, color: '#ffe27a', fontStyle: 'bold', stroke: '#5a3a00', strokeThickness: 3,
    }).setOrigin(0, 0.5)
    this.betReadout.add([this.winValue, this.entryValue])
    c.add(this.betReadout)
  }

  stepBet(delta) {
    const next = Phaser.Math.Clamp(this.betIdx + delta, 0, this.maxBetIdx())
    if (next === this.betIdx) { sfx.tap(); return }
    this.betIdx = next
    sfx.tap()
    this.refreshBet()
    this.pulseOnce(this.betReadout, { scale: 1.05 })
  }

  refreshBet() {
    const entry = BET_TIERS[this.betIdx]
    this.winValue.setText(winFor(entry).toLocaleString())
    this.entryValue.setText(entry.toLocaleString())
    this.minusBtn.setAlpha(this.betIdx <= 0 ? 0.4 : 1)
    this.plusBtn.setAlpha(this.betIdx >= this.maxBetIdx() ? 0.4 : 1)
  }

  // ---------- start ----------

  buildStart() {
    const y = 856
    const w = 404
    const h = 104
    this.makeCandyTexture('setup-start', w, h, 0xffd23f, 0xf0980f, 30, 0xb45f00)
    this.startBtn = this.add.container(W / 2, y).setDepth(8).setData('baseScale', 1)
    this.startBtn.add(this.add.image(0, 0, 'setup-start'))
    this.startBtn.add(this.add.text(0, -2, t('setup.start'), {
      fontFamily: GAME_FONT, fontSize: 38, color: '#ffffff', fontStyle: 'bold',
      stroke: '#a1550a', strokeThickness: 7,
    }).setOrigin(0.5).setShadow(0, 3, '#8a4700', 0, true, true))
    const z = this.add.zone(W / 2, y, w, h).setInteractive({ useHandCursor: true })
    this.addPressFeedback(z, this.startBtn, () => this.start())
  }

  start() {
    if (this._leaving) return
    const entry = BET_TIERS[this.betIdx]
    if (store.coins < entry) {
      sfx.buzz?.(30)
      this.showToast(t('setup.notEnough'))
      return
    }
    sfx.rune()
    store.addCoins(-entry)
    this.countUp(this.coinLabel, store.coins, { format: (n) => Math.round(n).toLocaleString() })

    const bet = { entry, win: winFor(entry) }
    // Every mode is a real server match that starts immediately with bots filling
    // the empty seats (`mode: 'solo'`) - no waiting on a matchmaking queue.
    // `serverDriven`: the board waits for the server on every action (no local
    // prediction) so it plays exactly like a real online match, on mobile too.
    const cfg = this.sel === '2v2'
      ? { mode: 'solo', maxPlayers: 4, teams: true }
      : { mode: 'solo', maxPlayers: this.sel === '4p' ? 4 : 2, teams: false }
    this.goTo('NetLudo', { ...cfg, bet, serverDriven: true })
  }

  // ---------- play with a friend ----------

  buildFriends() {
    const y = 1000
    const c = this.add.container(W / 2, y).setDepth(6)
    this.friends = c
    c.add(this.add.text(0, -30, t('setup.friends'), {
      fontFamily: GAME_FONT, fontSize: 15, color: '#a9c3e6', fontStyle: 'bold',
    }).setOrigin(0.5))

    const link = (x, label, onTap) => {
      const w = 210
      this.makeCandyTexture('setup-link', w, 62, 0x2f5ba8, 0x214389, 18, 0x123869)
      const btn = this.add.container(x, 14).setData('baseScale', 1)
      btn.add(this.add.image(0, 0, 'setup-link'))
      btn.add(this.add.text(0, -1, label, {
        fontFamily: GAME_FONT, fontSize: 18, color: '#eaf3ff', fontStyle: 'bold',
        stroke: '#123163', strokeThickness: 3,
      }).setOrigin(0.5))
      c.add(btn)
      const z = this.add.zone(x, 14, w, 66).setInteractive({ useHandCursor: true })
      c.add(z)
      this.addPressFeedback(z, btn, onTap)
    }
    link(-114, t('setup.createRoom'), () => {
      sfx.tap()
      this.goTo('NetLudo', { mode: 'create', maxPlayers: 2, teams: false })
    })
    link(114, t('setup.enterCode'), () => {
      sfx.tap()
      this.openTextInput({
        title: t('net.joinCode'), placeholder: '000000', maxLength: 6,
        numeric: true, submit: t('net.joinCode'),
        onSubmit: (code) => {
          if (!/^\d{6}$/.test(code)) throw new Error(t('net.codePrompt'))
          this.goTo('NetLudo', { mode: 'code', code })
        },
      })
    })
  }

  // ---------- entrance ----------

  playEntrance() {
    if (prefersReducedMotion) return
    this.slideIn(this.header, { dy: -24, duration: DUR.entrance })
    this.slideIn(this.playersPanel, { dy: 28, delay: 120, duration: DUR.slow })
    this.slideIn(this.betPanel, { dy: 28, delay: 220, duration: DUR.slow })
    this.slideIn(this.startBtn, { dy: 36, delay: 340, duration: DUR.slow })
    this.slideIn(this.friends, { dy: 16, delay: 460, duration: DUR.base })
  }
}
