// We'll register scenes below. LoginScene will be added first and GameScene
// will be the main scene using the existing preload/create/update functions.
let config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    physics: { default: 'arcade' },
    scene: [] // filled after LoginScene declaration
};

let game = null; // created after scenes are registered
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
// Ensure the GameScene key used above is available and calls startNetwork when appropriate
class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    preload() { preload.call(this); }
    create() { create.call(this);
        // Only start network if not already connected
        if (window.pendingPlayerName && (!window.socket || !window.socket.connected)) {
            startNetwork(this, window.pendingPlayerName);
        }

        // Setup any game-specific handlers (arrows, pointer) now that scene is active
        setupGameForScene(this);
    }
    update(time, delta) { update.call(this, time, delta); }
}

// Register scenes and create the Phaser game instance
// (moved) scene registration and game creation will occur after scene classes

// --- LoginScene: keyboard-driven name entry inside Phaser (no DOM overlay) ---
class LoginScene extends Phaser.Scene {
    constructor() {
        super({ key: 'LoginScene' });
    }

    create() {
        this.cameras.main.setBackgroundColor('#111');

        this.add.text(config.width/2, 140, 'Enter player name', { font: '20px Arial', fill: '#fff' }).setOrigin(0.5);

        this.name = '';
        this.nameText = this.add.text(config.width/2, 190, '_', { font: '24px Arial', fill: '#fffc' }).setOrigin(0.5);
        this.add.text(config.width/2, 240, 'Type name and press Enter', { font: '14px Arial', fill: '#aaa' }).setOrigin(0.5);

        // Capture keyboard input for name entry
        this.input.keyboard.on('keydown', (event) => {
            if (event.key === 'Backspace') {
                this.name = this.name.slice(0, -1);
            } else if (event.key === 'Enter') {
                    const finalName = (this.name || '').trim() || ('Player' + Math.floor(Math.random()*1000));
                    window.pendingPlayerName = finalName;
                    // go to LobbyScene (network connection happens from the Lobby)
                    this.scene.start('LobbyScene');
            } else if (event.key.length === 1) {
                if (this.name.length < 20) this.name += event.key;
            }
            this.nameText.setText(this.name.length ? this.name + '_' : '_');
        });
    }
}

// --- Helper: start network & wire up handlers (extracted from previous window.startGame logic) ---
function startNetwork(scene, playerName) {
    window.pendingPlayerName = playerName;
    // Connect and register handlers for lobby + game
    connectToServer(
        (serverPlayers) => { // onInit
            // store initial server snapshot; create sprites only when in GameScene
            window.serverPlayers = serverPlayers;
            myId = socket.id;
            if (scene.scene && scene.scene.key === 'GameScene') {
                for (let id in serverPlayers) addPlayer(scene, id, serverPlayers[id]);
            }
        },
        (id, pos) => { // onUpdate
            // keep a copy of latest server positions
            window.serverPlayers = window.serverPlayers || {};
            window.serverPlayers[id] = pos;

            if (players[id]) {
                players[id].prevX = players[id].x;
                players[id].prevY = players[id].y;
                players[id].x = pos.x;
                players[id].y = pos.y;

                if (pos.name && players[id].nameText) players[id].nameText.setText(pos.name);
                updateFacing(players[id]);
            }
        },
        (id) => { // onRemove
            if (players[id]) {
                if (players[id].nameText) players[id].nameText.destroy();
                players[id].destroy();
                delete players[id];
            }
            if (window.serverPlayers && window.serverPlayers[id]) delete window.serverPlayers[id];
        },
        // lobby updates
        (lobbyData) => {
            // pass through to scene if it implements onLobbyUpdate
            if (scene && typeof scene.onLobbyUpdate === 'function') scene.onLobbyUpdate(lobbyData);
            else window.lobbyPlayers = lobbyData;
        },
        // startBattle signal
        () => {
            // server says start — transition to GameScene
            if (scene && scene.scene) scene.scene.start('GameScene');
            else window.startRequested = true;
        },
        // gameStart payload
        (playersPayload) => {
            window.serverPlayers = playersPayload;
            // if we're already in GameScene, create players
            if (scene && scene.scene && scene.scene.key === 'GameScene') {
                for (let id in playersPayload) addPlayer(scene, id, playersPayload[id]);
            }
        }
    );
}

// --- LobbyScene: shows list of players and ready/start controls ---
class LobbyScene extends Phaser.Scene {
    constructor() { super({ key: 'LobbyScene' }); }

