// Online match scene. Reuses the Classic rendering mixins (board, pods, pawns,
// dice, powers, combat FX) but the Colyseus room is authoritative: this scene
// renders `room.state` and plays the `events` the server broadcasts.
import { W, H } from '../config.js'
import { UIScene } from '../ui/UIScene.js'
import { EASE, dur, prefersReducedMotion } from '../ui/tokens.js'
import { sfx } from '../audio.js'
import { t } from '../i18n.js'
import { COLOR_HEX, COLORS, PAWN_ASSETS, POWER_TYPES, START_INDEX } from '@ludo/engine'
import { GeometryMixin } from './classic/geometry.js'
import { BoardViewMixin } from './classic/boardView.js'
import { PlayersMixin } from './classic/players.js'
import { PawnsMixin } from './classic/pawns.js'
import { PowersMixin } from './classic/powers.js'
import { CombatMixin } from './classic/combat.js'
import { DiceAnimMixin } from './classic/diceAnim.js'
import { TURN_SECONDS, MOVE_SECONDS, POD } from './classic/constants.js'
import { joinMatch, soloMatch, createRoom, joinByCode, tryReconnect, clearReconnect, stashReconnect } from '../net/room.js'

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
    this._run = (this._run || 0) + 1
    this._disposed = false
    this._connected = false
    this._animating = false
    this.pawnViews = new Map()
    this.gateViews = []
    this.bonusRuneViews = new Map()
    this.activePawnZones = []
    this.shieldedColors = new Set()
    this.shieldExpiresOnOwnRoll = new Set()
    this.homeMarks = []
    this.header = this.lobby = this.lobbyCode = this.lobbyStartZone = null
    this._gatePickChoose = this._gatePickOwner = this.gatePicker = null
    this._gatePickerPanel = this._gatePickerDim = this.gatePickerTimeout = null
    this._pendingCue = this._lastMoved = null
    this._resultShown = false
    this.controllerPicker = null
    this.playerBadges = {}
    this.cornerDice = {}
    this._latestGame = null

    this.matchConfig = { mode: 'quick', maxPlayers: 2, teams: false, ...data }
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
    this._windup = null      // in-flight dice wind-up shake (local roll, pre-value)
    this._predicted = null     // { color, pawnId, to } move we've already animated
    this._moveAnimDone = null  // promise for that optimistic move animation
  }

  // ---- shims the reused rendering mixins read ----
  get currentColor() { return this.g ? (this.g.colors[this.g.current]) : null }
  get activeColors() { return this.g?.colors ?? [] }
  get diceValue() { return this.g?.dice ?? 0 }
  get rawDiceValue() { return this.g?.raw ?? 0 }
  get powerInventory() { return this.g?.inventory ?? {} }
  get youColor() { return this.myColor }
  get powerBarColor() { return this.myColor }
  get myTurn() { return Boolean(this.g) && this.currentColor === this.myColor && !this._animating && this._connected && !this._windup }
  get sixForced() { return { has: () => false } }

  // ---- 2v2 teams (null / no-ops outside a team match) ----
  get team() { return this.g?.team ?? null }
  // whose pawns actually move this turn: the roller, or - in a team match, once
  // the roller is all home - their still-playing partner
  get moverColor() {
    const g = this.g
    if (!g) return null
    const roller = g.colors[g.current]
    if (!g.team) return roller
    const done = (c) => g.pawns.filter((p) => p.color === c).every((p) => p.finished)
    if (!done(roller)) return roller
    const mate = g.colors.find((c) => c !== roller && g.team[c] === g.team[roller])
    return mate && !done(mate) ? mate : roller
  }
  get teammateColor() {
    const g = this.g
    if (!g?.team || !this.myColor) return null
    return g.colors.find((c) => c !== this.myColor && g.team[c] === g.team[this.myColor]) ?? null
  }
  // it's my turn but the dice will move my partner's pawns
  get assisting() { return this.currentColor === this.myColor && this.moverColor !== this.myColor }
  teamOf(color) { return this.g?.team ? this.g.team[color] ?? null : null }

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
    this.makeBackgroundTexture('bg-classic', '#101c30', '#1c3048')
    this.makeElementalEffectTextures()
    Object.entries(PAWN_ASSETS).forEach(([color, asset]) => {
      this.load.image(`pawn-${color}`, `assets/sprites/pawn-${asset}.png`)
      this.load.image(`pawn-${color}-sm`, `assets/sprites/pawn-${asset}-sm.png`)
    })
    POWER_TYPES.forEach((type) => this.load.image(`rune-${type}`, `assets/sprites/rune-${type}.png`))
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

    const run = this._run
    let joined
    try {
      const c = this.matchConfig
      joined = c.mode === 'quick' ? await tryReconnect() : null
      if (!joined) {
        const opts = { maxPlayers: c.maxPlayers, teams: c.teams }
        if (c.mode === 'create') joined = await createRoom(opts)
        else if (c.mode === 'code') joined = await joinByCode(c.code)
        else if (c.mode === 'solo') joined = await soloMatch(opts)
        else joined = await joinMatch(opts)
      }
    } catch (err) {
      if (run !== this._run || this._disposed) return
      this.status.setText(err.message || t('net.connectFailed'))
      this.time.delayedCall(2200, () => this.goTo('Home'))
      return
    }
    if (run !== this._run || this._disposed) { joined.leave().catch(() => {}); return }
    this.room = joined
    this._connected = true
    this.bindRoom()
    const saveSeat = () => { if (this.room && !this.gameOver) stashReconnect(this.room) }
    this.time.addEvent({ delay: 15000, loop: true, callback: saveSeat })
    window.addEventListener('pagehide', saveSeat)
    this.events.once('shutdown', () => window.removeEventListener('pagehide', saveSeat))
  }

  teardown() {
    this._disposed = true
    this._connected = false
    this._turnTimer?.remove(false)
    this._windup?.stop?.()
    for (const pawn of this.pawns) pawn._cancelMotion?.()
    clearReconnect()
    this.room?.leave().catch(() => {})
    this.room = null
  }

  bindRoom() {
    const room = this.room
    room.reconnection.minUptime = 0
    room.onDrop(() => {
      if (this._disposed || this.room !== room) return
      this._connected = false
      this._windup?.stop?.(); this._windup = null
      for (const pawn of this.pawns) pawn._cancelMotion?.()
      this._predicted = this._moveAnimDone = null
      if (!this._pendingBatches) this._animating = false
      stashReconnect(room)
      this.status?.setVisible(true).setText(t('net.reconnecting'))
      this.clearActivePawnZones()
    })
    room.onReconnect(() => {
      if (this._disposed || this.room !== room) return
      this._connected = true
      stashReconnect(room)
      this.status?.setVisible(false)
      this._windup?.stop?.(); this._windup = null
      if (!this._pendingBatches) this._animating = false
      this.onStateChange()
    })
    room.onError((code, msg) => console.warn('[net] room error', code, msg))
    room.onLeave(() => { if (this._disposed || this.room !== room) return; this._connected = false; clearReconnect(); if (!this.gameOver) this.status?.setVisible(true).setText(t('net.disconnected')) })
    room.onMessage('rejected', (m) => {
      if (this._disposed || this.room !== room) return
      this.showToast(m?.error || 'rejected')
      // an optimistic roll/move was refused - drop the prediction and snap back
      this._windup?.stop?.(); this._windup = null
      for (const pawn of this.pawns) pawn._cancelMotion?.()
      this._predicted = null; this._moveAnimDone = null
      if (this.g) { this.syncPositions(false); this.syncBonusRunes() }
      this._animating = false
      this.refreshTurn()
    })
    room.onMessage('events', (events) => this.enqueue(events))
    room.onStateChange(() => {
      if (!this._disposed && this.room === room) this.time.delayedCall(0, () => this.onStateChange())
    })
    this.onStateChange()
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
    if (!s?.seats) return
    this.seats = this.readSeats()

    if (s.phase === 'lobby' || !s.gameJson) {
      this.showLobby(s)
      return
    }
    this.lobby?.destroy(); this.lobby = null
    this.lobbyStartZone?.destroy(); this.lobbyStartZone = null
    this.lobbyCode = null

    const g = JSON.parse(s.gameJson)
    const first = !this.g
    this._latestGame = g
    if (!first && (this._animating || this._pendingBatches)) return
    this.g = g
    this.syncShields()

    if (first) { this.status?.setY(190).setVisible(false); this.buildBoard() }
    else if (!this._animating && !this._pendingBatches) {
      // no animation in flight - safe to jump straight to the server's truth
      this.syncPositions(true)
      this.syncBonusRunes()
      this.refreshTurn()
    }
    if (g.phase === 'gameover' && !this._resultShown) this.showGameOver({ winner: g.winner, winningTeam: g.winningTeam })
    this.restoreGatePicker()
    // while animating, playEvents() owns the turn UI so it never runs ahead
  }

  showLobby(s) {
    const humans = [...s.seats.values()].filter((x) => !x.bot).length
    const max = s.maxSeats || this.matchConfig.maxPlayers || 2
    this.status?.setVisible(true).setText(t('net.waiting', { n: humans, max }))
    if (this.lobby) { this.updateLobby(s); return }
    this.makeRoundedRectTexture('net-lobby', 588, 384, 0x21364c, 0x101e31, 28, 0x48647a)
    this.lobby = this.add.container(W / 2, H / 2).setDepth(49)
    this.lobby.add(this.add.image(0, 0, 'net-lobby'))
    this.status.setY(H / 2 - 144)
    const palette = ['blue', 'green', 'red', 'yellow']
    this.lobbySeats = Array.from({ length: max }, (_, i) => {
      const x = (i - (max - 1) / 2) * 122
      const color = palette[i]
      this.lobby.add(this.add.circle(x, -65, 28, COLOR_HEX[color], .14))
      this.lobby.add(this.add.image(x, -65, `pawn-${color}-sm`).setDisplaySize(48, 48))
      const label = this.add.text(x, -22, '', {
        fontFamily: 'Verdana, sans-serif', fontSize: 12, color: '#bdcfdf',
      }).setOrigin(.5)
      this.lobby.add(label)
      return label
    })
    if (s.code) {
      this.lobby.add(this.add.text(0, 20, t('net.roomCode'), {
        fontFamily: 'Verdana, sans-serif', fontSize: 12, color: '#90adbf',
      }).setOrigin(.5))
      this.lobbyCode = this.add.text(0, 58, s.code, {
        fontFamily: 'Verdana, sans-serif', fontSize: 42, color: '#ffe3a0', fontStyle: 'bold',
      }).setOrigin(.5)
      this.lobby.add(this.lobbyCode)
      const copy = this.add.zone(0, 58, 260, 66).setInteractive({ useHandCursor: true })
      copy.on('pointerup', async () => {
        try {
          await navigator.clipboard.writeText(s.code)
          if (!this._disposed) this.showToast(t('net.copied'))
        } catch { if (!this._disposed) this.showToast(s.code) }
      })
      this.lobby.add(copy)
    }
    const isHost = s.hostId === this.room.sessionId
    if (isHost) {
      this.makeRoundedRectTexture('net-start', 220, 54, 0x22c48d, 0x10ad85, 15, 0x64dfad)
      const btn = this.add.container(0, 136, [
        this.add.image(0, 0, 'net-start'),
        this.add.text(0, 0, t('net.startNow'), {
          fontFamily: 'Verdana, sans-serif', fontSize: 17, color: '#08240f', fontStyle: 'bold',
        }).setOrigin(0.5),
      ])
      this.lobby.add(btn)
      this.lobbyStartZone = this.makeHitZone(W / 2, H / 2 + 136, 220, 54).setDepth(51)
      this.addPressFeedback(this.lobbyStartZone, btn, () => { sfx.tap(); this.room.send('start', {}) })
    }
    this.updateLobby(s)
  }

  updateLobby(s) {
    const seats = [...s.seats.values()].filter(seat => !seat.bot)
    this.lobbySeats?.forEach((label, i) => label.setText((seats[i]?.name || '···').slice(0, 14)))
    const isHost = s.hostId === this.room.sessionId
    if (isHost && !this.lobbyStartZone) {
      this.lobby.destroy(); this.lobby = null; this.lobbyCode = null
      this.showLobby(s)
    } else if (this.lobbyCode && s.code) this.lobbyCode.setText(s.code)
  }

  restoreGatePicker() {
    if (this.g?.pendingGate?.color === this.myColor && !this._gatePickChoose) {
      this._gatePickOwner = this.myColor
      this.showGatePicker(this.myColor, key => this.send({ type: 'pickGateRune', key }))
    } else if (!this.g?.pendingGate && this._gatePickChoose) this.closeGatePicker()
  }

  // ------------------------------------------------------------------ board

  // Rotate the board so the local player is always bottom-left, whatever engine
  // colour they were dealt. Everything visual goes through gridToPixel / podFor,
  // so setting these two is enough.
  setPerspective() {
    this._boardRot = 0
    this._slotColor = Object.fromEntries(COLORS.map((c) => [c, c]))
    const me = this.myColor
    const shift = START_INDEX[me] || 0
    if (!me || !shift) return // blue (start 0) or unknown -> already bottom-left
    this._boardRot = (4 - shift / 13) % 4
    for (const c of COLORS) {
      const tgt = (START_INDEX[c] - shift + 52) % 52
      this._slotColor[c] = COLORS.find((x) => START_INDEX[x] === tgt) || c
    }
  }

  // where each colour's pod / corner-dice sit - overrides PlayersMixin so the
  // local player is bottom-left
  podFor(color) { return POD[this._slotColor?.[color] || color] }

  buildBoard() {
    this.pawns = this.g.pawns.map((p) => ({ color: p.color, id: p.id, steps: p.steps, finished: p.finished }))
    this.setPerspective()
    this.createBoard()
    this.createPlayers()
    this.createBottomBar()
    this.createGates()
    this.pawns.forEach((pawn) => {
      const view = this.makePawnView(pawn.color)
      this.pawnViews.set(pawn, view)
      this.positionPawn(pawn, false)
      // rejoining a game in progress: pawns already home are off the board,
      // recorded only by the check mark in their yard slot
      if (pawn.finished) { this.markPawnHome(pawn); view.setVisible(false).setAlpha(0) }
    })
    this.reflowPawns(false)
    this.syncBonusRunes()
    this.refreshTurn()
  }

  pawnRef(color, id) { return this.pawns.find((p) => p.color === color && p.id === id) || null }

  syncPositions(animate) {
    for (const sp of this.g.pawns) {
      const p = this.pawnRef(sp.color, sp.id)
      if (p) {
        if (sp.finished && !p.finished) this.markPawnHome(p)
        p.steps = sp.steps; p.finished = sp.finished
      }
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
    if (this.controllerPicker && (this.currentColor !== this.myColor || this.g.phase !== 'roll')) {
      this.closeControllerPicker()
      this.forcedDiceValue = null
    }
    this.phase = this.gameOver ? 'over' : (this._animating || this._windup || !this._connected) ? 'moving' : this.g.phase === 'move' ? 'move' : 'roll'
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
    const mover = this.moverColor
    let text
    if (this.assisting) text = t('net.assist', { name: this.playerName(mover) })
    else if (c === this.myColor) text = t('classic.yourTurn')
    else if (this.team && mover !== c) text = t('net.assistOther', { name: this.playerName(c), mate: this.playerName(mover) })
    else text = t('net.theirTurn', { name: this.playerName(c) })
    this.header.setText(text)
      .setColor(`#${(COLOR_HEX[mover] ?? COLOR_HEX[c] ?? 0xffffff).toString(16).padStart(6, '0')}`)
  }

  // countdown ring on the active pod, from the server's deadline
  serverNow() { return this.room?.clock?.serverNow?.() ?? this.room?.clock?.currentTime ?? 0 }

  armTurnTimer() {
    this._turnTimer?.remove(false)
    const deadline = this.room?.state?.turnDeadline || 0
    const total = (this.g?.phase === 'move' ? MOVE_SECONDS : TURN_SECONDS) * 1000
    if (this.gameOver || this._animating || !deadline || deadline <= this.serverNow()) { this.drawTimerArc(0); return }
    const tick = () => {
      const left = (this.room?.state?.turnDeadline || 0) - this.serverNow()
      this.drawTimerArc(Math.max(0, Math.min(1, left / total)))
      if (left <= 0) this._turnTimer?.remove(false)
    }
    tick()
    this._turnTimer = this.time.addEvent({ delay: 120, loop: true, callback: tick })
  }

  // ----------------------------------------------------------------- input

  send(action) {
    if (!this.room || !this._connected || this._disposed) return
    if (action.type !== 'pickGateRune' && (this._animating || this.currentColor !== this.myColor)) return
    this.room.send('action', action)
  }

  rollDice() {
    if (!this._connected || this.phase !== 'roll') return
    if (this.currentColor !== this.myColor || this._animating || this._windup) return
    // you must choose the gate rune before rolling on - nudge the picker
    if (this._gatePickChoose) { this.bumpGatePicker?.(); return }
    sfx.tap()
    const forced = this.forcedDiceValue
    this.forcedDiceValue = null
    this._animating = true
    this.updatePawnHighlights()
    if (forced != null) {
      // Control: the value's already chosen - no wind-up, playRoll() snaps it in
      this._snapRoll = true
      this.room.send('action', { type: 'usePower', key: 'water', value: forced })
    } else {
      // spin the die right now; playRoll() lands it on the server's value
      this._windup = this.diceWindup(this.myColor, { doubled: this.doubleNextRoll })
    }
    this.room.send('action', { type: 'roll' })
  }

  usePower(key) {
    if (!this._connected || this.phase !== 'roll' || this.currentColor !== this.myColor || this._animating || this._windup) return
    if (this._gatePickChoose) { this.bumpGatePicker?.(); return }
    if (!this.g.inventory[this.myColor]?.[key]) { this.flashPower(key); return }
    if (key === 'water') { this.showControllerPicker(); return }
    sfx.power()
    this.flashPower(key)
    this._animating = true
    this.room.send('action', { type: 'usePower', key })
    if (key === 'fire') {
      this._windup = this.diceWindup(this.myColor, { doubled: true })
      this.room.send('action', { type: 'roll' })
    }
  }

  tryMovePawn(pawn) {
    if (!this._connected || this.phase !== 'move' || this.currentColor !== this.myColor || this._animating || this._windup) return
    // on my turn I move my own pawns - or, once I'm all home, my partner's
    if (pawn.color !== this.moverColor || !this.canMove(pawn)) return
    sfx.tap()
    this._animating = true
    // the moving pawn's landing square is deterministic - animate it now and let
    // the server's `moved` event just confirm it
    const from = pawn.steps
    const to = from < 0 ? 0 : Math.min(56, from + this.diceValue)
    this._predicted = { color: pawn.color, pawnId: pawn.id, to }
    pawn.steps = to
    pawn.finished = to >= 56
    this.updatePawnHighlights()
    this._moveAnimDone = new Promise((res) => this.animatePawn(pawn, from, to, res))
    this.room.send('action', { type: 'move', pawnId: pawn.id })
  }

  updatePawnHighlights() {
    this.clearActivePawnZones()
    this.pawns.forEach((pawn) => {
      if (pawn.finished) return // retired from the board - see parkFinishedPawn
      const view = this.pawnViews.get(pawn)
      if (!view) return
      const token = view.getByName('token')
      const glow = view.getByName('glow')
      const active = this.phase === 'move' && !this._animating
        && this.currentColor === this.myColor && pawn.color === this.moverColor && this.canMove(pawn)
      view.setAlpha(active ? 1 : 0.92)
      // the pulse rides the token (a child), so it never fights reflowPawns'
      // animated stack-in slide on the view itself
      this.tweens.killTweensOf(token)
      token.setScale(1)
      if (active) {
        glow?.setFillStyle(COLOR_HEX[pawn.color], 0.28)
        if (!prefersReducedMotion) this.tweens.add({ targets: token, scale: 1.08, duration: 320, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
        this.createActivePawnZone(pawn, view)
      } else {
        glow?.setFillStyle(0xffffff, 0)
      }
    })
  }

  // -------------------------------------------------------- event playback

  enqueue(batch) {
    if (this._disposed) return
    const events = Array.isArray(batch) ? batch : batch.events
    if (!Array.isArray(events)) return
    const run = this._run
    this._pendingBatches++
    this._queue = this._queue.then(async () => {
      if (this._disposed || run !== this._run) return
      if (!this.g) this.onStateChange()
      if (!this.g) return
      if (batch.game) this.g = batch.game
      await this.playEvents(events, run)
    }).catch((e) => {
      console.warn('[net] playback', e)
      if (!this._disposed && run === this._run) {
        this._windup?.stop?.(); this._windup = null
        this._animating = false
        this._predicted = null
      }
    }).finally(() => {
      if (this._disposed || run !== this._run) return
      this._pendingBatches--
      if (!this._pendingBatches) this.onStateChange()
    })
  }

  // more turns are already waiting behind the one we're playing - the opponent
  // is acting faster than we can animate, so compress playback to catch up
  get _behind() { return this._pendingBatches > 1 }

  async playEvents(events, run = this._run) {
    this._animating = true
    this.phase = 'moving'
    this.updatePawnHighlights()
    this._pendingCue = null
    for (const ev of events) {
      if (this._disposed || run !== this._run) return
      // hard cap per event so a stuck tween / promise can never freeze playback
      // eslint-disable-next-line no-await-in-loop
      await Promise.race([
        Promise.resolve(this.playEvent(ev)),
        new Promise((r) => this.time.delayedCall(this._behind ? 400 : 3500, r)),
      ])
    }
    if (this._disposed || run !== this._run) return
    if (this._windup) { this._windup.stop?.(); this._windup = null } // no matching 'rolled'
    this._snapRoll = false
    this._predicted = null
    this._moveAnimDone = null
    this._animating = false
    this.syncPositions(!this._behind)
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
      case 'shieldBlock': return this.playShieldBlockEv(ev)
      case 'shieldExpired': this.syncShields(); return this.pause(80)
      case 'finish': return this.playFinish(ev)
      case 'colorHome': // a colour brought all 4 home (team match) - not game over
        if (!this._behind) this.showToast?.(t('net.colorHome', { name: this.playerName(ev.color) }))
        return this.pause(this._behind ? 40 : 500)
      case 'extraRoll':
      case 'turn':
        if (ev.extra || ev.cause) this._pendingCue = { color: ev.color, reason: ev.extra || ev.cause }
        return this.pause(140)
      case 'noMove': return this.pause(360)
      case 'sixForfeit': return this.playSixForfeit(ev)
      case 'gameover': this.showGameOver(ev); return this.pause(200)
      default: return Promise.resolve()
    }
  }

  pause(ms) { return new Promise((r) => this.time.delayedCall(dur(this._behind ? Math.min(ms, 30) : ms), r)) }

  playRoll(ev) {
    // our own roll has been winding up since the tap - drop the shake and play
    // the real, full tumble (identical to local play) now that we know the value
    if (this._windup && ev.color === this.myColor) {
      this._windup.stop?.()
      this._windup = null
    }
    const snap = this._snapRoll && ev.color === this.myColor
    this._snapRoll = false
    return this.animateDiceTumble(ev.color, ev.raw, { doubled: Boolean(ev.doubled), instant: this._behind, snap })
  }

  playSixForfeit(ev) {
    this.flashSixForfeit?.(ev.color)
    return this.pause(1000)
  }

  playPowerUsed(ev) {
    if (ev.color !== this.myColor) {
      // Opponent water never changes the local player's selected face.
      this.playPowerEffect?.(ev.color, ev.key)
    }
    if (ev.key === 'earth') { this.syncShields(); this.playShieldAura?.(ev.color) }
    return this.pause(ev.color === this.myColor ? 60 : 420)
  }

  playMove(ev) {
    const pawn = this.pawnRef(ev.color, ev.pawnId)
    if (!pawn) return Promise.resolve()
    this._lastMoved = { color: ev.color, pawnId: ev.pawnId } // the attacker if a capture follows
    const pm = this._predicted
    if (pm && pm.color === ev.color && pm.pawnId === ev.pawnId && pm.to === ev.to) {
      // we already started this exact move on tap - let it finish
      this._predicted = null
      pawn.steps = ev.to
      pawn.finished = ev.to >= 56
      const done = this._moveAnimDone || Promise.resolve()
      this._moveAnimDone = null
      return done
    }
    const from = pawn.steps
    pawn.steps = ev.to
    pawn.finished = ev.to >= 56
    if (this._behind) { this.positionPawn(pawn, false); this.reflowPawns(false); return Promise.resolve() }
    return new Promise((res) => this.animatePawn(pawn, from, ev.to, res))
  }

  playGate(ev) {
    this.flashGate?.(ev.index)
    // the pawn's owner passes the gate; whoever's turn it is makes the pick
    const picker = ev.picker ?? ev.color
    ;(this._gateIndex ||= {})[picker] = ev.index
    if (picker === this.myColor && !this._gatePickChoose) {
      this._gatePickOwner = this.myColor
      this.showGatePicker(this.myColor, (key) => this.send({ type: 'pickGateRune', key }))
    }
    return this.pause(220)
  }

  playRunePicked(ev) {
    if (this._gatePickChoose) this.closeGatePicker()
    const badge = this.playerBadges?.[ev.color]
    const from = this.gatePos?.(this._gateIndex?.[ev.color]) || { x: badge?.x ?? W / 2, y: badge?.y ?? H / 2 }
    this.animateGateGrant?.(ev.color, ev.key, from)
    return this.pause(180)
  }

  playBonus(ev) {
    const view = this.bonusRuneViews.get(ev.index)
    this.bonusRuneViews.delete(ev.index)
    const at = view ? { x: view.x, y: view.y } : this.getTrackPixel(ev.index)
    if (view) { this.tweens.killTweensOf(view); view.destroy() }
    // the extra roll belongs to whoever's turn it is (ev.roller), so the "+1"
    // flies to their dice tray, not the pawn owner's
    const trayColor = ev.roller ?? ev.color
    this.popAt(at.x, at.y, 0xffd54d)
    if (this._behind) { this.flyBonusToDie(at.x, at.y, trayColor); return this.pause(40) }
    return this.flyBonusToDie(at.x, at.y, trayColor)
  }

  playCapture(ev) {
    const victim = this.pawnRef(ev.color, ev.id)
    if (!victim) return Promise.resolve()
    const victimView = this.pawnViews.get(victim)
    this.captureCounts[ev.by] = (this.captureCounts[ev.by] || 0) + 1

    // the attacker is whatever pawn of ev.by just moved (the `moved` event runs
    // right before this); fall back to the nearest ev.by pawn to the victim
    let atk = this._lastMoved?.color === ev.by
      ? this.pawnRef(this._lastMoved.color, this._lastMoved.pawnId) : null
    if (!atk && victimView) {
      let best = Infinity
      for (const p of this.pawns) {
        if (p.color !== ev.by || p.steps < 0 || p.finished) continue
        const pv = this.pawnViews.get(p)
        if (!pv) continue
        const dd = Math.hypot(pv.x - victimView.x, pv.y - victimView.y)
        if (dd < best) { best = dd; atk = p }
      }
    }
    const attackerView = atk ? this.pawnViews.get(atk) : null

    victim.steps = -1
    victim.finished = false
    const home = this.getPawnPixel(victim)
    return new Promise((res) => this.kickPawn(ev.by, attackerView, ev.color, victimView, home, res))
  }

  playShieldBlockEv(ev) {
    const pawn = this.pawns.find((p) => p.color === ev.color && p.steps >= 0 && !p.finished)
    if (pawn) this.playShieldBlock?.(pawn)
    this.syncShields()
    return this.pause(320)
  }

  playFinish(ev) {
    const pawn = this.pawnRef(ev.color, ev.pawnId)
    if (!pawn) return this.pause(120)
    pawn.finished = true
    pawn.steps = 56
    this.parkFinishedPawn(pawn)
    return this.pause(this._behind ? 60 : 260)
  }

  // "Blue & Green" for team id, in seat order
  teamName(id) {
    const g = this.g
    if (!g?.team) return ''
    return g.colors.filter((c) => g.team[c] === id).map((c) => t(`color.${c}`)).join(' & ')
  }

  showGameOver(ev) {
    if (this._resultShown || !ev.winner) return
    this._resultShown = true
    this.gameOver = true
    clearReconnect()
    const teamMode = this.team != null && (ev.winningTeam ?? this.g?.winningTeam ?? -1) >= 0
    const winTeam = ev.winningTeam ?? this.g?.winningTeam
    const won = teamMode ? this.teamOf(this.myColor) === winTeam : ev.winner === this.myColor
    const accent = COLOR_HEX[ev.winner]
    const layer = this.add.container(0, 0).setDepth(200)
    layer.add(this.add.rectangle(W / 2, H / 2, W, H, 0x05060f, 0.82).setInteractive())
    this.makeRoundedRectTexture(`net-vic-${ev.winner}`, 460, 300, 0x21364c, 0x101e31, 26, accent)
    const card = this.add.container(W / 2, H / 2, [this.add.image(0, 0, `net-vic-${ev.winner}`)])
    card.add(this.add.text(0, -84, won ? t('victory.youWin') : t('victory.defeat'), {
      fontFamily: 'Verdana, sans-serif', fontSize: 40, color: '#fff', fontStyle: 'bold',
    }).setOrigin(0.5))
    card.add(this.add.text(0, -30,
      teamMode
        ? t('victory.teamHome', { team: this.teamName(winTeam) })
        : t('victory.allHome', { color: t(`color.${ev.winner}`) }), {
      fontFamily: 'Verdana, sans-serif', fontSize: 13, color: '#c9b8ff',
    }).setOrigin(0.5))
    this.makeRoundedRectTexture('net-vic-btn', 200, 56, 0x22c48d, 0x10ad85, 15, 0x64dfad)
    card.add(this.add.image(0, 74, 'net-vic-btn'))
    card.add(this.add.text(0, 74, t('victory.home'), {
      fontFamily: 'Verdana, sans-serif', fontSize: 18, color: '#08240f', fontStyle: 'bold',
    }).setOrigin(0.5))
    layer.add(card)
    this.makeHitZone(W / 2, H / 2 + 74, 200, 56).setDepth(210).on('pointerup', () => { sfx.tap(); this.goTo('Home') })
    card.setScale(0.8).setAlpha(0)
    this.tweens.add({ targets: card, scale: 1, alpha: 1, duration: dur(240), ease: EASE.out })
  }
}

// Fold in the shared rendering mixins, then restore this class's own methods on
// top - several names (usePower, playerName, updatePawnHighlights, podFor, ...)
// are deliberately overridden here for online play and must win over the mixin.
const ownProps = Object.getOwnPropertyDescriptors(NetLudoScene.prototype)
Object.assign(
  NetLudoScene.prototype,
  GeometryMixin,
  BoardViewMixin,
  PlayersMixin,
  PawnsMixin,
  PowersMixin,
  CombatMixin,
  DiceAnimMixin,
)
delete ownProps.constructor
Object.defineProperties(NetLudoScene.prototype, ownProps)
