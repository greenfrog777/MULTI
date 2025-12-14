**Overview**
- **Purpose:** Small Phaser 3 multiplayer demo (Express + Socket.IO) with a lobby and short matches.
- **Start point:** server runs from [server.js](server.js), serves static client from `public/`.

**Architecture (big picture)**
- **Server:** [server.js](server.js) is the authoritative state holder: `players`, `arrows`, match lifecycle, and a 20Hz server tick for arrow physics.
- **Client:** Phaser app in [public/main.js](public/main.js) — scenes: `LoginScene`, `LobbyScene`, `GameScene`, `VictoryScene`.
- **Networking:** [public/network.js](public/network.js) wraps `socket.io` and exposes helpers: `connectToServer`, `sendMove`, `sendReady`, `requestStartBattle`, `sendBackToLobby`.

**Why this structure**
- Server-authoritative gameplay avoids client-side cheating: server spawns and simulates arrows (`spawnArrow`, `updateArrows`), applies damage, and emits `gameStart`/`gameOver`.
- Client is primarily a renderer and input forwarder — it interpolates positions and arrows for smooth visuals.

**Key events & payloads (use these exact names)**
- From client -> server: `join(name)`, `move({x,y})`, `ready(bool)`, `startBattle`, `shootArrowNew({x,y,angle})`, `backToLobby`.
- From server -> client: `init`, `update` (player position), `remove`, `lobbyUpdate`, `startBattle`, `gameStart`, `gameOver`, `spawnArrow`, `updateArrows`, `playerHit`.

**Patterns & conventions to follow**
- Maintain server authority for any game state changes that affect gameplay (HP, death, matchActive). Change server logic in [server.js](server.js) only when all clients expect the same events.
- Client-side smoothing: client stores `window.serverPlayers` and interpolates sprites — preserve these keys when modifying payload shape.
- Phaser scenes: keep UI/lobby logic in `LobbyScene` and gameplay visuals in `GameScene`. Use `startNetwork(scene, name)` to hook scene callbacks.

**Developer workflows**
- Start dev server: `npm start` (runs `node server.js`). The server listens on `http://localhost:3000`.
- Debugging: server logs appear in the terminal; client logs are in the browser console. Use both when investigating sync issues.

**Files to inspect for changes**
- Server gameplay: [server.js](server.js) — arrow tick loop, collision, lobby management.
- Client scenes & rendering: [public/main.js](public/main.js) — scene lifecycle, `setupArrowHandlers`, `addPlayer`, `drawHealthBar`, `cleanupGameEntities`.
- Networking helpers: [public/network.js](public/network.js) — canonical event names and emit wrappers.

**Examples**
- To broadcast a player movement from server: `io.emit('update', { id, position: { x, y, name, colour } });` (see [server.js](server.js)).
- Client expects `gameStart` payload of shape `{ players }` and will call `addPlayer(scene, id, info)` for each entry (see [public/main.js](public/main.js)).

**When changing events or payloads**
- Update both sender and receiver files together: modify [server.js](server.js) and the handler in [public/network.js](public/network.js) and consumers in [public/main.js](public/main.js).
- Keep backward-compatible keys where possible (e.g., include `colour`, `joinOrder`, `ready` when emitting lobby snapshots).

**What to avoid**
- Don't move authoritative logic from `server.js` to the client. Health, hit detection, and match win conditions must remain server-side.

If anything here is unclear or you want the instructions to be more prescriptive (linting, commit message formats, or testing steps), tell me which area to expand. 