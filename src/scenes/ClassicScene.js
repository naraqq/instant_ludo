import Phaser from 'phaser'
import { W, H, CONTENT_W } from '../config.js'
import { UIScene } from '../ui/UIScene.js'
import { sfx } from '../audio.js'
import { store } from '../store.js'
import { chooseAiMove, chooseAiPower, bestForcedDice } from '../ai.js'
import {
  COLORS,
  COLOR_HEX,
  COLOR_DARK,
  COLOR_LIGHT,
  PAWN_ASSETS,
  POWER_TYPES,
  SAFE_STOPS,
  START_INDEX,
  HOME_LANES,
  YARDS,
  TRACK,
} from './board.js'

const TILE = 44
const BOARD_SIZE = TILE * 15
const BOARD_X = (W - BOARD_SIZE) / 2
const BOARD_Y = 156
const BOARD_BOTTOM = BOARD_Y + BOARD_SIZE
const TURN_SECONDS = 30

const BAR_Y = 1224 // bottom action bar

// Where each player's avatar pod + dice sit, relative to their board corner.
const POD = {
  red: { ax: 46, ay: BOARD_Y - 24, dx: BOARD_X + 118, dy: BOARD_Y - 46, dir: 'up' },
  green: { ax: W - 46, ay: BOARD_Y - 24, dx: BOARD_X + BOARD_SIZE - 118, dy: BOARD_Y - 46, dir: 'up' },
  blue: { ax: 46, ay: BOARD_BOTTOM + 24, dx: BOARD_X + 118, dy: BOARD_BOTTOM + 50, dir: 'down' },
  yellow: { ax: W - 46, ay: BOARD_BOTTOM + 24, dx: BOARD_X + BOARD_SIZE - 118, dy: BOARD_BOTTOM + 50, dir: 'down' },
}

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
    this.load.image('rune-sheet', 'assets/runes/elemental-powerups-sheet.png')
    Object.values(PAWN_ASSETS).forEach((asset) => {
      this.load.image(`pawn-src-${asset}`, `assets/pawns/${asset}.png`)
    })
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
    this.onRollResolved = null
    this.turnTimer = null
    this.turnSecondsLeft = TURN_SECONDS

    this.add.image(W / 2, H / 2, 'bg-classic')
    this.createBackdrop()
    this.createTopBar()
    this.createBoard()
    this.createPlayers()
    this.createRuneTextures()
    this.createBottomBar()
    this.createPawnTextures()
    this.createPawns()
    this.createPowerRunes()
    this.reflowPawns(false)
    this.refreshTurnUI()
    this.cameras.main.fadeIn(200, 0, 0, 0)
    this.time.delayedCall(500, () => this.beginTurn())
  }

  createBackdrop() {
    const g = this.add.graphics()
    g.fillStyle(0x060b22, 0.18)
    g.fillRect(0, 0, W, H)
    g.fillStyle(0xffffff, 0.03)
    g.fillCircle(96, 210, 120)
    g.fillCircle(636, 980, 150)
    g.fillCircle(120, 1120, 90)

    // faint 4-colour pinwheel crest in the open area below the board
    const cx = W / 2
    const cy = (BOARD_BOTTOM + (BAR_Y - 44)) / 2 + 4
    const r = 118
    const quads = [
      [COLOR_HEX.red, 180, 270],
      [COLOR_HEX.green, 270, 360],
      [COLOR_HEX.yellow, 0, 90],
      [COLOR_HEX.blue, 90, 180],
    ]
    quads.forEach(([col, a0, a1]) => {
      const cg = this.add.graphics().setDepth(1)
      cg.fillStyle(col, 0.06)
      cg.slice(cx, cy, r, Phaser.Math.DegToRad(a0), Phaser.Math.DegToRad(a1))
      cg.fillPath()
    })
    this.add.circle(cx, cy, r, 0xffffff, 0).setStrokeStyle(2, 0xffffff, 0.05).setDepth(1)
  }

  // Top strip: back / trophy / share on the left, coin pill on the right.
  createTopBar() {
    const y = 46
    this.makeRoundedRectTexture('topbtn', 50, 50, 0x3b2c78, 0x2a1e5c, 15, 0x6a58b8)
    const iconBtn = (x, glyph, onTap) => {
      const img = this.add.image(x, y, 'topbtn').setDepth(6).setAlpha(0.96)
      this.add.text(x, y - 1, glyph, { fontSize: 22 }).setOrigin(0.5).setDepth(7)
      const z = this.makeHitZone(x, y, 52, 52)
      this.addPressFeedback(z, img, () => { sfx.tap(); onTap() })
    }
    iconBtn(44, '‹', () => this.goTo('Home'))
    iconBtn(102, '🏆', () => this.showToast('Leaderboard coming soon'))
    iconBtn(160, '⤴', () => this.showToast('Invite friends — coming soon'))

    this.makeRoundedRectTexture('coin-pill', 168, 46, 0x2a1e5c, 0x211748, 23, 0x6a58b8)
    const pillX = W - 44 - 84
    this.add.image(pillX, y, 'coin-pill').setDepth(6).setAlpha(0.96)
    this.add.circle(pillX - 60, y, 15, 0xffcf3f).setStrokeStyle(2, 0xffe9a3).setDepth(7)
    this.add.text(pillX - 60, y - 1, '★', { fontSize: 15, color: '#8a5a00' }).setOrigin(0.5).setDepth(8)
    this.coinText = this.add.text(pillX - 34, y - 1, store.coins.toLocaleString(), {
      fontFamily: 'Verdana, sans-serif', fontSize: 18, color: '#ffe27a', fontStyle: 'bold',
    }).setOrigin(0, 0.5).setDepth(8)
    const plus = this.add.circle(pillX + 66, y, 17, 0x34c759).setStrokeStyle(2, 0x9affc0).setDepth(7)
    this.add.text(pillX + 66, y - 2, '+', {
      fontFamily: 'Verdana, sans-serif', fontSize: 22, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(8)
    const pz = this.makeHitZone(pillX + 66, y, 40, 40)
    this.addPressFeedback(pz, plus, () => this.showToast('Shop — coming soon'))

    // status line lives quietly in the open area below the board
    const midY = (BOARD_BOTTOM + (BAR_Y - 44)) / 2
    this.helpText = this.add.text(W / 2, midY - 16, '', {
      fontFamily: 'Verdana, sans-serif', fontSize: 20, color: '#efe6ff', fontStyle: 'bold',
      align: 'center', wordWrap: { width: CONTENT_W - 40 },
    }).setOrigin(0.5).setDepth(8)
    this.rollHint = this.add.text(W / 2, midY + 16, '', {
      fontFamily: 'Verdana, sans-serif', fontSize: 14, color: '#9f90d8',
    }).setOrigin(0.5).setDepth(8)
  }

  createBoard() {
    const boardSize = BOARD_SIZE
    this.add.rectangle(BOARD_X + boardSize / 2 + 9, BOARD_Y + boardSize / 2 + 14, boardSize + 30, boardSize + 30, 0x000000, 0.28)
    this.add.rectangle(BOARD_X + boardSize / 2, BOARD_Y + boardSize / 2, boardSize + 22, boardSize + 22, 0x19304e, 1)
    this.add.rectangle(BOARD_X + boardSize / 2, BOARD_Y + boardSize / 2, boardSize + 10, boardSize + 10, 0x0b1526, 0.22)

    const g = this.add.graphics()
    g.fillStyle(0xffffff, 1)
    g.fillRect(BOARD_X, BOARD_Y, boardSize, boardSize)
    COLORS.forEach((color) => this.drawYard(g, color))
    TRACK.forEach(([gx, gy], i) => this.drawSquare(g, gx, gy, SAFE_STOPS.has(i) ? 0xffe88c : 0xf8fbff))
    Object.entries(HOME_LANES).forEach(([color, cells]) => {
      cells.forEach(([gx, gy]) => this.drawSquare(g, gx, gy, COLOR_HEX[color], 1, color))
    })
    this.drawCenter(g)
    this.createHomeLabels()
  }

  createHomeLabels() {
    const spots = {
      red: [3, 0.62],
      green: [12, 0.62],
      blue: [3, 14.38],
      yellow: [12, 14.38],
    }
    this.homeLabels = {}
    Object.entries(spots).forEach(([color, [gx, gy]]) => {
      if (!this.activeColors.includes(color)) return
      const { x, y } = this.gridToPixel(gx, gy)
      const t = this.add.text(x, y, this.playerName(color), {
        fontFamily: 'Verdana, sans-serif', fontSize: 15, color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(15).setStroke('#00000055', 4)
      this.homeLabels[color] = t
    })
  }

  playerName(color) {
    if (color === this.youColor) return 'You'
    if (this.isBot(color)) {
      const botIdx = this.activeColors.filter((c) => this.isBot(c)).indexOf(color) + 1
      return `CPU ${botIdx}`
    }
    return color[0].toUpperCase() + color.slice(1)
  }

  drawYard(g, color) {
    const [gx, gy] = YARDS[color].box
    const x = BOARD_X + gx * TILE
    const y = BOARD_Y + gy * TILE
    g.fillStyle(COLOR_HEX[color], 1)
    g.fillRect(x, y, TILE * 6, TILE * 6)
    g.fillStyle(COLOR_LIGHT[color], 0.2)
    g.fillRect(x, y, TILE * 6, TILE * 1.15)
    g.fillStyle(COLOR_DARK[color], 0.2)
    g.fillRect(x, y + TILE * 5.5, TILE * 6, TILE * 0.5)
    g.fillStyle(0xffffff, 1)
    g.fillRoundedRect(x + TILE, y + TILE, TILE * 4, TILE * 4, 18)
    g.fillStyle(0x000000, 0.08)
    g.fillRoundedRect(x + TILE + 4, y + TILE + 7, TILE * 4, TILE * 4, 18)
    g.fillStyle(0xffffff, 1)
    g.fillRoundedRect(x + TILE, y + TILE, TILE * 4, TILE * 4, 18)
    YARDS[color].pawns.forEach(([px, py]) => {
      g.fillStyle(0xeff4fb, 1)
      g.fillCircle(BOARD_X + px * TILE, BOARD_Y + py * TILE, 18)
    })
  }

  drawSquare(g, gx, gy, color, alpha = 1, laneColor) {
    const x = BOARD_X + gx * TILE
    const y = BOARD_Y + gy * TILE
    g.fillStyle(color, alpha)
    g.fillRect(x, y, TILE, TILE)
    if (laneColor) {
      g.fillStyle(COLOR_LIGHT[laneColor], 0.18)
      g.fillRect(x, y, TILE, 4)
      g.fillStyle(COLOR_DARK[laneColor], 0.08)
      g.fillRect(x, y + TILE - 4, TILE, 4)
      g.lineStyle(1, COLOR_DARK[laneColor], 0.36)
      g.strokeRect(x, y, TILE, TILE)
    } else if (color !== 0xf8fbff) {
      g.fillStyle(0xffffff, 0.18)
      g.fillRect(x, y, TILE, 5)
      g.fillStyle(0x000000, 0.08)
      g.fillRect(x, y + TILE - 5, TILE, 5)
      g.lineStyle(1, 0x9b7c24, 0.3)
      g.strokeRect(x, y, TILE, TILE)
    } else {
      g.lineStyle(1, 0x8790a2, 0.38)
      g.strokeRect(x, y, TILE, TILE)
    }
    if (SAFE_STOPS.has(TRACK.findIndex(([tx, ty]) => tx === gx && ty === gy))) {
      this.add.text(x + TILE / 2, y + TILE / 2, '*', {
        fontFamily: 'Verdana, sans-serif',
        fontSize: 16,
        color: '#7d5c00',
        fontStyle: 'bold',
      }).setOrigin(0.5).setAlpha(0.5)
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
    this.add.text(cx, cy, '*', {
      fontFamily: 'Verdana, sans-serif',
      fontSize: 36,
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setStroke('#00000033', 4)
  }

  createPlayers() {
    this.playerBadges = {}
    this.cornerDice = {}
    const faces = { red: '🔥', green: '🌿', yellow: '💨', blue: '💧' }

    COLORS.forEach((color) => {
      const pod = POD[color]
      const c = this.add.container(pod.ax, pod.ay).setDepth(30)
      c.add(this.add.circle(3, 4, 24, 0x000000, 0.32))
      const ring = this.add.circle(0, 0, 28, COLOR_HEX[color], 0.001)
      ring.name = 'ring'
      c.add(ring)
      c.add(this.add.circle(0, 0, 23, 0x2a1f56).setStrokeStyle(4, COLOR_HEX[color]))
      c.add(this.add.text(0, 1, faces[color], { fontSize: 22 }).setOrigin(0.5))
      const arc = this.add.graphics()
      arc.name = 'arc'
      c.add(arc)

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
    this.makeRoundedRectTexture(`dice-well-${color}`, 64, 64, COLOR_HEX[color], COLOR_DARK[color], 15, 0xffffff)
    const glow = this.add.circle(0, 0, 42, 0xffffff, 0)
    glow.name = 'glow'
    const shadow = this.add.ellipse(3, 28, 54, 13, 0x000000, 0.3)
    const well = this.add.image(0, 0, `dice-well-${color}`).setAlpha(0.98)
    const face = this.add.image(0, -1, 'dice-1').setScale(0.58)
    container.add([glow, shadow, well, face])
    container.setVisible(false)
    const zone = this.makeHitZone(pod.dx, pod.dy, 78, 78)
    this.addPressFeedback(zone, container, () => {
      if (!this.isBot(this.currentColor)) this.rollDice()
    })
    return { container, face, glow }
  }

  createBottomBar() {
    this.makeRoundedRectTexture('bottom-bar', W + 40, 118, 0x271c58, 0x1a1140, 30, 0x4c3d94)
    this.add.image(W / 2, BAR_Y + 30, 'bottom-bar').setAlpha(0.98).setDepth(38)
    this.add.rectangle(W / 2, BAR_Y - 26, W - 48, 3, 0xffffff, 0.12).setDepth(39)

    // chat pill (left)
    this.makeRoundedRectTexture('chat-pill', 108, 46, 0x3d6bd6, 0x2f52ab, 23, 0x7ba0f0)
    const chat = this.add.container(80, BAR_Y).setDepth(45)
    chat.add(this.add.image(0, 0, 'chat-pill'))
    chat.add(this.add.text(-14, 0, '💬', { fontSize: 18 }).setOrigin(0.5))
    chat.add(this.add.text(8, 0, 'Chat', {
      fontFamily: 'Verdana, sans-serif', fontSize: 14, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5))
    const chatZone = this.makeHitZone(80, BAR_Y, 112, 50)
    this.addPressFeedback(chatZone, chat, () => this.showToast('Chat coming soon'))

    // settings (right)
    this.makeRoundedRectTexture('bar-btn', 48, 48, 0x3b2c78, 0x2a1e5c, 15, 0x6a58b8)
    const setImg = this.add.image(W - 56, BAR_Y, 'bar-btn').setDepth(45)
    this.add.text(W - 56, BAR_Y - 1, '⚙', { fontSize: 20 }).setOrigin(0.5).setDepth(46)
    const setZone = this.makeHitZone(W - 56, BAR_Y, 52, 52)
    this.addPressFeedback(setZone, setImg, () => this.showToast('Settings — coming soon'))

    this.createPowerButtons()
  }

  createPowerButtons() {
    this.powerButtons = {}
    const y = BAR_Y
    const powers = [
      { key: 'fire', x: W / 2 - 88 },
      { key: 'water', x: W / 2 },
      { key: 'earth', x: W / 2 + 88 },
    ]
    this.makeRoundedRectTexture('power-btn', 70, 70, 0x4356c9, 0x2a3596, 18, 0x7b8bef)

    powers.forEach((power) => {
      const c = this.add.container(power.x, y).setDepth(48)
      c.add(this.add.circle(3, 5, 35, 0x000000, 0.24))
      c.add(this.add.image(0, 0, 'power-btn'))
      c.add(this.add.image(0, -1, `rune-${power.key}`).setScale(0.085))
      const countBg = this.add.circle(22, -22, 12, 0xffd85e).setStrokeStyle(2, 0x7a5a10)
      const countText = this.add.text(22, -22, '0', {
        fontFamily: 'Verdana, sans-serif', fontSize: 11, color: '#3c2b12', fontStyle: 'bold',
      }).setOrigin(0.5)
      c.add([countBg, countText])
      const zone = this.makeHitZone(power.x, y, 70, 70)
      this.addPressFeedback(zone, c, () => this.usePower(power.key))
      this.powerButtons[power.key] = { container: c, countText }
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
    this.runeViews.get(id)?.destroy()
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
    const glow = {
      fire: 0xff7a2f,
      water: 0x58c9ff,
      earth: 0x73d96a,
      air: 0xffe16b,
    }[rune.type]
    const c = this.add.container(x, y).setDepth(18)
    c.add(this.add.circle(2, 5, 17, 0x000000, 0.22))
    c.add(this.add.circle(0, 0, 18, glow, 0.34))
    c.add(this.add.image(0, 0, `rune-${rune.type}`).setScale(0.05))
    this.tweens.add({
      targets: c,
      y: y - 4,
      scale: 1.08,
      duration: 760,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    return c
  }

  makePawnView(color) {
    const c = this.add.container(0, 0).setDepth(20)
    const glow = this.add.circle(0, 0, 28, COLOR_HEX[color], 0)
    glow.name = 'glow'
    const shield = this.add.circle(0, -10, 29, 0x9ee7ff, 0.16)
    shield.name = 'shield'
    shield.setVisible(false)
    const shadow = this.add.ellipse(3, 18, 40, 14, 0x000000, 0.28)
    shadow.name = 'shadow'
    const token = this.add.container(0, 0)
    token.name = 'token'
    const sprite = this.add.image(0, -16, `pawn-${color}`)
    sprite.setScale(76 / sprite.height)
    sprite.name = 'sprite'
    token.add(sprite)
    const zone = this.add.zone(0, 0, 58, 70)
    zone.name = 'zone'
    c.add([glow, shield, shadow, token, zone])
    return c
  }

  rollDice() {
    if (this.phase !== 'roll' || this.gameOver) return
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
    const doubleActive = this.doubleNextRoll
    this.forcedDiceValue = null
    this.doubleNextRoll = false
    this.helpText.setText('Rolling…')
    this.rollHint.setText('')
    let ticks = 0
    tray.setVisible(true).setAlpha(1)
    this.tweens.add({
      targets: tray,
      y: trayY - 22,
      angle: 540,
      scale: 1.16,
      duration: 360,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: tray,
          y: trayY,
          angle: 720,
          scale: 1,
          duration: 320,
          ease: 'Bounce.easeOut',
          onComplete: () => {
            tray.angle = 0
          },
        })
      },
    })
    this.tweens.add({
      targets: dice.glow,
      alpha: 0.55,
      scale: 1.35,
      duration: 340,
      yoyo: true,
      ease: 'Sine.easeInOut',
    })
    this.time.addEvent({
      delay: 55,
      repeat: 13,
      callback: () => {
        ticks++
        const rawValue = ticks === 14 && forcedValue ? forcedValue : Phaser.Math.Between(1, 6)
        dice.face.setTexture(`dice-${rawValue}`)
        if (ticks === 14) {
          this.rawDiceValue = rawValue
          this.diceValue = doubleActive ? rawValue * 2 : rawValue
          this.phase = 'move'
          this.refreshTurnUI()
          this.popAt(tray.x, tray.y, COLOR_HEX[color])
          sfx.land(rawValue)
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
        }
      },
    })
  }

  usePower(key) {
    if (this.gameOver) return
    const color = this.currentColor
    if (this.isBot(color)) return
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
      this.helpText.setText('Fire active. Your next dice result counts twice.')
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
      this.helpText.setText('Earth shield active until your next roll.')
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
    overlay.add(this.add.text(0, -34, 'Choose dice number', {
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
    this.stopTurnTimer()
    this.clearActivePawnZones()
    const from = pawn.steps
    const to = pawn.steps === -1 ? 0 : pawn.steps + this.diceValue
    pawn.steps = to
    if (pawn.steps >= 56) {
      pawn.finished = true
      pawn.steps = 56
    }
    this.animatePawn(pawn, from, pawn.steps, () => {
      this.collectPowerRune(pawn)
      const captured = this.collectCaptures(pawn)
      const finishTurn = () => {
        if (pawn.finished) {
          this.popAt(W / 2, BOARD_Y + TILE * 7.5, COLOR_HEX[pawn.color])
          sfx.rune()
        }
        this.checkForWinner(pawn.color)
        if (this.gameOver) return
        this.phase = 'roll'
        const keepsTurn = this.rawDiceValue === 6 || this.extraRollNextTurn
        if (!keepsTurn && !pawn.finished) this.advanceTurn()
        if (this.shieldedColors.has(pawn.color)) this.shieldExpiresOnOwnRoll.add(pawn.color)
        this.extraRollNextTurn = false
        this.diceValue = 0
        this.rawDiceValue = 0
        this.refreshTurnUI()
        this.reflowPawns(true)
        this.time.delayedCall(360, () => this.beginTurn())
      }

      if (captured.length > 0) {
        this.playCaptureSequence(pawn, captured, finishTurn)
      } else {
        finishTurn()
      }
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
    const keepsTurn = this.rawDiceValue === 6 || this.extraRollNextTurn
    this.phase = 'roll'
    if (!keepsTurn) this.advanceTurn()
    if (this.shieldedColors.has(color)) this.shieldExpiresOnOwnRoll.add(color)
    this.extraRollNextTurn = false
    this.diceValue = 0
    this.rawDiceValue = 0
    this.refreshTurnUI('No legal move')
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
    arc.arc(0, 0, 33, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false)
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
    this.showToast('Time up - auto play')
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

    const heading = youWon ? 'YOU WIN!' : this.youColor ? 'DEFEAT' : `${winner.toUpperCase()} WINS`
    card.add(this.add.text(0, -cardH / 2 + 66, heading, {
      fontFamily: 'Verdana, sans-serif', fontSize: 46, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setStroke('#00000055', 6))
    card.add(this.add.text(0, -cardH / 2 + 112, `${winner.toUpperCase()} got all four pawns home`, {
      fontFamily: 'Verdana, sans-serif', fontSize: 14, color: '#c9b8ff',
    }).setOrigin(0.5))

    const medals = ['1st', '2nd', '3rd', '4th']
    this.makeRoundedRectTexture('victory-row', cardW - 72, 50, 0x392b6b, 0x2a1f52, 12)
    ranking.forEach((color, i) => {
      const row = this.add.container(0, -cardH / 2 + 168 + i * 60)
      row.add(this.add.image(0, 0, 'victory-row'))
      row.add(this.add.circle(-cardW / 2 + 58, 0, 14, COLOR_HEX[color]))
      row.add(this.add.text(-cardW / 2 + 88, 0, medals[i], {
        fontFamily: 'Verdana, sans-serif', fontSize: 15, color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0, 0.5))
      const name = color === this.youColor ? 'YOU' : this.isBot(color) ? `${color.toUpperCase()} BOT` : color.toUpperCase()
      row.add(this.add.text(-cardW / 2 + 142, 0, name, {
        fontFamily: 'Verdana, sans-serif', fontSize: 13, color: '#d9ccff',
      }).setOrigin(0, 0.5))
      const finished = this.pawns.filter((p) => p.color === color && p.finished).length
      row.add(this.add.text(cardW / 2 - 54, 0, `${finished}/4 home`, {
        fontFamily: 'Verdana, sans-serif', fontSize: 12, color: '#a99cd6',
      }).setOrigin(1, 0.5))
      card.add(row)
    })

    let ry = -cardH / 2 + 168 + ranking.length * 60 + 34
    if (reward) {
      card.add(this.add.text(0, ry, `+${reward.coins.toLocaleString()} coins    +${reward.xp} XP`, {
        fontFamily: 'Verdana, sans-serif', fontSize: 19, color: '#ffe27a', fontStyle: 'bold',
      }).setOrigin(0.5))
      if (reward.captures) {
        card.add(this.add.text(0, ry + 26, `includes +${reward.captures * 12} capture bonus (${reward.captures} sent home)`, {
          fontFamily: 'Verdana, sans-serif', fontSize: 12, color: '#c9b8ff',
        }).setOrigin(0.5))
      }
      if (reward.levels > 0) {
        card.add(this.add.text(0, ry + 52, `LEVEL UP!   You are now level ${store.level}`, {
          fontFamily: 'Verdana, sans-serif', fontSize: 15, color: '#7cffb2', fontStyle: 'bold',
        }).setOrigin(0.5))
      }
    } else {
      card.add(this.add.text(0, ry, 'Local match - no rewards', {
        fontFamily: 'Verdana, sans-serif', fontSize: 14, color: '#a99cd6',
      }).setOrigin(0.5))
    }

    const by = cardH / 2 - 68
    this.makeRoundedRectTexture('victory-btn-primary', 214, 62, 0x34c759, 0x1f9d43, 16, 0x9affc0)
    this.makeRoundedRectTexture('victory-btn-ghost', 214, 62, 0x3a2c66, 0x2a2050, 16, 0x6a5aa8)
    const rematch = this.add.container(-116, by, [
      this.add.image(0, 0, 'victory-btn-primary'),
      this.add.text(0, 0, 'REMATCH', { fontFamily: 'Verdana, sans-serif', fontSize: 19, color: '#08240f', fontStyle: 'bold' }).setOrigin(0.5),
    ])
    const home = this.add.container(116, by, [
      this.add.image(0, 0, 'victory-btn-ghost'),
      this.add.text(0, 0, 'HOME', { fontFamily: 'Verdana, sans-serif', fontSize: 19, color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5),
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
    const aura = this.add.circle(badge.x, badge.y, 32, 0xffffff, 0).setStrokeStyle(5, 0x9ee7ff, 0.85).setDepth(42)
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
    const shield = this.add.circle(view.x, view.y, 10, 0x9ee7ff, 0.12).setStrokeStyle(5, 0xd9fbff, 0.9).setDepth(47)
    this.tweens.add({
      targets: shield,
      radius: 46,
      alpha: 0,
      duration: 380,
      ease: 'Cubic.easeOut',
      onComplete: () => shield.destroy(),
    })
    this.tweens.add({
      targets: view,
      scale: (view.getData('stackScale') ?? 1) * 1.18,
      duration: 120,
      yoyo: true,
      ease: 'Sine.easeInOut',
    })
  }

  animatePawn(pawn, from, to, onComplete) {
    const view = this.pawnViews.get(pawn)
    this.tweens.killTweensOf(view)
    const token = view.getByName('token')
    const shadow = view.getByName('shadow')
    const path = []
    if (from === -1) {
      path.push(0)
    } else {
      for (let step = from + 1; step <= to; step++) path.push(step)
    }
    const hopNext = () => {
      const step = path.shift()
      if (step === undefined) {
        view.setScale(view.getData('stackScale') ?? 1)
        onComplete?.()
        return
      }
      sfx.hop()
      const target = this.getPixelFor(pawn.color, step)
      this.tweens.add({
        targets: token,
        y: -7,
        duration: 82,
        yoyo: true,
        ease: 'Sine.easeInOut',
      })
      this.tweens.add({
        targets: shadow,
        scaleX: 0.78,
        alpha: 0.18,
        duration: 82,
        yoyo: true,
        ease: 'Sine.easeInOut',
      })
      this.tweens.add({
        targets: view,
        x: target.x,
        y: target.y,
        duration: 165,
        ease: 'Cubic.easeInOut',
        onComplete: hopNext,
      })
    }
    hopNext()
  }

  positionPawn(pawn, animate) {
    const view = this.pawnViews.get(pawn)
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
      const [gx, gy] = YARDS[pawn.color].pawns[pawn.id]
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

  collectPowerRune(pawn) {
    const cell = this.getPawnCell(pawn)
    if (cell.type !== 'track') return
    const rune = this.powerRunes.find((item) => item.index === cell.index)
    if (!rune) return
    sfx.rune()

    if (rune.type === 'air') {
      this.extraRollNextTurn = true
      this.animateRuneCollect(rune, pawn.color)
      this.spawnPowerRune(rune.type, rune.slot)
      this.helpText.setText('Air rune collected. You keep the dice after this move.')
      return
    }

    this.powerInventory[pawn.color][rune.type]++
    this.animateRuneCollect(rune, pawn.color)
    this.spawnPowerRune(rune.type, rune.slot)
    this.updatePowerButtons()
  }

  animateRuneCollect(rune, color) {
    const view = this.runeViews.get(rune.id)
    if (!view) return
    const target = this.powerButtons?.[rune.type]?.container
    const clone = this.createRuneView(rune)
    clone.setDepth(60)
    view.destroy()
    this.popAt(clone.x, clone.y, COLOR_HEX[color])
    this.tweens.killTweensOf(clone)
    if (rune.type === 'air') {
      this.tweens.add({
        targets: clone,
        y: clone.y - 34,
        scale: 1.35,
        alpha: 0,
        duration: 440,
        ease: 'Cubic.easeOut',
        onComplete: () => clone.destroy(),
      })
      return
    }
    if (!target) {
      clone.destroy()
      return
    }

    this.tweens.add({
      targets: clone,
      x: target.x,
      y: target.y,
      scale: 0.35,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.easeInOut',
      onComplete: () => {
        clone.destroy()
        this.flashPower(rune.type)
      },
    })
  }

  refreshTurnUI(prefix) {
    const color = this.currentColor
    const bot = this.isBot(color)
    const name = this.playerName(color)

    // active player's pod lifts + glows; others recede
    Object.entries(this.playerBadges).forEach(([key, badge]) => {
      const on = key === color
      this.tweens.add({ targets: badge, scale: on ? 1.14 : 1, duration: 160, ease: 'Back.easeOut' })
      badge.setAlpha(on ? 1 : 0.62)
      const ring = badge.getByName('ring')
      if (ring) {
        this.tweens.killTweensOf(ring)
        ring.setFillStyle(COLOR_HEX[key], on ? 0.35 : 0.001)
        if (on) {
          this.tweens.add({ targets: ring, scale: 1.14, alpha: 0.6, duration: 720, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
        } else {
          ring.setScale(1)
        }
      }
      if (!on) badge.getByName('arc')?.clear()
    })

    // only the active player's dice is shown, near their pod
    Object.entries(this.cornerDice).forEach(([key, dice]) => {
      const on = key === color && this.activeColors.includes(key)
      dice.container.setVisible(on)
      if (!on) return
      this.tweens.killTweensOf(dice.glow)
      if (!bot && this.phase === 'roll') {
        dice.container.setAlpha(1)
        dice.glow.setScale(1)
        this.tweens.add({ targets: dice.glow, alpha: 0.4, scale: 1.3, duration: 760, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
      } else {
        dice.container.setAlpha(bot ? 0.92 : 1)
        dice.glow.setAlpha(0)
      }
    })

    if (this.phase === 'move') {
      const moves = this.getMovesForCurrentPlayer().length
      const rollLabel = this.rawDiceValue && this.rawDiceValue !== this.diceValue ? `${this.rawDiceValue}×2 = ${this.diceValue}` : `${this.diceValue}`
      if (bot) {
        this.helpText.setText(`${name} rolled ${rollLabel}`)
        this.rollHint.setText('moving…')
      } else {
        this.helpText.setText(moves > 0 ? `You rolled ${rollLabel}` : `You rolled ${rollLabel} — no move`)
        this.rollHint.setText(moves > 0 ? 'tap a glowing pawn' : '')
      }
    } else if (bot) {
      this.helpText.setText(`${name}'s turn`)
      this.rollHint.setText('rolling…')
    } else {
      this.helpText.setText(prefix ? prefix : 'Your turn')
      this.rollHint.setText('tap your dice to roll')
    }
    this.updatePawnHighlights()
    this.updatePowerButtons()
  }

  updatePowerButtons() {
    if (!this.powerButtons) return
    const color = this.currentColor
    const inventory = this.powerInventory[color]
    const human = !this.isBot(color)
    Object.entries(this.powerButtons).forEach(([key, button]) => {
      const count = inventory?.[key] ?? 0
      const enabled = human && count > 0 && this.phase === 'roll'
      button.countText.setText(`${count}`)
      button.container.setAlpha(enabled ? 1 : 0.42)
    })
  }

  updatePawnHighlights() {
    this.clearActivePawnZones()
    this.pawns.forEach((pawn) => {
      const view = this.pawnViews.get(pawn)
      const glow = view.getByName('glow')
      const shield = view.getByName('shield')
      const active = this.phase === 'move' && !this.isBot(pawn.color) && pawn.color === this.currentColor && this.canMove(pawn)
      view.setAlpha(active ? 1 : 0.92)
      this.tweens.killTweensOf(view)
      this.tweens.killTweensOf(shield)
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
      if (shield?.visible) {
        this.tweens.add({
          targets: shield,
          scale: 1.08,
          alpha: 0.72,
          duration: 650,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        })
      }
    })
  }

  updateShieldVisuals() {
    this.pawns.forEach((pawn) => {
      const view = this.pawnViews.get(pawn)
      const shield = view?.getByName('shield')
      if (!shield) return
      const visible = this.shieldedColors.has(pawn.color) && !pawn.finished
      shield.setVisible(visible)
      shield.setAlpha(visible ? 0.72 : 0)
      shield.setScale(1)
      this.tweens.killTweensOf(shield)
      if (visible) {
        this.tweens.add({
          targets: shield,
          scale: 1.08,
          alpha: 0.72,
          duration: 650,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        })
      }
    })
  }

  createActivePawnZone(pawn, view) {
    const stackScale = view.getData('stackScale') ?? 1
    const zone = this.add.zone(view.x, view.y - 4, Math.max(42, 62 * stackScale), Math.max(48, 70 * stackScale))
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

  createPawnTextures() {
    Object.entries(PAWN_ASSETS).forEach(([color, asset]) => {
      const key = `pawn-${color}`
      if (this.textures.exists(key)) this.textures.remove(key)
      this.createTransparentPawnTexture(`pawn-src-${asset}`, key)
    })
  }

  createRuneTextures() {
    const source = this.textures.get('rune-sheet').getSourceImage()
    const names = ['fire', 'water', 'earth', 'air']
    const frameW = source.width / names.length
    names.forEach((name, index) => {
      const key = `rune-${name}`
      if (this.textures.exists(key)) this.textures.remove(key)
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(frameW)
      canvas.height = source.height
      canvas
        .getContext('2d')
        .drawImage(source, index * frameW, 0, frameW, source.height, 0, 0, canvas.width, canvas.height)
      this.textures.addCanvas(key, canvas)
    })
  }

  createTransparentPawnTexture(srcKey, outKey) {
    const source = this.textures.get(srcKey).getSourceImage()
    const canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(source, 0, 0)

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const { data, width, height } = image
    const seen = new Uint8Array(width * height)
    const queue = []

    const enqueue = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return
      const index = y * width + x
      if (seen[index]) return
      seen[index] = 1
      const offset = index * 4
      const r = data[offset]
      const g = data[offset + 1]
      const b = data[offset + 2]
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const avg = (r + g + b) / 3
      if (max - min <= 10 && avg >= 218) queue.push([x, y])
    }

    for (let x = 0; x < width; x++) {
      enqueue(x, 0)
      enqueue(x, height - 1)
    }
    for (let y = 0; y < height; y++) {
      enqueue(0, y)
      enqueue(width - 1, y)
    }

    let cursor = 0
    while (cursor < queue.length) {
      const [x, y] = queue[cursor++]
      const offset = (y * width + x) * 4
      data[offset + 3] = 0
      enqueue(x + 1, y)
      enqueue(x - 1, y)
      enqueue(x, y + 1)
      enqueue(x, y - 1)
    }

    ctx.putImageData(image, 0, 0)
    const box = this.findVisibleBounds(data, width, height)
    if (!box) {
      this.textures.addCanvas(outKey, canvas)
      return
    }

    const pad = 16
    const sx = Math.max(0, box.minX - pad)
    const sy = Math.max(0, box.minY - pad)
    const sw = Math.min(width - sx, box.maxX - box.minX + pad * 2)
    const sh = Math.min(height - sy, box.maxY - box.minY + pad * 2)
    const cropped = document.createElement('canvas')
    cropped.width = sw
    cropped.height = sh
    cropped.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)
    this.textures.addCanvas(outKey, cropped)
  }

  findVisibleBounds(data, width, height) {
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4
        if (data[offset + 3] === 0) continue
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    if (maxX < minX || maxY < minY) return null
    return { minX, minY, maxX, maxY }
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
