import { randomInt } from 'node:crypto'
import { Room, ServerError, matchMaker } from 'colyseus'
import {
  createGame, reduce, publicView, currentColor, legalMoves,
  chooseAiMove, chooseAiPower, bestForcedDice, aiState,
  TURN_SECONDS, MOVE_SECONDS,
} from '@ludo/engine'
import { LudoState, Seat } from './schema/LudoState.js'
import { verifyTicket, playfabEnabled, awardMatchRewards } from '../playfab.js'

const SEAT_COLORS = ['blue', 'red', 'green', 'yellow']
const LOBBY_WAIT_MS = 12_000    // start with bots if the room isn't full by now
const BOT_THINK_MS = 900        // pause before a bot acts, so play is watchable
const RECONNECT_SECONDS = 45

export class LudoRoom extends Room {
  maxClients = 4
  state = new LudoState()

  messages = {
    action: (client, message) => this.handleAction(client, message),
    start: (client) => this.hostStart(client),
  }

  async onCreate(options) {
    this.difficulty = options?.difficulty || 'normal'
    this.maxClients = Math.min(4, Math.max(2, Number(options?.maxPlayers) || 2))
    this.state.maxSeats = this.maxClients
    this.private = Boolean(options?.private)
    // solo test mode: one human + bots, starts the instant the player joins and
    // is kept out of quick-match so nobody else can drop in.
    this.solo = Boolean(options?.solo)
    if (this.solo) this.setPrivate(true)
    // test hooks - production leaves these at the defaults above / in the engine
    this.botThinkMs = Number(options?.botThinkMs) || BOT_THINK_MS
    this.turnSecondsOverride = Number(options?.turnSeconds) || 0
    this.lobbyWaitMs = Number(options?.lobbyWaitMs) || LOBBY_WAIT_MS
    this.engine = null
    this.autoDispose = true

    if (this.private) {
      const code = await this.uniqueCode()
      this.state.code = code
      this.setPrivate(true) // keep it out of quick-match / the public listing
      this.setMetadata({ code })
    }
  }

  async uniqueCode() {
    for (let i = 0; i < 8; i++) {
      const code = String(randomInt(100000, 1000000))
      const rooms = await matchMaker.query({ name: 'ludo' })
      if (!rooms.some((r) => r.metadata?.code === code)) return code
    }
    return String(randomInt(100000, 1000000))
  }

  hostStart(client) {
    if (this.engine) return
    if (this.state.hostId && client.sessionId !== this.state.hostId) return
    this.startMatch()
  }

  turnMs() {
    if (this.turnSecondsOverride) return this.turnSecondsOverride * 1000
    return (this.engine?.phase === 'move' ? MOVE_SECONDS : TURN_SECONDS) * 1000
  }

  // Verify the PlayFab ticket (if PlayFab is configured); otherwise allow as a
  // guest so local / offline development still works.
  async onAuth(client, options) {
    try {
      const info = await verifyTicket(options?.ticket)
      if (info) return { playFabId: info.playFabId || '', name: info.name || options?.name || 'Player' }
    } catch (err) {
      if (playfabEnabled) throw new ServerError(401, 'invalid session ticket')
    }
    return { playFabId: '', name: options?.name || 'Guest' }
  }

  onJoin(client, options, auth) {
    const seat = new Seat()
    seat.name = auth?.name || 'Guest'
    seat.playFabId = auth?.playFabId || ''
    seat.connected = true
    this.state.seats.set(client.sessionId, seat)
    if (this.private && !this.state.hostId) this.state.hostId = client.sessionId

    if (this.engine) return // running game is locked; shouldn't get here

    if (this.solo) {
      this.startMatch() // bots take every other seat right away
    } else if (this.humanSeats().length >= this.maxClients) {
      this.startMatch()
    } else if (!this.private && !this.lobbyTimer) {
      // quick match: give real opponents a short window to arrive, then
      // fill the empty seats with bots so a lone player still gets a game
      this.lobbyTimer = this.clock.setTimeout(() => this.startMatch(), this.lobbyWaitMs)
    }
    // private rooms wait for the room to fill or for the host to press "start"
  }

  onDrop(client) {
    const seat = this.state.seats.get(client.sessionId)
    if (seat) seat.connected = false
    this.armClock() // a bot covers the seat while it's gone
    this.allowReconnection(client, RECONNECT_SECONDS).catch(() => {})
  }

  onReconnect(client) {
    const seat = this.state.seats.get(client.sessionId)
    if (seat) seat.connected = true
    this.syncState([]) // full state to the returning client
    this.armClock()
  }

  onLeave(client) {
    const seat = this.state.seats.get(client.sessionId)
    if (seat) seat.connected = false
    if (!this.engine) this.state.seats.delete(client.sessionId)
    this.armClock()
  }

