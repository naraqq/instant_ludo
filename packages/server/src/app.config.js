import { defineServer, defineRoom, monitor, playground } from 'colyseus'
import { LudoRoom } from './rooms/LudoRoom.js'

export default defineServer({
  rooms: {
    ludo: defineRoom(LudoRoom),
  },

  express: (app) => {
    app.get('/health', (_req, res) => res.json({ ok: true, service: 'elemental-ludo' }))

    // Dev-only inspectors. Never expose these unprotected in production.
    if (process.env.NODE_ENV !== 'production') {
      app.use('/monitor', monitor())
      app.use('/playground', playground())
    }
  },
})
