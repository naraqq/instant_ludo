import Phaser from 'phaser'
import { W, H, CONTENT_W } from '../config.js'
import { UIScene } from '../ui/UIScene.js'
import { DUR, EASE, dur, prefersReducedMotion } from '../ui/tokens.js'
import { sfx } from '../audio.js'
import { dicePose, drawDice, drawRestingDice } from '../ui/dice3d.js'
import { samplePawnPath } from '../ui/pawnMotion.js'
import { store } from '../store.js'
import { chooseAiMove, chooseAiPower, bestForcedDice } from '../ai.js'
import { t } from '../i18n.js'
import {
  COLORS,
  COLOR_HEX,
  COLOR_DARK,
  COLOR_LIGHT,
  COLOR_SURFACE,
  BOARD_PALETTE,
  PAWN_ASSETS,
  POWER_TYPES,
  SAFE_STOPS,
  START_INDEX,
  HOME_LANES,
  YARDS,
  TRACK,
} from './board.js'

// Board fills the screen width (15 tiles = 720px), leaving generous top and
// bottom strips for the (bigger) player profiles.
const TILE = 48
const BOARD_SIZE = TILE * 15
const BOARD_X = 0
const BOARD_Y = (H - BOARD_SIZE) / 2 // board centred vertically
const BOARD_BOTTOM = BOARD_Y + BOARD_SIZE
const TURN_SECONDS = 30

const BAR_Y = 1206 // bottom action bar

// House rules (tune freely)
const SIX_PITY_LIMIT = 3          // force a 6 after this many straight non-6 rolls, per player
const CAPTURE_GRANTS_CHARGE = true // landing on an opponent's pawn awards a power charge
const CAPTURE_CHARGE_POOL = ['fire', 'water', 'earth']
const POWER_SLOT_KEYS = ['fire', 'water', 'earth'] // buttons in the bottom bar (air auto-applies)

// Avatar profiles live in the strips above / below the board, not on it.
const POD_R = 36
const POD = {
  red: { ax: 78, ay: 116, dx: 196, dy: 120, dir: 'up' },
  green: { ax: W - 78, ay: 116, dx: W - 196, dy: 120, dir: 'up' },
  blue: { ax: 78, ay: BOARD_BOTTOM + 76, dx: 196, dy: BOARD_BOTTOM + 80, dir: 'down' },
  yellow: { ax: W - 78, ay: BOARD_BOTTOM + 76, dx: W - 196, dy: BOARD_BOTTOM + 80, dir: 'down' },
}

// track index of each colour's entry square (also a safe square)
const START_OWNER = Object.fromEntries(
  Object.entries(START_INDEX).map(([c, i]) => [i, c])
)

export class ClassicScene extends UIScene {
  constructor() {
    super('Classic')
    this.pawnViews = new Map()
    this.runeViews = new Map()
    this.activePawnZones = []
    this.shieldedColors = new Set()
    this.shieldExpiresOnOwnRoll = new Set()
  }

  // data: { players: { red:'human'|'ai'|'off', ... }, difficulty: 'easy'|'normal'|'hard' }
  init(data) {
    const players = data?.players
    if (players) {
      this.players = { ...players }
    } else {
      // No setup passed - default to solo vs three bots.
      this.players = { blue: 'human', red: 'ai', green: 'ai', yellow: 'ai' }
    }
    this.activeColors = COLORS.filter((c) => this.players[c] && this.players[c] !== 'off')
    if (this.activeColors.length < 2) {
      this.players = { blue: 'human', red: 'ai', green: 'ai', yellow: 'ai' }
      this.activeColors = [...COLORS]
    }
    // start the rotation on the human seat so you don't wait through three bots
    const firstHuman = this.activeColors.findIndex((c) => this.players[c] === 'human')
    if (firstHuman > 0) {
      this.activeColors = [
        ...this.activeColors.slice(firstHuman),
        ...this.activeColors.slice(0, firstHuman),
      ]
    }
    this.difficulty = data?.difficulty || store.difficulty
    // "You" (and rewards) only exist when playing against bots - pure local
    // hot-seat games are neutral and unranked.
    const hasBot = this.activeColors.some((c) => this.players[c] === 'ai')
    this.youColor = hasBot ? this.activeColors.find((c) => this.players[c] === 'human') || null : null
    this.lastConfig = { players: this.players, difficulty: this.difficulty }
  }

  get currentColor() {
    return this.activeColors[this.currentPlayer]
  }

  get powerBarColor() {
    // Solo games keep the human inventory visible throughout bot turns.
    // Local hot-seat games display the active player's inventory.
    return this.youColor ?? this.currentColor
  }

  advanceTurn() {
    this.currentPlayer = (this.currentPlayer + 1) % this.activeColors.length
  }

  isBot(color) {
    return this.players[color] === 'ai'
  }

  preload() {
    this.makeBackgroundTexture('bg-classic', '#35246f', '#4f3a9e')
    this.makeDiceTextures()
    this.makeElementalEffectTextures()
    // v2 art: pre-cropped, pre-transparent character + rune sprites
    Object.entries(PAWN_ASSETS).forEach(([color, asset]) => {
      this.load.image(`pawn-${color}`, `assets/sprites/pawn-${asset}.png`)
      this.load.image(`pawn-${color}-sm`, `assets/sprites/pawn-${asset}-sm.png`)
    })
    POWER_TYPES.forEach((type) => this.load.image(`rune-${type}`, `assets/sprites/rune-${type}.png`))
  }

  create() {
    this.currentPlayer = 0
    this.diceValue = 0
    this.rawDiceValue = 0
    this.forcedDiceValue = null
    this.doubleNextRoll = false
    this.extraRollNextTurn = false
    this.phase = 'roll'
    this.pawns = []
    this.pawnViews.clear()
    this.powerInventory = Object.fromEntries(
      COLORS.map((color) => [color, { fire: 0, water: 0, earth: 0 }])
    )
    this.powerRunes = []
    this.runeViews.clear()
    this.activePawnZones.forEach((zone) => zone.destroy())
    this.activePawnZones = []
    this.shieldedColors.clear()
    this.shieldExpiresOnOwnRoll.clear()
    this.finishOrder = []
    this.gameOver = false
    this.captureCounts = Object.fromEntries(COLORS.map((c) => [c, 0]))
    this.sixPity = Object.fromEntries(COLORS.map((c) => [c, 0]))
    this.sixForced = new Set()
    this.onRollResolved = null
    this.turnTimer = null
    this.turnSecondsLeft = TURN_SECONDS

    this.add.image(W / 2, H / 2, 'bg-classic')
    this.createBackdrop()
    this.createTopBar()
    this.createBoard()
    this.createPlayers()
    this.createBottomBar()
    this.createPawns()
    this.createPowerRunes()
    this.reflowPawns(false)
    this.refreshTurnUI()
    this.enterScene()
    this.playEntrance()
  }

  // Choreographed scene-in: board settles, pods drop in, bar rises, then play.
  playEntrance() {
    if (prefersReducedMotion) {
      this.time.delayedCall(120, () => this.beginTurn())
      return
    }

    const sprites = [...this.pawnViews.values(), ...this.runeViews.values()]
    sprites.forEach((v) => this.tweens.killTweensOf(v))
    sprites.forEach((v) => v.setAlpha(0))

    this.boardLayer.setAlpha(0).setScale(0.97)
    this.tweens.add({
      targets: this.boardLayer, alpha: 1, scale: 1,
      duration: dur(DUR.entrance), ease: EASE.out,
    })
    this.time.delayedCall(dur(180), () =>
      sprites.forEach((v) => this.tweens.add({ targets: v, alpha: 1, duration: dur(DUR.base) }))
    )

    const activePods = this.activeColors.map((c) => this.playerBadges[c])
    activePods.forEach((p, i) => {
      this.tweens.killTweensOf(p)
      p.setScale(0).setAlpha(0)
      this.tweens.add({
        targets: p,
        scale: 1,
        alpha: this.activeColors[i] === this.currentColor ? 1 : 0.62,
        delay: dur(240 + i * 70),
        duration: dur(DUR.base),
        ease: EASE.pop,
      })
    })

    // power buttons appear on their own as the player earns charges

    this.time.delayedCall(dur(720), () => {
      this.refreshTurnUI()
      this.beginTurn()
    })
  }

  createBackdrop() {
    const g = this.add.graphics()
    g.fillStyle(0x060b22, 0.18)
    g.fillRect(0, 0, W, H)
    g.fillStyle(0xffffff, 0.03)
    g.fillCircle(110, 150, 120)
    g.fillCircle(620, 1150, 140)
  }

