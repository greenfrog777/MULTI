let config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    physics: { default: 'arcade' },
    scene: { preload, create, update }
};

let game = new Phaser.Game(config);
let cursors;
let canShoot = true; // only one arrow at a time

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

    // preload
    this.load.spritesheet('idle', 'assets/hana/idle.png', {
        frameWidth: 80,
        frameHeight: 80
    });    

}


function create() {

    // Stop players leaving the game area
    this.physics.world.setBounds(0, 0, config.width, config.height);


    // Run animations
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

    // Idle animations
    this.anims.create({
        key: 'idle-right',
        frames: this.anims.generateFrameNumbers('idle', { start: 0, end: 3 }),
        frameRate: 10,
        repeat: -1
    });

    this.anims.create({
        key: 'idle-down',
        frames: this.anims.generateFrameNumbers('idle', { start: 4, end: 7 }),
        frameRate: 10,
        repeat: -1
    });

    this.anims.create({
        key: 'idle-up',
        frames: this.anims.generateFrameNumbers('idle', { start: 8, end: 11 }),
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
            if (!players[id]) 
            {
                addPlayer(this, id, pos);
            } 
            else 
            {
                players[id].prevX = players[id].x;
                players[id].prevY = players[id].y;
                players[id].x = pos.x;
                players[id].y = pos.y;

                // console.log('update facing', pos.facing);
                updateFacing(players[id]);

                // Play the correct animation based on facing
                if ( players[id].facing === 'left' ) 
                {    
                    players[id].anims.play('right', true);
                    players[id].setFlipX(true);
                }
                else
                {
                    players[id].anims.play(players[id].facing, true);
                    if ( players[id].facing == 'right' )
                    {
                        players[id].setFlipX(false);
                    }
                }
            }
        },
        (id) => { // onRemove
            if (players[id]) {
                players[id].destroy();
                delete players[id];
            }
        }
    );

    // Temporary arrow for testing
    // this.add.sprite(300, 300, 'arrows', 74);

    setupArrowHandlers(this, socket);
    // setupArrowHandlers(socket);

    // New server driven arrows....
    this.input.on('pointerdown', pointer => {
        if (!canShoot) return;

        const player = players[myId];
        if (!player) return;
        if (player.dead) return;

        const dx = pointer.worldX - player.x;
        const dy = pointer.worldY - player.y;
        const angle = Phaser.Math.RadToDeg(Math.atan2(dy, dx));

        socket.emit('shootArrowNew', { x: player.x, y: player.y, angle });
        canShoot = false;
    });

}


let arrowList = {}; // key: arrow id, value: Phaser sprite

function setupArrowHandlers(scene, socket) {
    // When the server spawns a new arrow
    socket.on("spawnArrow", data => {
        // create a sprite for the arrow
        const arrowSprite = scene.add.sprite(data.x, data.y, 'arrows', 74);
        arrowSprite.rotation = Phaser.Math.DegToRad(data.angle ) + Phaser.Math.DegToRad(90); // point correctly
        arrowSprite.targetX = data.x;
        arrowSprite.targetY = data.y;
        arrowSprite.vx = data.vx || 0;
        arrowSprite.vy = data.vy || 0;
        arrowList[data.ownerId] = arrowSprite;
    });

    // When the server sends updated arrow positions
    socket.on("updateArrows", data => {
        const currentIds = new Set();
        const hasArrow = data.some(a => a.ownerId === myId);
        if (!hasArrow) canShoot = true;

        for (let arrowData of data) {
            currentIds.add(arrowData.ownerId);
            if (arrowList[arrowData.ownerId]) {
                // update existing arrow
                let arrow = arrowList[arrowData.ownerId];
                // Interpolate position for smoothing
                arrow.targetX = arrowData.x;
                arrow.targetY = arrowData.y;
                arrow.vx = arrowData.vx;
                arrow.vy = arrowData.vy;
            } else {
                // create new arrow if missed spawn event
                const arrowSprite = scene.add.sprite(arrowData.x, arrowData.y, "arrows", 75);
                arrowSprite.setOrigin(0.5, 0.5);
                arrowSprite.rotation = Math.atan2(arrowData.vy, arrowData.vx);
                arrowSprite.targetX = arrowData.x;
                arrowSprite.targetY = arrowData.y;
                arrowSprite.vx = arrowData.vx;
                arrowSprite.vy = arrowData.vy;
                arrowList[arrowData.ownerId] = arrowSprite;
            }
        }
        // remove arrows that no longer exist on server
        for (let ownerId in arrowList) {
            if (!currentIds.has(ownerId)) {
                arrowList[ownerId].destroy();
                delete arrowList[ownerId];
            }
        }
    });

    // Optional: handle player hit (e.g., flash or play sound)
    socket.on("playerHit", data => {
        const p = players[data.playerId];

        // console.log('Client: Player hit, now their hp is ', data.hp , ' id is ' , data.playerId );

        if (p) {
            // console.log(`Player ${data.playerId} hit! HP: ${data.hp}`);
            // You could add flash animation or health bar update here

            // console.log('Client: Player hit, now their hp is ', data.hp);

            p.healthPoints = data.hp;
        }
    });
}


