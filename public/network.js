let ws, myId, players = {}, colours = {};

function connectToServer(onInit, onUpdate, onRemove) {
    ws = new WebSocket(`ws://${window.location.host}`);

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'init') {
            myId = data.myId;
            for (let id in data.players) {
                colours[id] = id === myId ? 0x0000ff : Phaser.Display.Color.RandomRGB().color;
            }
            onInit(data.players);
        } else if (data.type === 'update') {
            if (!players[data.id]) {
                colours[data.id] = data.id === myId ? 0x0000ff : Phaser.Display.Color.RandomRGB().color;
            }
            onUpdate(data.id, data.position);
        } else if (data.type === 'remove') {
            onRemove(data.id);
        }
    };
}

function sendMove(position) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'move', position }));
    }
}