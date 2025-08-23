let config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    physics: { default: 'arcade' },
    scene: { preload, create, update }
};

let game = new Phaser.Game(config);
let cursors;

function preload() { }

function create() {
    cursors = this.input.keyboard.createCursorKeys();

    connectToServer(
        (serverPlayers) => { // onInit
            for (let id in serverPlayers) {
                players[id] = this.add.rectangle(serverPlayers[id].x, serverPlayers[id].y, 50, 50, colours[id]);
            }
        },
        (id, pos) => { // onUpdate
            if (!players[id]) {
                players[id] = this.add.rectangle(pos.x, pos.y, 50, 50, colours[id]);
            } else {
                players[id].x = pos.x;
                players[id].y = pos.y;
            }
        },
        (id) => { // onRemove
            if (players[id]) {
                players[id].destroy();
                delete players[id];
                delete colours[id];
            }
        }
    );
}

function update() {
    if (!myId) return;
    let speed = 5;
    let player = players[myId];
    if (cursors.left.isDown) player.x -= speed;
    if (cursors.right.isDown) player.x += speed;
    if (cursors.up.isDown) player.y -= speed;
    if (cursors.down.isDown) player.y += speed;

    sendMove({ x: player.x, y: player.y });
}