function updateFacing(player) {
    const dx = player.x - player.prevX;
    const dy = player.y - player.prevY;

    if (Math.abs(dx) > Math.abs(dy)) {
        player.facing = dx < 0 ? 'left' : 'right';
    } else if (Math.abs(dy) > 0) {
        player.facing = dy < 0 ? 'up' : 'down';
    }
}

function playCorrectAnimation(player) {
    if (!player.facing) return; // no facing info

    if ( player.x === player.prevX && player.y === player.prevY ) {
        // play the appropriate idle animation
        if ( player.facing == 'left' )
        {
            player.anims.play('idle-right', true);
            player.setFlipX(true);
        } 
        else    if ( player.facing == 'right' )
        {
            player.anims.play('idle-right', true);
            player.setFlipX(false);
        }
        else    
        {
            player.anims.play('idle-' + player.facing, true);
        }
        return;
    }

    if ( player.facing === 'left' ) 
    {    
        player.anims.play('right', true);
        player.setFlipX(true);
    }
    else
    {
        player.anims.play(player.facing, true);
        if ( player.facing == 'right' )
        {
            player.setFlipX(false);
        }
    }
}

function handleDeath(player) {

    player.dead = true;
    // Fade out sprite + health bar over 500ms
    player.scene.tweens.add({
        targets: [player, player.healthBar],
        alpha: 0,
        duration: 500,
        onComplete: () => {

            // stop movement & disable physics simulation
            player.body.stop();
            player.body.enable = false;

            // hide and mark inactive so Phaser ignores it in updates
            player.setVisible(false);
            player.setActive(false);        
            
            // optionally move it off-screen so nothing else collides with the sprite visually
            player.x = -9999;
            player.y = -9999;            

            player.healthBar.destroy();
        }
    });
}