  // Top strip: leave button on the left, coin count on the right.
  createTopBar() {
    const y = 46
    this.makeRoundedRectTexture('topbtn', 50, 50, 0x3b2c78, 0x2a1e5c, 15, 0x6a58b8)
    const back = this.add.image(44, y, 'topbtn').setDepth(6).setAlpha(0.96)
    this.add.text(44, y - 1, '‹', {
      fontFamily: 'Verdana, sans-serif', fontSize: 26, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(7)
    this.addPressFeedback(this.makeHitZone(44, y, 52, 52), back, () => {
      sfx.tap()
      if (this.gameOver) {
        this.goTo('Home')
        return
      }
      if (this._confirmLeave) {
        this.goTo('Home')
        return
      }
      this._confirmLeave = true
      this.showToast(t('classic.leaveConfirm'))
      this.time.delayedCall(2500, () => { this._confirmLeave = false })
    })

    this.makeRoundedRectTexture('coin-pill', 132, 46, 0x2a1e5c, 0x211748, 23, 0x6a58b8)
    const pillX = W - 44 - 66
    this.add.image(pillX, y, 'coin-pill').setDepth(6).setAlpha(0.96)
    this.add.circle(pillX - 42, y, 14, 0xffcf3f).setStrokeStyle(2, 0xffe9a3).setDepth(7)
    this.add.text(pillX - 42, y - 1, '★', { fontSize: 14, color: '#8a5a00' }).setOrigin(0.5).setDepth(8)
    this.coinText = this.add.text(pillX - 18, y - 1, store.coins.toLocaleString(), {
      fontFamily: 'Verdana, sans-serif', fontSize: 17, color: '#ffe27a', fontStyle: 'bold',
    }).setOrigin(0, 0.5).setDepth(8)
  }

  createBoard() {
    const boardSize = BOARD_SIZE
    this.boardLayer = this.add.container(0, 0).setDepth(2)
    this._boardExtras = []

    // full-bleed board: just soft edge accents top & bottom
    this.boardLayer.add([
      this.add.rectangle(W / 2, BOARD_Y - 3, W, 6, 0x000000, 0.32),
      this.add.rectangle(W / 2, BOARD_BOTTOM + 3, W, 6, 0x000000, 0.32),
      this.add.rectangle(W / 2, BOARD_Y + 1, W, 2, 0xffffff, 0.25),
    ])

    const g = this.add.graphics()
    g.fillStyle(0xffffff, 1)
    g.fillRect(BOARD_X, BOARD_Y, boardSize, boardSize)
    COLORS.forEach((color) => this.drawYard(g, color))
    TRACK.forEach(([gx, gy], i) => {
      const owner = START_OWNER[i]
      const fill = owner ? COLOR_HEX[owner] : SAFE_STOPS.has(i) ? BOARD_PALETTE.safe : BOARD_PALETTE.track
      this.drawSquare(g, gx, gy, fill, 1, null, { safe: SAFE_STOPS.has(i), owner })
    })
    Object.entries(HOME_LANES).forEach(([color, cells]) => {
      cells.forEach(([gx, gy]) => this.drawSquare(g, gx, gy, COLOR_HEX[color], 1, color))
    })
    this.drawCenter(g)
    this.boardLayer.add(g)
    this.boardLayer.add(this._boardExtras)
    this._boardExtras = null

    this.createQuadrantFx()
  }

  // A colour wash over each home quadrant that pulses on that player's turn.
  createQuadrantFx() {
    this.quadFx = {}
    COLORS.forEach((color) => {
      const [bx, by] = YARDS[color].box
      const rect = this.add
        .rectangle(
          BOARD_X + (bx + 3) * TILE,
          BOARD_Y + (by + 3) * TILE,
          TILE * 6,
          TILE * 6,
          COLOR_LIGHT[color],
          0
        )
        .setDepth(3)
      this.quadFx[color] = rect
    })
  }

  playerName(color) {
    if (color === this.youColor) return t('classic.you')
    if (this.isBot(color)) {
      const botIdx = this.activeColors.filter((c) => this.isBot(c)).indexOf(color) + 1
      return t('classic.cpu', { n: botIdx })
    }
    return t(`color.${color}`)
  }

  // A centred 2x2 of home slots inside the tinted holder, spaced for the
  // (tall, feet-anchored) character art.
  yardSlots(color) {
    const [bx, by] = YARDS[color].box
    const cols = [bx + 2.1, bx + 3.9]
    const rows = [by + 2.3, by + 4.15]
    return [
      [cols[0], rows[0]],
      [cols[1], rows[0]],
      [cols[0], rows[1]],
      [cols[1], rows[1]],
    ]
  }

  drawYard(g, color) {
    const [gx, gy] = YARDS[color].box
    const x = BOARD_X + gx * TILE
    const y = BOARD_Y + gy * TILE
    g.fillStyle(COLOR_HEX[color], 1)
    g.fillRect(x, y, TILE * 6, TILE * 6)
    g.fillGradientStyle(COLOR_LIGHT[color], COLOR_HEX[color], COLOR_HEX[color], COLOR_DARK[color], 1)
    g.fillRect(x, y, TILE * 6, TILE * 6)
    g.lineStyle(2, COLOR_DARK[color], .4)
    g.strokeRect(x + 1, y + 1, TILE * 6 - 2, TILE * 6 - 2)
    g.fillStyle(COLOR_DARK[color], .3)
    g.fillRoundedRect(x + TILE + 4, y + TILE + 7, TILE * 4, TILE * 4, 18)
    g.fillStyle(COLOR_SURFACE[color], 1)
    g.fillRoundedRect(x + TILE, y + TILE, TILE * 4, TILE * 4, 18)
    g.lineStyle(3, 0xffffff, .9)
    g.strokeRoundedRect(x + TILE, y + TILE, TILE * 4, TILE * 4, 18)
    this.yardSlots(color).forEach(([px, py]) => {
      g.fillStyle(COLOR_HEX[color], .16)
      g.fillEllipse(BOARD_X + px * TILE, BOARD_Y + (py + 0.28) * TILE, 34, 14)
    })
  }

  drawSquare(g, gx, gy, color, alpha = 1, laneColor, opts = {}) {
    const x = BOARD_X + gx * TILE
    const y = BOARD_Y + gy * TILE
    g.fillStyle(color, alpha)
    g.fillRect(x, y, TILE, TILE)
    if (laneColor) {
      g.fillStyle(COLOR_LIGHT[laneColor], 0.18)
      g.fillRect(x, y, TILE, 4)
      g.fillStyle(COLOR_DARK[laneColor], 0.18)
      g.fillRect(x, y + TILE - 4, TILE, 4)
      g.lineStyle(1, COLOR_DARK[laneColor], 0.36)
      g.strokeRect(x, y, TILE, TILE)
    } else if (opts.owner) {
      g.fillStyle(0xffffff, 0.22)
      g.fillRect(x, y, TILE, 5)
      g.fillStyle(COLOR_DARK[opts.owner], 0.28)
      g.fillRect(x, y + TILE - 5, TILE, 5)
      g.lineStyle(1.5, COLOR_DARK[opts.owner], 0.5)
      g.strokeRect(x, y, TILE, TILE)
    } else if (opts.safe) {
      g.fillStyle(0xffffff, 0.18)
      g.fillRect(x, y, TILE, 5)
      g.fillStyle(0x000000, 0.08)
      g.fillRect(x, y + TILE - 5, TILE, 5)
      g.lineStyle(1, BOARD_PALETTE.grid, 0.45)
      g.strokeRect(x, y, TILE, TILE)
    } else {
      g.lineStyle(1, BOARD_PALETTE.grid, 0.48)
      g.strokeRect(x, y, TILE, TILE)
    }
    if (opts.safe) {
      this._boardExtras?.push(this.add.text(x + TILE / 2, y + TILE / 2, '★', {
        fontFamily: 'Verdana, sans-serif',
        fontSize: 16,
        color: opts.owner ? '#ffffff' : '#4b5563',
        fontStyle: 'bold',
      }).setOrigin(0.5).setAlpha(opts.owner ? 0.95 : 0.72))
    }
  }

  drawCenter(g) {
    const cx = BOARD_X + 7.5 * TILE
    const cy = BOARD_Y + 7.5 * TILE
    g.fillStyle(COLOR_HEX.red, 1)
    g.fillTriangle(BOARD_X + 6 * TILE, BOARD_Y + 6 * TILE, cx, cy, BOARD_X + 6 * TILE, BOARD_Y + 9 * TILE)
    g.fillStyle(COLOR_HEX.green, 1)
    g.fillTriangle(BOARD_X + 6 * TILE, BOARD_Y + 6 * TILE, cx, cy, BOARD_X + 9 * TILE, BOARD_Y + 6 * TILE)
    g.fillStyle(COLOR_HEX.yellow, 1)
    g.fillTriangle(BOARD_X + 9 * TILE, BOARD_Y + 6 * TILE, cx, cy, BOARD_X + 9 * TILE, BOARD_Y + 9 * TILE)
    g.fillStyle(COLOR_HEX.blue, 1)
    g.fillTriangle(BOARD_X + 6 * TILE, BOARD_Y + 9 * TILE, cx, cy, BOARD_X + 9 * TILE, BOARD_Y + 9 * TILE)
    this._boardExtras?.push(this.add.text(cx, cy, '★', {
      fontFamily: 'Verdana, sans-serif',
      fontSize: 34,
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setStroke('#00000033', 4))
  }

  createPlayers() {
    this.playerBadges = {}
    this.cornerDice = {}
    this.makeRoundedRectTexture('pod-tag', 96, 24, 0x1a1240, 0x120c30, 12, 0x5847a0)

    COLORS.forEach((color) => {
      const pod = POD[color]
      const c = this.add.container(pod.ax, pod.ay).setDepth(30)
      c.add(this.add.circle(4, 6, POD_R, 0x000000, 0.32))
      const ring = this.add.circle(0, 0, POD_R + 6, COLOR_HEX[color], 0.001)
      ring.name = 'ring'
      c.add(ring)
      c.add(this.add.circle(0, 0, POD_R, 0x241a4e).setStrokeStyle(5, COLOR_HEX[color]))
      c.add(this.add.image(1, POD_R - 4, `pawn-${color}-sm`).setOrigin(0.5, 1).setScale(66 / 120))
      const arc = this.add.graphics()
      arc.name = 'arc'
      c.add(arc)

      const tagY = pod.dir === 'up' ? POD_R + 20 : -(POD_R + 20)
      c.add(this.add.image(0, tagY, 'pod-tag').setAlpha(0.96))
      c.add(this.add.text(0, tagY - 1, this.playerName(color), {
        fontFamily: 'Verdana, sans-serif', fontSize: 12,
        color: color === this.youColor ? '#ffe27a' : '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5))

      this.playerBadges[color] = c
      this.cornerDice[color] = this.createCornerDice(color)
      if (!this.activeColors.includes(color)) {
        c.setVisible(false)
        this.cornerDice[color].container.setVisible(false)
      }
    })
  }

  createCornerDice(color) {
    const pod = POD[color]
    const container = this.add.container(pod.dx, pod.dy).setDepth(34)
    const glow = this.add.circle(0, 0, 39, 0xffffff, 0)
      .setStrokeStyle(2, COLOR_LIGHT[color], 1).setAlpha(0)
    glow.name = 'glow'
    const shadow = this.add.ellipse(2, 25, 48, 12, 0x000000, 0.3)
    const face = this.add.graphics().setPosition(0, -1)
    const pose = dicePose(1)
    drawRestingDice(face, 1)
    container.add([glow, shadow, face])
    const extraCue = this.add.container(0, 0).setVisible(false)
    const extraRing = this.add.circle(0, 0, 38, 0xffffff, 0)
      .setStrokeStyle(2.5, 0xffd54d)
    const extraPlus = this.add.text(pod.dx < W / 2 ? 59 : -59, -8, '+1', {
      fontFamily: 'Verdana, sans-serif', fontSize: 32, fontStyle: 'bold', color: '#ffda70',
    }).setOrigin(.5).setStroke('#21143d', 4)
    extraCue.add([extraRing, extraPlus])
    container.add(extraCue)
    container.setVisible(false)
    const zone = this.makeHitZone(pod.dx, pod.dy, 82, 82)
    this.addPressFeedback(zone, container, () => {
      if (!this.isBot(this.currentColor)) this.rollDice()
    })
    return { container, face, glow, shadow, pose, value: 1, extraCue, extraRing, extraPlus }
  }

  clearExtraRollCue(color) {
    const dice = this.cornerDice[color]
    if (!dice?.extraCue) return
    this.tweens.killTweensOf(dice.extraCue)
    this.tweens.killTweensOf(dice.extraRing)
    this.tweens.killTweensOf(dice.extraPlus)
    dice.extraCue.setVisible(false)
  }

  showExtraRollCue(color) {
    if (this.gameOver || this.phase !== 'roll' || this.currentColor !== color) return
    const dice = this.cornerDice[color]
    if (!dice) return
    this.clearExtraRollCue(color)
    dice.extraCue.setVisible(true).setAlpha(1).setY(0)
    dice.extraRing.setScale(1).setAlpha(.8)
    dice.extraPlus.setScale(1).setAlpha(1)
    sfx.extraRoll()
    if (!this.isBot(color)) sfx.buzz([12, 45, 12])
    if (prefersReducedMotion) return
    this.tweens.add({
      targets: dice.extraPlus, scale: { from: .5, to: 1 },
      duration: 320, ease: EASE.pop,
    })
    this.tweens.add({
      targets: dice.extraCue, alpha: { from: 0, to: 1 }, y: { from: 6, to: 0 },
      duration: 180, ease: EASE.out,
    })
    // Hollow rings only; leave the die's background transparent.
    this.tweens.add({
      targets: dice.extraRing, scale: { from: 1, to: 1.35 }, alpha: { from: .8, to: 0 },
      duration: 350, repeat: 1, ease: EASE.out,
    })
  }

  createBottomBar() {
    this.makeRoundedRectTexture('bottom-bar', W + 40, 108, 0x271c58, 0x1a1140, 30, 0x4c3d94)
    this.add.image(W / 2, BAR_Y + 26, 'bottom-bar').setAlpha(0.98).setDepth(38)
    this.add.rectangle(W / 2, BAR_Y - 28, W - 48, 3, 0xffffff, 0.12).setDepth(39)
    this.createPowerButtons()
  }

  // Three fixed power slots. The icon is the button; a red corner badge shows
  // how many of that power you hold (hidden at zero, like every other game).
  createPowerButtons() {
    this.powerButtons = {}
    const xs = { fire: W / 2 - 100, water: W / 2, earth: W / 2 + 100 }

    POWER_SLOT_KEYS.forEach((key) => {
      const x = xs[key]
      const c = this.add.container(x, BAR_Y).setDepth(48).setData('baseScale', 1)
      c.add(this.add.ellipse(4, 42, 66, 16, 0x000000, 0.3))
      const icon = this.add.image(0, 0, `rune-${key}`).setScale(88 / 240)
      icon.name = 'icon'
      c.add(icon)
      const badge = this.add.container(34, -34)
      badge.add(this.add.circle(2, 2, 15, 0x000000, 0.3))
      badge.add(this.add.circle(0, 0, 15, 0xff4757).setStrokeStyle(2.5, 0xffffff))
      const countText = this.add.text(0, -1, '0', {
        fontFamily: 'Verdana, sans-serif', fontSize: 15, color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5)
      badge.add(countText)
      badge.setVisible(false)
      c.add(badge)
      const zone = this.makeHitZone(x, BAR_Y, 92, 92).setDepth(48)
      this.addPressFeedback(zone, c, () => this.usePower(key))
      this.powerButtons[key] = { container: c, icon, badge, countText, zone, owned: false }
    })
  }

  createPawns() {
    this.activeColors.forEach((color) => {
      for (let i = 0; i < 4; i++) {
        const pawn = { color, id: i, steps: -1, finished: false }
        this.pawns.push(pawn)
        const view = this.makePawnView(color)
        this.pawnViews.set(pawn, view)
        this.positionPawn(pawn, false)
      }
    })
  }

  createPowerRunes() {
    POWER_TYPES.forEach((type) => {
      this.spawnPowerRune(type, 0)
      this.spawnPowerRune(type, 1)
    })
  }

  spawnPowerRune(type, slot) {
    const id = `${type}-${slot}`
    const blocked = this.powerRunes.filter((rune) => rune.id !== id).map((rune) => rune.index)
    const rune = {
      id,
      type,
      slot,
      index: this.getRandomRuneIndex(blocked),
    }

    this.powerRunes = this.powerRunes.filter((item) => item.id !== id)
    this.powerRunes.push(rune)
    const previous = this.runeViews.get(id)
    if (previous) {
      this.tweens.killTweensOf(previous)
      previous.destroy()
    }
    this.runeViews.set(id, this.createRuneView(rune))
  }

  getRandomRuneIndex(blockedIndexes) {
    const occupied = new Set(
      this.pawns
        .map((pawn) => this.getPawnCell(pawn))
        .filter((cell) => cell.type === 'track')
        .map((cell) => cell.index)
    )
    const candidates = TRACK
      .map((_, index) => index)
      .filter((index) => !SAFE_STOPS.has(index) && !blockedIndexes.includes(index) && !occupied.has(index))
    return Phaser.Utils.Array.GetRandom(candidates.length ? candidates : TRACK.map((_, index) => index))
  }

  createRuneView(rune) {
    const { x, y } = this.getTrackPixel(rune.index)
    const c = this.add.container(x, y).setDepth(18)
    c.add(this.add.ellipse(2, 15, 30, 9, 0x000000, 0.3))
    c.add(this.add.image(0, -1, `rune-${rune.type}`).setScale(40 / 240))
    if (!prefersReducedMotion) {
      this.tweens.add({
        targets: c,
        y: y - 5,
        scale: 1.07,
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: EASE.breathe,
      })
    }
    return c
  }

  makePawnView(color) {
    const c = this.add.container(0, 0).setDepth(20)
    c.setData('onBoard', false)
    const glow = this.add.circle(0, -4, 25, COLOR_HEX[color], 0)
    glow.name = 'glow'

    // protective bubble (hidden until the earth power is used)
    const shield = this.add.container(0, -16)
    shield.name = 'shield'
    shield.add(this.add.circle(0, 0, 32, 0x5ad6ff, 0.12))
    shield.add(this.add.circle(0, 0, 26, 0xcdf4ff, 0.16).setStrokeStyle(3, 0x7ee6ff, 0.95))
    shield.add(this.add.circle(-9, -12, 5, 0xffffff, 0.7))
    shield.setVisible(false)

    const token = this.add.container(0, 0)
    token.name = 'token'
    // Yard layout; track pawns use a lower, tighter layout in layoutPawnView.
    const sprite = this.add.image(0, 12, `pawn-${color}`).setOrigin(0.5, 1)
    sprite.setScale(64 / sprite.height)
    sprite.name = 'sprite'
    token.add(sprite)
    const zone = this.add.zone(0, -14, 58, 68)
    zone.name = 'zone'
    c.add([glow, shield, token, zone])
    return c
  }

  layoutPawnView(pawn, view) {
    const onBoard = pawn.steps >= 0
    if (view.getData('onBoard') === onBoard) return
    view.setData('onBoard', onBoard)
    const token = view.getByName('token')
    const sprite = token.getByName('sprite')
    this.tweens.killTweensOf(sprite)
    sprite.setY(onBoard ? 24 : 12).setScale((onBoard ? 56 : 64) / sprite.height)
    view.getByName('shield').setY(onBoard ? -4 : -16)
    view.getByName('zone').setY(onBoard ? -4 : -14)
  }

  rollDice() {
    if (this.phase !== 'roll' || this.gameOver) return
    this.clearExtraRollCue(this.currentColor)
    this.phase = 'rolling'
    this.stopTurnTimer()
    sfx.roll()
    sfx.buzz(12)
    const color = this.currentColor
    if (this.shieldedColors.has(color) && this.shieldExpiresOnOwnRoll.has(color)) {
      this.shieldedColors.delete(color)
      this.shieldExpiresOnOwnRoll.delete(color)
      this.updateShieldVisuals()
    }
    const dice = this.cornerDice[color]
    const tray = dice.container
    const trayY = POD[color].dy
    const forcedValue = this.forcedDiceValue
    const guaranteedSix = this.sixForced.has(color)
    const doubleActive = this.doubleNextRoll
    this.forcedDiceValue = null
    this.doubleNextRoll = false
    const rawValue = forcedValue ?? (guaranteedSix ? 6 : Phaser.Math.Between(1, 6))
    const target = dicePose(rawValue)
    const start = { ...dice.pose }
    const progress = { t: 0 }
    let landed = false
    this.tweens.killTweensOf(tray)
    this.tweens.killTweensOf(dice.glow)
    tray.setVisible(true).setAlpha(1).setScale(1).setAngle(0).setY(trayY)
    dice.glow.setVisible(false).setAlpha(0).setScale(1)
    const impact = () => {
      if (landed) return
      landed = true
      sfx.land(rawValue)
      sfx.buzz(rawValue === 6 ? 28 : 14)
      if (!prefersReducedMotion) {
        this.popAt(tray.x, tray.y + 20, rawValue === 6 ? 0xffd54d : COLOR_HEX[color])
      }
    }
    this.tweens.add({
      targets: progress,
      t: 1,
      duration: prefersReducedMotion ? 100 : 650,
      ease: 'Linear',
      onUpdate: () => {
        const t = progress.t
        let height = 0
        let squash = 0
        let modelScale = 1
        if (prefersReducedMotion) {
          dice.pose = target
        } else if (t < .1) {
          squash = Math.sin(t / .1 * Math.PI / 2) * .14
        } else if (t < .76) {
          const flight = (t - .1) / .66
          const rotation = 1 - Math.pow(1 - flight, 2)
          dice.pose = {
            x: start.x + (target.x + Math.PI * 4 - start.x) * rotation,
            y: start.y + (target.y + Math.PI * 4 - start.y) * rotation,
            tilt: Math.sin(flight * Math.PI),
          }
          const lift = Math.sin(flight * Math.PI)
          height = lift * 42
          modelScale = 1 + lift * .5
        } else {
          dice.pose = target
          impact()
          const settle = (t - .76) / .24
          height = Math.sin(settle * Math.PI) * 4
          squash = Math.cos(settle * Math.PI * 3) * (1 - settle) * .1
        }
        dice.face.setPosition(Math.sin(t * Math.PI * 2) * (height / 12), -1 - height)
          .setScale(modelScale * (1 + squash), modelScale * (1 - squash))
        dice.shadow.setScale(1 - height / 130, 1 - height / 170)
          .setAlpha(.3 - height / 260)
        if (prefersReducedMotion || t < .1) {
          drawRestingDice(dice.face, dice.value)
        } else if (t >= .76) {
          drawRestingDice(dice.face, rawValue)
        } else {
          drawDice(dice.face, dice.pose)
        }
      },
      onComplete: () => {
        dice.pose = target
        dice.value = rawValue
        dice.face.setPosition(0, -1).setScale(1)
        dice.shadow.setScale(1).setAlpha(.3)
        drawRestingDice(dice.face, rawValue)
        impact()
        this.rawDiceValue = rawValue
        this.diceValue = doubleActive ? rawValue * 2 : rawValue
        // "1-in-N" pity: never more than SIX_PITY_LIMIT non-sixes in a row
        if (rawValue === 6) {
          this.sixPity[color] = 0
          this.sixForced.delete(color)
        } else {
          this.sixPity[color]++
          if (this.sixPity[color] >= SIX_PITY_LIMIT) this.sixForced.add(color)
        }
        this.phase = 'move'
        this.refreshTurnUI()
        this.updatePowerButtons()
        const resolved = this.onRollResolved
        this.onRollResolved = null
        if (this.getMovesForCurrentPlayer().length === 0) {
          this.time.delayedCall(750, () => this.nextTurn())
        } else if (this.isBot(color)) {
          this.time.delayedCall(480, () => resolved && resolved())
        } else {
          this.startTurnTimer('move')
        }
      },
    })
  }

  usePower(key) {
    if (this.gameOver) return
    const color = this.currentColor
    if (this.isBot(color) || color !== this.powerBarColor) return
    const inventory = this.powerInventory[color]
    if (!inventory?.[key]) return
    if (this.phase !== 'roll') {
      this.flashPower(key)
      return
    }

    if (key === 'water') {
      this.showControllerPicker()
      return
    }
    sfx.power()

    if (key === 'fire') {
      inventory.fire--
      this.doubleNextRoll = true
      this.flashPower(key)
      this.updatePowerButtons()
      return
    }

    if (key === 'earth') {
      inventory.earth--
      this.shieldedColors.add(color)
      this.shieldExpiresOnOwnRoll.delete(color)
      this.flashPower(key)
      this.playShieldAura(color)
      this.updateShieldVisuals()
      this.updatePowerButtons()
      return
    }
  }

  flashPower(key) {
    const button = this.powerButtons[key]?.container
    if (!button) return
    this.tweens.add({
      targets: button,
      scale: { from: 1.22, to: 1 },
      duration: 240,
      ease: 'Back.easeOut',
    })
  }

  showControllerPicker() {
    const color = this.currentColor
    const inventory = this.powerInventory[color]
    if (!inventory?.water || this.phase !== 'roll') return
    if (this.controllerPicker) this.controllerPicker.destroy()

    const overlay = this.add.container(W / 2, 960).setDepth(120)
    this.makeRoundedRectTexture('controller-picker-bg', 430, 104, 0x10213a, 0x251a58, 22, 0xbdeeff)
    overlay.add(this.add.image(0, 0, 'controller-picker-bg').setAlpha(0.96))
    overlay.add(this.add.text(0, -34, t('classic.chooseDice'), {
      fontFamily: 'Verdana, sans-serif',
      fontSize: 16,
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5))

    for (let value = 1; value <= 6; value++) {
      const x = -165 + (value - 1) * 66
      const slot = this.add.container(x, 20)
      slot.add(this.add.circle(0, 0, 25, 0xffd85e, 1).setStrokeStyle(3, 0xffffff, 0.86))
      slot.add(this.add.text(0, 0, `${value}`, {
        fontFamily: 'Verdana, sans-serif',
        fontSize: 19,
        color: '#3c2b12',
        fontStyle: 'bold',
      }).setOrigin(0.5))
      overlay.add(slot)
      const zone = this.add.zone(x, 20, 52, 52).setInteractive({ useHandCursor: true })
      zone.on('pointerup', () => {
        inventory.water--
        this.forcedDiceValue = value
        this.controllerPicker?.destroy()
        this.controllerPicker = null
        this.flashPower('water')
        sfx.power()
        this.updatePowerButtons()
        this.time.delayedCall(160, () => this.rollDice())
      })
      overlay.add(zone)
    }
    this.controllerPicker = overlay
  }

  tryMovePawn(pawn) {
    if (this.phase !== 'move' || this.gameOver || pawn.color !== this.currentColor || !this.canMove(pawn)) return
    this.phase = 'moving'
    this.stopTurnTimer()
    this.updatePawnHighlights()
    this.updatePowerButtons()
    const from = pawn.steps
    const to = pawn.steps === -1 ? 0 : pawn.steps + this.diceValue
    pawn.steps = to
    if (pawn.steps >= 56) {
      pawn.finished = true
      pawn.steps = 56
    }
    this.animatePawn(pawn, from, pawn.steps, () => {
      this.collectPowerRune(pawn, () => {
        const captured = this.collectCaptures(pawn)
        const finishTurn = () => {
          if (pawn.finished) {
            this.popAt(W / 2, BOARD_Y + TILE * 7.5, COLOR_HEX[pawn.color])
            sfx.rune()
          }
          this.checkForWinner(pawn.color)
          if (this.gameOver) return
          this.phase = 'roll'
          const extraReason = this.extraRollNextTurn ? 'air'
            : captured.length > 0 ? 'capture'
              : pawn.finished ? 'finish' : this.rawDiceValue === 6 ? 'six' : null
          if (!extraReason) this.advanceTurn()
          if (this.shieldedColors.has(pawn.color)) this.shieldExpiresOnOwnRoll.add(pawn.color)
          this.extraRollNextTurn = false
          this.diceValue = 0
          this.rawDiceValue = 0
          this.refreshTurnUI()
          if (extraReason) this.showExtraRollCue(pawn.color, extraReason)
          this.reflowPawns(true)
          this.time.delayedCall(360, () => this.beginTurn())
        }

        if (captured.length > 0) {
          this.playCaptureSequence(pawn, captured, finishTurn)
        } else {
          finishTurn()
        }
      })
    })
  }

  canMove(pawn) {
    if (pawn.finished) return false
    if (pawn.steps === -1) return this.rawDiceValue === 6 || this.diceValue === 6
    return pawn.steps + this.diceValue <= 56
  }

  getMovesForCurrentPlayer() {
    const color = this.currentColor
    return this.pawns.filter((pawn) => pawn.color === color && this.canMove(pawn))
  }

  nextTurn() {
    if (this.gameOver) return
    const color = this.currentColor
    const extraReason = this.extraRollNextTurn ? 'air' : this.rawDiceValue === 6 ? 'six' : null
    this.phase = 'roll'
    if (!extraReason) this.advanceTurn()
    if (this.shieldedColors.has(color)) this.shieldExpiresOnOwnRoll.add(color)
    this.extraRollNextTurn = false
    this.diceValue = 0
    this.rawDiceValue = 0
    this.refreshTurnUI(t('classic.noMove'))
    if (extraReason) this.showExtraRollCue(color, extraReason)
    this.time.delayedCall(320, () => this.beginTurn())
  }

  // ---------- turn driver (human timer / bot autoplay) ----------

  beginTurn() {
    if (this.gameOver || this.phase !== 'roll') return
    const color = this.currentColor
    if (this.isBot(color)) {
      this.time.delayedCall(560, () => this.runBotTurn())
    } else {
      this.startTurnTimer('roll')
    }
  }

  buildAiState() {
    const color = this.currentColor
    return {
      color,
      dice: this.diceValue || 0,
      raw: this.rawDiceValue || 0,
      pawns: this.pawns.map((p) => ({ color: p.color, id: p.id, steps: p.steps, finished: p.finished })),
      runes: this.powerRunes.map((r) => ({ type: r.type, index: r.index })),
      shielded: new Set(this.shieldedColors),
      inventory: { ...this.powerInventory[color] },
      difficulty: this.difficulty,
    }
  }

  runBotTurn() {
    if (this.gameOver || this.phase !== 'roll') return
    const color = this.currentColor
    const inv = this.powerInventory[color]
    const powerKey = chooseAiPower(this.buildAiState())

    if (powerKey === 'water' && inv.water > 0) {
      this.forcedDiceValue = bestForcedDice(this.buildAiState())
      inv.water--
      sfx.power()
    } else if (powerKey === 'fire' && inv.fire > 0) {
      this.doubleNextRoll = true
      inv.fire--
      sfx.power()
    } else if (powerKey === 'earth' && inv.earth > 0) {
      inv.earth--
      this.shieldedColors.add(color)
      this.shieldExpiresOnOwnRoll.delete(color)
      this.playShieldAura(color)
      this.updateShieldVisuals()
      sfx.power()
    }
    this.updatePowerButtons()

    this.onRollResolved = () => this.runBotMove()
    this.time.delayedCall(powerKey ? 460 : 140, () => this.rollDice())
  }

  runBotMove() {
    if (this.gameOver || this.phase !== 'move') return
    const choice = chooseAiMove(this.buildAiState())
    if (!choice) {
      this.nextTurn()
      return
    }
    const pawn = this.pawns.find((p) => p.color === choice.color && p.id === choice.id)
    this.time.delayedCall(420, () => {
      if (pawn && !this.gameOver) this.tryMovePawn(pawn)
    })
  }

  startTurnTimer(kind) {
    this.stopTurnTimer()
    if (this.gameOver || this.isBot(this.currentColor)) return
    const total = kind === 'move' ? 20 : TURN_SECONDS
    this.turnSecondsLeft = total
    this.turnSecondsTotal = total
    this.drawTimerArc(1)
    this.turnTimer = this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => {
        this.turnSecondsLeft -= 0.25
        this.drawTimerArc(Math.max(this.turnSecondsLeft, 0) / this.turnSecondsTotal)
        if (this.turnSecondsLeft <= 0) {
          this.stopTurnTimer()
          this.handleTurnTimeout()
        }
      },
    })
  }

  drawTimerArc(frac) {
    const badge = this.playerBadges[this.currentColor]
    const arc = badge?.getByName('arc')
    if (!arc) return
    arc.clear()
    if (frac <= 0) return
    const col = frac < 0.25 ? 0xff5a5a : 0xffffff
    arc.lineStyle(4, col, 0.95)
    arc.beginPath()
    arc.arc(0, 0, POD_R + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false)
    arc.strokePath()
  }

  stopTurnTimer() {
    if (this.turnTimer) {
      this.turnTimer.remove(false)
      this.turnTimer = null
    }
    Object.values(this.playerBadges || {}).forEach((b) => b.getByName('arc')?.clear())
  }

  handleTurnTimeout() {
    if (this.gameOver) return
    this.showToast(t('classic.timeUp'))
    if (this.phase === 'roll') {
      this.rollDice()
    } else if (this.phase === 'move') {
      const moves = this.getMovesForCurrentPlayer()
      if (moves.length) this.tryMovePawn(Phaser.Utils.Array.GetRandom(moves))
      else this.nextTurn()
    }
  }

  // ---------- win flow ----------

  checkForWinner(color) {
    const allHome = this.pawns.filter((p) => p.color === color).every((p) => p.finished)
    if (!allHome || this.finishOrder.includes(color)) return
    this.finishOrder.push(color)
    this.endGame()
  }

  progressOf(color) {
    return this.pawns
      .filter((p) => p.color === color)
      .reduce((sum, p) => sum + Math.max(p.steps, 0), 0)
  }

  endGame() {
    if (this.gameOver) return
    this.activeColors.forEach(color => this.clearExtraRollCue(color))
    this.gameOver = true
    this.stopTurnTimer()
    this.clearActivePawnZones()
    this.phase = 'over'
    const winner = this.finishOrder[0]
    const youWon = winner === this.youColor

    const ranking = [...this.activeColors].sort((a, b) => {
      if (a === winner) return -1
      if (b === winner) return 1
      return this.progressOf(b) - this.progressOf(a)
    })

    const reward = this.applyRewards(youWon)
    if (youWon || !this.youColor) sfx.win()
    else sfx.lose()
    sfx.buzz(youWon ? [30, 40, 30, 40, 70] : 70)
    this.cameras.main.shake(300, youWon ? 0.004 : 0.002)
    this.time.delayedCall(450, () => this.showVictoryOverlay(winner, youWon, ranking, reward))
  }

  applyRewards(youWon) {
    if (!this.youColor) return null
    const captures = this.captureCounts[this.youColor] || 0
    const coins = (youWon ? 500 : 90) + captures * 12
    const xp = youWon ? 120 : 35
    const levels = store.addXp(xp)
    store.addCoins(coins)
    store.recordGame({ won: youWon, captures })
    return { coins, xp, levels, captures, won: youWon }
  }

  showVictoryOverlay(winner, youWon, ranking, reward) {
    const cardW = 520
    const cardH = 616
    const layer = this.add.container(0, 0).setDepth(200)
    layer.add(this.add.rectangle(W / 2, H / 2, W, H, 0x05060f, 0.74))
    layer.add(this.add.zone(W / 2, H / 2, W, H).setInteractive())

    this.makeRoundedRectTexture('victory-card', cardW, cardH, 0x2a1f52, 0x140d2c, 28, COLOR_HEX[winner])
    const card = this.add.container(W / 2, H / 2, [this.add.image(0, 0, 'victory-card').setAlpha(0.98)])

    const winColor = t(`color.${winner}`)
    const heading = youWon ? t('victory.youWin') : this.youColor ? t('victory.defeat') : t('victory.colorWins', { color: winColor })
    card.add(this.add.text(0, -cardH / 2 + 66, heading, {
      fontFamily: 'Verdana, sans-serif', fontSize: 46, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setStroke('#00000055', 6))
    card.add(this.add.text(0, -cardH / 2 + 112, t('victory.allHome', { color: winColor }), {
      fontFamily: 'Verdana, sans-serif', fontSize: 14, color: '#c9b8ff',
    }).setOrigin(0.5))

    const medals = [t('victory.place1'), t('victory.place2'), t('victory.place3'), t('victory.place4')]
    this.makeRoundedRectTexture('victory-row', cardW - 72, 50, 0x392b6b, 0x2a1f52, 12)
    const rows = []
    ranking.forEach((color, i) => {
      const row = this.add.container(0, -cardH / 2 + 168 + i * 60)
      row.add(this.add.image(0, 0, 'victory-row'))
      row.add(this.add.circle(-cardW / 2 + 58, 0, 14, COLOR_HEX[color]))
      row.add(this.add.text(-cardW / 2 + 88, 0, medals[i], {
        fontFamily: 'Verdana, sans-serif', fontSize: 15, color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0, 0.5))
      const name = color === this.youColor
        ? t('classic.you').toUpperCase()
        : this.isBot(color) ? t('victory.bot', { color: t(`color.${color}`) }) : t(`color.${color}`)
      row.add(this.add.text(-cardW / 2 + 142, 0, name, {
        fontFamily: 'Verdana, sans-serif', fontSize: 13, color: '#d9ccff',
      }).setOrigin(0, 0.5))
      const finished = this.pawns.filter((p) => p.color === color && p.finished).length
      row.add(this.add.text(cardW / 2 - 54, 0, t('victory.home4', { n: finished }), {
        fontFamily: 'Verdana, sans-serif', fontSize: 12, color: '#a99cd6',
      }).setOrigin(1, 0.5))
      card.add(row)
      rows.push(row)
    })
    // cascade the placement rows in after the card lands
    if (!prefersReducedMotion) {
      rows.forEach((r, i) => {
        r.setAlpha(0).setX(-40)
        this.tweens.add({ targets: r, alpha: 1, x: 0, delay: dur(360 + i * 80), duration: dur(DUR.base), ease: EASE.out })
      })
    }

    let ry = -cardH / 2 + 168 + ranking.length * 60 + 34
    if (reward) {
      const rewardStart = dur(400 + ranking.length * 80)
      const rewardText = this.add.text(0, ry, t('victory.reward', { c: 0, x: 0 }), {
        fontFamily: 'Verdana, sans-serif', fontSize: 19, color: '#ffe27a', fontStyle: 'bold',
      }).setOrigin(0.5)
      card.add(rewardText)
      const rs = { c: 0, x: 0 }
      this.tweens.add({
        targets: rs, c: reward.coins, x: reward.xp,
        delay: rewardStart, duration: dur(DUR.slow), ease: EASE.out,
        onUpdate: () => rewardText.setText(t('victory.reward', { c: Math.round(rs.c).toLocaleString(), x: Math.round(rs.x) })),
        onComplete: () => {
          rewardText.setText(t('victory.reward', { c: reward.coins.toLocaleString(), x: reward.xp }))
          this.pulseOnce(rewardText, { scale: 1.14 })
        },
      })
      if (reward.captures) {
        card.add(this.add.text(0, ry + 26, t('victory.captureBonus', { n: reward.captures * 12, k: reward.captures }), {
          fontFamily: 'Verdana, sans-serif', fontSize: 12, color: '#c9b8ff',
        }).setOrigin(0.5))
      }
      if (reward.levels > 0) {
        card.add(this.add.text(0, ry + 52, t('victory.levelUp', { n: store.level }), {
          fontFamily: 'Verdana, sans-serif', fontSize: 15, color: '#7cffb2', fontStyle: 'bold',
        }).setOrigin(0.5))
      }
    } else {
      card.add(this.add.text(0, ry, t('victory.noRewards'), {
        fontFamily: 'Verdana, sans-serif', fontSize: 14, color: '#a99cd6',
      }).setOrigin(0.5))
    }

    const by = cardH / 2 - 68
    this.makeRoundedRectTexture('victory-btn-primary', 214, 62, 0x34c759, 0x1f9d43, 16, 0x9affc0)
    this.makeRoundedRectTexture('victory-btn-ghost', 214, 62, 0x3a2c66, 0x2a2050, 16, 0x6a5aa8)
    const rematch = this.add.container(-116, by, [
      this.add.image(0, 0, 'victory-btn-primary'),
      this.add.text(0, 0, t('victory.rematch'), { fontFamily: 'Verdana, sans-serif', fontSize: 19, color: '#08240f', fontStyle: 'bold' }).setOrigin(0.5),
    ])
    const home = this.add.container(116, by, [
      this.add.image(0, 0, 'victory-btn-ghost'),
      this.add.text(0, 0, t('victory.home'), { fontFamily: 'Verdana, sans-serif', fontSize: 19, color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5),
    ])
    card.add([rematch, home])
    layer.add(card)

    card.setScale(0.82).setAlpha(0)
    this.tweens.add({ targets: card, scale: 1, alpha: 1, duration: 340, ease: 'Back.easeOut' })

    this.makeHitZone(W / 2 - 116, H / 2 + by, 214, 62).setDepth(300)
      .on('pointerup', () => {
        sfx.tap()
        this.cameras.main.fadeOut(200, 0, 0, 0)
        this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart(this.lastConfig))
      })
    this.makeHitZone(W / 2 + 116, H / 2 + by, 214, 62).setDepth(300)
      .on('pointerup', () => {
        sfx.tap()
        this.goTo('Home')
      })

    this.victoryConfetti(winner)
  }

  victoryConfetti(winner) {
    if (!this.textures.exists('classic-spark')) {
      const g = this.make.graphics()
      g.fillStyle(0xffffff, 1)
      g.fillCircle(6, 6, 6)
      g.generateTexture('classic-spark', 12, 12)
      g.destroy()
    }
    this.add.particles(W / 2, -20, 'classic-spark', {
      x: { min: 0, max: W },
      speedY: { min: 130, max: 340 },
      speedX: { min: -70, max: 70 },
      scale: { start: 1.5, end: 0.4 },
      rotate: { min: 0, max: 360 },
      lifespan: 2800,
      quantity: 3,
      frequency: 45,
      duration: 2400,
      tint: [COLOR_HEX[winner], 0xffffff, 0xffd85e, 0x7cffb2],
    }).setDepth(260)
  }

  collectCaptures(movedPawn) {
    const cell = this.getPawnCell(movedPawn)
    if (!cell || cell.type !== 'track' || SAFE_STOPS.has(cell.index)) return []
    const captured = []
    this.pawns.forEach((pawn) => {
      if (pawn === movedPawn || pawn.color === movedPawn.color || pawn.steps < 0 || pawn.finished) return
      const other = this.getPawnCell(pawn)
      if (other?.type === 'track' && other.index === cell.index) {
        if (this.shieldedColors.has(pawn.color)) {
          this.shieldedColors.delete(pawn.color)
          this.shieldExpiresOnOwnRoll.delete(pawn.color)
          this.updateShieldVisuals()
          this.playShieldBlock(pawn)
          return
        }
        captured.push({ pawn })
      }
    })
    return captured
  }

  playCaptureSequence(attacker, captured, onComplete) {
    this.phase = 'capture'
    this.captureCounts[attacker.color] += captured.length
    sfx.capture()
    sfx.buzz([16, 40, 24])

    if (CAPTURE_GRANTS_CHARGE) {
      captured.forEach(({ pawn }, i) => {
        const v = this.pawnViews.get(pawn)
        const at = { x: v.x, y: v.y }
        this.time.delayedCall(i * 130 + 240, () => this.grantCaptureCharge(attacker.color, at.x, at.y))
      })
    }
    const attackerView = this.pawnViews.get(attacker)
    const attackerScale = attackerView.getData('stackScale') ?? 1
    this.tweens.add({
      targets: attackerView,
      scale: attackerScale * 1.22,
      duration: 120,
      yoyo: true,
      ease: 'Back.easeOut',
    })

    let pending = captured.length
    captured.forEach(({ pawn }, index) => {
      this.time.delayedCall(index * 130, () => {
        const victim = this.pawnViews.get(pawn)
        const start = { x: victim.x, y: victim.y }
        this.playElementalSkill(attacker.color, victim.x, victim.y)
        this.cameras.main.shake(130, 0.0025)
        pawn.steps = -1
        pawn.finished = false
        const home = this.getPawnPixel(pawn)
        const mid = {
          x: start.x + (home.x - start.x) * 0.42 + Phaser.Math.Between(-35, 35),
          y: Math.min(start.y, home.y) - 95,
        }
        victim.setDepth(55)
        this.tweens.add({
          targets: victim,
          x: start.x + Phaser.Math.Between(-28, 28),
          y: start.y - 54,
          angle: Phaser.Math.Between(-24, 24),
          scale: (victim.getData('stackScale') ?? 1) * 1.08,
          duration: 190,
          ease: 'Cubic.easeOut',
          onComplete: () => {
            this.tweens.add({
              targets: victim,
              x: mid.x,
              y: mid.y,
              angle: Phaser.Math.Between(-18, 18),
              duration: 280,
              ease: 'Sine.easeInOut',
              onComplete: () => {
                this.tweens.add({
                  targets: victim,
                  x: home.x,
                  y: home.y,
                  angle: 0,
                  scale: victim.getData('stackScale') ?? 1,
                  duration: 330,
                  ease: 'Back.easeOut',
                  onComplete: () => {
                    victim.setDepth(20)
                    this.popAt(home.x, home.y, COLOR_HEX[pawn.color])
                    pending--
                    if (pending === 0) onComplete?.()
                  },
                })
              },
            })
          },
        })
      })
    })
  }

  // Capturing an opponent's pawn awards the attacker a random power charge,
  // which flies from the capture spot to its bar button.
  grantCaptureCharge(color, x, y) {
    const key = Phaser.Utils.Array.GetRandom(CAPTURE_CHARGE_POOL)
    this.powerInventory[color][key]++
    sfx.rune()
    this.updatePowerButtons() // reveal / reflow the slot before flying to it

    const icon = this.add.image(x, y - 8, `rune-${key}`).setScale(46 / 240).setDepth(80)
    const plus = this.add.text(x, y - 30, '+1', {
      fontFamily: 'Verdana, sans-serif', fontSize: 18, color: '#ffe27a', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(81).setStroke('#000000', 4)
    this.tweens.add({ targets: plus, y: y - 58, alpha: 0, duration: dur(700), ease: EASE.out, onComplete: () => plus.destroy() })

    const ownInventory = color === this.powerBarColor && !this.isBot(color)
    const btn = ownInventory ? this.powerButtons[key]?.container : this.playerBadges?.[color]
    if (btn && !prefersReducedMotion) {
      this.tweens.add({
        targets: icon,
        x: btn.x,
        y: btn.y,
        scale: 0.04,
        duration: dur(480),
        delay: dur(80),
        ease: EASE.inOut,
        onComplete: () => {
          icon.destroy()
          if (ownInventory && color === this.powerBarColor) this.flashPower(key)
          this.updatePowerButtons()
        },
      })
    } else {
      this.tweens.add({
        targets: icon, y: icon.y - 34, alpha: 0, scale: 0.08,
        duration: dur(520), ease: EASE.out, onComplete: () => icon.destroy(),
      })
      this.updatePowerButtons()
    }
  }

  playElementalSkill(color, x, y) {
    const config = {
      red: { tex: 'fx-flame', tint: [0xff3b1f, 0xff9a1f, 0xffd85e], count: 20, ring: 0xff5c28 },
      blue: { tex: 'fx-drop', tint: [0x3bb8ff, 0x86e9ff, 0xffffff], count: 22, ring: 0x4dc9ff },
      green: { tex: 'fx-leaf', tint: [0x49d66d, 0x9be15d, 0xe2d2a2], count: 18, ring: 0x62d66f },
      yellow: { tex: 'fx-bolt', tint: [0xffd533, 0xffffff, 0xff9f1c], count: 20, ring: 0xffdf4a },
    }[color]

    const ring = this.add.circle(x, y, 8, config.ring, 0).setStrokeStyle(4, config.ring, 0.75).setDepth(45)
    this.tweens.add({
      targets: ring,
      radius: 46,
      alpha: 0,
      duration: 360,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    })
    this.add.particles(x, y, config.tex, {
      speed: { min: 95, max: 245 },
      angle: { min: 0, max: 360 },
      rotate: { min: -180, max: 180 },
      scale: { start: 1, end: 0 },
      lifespan: 450,
      quantity: config.count,
      emitting: false,
      tint: config.tint,
    }).setDepth(44).explode(config.count, x, y)
  }

  playShieldAura(color) {
    const badge = this.playerBadges[color]
    if (!badge) return
    const aura = this.add.circle(badge.x, badge.y, POD_R, 0xffffff, 0).setStrokeStyle(5, 0x9ee7ff, 0.85).setDepth(42)
    this.tweens.add({
      targets: aura,
      radius: 64,
      alpha: 0,
      duration: 520,
      ease: 'Cubic.easeOut',
      onComplete: () => aura.destroy(),
    })
  }

  playShieldBlock(pawn) {
    const view = this.pawnViews.get(pawn)
    if (!view) return
    sfx.shield()
    sfx.buzz([18, 30])
    const cx = view.x
    const cy = view.y + (view.getByName('shield')?.y ?? -4) * view.scaleY
    // shockwave rings
    for (let i = 0; i < 2; i++) {
      const ring = this.add.circle(cx, cy, 14, 0xffffff, 0).setStrokeStyle(5 - i * 2, 0xdff8ff, 0.95).setDepth(47)
      this.tweens.add({
        targets: ring, radius: 54 + i * 10, alpha: 0,
        duration: dur(420), delay: dur(i * 90), ease: EASE.out,
        onComplete: () => ring.destroy(),
      })
    }
    // white flash on the bubble
    const bubble = view.getByName('shield')
    if (bubble) {
      this.tweens.killTweensOf(bubble)
      bubble.setScale(1).setAlpha(1)
      this.tweens.add({
        targets: bubble, scale: { from: 1.28, to: 1 }, duration: dur(260), ease: EASE.pop,
        onComplete: () => this.updateShieldVisuals(),
      })
    }
    this.cameras.main.shake(120, 0.003)
  }

  animatePawn(pawn, from, to, onComplete) {
    const view = this.pawnViews.get(pawn)
    this.layoutPawnView(pawn, view)
    const token = view.getByName('token')
    const sprite = token.getByName('sprite')
    ;[view, token, sprite].forEach(target => this.tweens.killTweensOf(target))
    token.setPosition(0, 0).setAngle(0).setScale(1)
    sprite.setScale(56 / sprite.height)

    const points = [{ x: view.x, y: view.y }]
    if (from === -1) points.push(this.getPixelFor(pawn.color, 0))
    else for (let step = from + 1; step <= to; step++) points.push(this.getPixelFor(pawn.color, step))
    const count = points.length - 1
    const dest = points[count]
    const restingDepth = 20
    view.setDepth(40).setAlpha(1).setScale(1)

    const finish = () => {
      view.setPosition(dest.x, dest.y).setScale(1).setDepth(restingDepth)
      token.setPosition(0, 0).setAngle(0).setScale(1)
      onComplete?.()
    }
    if (!count || prefersReducedMotion) {
      this.tweens.add({
        targets: view, x: dest.x, y: dest.y,
        duration: dur(150), ease: EASE.out, onComplete: finish,
      })
      return
    }

    // Punchy per-tile hops sell a pawn breaking out of its yard or nudging a
    // single square; longer journeys read better as one continuous glide.
    const leaving = from === -1
    if (leaving || count === 1) {
      this.hopPawn(view, token, points, count, leaving, dest, pawn.color, finish)
    } else {
      this.glidePawn(view, token, points, count, dest, pawn.color, finish)
    }
  }

  // One smooth, eased journey through every tile - no per-square braking.
  glidePawn(view, token, points, count, dest, color, finish) {
    const startScale = view.getData('stackScale') ?? 1
    const shadow = this.add.ellipse(view.x, view.y + 19, 30, 9, 0x10142b, .2).setDepth(19)
    const marker = this.add.ellipse(dest.x, dest.y + 17, 32, 12, 0xffffff, 0)
      .setStrokeStyle(2, COLOR_LIGHT[color], .65).setDepth(19)
    const motion = { progress: 0 }
    let reached = 0
    this.tweens.add({
      targets: motion, progress: 1,
      duration: dur(Math.min(900, 200 + count * 65)),
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        const sample = samplePawnPath(points, motion.progress)
        const lift = Math.sin(motion.progress * Math.PI)
        view.setPosition(sample.x, sample.y)
          .setScale(startScale + (1 - startScale) * Math.min(1, motion.progress * 5))
        token.setY(-lift * (4 + Math.sin(sample.fraction * Math.PI) * 2))
          .setAngle(sample.dx * 7 * lift)
          .setScale(1 - Math.abs(sample.dy) * .025 * lift, 1 + .035 * lift)
        shadow.setPosition(sample.x, sample.y + 19).setScale(1 - lift * .15).setAlpha(.2 - lift * .07)
        while (reached < sample.reached) {
          reached++
          sfx.hop(reached - 1)
          if (reached < count) {
            const point = points[reached]
            const trail = this.add.ellipse(point.x, point.y + 17, 19, 7, COLOR_HEX[color], .28).setDepth(18)
            this.tweens.add({
              targets: trail, alpha: 0, scale: .45, duration: dur(260),
              onComplete: () => trail.destroy(),
            })
          }
        }
      },
      onComplete: () => {
        view.setPosition(dest.x, dest.y).setScale(1)
        shadow.destroy()
        this.tweens.add({
          targets: marker, scale: 1.6, alpha: 0, duration: dur(220),
          ease: EASE.out, onComplete: () => marker.destroy(),
        })
        token.setY(0).setAngle(0).setScale(1.06, .92)
        this.tweens.add({
          targets: token, scaleX: 1, scaleY: 1,
          duration: dur(110), ease: 'Sine.easeOut', onComplete: finish,
        })
      },
    })
  }

  hopPawn(view, token, points, count, leaving, dest, color, finish) {
    // the pawn "picks up" out of its stack
    this.tweens.add({ targets: view, scale: 1, duration: dur(90), ease: EASE.pop })

    // long paths hop a bit faster and lower so a six doesn't drag
    const hopDur = dur(leaving ? 300 : Phaser.Math.Clamp(190 - count * 8, 116, 190))
    const arc = leaving ? 50 : Phaser.Math.Clamp(36 - count * 1.6, 20, 36)
    const shadow = this.add.ellipse(view.x, view.y + 18, 30, 9, 0x0a0d20, 0.3).setDepth(19)

    const hop = (i) => {
      if (i >= count) {
        shadow.destroy()
        this.pawnLand(view, token, dest, color, true)
        this.time.delayedCall(dur(90), finish)
        return
      }
      const a = points[i]
      const b = points[i + 1]
      const lean = Math.sign(b.x - a.x) * 11 + Math.sign(b.y - a.y) * 4
      const st = { t: 0 }
      // quick anticipation crouch, then the arc
      this.tweens.add({
        targets: token, scaleX: 1.18, scaleY: 0.8,
        duration: dur(leaving ? 60 : 46), ease: 'Quad.easeOut',
        onComplete: () => {
          this.tweens.add({
            targets: st, t: 1, duration: hopDur, ease: 'Sine.easeInOut',
            onUpdate: () => {
              const t = st.t
              const lift = Math.sin(t * Math.PI)
              view.setPosition(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
              token.setY(-arc * lift * lift ** 0.15) // slightly front-loaded arc
                .setAngle(lean * lift * (1 - t * 0.35))
                .setScale(1 - 0.16 * lift + 0.06 * t, 1 + 0.24 * lift - 0.06 * t)
              shadow.setPosition(view.x, view.y + 18)
                .setScale(1 - lift * 0.45, 1 - lift * 0.6)
                .setAlpha(0.3 - lift * 0.2)
            },
            onComplete: () => {
              sfx.hop?.(i)
              this.pawnLand(view, token, b, color, false)
              this.time.delayedCall(dur(leaving ? 45 : 22), () => hop(i + 1))
            },
          })
        },
      })
    }
    hop(0)
  }

  // impact on landing a tile: squash + ground ring + a puff of dust
  pawnLand(view, token, at, color, final) {
    this.tweens.killTweensOf(token)
    token.setPosition(0, 0).setAngle(0).setScale(final ? 1.32 : 1.22, final ? 0.68 : 0.8)
    this.tweens.add({
      targets: token, scaleX: 1, scaleY: 1,
      duration: dur(final ? 260 : 130),
      ease: final ? EASE.pop : 'Back.easeOut',
    })
    const ring = this.add.ellipse(at.x, at.y + 16, 18, 7, 0xffffff, 0)
      .setStrokeStyle(2.5, COLOR_LIGHT[color], 0.75).setDepth(19)
    this.tweens.add({
      targets: ring, scaleX: final ? 3.2 : 2, scaleY: final ? 3.2 : 2, alpha: 0,
      duration: dur(final ? 340 : 210), ease: EASE.out,
      onComplete: () => ring.destroy(),
    })
    const puffs = final ? 6 : 2
    for (let k = 0; k < puffs; k++) {
      const puff = this.add.circle(
        at.x + Phaser.Math.Between(-5, 5), at.y + 15,
        Phaser.Math.Between(2, 4), 0xdfe4f2, 0.55
      ).setDepth(18)
      this.tweens.add({
        targets: puff,
        x: puff.x + Phaser.Math.Between(-18, 18),
        y: puff.y - Phaser.Math.Between(1, 9),
        alpha: 0, scale: 0.2,
        duration: dur(Phaser.Math.Between(200, 300)), ease: EASE.out,
        onComplete: () => puff.destroy(),
      })
    }
    if (final) this.cameras.main.shake(dur(100), 0.0016)
  }

  positionPawn(pawn, animate) {
    const view = this.pawnViews.get(pawn)
    this.layoutPawnView(pawn, view)
    const target = this.getPawnPixel(pawn)
    if (animate) {
      this.tweens.add({ targets: view, x: target.x, y: target.y, duration: 250, ease: 'Back.easeOut' })
    } else {
      view.setPosition(target.x, target.y)
    }
  }

  reflowPawns(animate) {
    const groups = new Map()
    this.pawns.forEach((pawn) => {
      const key = this.getPawnStackKey(pawn)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(pawn)
    })

    groups.forEach((stack) => {
      const offsets = this.getStackOffsets(stack.length)
      const scale = this.getStackScale(stack.length)
      stack.forEach((pawn, index) => {
        const view = this.pawnViews.get(pawn)
        this.layoutPawnView(pawn, view)
        const base = this.getPawnPixel(pawn)
        const offset = offsets[index]
        view.setData('stackScale', scale)
        view.setData('stackOffset', offset)
        this.tweens.killTweensOf(view)
        if (animate) {
          this.tweens.add({
            targets: view,
            x: base.x + offset.x,
            y: base.y + offset.y,
            scale,
            duration: 180,
            ease: 'Sine.easeOut',
          })
        } else {
          view.setPosition(base.x + offset.x, base.y + offset.y)
          view.setScale(scale)
        }
      })
    })
  }

  getPawnStackKey(pawn) {
    const cell = this.getPawnCell(pawn)
    if (cell.type === 'track') return `track:${cell.index}`
    if (cell.type === 'home') return `${pawn.color}:home:${cell.index}`
    if (cell.type === 'finish') return 'finish'
    return `${pawn.color}:yard:${cell.index}`
  }

  getStackScale(count) {
    if (count <= 1) return 1
    if (count === 2) return 0.78
    if (count === 3) return 0.68
    return 0.6
  }

  getStackOffsets(count) {
    if (count <= 1) return [{ x: 0, y: 0 }]
    if (count === 2) return [{ x: -7, y: -6 }, { x: 7, y: 6 }]
    if (count === 3) return [{ x: 0, y: -9 }, { x: -9, y: 7 }, { x: 9, y: 7 }]
    return [{ x: -9, y: -9 }, { x: 9, y: -9 }, { x: -9, y: 9 }, { x: 9, y: 9 }]
  }

  getPawnCell(pawn) {
    if (pawn.steps === -1) return { type: 'yard', index: pawn.id }
    if (pawn.finished) return { type: 'finish' }
    if (pawn.steps < 51) return { type: 'track', index: (START_INDEX[pawn.color] + pawn.steps) % TRACK.length }
    return { type: 'home', index: pawn.steps - 51 }
  }

  getPawnPixel(pawn) {
    if (pawn.steps === -1) {
      const [gx, gy] = this.yardSlots(pawn.color)[pawn.id]
      return this.gridToPixel(gx, gy)
    }
    if (pawn.finished) return this.gridToPixel(7.5, 7.5)
    return this.getPixelFor(pawn.color, pawn.steps)
  }

  getPixelFor(color, steps) {
    if (steps >= 56) return this.gridToPixel(7.5, 7.5)
    if (steps < 51) {
      const index = (START_INDEX[color] + steps) % TRACK.length
      const [gx, gy] = TRACK[index]
      return this.gridToPixel(gx + 0.5, gy + 0.5)
    }
    const [gx, gy] = HOME_LANES[color][steps - 51]
    return this.gridToPixel(gx + 0.5, gy + 0.5)
  }

  getTrackPixel(index) {
    const [gx, gy] = TRACK[index]
    return this.gridToPixel(gx + 0.5, gy + 0.5)
  }

  gridToPixel(gx, gy) {
    return { x: BOARD_X + gx * TILE, y: BOARD_Y + gy * TILE }
  }

  collectPowerRune(pawn, onComplete = () => {}) {
    const cell = this.getPawnCell(pawn)
    const rune = cell.type === 'track'
      ? this.powerRunes.find((item) => item.index === cell.index)
      : null
    if (!rune) {
      onComplete()
      return
    }
    // Consume immediately so a pickup cannot be awarded twice while animating.
    this.powerRunes = this.powerRunes.filter(item => item.id !== rune.id)
    sfx.rune()
    if (rune.type === 'air') {
      this.extraRollNextTurn = true
    } else {
      this.powerInventory[pawn.color][rune.type]++
    }
    this.updatePowerButtons()
    this.animateRuneCollect(rune, pawn.color, () => {
      this.spawnPowerRune(rune.type, rune.slot)
      onComplete()
    })
  }

  animateRuneCollect(rune, color, onComplete = () => {}) {
    const view = this.runeViews.get(rune.id)
    this.runeViews.delete(rune.id)
    if (!view) {
      onComplete()
      return
    }
    // Reuse the visible rune, preserving its bobbing position without a jump.
    this.tweens.killTweensOf(view)
    view.setDepth(60)
    const ownInventory = color === this.powerBarColor && !this.isBot(color)
    const target = ownInventory && rune.type !== 'air'
      ? this.powerButtons?.[rune.type]?.container
      : this.playerBadges?.[color]
    const complete = () => {
      view.destroy()
      if (ownInventory && rune.type !== 'air' && color === this.powerBarColor) {
        this.flashPower(rune.type)
      }
      onComplete()
    }
    if (prefersReducedMotion) {
      complete()
      return
    }
    if (rune.type === 'air') {
      // An extra roll is used immediately, so burst on its tile instead of
      // implying that it is being stored in somebody's inventory.
      this.popAt(view.x, view.y, 0xffd54d)
      this.tweens.add({
        targets: view, y: view.y - 12, scale: 1.4, alpha: 0,
        duration: 220, ease: EASE.out, onComplete: complete,
      })
      return
    }
    if (!target) {
      complete()
      return
    }
    this.popAt(view.x, view.y, COLOR_HEX[color])
    this.tweens.add({
      targets: view,
      x: target.x,
      y: target.y,
      scale: .35,
      alpha: 0,
      duration: 320,
      ease: 'Cubic.easeInOut',
      onComplete: complete,
    })
  }

  refreshTurnUI(prefix) {
    const color = this.currentColor
    const bot = this.isBot(color)
    const handoff = this._prevColor !== undefined && this._prevColor !== color
    this._prevColor = color

    // active player's pod lifts + glows; others recede
    Object.entries(this.playerBadges).forEach(([key, badge]) => {
      const on = key === color
      this.tweens.killTweensOf(badge)
      this.tweens.add({
        targets: badge,
        scale: on ? 1.16 : 1,
        duration: dur(on && handoff ? DUR.base : DUR.fast),
        ease: on ? EASE.pop : EASE.out,
      })
      this.tweens.add({ targets: badge, alpha: on ? 1 : 0.55, duration: dur(DUR.fast) })
      const ring = badge.getByName('ring')
      if (ring) {
        this.tweens.killTweensOf(ring)
        ring.setFillStyle(COLOR_HEX[key], on ? 0.35 : 0.001)
        ring.setScale(1).setAlpha(1)
        if (on && !prefersReducedMotion) {
          this.tweens.add({ targets: ring, scale: 1.16, alpha: 0.55, duration: 780, yoyo: true, repeat: -1, ease: EASE.breathe })
        }
      }
      if (!on) badge.getByName('arc')?.clear()
    })

    // the active player's whole home quadrant softly blinks
    Object.entries(this.quadFx).forEach(([key, rect]) => {
      this.tweens.killTweensOf(rect)
      if (key === color && !prefersReducedMotion) {
        rect.setFillStyle(COLOR_LIGHT[key]).setAlpha(0.025)
        this.tweens.add({
          targets: rect, alpha: 0.12,
          duration: 620, yoyo: true, repeat: -1, ease: EASE.breathe,
        })
      } else {
        rect.setAlpha(0)
      }
    })

    // only the active player's dice is shown, popping in near their pod
    Object.entries(this.cornerDice).forEach(([key, dice]) => {
      const on = key === color && this.activeColors.includes(key)
      const c = dice.container
      this.tweens.killTweensOf(c)
      this.tweens.killTweensOf(dice.glow)
      if (!on) {
        if (c.visible) {
          this.tweens.add({ targets: c, scale: 0.5, alpha: 0, duration: dur(DUR.fast), ease: EASE.out, onComplete: () => c.setVisible(false) })
        }
        return
      }
      if (!c.visible) {
        c.setVisible(true).setScale(prefersReducedMotion ? 1 : 0.4).setAlpha(prefersReducedMotion ? 1 : 0)
        this.tweens.add({ targets: c, scale: 1, alpha: bot ? 0.95 : 1, duration: dur(DUR.base), ease: EASE.pop })
      } else {
        c.setAlpha(bot ? 0.95 : 1).setScale(1)
      }
      // "hot dice": a lucky 6 is due for this player next roll
      const hot = this.phase === 'roll' && this.sixForced.has(key)
      // Outline only: a filled pulse looks like a flashing background when
      // the die lifts off. Keep the indicator hidden through roll and landing.
      dice.glow.setFillStyle(0xffffff, 0)
        .setStrokeStyle(2, hot ? 0xffd54d : COLOR_LIGHT[key], 1)
        .setVisible(this.phase === 'roll')
      if (!bot && this.phase === 'roll' && !prefersReducedMotion) {
        dice.glow.setScale(1).setAlpha(0)
        this.tweens.add({
          targets: dice.glow,
          alpha: hot ? 0.6 : 0.42,
          scale: hot ? 1.45 : 1.32,
          duration: hot ? 520 : 780,
          yoyo: true,
          repeat: -1,
          ease: EASE.breathe,
        })
      } else {
        dice.glow.setAlpha(hot ? 0.3 : 0)
      }
    })

    this.updatePawnHighlights()
    this.updatePowerButtons()
  }

  updatePowerButtons() {
    if (!this.powerButtons) return
    const color = this.powerBarColor
    const inventory = this.powerInventory[color]
    const human = !this.isBot(color)

    POWER_SLOT_KEYS.forEach((key) => {
      const b = this.powerButtons[key]
      const count = human ? inventory?.[key] ?? 0 : 0
      const has = count > 0
      const usable = has && color === this.currentColor && this.phase === 'roll' && !this.gameOver

      // icons always show at full colour - no fading
      b.container.setAlpha(1)
      b.icon.setAlpha(1)
      b.badge.setVisible(has)
      b.countText.setText(`${count}`)
      if (b.zone.input) b.zone.input.enabled = usable

      // pop the icon whenever the count goes up
      if (count > (b.lastCount ?? 0) && !prefersReducedMotion) {
        this.tweens.killTweensOf(b.container)
        this.tweens.add({
          targets: b.container,
          scale: { from: 1.3, to: 1 },
          duration: dur(DUR.base),
          ease: EASE.pop,
        })
      }
      b.lastCount = count
    })
  }

  updatePawnHighlights() {
    this.clearActivePawnZones()
    this.pawns.forEach((pawn) => {
      const view = this.pawnViews.get(pawn)
      const glow = view.getByName('glow')
      const active = this.phase === 'move' && !this.isBot(pawn.color) && pawn.color === this.currentColor && this.canMove(pawn)
      view.setAlpha(active ? 1 : 0.92)
      this.tweens.killTweensOf(view)
      if (active) {
        glow?.setFillStyle(COLOR_HEX[pawn.color], 0.28)
        const stackScale = view.getData('stackScale') ?? 1
        this.tweens.add({
          targets: view,
          scale: stackScale * 1.14,
          duration: 320,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        })
        this.createActivePawnZone(pawn, view)
      } else {
        glow?.setFillStyle(0xffffff, 0)
        view.setScale(view.getData('stackScale') ?? 1)
      }
    })
  }

  updateShieldVisuals() {
    this.pawns.forEach((pawn) => {
      const view = this.pawnViews.get(pawn)
      const shield = view?.getByName('shield')
      if (!shield) return
      // bubble only matters for pawns out on the track
      const wanted = this.shieldedColors.has(pawn.color) && pawn.steps >= 0 && !pawn.finished
      this.tweens.killTweensOf(shield)
      if (!wanted) {
        if (shield.visible && !prefersReducedMotion) {
          this.tweens.add({
            targets: shield, alpha: 0, scale: 0.6, duration: dur(180),
            onComplete: () => shield.setVisible(false),
          })
        } else {
          shield.setVisible(false)
        }
        return
      }
      const forming = !shield.visible
      shield.setVisible(true)
      if (forming && !prefersReducedMotion) {
        shield.setScale(1.7).setAlpha(0)
        this.tweens.add({ targets: shield, scale: 1, alpha: 1, duration: dur(300), ease: EASE.pop })
        this.shieldBurst(view.x, view.y + shield.y * view.scaleY)
      } else {
        shield.setScale(1).setAlpha(1)
      }
      if (!prefersReducedMotion) {
        this.tweens.add({
          targets: shield, scale: 1.07,
          duration: 900, yoyo: true, repeat: -1, ease: EASE.breathe,
        })
      }
    })
  }

  shieldBurst(x, y) {
    const ring = this.add.circle(x, y, 20, 0x8fe6ff, 0).setStrokeStyle(4, 0xcdf4ff, 0.9).setDepth(46)
    this.tweens.add({
      targets: ring, radius: 46, alpha: 0, duration: dur(360), ease: EASE.out,
      onComplete: () => ring.destroy(),
    })
  }

  createActivePawnZone(pawn, view) {
    const stackScale = view.getData('stackScale') ?? 1
    const centerY = pawn.steps >= 0 ? -4 : -20
    const zone = this.add.zone(view.x, view.y + centerY * stackScale, Math.max(42, 62 * stackScale), Math.max(48, 70 * stackScale))
      .setDepth(90)
      .setInteractive({ useHandCursor: true })
    zone.on('pointerover', () => {
      if (this.phase !== 'move') return
      view.setDepth(40)
    })
    zone.on('pointerout', () => {
      view.setDepth(20)
    })
    zone.on('pointerup', () => this.tryMovePawn(pawn))
    this.activePawnZones.push(zone)
  }

  clearActivePawnZones() {
    this.activePawnZones.forEach((zone) => zone.destroy())
    this.activePawnZones = []
  }

  makeDiceTextures() {
    for (let face = 1; face <= 6; face++) {
      const key = `dice-${face}`
      if (this.textures.exists(key)) continue
      const size = 74
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      const gradient = ctx.createLinearGradient(0, 0, 0, size)
      gradient.addColorStop(0, '#fff8e8')
      gradient.addColorStop(1, '#ffd260')
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
      ctx.beginPath()
      ctx.roundRect(7, 9, 58, 58, 14)
      ctx.fill()
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.roundRect(4, 3, 60, 60, 14)
      ctx.fill()
      ctx.lineWidth = 4
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
      const spots = {
        1: [[34, 33]],
        2: [[22, 21], [46, 45]],
        3: [[22, 21], [34, 33], [46, 45]],
        4: [[22, 21], [46, 21], [22, 45], [46, 45]],
        5: [[22, 21], [46, 21], [34, 33], [22, 45], [46, 45]],
        6: [[22, 20], [46, 20], [22, 33], [46, 33], [22, 46], [46, 46]],
      }[face]
      ctx.fillStyle = '#3c2b12'
      spots.forEach(([x, y]) => {
        ctx.beginPath()
        ctx.arc(x, y, 5, 0, Math.PI * 2)
        ctx.fill()
      })
      this.textures.addCanvas(key, canvas)
    }
  }

  makeElementalEffectTextures() {
    if (!this.textures.exists('fx-flame')) {
      const g = this.make.graphics()
      g.fillStyle(0xffffff, 1)
      g.fillTriangle(8, 0, 16, 20, 0, 20)
      g.fillTriangle(8, 5, 13, 20, 3, 20)
      g.generateTexture('fx-flame', 16, 22)

      g.clear()
      g.fillStyle(0xffffff, 1)
      g.fillCircle(7, 10, 7)
      g.fillTriangle(7, 0, 13, 11, 1, 11)
      g.generateTexture('fx-drop', 14, 18)

      g.clear()
      g.fillStyle(0xffffff, 1)
      g.fillEllipse(10, 7, 18, 11)
      g.lineStyle(2, 0xffffff, 1)
      g.lineBetween(3, 11, 17, 3)
      g.generateTexture('fx-leaf', 20, 14)

      g.clear()
      g.fillStyle(0xffffff, 1)
      g.fillTriangle(8, 0, 2, 13, 8, 12)
      g.fillTriangle(8, 12, 3, 26, 16, 8)
      g.generateTexture('fx-bolt', 18, 28)
      g.destroy()
    }
  }

  popAt(x, y, color) {
    if (!this.textures.exists('classic-spark')) {
      const g = this.make.graphics()
      g.fillStyle(0xffffff, 1)
      g.fillCircle(6, 6, 6)
      g.generateTexture('classic-spark', 12, 12)
      g.destroy()
    }
    this.add.particles(x, y, 'classic-spark', {
      speed: { min: 90, max: 230 },
      scale: { start: 1, end: 0 },
      lifespan: 380,
      quantity: 16,
      emitting: false,
      tint: [color, 0xffffff, 0xffd85e],
    }).explode(16, x, y)
  }
}
