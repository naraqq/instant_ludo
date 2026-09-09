import { W, H } from '../config.js'
import { UIScene } from '../ui/UIScene.js'
import { DUR, EASE, dur, prefersReducedMotion } from '../ui/tokens.js'
import { store } from '../store.js'
import { COLORS, PAWN_ASSETS, POWER_TYPES } from '@ludo/engine'
import { TURN_SECONDS } from './classic/constants.js'
import { GeometryMixin } from './classic/geometry.js'
import { BoardViewMixin } from './classic/boardView.js'
import { PlayersMixin } from './classic/players.js'
import { PawnsMixin } from './classic/pawns.js'
import { PowersMixin } from './classic/powers.js'
import { CombatMixin } from './classic/combat.js'
import { DiceMixin } from './classic/dice.js'
import { DiceAnimMixin } from './classic/diceAnim.js'
import { TurnMixin } from './classic/turn.js'

// The scene shell: lifecycle (init/preload/create) plus the turn-rotation
// accessors. Every other system lives in a mixin under ./classic/ and is folded
// onto the prototype by the Object.assign below - they all share this `this`.
export class ClassicScene extends UIScene {
  constructor() {
    super('Classic')
    this.pawnViews = new Map()
    this.gateViews = []
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
    // power-*: the fire/water/earth power icons (double / control / shield),
    // shown on the bottom bar and in the gate picker.
    ;['fire', 'water', 'earth'].forEach((type) =>
      this.load.image(`power-${type}`, `assets/sprites/power-${type}.png`))
    // gateline-*: pillars + energy barrier, drawn across a track seam.
    POWER_TYPES.forEach((type) =>
      this.load.image(`gateline-${type}`, `assets/sprites/gateline-${type}.png`))
    // the "+1" bonus-roll rune, scattered on the board
    this.load.image('rune-bonus', 'assets/sprites/rune-bonus.png')
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
    // TEST: start everyone with one of each power. Revert to all-0 for release.
    this.powerInventory = Object.fromEntries(
      COLORS.map((color) => [color, { fire: 1, water: 1, earth: 1 }])
    )
    this.gateViews = []
    this.gates = []
    this.bonusRunes = []
    this.bonusRuneViews = new Map()
    this.homeMarks = []
    this.gatePicker = null
    this.gatePickerTimeout = null
    this._gatePass = false
    this._gatePickOwner = null
    this._gatePickChoose = null
    this.pendingExtraRoll = new Set()
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
    this.createGates()
    this.createBonusRunes()
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

    const sprites = [...this.pawnViews.values(), ...this.gateViews, ...this.bonusRuneViews.values()]
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

    // power buttons appear on their own once the player picks a rune at a gate

    this.time.delayedCall(dur(720), () => {
      this.refreshTurnUI()
      this.beginTurn()
    })
  }
}

Object.assign(
  ClassicScene.prototype,
  GeometryMixin,
  BoardViewMixin,
  PlayersMixin,
  PawnsMixin,
  PowersMixin,
  CombatMixin,
  DiceAnimMixin,
  DiceMixin,
  TurnMixin,
)
