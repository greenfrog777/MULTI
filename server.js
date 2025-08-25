const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const colours = ["#0000ff", "#ff0000", "#00ff00", "#ffa500", "#ff00ff", "#00ffff", "#ffff00"];
let players = {};

io.on('connection', socket => {
    const id = socket.id;

    // Assign colour based on number of existing players
    const colour = colours[Object.keys(players).length % colours.length];

    // Initial position and colour
    players[id] = { x: 400, y: 300, colour };

    // Send all current players to the new client
    socket.emit('init', { players, myId: id });

    // Notify all other clients about the new player
    socket.broadcast.emit('update', { id, position: players[id] });

    // Handle movement updates
    socket.on('move', pos => {
        if(players[id]){
            players[id].x       = pos.x;
            players[id].y       = pos.y;
            io.emit('update', { id, position: { x: pos.x, y: pos.y } });
        }
    });

    socket.on('shootArrowNew', data => {

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
            const distSq = dx*dx + dy*dy;
            if (distSq < (ARROW_RADIUS + PLAYER_RADIUS) ** 2) {
                arrow.dead = true;
                p.hp -= 1;  // apply damage

                console.log('Player hit');

                io.emit("playerHit", { playerId: p.id, hp: p.hp });
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