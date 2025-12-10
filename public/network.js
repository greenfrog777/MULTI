let socket, myId, players = {}, playerColours = {};

function connectToServer(onInit, onUpdate, onRemove, onLobbyUpdate, onStartBattle, onGameStart) {
    socket = io();

    // If a player name was entered before connecting, tell the server once connected
    socket.on('connect', () => {
        // expose socket to window so index overlay can use it
        window.socket = socket;
        if (window.pendingPlayerName) {
            socket.emit('join', window.pendingPlayerName);
        }
    });

    // Initial setup: called once when connecting
    socket.on('init', data => {
        myId = data.myId;
        for (let id in data.players) {
            playerColours[id] = data.players[id].colour; // server-assigned colour
        }
        if (onInit) onInit(data.players);
    });

    // New player joined or movement update
    socket.on('update', data => {
        const { id, position } = data;

        // Save colour if we don’t already have it
        if (!playerColours[id] && position.colour) {
            playerColours[id] = position.colour;
        }

        if (onUpdate) onUpdate(id, position);
    });

    // Player disconnected
    socket.on('remove', id => {
        if (playerColours[id]) delete playerColours[id];
        if (onRemove) onRemove(id);
    });

    // Lobby updates (list of players + ready flags)
    socket.on('lobbyUpdate', data => {
        if (onLobbyUpdate) onLobbyUpdate(data);
    });

    // Server says all players should start
    socket.on('startBattle', () => {
        if (onStartBattle) onStartBattle();
    });

    // Server sends full game start payload
    socket.on('gameStart', data => {
        if (onGameStart) onGameStart(data.players);
    });
}

// Send movement updates to server
function sendMove(position) {
    if (socket && socket.connected) {
        socket.emit('move', position);
    }
}

function sendReady(isReady) {
    if (socket && socket.connected) {
        socket.emit('ready', !!isReady);
    }
}

function requestStartBattle() {
    if (socket && socket.connected) {
        socket.emit('startBattle');
    }
}