function drawHealthBar(player) {

    if ( player.dead ) return;

    const sprite = player;
    const barWidth = 35;
    const barHeight = 3;
    const healthBar = player.healthBar;
    const healthPoints = player.healthPoints;
    const maxHp = 5;

    // position above head
    const x = sprite.x - barWidth / 2;
    const y = sprite.y - sprite.height / 2 - 12;

    healthBar.clear();

/*
    // black border
    healthBar.fillStyle(0x000000);
    healthBar.fillRect(x - 1, y - 1, barWidth + 2, barHeight + 2);

    // pick colour based on health %
    const healthPercent = healthPoints / maxHp;
    let colour = 0x00ff00; // default green
    if (healthPercent < 0.3) {
        colour = 0xff0000; // red
    } else if (healthPercent < 0.6) {
        colour = 0xffff00; // yellow
    }

    // health fill
    const healthWidth = healthPercent * barWidth;
    healthBar.fillStyle(colour);
    healthBar.fillRect(x, y, healthWidth, barHeight);
*/

    const ratio = healthPoints / maxHp; // 1.0 = full, 0.0 = dead

    // interpolate colour: green (0,255,0) → yellow (255,255,0) → red (255,0,0)
    let r, g, b;
    if (ratio > 0.5) {
        // from green → yellow
        const t = (1 - ratio) * 2;  // 0 at full hp, 1 at 50%
        r = Math.floor(255 * t);
        g = 255;
        b = 0;
    } else {
        // from yellow → red
        const t = ratio * 2;  // 1 at 50%, 0 at 0%
        r = 255;
        g = Math.floor(255 * t);
        b = 0;
    }

    const color = Phaser.Display.Color.GetColor(r, g, b);

    // redraw health bar
    //const barWidth = 40;
    //const barHeight = 6;
    const healthWidth = Math.floor(barWidth * ratio);

    healthBar.clear();
    healthBar.fillStyle(color);
    healthBar.fillRect(
        sprite.x - barWidth / 2,
        sprite.y - 40,  // above the sprite
        healthWidth,
        barHeight
    );

    if ( healthPoints == 0 )
    {
        handleDeath(player);
    }

}


function update() {
    if (!myId) return;
    const speed = 5; // adjust to taste
    const player = players[myId];

    if ( player.dead == false ) 
    {
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
            player.facing = 'left';
            moving = true;
        }
        else if (cursors.right.isDown || wasd.right.isDown) {
            // player.body.setVelocityX(speed);
            player.x += speed;
            animKey = 'right';
            player.setFlipX(false);        
            player.facing = 'right';
            moving = true;
        }

        if (cursors.up.isDown || wasd.up.isDown) {
            // player.body.setVelocityY(-speed);
            player.y -= speed;
            animKey = 'up';
            player.facing = 'up';
            moving = true;
        }
        else if (cursors.down.isDown || wasd.down.isDown) {
            //player.body.setVelocityY(speed);
            player.y += speed;
            animKey = 'down';
            player.facing = 'down';
            moving = true;
        }

        // normalize diagonal speed
        // player.body.velocity.normalize().scale(speed);

        // animations
        if (moving) {
            player.anims.play(animKey, true);
        } else {
            if ( player.facing == 'left' )
            {
                player.anims.play('idle-right', true);
                player.setFlipX(true); 
            }
            else
            {
                player.anims.play('idle-' + player.facing, true);
                player.setFlipX(false); 
            }
        }

        // tell server about movement
        if (moving) {
            sendMove({ x: player.x, y: player.y } );
        }
    }

    for (let id in players) 
    {
        // Not me:
        if (id === myId) continue;

        const enemy = players[id];

        // updateFacing(enemy);
        playCorrectAnimation(enemy);
        enemy.prevX = enemy.x;
        enemy.prevY = enemy.y;
    }

    // Arrow interpolation only (no client-side velocity)
    for (let ownerId in arrowList) {
        let arrow = arrowList[ownerId];
        arrow.x += (arrow.targetX - arrow.x) * 0.2;
        arrow.y += (arrow.targetY - arrow.y) * 0.2;
    }

    // health bars
    for (let id in players) 
    {
        if ( players[id].dead ) 
        {
            continue;
        }
        
        drawHealthBar(players[id]);
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
    const healthBar = scene.add.graphics();

    // Apply tint
    players[id].setTint(lightColor);

    // Scale sprite
    const scale = 4;
    players[id].setScale(scale);

    players[id].body.setSize( 20, 20 );

    // Keep player on screen
    players[id].setCollideWorldBounds(true);

    players[id].facing = 'down'; // default facing direction

    // Play default animation
    players[id].anims.play('idle-down', true);

    players[id].healthBar = healthBar;
    players[id].healthPoints = 5;
    players[id].scene = scene;
    players[id].dead = false;
}


/*

// Old arrow shooting code - now replaced with server-driven version
// But keep for reference - it was smooth... maybe because of using velocity?

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

*/
