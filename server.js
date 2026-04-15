const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const colours = ["#0000ff", "#ff0000", "#00ff00", "#ffa500", "#ff00ff", "#00ffff", "#ffff00"];
let players = {};
let nextJoinOrder = 1; // incremental join order for lobby sorting
let matchActive = false; // whether a battle is currently active
// Centralized player health constant (imported from shared constants)
const {
    PLAYER_MAX_HP,
    PLAYER_MOVE_SPEED,
    WORLD_WIDTH,
    WORLD_HEIGHT,
    WORLD_MARGIN,
    SERVER_SIM_HZ,
    SERVER_BROADCAST_HZ,
    INPUT_PERSIST_MS
} = require('./shared/constants');

const PLAYER_COLLISION_RADIUS = 18;
const GAME_OVER_DELAY_MS = 1200;
const BATTLE_WALLS = Object.freeze([
    { id: 'center-pillar', x: 364, y: 208, w: 72, h: 184, colour: '#5a4631', stroke: '#2f2418' },
    { id: 'top-cover', x: 308, y: 126, w: 184, h: 28, colour: '#6b553d', stroke: '#392c1d' },
    { id: 'left-cover', x: 176, y: 246, w: 124, h: 30, colour: '#6b553d', stroke: '#392c1d' },
    { id: 'right-cover', x: 500, y: 246, w: 124, h: 30, colour: '#6b553d', stroke: '#392c1d' },
    { id: 'bottom-cover', x: 308, y: 446, w: 184, h: 28, colour: '#5a4631', stroke: '#2f2418' }
]);

function createNeutralInput() {
    return { up: false, down: false, left: false, right: false };
}

function normalizeInput(payload) {
    const input = (payload && typeof payload.input === 'object') ? payload.input : payload;
    return {
        up: !!(input && input.up),
        down: !!(input && input.down),
        left: !!(input && input.left),
        right: !!(input && input.right)
    };
}

function serializePlayer(player) {
    return {
        x: player.x,
        y: player.y,
        vx: player.vx || 0,
        vy: player.vy || 0,
        colour: player.colour,
        hp: player.hp,
        dead: !!player.dead,
        name: player.name,
        ready: !!player.ready,
        joinOrder: player.joinOrder,
        inGame: !!player.inGame
    };
}

function serializePlayersMap(sourcePlayers) {
    const result = {};
    for (let pid in sourcePlayers) {
        if (!sourcePlayers[pid]) continue;
        result[pid] = serializePlayer(sourcePlayers[pid]);
    }
    return result;
}

function clampPlayerToWorld(player) {
    player.x = Math.max(WORLD_MARGIN, Math.min(WORLD_WIDTH - WORLD_MARGIN, player.x));
    player.y = Math.max(WORLD_MARGIN, Math.min(WORLD_HEIGHT - WORLD_MARGIN, player.y));
}

function serializeWalls() {
    return BATTLE_WALLS.map(wall => ({
        id: wall.id,
        x: wall.x,
        y: wall.y,
        w: wall.w,
        h: wall.h,
        colour: wall.colour,
        stroke: wall.stroke
    }));
}

function circleIntersectsWall(cx, cy, radius, wall) {
    const closestX = Math.max(wall.x, Math.min(cx, wall.x + wall.w));
    const closestY = Math.max(wall.y, Math.min(cy, wall.y + wall.h));
    const dx = cx - closestX;
    const dy = cy - closestY;
    return (dx * dx + dy * dy) < (radius * radius);
}

