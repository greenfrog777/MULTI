const express = require('express');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

let players = {};


wss.on('connection', ws => {
    const id = Date.now();
    players[id] = { x: 400, y: 300 };

    // Send current players to the new client, including their own ID
    ws.send(JSON.stringify({ type: 'init', players, myId: id }));

    ws.on('message', message => {
        const data = JSON.parse(message);

        if (data.type === 'move') {
            players[id] = data.position;
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'update', id, position: data.position }));
                }
            });
        }
    });

    ws.on('close', () => {
        delete players[id];
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'remove', id }));
            }
        });
    });
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));