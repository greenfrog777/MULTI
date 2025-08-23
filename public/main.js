let config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    physics: { default: 'arcade' },
    scene: { preload, create, update }
};

let game = new Phaser.Game(config);
let cursors;
// let players = {}; // Phaser rectangles keyed by socket ID
// let myId = null;

function preload() { }

function create() {
    cursors = this.input.keyboard.createCursorKeys();

    connectToServer(
        (serverPlayers) => { // onInit
            myId = socket.id;
            for (let id in serverPlayers) {
                addPlayer(this, id, serverPlayers[id]);
            }
        },
        (id, pos) => { // onUpdate
            if (!players[id]) {
                addPlayer(this, id, pos);
            } else {
                players[id].x = pos.x;
                players[id].y = pos.y;
            }
        },
        (id) => { // onRemove
            if (players[id]) {
                players[id].destroy();
                delete players[id];
            }
        }
    );
}

function update() {
    if (!myId) return;
    const speed = 5;
    const player = players[myId];
    let moved = false;

    if (cursors.left.isDown)  { player.x -= speed; moved = true; }
    if (cursors.right.isDown) { player.x += speed; moved = true; }
    if (cursors.up.isDown)    { player.y -= speed; moved = true; }
    if (cursors.down.isDown)  { player.y += speed; moved = true; }

    if (moved) {
        sendMove({ x: player.x, y: player.y });
    }
}

// Helper: add a new player rectangle
function addPlayer(scene, id, info) {
    const colour = info.colour || 0xffffff; // default white if missing
    players[id] = scene.add.rectangle(info.x, info.y, 50, 50, Phaser.Display.Color.HexStringToColor(colour).color);
}