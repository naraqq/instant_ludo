// Online match scene. Reuses the Classic rendering mixins (board, pods, pawns,
// dice, powers, combat FX) but the Colyseus room is authoritative: this scene
// renders `room.state` and plays the `events` the server broadcasts.
import { W, H } from '../config.js'
import { UIScene } from '../ui/UIScene.js'
import { DUR, EASE, dur, prefersReducedMotion } from '../ui/tokens.js'
import { sfx } from '../audio.js'
import { t } from '../i18n.js'
import { drawRestingDice } from '../ui/dice3d.js'
import { COLOR_HEX, COLORS, PAWN_ASSETS, POWER_TYPES } from '@ludo/engine'
import { GeometryMixin } from './classic/geometry.js'
import { BoardViewMixin } from './classic/boardView.js'
import { PlayersMixin } from './classic/players.js'
import { PawnsMixin } from './classic/pawns.js'
import { PowersMixin } from './classic/powers.js'
import { CombatMixin } from './classic/combat.js'
import { TILE, BOARD_Y, TURN_SECONDS } from './classic/constants.js'
import { joinMatch, createRoom, joinByCode, tryReconnect, clearReconnect } from '../net/room.js'

export class NetLudoScene extends UIScene {
  constructor() {
    super('NetLudo')
    this.pawnViews = new Map()
    this.gateViews = []
    this.bonusRuneViews = new Map()
    this.activePawnZones = []
    this.shieldedColors = new Set()
    this.shieldExpiresOnOwnRoll = new Set()
  }

  init(data) {
    this.matchConfig = { mode: 'quick', maxPlayers: 2, ...data }
    this.g = null
    this.seats = {}
    this.myColor = null
    this.phase = 'lobby'
    this.pawns = []
    this.room = null
    this.gameOver = false
    this._queue = Promise.resolve()
    this._pendingBatches = 0
    this.forcedDiceValue = null
    this.doubleNextRoll = false
  }

  // ---- shims the reused rendering mixins read ----
  get currentColor() { return this.g ? (this.g.colors[this.g.current]) : null }
  get activeColors() { return this.g?.colors ?? [] }
  get diceValue() { return this.g?.dice ?? 0 }
  get rawDiceValue() { return this.g?.raw ?? 0 }
  get powerInventory() { return this.g?.inventory ?? {} }
  get youColor() { return this.myColor }
  get powerBarColor() { return this.myColor }
  get myTurn() { return Boolean(this.g) && this.currentColor === this.myColor && !this._animating }
  get sixForced() { return { has: () => false } }

