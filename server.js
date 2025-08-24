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

    // Handle disconnection
    socket.on('disconnect', () => {
        delete players[id];
        io.emit('remove', { id });
    });
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));