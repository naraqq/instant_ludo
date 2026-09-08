// Online match scene. Reuses the Classic rendering mixins (board, pawns, pods,
// dice, combat FX) but the game is NOT run here - the Colyseus room is
// authoritative. This scene renders `room.state` and plays the `events` the
// server broadcasts after every action.
import { W, H } from '../config.js'
import { UIScene } from '../ui/UIScene.js'
import { DUR, EASE, dur } from '../ui/tokens.js'
import { sfx } from '../audio.js'
import { t } from '../i18n.js'
import { COLOR_HEX, COLORS, PAWN_ASSETS, POWER_TYPES } from '@ludo/engine'
import { GeometryMixin } from './classic/geometry.js'
import { BoardViewMixin } from './classic/boardView.js'
import { PlayersMixin } from './classic/players.js'
import { PawnsMixin } from './classic/pawns.js'
import { CombatMixin } from './classic/combat.js'
import { TILE, BOARD_Y } from './classic/constants.js'
import { joinMatch, tryReconnect, clearReconnect } from '../net/room.js'


export class NetLudoScene extends UIScene {
  constructor() {
    super('NetLudo')
    this.pawnViews = new Map()
    this.gateViews = []
    this.activePawnZones = []
    this.shieldedColors = new Set()
  }

  init(data) {
    this.matchConfig = { maxPlayers: 2, ...data }
    this.g = null
    this.seats = {}
    this.myColor = null
    this.phase = 'lobby'
    this.pawns = []
    this.room = null
    this._queue = Promise.resolve()
    this.gameOver = false
  }

  // ---- shims the reused rendering mixins read ----
  get currentColor() { return this.g ? (this.g.currentColor || this.g.colors[this.g.current]) : null }
  get activeColors() { return this.g?.colors ?? [] }
  get diceValue() { return this.g?.dice ?? 0 }
  get rawDiceValue() { return this.g?.raw ?? 0 }
  get doubleNextRoll() { return this.g?.doubleNext ?? false }
  get youColor() { return this.myColor }
  get powerBarColor() { return this.myColor }
  get myTurn() { return Boolean(this.g) && this.currentColor === this.myColor }

  isBot(color) { return this.seats[color]?.bot ?? false }
  playerName(color) {
    if (color === this.myColor) return t('classic.you')
    return this.seats[color]?.name || t(`color.${color}`)
  }
  updatePowerButtons() { /* no power bar in the online v1 */ }
  startTurnTimer() {}
  stopTurnTimer() {}
  clearExtraRollCue() {}
  get sixForced() { return { has: () => false } }

  canMove(pawn) {
    if (pawn.finished) return false
    if (pawn.steps < 0) return this.rawDiceValue === 6 || this.diceValue === 6
    return pawn.steps + this.diceValue <= 56
  }

  preload() {
    this.makeBackgroundTexture('bg-classic', '#35246f', '#4f3a9e')
    this.makeElementalEffectTextures()
    Object.entries(PAWN_ASSETS).forEach(([color, asset]) => {
      this.load.image(`pawn-${color}`, `assets/sprites/pawn-${asset}.png`)
      this.load.image(`pawn-${color}-sm`, `assets/sprites/pawn-${asset}-sm.png`)
    })
    POWER_TYPES.forEach((type) => this.load.image(`rune-${type}`, `assets/sprites/rune-${type}.png`))
  }