function resolveWallAxisCollision(candidateAlongAxis, fixedAxis, previousAlongAxis, axis) {
    for (const wall of BATTLE_WALLS) {
        if (axis === 'x') {
            if (fixedAxis + PLAYER_COLLISION_RADIUS <= wall.y || fixedAxis - PLAYER_COLLISION_RADIUS >= wall.y + wall.h) continue;
            if (candidateAlongAxis + PLAYER_COLLISION_RADIUS <= wall.x || candidateAlongAxis - PLAYER_COLLISION_RADIUS >= wall.x + wall.w) continue;

            if (candidateAlongAxis > previousAlongAxis) {
                candidateAlongAxis = wall.x - PLAYER_COLLISION_RADIUS;
            } else if (candidateAlongAxis < previousAlongAxis) {
                candidateAlongAxis = wall.x + wall.w + PLAYER_COLLISION_RADIUS;
            } else {
                const pushLeft = Math.abs(candidateAlongAxis - (wall.x - PLAYER_COLLISION_RADIUS));
                const pushRight = Math.abs((wall.x + wall.w + PLAYER_COLLISION_RADIUS) - candidateAlongAxis);
                candidateAlongAxis = pushLeft <= pushRight ? wall.x - PLAYER_COLLISION_RADIUS : wall.x + wall.w + PLAYER_COLLISION_RADIUS;
            }
            continue;
        }

        if (fixedAxis + PLAYER_COLLISION_RADIUS <= wall.x || fixedAxis - PLAYER_COLLISION_RADIUS >= wall.x + wall.w) continue;
        if (candidateAlongAxis + PLAYER_COLLISION_RADIUS <= wall.y || candidateAlongAxis - PLAYER_COLLISION_RADIUS >= wall.y + wall.h) continue;

        if (candidateAlongAxis > previousAlongAxis) {
            candidateAlongAxis = wall.y - PLAYER_COLLISION_RADIUS;
        } else if (candidateAlongAxis < previousAlongAxis) {
            candidateAlongAxis = wall.y + wall.h + PLAYER_COLLISION_RADIUS;
        } else {
            const pushUp = Math.abs(candidateAlongAxis - (wall.y - PLAYER_COLLISION_RADIUS));
            const pushDown = Math.abs((wall.y + wall.h + PLAYER_COLLISION_RADIUS) - candidateAlongAxis);
            candidateAlongAxis = pushUp <= pushDown ? wall.y - PLAYER_COLLISION_RADIUS : wall.y + wall.h + PLAYER_COLLISION_RADIUS;
        }
    }

    return candidateAlongAxis;
}

function resolvePlayerWallCollisions(player, nextX, nextY) {
    let resolvedX = resolveWallAxisCollision(nextX, player.y, player.x, 'x');
    let resolvedY = resolveWallAxisCollision(nextY, resolvedX, player.y, 'y');

    return { x: resolvedX, y: resolvedY };
}

