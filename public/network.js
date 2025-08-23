let socket, myId, players = {}, colours = {};

function connectToServer(onInit, onUpdate, onRemove) {
    socket = io();

    socket.on('init', data => {
        myId = data.myId;
        for (let id in data.players) {
            colours[id] = id === myId ? 0x0000ff : Phaser.Display.Color.RandomRGB().color;
        }
        onInit(data.players);
    });

    socket.on('update', data => {
        if (!players[data.id]) {
            colours[data.id] = data.id === myId ? 0x0000ff : Phaser.Display.Color.RandomRGB().color;
        }
        onUpdate(data.id, data.position);
    });

    socket.on('remove', id => {
        onRemove(id);
    });
}

function sendMove(position) {
    if (socket && socket.connected) {
        socket.emit('move', position);
    }
}