  async create() {
    this.currentPlayer = 0
    this.captureCounts = Object.fromEntries(COLORS.map((c) => [c, 0]))
    this.add.image(W / 2, H / 2, 'bg-classic')
    this.createBackdrop()
    this.createTopBar()
    this.enterScene()

    this.status = this.add.text(W / 2, H / 2, t('net.connecting'), {
      fontFamily: 'Verdana, sans-serif', fontSize: 20, color: '#e9e2ff', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(50)

    this.events.once('shutdown', () => this.teardown())

    try {
      this.room = (await tryReconnect()) || (await joinMatch(this.matchConfig))
    } catch (err) {
      this.status.setText(t('net.connectFailed'))
      this.time.delayedCall(1800, () => this.goTo('Home'))
      return
    }
    this.bindRoom()
  }

  teardown() {
    try { this.room?.leave() } catch { /* already gone */ }
    this.room = null
  }

  bindRoom() {
    const room = this.room
    room.onError((code, msg) => console.warn('[net] room error', code, msg))
    room.onLeave((code) => {
      if (this.gameOver) return
      this.status?.setVisible(true).setText(t('net.disconnected'))
    })
    room.onMessage('rejected', (m) => this.showToast(m?.error || 'rejected'))
    room.onMessage('events', (events) => this.enqueue(events))
    room.onStateChange(() => this.onStateChange())
  }

  readSeats() {
    const seats = {}
    const map = this.room?.state?.seats
    if (!map) return seats
    map.forEach((seat, sessionId) => {
      seats[seat.color || `pending-${sessionId}`] = {
        name: seat.name, bot: seat.bot, connected: seat.connected,
        playFabId: seat.playFabId, sessionId,
      }
      if (sessionId === this.room.sessionId && seat.color) this.myColor = seat.color
    })
    return seats
  }

  onStateChange() {
    const s = this.room?.state
    if (!s) return
    this.seats = this.readSeats()

    if (s.phase === 'lobby' || !s.gameJson) {
      const n = [...(s.seats?.values() || [])].filter((x) => !x.bot).length
      this.status?.setVisible(true).setText(t('net.waiting', { n, max: this.matchConfig.maxPlayers }))
      return
    }

    const g = JSON.parse(s.gameJson)
    const first = !this.g
    this.g = g

    if (first) {
      this.status?.setVisible(false)
      this.buildBoard()
    }
    // pawn positions are moved ONLY by playEvents (which reconciles at the end);
    // an idle state patch that arrives outside a move burst still gets synced.
    else if (!this._animating && !this._pendingBatches) {
      this.syncPositions(true)
    }
    this.refreshTurn()
  }

  buildBoard() {
    // create the pawn objects once - their identity is the pawnViews Map key,
    // so we mutate these forever rather than replacing them on each patch
    this.pawns = this.g.pawns.map((p) => ({ color: p.color, id: p.id, steps: p.steps, finished: p.finished }))
    this.createBoard()
    this.createPlayers()
    this.pawns.forEach((pawn) => {
      const view = this.makePawnView(pawn.color)
      this.pawnViews.set(pawn, view)
      this.positionPawn(pawn, false)
    })
    this.reflowPawns(false)
    this.refreshTurn()
  }

  pawnRef(color, id) {
    return this.pawns.find((p) => p.color === color && p.id === id) || null
  }

  // pull the local pawn objects back in line with authoritative state
  syncPositions(animate) {
    for (const sp of this.g.pawns) {
      const p = this.pawnRef(sp.color, sp.id)
      if (p) { p.steps = sp.steps; p.finished = sp.finished }
    }
    this.reflowPawns(animate)
  }

  refreshTurn() {
    if (!this.g) return
    this.gameOver = this.g.phase === 'gameover'
    this.phase = this.gameOver ? 'over'
      : this._animating ? 'moving'
        : this.g.phase === 'move' ? 'move' : 'roll'
    this.refreshTurnUI?.()
    this.updateHeader()
  }

  updateHeader() {
    if (!this.header) {
      this.header = this.add.text(W / 2, 108, '', {
        fontFamily: 'Verdana, sans-serif', fontSize: 18, color: '#efe8ff', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(20)
    }
    if (this.gameOver) { this.header.setText(''); return }
    const c = this.currentColor
    this.header.setText(this.myTurn ? t('classic.yourTurn') : t('net.theirTurn', { name: this.playerName(c) }))
      .setColor(`#${(COLOR_HEX[c] ?? 0xffffff).toString(16).padStart(6, '0')}`)
  }

  // ---- input: only wired for your own turn ----
  rollDice() {
    if (!this.myTurn || this.phase !== 'roll' || this._animating) return
    sfx.tap()
    this.phase = 'moving'
    this.updatePawnHighlights()
    this.room.send('action', { type: 'roll' })
  }

  tryMovePawn(pawn) {
    if (!this.myTurn || this.phase !== 'move' || this._animating) return
    if (pawn.color !== this.myColor || !this.canMove(pawn)) return
    sfx.tap()
    this.phase = 'moving'
    this.updatePawnHighlights()
    this.room.send('action', { type: 'move', pawnId: pawn.id })
  }

  // only glow the local player's movable pawns
  updatePawnHighlights() {
    this.clearActivePawnZones()
    this.pawns.forEach((pawn) => {
      const view = this.pawnViews.get(pawn)
      if (!view) return
      const glow = view.getByName('glow')
      const active = this.phase === 'move' && this.myTurn && pawn.color === this.myColor && this.canMove(pawn)
      view.setAlpha(active ? 1 : 0.92)
      this.tweens.killTweensOf(view)
      if (active) {
        glow?.setFillStyle(COLOR_HEX[pawn.color], 0.28)
        const stackScale = view.getData('stackScale') ?? 1
        this.tweens.add({ targets: view, scale: stackScale * 1.14, duration: 320, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
        this.createActivePawnZone(pawn, view)
      } else {
        glow?.setFillStyle(0xffffff, 0)
        view.setScale(view.getData('stackScale') ?? 1)
      }
    })
  }

  // ---- event playback ----
  enqueue(events) {
    this._pendingBatches = (this._pendingBatches || 0) + 1
    this._queue = this._queue
      .then(() => this.playEvents(events))
      .catch((e) => console.warn('[net] playback', e))
      .finally(() => { this._pendingBatches-- })
  }

  async playEvents(events) {
    this._animating = true
    this.phase = 'moving'
    this.updatePawnHighlights()
    for (const ev of events) {
      // eslint-disable-next-line no-await-in-loop
      await this.playEvent(ev)
    }
    this._animating = false
    this.syncPositions(true)
    this.refreshTurn()
    this.updatePawnHighlights()
  }

  playEvent(ev) {
    switch (ev.t) {
      case 'rolled': return this.showRoll(ev.color, ev.raw, ev.doubled)
      case 'moved': return this.playMove(ev)
      case 'capture': return this.playCapture(ev)
      case 'finish': return this.playFinish(ev)
      case 'turn':
        if (ev.extra) this.showExtraRollCue?.(ev.color, ev.extra)
        return this.pause(120)
      case 'noMove':
        this.showToast(t('classic.noMove'))
        return this.pause(400)
      case 'win':
      case 'gameover':
        if (ev.t === 'gameover') this.showGameOver(ev)
        return this.pause(200)
      default: return Promise.resolve()
    }
  }

  pause(ms) { return new Promise((r) => this.time.delayedCall(dur(ms), r)) }

  showRoll(color, raw, doubled) {
    const tray = this.cornerDice?.[color]?.container
    const x = tray?.x ?? W / 2
    const y = tray?.y ?? 160
    sfx.roll?.()
    const g = this.add.text(x, y, doubled ? `${raw}·${raw}` : `${raw}`, {
      fontFamily: 'Verdana, sans-serif', fontSize: 34, color: '#fff', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(60).setStroke('#1a1330', 6).setScale(0.4)
    this.tweens.add({ targets: g, scale: 1, duration: dur(DUR.base), ease: EASE.pop })
    return new Promise((res) => {
      this.tweens.add({
        targets: g, y: y - 26, alpha: 0, scale: 0.7,
        delay: dur(520), duration: dur(320), ease: EASE.out,
        onComplete: () => { g.destroy(); res() },
      })
    })
  }

  playMove(ev) {
    const pawn = this.pawns.find((p) => p.color === ev.color && p.id === ev.pawnId)
    if (!pawn) return Promise.resolve()
    const from = pawn.steps
    pawn.steps = ev.to
    pawn.finished = ev.to >= 56
    return new Promise((res) => this.animatePawn(pawn, from, ev.to, res))
  }

  playCapture(ev) {
    const victim = this.pawns.find((p) => p.color === ev.color && p.id === ev.id)
    if (!victim) return Promise.resolve()
    victim.steps = -1
    victim.finished = false
    this.captureCounts[ev.by] = (this.captureCounts[ev.by] || 0) + 1
    const v = this.pawnViews.get(victim)
    if (v) this.playElementalSkill(ev.by, v.x, v.y)
    return new Promise((res) => {
      this.positionPawn(victim, true)
      this.time.delayedCall(dur(260), res)
    })
  }

  playFinish(ev) {
    const pawn = this.pawns.find((p) => p.color === ev.color && p.id === ev.pawnId)
    if (pawn) { pawn.finished = true; pawn.steps = 56 }
    this.popAt(W / 2, BOARD_Y + TILE * 7.5, COLOR_HEX[ev.color])
    sfx.rune?.()
    this.markPawnHome?.(pawn)
    return this.pause(200)
  }

  showGameOver(ev) {
    this.gameOver = true
    clearReconnect()
    const won = ev.winner === this.myColor
    const layer = this.add.container(0, 0).setDepth(200)
    layer.add(this.add.rectangle(W / 2, H / 2, W, H, 0x05060f, 0.72))
    this.makeRoundedRectTexture('net-vic', 460, 300, 0x2a1f52, 0x140d2c, 26, COLOR_HEX[ev.winner])
    const card = this.add.container(W / 2, H / 2, [this.add.image(0, 0, 'net-vic')])
    card.add(this.add.text(0, -84, won ? t('victory.youWin') : t('victory.defeat'), {
      fontFamily: 'Verdana, sans-serif', fontSize: 40, color: '#fff', fontStyle: 'bold',
    }).setOrigin(0.5))
    card.add(this.add.text(0, -30, t('victory.allHome', { color: t(`color.${ev.winner}`) }), {
      fontFamily: 'Verdana, sans-serif', fontSize: 13, color: '#c9b8ff',
    }).setOrigin(0.5))
    this.makeRoundedRectTexture('net-vic-btn', 200, 56, 0x34c759, 0x1f9d43, 15, 0x9affc0)
    card.add(this.add.image(0, 74, 'net-vic-btn'))
    card.add(this.add.text(0, 74, t('victory.home'), {
      fontFamily: 'Verdana, sans-serif', fontSize: 18, color: '#08240f', fontStyle: 'bold',
    }).setOrigin(0.5))
    layer.add(card)
    this.makeHitZone(W / 2, H / 2 + 74, 200, 56).setDepth(210).on('pointerup', () => { sfx.tap(); this.goTo('Home') })
    card.setScale(0.8).setAlpha(0)
    this.tweens.add({ targets: card, scale: 1, alpha: 1, duration: 320, ease: 'Back.easeOut' })
  }
}


Object.assign(
  NetLudoScene.prototype,
  GeometryMixin,
  BoardViewMixin,
  PlayersMixin,
  PawnsMixin,
  CombatMixin,
)
