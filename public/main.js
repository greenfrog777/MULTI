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

function preload() 
{
    // Load arrow sprite sheet here
    this.load.spritesheet('arrows', 'assets/arrow.png', {
        frameWidth: 66,
        frameHeight: 66
    });

    // ...any other assets
}


function create() {
    cursors = this.input.keyboard.createCursorKeys();

    wasd = this.input.keyboard.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.W,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D
    });

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

    // --- NEW: Mouse click to shoot arrow ---
    this.input.on('pointerdown', pointer => {
        // Only shoot for the local player
        const player = players[myId];
        if (!player.activeArrow) { 
            shootArrow(this, player, pointer); // uses frame 74
        }

        // Optionally, send arrow info to server for multiplayer sync
        // network.sendArrow({ x: player.x, y: player.y, angle: Phaser.Math.Angle.Between(player.x, player.y, pointer.x, pointer.y) });
    });

}

function update() {
    if (!myId) return;
    const speed = 5;
    const player = players[myId];
    let moved = false;

    // Arrow keys
    if (cursors.left.isDown)  { player.x -= speed; moved = true; }
    if (cursors.right.isDown) { player.x += speed; moved = true; }
    if (cursors.up.isDown)    { player.y -= speed; moved = true; }
    if (cursors.down.isDown)  { player.y += speed; moved = true; }

    // WASD keys
    if (wasd.left.isDown) player.x -= speed;
    if (wasd.right.isDown) player.x += speed;
    if (wasd.up.isDown) player.y -= speed;
    if (wasd.down.isDown) player.y += speed;

    if (moved) {
        sendMove({ x: player.x, y: player.y });
    }
}

// Helper: add a new player rectangle
function addPlayer(scene, id, info) {
    const colour = info.colour || 0xffffff; // default white if missing
    players[id] = scene.add.rectangle(info.x, info.y, 50, 50, Phaser.Display.Color.HexStringToColor(colour).color);
}


function shootArrow(scene, player, pointer) {
    if (player.activeArrow) return; // only one arrow at a time

    const angle = Phaser.Math.Angle.Between(player.x, player.y, pointer.x, pointer.y);

    // Use your chosen frame, e.g., 21
    const arrow = scene.physics.add.sprite(player.x, player.y, 'arrows', 74);

    arrow.rotation = angle + Phaser.Math.DegToRad(90);

    const speed = 500;
    arrow.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);

    player.activeArrow = arrow;

    // Destroy arrow on world bounds
    arrow.setCollideWorldBounds(true);
    arrow.body.onWorldBounds = true;
    arrow.body.world.on('worldbounds', function(body) {
        if (body.gameObject === arrow) {
            arrow.destroy();
            player.activeArrow = null;
        }
    });
}

