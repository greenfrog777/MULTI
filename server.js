const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = {};

io.on('connection', socket => {
    const id = socket.id;
    players[id] = { x: 400, y: 300 };

    // Send current players to the new client, including their own ID
    socket.emit('init', { players, myId: id });

    socket.on('move', position => {
        players[id] = position;
        io.emit('update', { id, position }); // broadcast to all clients
    });

    socket.on('disconnect', () => {
        delete players[id];
        io.emit('remove', { id }); // broadcast to all clients
    });
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));