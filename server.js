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
            players[id] = { x: 400, y: 300, colour, hp: 5, dead: false, name: clean, ready: false, joinOrder: nextJoinOrder++ };

            // Send all current players to the new client
            socket.emit('init', { players, myId: id });

            // Notify all other clients about the new player
            socket.broadcast.emit('update', { id, position: players[id] });
            // Also send lobby update so everyone can refresh the lobby list
            io.emit('lobbyUpdate', players);
        } else {
            // If player record already exists (reconnect), just update the name
            players[id].name = clean;
            // ensure joinOrder persists for reconnects
            if (!players[id].joinOrder) players[id].joinOrder = nextJoinOrder++;
            io.emit('update', { id, position: { x: players[id].x, y: players[id].y, name: players[id].name, colour: players[id].colour } });
            io.emit('lobbyUpdate', players);
        }
    });

    // Handle player ready toggle from client
    socket.on('ready', (isReady) => {
        if (!players[id]) return;
        players[id].ready = !!isReady;
        // broadcast updated lobby state
        io.emit('lobbyUpdate', players);
    });

    // Handle startBattle request
    socket.on('startBattle', () => {
        // Only allow start if all players are present and ready
        const playerIds = Object.keys(players);
        if (playerIds.length === 0) return;
        const allReady = playerIds.every(pid => players[pid] && players[pid].ready);
        if (!allReady) return;

        // Assign starting positions based on player count before starting
        const ids = Object.keys(players);
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

        // reset any running HP/dead state if desired and notify clients
        for (let pid of ids) {
            // ensure defaults exist
            players[pid].dead = false;
            if (typeof players[pid].hp !== 'number') players[pid].hp = 5;
        }

        // Notify clients to transition to the game
        io.emit('startBattle');

        // Also send full game init payload so clients can create player sprites
        io.emit('gameStart', { players });
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

    // Handle disconnection
    socket.on('disconnect', () => {
        delete players[id];
        io.emit('remove', { id });
    });
});

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
                    p.dead = true;
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
