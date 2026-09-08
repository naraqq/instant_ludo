import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import { boot } from '@colyseus/testing'
import { legalMoves, currentColor } from '@ludo/engine'
import appConfig from '../src/app.config.js'

let colyseus
before(async () => { colyseus = await boot(appConfig) })
after(async () => { await colyseus.shutdown() })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const quiet = (c) => { c.onMessage('events', () => {}); c.onMessage('rejected', () => {}) }

test('seats humans in join order and fills the rest with bots', async () => {
  const room = await colyseus.createRoom('ludo', { maxPlayers: 4, botThinkMs: 5 })
  const c1 = await colyseus.connectTo(room, { name: 'Alice' })
  const c2 = await colyseus.connectTo(room, { name: 'Bob' })
  room.startMatch()
  await wait(40)

  assert.equal(room.state.phase, 'playing')
  assert.equal(room.state.seats.size, 4)
  const seats = [...room.state.seats.values()]
  assert.equal(seats.filter((s) => s.bot).length, 2)
  assert.equal(seats.find((s) => s.name === 'Alice').color, 'blue')
  assert.equal(seats.find((s) => s.name === 'Bob').color, 'red')
  assert.ok(room.state.gameJson.length > 0)
  c1.leave(); c2.leave()
})

test('a lone human still gets a full table of bots', async () => {
  const room = await colyseus.createRoom('ludo', { maxPlayers: 4, botThinkMs: 5 })
  const c1 = await colyseus.connectTo(room, { name: 'Solo' })
  room.startMatch()
  await wait(40)
  assert.equal([...room.state.seats.values()].filter((s) => s.bot).length, 3)
  c1.leave()
})

test('only the player whose turn it is may act', async () => {
  const room = await colyseus.createRoom('ludo', { maxPlayers: 4, botThinkMs: 999_999, turnSeconds: 999 })
  const a = await colyseus.connectTo(room, { name: 'A' })
  const b = await colyseus.connectTo(room, { name: 'B' })
  quiet(a); quiet(b)
  room.startMatch()
  await wait(40)

  // A (blue) is first. B (red) acting now must be rejected.
  let rejected = null
  b.onMessage('rejected', (m) => { rejected = m })
  b.send('action', { type: 'roll' })
  await wait(60)
  assert.equal(rejected?.error, 'not your turn')

  const before = room.state.gameJson
  a.send('action', { type: 'roll' })
  await wait(60)
  assert.notEqual(room.state.gameJson, before, "A's roll advanced the shared game")
  a.leave(); b.leave()
})

test('human + bot turns advance the one authoritative game', async () => {
  const room = await colyseus.createRoom('ludo', { maxPlayers: 4, botThinkMs: 3, turnSeconds: 1 })
  const a = await colyseus.connectTo(room, { name: 'A' })
  quiet(a)
  room.startMatch()
  await wait(40)
  const myColor = () => [...room.state.seats.values()].find((s) => s.name === 'A').color

  a.onStateChange((st) => {
    if (st.phase !== 'playing' || st.currentColor !== myColor()) return
    const g = JSON.parse(st.gameJson)
    if (g.phase === 'roll') a.send('action', { type: 'roll' })
    else if (g.phase === 'move') a.send('action', { type: 'move', pawnId: legalMoves(g)[0] })
  })

  await wait(4000)
  const g = JSON.parse(room.state.gameJson)
  assert.ok(g.turn > 15, `game advanced (turn ${g.turn})`)
  assert.ok(g.pawns.some((p) => p.steps > 0), 'pawns have moved onto the board')
  a.leave()
})

test('a winning move ends the match and reports the winner', async () => {
  const room = await colyseus.createRoom('ludo', { maxPlayers: 2, botThinkMs: 999_999, turnSeconds: 999 })
  const a = await colyseus.connectTo(room, { name: 'Champ' })
  const b = await colyseus.connectTo(room, { name: 'Rival' })
  quiet(a); quiet(b)
  room.startMatch()
  await wait(40)

  // hand-set the engine: Champ's colour has 3 pawns home and 1 on the doorstep
  const champ = room.state.seats.get(a.sessionId).color
  assert.equal(currentColor(room.engine), champ)
  room.engine.pawns
    .filter((p) => p.color === champ)
    .forEach((p, i) => { if (i < 3) { p.finished = true; p.steps = 56 } else p.steps = 55 })

  a.send('action', { type: 'roll', value: 1 }) // value is honoured by the engine
  await wait(60)
  a.send('action', { type: 'move', pawnId: 3 })
  await wait(120)

  assert.equal(room.state.phase, 'gameover')
  const final = JSON.parse(room.state.gameJson)
  assert.equal(final.winner, champ)
  a.leave(); b.leave()
})
test('a private room gets a 6-digit code and a friend can join it', async () => {
  const host = await colyseus.sdk.create('ludo', { name: 'Host', private: true, maxPlayers: 2, botThinkMs: 5 })
  quiet(host)
  await wait(60)
  const code = host.state.code
  assert.match(code, /^\d{6}$/, 'room has a 6-digit code')
  assert.equal(host.state.hostId, host.sessionId)

  // resolve the code via the HTTP route
  const res = await colyseus.http.get(`/find/${code}`)
  assert.equal(res.data.roomId, host.roomId)

  const friend = await colyseus.sdk.joinById(host.roomId, { name: 'Friend' })
  quiet(friend)
  await wait(80)
  // 2/2 -> auto-start
  assert.equal(host.state.phase, 'playing')
  assert.equal([...host.state.seats.values()].filter((s) => !s.bot).length, 2)
  host.leave(); friend.leave()
})

test('host can start early with bots via the start message', async () => {
  const host = await colyseus.sdk.create('ludo', { name: 'Solo', private: true, maxPlayers: 2, botThinkMs: 5 })
  quiet(host)
  await wait(60)
  assert.equal(host.state.phase, 'lobby')
  host.send('start', {})
  await wait(80)
  assert.equal(host.state.phase, 'playing')
  assert.equal([...host.state.seats.values()].filter((s) => s.bot).length, 1)
  host.leave()
})

test('an unknown code 404s', async () => {
  const res = await colyseus.http.get('/find/000000').catch((e) => e)
  assert.equal(res.statusCode ?? res.status, 404)
})