  isBot(color) { return this.seats[color]?.bot ?? false }
  playerName(color) {
    if (color === this.myColor) return t('classic.you')
    return this.seats[color]?.name || t(`color.${color}`)
  }
  startTurnTimer() { /* the arc is driven by armTurnTimer from the server deadline */ }
  stopTurnTimer() { this._turnTimer?.remove(false); Object.values(this.playerBadges || {}).forEach((b) => b.getByName('arc')?.clear()) }

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
    POWER_TYPES.forEach((type) => {
      this.load.image(`rune-${type}`, `assets/sprites/rune-${type}.png`)
      this.load.image(`gateline-${type}`, `assets/sprites/gateline-${type}.png`)
    })
    ;['fire', 'water', 'earth'].forEach((k) => this.load.image(`power-${k}`, `assets/sprites/power-${k}.png`))
    this.load.image('rune-bonus', 'assets/sprites/rune-bonus.png')
  }

  async create() {
    this.currentPlayer = 0
    this.captureCounts = Object.fromEntries(COLORS.map((c) => [c, 0]))
    this.add.image(W / 2, H / 2, 'bg-classic')
    this.createBackdrop()
    this.createTopBar()
    this.enterScene()

    this.status = this.add.text(W / 2, H / 2 - 30, t('net.connecting'), {
      fontFamily: 'Verdana, sans-serif', fontSize: 20, color: '#e9e2ff', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(50)

    this.events.once('shutdown', () => this.teardown())

    try {
      const c = this.matchConfig
      this.room = await tryReconnect()
      if (!this.room) {
        if (c.mode === 'create') this.room = await createRoom({ maxPlayers: c.maxPlayers })
        else if (c.mode === 'code') this.room = await joinByCode(c.code)
        else this.room = await joinMatch({ maxPlayers: c.maxPlayers })
      }
    } catch (err) {
      this.status.setText(err.message || t('net.connectFailed'))
      this.time.delayedCall(2200, () => this.goTo('Home'))
      return
    }
    this.bindRoom()
  }

  teardown() {
    this._turnTimer?.remove(false)
    try { this.room?.leave() } catch { /* already gone */ }
    this.room = null
  }

  bindRoom() {
    const room = this.room
    room.onError((code, msg) => console.warn('[net] room error', code, msg))
    room.onLeave(() => { if (!this.gameOver) this.status?.setVisible(true).setText(t('net.disconnected')) })
    room.onMessage('rejected', (m) => { this.showToast(m?.error || 'rejected'); this._sending = false })
    room.onMessage('events', (events) => this.enqueue(events))
    room.onStateChange(() => this.onStateChange())
  }

  // ------------------------------------------------------------------ lobby

  readSeats() {
    const seats = {}
    const map = this.room?.state?.seats
    if (!map) return seats
    map.forEach((seat, sessionId) => {
      const key = seat.color || `pending:${sessionId}`
      seats[key] = { name: seat.name, bot: seat.bot, connected: seat.connected, sessionId }
      if (sessionId === this.room.sessionId && seat.color) this.myColor = seat.color
    })
    return seats
  }

  onStateChange() {
    const s = this.room?.state
    if (!s) return
    this.seats = this.readSeats()

    if (s.phase === 'lobby' || !s.gameJson) {
      this.showLobby(s)
      return
    }
    this.lobby?.destroy(); this.lobby = null

    const g = JSON.parse(s.gameJson)
    const first = !this.g
    this.g = g
    this.syncShields()

    if (first) { this.status?.setVisible(false); this.buildBoard() }
    else if (!this._animating && !this._pendingBatches) {
      this.syncPositions(true)
      this.syncBonusRunes()
    }
    this.refreshTurn()
  }

  showLobby(s) {
    const humans = [...s.seats.values()].filter((x) => !x.bot).length
    this.status?.setVisible(true).setText(t('net.waiting', { n: humans, max: s.maxSeats }))
    if (this.lobby) { this.updateLobby(s); return }
    this.lobby = this.add.container(W / 2, H / 2 + 60).setDepth(50)
    if (s.code) {
      this.lobby.add(this.add.text(0, 0, t('net.roomCode'), {
        fontFamily: 'Verdana, sans-serif', fontSize: 13, color: '#b9a9ef',
      }).setOrigin(0.5))
      this.lobbyCode = this.add.text(0, 34, s.code, {
        fontFamily: 'Verdana, sans-serif', fontSize: 46, color: '#ffe27a', fontStyle: 'bold',
      }).setOrigin(0.5).setStroke('#2a1f52', 6)
      this.lobby.add(this.lobbyCode)
    }
    const isHost = s.hostId === this.room.sessionId
    if (isHost) {
      this.makeRoundedRectTexture('net-start', 220, 54, 0x34c759, 0x1f9d43, 15, 0x9affc0)
      const btn = this.add.container(0, 100, [
        this.add.image(0, 0, 'net-start'),
        this.add.text(0, 0, t('net.startNow'), {
          fontFamily: 'Verdana, sans-serif', fontSize: 17, color: '#08240f', fontStyle: 'bold',
        }).setOrigin(0.5),
      ])
      this.lobby.add(btn)
      this.makeHitZone(W / 2, H / 2 + 160, 220, 54).setDepth(51)
        .on('pointerup', () => { sfx.tap(); this.room.send('start', {}) })
    }
  }

  updateLobby(s) { if (this.lobbyCode && s.code) this.lobbyCode.setText(s.code) }

  // ------------------------------------------------------------------ board

  buildBoard() {
    this.pawns = this.g.pawns.map((p) => ({ color: p.color, id: p.id, steps: p.steps, finished: p.finished }))
    this.createBoard()
    this.createPlayers()
    this.createBottomBar()
    this.createGates()
    this.pawns.forEach((pawn) => {
      const view = this.makePawnView(pawn.color)
      this.pawnViews.set(pawn, view)
      this.positionPawn(pawn, false)
    })
    this.reflowPawns(false)
    this.syncBonusRunes()
    this.refreshTurn()
  }

  pawnRef(color, id) { return this.pawns.find((p) => p.color === color && p.id === id) || null }

  syncPositions(animate) {
    for (const sp of this.g.pawns) {
      const p = this.pawnRef(sp.color, sp.id)
      if (p) { p.steps = sp.steps; p.finished = sp.finished }
    }
    this.reflowPawns(animate)
  }

  syncShields() {
    this.shieldedColors = new Set(this.g.colors.filter((c) => this.g.shielded[c]))
    this.updateShieldVisuals?.()
  }

  // reconcile the "+1" rune views with the authoritative list
  syncBonusRunes() {
    const want = new Set((this.g.bonusRunes || []).map((r) => r.index))
    for (const [idx, view] of this.bonusRuneViews) {
      if (!want.has(idx)) { this.tweens.killTweensOf(view); view.destroy(); this.bonusRuneViews.delete(idx) }
    }
    for (const idx of want) {
      if (!this.bonusRuneViews.has(idx)) this.bonusRuneViews.set(idx, this.createBonusRuneView({ index: idx }))
    }
  }

  refreshTurn() {
    if (!this.g) return
    this.gameOver = this.g.phase === 'gameover'
    this.phase = this.gameOver ? 'over' : this._animating ? 'moving' : this.g.phase === 'move' ? 'move' : 'roll'
    this.doubleNextRoll = this.g.doubleNext
    this.refreshTurnUI?.()
    this.updateHeader()
    this.armTurnTimer()
  }

  updateHeader() {
    if (!this.header) {
      this.header = this.add.text(W / 2, 150, '', {
        fontFamily: 'Verdana, sans-serif', fontSize: 17, color: '#efe8ff', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(20)
    }
    if (this.gameOver) { this.header.setText(''); return }
    const c = this.currentColor
    this.header.setText(this.currentColor === this.myColor && !this._animating
      ? t('classic.yourTurn') : t('net.theirTurn', { name: this.playerName(c) }))
      .setColor(`#${(COLOR_HEX[c] ?? 0xffffff).toString(16).padStart(6, '0')}`)
  }

  // countdown ring on the active pod, from the server's deadline
  armTurnTimer() {
    this._turnTimer?.remove(false)
    const deadline = this.room?.state?.turnDeadline || 0
    const now = this.room?.clock?.currentTime ?? 0
    if (this.gameOver || this._animating || !deadline || deadline <= now) { this.drawTimerArc(0); return }
    const total = TURN_SECONDS * 1000
    this._turnTimer = this.time.addEvent({
      delay: 200, loop: true,
      callback: () => {
        const left = (this.room?.state?.turnDeadline || 0) - (this.room?.clock?.currentTime ?? 0)
        this.drawTimerArc(Math.max(0, Math.min(1, left / total)))
        if (left <= 0) this._turnTimer?.remove(false)
      },
    })
  }

  // ----------------------------------------------------------------- input

  send(action) {
    if (!this.room || this._animating) return
    if (this.currentColor !== this.myColor) return
    this.room.send('action', action)
  }

  rollDice() {
    if (this.phase !== 'roll') return
    if (this.currentColor !== this.myColor || this._animating) return
    // a still-open gate pick resolves server-side when we roll
    if (this._gatePickChoose) this.closeGatePicker()
    sfx.tap()
    if (this.forcedDiceValue != null) {
      const v = this.forcedDiceValue
      this.forcedDiceValue = null
      this.room.send('action', { type: 'usePower', key: 'water', value: v })
    }
    this._animating = true
    this.updatePawnHighlights()
    this.room.send('action', { type: 'roll' })
  }

  usePower(key) {
    if (this.phase !== 'roll' || this.currentColor !== this.myColor || this._animating) return
    if (!this.g.inventory[this.myColor]?.[key]) { this.flashPower(key); return }
    if (key === 'water') { this.showControllerPicker(); return }
    sfx.power()
    this.flashPower(key)
    this.room.send('action', { type: 'usePower', key })
    if (key === 'fire') {
      this._animating = true
      this.time.delayedCall(200, () => this.room.send('action', { type: 'roll' }))
    }
  }

  tryMovePawn(pawn) {
    if (this.phase !== 'move' || this.currentColor !== this.myColor || this._animating) return
    if (pawn.color !== this.myColor || !this.canMove(pawn)) return
    sfx.tap()
    this._animating = true
    this.updatePawnHighlights()
    this.room.send('action', { type: 'move', pawnId: pawn.id })
  }

  updatePawnHighlights() {
    this.clearActivePawnZones()
    this.pawns.forEach((pawn) => {
      const view = this.pawnViews.get(pawn)
      if (!view) return
      const glow = view.getByName('glow')
      const active = this.phase === 'move' && !this._animating
        && this.currentColor === this.myColor && pawn.color === this.myColor && this.canMove(pawn)
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

  // -------------------------------------------------------- event playback

  enqueue(events) {
    this._pendingBatches++
    this._queue = this._queue
      .then(() => this.playEvents(events))
      .catch((e) => console.warn('[net] playback', e))
      .finally(() => { this._pendingBatches-- })
  }

  async playEvents(events) {
    this._animating = true
    this.phase = 'moving'
    this.updatePawnHighlights()
    this._pendingCue = null
    for (const ev of events) {
      // eslint-disable-next-line no-await-in-loop
      await this.playEvent(ev)
    }
    this._animating = false
    this.syncPositions(true)
    this.syncBonusRunes()
    this.syncShields()
    this.refreshTurn()
    this.updatePawnHighlights()
    // the extra-roll "+1" cue only shows in the roll phase, which we're now in
    if (this._pendingCue && this.currentColor === this._pendingCue.color) {
      this.showExtraRollCue?.(this._pendingCue.color, this._pendingCue.reason)
    }
    this._pendingCue = null
  }

  playEvent(ev) {
    switch (ev.t) {
      case 'rolled': return this.playRoll(ev)
      case 'powerUsed': return this.playPowerUsed(ev)
      case 'moved': return this.playMove(ev)
      case 'gate': return this.playGate(ev)
      case 'runePicked': return this.playRunePicked(ev)
      case 'bonus': return this.playBonus(ev)
      case 'bonusSpawn': this.bonusRuneViews.has(ev.index) || this.bonusRuneViews.set(ev.index, this.createBonusRuneView({ index: ev.index })); return Promise.resolve()
      case 'capture': return this.playCapture(ev)
      case 'charge': return this.playCharge(ev)
      case 'shieldBlock': return this.playShieldBlockEv(ev)
      case 'shieldExpired': this.syncShields(); return this.pause(80)
      case 'finish': return this.playFinish(ev)
      case 'extraRoll':
      case 'turn':
        if (ev.extra || ev.cause) this._pendingCue = { color: ev.color, reason: ev.extra || ev.cause }
        return this.pause(140)
      case 'noMove': this.showToast(t('classic.noMove')); return this.pause(420)
      case 'gameover': this.showGameOver(ev); return this.pause(200)
      default: return Promise.resolve()
    }
  }

  pause(ms) { return new Promise((r) => this.time.delayedCall(dur(ms), r)) }

  playRoll(ev) {
    const dice = this.cornerDice?.[ev.color]
    sfx.roll?.()
    if (!dice || prefersReducedMotion) {
      if (dice) { drawRestingDice(dice.face, ev.raw); dice.value = ev.raw }
      return this.pause(260)
    }
    dice.face2?.setVisible(Boolean(ev.doubled))
    dice.shadow2?.setVisible(Boolean(ev.doubled))
    const spin = { t: 0 }
    return new Promise((res) => {
      this.tweens.add({
        targets: spin, t: 1, duration: dur(520), ease: 'Cubic.easeOut',
        onUpdate: () => {
          const face = spin.t < 0.82 ? 1 + (Math.floor(spin.t * 16) % 6) : ev.raw
          drawRestingDice(dice.face, face)
          dice.face.setAngle(spin.t * 520 % 360)
          if (ev.doubled) { drawRestingDice(dice.face2, face); dice.face2.setAngle(-spin.t * 520 % 360) }
        },
        onComplete: () => {
          dice.face.setAngle(0); drawRestingDice(dice.face, ev.raw); dice.value = ev.raw
          if (ev.doubled) { dice.face2.setAngle(0); drawRestingDice(dice.face2, ev.raw) }
          sfx.land?.(ev.raw)
          res()
        },
      })
    })
  }

  playPowerUsed(ev) {
    if (ev.color !== this.myColor) {
      if (ev.key === 'water') this.forcedDiceValue = ev.value ?? null
      this.playPowerEffect?.(ev.color, ev.key)
    }
    if (ev.key === 'earth') { this.syncShields(); this.playShieldAura?.(ev.color) }
    return this.pause(ev.color === this.myColor ? 60 : 420)
  }

  playMove(ev) {
    const pawn = this.pawnRef(ev.color, ev.pawnId)
    if (!pawn) return Promise.resolve()
    const from = pawn.steps
    pawn.steps = ev.to
    pawn.finished = ev.to >= 56
    return new Promise((res) => this.animatePawn(pawn, from, ev.to, res))
  }

  playGate(ev) {
    if (ev.color === this.myColor && !this._gatePickChoose) {
      this._gatePickOwner = this.myColor
      this.showGatePicker(this.myColor, (key) => this.room.send('action', { type: 'pickGateRune', key }))
    }
    return this.pause(120)
  }

  playRunePicked(ev) {
    if (this._gatePickChoose) this.closeGatePicker()
    const badge = this.playerBadges?.[ev.color]
    this.animateGateGrant?.(ev.color, ev.key, { x: badge?.x ?? W / 2, y: badge?.y ?? H / 2 })
    return this.pause(180)
  }

  playBonus(ev) {
    const view = this.bonusRuneViews.get(ev.index)
    this.bonusRuneViews.delete(ev.index)
    if (!view) return this.pause(120)
    this.tweens.killTweensOf(view)
    this.popAt(view.x, view.y, 0xffd54d)
    return new Promise((res) => {
      this.tweens.add({
        targets: view, y: view.y - 16, scale: 1.5, alpha: 0,
        duration: dur(260), ease: EASE.out, onComplete: () => { view.destroy(); res() },
      })
    })
  }

  playCapture(ev) {
    const victim = this.pawnRef(ev.color, ev.id)
    if (!victim) return Promise.resolve()
    victim.steps = -1; victim.finished = false
    this.captureCounts[ev.by] = (this.captureCounts[ev.by] || 0) + 1
    const v = this.pawnViews.get(victim)
    if (v) this.playElementalSkill?.(ev.by, v.x, v.y)
    return new Promise((res) => { this.positionPawn(victim, true); this.time.delayedCall(dur(300), res) })
  }

  playCharge(ev) {
    const badge = this.playerBadges?.[ev.by || ev.color]
    this.grantCaptureCharge?.(ev.color, badge?.x ?? W / 2, badge?.y ?? H / 2)
    return this.pause(160)
  }

  playShieldBlockEv(ev) {
    const pawn = this.pawns.find((p) => p.color === ev.color && p.steps >= 0 && !p.finished)
    if (pawn) this.playShieldBlock?.(pawn)
    this.syncShields()
    return this.pause(320)
  }

  playFinish(ev) {
    const pawn = this.pawnRef(ev.color, ev.pawnId)
    if (pawn) { pawn.finished = true; pawn.steps = 56 }
    this.popAt(W / 2, BOARD_Y + TILE * 7.5, COLOR_HEX[ev.color])
    sfx.rune?.()
    this.markPawnHome?.(pawn)
    return this.pause(220)
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
  PowersMixin,
  CombatMixin,
)