    create() {
        this.cameras.main.setBackgroundColor('#0a0a0a');
        this.add.text(config.width/2, 40, 'Lobby', { font: '28px Arial', fill: '#fff' }).setOrigin(0.5);

        // Title for players list
        this.add.text(40, 80, 'Players:', { font: '18px Arial', fill: '#fff' });

        // Create up to 6 slots
        this.slotTexts = [];
        this.slotReady = [];
        for (let i = 0; i < 6; i++) {
            const y = 110 + i * 34;
            const nameTxt = this.add.text(80, y, `Slot ${i+1}: (empty)`, { font: '16px Arial', fill: '#ddd' });
            const readyTxt = this.add.text(360, y, '-', { font: '16px Arial', fill: '#aaa' });
            this.slotTexts.push(nameTxt);
            this.slotReady.push(readyTxt);
        }

        // Ready toggle for local player
        this.myReady = false;
        this.readyButton = this.add.text(config.width/2 - 80, 340, 'Ready: No', { font: '18px Arial', fill: '#fff', backgroundColor: '#333' }).setInteractive();
        this.readyButton.on('pointerdown', () => {
            this.myReady = !this.myReady;
            this.readyButton.setText('Ready: ' + (this.myReady ? 'Yes' : 'No'));
            // tell server
            if (typeof sendReady === 'function') sendReady(this.myReady);
        });

        // Start Battle button (enabled only when all ready)
        this.startButton = this.add.text(config.width/2 + 20, 340, 'Start Battle', { font: '18px Arial', fill: '#666', backgroundColor: '#222' }).setInteractive();
        this.startButton.on('pointerdown', () => {
            // only allowed if enabled
            if (this.startButtonEnabled && typeof requestStartBattle === 'function') requestStartBattle();
        });

        // Hook into startNetwork to begin connection and receive lobby updates
        if (!window.socket || !window.socket.connected) {
            if (window.pendingPlayerName) startNetwork(this, window.pendingPlayerName);
        }

        // If any lobby data already exists, render it
        if (window.lobbyPlayers) this.onLobbyUpdate(window.lobbyPlayers);
    }

    // Called by startNetwork when lobby data changes
    onLobbyUpdate(lobbyData) {
        // lobbyData is an object keyed by id => player info
        const entries = Object.values(lobbyData || {});

        // sort to stable order (by name)
        entries.sort((a,b)=> (a.name||'').localeCompare(b.name||''));

        for (let i = 0; i < 6; i++) {
            const ent = entries[i];
            if (ent) {
                this.slotTexts[i].setText(`${i+1}. ${ent.name}`);
                this.slotReady[i].setText(ent.ready ? 'Ready' : 'Not Ready');
                this.slotReady[i].setFill(ent.ready ? '#0f0' : '#faa');
            } else {
                this.slotTexts[i].setText(`${i+1}: (empty)`);
                this.slotReady[i].setText('-');
                this.slotReady[i].setFill('#aaa');
            }
        }

        // Determine if all currently connected players (up to 6) are ready
        const connectedPlayers = Object.values(lobbyData || {});
        const checkPlayers = connectedPlayers.slice(0, 6);
        const allReady = checkPlayers.length > 0 && checkPlayers.every(p => p.ready);

        this.startButtonEnabled = allReady;
        this.startButton.setStyle({ fill: allReady ? '#fff' : '#666', backgroundColor: allReady ? '#480' : '#222' });
    }
}