  onDispose() {
    this.turnTimer?.clear()
    this.lobbyTimer?.clear()
  }

  // ---------------------------------------------------------------- lifecycle

  humanSeats() {
    return [...this.state.seats.values()].filter((s) => !s.bot)
  }

  seatByColor(color) {
    for (const seat of this.state.seats.values()) if (seat.color === color) return seat
    return null
  }

  startMatch() {
    if (this.engine) return
    const humans = this.humanSeats()
    if (humans.length < 1) return // nothing to start
    this.lobbyTimer?.clear()
    this.lobbyTimer = null
    this.lock()

    // fill the room to the size it was matched for; bots take the empty seats
    const colors = SEAT_COLORS.slice(0, this.maxClients)
    humans.forEach((seat, i) => { seat.color = colors[i] })
    for (let i = humans.length; i < colors.length; i++) {
      const bot = new Seat()
      bot.color = colors[i]
      bot.name = `CPU ${i}`
      bot.bot = true
      bot.connected = true
      this.state.seats.set(`bot:${colors[i]}`, bot)
    }

    this.engine = createGame({ colors, seed: randomInt(1, 2 ** 31) })
    this.syncState([{ t: 'start', colors }])
    this.armClock()
  }

  async endMatch() {
    this.turnTimer?.clear()
    this.syncState([])
    try {
      await awardMatchRewards(this.engine, [...this.state.seats.values()])
    } catch (err) {
      console.error('[ludo] reward grant failed:', err.message)
    }
    this.clock.setTimeout(() => this.disconnect(), 8_000)
  }

  // ------------------------------------------------------------------ engine

  handleAction(client, action) {
    if (!this.engine || this.engine.phase === 'gameover') return
    const seat = this.state.seats.get(client.sessionId)
    if (!seat) return

    // A gate rune pick belongs to whoever passed the gate and is resolved out of
    // band - the turn may already have moved on while their picker floats.
    if (action?.type === 'pickGateRune') {
      if (this.engine.pendingGate?.color !== seat.color) {
        client.send('rejected', { error: 'no gate pick pending' })
        return
      }
      const out = this.applyAction(action)
      if (out?.error) client.send('rejected', { error: out.error })
      return
    }

    if (seat.color !== currentColor(this.engine)) {
      client.send('rejected', { error: 'not your turn' })
      return
    }
    const result = this.applyAction(action)
    if (result?.error) client.send('rejected', { error: result.error })
  }

  applyAction(action) {
    const { state, events, error } = reduce(this.engine, action)
    if (error) return { error }
    this.engine = state
    this.syncState(events)
    this.armClock()
    return { ok: true }
  }

  syncState(events) {
    const over = this.engine.phase === 'gameover'
    this.state.phase = over ? 'gameover' : 'playing'
    this.state.currentColor = over ? '' : currentColor(this.engine)
    this.state.gameJson = JSON.stringify(publicView(this.engine))
    if (events && events.length) this.broadcast('events', events)
  }

  armClock() {
    this.turnTimer?.clear()
    if (!this.engine) return
    if (this.engine.phase === 'gameover') { this.endMatch(); return }

    const color = currentColor(this.engine)
    const seat = this.seatByColor(color)
    const auto = !seat || seat.bot || !seat.connected
    const ms = auto ? this.botThinkMs : this.turnMs()

    this.state.currentColor = color
    this.state.turnDeadline = this.clock.currentTime + ms
    this.turnTimer = this.clock.setTimeout(() => this.autoPlay(color), ms)
  }

  autoPlay(color) {
    if (!this.engine || currentColor(this.engine) !== color) return
    const seat = this.seatByColor(color)
    if (!seat || seat.bot || !seat.connected) this.botStep(color)
    else this.applyAction({ type: 'timeout' })
  }

  botStep(color) {
    const s = this.engine
    if (!s || s.phase === 'gameover' || currentColor(s) !== color) return

    if (s.phase === 'roll') {
      const ai = aiState(s, this.difficulty)
      const power = chooseAiPower(ai)
      if (power === 'water') this.applyAction({ type: 'usePower', key: 'water', value: bestForcedDice(ai) })
      else if (power === 'fire' || power === 'earth') this.applyAction({ type: 'usePower', key: power })
      this.applyAction({ type: 'roll' })
    } else if (s.phase === 'move') {
      const choice = chooseAiMove(aiState(s, this.difficulty))
      this.applyAction(choice ? { type: 'move', pawnId: choice.id } : { type: 'timeout' })
    }
    // each applyAction re-arms the clock; if it's still this bot's turn the
    // next autoPlay fires after BOT_THINK_MS.
    void legalMoves
  }
}
