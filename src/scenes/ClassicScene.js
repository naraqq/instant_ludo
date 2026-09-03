import Phaser from 'phaser'
import { W, H, CONTENT_W } from '../config.js'
import { UIScene } from '../ui/UIScene.js'

const TILE = 40
const BOARD_SIZE = TILE * 15
const BOARD_X = (W - BOARD_SIZE) / 2
const BOARD_Y = 250
const COLORS = ['red', 'green', 'yellow', 'blue']
const COLOR_HEX = {
  red: 0xe94a42,
  green: 0x25bd5c,
  yellow: 0xf0c433,
  blue: 0x2f87e8,
}
const COLOR_DARK = {
  red: 0xad2d2a,
  green: 0x127a3a,
  yellow: 0xa97c08,
  blue: 0x1b57a6,
}
const COLOR_LIGHT = {
  red: 0xff6b60,
  green: 0x45dd77,
  yellow: 0xffde55,
  blue: 0x5aa5ff,
}
const PAWN_ASSETS = {
  red: 'fire',
  green: 'earth',
  yellow: 'air',
  blue: 'water',
}
const POWER_TYPES = ['fire', 'water', 'earth', 'air']
const SAFE_STOPS = new Set([0, 8, 13, 21, 26, 34, 39, 47])
const START_INDEX = { red: 13, green: 26, yellow: 39, blue: 0 }
const HOME_LANES = {
  red: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  green: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  yellow: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  blue: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
}
const YARDS = {
  red: { box: [0, 0], pawns: [[2, 2], [4, 2], [2, 4], [4, 4]] },
  green: { box: [9, 0], pawns: [[11, 2], [13, 2], [11, 4], [13, 4]] },
  yellow: { box: [9, 9], pawns: [[11, 11], [13, 11], [11, 13], [13, 13]] },
  blue: { box: [0, 9], pawns: [[2, 11], [4, 11], [2, 13], [4, 13]] },
}
const TRACK = [
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8], [0, 7], [0, 6],
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0], [7, 0], [8, 0],
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6], [14, 7], [14, 8],
  [13, 8], [12, 8], [11, 8], [10, 8], [9, 8], [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14], [7, 14], [6, 14],
]

export class ClassicScene extends UIScene {
  constructor() {
    super('Classic')
    this.currentPlayer = 0
    this.diceValue = 0
    this.rawDiceValue = 0
    this.forcedDiceValue = null
    this.doubleNextRoll = false
    this.extraRollNextTurn = false
    this.phase = 'roll'
    this.pawns = []
    this.pawnViews = new Map()
    this.powerInventory = {}
    this.powerRunes = []
    this.runeViews = new Map()
    this.activePawnZones = []
    this.shieldedColors = new Set()
    this.shieldExpiresOnOwnRoll = new Set()
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

    this.add.image(W / 2, H / 2, 'bg-classic')
    this.createBackdrop()
    this.createTopChrome()
    this.createBoard()
    this.createPlayers()
    this.createRuneTextures()
    this.createDicePanel()
    this.createBackButton()
    this.createPawnTextures()
    this.createPawns()
    this.createPowerRunes()
    this.reflowPawns(false)
    this.refreshTurnUI()
    this.cameras.main.fadeIn(200, 0, 0, 0)
  }

  createBackdrop() {
    const g = this.add.graphics()
    g.fillStyle(0x060b22, 0.16)
    g.fillRect(0, 0, W, H)
    g.fillStyle(0xffffff, 0.035)
    g.fillCircle(92, 188, 88)
    g.fillCircle(644, 830, 126)
    g.lineStyle(1, 0xffffff, 0.055)
    for (let y = 206; y < 936; y += 132) {
      g.lineBetween(56, y, W - 56, y + 26)
    }
  }