// Called when GameScene becomes active to setup arrow handlers and pointer input
function setupGameForScene(scene) {
    if (!socket) return;
    // Setup arrow handlers now that socket exists
    setupArrowHandlers(scene, socket);

    // Pointer handler for shooting
    scene.input.off('pointerdown');
    scene.input.on('pointerdown', pointer => {
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
    // If we have serverPlayers snapshot, ensure sprites exist
    if (window.serverPlayers) {
        for (let id in window.serverPlayers) {
            if (!players[id]) addPlayer(scene, id, window.serverPlayers[id]);
        }
    }
}

// Register scenes and create the Phaser game instance
config.scene = [ LoginScene, LobbyScene, GameScene ];
game = new Phaser.Game(config);


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

    // Do NOT connect to the server until the player clicks Join.
    // Expose a startGame(name) function on window that the join overlay will call.
    // Use the refactored `startNetwork` to avoid duplicating handlers.
    window.startGame = (playerName) => {
        window.pendingPlayerName = playerName;
        startNetwork(this, playerName);
    };

    // create() ends here; the actual connection to the server is started when
    // window.startGame(name) is called by the join overlay.
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

// Helper: detect whether the user is currently typing in an <input> or <textarea>
// Moved out of `update()` to avoid allocating a new function every frame.
function isTextInputActive() {
    try {
        const el = document.activeElement;
        if (!el) return false;
        const tag = el.tagName && el.tagName.toLowerCase();
        return tag === 'input' || tag === 'textarea' || el.isContentEditable;
    } catch (e) {
        return false;
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
    let x = sprite.x - barWidth / 2;
    let y = sprite.y - sprite.height / 2 - 12;

    healthBar.clear();

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
    // use top-level helper to avoid per-frame allocations

if (typeof update.Count === 'undefined') {
    update.Count = 0;
}


console.log(
    "visible:", player.visible,
    "renderable:", player.renderable,
    "active:", player.active,
    "inCamera:", player.inCamera
);

    if ( player.dead == false ) 
    {
        // If the user is typing into an input (e.g. the join name box), do not interpret
        // WASD / arrow keys as movement. This prevents characters like 'a' from being
        // swallowed by the game.
        if (isTextInputActive()) {
            // ensure we don't send movement while typing
            console.log('Text input active - movement blocked');
        } else {
            // stop any previous movement
            player.body.setVelocity(0);

            // movement flags
            let moving = false;
            let animKey = '';

            const margin = 40;

            // Arrow keys / WASD
            if (cursors.left.isDown || wasd.left.isDown) {

                console.log('Moving left');

                if ( player.x - speed >= margin )
                {
                    player.x -= speed;
                }
                animKey = 'right';
                player.setFlipX(true);
                player.facing = 'left';
                moving = true;
            }
            else if (cursors.right.isDown || wasd.right.isDown) {

                console.log('Moving right');

                if ( player.x + speed <= config.width - margin )
                {
                    player.x += speed;
                }
                animKey = 'right';
                player.setFlipX(false);        
                player.facing = 'right';
                moving = true;
            }

            if (cursors.up.isDown || wasd.up.isDown) {

                console.log('Moving up');

                if ( player.y - speed >= margin )
                {
                    player.y -= speed;
                }
                animKey = 'up';
                player.facing = 'up';
                moving = true;
            }
            else if (cursors.down.isDown || wasd.down.isDown) {

                console.log('Moving down');

                if ( player.y + speed <= config.height - margin )
                {
                    player.y += speed;
                }
                animKey = 'down';
                player.facing = 'down';
                moving = true;
            }

            // animation
            if (moving) {
                console.log("animKey:", animKey);
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

    // Clamp sprite position to world bounds (before drawing health bars)
    /*
    for (let id in players) {
        const p = players[id];
        if (!p) continue;
        const margin = 40;
        p.x = Phaser.Math.Clamp(p.x, margin, config.width - margin);
        p.y = Phaser.Math.Clamp(p.y, margin, config.height - margin);
    }
    */

    // health bars
    for (let id in players) 
    {
        if ( players[id].dead ) 
        {
            continue;
        }
        
        drawHealthBar(players[id]);
    }

    // Update name text positions (place the name below the sprite at the same distance
    // the health bar is above the sprite: sprite.y +/- sprite.height/2 + 12)
    for (let id in players) {
        const p = players[id];
        if (!p) continue;
        
        // Text follows sprite
        if (p.nameText) {
            p.nameText.x = p.x;
            p.nameText.y = p.y + (p.height / 2) + 2;
            p.nameText.setVisible(!p.dead);
        }
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

    players[id].facing = 'down'; // default facing direction

    // Play default animation
    players[id].anims.play('idle-down', true);

    players[id].healthBar = healthBar;
    players[id].healthPoints = 5;
    players[id].scene = scene;
    players[id].dead = false;

    // Name text (may be provided in info.name)
    const name = info.name || '';
    // Position name under the sprite
    players[id].nameText = scene.add.text(info.x, info.y + (players[id].height / 2) + 2, name, {
        font: '14px Arial',
        fill: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
        align: 'center'
    }).setOrigin(0.5, 0);
    players[id].nameText.setDepth(10);

    //experiment...
    players[id].setVisible(true);
    players[id].setActive(true);
    players[id].cull = false;
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
