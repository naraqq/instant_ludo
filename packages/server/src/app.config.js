import { defineServer, defineRoom, monitor, playground, matchMaker } from 'colyseus'
import express from 'express'
import { LudoRoom } from './rooms/LudoRoom.js'
import { guestLogin } from './playfab.js'

// The web client lives on a different origin (Netlify); allow it to call /auth.
function cors(req, res, next) {
  res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
}

export default defineServer({
  rooms: {
    ludo: defineRoom(LudoRoom),
  },

  express: (app) => {
    app.use(express.json())
    app.use('/auth', cors)
    app.use('/find', cors)

    app.get('/health', (_req, res) => res.json({ ok: true, service: 'elemental-ludo' }))

    // Resolve a 6-digit private-room code to its roomId (for joinById).
    app.get('/find/:code', async (req, res) => {
      const code = String(req.params.code || '').trim()
      if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'bad code' })
      try {
        const rooms = await matchMaker.query({ name: 'ludo' })
        const room = rooms.find((r) => r.metadata?.code === code && !r.locked)
        if (!room) return res.status(404).json({ error: 'no room with that code' })
        res.json({ roomId: room.roomId })
      } catch (err) {
        console.error('[find] failed:', err.message)
        res.status(500).json({ error: 'lookup failed' })
      }
    })

    // Server-authoritative anonymous login: device id -> PlayFab session ticket.
    app.post('/auth/guest', async (req, res) => {
      try {
        const out = await guestLogin(req.body?.deviceId)
        res.json(out)
      } catch (err) {
        console.error('[auth] guest login failed:', err.message)
        res.status(502).json({ error: 'login failed' })
      }
    })

    // Dev-only inspectors. Never expose these unprotected in production.
    if (process.env.NODE_ENV !== 'production') {
      app.use('/monitor', monitor())
      app.use('/playground', playground())
    }
  },
})