  createTopChrome() {
    this.makeRoundedRectTexture('classic-title-card', CONTENT_W, 104, 0x342465, 0x251a58, 24, 0xbdeeff)
    this.add.image(W / 2, 82, 'classic-title-card').setAlpha(0.97)
    this.add.rectangle(W / 2, 126, CONTENT_W - 52, 1, 0xffffff, 0.14)
    this.add.text(W / 2, 56, 'CLASSIC', {
      fontFamily: 'Verdana, sans-serif',
      fontSize: 36,
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setStroke('#00000045', 4)

    COLORS.forEach((color) => {
      this.makeRoundedRectTexture(`turn-chip-${color}`, 188, 34, COLOR_HEX[color], COLOR_DARK[color], 7)
    })
    this.turnChip = this.add.container(W / 2, 100)
    this.turnChipBg = this.add.image(0, 0, 'turn-chip-red')
    this.statusText = this.add.text(0, 0, '', {
      fontFamily: 'Verdana, sans-serif',
      fontSize: 15,
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5)
    this.turnChip.add([this.turnChipBg, this.statusText])
  }

  createBackButton() {
    const zone = this.makeHitZone(60, 62, 58, 58)
    const btn = this.add.circle(60, 62, 24, 0x0a1729, 0.75)
    this.add.text(60, 61, '<', {
      fontFamily: 'Verdana, sans-serif',
      fontSize: 25,
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5)
    this.addPressFeedback(zone, btn, () => this.goTo('Home'))
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
    this.playerDice = {}
    const positions = [
      ['red', 110, 214, 178, 214],
      ['green', 610, 214, 542, 214],
      ['blue', 110, 895, 178, 895],
      ['yellow', 610, 895, 542, 895],
    ]
    positions.forEach(([color, x, y, diceX, diceY]) => {
      const c = this.add.container(x, y)
      c.add(this.add.circle(4, 7, 28, 0x000000, 0.22))
      const ring = this.add.circle(0, 0, 30, 0xffffff, 0.12)
      ring.name = 'ring'
      c.add(ring)
      c.add(this.add.circle(0, 0, 24, COLOR_HEX[color]))
      c.add(this.add.text(0, 0, color[0].toUpperCase(), {
        fontFamily: 'Verdana, sans-serif',
        fontSize: 22,
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5))
      c.add(this.add.text(0, 43, color.toUpperCase(), {
        fontFamily: 'Verdana, sans-serif',
        fontSize: 12,
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5))
      this.playerBadges[color] = c
      this.playerDice[color] = this.createPlayerDice(color, diceX, diceY)
    })
  }

  createPlayerDice(color, x, y) {
    const container = this.add.container(x, y).setDepth(35)
    this.makeRoundedRectTexture(`player-dice-bg-${color}`, 58, 58, COLOR_LIGHT[color], COLOR_HEX[color], 13)
    const glow = this.add.circle(0, 0, 34, COLOR_HEX[color], 0)
    glow.name = 'glow'
    const shadow = this.add.ellipse(3, 25, 48, 12, 0x000000, 0.22)
    const bg = this.add.image(0, 0, `player-dice-bg-${color}`).setAlpha(0.96)
    const face = this.add.image(0, -2, 'dice-1').setScale(0.6)
    container.add([glow, shadow, bg, face])
    const zone = this.makeHitZone(x, y, 68, 68)
    this.addPressFeedback(zone, container, () => this.rollDice())
    container.setAlpha(0.35)
    container.setScale(0.9)
    return { container, face, glow }
  }

  createDicePanel() {
    this.makeRoundedRectTexture('chat-pill', 92, 42, 0x415ec0, 0x31459b, 12)
    const chat = this.add.container(58, 1236).setDepth(45)
    chat.add(this.add.image(0, 0, 'chat-pill').setAlpha(0.95))
    chat.add(this.add.text(0, 0, 'Chat', {
      fontFamily: 'Verdana, sans-serif',
      fontSize: 16,
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5))
    const chatZone = this.makeHitZone(58, 1236, 92, 42)
    this.addPressFeedback(chatZone, chat, () => this.showToast('Chat coming soon'))

    this.turnDot = this.add.circle(270, 1132, 9, COLOR_HEX.red)
    this.actionLabel = this.add.text(290, 1120, 'RED TO MOVE', {
      fontFamily: 'Verdana, sans-serif',
      fontSize: 11,
      color: '#bcd7ff',
      fontStyle: 'bold',
    }).setOrigin(0, 0.5).setVisible(false)
    this.rollHint = this.add.text(W / 2, 1194, 'Tap dice to roll', {
      fontFamily: 'Verdana, sans-serif',
      fontSize: 15,
      color: '#d9edff',
      fontStyle: 'bold',
    }).setOrigin(0.5)

    this.diceTray = this.add.container(W / 2, 1142).setDepth(46)
    this.makeRoundedRectTexture('dice-well', 78, 78, 0x66d970, 0x209f46, 14)
    this.diceTray.add(this.add.ellipse(4, 33, 72, 15, 0x000000, 0.28))
    this.diceTray.add(this.add.image(0, 0, 'dice-well').setAlpha(0.98))
    this.diceFace = this.add.image(0, -2, 'dice-1').setScale(0.76)
    this.diceTray.add(this.diceFace)

    this.rollButton = this.diceTray
    this.diceText = this.add.text(0, 0, 'ROLL DICE', {
      fontFamily: 'Verdana, sans-serif',
      fontSize: 1,
      color: '#402800',
      fontStyle: 'bold',
    }).setOrigin(0.5).setVisible(false)
    const zone = this.makeHitZone(W / 2, 1142, 84, 84)
    this.addPressFeedback(zone, this.rollButton, () => this.rollDice())

    this.helpText = this.add.text(W / 2, 1170, '', {
      fontFamily: 'Verdana, sans-serif',
      fontSize: 12,
      color: '#c9ddf5',
      align: 'center',
      wordWrap: { width: CONTENT_W - 40 },
    }).setOrigin(0.5).setVisible(false)
    this.createPowerButtons()
  }

  createPowerButtons() {
    this.powerButtons = {}
    const powers = [
      { key: 'fire', x: W / 2 - 82, count: '0' },
      { key: 'water', x: W / 2, count: '0' },
      { key: 'earth', x: W / 2 + 82, count: '0' },
    ]

    powers.forEach((power) => {
      const c = this.add.container(power.x, 1232).setDepth(50)
      c.add(this.add.circle(3, 7, 27, 0x000000, 0.26))
      c.add(this.add.circle(0, 0, 28, 0x334bb0, 1))
      c.add(this.add.image(0, 0, `rune-${power.key}`).setScale(0.082))
      const countBg = this.add.circle(20, -20, 10, 0xffd85e)
      const countText = this.add.text(20, -20, power.count, {
        fontFamily: 'Verdana, sans-serif',
        fontSize: 10,
        color: '#3c2b12',
        fontStyle: 'bold',
      }).setOrigin(0.5)
      c.add([countBg, countText])
      const zone = this.makeHitZone(power.x, 1232, 62, 62)
      this.addPressFeedback(zone, c, () => this.usePower(power.key))
      this.powerButtons[power.key] = { container: c, countText }
    })
  }

  createPawns() {
    COLORS.forEach((color) => {
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
    sprite.setScale(68 / sprite.height)
    sprite.name = 'sprite'
    token.add(sprite)
    const zone = this.add.zone(0, 0, 58, 70)
    zone.name = 'zone'
    c.add([glow, shield, shadow, token, zone])
    return c
  }

  rollDice() {
    if (this.phase !== 'roll') return
    this.phase = 'rolling'
    const color = COLORS[this.currentPlayer]
    if (this.shieldedColors.has(color) && this.shieldExpiresOnOwnRoll.has(color)) {
      this.shieldedColors.delete(color)
      this.shieldExpiresOnOwnRoll.delete(color)
      this.updateShieldVisuals()
    }
    const activeDice = this.playerDice[color]
    const forcedValue = this.forcedDiceValue
    const doubleActive = this.doubleNextRoll
    this.forcedDiceValue = null
    this.doubleNextRoll = false
    this.helpText.setText('Rolling...')
    this.diceText.setText('ROLLING')
    this.rollHint.setText('Rolling')
    let ticks = 0
    this.tweens.add({
      targets: activeDice.container,
      y: activeDice.container.y - 18,
      angle: 540,
      scale: 1.35,
      duration: 360,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: activeDice.container,
          y: activeDice.container.y + 18,
          angle: 720,
          scale: 1.08,
          duration: 300,
          ease: 'Bounce.easeOut',
          onComplete: () => {
            activeDice.container.angle = 0
          },
        })
      },
    })
    this.tweens.add({
      targets: activeDice.glow,
      alpha: 0.42,
      scale: 1.35,
      duration: 330,
      yoyo: true,
      ease: 'Sine.easeInOut',
    })
    this.time.addEvent({
      delay: 55,
      repeat: 13,
      callback: () => {
        ticks++
        const rawValue = ticks === 14 && forcedValue ? forcedValue : Phaser.Math.Between(1, 6)
        activeDice.face.setTexture(`dice-${rawValue}`)
        this.diceFace.setTexture(`dice-${rawValue}`)
        this.rollButton.angle = Phaser.Math.Between(-4, 4)
        if (ticks === 14) {
          this.rawDiceValue = rawValue
          this.diceValue = doubleActive ? rawValue * 2 : rawValue
          this.rollButton.angle = 0
          this.diceText.setText(doubleActive ? `x2 ${this.diceValue}` : rawValue === 6 ? 'SIX!' : 'MOVE')
          this.phase = 'move'
          this.refreshTurnUI()
          this.popAt(activeDice.container.x, activeDice.container.y, COLOR_HEX[color])
          if (this.getMovesForCurrentPlayer().length === 0) {
            this.time.delayedCall(700, () => this.nextTurn())
          }
          this.updatePowerButtons()
        }
      },
    })
  }

  usePower(key) {
    const color = COLORS[this.currentPlayer]
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
    const color = COLORS[this.currentPlayer]
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
        this.updatePowerButtons()
        this.time.delayedCall(160, () => this.rollDice())
      })
      overlay.add(zone)
    }
    this.controllerPicker = overlay
  }

  tryMovePawn(pawn) {
    if (this.phase !== 'move' || pawn.color !== COLORS[this.currentPlayer] || !this.canMove(pawn)) return
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
        if (pawn.finished) this.popAt(W / 2, BOARD_Y + TILE * 7.5, COLOR_HEX[pawn.color])
        this.phase = 'roll'
        const keepsTurn = this.rawDiceValue === 6 || this.extraRollNextTurn
        if (!keepsTurn && !pawn.finished) this.currentPlayer = (this.currentPlayer + 1) % COLORS.length
        if (this.shieldedColors.has(pawn.color)) this.shieldExpiresOnOwnRoll.add(pawn.color)
        this.extraRollNextTurn = false
        this.diceValue = 0
        this.rawDiceValue = 0
        this.diceText.setText('ROLL DICE')
        this.refreshTurnUI()
        this.reflowPawns(true)
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
    const color = COLORS[this.currentPlayer]
    return this.pawns.filter((pawn) => pawn.color === color && this.canMove(pawn))
  }

  nextTurn() {
    const color = COLORS[this.currentPlayer]
    const keepsTurn = this.rawDiceValue === 6 || this.extraRollNextTurn
    this.phase = 'roll'
    if (!keepsTurn) this.currentPlayer = (this.currentPlayer + 1) % COLORS.length
    if (this.shieldedColors.has(color)) this.shieldExpiresOnOwnRoll.add(color)
    this.extraRollNextTurn = false
    this.diceValue = 0
    this.rawDiceValue = 0
    this.diceText.setText('ROLL DICE')
    this.refreshTurnUI('No legal move')
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
    const color = COLORS[this.currentPlayer]
    Object.entries(this.playerBadges).forEach(([key, badge]) => {
      this.tweens.add({ targets: badge, scale: key === color ? 1.18 : 1, duration: 150 })
      badge.setAlpha(key === color ? 1 : 0.72)
      const ring = badge.getByName('ring')
      if (ring) ring.setFillStyle(key === color ? COLOR_HEX[key] : 0xffffff, key === color ? 0.42 : 0.12)
    })
    Object.entries(this.playerDice).forEach(([key, dice]) => {
      const active = key === color
      dice.container.setAlpha(active ? 1 : 0.34)
      dice.glow.setFillStyle(COLOR_HEX[key], active ? 0.16 : 0)
      this.tweens.add({
        targets: dice.container,
        scale: active ? 1.08 : 0.86,
        duration: 170,
        ease: 'Sine.easeOut',
      })
    })
    this.turnChipBg.setTexture(`turn-chip-${color}`)
    this.turnDot.setFillStyle(COLOR_HEX[color], 1)
    this.statusText.setText(`${color.toUpperCase()}'S TURN`)
    if (this.phase === 'move') {
      const moves = this.getMovesForCurrentPlayer().length
      const rollLabel = this.rawDiceValue && this.rawDiceValue !== this.diceValue ? `${this.rawDiceValue} x2 = ${this.diceValue}` : `${this.diceValue}`
      this.helpText.setText(moves > 0 ? `Rolled ${rollLabel}. Tap a highlighted pawn.` : `Rolled ${rollLabel}. No legal move.`)
      this.actionLabel.setText(`${color.toUpperCase()} ROLLED ${rollLabel}`)
      this.rollHint.setText(moves > 0 ? 'Choose a pawn' : 'No move')
    } else {
      this.helpText.setText(prefix ? `${prefix}. ${color.toUpperCase()} rolls next.` : 'Roll a 6 to leave base. Sixes earn another roll.')
      this.actionLabel.setText(`${color.toUpperCase()}'S TURN`)
      this.rollHint.setText('Roll to play')
    }
    this.updatePawnHighlights()
    this.updatePowerButtons()
  }

  updatePowerButtons() {
    if (!this.powerButtons) return
    const color = COLORS[this.currentPlayer]
    const inventory = this.powerInventory[color]
    Object.entries(this.powerButtons).forEach(([key, button]) => {
      const count = inventory?.[key] ?? 0
      const enabled = count > 0 && this.phase === 'roll'
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
      const active = this.phase === 'move' && pawn.color === COLORS[this.currentPlayer] && this.canMove(pawn)
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