io.on('connection', socket => {
    const id = socket.id;

    // Do not create the player record yet. Wait for the client to send a 'join' event
    // containing the player's chosen name. This prevents showing a default player
    // before the user has entered their name.

    // Handle movement updates
    socket.on('move', pos => {
        if (players[id]) {
            const player = players[id];

            // Backward-compatible fallback for older clients still sending raw positions.
            if (pos && typeof pos.x === 'number' && typeof pos.y === 'number' && !('up' in pos) && !('down' in pos) && !('left' in pos) && !('right' in pos) && !pos.input) {
                player.x = pos.x;
                player.y = pos.y;
                player.vx = 0;
                player.vy = 0;
                clampPlayerToWorld(player);
                io.emit('update', { id, position: serializePlayer(player), serverTime: Date.now() });
                return;
            }

            player.input = normalizeInput(pos);
            player.lastInputAt = Date.now();
            if (pos && typeof pos.seq === 'number') {
                player.lastInputSeq = pos.seq;
            }
        }
    });

    // Handle name/join event from client
    socket.on('join', name => {
        const clean = String(name || '').slice(0, 32) || ('Player' + id.slice(0,4));

        if (!players[id]) {
            // create player record now that we have a name
            const colour = colours[Object.keys(players).length % colours.length];
            players[id] = {
                x: WORLD_WIDTH / 2,
                y: WORLD_HEIGHT / 2,
                vx: 0,
                vy: 0,
                colour,
                hp: PLAYER_MAX_HP,
                dead: false,
                name: clean,
                ready: false,
                joinOrder: nextJoinOrder++,
                inGame: false,
                input: createNeutralInput(),
                lastInputAt: 0,
                lastInputSeq: 0
            };

            // Send all current players to the new client and include maxHp
            socket.emit('init', {
                players: serializePlayersMap(players),
                myId: id,
                walls: serializeWalls(),
                maxHp: PLAYER_MAX_HP,
                moveSpeed: PLAYER_MOVE_SPEED,
                serverSimHz: SERVER_SIM_HZ,
                serverBroadcastHz: SERVER_BROADCAST_HZ,
                inputPersistMs: INPUT_PERSIST_MS
            });

            // Notify all other clients about the new player
            socket.broadcast.emit('update', { id, position: serializePlayer(players[id]), serverTime: Date.now() });
            // Also send lobby update so everyone can refresh the lobby list
            emitLobbyUpdate();
        } else {
            // If player record already exists (reconnect), just update the name
            players[id].name = clean;
            // ensure joinOrder persists for reconnects
            if (!players[id].joinOrder) players[id].joinOrder = nextJoinOrder++;
            io.emit('update', { id, position: serializePlayer(players[id]), serverTime: Date.now() });
            emitLobbyUpdate();
        }
    });

    // Handle player ready toggle from client
    socket.on('ready', (isReady) => {
        if (!players[id]) return;
        players[id].ready = !!isReady;
        // broadcast updated lobby state
        emitLobbyUpdate();
    });

    // Handle startBattle request
    socket.on('startBattle', () => {
        // Only allow start using players currently in the lobby (not inGame)
        const playerIds = Object.keys(players).filter(pid => !players[pid].inGame);
        if (playerIds.length === 0) return;
        const allReady = playerIds.every(pid => players[pid] && players[pid].ready);
        if (!allReady) return;

        // Assign starting positions based on player count before starting
        const ids = playerIds;
        const count = Math.min(ids.length, 6);
        const margin = 60; // distance from edges
        const cx = WORLD_WIDTH / 2;
        const cy = WORLD_HEIGHT / 2;

        if (count === 1) {
            players[ids[0]].x = cx;
            players[ids[0]].y = cy;
        } else if (count === 2) {
            // left and right center
            players[ids[0]].x = margin;
            players[ids[0]].y = cy;
            players[ids[1]].x = WORLD_WIDTH - margin;
            players[ids[1]].y = cy;
        } else if (count === 3) {
            // left, right, top-middle
            players[ids[0]].x = margin;
            players[ids[0]].y = cy;
            players[ids[1]].x = WORLD_WIDTH - margin;
            players[ids[1]].y = cy;
            players[ids[2]].x = cx;
            players[ids[2]].y = margin;
        } else if (count === 4) {
            // left, right, top-middle, bottom-middle
            players[ids[0]].x = margin;
            players[ids[0]].y = cy;
            players[ids[1]].x = WORLD_WIDTH - margin;
            players[ids[1]].y = cy;
            players[ids[2]].x = cx;
            players[ids[2]].y = margin;
            players[ids[3]].x = cx;
            players[ids[3]].y = WORLD_HEIGHT - margin;
        } else {
            // Spread around the edges for more players (simple circular distribution near edges)
            for (let i = 0; i < ids.length; i++) {
                const angle = (i / ids.length) * Math.PI * 2;
                const rx = (WORLD_WIDTH / 2 - margin) * Math.cos(angle);
                const ry = (WORLD_HEIGHT / 2 - margin) * Math.sin(angle);
                players[ids[i]].x = cx + rx;
                players[ids[i]].y = cy + ry;
            }
        }

        // reset HP/dead state for all participating players and mark them in-game
        for (let pid of ids) {
            players[pid].dead = false;
            players[pid].hp = PLAYER_MAX_HP; // always reset HP at match start
            players[pid].inGame = true;
            players[pid].ready = false;
            players[pid].vx = 0;
            players[pid].vy = 0;
            players[pid].input = createNeutralInput();
            players[pid].lastInputAt = 0;
        }

        // mark match active
        if (pendingGameOverTimeout) {
            clearTimeout(pendingGameOverTimeout);
            pendingGameOverTimeout = null;
        }
        matchActive = true;

        // Notify clients to transition to the game
        io.emit('startBattle');

        // Also send full game init payload so clients can create player sprites
        // include authoritative max HP so clients display correctly
        io.emit('gameStart', {
            players: serializePlayersMap(players),
            walls: serializeWalls(),
            maxHp: PLAYER_MAX_HP,
            moveSpeed: PLAYER_MOVE_SPEED,
            serverSimHz: SERVER_SIM_HZ,
            serverBroadcastHz: SERVER_BROADCAST_HZ,
            inputPersistMs: INPUT_PERSIST_MS,
            serverTime: Date.now()
        });

        // Lobby membership changed (players moved into game) — update lobby lists
        emitLobbyUpdate();
    });

    socket.on('shootArrowNew', data => {
        // ignore if player hasn't joined yet
        if (!players[id]) return;
        if (!matchActive || !players[id].inGame || players[id].dead) return;

        // console.log('Server received shootArrowNew from', socket.id, 'data:', data);

        const playerArrows = arrows.filter(a => a.ownerId === socket.id);
        if (playerArrows.length > 0) return; // already shooting

        // console.log('Spawning arrow for', socket.id, 'at', data.x, data.y, 'angle', data.angle);

        spawnArrow(socket.id, data.x, data.y, data.angle);
    });    

    // Handle a player returning to the lobby (not automatically done by server)
    socket.on('backToLobby', () => {
        if (!players[id]) return;
        players[id].inGame = false;
        players[id].ready = false;
        players[id].dead = false;
        players[id].vx = 0;
        players[id].vy = 0;
        players[id].input = createNeutralInput();
        players[id].lastInputAt = 0;
        // Notify lobby clients
        emitLobbyUpdate();
    });

    // Receive lightweight client-side diagnostics and log them (so they appear in Render logs)
    socket.on('clientLog', payload => {
        try {
            console.log('[client-log]', socket.id, JSON.stringify(payload));
        } catch (e) {
            console.log('[client-log] error serializing payload', socket.id);
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        delete players[id];
        io.emit('remove', id);
        emitLobbyUpdate();
    });
});

// Helper to emit only players that are in the lobby (not currently in a running game)
function emitLobbyUpdate() {
    const lobbyPlayers = {};
    for (let pid in players) {
        if (!players[pid].inGame) {
            lobbyPlayers[pid] = serializePlayer(players[pid]);
        }
    }
    io.emit('lobbyUpdate', lobbyPlayers);
}

// Server-side simulation instrumentation
const _serverNetStats = {
    last: Date.now(),
    intervals: [],
    reportEvery: 100
};
const ARROW_SPEED = 600;
const ARROW_RADIUS = 10;    // adjust to match your sprite
const PLAYER_RADIUS = 20;   // approximate for collision

let arrows = []; // array of active arrows
let pendingGameOverTimeout = null;

// Call this when a player shoots
function spawnArrow(ownerId, x, y, angle) {
    const rad = angle * Math.PI / 180; // convert degrees to radians
    arrows.push({
        ownerId,
        x, y,
        vx: Math.cos(rad) * ARROW_SPEED,
        vy: Math.sin(rad) * ARROW_SPEED,
        angle // send angle to client
    });

    // tag arrow with serverTime and inform clients a new arrow exists
    arrows[arrows.length - 1].serverTime = Date.now();
    io.emit("spawnArrow", arrows[arrows.length - 1]);
}

function emitArrowImpact(payload) {
    io.emit('arrowImpact', {
        ownerId: payload.ownerId,
        targetId: payload.targetId || null,
        type: payload.type,
        x: payload.x,
        y: payload.y,
        serverTime: Date.now()
    });
}

let lastTickTime = Date.now();

// Main authoritative simulation loop
setInterval(() => {

    const now = Date.now();
    // server tick instrumentation
    const tickMs = now - _serverNetStats.last;
    _serverNetStats.last = now;
    _serverNetStats.intervals.push(tickMs);
    if (_serverNetStats.intervals.length >= _serverNetStats.reportEvery) {
        const ints = _serverNetStats.intervals;
        const sum = ints.reduce((s, v) => s + v, 0);
        const avgMs = sum / ints.length;
        const avgHz = 1000 / avgMs;
        const variance = ints.reduce((s, v) => s + Math.pow(v - avgMs, 2), 0) / ints.length;
        const stdMs = Math.sqrt(variance);
        console.log(`[net-stats] server tick avgHz=${avgHz.toFixed(2)} avgMs=${avgMs.toFixed(1)} stdMs=${stdMs.toFixed(1)} samples=${ints.length}`);
        _serverNetStats.intervals.length = 0;
    }

    const deltaTime = Math.min((now - lastTickTime) / 1000, 0.05);
    lastTickTime = now;

    for (let id in players) {
        const player = players[id];
        if (!player) continue;

        if (!player.inGame || player.dead) {
            player.vx = 0;
            player.vy = 0;
            continue;
        }

        let input = player.input || createNeutralInput();
        if ((now - (player.lastInputAt || 0)) > INPUT_PERSIST_MS) {
            input = createNeutralInput();
        }

        let axisX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        let axisY = (input.down ? 1 : 0) - (input.up ? 1 : 0);

        if (axisX !== 0 || axisY !== 0) {
            const length = Math.hypot(axisX, axisY) || 1;
            axisX /= length;
            axisY /= length;
        }

        player.vx = axisX * PLAYER_MOVE_SPEED;
        player.vy = axisY * PLAYER_MOVE_SPEED;

        const nextX = player.x + player.vx * deltaTime;
        const nextY = player.y + player.vy * deltaTime;
        const resolvedPosition = resolvePlayerWallCollisions(player, nextX, nextY);
        player.x = resolvedPosition.x;
        player.y = resolvedPosition.y;
        clampPlayerToWorld(player);
    }

    for (let arrow of arrows) {
        // 1. Move arrow
        arrow.x += arrow.vx * deltaTime;
        arrow.y += arrow.vy * deltaTime;

        // 2. Check world bounds
        if (arrow.x < 0 || arrow.x > WORLD_WIDTH ||
            arrow.y < 0 || arrow.y > WORLD_HEIGHT) {
            arrow.dead = true;

            // console.log('Arrow killed for going out of bounds:', arrow);

            continue;
        }

        for (const wall of BATTLE_WALLS) {
            if (circleIntersectsWall(arrow.x, arrow.y, ARROW_RADIUS, wall)) {
                arrow.dead = true;
                emitArrowImpact({
                    ownerId: arrow.ownerId,
                    type: 'obstacle',
                    x: arrow.x,
                    y: arrow.y
                });
                break;
            }
        }

        if (arrow.dead) {
            continue;
        }

        // 3. Check collision with players
        for (let id in players) {
            const p = players[id];

            if (id === arrow.ownerId) continue; // don't hit self
            if (!p.inGame) continue;

            const dx = arrow.x - p.x;
            const dy = arrow.y - p.y;
            if ( p.dead ) continue;             // don't hit dead players;
            const distSq = dx*dx + dy*dy;
            if (distSq < (ARROW_RADIUS + PLAYER_RADIUS) ** 2) {
                arrow.dead = true;
                p.hp -= 1;  // apply damage
                emitArrowImpact({
                    ownerId: arrow.ownerId,
                    targetId: id,
                    type: 'player',
                    x: arrow.x,
                    y: arrow.y
                });
                if ( p.hp <= 0 )
                {
                    // mark dead
                    p.dead = true;

                    // if a match is active, check for a winner
                    if (matchActive) {
                        const alive = Object.keys(players).filter(pid => players[pid] && players[pid].inGame && !players[pid].dead);
                        if (alive.length === 1) {
                            const winnerId = alive[0];
                            matchActive = false;
                            arrows = [];

                            for (let pid in players) {
                                if (!players[pid] || !players[pid].inGame) continue;
                                players[pid].vx = 0;
                                players[pid].vy = 0;
                                players[pid].input = createNeutralInput();
                                players[pid].lastInputAt = 0;
                            }

                            if (pendingGameOverTimeout) {
                                clearTimeout(pendingGameOverTimeout);
                            }

                            pendingGameOverTimeout = setTimeout(() => {
                                pendingGameOverTimeout = null;
                                const winner = players[winnerId];
                                if (!winner) return;
                                io.emit('gameOver', { winnerId, winnerName: winner.name, colour: winner.colour });
                            }, GAME_OVER_DELAY_MS);
                        }
                    }
                }
                // console.log('Player hit, now their hp is ', p.hp);

                io.emit("playerHit", { playerId: id, hp: p.hp });
                break;
            }
        }
    }

    // Remove dead arrows
    arrows = arrows.filter(a => !a.dead);

}, 1000 / SERVER_SIM_HZ);

setInterval(() => {
    const nowTs = Date.now();

    for (let id in players) {
        if (!players[id]) continue;
        io.emit('update', { id, position: serializePlayer(players[id]), serverTime: nowTs });
    }

    for (let arrow of arrows) {
        arrow.serverTime = nowTs;
    }
    io.emit("updateArrows", arrows);
}, 1000 / SERVER_BROADCAST_HZ);

server.listen(3000, () => console.log('Server running on http://localhost:3000'));
