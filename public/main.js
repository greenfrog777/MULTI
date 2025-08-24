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

    // preload
    this.load.spritesheet('player', 'assets/hana/run.png', {
        frameWidth: 80,
        frameHeight: 80
    });

}


function create() {

    // Stop players leaving the game area
    this.physics.world.setBounds(0, 0, config.width, config.height);


    // Define animations
    this.anims.create({
        key: 'right',
        frames: this.anims.generateFrameNumbers('player', { start: 0, end: 7 }),
        frameRate: 10,
        repeat: -1
    });

    this.anims.create({
        key: 'down',
        frames: this.anims.generateFrameNumbers('player', { start: 8, end: 15 }),
        frameRate: 10,
        repeat: -1
    });

    this.anims.create({
        key: 'up',
        frames: this.anims.generateFrameNumbers('player', { start: 16, end: 23 }),
        frameRate: 10,
        repeat: -1
    });

    // TO-DO: use idle properly
    this.anims.create({
        key: 'idle',
        frames: this.anims.generateFrameNumbers('player', { start: 8, end: 15 }),
        frameRate: 10,
        repeat: -1
    });


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
    const speed = 5; // adjust to taste
    const player = players[myId];

    // stop any previous movement
    player.body.setVelocity(0);

    // movement flags
    let moving = false;
    let animKey = '';

    // Arrow keys
    if (cursors.left.isDown || wasd.left.isDown) {
        // player.body.setVelocityX(-speed);
        player.x -= speed;
        animKey = 'right';
        player.setFlipX(true);
        moving = true;
    }
    else if (cursors.right.isDown || wasd.right.isDown) {
        // player.body.setVelocityX(speed);
        player.x += speed;
        animKey = 'right';
        player.setFlipX(false);        
        moving = true;
    }

    if (cursors.up.isDown || wasd.up.isDown) {
        // player.body.setVelocityY(-speed);
        player.y -= speed;
        animKey = 'up';
        moving = true;
    }
    else if (cursors.down.isDown || wasd.down.isDown) {
        //player.body.setVelocityY(speed);
        player.y += speed;
        animKey = 'down';
        moving = true;
    }

    // normalize diagonal speed
    // player.body.velocity.normalize().scale(speed);

    // animations
    if (moving) {
        player.anims.play(animKey, true);
    } else {
        player.anims.play('idle', true);
    }

    // tell server about movement
    if (moving) {
        sendMove({ x: player.x, y: player.y });
    }
}

function lightenColor(hexColor, amount = 0.5) {
    // hexColor: 0xRRGGBB
    // amount: 0 = no change, 1 = white
    let r = ((hexColor >> 16) & 0xff);
    let g = ((hexColor >> 8) & 0xff);
    let b = (hexColor & 0xff);

    r = Math.round(r + (255 - r) * amount);
    g = Math.round(g + (255 - g) * amount);
    b = Math.round(b + (255 - b) * amount);

    return (r << 16) | (g << 8) | b;
}

function addPlayer(scene, id, info) {
    const colour = info.colour || 0xffffff; // default white if missing

    // Create physics sprite
    players[id] = scene.physics.add.sprite(info.x, info.y, 'player');

    const baseColor = Phaser.Display.Color.HexStringToColor(colour).color;
    const lightColor = lightenColor(baseColor, 0.4);

    // Apply tint
    players[id].setTint(lightColor);

    // Scale sprite
    const scale = 4;
    players[id].setScale(scale);

    players[id].body.setSize( 20, 20 );

    // Keep player on screen
    players[id].setCollideWorldBounds(true);

    // Play default animation
    players[id].anims.play('down', true);
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

