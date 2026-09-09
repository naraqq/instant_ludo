import { randomInt } from 'node:crypto'
import { Room, ServerError, matchMaker } from 'colyseus'
import {
  createGame, reduce, publicView, currentColor, legalMoves,
  chooseAiMove, chooseAiPower, bestForcedDice, aiState,
} from '@ludo/engine'
import { LudoState, Seat } from './schema/LudoState.js'
import { verifyTicket, playfabEnabled, awardMatchRewards } from '../playfab.js'

const SEAT_COLORS = ['blue', 'red', 'green', 'yellow']
// A 1v1 seats the two players on opposite corners (blue bottom-left, green
// top-right) rather than side by side, so the board reads as a real duel.
const SEAT_COLORS_2P = ['blue', 'green']
const LOBBY_WAIT_MS = 12_000    // start with bots if the room isn't full by now
const BOT_THINK_MS = 900        // pause before a bot acts, so play is watchable
const HUMAN_RESPONSE_MS = 10_000
const RECONNECT_SECONDS = 45

export class LudoRoom extends Room {
  maxClients = 4
  state = new LudoState()

  messages = {
    action: (client, message) => this.handleAction(client, message),
    manual: (client) => this.reclaimManualControl(client),
    start: (client) => this.hostStart(client),
  }

  async onCreate(options) {
    this.difficulty = options?.difficulty || 'normal'
    // 2v2 team match: diagonal pairs, always a full 4-seat table
    this.teams = Boolean(options?.teams)
    this.maxClients = this.teams
      ? 4
      : Math.min(4, Math.max(2, Math.floor(Number(options?.maxPlayers) || 2)))
    this.state.maxSeats = this.maxClients
    this.state.teams = this.teams
    this.private = Boolean(options?.private)
    // solo test mode: one human + bots, starts the instant the player joins and
    // is kept out of quick-match so nobody else can drop in.
    this.solo = Boolean(options?.solo)
    if (this.solo) this.setPrivate(true)
    // Test timing overrides must never be controlled by production clients.
    const timing = process.env.NODE_ENV === 'production' ? {} : options
    this.botThinkMs = Number(timing?.botThinkMs) || BOT_THINK_MS
    this.turnSecondsOverride = Number(timing?.turnSeconds) || 0
    this.lobbyWaitMs = Number(timing?.lobbyWaitMs) || LOBBY_WAIT_MS
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
    return HUMAN_RESPONSE_MS
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
    client.userData = { eventSnapshots: options?.eventSnapshots === true }
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
    if (this.engine && seat?.color === currentColor(this.engine)) this.armClock() // cover only the dropped turn
    this.allowReconnection(client, RECONNECT_SECONDS).catch(() => {})
  }

  onReconnect(client) {
    const seat = this.state.seats.get(client.sessionId)
    if (seat) seat.connected = true
    if (this.engine) this.syncState([]) // lobby reconnections have no engine yet
    if (this.engine && seat?.color === currentColor(this.engine)) this.armClock()
  }

  onLeave(client) {
    const seat = this.state.seats.get(client.sessionId)
    if (seat) seat.connected = false
    if (!this.engine) {
      this.state.seats.delete(client.sessionId)
      if (this.state.hostId === client.sessionId) {
        this.state.hostId = [...this.state.seats.keys()][0] || ''
      }
    }
    if (this.engine && seat?.color === currentColor(this.engine)) this.armClock()
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
    const palette = this.maxClients === 2 ? SEAT_COLORS_2P : SEAT_COLORS
    const colors = palette.slice(0, this.maxClients)
    humans.forEach((seat, i) => { seat.color = colors[i] })
    for (let i = humans.length; i < colors.length; i++) {
      const bot = new Seat()
      bot.color = colors[i]
      bot.name = `CPU ${i}`
      bot.bot = true
      bot.connected = true
      this.state.seats.set(`bot:${colors[i]}`, bot)
    }

    this.engine = createGame({ colors, seed: randomInt(1, 2 ** 31), teams: this.teams })
    this.syncState([{ t: 'start', colors, teams: this.teams }])
    this.armClock()
  }

  async endMatch() {
    if (this._ending) return
    this._ending = true
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
    // A real interaction always gives control back to the human.
    if (!seat.bot && seat.auto) this.reclaimManualControl(client)

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
    // Explicit dice values belong to deterministic engine tests, never remote players.
    const result = this.applyAction(action?.type === 'roll' ? { type: 'roll' } : action)
    if (result?.error) client.send('rejected', { error: result.error })
  }

  reclaimManualControl(client) {
    const seat = this.state.seats.get(client.sessionId)
    if (!seat || seat.bot || !seat.auto) return
    seat.auto = false
    // If this is still their decision, restart the full response window.
    if (this.engine && seat.color === currentColor(this.engine)) this.armClock()
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
    if (over) {
      this.state.turnDeadline = 0
      this.state.turnDuration = 0
    }
    this.state.winningTeam = this.engine.winningTeam ?? -1
    this.state.gameJson = JSON.stringify(publicView(this.engine))
    if (events && events.length) {
      // Keep installed clients working while the web client rolls out.
      const modern = this.clients.filter(client => client.userData?.eventSnapshots)
      const legacy = this.clients.filter(client => !client.userData?.eventSnapshots)
      if (modern.length) this.broadcast('events', { events, game: publicView(this.engine) }, { afterNextPatch: true, except: legacy })
      if (legacy.length) this.broadcast('events', events, { afterNextPatch: true, except: modern })
    }
  }

  armClock() {
    this.turnTimer?.clear()
    if (!this.engine) return
    if (this.engine.phase === 'gameover') { this.endMatch(); return }

    const color = currentColor(this.engine)
    const seat = this.seatByColor(color)
    const auto = !seat || seat.bot || seat.auto || !seat.connected
    const ms = auto ? this.botThinkMs : this.turnMs()

    this.state.currentColor = color
    // room-elapsed ms (matches the client SDK's room.clock.serverNow()), not the
    // epoch clock.currentTime
    this.state.turnDeadline = this.clock.elapsedTime + ms
    this.state.turnDuration = ms
    this.turnTimer = this.clock.setTimeout(() => this.autoPlay(color), ms)
  }

  autoPlay(color) {
    if (!this.engine || currentColor(this.engine) !== color) return
    const seat = this.seatByColor(color)
    if (seat && !seat.bot && seat.connected && !seat.auto) seat.auto = true
    this.botStep(color)
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
