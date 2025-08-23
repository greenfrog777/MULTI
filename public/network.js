let socket, myId, players = {}, playerColours = {};

function connectToServer(onInit, onUpdate, onRemove) {
    socket = io();

    // Initial setup: called once when connecting
    socket.on('init', data => {
        myId = data.myId;
        for (let id in data.players) {
            playerColours[id] = data.players[id].colour; // server-assigned colour
        }
        onInit(data.players);
    });

    // New player joined or movement update
    socket.on('update', data => {
        const { id, position } = data;

        // Save colour if we don’t already have it
        if (!playerColours[id] && position.colour) {
            playerColours[id] = position.colour;
        }

        onUpdate(id, position);
    });

    // Player disconnected
    socket.on('remove', id => {
        if (playerColours[id]) delete playerColours[id];
        onRemove(id);
    });
}

// Send movement updates to server
function sendMove(position) {
    if (socket && socket.connected) {
        socket.emit('move', position);
    }
}