let socket, myId, players = {}, playerColours = {};

function connectToServer(onInit, onUpdate, onRemove, onLobbyUpdate, onStartBattle, onGameStart, onGameOver) {
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
        window.serverConfig = {
            moveSpeed: data.moveSpeed,
            serverSimHz: data.serverSimHz,
            serverBroadcastHz: data.serverBroadcastHz,
            inputPersistMs: data.inputPersistMs
        };
        for (let id in data.players) {
            playerColours[id] = data.players[id].colour; // server-assigned colour
        }
        // pass full init payload (may include maxHp)
        if (onInit) onInit(data);
    });

    // New player joined or movement update
    socket.on('update', data => {
        // instrumentation: record arrival interval for update packets
        try {
            const now = Date.now();
            window.netInstrumentation = window.netInstrumentation || {
                lastUpdateTs: null,
                updateIntervals: [],
                pushUpdateInterval: function (dt) { this.updateIntervals.push(dt); if (this.updateIntervals.length > 200) this.updateIntervals.shift(); },
                getUpdateStats: function () {
                    const ints = this.updateIntervals;
                    if (!ints.length) return null;
                    const sum = ints.reduce((s, v) => s + v, 0);
                    const avg = sum / ints.length;
                    const variance = ints.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / ints.length;
                    return { avgMs: avg, stdMs: Math.sqrt(variance), samples: ints.length };
                }
            };

            if (window.netInstrumentation.lastUpdateTs) {
                window.netInstrumentation.pushUpdateInterval(now - window.netInstrumentation.lastUpdateTs);
            }
            window.netInstrumentation.lastUpdateTs = now;
        } catch (e) {
            // don't break normal flow on instrumentation errors
            console.warn('netInstrumentation error', e);
        }

        const { id, position } = data;

        // Save colour if we don’t already have it
        if (!playerColours[id] && position.colour) {
            playerColours[id] = position.colour;
        }

        // Maintain a small snapshot buffer per remote player for interpolation
        try {
            window.serverSnapshots = window.serverSnapshots || {};
            const buf = window.serverSnapshots[id] || (window.serverSnapshots[id] = []);
            const ts = (typeof data.serverTime === 'number') ? data.serverTime : Date.now();
            // push snapshot and clamp buffer length
            buf.push({ x: position.x, y: position.y, vx: position.vx || 0, vy: position.vy || 0, t: ts });
            if (buf.length > 200) buf.shift();

            // estimate client-server clock offset (clientNow - serverTime)
            if (typeof data.serverTime === 'number') {
                window.serverTimeSamples = window.serverTimeSamples || [];
                window.serverTimeSamples.push(Date.now() - data.serverTime);
                if (window.serverTimeSamples.length > 200) window.serverTimeSamples.shift();
                const sum = window.serverTimeSamples.reduce((s, v) => s + v, 0);
                window.serverTimeOffsetMs = Math.round(sum / window.serverTimeSamples.length);
            }
        } catch (e) {
            // ignore snapshot errors
        }

        if (onUpdate) onUpdate(id, position, data.serverTime);
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
        // Replace serverSnapshots so interpolation starts from authoritative
        // match-start positions only, without blending from stale lobby data.
        try {
            window.serverConfig = {
                moveSpeed: data.moveSpeed,
                serverSimHz: data.serverSimHz,
                serverBroadcastHz: data.serverBroadcastHz,
                inputPersistMs: data.inputPersistMs
            };
            const serverTime = (typeof data.serverTime === 'number') ? data.serverTime : Date.now();
            const playersPayload = data && data.players ? data.players : data;
            const nextSnapshots = {};
            if (playersPayload && typeof playersPayload === 'object') {
                for (let id in playersPayload) {
                    try {
                        const p = playersPayload[id] || {};
                        const px = Number((p.x !== undefined) ? p.x : (p.position && p.position.x) || 0);
                        const py = Number((p.y !== undefined) ? p.y : (p.position && p.position.y) || 0);
                        nextSnapshots[id] = [{ x: px, y: py, vx: Number(p.vx || 0), vy: Number(p.vy || 0), t: serverTime }];
                    } catch (e) {
                        // ignore per-player errors
                    }
                }
            }
            window.serverSnapshots = nextSnapshots;
        } catch (e) {
            // ignore seeding errors
        }

        if (onGameStart) onGameStart(data);
    });

    // Game over / victory
    socket.on('gameOver', data => {
        if (onGameOver) onGameOver(data);
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

function sendBackToLobby() {
    if (socket && socket.connected) {
        socket.emit('backToLobby');
    }
}