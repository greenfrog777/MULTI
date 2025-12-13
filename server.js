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

io.on('connection', socket => {
    const id = socket.id;

    // Assign colour based on number of existing players
    const colour = colours[Object.keys(players).length % colours.length];

    // Do not create the player record yet. Wait for the client to send a 'join' event
    // containing the player's chosen name. This prevents showing a default player
    // before the user has entered their name.

    // Handle movement updates
    socket.on('move', pos => {
        if(players[id]){
            players[id].x       = pos.x;
            players[id].y       = pos.y;
            io.emit('update', { id, position: { x: pos.x, y: pos.y, name: players[id].name, colour: players[id].colour } });
        }
    });

    // Handle name/join event from client
    socket.on('join', name => {
        const clean = String(name || '').slice(0, 32) || ('Player' + id.slice(0,4));

        if (!players[id]) {
            // create player record now that we have a name
            const colour = colours[Object.keys(players).length % colours.length];
            players[id] = { x: 400, y: 300, colour, hp: 5, dead: false, name: clean, ready: false, joinOrder: nextJoinOrder++, inGame: false };

            // Send all current players to the new client
            socket.emit('init', { players, myId: id });

            // Notify all other clients about the new player
            socket.broadcast.emit('update', { id, position: players[id] });
            // Also send lobby update so everyone can refresh the lobby list
            emitLobbyUpdate();
        } else {
            // If player record already exists (reconnect), just update the name
            players[id].name = clean;
            // ensure joinOrder persists for reconnects
            if (!players[id].joinOrder) players[id].joinOrder = nextJoinOrder++;
            io.emit('update', { id, position: { x: players[id].x, y: players[id].y, name: players[id].name, colour: players[id].colour } });
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
            players[pid].hp = 5; // always reset HP at match start
            players[pid].inGame = true;
        }

        // mark match active
        matchActive = true;

        // Notify clients to transition to the game
        io.emit('startBattle');

        // Also send full game init payload so clients can create player sprites
        io.emit('gameStart', { players });

        // Lobby membership changed (players moved into game) — update lobby lists
        emitLobbyUpdate();
    });

    socket.on('shootArrowNew', data => {
        // ignore if player hasn't joined yet
        if (!players[id]) return;

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
        // Notify lobby clients
        emitLobbyUpdate();
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
            lobbyPlayers[pid] = players[pid];
        }
    }
    io.emit('lobbyUpdate', lobbyPlayers);
}

// START OF NEW CODE

const SERVER_LOOP_HZ = 20;
const ARROW_SPEED = 30 * SERVER_LOOP_HZ;
const ARROW_RADIUS = 10;    // adjust to match your sprite
const PLAYER_RADIUS = 20;   // approximate for collision
const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 600;

let arrows = []; // array of active arrows

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

    // inform clients a new arrow exists
    io.emit("spawnArrow", arrows[arrows.length - 1]);
}

let lastTickTime = Date.now();

// Tick loop for arrows
setInterval(() => {

    const now = Date.now();
    const deltaTime = (now - lastTickTime) / 1000;
    lastTickTime = now;

    for (let arrow of arrows) {
        // 1. Move arrow
        //arrow.x += arrow.vx;
        //arrow.y += arrow.vy;

        arrow.x += arrow.vx * deltaTime;     // 🟢 time-based movement
        arrow.y += arrow.vy * deltaTime;     // 🟢 time-based movement        

        // 2. Check world bounds
        if (arrow.x < 0 || arrow.x > WORLD_WIDTH ||
            arrow.y < 0 || arrow.y > WORLD_HEIGHT) {
            arrow.dead = true;

            // console.log('Arrow killed for going out of bounds:', arrow);

            continue;
        }

        // 3. Check collision with players
        for (let id in players) {
            const p = players[id];

            if (id === arrow.ownerId) continue; // don't hit self

            const dx = arrow.x - p.x;
            const dy = arrow.y - p.y;
            if ( p.dead ) continue;             // don't hit dead players;
            const distSq = dx*dx + dy*dy;
            if (distSq < (ARROW_RADIUS + PLAYER_RADIUS) ** 2) {
                arrow.dead = true;
                p.hp -= 1;  // apply damage
                if ( p.hp <= 0 )
                {
                    // mark dead
                    p.dead = true;

                    // if a match is active, check for a winner
                    if (matchActive) {
                        const alive = Object.keys(players).filter(pid => players[pid] && !players[pid].dead);
                        if (alive.length === 1) {
                            const winnerId = alive[0];
                            matchActive = false;
                            // emit game over with winner details
                            io.emit('gameOver', { winnerId, winnerName: players[winnerId].name, colour: players[winnerId].colour });
                        }
                    }
                }
                console.log('Player hit, now their hp is ', p.hp);

                io.emit("playerHit", { playerId: id, hp: p.hp });
                break;
            }
        }
    }

    // Remove dead arrows
    arrows = arrows.filter(a => !a.dead);

    // 4. Broadcast updated positions
    io.emit("updateArrows", arrows);

}, 1000 / SERVER_LOOP_HZ ); // 20 Hz tick

// END OF NEW CODE

server.listen(3000, () => console.log('Server running on http://localhost:3000'));
