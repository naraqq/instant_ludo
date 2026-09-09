# Elemental Ludo

npm-workspaces monorepo.

```
packages/
  engine/   @ludo/engine  — framework-free rules (createGame, reduce, board data). No deps.
  client/   @ludo/client  — the Phaser game (Vite). Deploys to Netlify.
  server/   @ludo/server  — authoritative Colyseus match server. Deploys to Colyseus Cloud. (Phase 3)
```

## Commands (run from the repo root)

| | |
|---|---|
| `npm install` | install + link workspaces |
| `npm run dev` | client dev server (Vite) |
| `npm run build` | client production build → `packages/client/dist` |
| `npm run server` | run the server package |
| `npm test` | run every workspace's test script |
| `npm run test -w @ludo/engine` | engine tests only |

## Deployment

- **Client** → Netlify. Build from repo root (`netlify.toml`), publish `packages/client/dist`.
  Env: `VITE_PLAYFAB_TITLE_ID`, `VITE_COLYSEUS_URL`.
- **Server** → Colyseus Cloud, root directory `packages/server`.
  Env / secrets: `PLAYFAB_TITLE_ID`, `PLAYFAB_SECRET_KEY`.
- **PlayFab** → config only (Game Manager). Auth, economy, leaderboards, analytics.


## Quality checks

Use Node 22 (`.nvmrc`). See [QUALITY.md](QUALITY.md) for the polish changes,
local multiplayer smoke test, visual previews, and release validation scope.
