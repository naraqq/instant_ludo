# Elemental Ludo polish pass

The home screen, match setup, settings, statistics, room lobby, power pickers,
and victory panels now share dark arena surfaces and elemental accents. Setup
controls are larger, labels are shorter, and selecting an option no longer
replays the modal entrance. Name and room-code forms support keyboard focus,
Escape, and inline errors. Daily rewards update without restarting Home.

Pawn journeys use one continuous tile-center path instead of a timer and tween
for every hop. The next action waits for the landing to settle. Decorative pawn
pulses respect reduced motion; button feedback cancels its previous tween.

Online event batches carry matching server snapshots, preventing later turns
from overwriting the animation being played. The client resets scene references
between matches, handles the initial empty schema, removes lobby hit areas, and
recovers its seat after a dropped connection. Rejected predictions are cancelled;
opponent water effects cannot overwrite your dice choice. Pending gate choices
and completed matches are restored from authoritative state.

The server ignores remote dice overrides, transfers private-room hosting when a
host leaves, preserves another player's active deadline, matches table sizes,
and grants end-of-match rewards at most once. Production mode disables client
clock overrides. Older clients retain the original event-array protocol.

## Verification

Verified: 71 tests pass (35 client, 17 engine, 19 server), the production build
passes, and the two-browser smoke test completes with no browser or playback
errors.

Use Node 22 (`.nvmrc`), as required by the multiplayer dependencies.

```sh
npm test
npm run build
```

Browser smoke test (three terminals, using Bash environment syntax):

```sh
# 1. Local guest server, without production credentials
PLAYFAB_TITLE_ID='' PLAYFAB_SECRET_KEY='' npm run server

# 2. Client pointed at that server
VITE_COLYSEUS_URL=ws://127.0.0.1:2567 VITE_PLAYFAB_TITLE_ID='' npm run dev -w @ludo/client -- --port 5174

# 3. Once both servers are ready
node node_modules/playwright-core/cli.js install chromium
node packages/client/scripts/smoke.mjs
```

`SMOKE_URL` overrides the default client URL. The smoke test opens two isolated
browser sessions, creates and joins a private room, plays turns, compares server
state, interrupts a socket with the SDK's reconnect close code, verifies the same
seat returns, and starts another match. It fails on browser or playback errors
and saves `ludo-online.png` to the system temporary directory.

Additional browser checks covered home-to-game navigation, settings and stats,
room-code validation, keyboard dismissal, and reduced motion at 360×640 and
390×844. Screenshots are in [art/polish](art/polish).

## Release scope

These checks use local guest multiplayer and desktop Chromium with phone-sized
viewports. Physical-device frame pacing, live-region latency/load, and PlayFab
authentication/rewards still require release validation. The existing PlayFab
reward service is a stub; this pass guards repeated calls but does not implement
that economy integration.

Deploy the server and client to enable the snapshot improvements. Older client
versions remain compatible. Phaser is still the largest download; separate
framework and SDK chunks allow them to stay cached across game-only updates.
