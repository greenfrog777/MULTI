// We'll register scenes below. LoginScene will be added first and GameScene
// will be the main scene using the existing preload/create/update functions.
let config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    physics: { default: 'arcade' },
    scene: [] // filled after LoginScene declaration
};

function getDirectionalAnimationBase(facing) {
    if (facing === 'up' || facing === 'down') {
        return facing;
    }

    return 'right';
}

function applyDirectionalFlip(player, facing) {
    player.setFlipX(facing === 'left');
}

function playHurtAnimation(player) {
    if (!player || player.dead || player.isPlayingDeath || player.isPlayingHurt) {
        return;
    }

    const facing = player.facing || 'down';
    const animKey = 'hurt-' + getDirectionalAnimationBase(facing);
    player.isPlayingHurt = true;
    applyDirectionalFlip(player, facing);
    player.anims.play(animKey, true);

    if (player.hurtAnimationResetEvent) {
        player.hurtAnimationResetEvent.remove(false);
    }

    player.hurtAnimationResetEvent = player.scene.time.delayedCall(320, () => {
        player.isPlayingHurt = false;
        player.hurtAnimationResetEvent = null;
    });
}

function spawnHitParticles(scene, x, y, tint, count) {
    if (!scene || !scene.add) return;
    if (!scene.textures || !scene.textures.exists('particle')) return;
    try {
        const n = count || 10;
        const emitter = scene.add.particles(x, y, 'particle', {
            speed: { min: 50, max: 130 },
            angle: { min: 0, max: 360 },
            scale: { start: 1.2, end: 0 },
            alpha: { start: 0.9, end: 0 },
            lifespan: 320,
            quantity: n,
            tint: tint,
            emitting: false
        });
        emitter.explode(n);
        scene.time.delayedCall(700, () => { try { emitter.destroy(); } catch (e) {} });
    } catch (e) {
        // particles are non-critical
    }
}

function flashHitEffect(player) {
    if (!player || player.dead) return;
    player.setTint(0xffffff);
    player.scene.time.delayedCall(100, () => {
        if (player && !player.dead) {
            player.setTint(player.originalTint !== undefined ? player.originalTint : 0xffffff);
        }
    });
}

function playDeathAnimation(player) {
    const facing = player.facing || 'down';
    const animKey = 'death-' + getDirectionalAnimationBase(facing);
    player.isPlayingDeath = true;
    player.isPlayingHurt = false;

    if (player.hurtAnimationResetEvent) {
        player.hurtAnimationResetEvent.remove(false);
        player.hurtAnimationResetEvent = null;
    }

    applyDirectionalFlip(player, facing);
    player.anims.play(animKey, true);
}

let game = null; // created after scenes are registered
let cursors;
let canShoot = true; // only one arrow at a time
let nextAllowedShoot = 0; // timestamp (ms) when next shot is allowed
const SHOOT_COOLDOWN_MS = 800; // cooldown between shots in milliseconds
// Centralized player health constant - authoritative value comes from the server
// Client will receive `maxHp` in the `init`/`gameStart` payload and set this.
let PLAYER_MAX_HP = null;
let PLAYER_MOVE_SPEED = 300;
const WORLD_MARGIN = 40;
const LOCAL_PLAYER_SNAP_DISTANCE = 48;
const LOCAL_PLAYER_CORRECTION_LERP = 0.35;
const LOCAL_PLAYER_MICRO_CORRECTION_LERP = 0.12;
const INPUT_SEND_RATE_MS = 50;
const INPUT_IDLE_HEARTBEAT_MS = 100;
const REMOTE_EXTRAPOLATION_LIMIT_MS = 100;
const PLAYER_COLLISION_RADIUS = 18;
let wasd;
let wallGraphics = null;

function getGameAudio() {
    return window.GameAudio || null;
}

window.localInputState = window.localInputState || { up: false, down: false, left: false, right: false };
window.lastSentInputState = window.lastSentInputState || null;
window.nextInputSendAt = window.nextInputSendAt || 0;
window.localInputSeq = window.localInputSeq || 0;

// Interpolation feature flag and defaults
// Enabled by default for deployed builds — visual-only smoothing for remote players
window.NET_INTERP_ENABLED = true; // toggle in console
window.NET_INTERP_DELAY_MS = window.NET_INTERP_DELAY_MS || 120; // render delay in ms
window.serverTimeOffsetMs = window.serverTimeOffsetMs || 0; // estimated client - server
window.NET_EXTRAPOLATION_MAX_MS = window.NET_EXTRAPOLATION_MAX_MS || REMOTE_EXTRAPOLATION_LIMIT_MS;

// Client-side periodic net diagnostics (non-functional logging only)
if (!window._clientNetLogHandle) {
    window._clientNetLogHandle = setInterval(() => {
        try {
            const fps = (window.game && window.game.loop && window.game.loop.actualFps) ? window.game.loop.actualFps.toFixed(1) : 'n/a';
            const netStats = window.netInstrumentation && window.netInstrumentation.getUpdateStats ? window.netInstrumentation.getUpdateStats() : null;
            if (netStats) {
                console.log(`[net-stats] client fps=${fps} updateAvgMs=${netStats.avgMs.toFixed(1)} stdMs=${netStats.stdMs.toFixed(1)} samples=${netStats.samples}`);
            } else {
                console.log(`[net-stats] client fps=${fps} updateAvgMs=n/a`);
            }
        } catch (e) {
            console.warn('net-stats logging error', e);
        }
    }, 5000);
}

// Periodically send client diagnostics to server so they appear in remote logs
if (!window._clientLogSender) {
    window._clientLogSender = setInterval(() => {
        try {
            const stats = window.netInstrumentation && window.netInstrumentation.getUpdateStats ? window.netInstrumentation.getUpdateStats() : null;
            const fps = (window.game && window.game.loop && window.game.loop.actualFps) ? Math.round(window.game.loop.actualFps) : null;
            if ((stats || fps) && window.socket && window.socket.connected) {
                window.socket.emit('clientLog', { fps, stats, ts: Date.now() });
            }
        } catch (e) {
            // don't let diagnostics break the game
        }
    }, 5000);
}

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

    this.load.spritesheet('hurt', 'assets/hana/hurt.png', {
        frameWidth: 80,
        frameHeight: 80
    });

    this.load.spritesheet('death', 'assets/hana/death.png', {
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

function applyServerMovementConfig(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (typeof payload.moveSpeed === 'number' && payload.moveSpeed > 0) {
        PLAYER_MOVE_SPEED = payload.moveSpeed;
    } else if (window.serverConfig && typeof window.serverConfig.moveSpeed === 'number' && window.serverConfig.moveSpeed > 0) {
        PLAYER_MOVE_SPEED = window.serverConfig.moveSpeed;
    }

    if (Array.isArray(payload.walls)) {
        window.battleWalls = payload.walls.map(wall => ({ ...wall }));
    }
}

// --- Helper: start network & wire up handlers (extracted from previous window.startGame logic) ---
function startNetwork(scene, playerName) {
    window.pendingPlayerName = playerName;
    // Connect and register handlers for lobby + game
    connectToServer(
        (initData) => { // onInit (may include players and maxHp)
            // extract players payload (support old-style payloads too)
            const serverPlayers = initData && initData.players ? initData.players : initData;
            applyServerMovementConfig(initData);
            // if server provided authoritative maxHp, override client value
            if (initData && typeof initData.maxHp === 'number') PLAYER_MAX_HP = initData.maxHp;
            // store initial server snapshot; create sprites only when in GameScene
            window.serverPlayers = serverPlayers;
            myId = socket.id;
            if (scene.scene && scene.scene.key === 'GameScene') {
                for (let id in serverPlayers) addPlayer(scene, id, serverPlayers[id]);
            }
        },
        (id, pos, serverTime) => { // onUpdate (now receives serverTime)
            // keep a copy of latest server positions for backward compat
            window.serverPlayers = window.serverPlayers || {};
            window.serverPlayers[id] = pos;

            if (typeof pos.vx === 'number') {
                if (players[id]) {
                    players[id].lastServerVx = pos.vx;
                    players[id].lastServerVy = pos.vy || 0;
                }
            }

            if (players[id]) {
                if (typeof pos.hp === 'number') players[id].healthPoints = pos.hp;
            }

            if (id === myId && players[id]) {
                players[id].serverReconX = pos.x;
                players[id].serverReconY = pos.y;
                players[id].serverReconVx = pos.vx || 0;
                players[id].serverReconVy = pos.vy || 0;
                if (pos.name && players[id].nameText) players[id].nameText.setText(pos.name);
            }

            // If interpolation is disabled, update sprites immediately (old behavior)
            if (!window.NET_INTERP_ENABLED) {
                if (players[id]) {
                    players[id].prevX = players[id].x;
                    players[id].prevY = players[id].y;
                    players[id].x = pos.x;
                    players[id].y = pos.y;

                    if (pos.name && players[id].nameText) players[id].nameText.setText(pos.name);
                    updateFacing(players[id]);
                }
            } else {
                // Interpolation enabled: ensure snapshots structure exists (network.js already pushes but be defensive)
                window.serverSnapshots = window.serverSnapshots || {};
                if (!window.serverSnapshots[id]) window.serverSnapshots[id] = [];
                // store a fallback last-known position for this sprite in case interpolation has no data
                if (players[id]) {
                    players[id].lastServerX = pos.x;
                    players[id].lastServerY = pos.y;
                    players[id].lastServerT = serverTime || Date.now();
                }
            }
        },
        (id) => { // onRemove
            if (players[id]) {
                if (players[id].nameText) players[id].nameText.destroy();
                players[id].destroy();
                delete players[id];
            }
            if (window.serverPlayers && window.serverPlayers[id]) delete window.serverPlayers[id];
            if (window.serverSnapshots && window.serverSnapshots[id]) delete window.serverSnapshots[id];
        },
        // lobby updates
        (lobbyData) => {
            // pass through to scene if it implements onLobbyUpdate
            if (scene && typeof scene.onLobbyUpdate === 'function') scene.onLobbyUpdate(lobbyData);
            else window.lobbyPlayers = lobbyData;
        },
        // startBattle signal
        () => {
            // Clear stale lobby snapshots/positions so GameScene does not spawn
            // players at old pre-match coordinates before `gameStart` arrives.
            window.serverPlayers = null;
            window.serverSnapshots = {};
            // server says start — transition to GameScene
            if (scene && scene.scene) scene.scene.start('GameScene');
            else window.startRequested = true;
        },
        // gameStart payload -- server may send { players, maxHp }
        (payload) => {
            // support both new payload shape and older shape where payload was players object
            const playersPayload = payload && payload.players ? payload.players : payload;
            window.serverPlayers = playersPayload;
            applyServerMovementConfig(payload);

            // if server provided authoritative maxHp, override client value
            if (payload && typeof payload.maxHp === 'number') {
                PLAYER_MAX_HP = payload.maxHp;
            }

            // if we're already in GameScene, create players (or update existing ones)
            if (scene && scene.scene && scene.scene.key === 'GameScene') {
                for (let id in playersPayload) {
                    if (players[id]) {
                        // update hp from server snapshot if provided
                        if (playersPayload[id] && typeof playersPayload[id].hp === 'number') {
                            players[id].healthPoints = playersPayload[id].hp;
                        } else {
                            players[id].healthPoints = PLAYER_MAX_HP;
                        }
                        // Also update position immediately and seed prev positions so
                        // interpolation does not cause artificial movement at match start
                        try {
                            const px = (playersPayload[id].x !== undefined) ? playersPayload[id].x : (playersPayload[id].position && playersPayload[id].position.x) || players[id].x;
                            const py = (playersPayload[id].y !== undefined) ? playersPayload[id].y : (playersPayload[id].position && playersPayload[id].position.y) || players[id].y;
                            const pvx = Number(playersPayload[id].vx || 0);
                            const pvy = Number(playersPayload[id].vy || 0);
                            players[id].x = px;
                            players[id].y = py;
                            players[id].prevX = px;
                            players[id].prevY = py;
                            players[id].lastServerX = px;
                            players[id].lastServerY = py;
                            players[id].lastServerVx = pvx;
                            players[id].lastServerVy = pvy;
                            players[id].serverReconX = px;
                            players[id].serverReconY = py;
                            players[id].serverReconVx = pvx;
                            players[id].serverReconVy = pvy;
                        } catch (e) {
                            // ignore positioning errors
                        }
                    } else {
                        addPlayer(scene, id, playersPayload[id]);
                    }
                }
            }
        },
        // gameOver / victory
        (gameOverData) => {
            if (scene && scene.scene) {
                // start VictoryScene and pass winner info
                scene.scene.start('VictoryScene', { winnerId: gameOverData.winnerId, winnerName: gameOverData.winnerName, colour: gameOverData.colour });
            } else {
                window.pendingGameOver = gameOverData;
            }
        }
    );
}

// --- LobbyScene: shows list of players and ready/start controls ---
class LobbyScene extends Phaser.Scene {
    constructor() { super({ key: 'LobbyScene' }); }

    create() {
        // Ensure any leftover game entities are removed when entering the lobby/menus
        // This is defensive in case we transitioned here from a game without cleanup.
        try { cleanupGameEntities(); } catch (e) { /* ignore */ }
        this.cameras.main.setBackgroundColor('#0a0a0a');
        this.add.text(config.width/2, 40, 'Lobby', { font: '28px Arial', fill: '#fff' }).setOrigin(0.5);

        // Title for players list
        this.add.text(40, 80, 'Players:', { font: '18px Arial', fill: '#fff' });

        // Create up to 6 slots (hidden when empty)
        this.slotTexts = [];
        this.slotReady = [];
        for (let i = 0; i < 6; i++) {
            const y = 110 + i * 34;
            const nameTxt = this.add.text(80, y, ``, { font: '16px Arial', fill: '#ddd' }).setVisible(false);
            const readyTxt = this.add.text(360, y, '', { font: '16px Arial', fill: '#aaa' }).setVisible(false);
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

        // Message shown when waiting for other players
        this.waitingText = this.add.text(config.width/2, 220, 'Waiting for other players', { font: '18px Arial', fill: '#ccc' }).setOrigin(0.5).setVisible(false);

        // Hook into startNetwork to begin connection and receive lobby updates
        if (!window.socket || !window.socket.connected) {
            if (window.pendingPlayerName) startNetwork(this, window.pendingPlayerName);
        }

        // If any lobby data already exists, render it
        if (window.lobbyPlayers) this.onLobbyUpdate(window.lobbyPlayers);
    }

    // Called by startNetwork when lobby data changes
    onLobbyUpdate(lobbyData) {
        // If the scene is not currently active (we may have transitioned away), ignore updates.
        // This avoids attempting to re-render Phaser Text objects that may have been destroyed,
        // which can cause internal canvas/context errors (e.g. drawImage on null).
        try {
            if (!this.sys || typeof this.sys.isActive === 'function' && !this.sys.isActive()) {
                return;
            }
        } catch (e) {
            // If checking fails for any reason, continue cautiously.
        }
        // lobbyData is an object keyed by id => player info
        const entries = Object.values(lobbyData || {});

        // sort by join order (first to join appears first)
        entries.sort((a,b) => (a.joinOrder || 0) - (b.joinOrder || 0));

        for (let i = 0; i < 6; i++) {
            const ent = entries[i];
            const nameTxt = this.slotTexts && this.slotTexts[i];
            const readyTxt = this.slotReady && this.slotReady[i];
            if (ent) {
                if (nameTxt && typeof nameTxt.setText === 'function') {
                    nameTxt.setText(`${i+1}. ${ent.name}`);
                    if (typeof nameTxt.setVisible === 'function') nameTxt.setVisible(true);
                }
                if (readyTxt && typeof readyTxt.setText === 'function') {
                    readyTxt.setText(ent.ready ? 'Ready' : 'Not Ready');
                    if (typeof readyTxt.setFill === 'function') readyTxt.setFill(ent.ready ? '#0f0' : '#faa');
                    if (typeof readyTxt.setVisible === 'function') readyTxt.setVisible(true);
                }
            } else {
                if (nameTxt && typeof nameTxt.setVisible === 'function') nameTxt.setVisible(false);
                if (readyTxt && typeof readyTxt.setVisible === 'function') readyTxt.setVisible(false);
            }
        }

        // Determine readiness: require at least 2 players and all of them ready
        const connectedPlayers = entries.slice(0, 6);
        const allReady = connectedPlayers.length >= 2 && connectedPlayers.every(p => p.ready);

        this.startButtonEnabled = allReady;
        if (this.startButton && typeof this.startButton.setStyle === 'function') {
            try {
                this.startButton.setStyle({ fill: allReady ? '#fff' : '#666', backgroundColor: allReady ? '#480' : '#222' });
            } catch (err) {
                // If setStyle throws (e.g. internal texture/context was destroyed), recreate a safe fallback
                console.warn('startButton.setStyle failed, recreating startButton:', err);
                try {
                    // destroy existing and recreate a minimal start button
                    if (this.startButton && typeof this.startButton.destroy === 'function') this.startButton.destroy();
                } catch (e) {}
                this.startButton = this.add.text(config.width/2 + 20, 340, 'Start Battle', { font: '18px Arial', fill: allReady ? '#fff' : '#666', backgroundColor: allReady ? '#480' : '#222' }).setInteractive();
                this.startButton.on('pointerdown', () => {
                    if (this.startButtonEnabled && typeof requestStartBattle === 'function') requestStartBattle();
                });
            }
        }

        // Show waiting text when fewer than 2 players
        if (this.waitingText && typeof this.waitingText.setVisible === 'function') {
            this.waitingText.setVisible(connectedPlayers.length < 2);
        }
    }
}

// --- VictoryScene: displays winner and celebratory animation ---
class VictoryScene extends Phaser.Scene {
    constructor() { super({ key: 'VictoryScene' }); }

    init(data) {
        this.winnerId = data && data.winnerId;
        this.winnerName = (data && data.winnerName) || 'Player';
        this.winnerColour = (data && data.colour) || 0xffffff;
    }

    create() {
        const cx = config.width/2;
        const cy = config.height/2;
        const audio = getGameAudio();

        if (audio && typeof audio.playVictoryMusic === 'function') {
            audio.playVictoryMusic();
        }

        this.events.once('shutdown', () => {
            if (audio && typeof audio.stopVictoryMusic === 'function') {
                audio.stopVictoryMusic();
            }
        });

        this.events.once('destroy', () => {
            if (audio && typeof audio.stopVictoryMusic === 'function') {
                audio.stopVictoryMusic();
            }
        });

        // dark background
        this.cameras.main.setBackgroundColor('#081018');

        // big winner text
        const big = this.add.text(cx, cy, `${this.winnerName} Wins!`, {
            font: '64px Arial',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 10
        }).setOrigin(0.5);

        // small subtitle
        this.add.text(cx, cy + 64, 'Victory!', { font: '24px Arial', fill: '#ffd700' }).setOrigin(0.5);

        // create celebratory runner sprite that moves around the screen border
        const margin = 40;
        const sprite = this.add.sprite(margin, margin, 'player').setScale(3);
        // Normalize winner colour (server sends strings like "#rrggbb") and lighten it
        try {
            let baseCol = this.winnerColour || 0xffffff;
            if (typeof baseCol === 'string') {
                // Convert hex string to integer color
                baseCol = Phaser.Display.Color.HexStringToColor(baseCol).color;
            }
            const finalTint = lightenColor(baseCol, 0.4);
            sprite.setTint(finalTint);
        } catch (e) {
            // Fallback to white if parsing fails
            sprite.setTint(0xffffff);
            console.warn('Failed to tint winner sprite, using default', e);
        }

        // ensure animations exist (GameScene's create setup should have created them, but guard)
        if (!this.anims.exists('right')) {
            this.anims.create({ key: 'right', frames: this.anims.generateFrameNumbers('player', { start: 0, end: 7 }), frameRate: 10, repeat: -1 });
            this.anims.create({ key: 'down', frames: this.anims.generateFrameNumbers('player', { start: 8, end: 15 }), frameRate: 10, repeat: -1 });
            this.anims.create({ key: 'up', frames: this.anims.generateFrameNumbers('player', { start: 16, end: 23 }), frameRate: 10, repeat: -1 });
            this.anims.create({ key: 'idle-right', frames: this.anims.generateFrameNumbers('idle', { start: 0, end: 3 }), frameRate: 10, repeat: -1 });
            this.anims.create({ key: 'idle-down', frames: this.anims.generateFrameNumbers('idle', { start: 4, end: 7 }), frameRate: 10, repeat: -1 });
            this.anims.create({ key: 'idle-up', frames: this.anims.generateFrameNumbers('idle', { start: 8, end: 11 }), frameRate: 10, repeat: -1 });
        }

        // path: top-left -> top-right -> bottom-right -> bottom-left -> top-left
        const path = [
            { x: config.width - margin, y: margin, anim: 'right', flipX: false },
            { x: config.width - margin, y: config.height - margin, anim: 'down', flipX: false },
            { x: margin, y: config.height - margin, anim: 'right', flipX: true },
            { x: margin, y: margin, anim: 'up', flipX: false }
        ];

        // Loop the sprite around the border using chained tweens
        // (compatible with Phaser builds that don't expose `tweens.timeline`).
        const scene = this;
        let _idx = 0;
        function moveNext() {
            const step = path[_idx];
            scene.tweens.add({
                targets: sprite,
                x: step.x,
                y: step.y,
                duration: 1400,
                ease: 'Linear',
                onStart: function() {
                    sprite.anims.play(step.anim, true);
                    sprite.setFlipX(!!step.flipX);
                },
                onComplete: function() {
                    _idx = (_idx + 1) % path.length;
                    // tiny pause between moves for visual rhythm
                    scene.time.delayedCall(50, moveNext, [], scene);
                }
            });
        }
        // Kick off the loop
        moveNext();

        // After 5s, show Return to Lobby button
        this.time.delayedCall(5000, () => {
            const btn = this.add.text(cx, config.height - 80, 'Return to Lobby', { font: '20px Arial', fill: '#fff', backgroundColor: '#222', padding: { x: 10, y: 8 } }).setOrigin(0.5).setInteractive();
            btn.on('pointerdown', () => {
                if (audio && typeof audio.stopVictoryMusic === 'function') {
                    audio.stopVictoryMusic();
                }
                // mark local player not ready and tell server we're back in the lobby
                if (typeof sendReady === 'function') sendReady(false);
                if (typeof sendBackToLobby === 'function') sendBackToLobby();
                // cleanup any match sprites/graphics so we don't leave players visible
                try { cleanupGameEntities(); } catch (e) { console.warn('cleanup before lobby failed', e); }
                this.scene.start('LobbyScene');
            });
        });
    }
}

// Called when GameScene becomes active to setup arrow handlers and pointer input
function setupGameForScene(scene) {
    if (!socket) return;
    const audio = getGameAudio();
    if (audio && typeof audio.stopVictoryMusic === 'function') {
        audio.stopVictoryMusic();
    }
    if (audio && typeof audio.unlock === 'function') {
        audio.unlock();
    }
    renderBattleWalls(scene);
    // Setup arrow handlers now that socket exists
    setupArrowHandlers(scene, socket);

    // Pointer handler for shooting
    scene.input.off('pointerdown');
    scene.input.on('pointerdown', pointer => {
        // enforce cooldown first
        if (Date.now() < nextAllowedShoot) return;
        if (!canShoot) return;
        const player = players[myId];
        if (!player) return;
        if (player.dead) return;

        const dx = pointer.worldX - player.x;
        const dy = pointer.worldY - player.y;
        const angle = Phaser.Math.RadToDeg(Math.atan2(dy, dx));

        socket.emit('shootArrowNew', { x: player.x, y: player.y, angle });
        canShoot = false;
        // set cooldown timestamp and ensure local re-enable after cooldown
        nextAllowedShoot = Date.now() + SHOOT_COOLDOWN_MS;
        setTimeout(() => { canShoot = true; }, SHOOT_COOLDOWN_MS + 10);
    });
    // If we have serverPlayers snapshot, ensure sprites exist
    if (window.serverPlayers) {
        for (let id in window.serverPlayers) {
            if (!players[id]) addPlayer(scene, id, window.serverPlayers[id]);
        }
    }
}

// Clean up sprites/graphics created during a match so scenes don't leak visuals
function cleanupGameEntities() {
    // Destroy player sprites and related graphics
    try {
        for (let id in players) {
            const p = players[id];
            if (!p) continue;
            try { if (p.nameText) p.nameText.destroy(); } catch (e) {}
            try { if (p.healthBar) p.healthBar.destroy(); } catch (e) {}
            try { p.destroy(); } catch (e) {}
            try { delete players[id]; } catch (e) {}
        }
    } catch (e) {
        console.warn('cleanupGameEntities: error destroying players', e);
    }

    // Destroy arrows
    try {
        for (let aid in arrowList) {
            try { arrowList[aid].destroy(); } catch (e) {}
            try { delete arrowList[aid]; } catch (e) {}
        }
    } catch (e) {
        console.warn('cleanupGameEntities: error destroying arrows', e);
    }

    // Clear server snapshot
    try { window.serverPlayers = {}; } catch (e) {}
    try { window.serverSnapshots = {}; } catch (e) {}
    try {
        if (wallGraphics) {
            wallGraphics.destroy();
            wallGraphics = null;
        }
    } catch (e) {
        console.warn('cleanupGameEntities: error destroying wall graphics', e);
    }
    window.pendingGameOver = null;
    // reset shooting state
    try { canShoot = true; nextAllowedShoot = 0; } catch (e) {}
    window.localInputState = { up: false, down: false, left: false, right: false };
    window.lastSentInputState = null;
    window.nextInputSendAt = 0;
}

// Register scenes and create the Phaser game instance
config.scene = [ LoginScene, LobbyScene, GameScene, VictoryScene ];
game = new Phaser.Game(config);


function create() {

    // Stop players leaving the game area
    this.physics.world.setBounds(0, 0, config.width, config.height);

    // Register animations only once (Phaser's AnimationManager is global)
    if (!this.anims.exists('right')) {
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

        this.anims.create({
            key: 'hurt-right',
            frames: this.anims.generateFrameNumbers('hurt', { start: 0, end: 3 }),
            frameRate: 14,
            repeat: 0
        });

        this.anims.create({
            key: 'hurt-down',
            frames: this.anims.generateFrameNumbers('hurt', { start: 4, end: 7 }),
            frameRate: 14,
            repeat: 0
        });

        this.anims.create({
            key: 'hurt-up',
            frames: this.anims.generateFrameNumbers('hurt', { start: 8, end: 11 }),
            frameRate: 14,
            repeat: 0
        });

        this.anims.create({
            key: 'death-right',
            frames: this.anims.generateFrameNumbers('death', { start: 0, end: 5 }),
            frameRate: 12,
            repeat: 0
        });

        this.anims.create({
            key: 'death-down',
            frames: this.anims.generateFrameNumbers('death', { start: 6, end: 11 }),
            frameRate: 12,
            repeat: 0
        });

        this.anims.create({
            key: 'death-up',
            frames: this.anims.generateFrameNumbers('death', { start: 12, end: 17 }),
            frameRate: 12,
            repeat: 0
        });
    }


    // Generate a small white circle texture used by the hit particle emitters
    if (!this.textures.exists('particle')) {
        const gfx = this.make.graphics({ x: 0, y: 0, add: false });
        gfx.fillStyle(0xffffff, 1);
        gfx.fillCircle(4, 4, 4);
        gfx.generateTexture('particle', 8, 8);
        gfx.destroy();
    }

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
const ARROW_STALE_MS = 400;

function getBattleWalls() {
    return Array.isArray(window.battleWalls) ? window.battleWalls : [];
}

function renderBattleWalls(scene) {
    const walls = getBattleWalls();
    if (!scene || !scene.add) return;

    if (wallGraphics) {
        wallGraphics.destroy();
        wallGraphics = null;
    }

    if (!walls.length) return;

    wallGraphics = scene.add.graphics();
    wallGraphics.setDepth(-5);

    for (const wall of walls) {
        const fillColour = wall.colour || '#5a4631';
        const strokeColour = wall.stroke || '#2f2418';
        wallGraphics.fillStyle(Phaser.Display.Color.HexStringToColor(fillColour).color, 1);
        wallGraphics.fillRect(wall.x, wall.y, wall.w, wall.h);
        wallGraphics.lineStyle(3, Phaser.Display.Color.HexStringToColor(strokeColour).color, 1);
        wallGraphics.strokeRect(wall.x, wall.y, wall.w, wall.h);
        wallGraphics.fillStyle(0xffffff, 0.08);
        wallGraphics.fillRect(wall.x + 4, wall.y + 4, Math.max(0, wall.w - 8), Math.max(0, Math.min(8, wall.h - 8)));
    }
}

function resolveWallAxisCollision(candidateAlongAxis, fixedAxis, previousAlongAxis, axis) {
    const walls = getBattleWalls();

    for (const wall of walls) {
        if (axis === 'x') {
            if (fixedAxis + PLAYER_COLLISION_RADIUS <= wall.y || fixedAxis - PLAYER_COLLISION_RADIUS >= wall.y + wall.h) continue;
            if (candidateAlongAxis + PLAYER_COLLISION_RADIUS <= wall.x || candidateAlongAxis - PLAYER_COLLISION_RADIUS >= wall.x + wall.w) continue;

            if (candidateAlongAxis > previousAlongAxis) {
                candidateAlongAxis = wall.x - PLAYER_COLLISION_RADIUS;
            } else if (candidateAlongAxis < previousAlongAxis) {
                candidateAlongAxis = wall.x + wall.w + PLAYER_COLLISION_RADIUS;
            } else {
                const pushLeft = Math.abs(candidateAlongAxis - (wall.x - PLAYER_COLLISION_RADIUS));
                const pushRight = Math.abs((wall.x + wall.w + PLAYER_COLLISION_RADIUS) - candidateAlongAxis);
                candidateAlongAxis = pushLeft <= pushRight ? wall.x - PLAYER_COLLISION_RADIUS : wall.x + wall.w + PLAYER_COLLISION_RADIUS;
            }
            continue;
        }

        if (fixedAxis + PLAYER_COLLISION_RADIUS <= wall.x || fixedAxis - PLAYER_COLLISION_RADIUS >= wall.x + wall.w) continue;
        if (candidateAlongAxis + PLAYER_COLLISION_RADIUS <= wall.y || candidateAlongAxis - PLAYER_COLLISION_RADIUS >= wall.y + wall.h) continue;

        if (candidateAlongAxis > previousAlongAxis) {
            candidateAlongAxis = wall.y - PLAYER_COLLISION_RADIUS;
        } else if (candidateAlongAxis < previousAlongAxis) {
            candidateAlongAxis = wall.y + wall.h + PLAYER_COLLISION_RADIUS;
        } else {
            const pushUp = Math.abs(candidateAlongAxis - (wall.y - PLAYER_COLLISION_RADIUS));
            const pushDown = Math.abs((wall.y + wall.h + PLAYER_COLLISION_RADIUS) - candidateAlongAxis);
            candidateAlongAxis = pushUp <= pushDown ? wall.y - PLAYER_COLLISION_RADIUS : wall.y + wall.h + PLAYER_COLLISION_RADIUS;
        }
    }

    return candidateAlongAxis;
}

function resolveLocalWallCollisions(player, nextX, nextY) {
    const resolvedX = resolveWallAxisCollision(nextX, player.y, player.x, 'x');
    const resolvedY = resolveWallAxisCollision(nextY, resolvedX, player.y, 'y');
    return { x: resolvedX, y: resolvedY };
}

function replaceArrowSprite(ownerId, nextSprite) {
    const existingArrow = arrowList[ownerId];
    if (existingArrow && existingArrow !== nextSprite) {
        try { existingArrow.destroy(); } catch (e) {}
    }
    arrowList[ownerId] = nextSprite;
}

function setupArrowHandlers(scene, socket) {
    // Remove previous handlers first to avoid duplicate handlers when re-entering scene
    try { socket.off('spawnArrow'); } catch (e) {}
    try { socket.off('updateArrows'); } catch (e) {}
    try { socket.off('playerHit'); } catch (e) {}
    try { socket.off('arrowImpact'); } catch (e) {}

    // When the server spawns a new arrow
    socket.on("spawnArrow", data => {
        const audio = getGameAudio();
        if (audio && typeof audio.playArrowFire === 'function') {
            audio.playArrowFire();
        }
        // create a sprite for the arrow
        const arrowSprite = scene.add.sprite(data.x, data.y, 'arrows', 74);
        arrowSprite.rotation = Phaser.Math.DegToRad(data.angle ) + Phaser.Math.DegToRad(90); // point correctly
        arrowSprite.targetX = data.x;
        arrowSprite.targetY = data.y;
        arrowSprite.vx = data.vx || 0;
        arrowSprite.vy = data.vy || 0;
        arrowSprite.lastServerTime = data.serverTime || Date.now();
        replaceArrowSprite(data.ownerId, arrowSprite);
    });

    // When the server sends updated arrow positions
    socket.on("updateArrows", data => {
        const currentIds = new Set();
        const hasArrow = data.some(a => a.ownerId === myId);
        // only allow shooting again when server reports no active arrow AND local cooldown elapsed
        if (!hasArrow && Date.now() >= nextAllowedShoot) canShoot = true;

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
                arrow.lastServerTime = arrowData.serverTime || Date.now();
            } else {
                // create new arrow if missed spawn event
                const arrowSprite = scene.add.sprite(arrowData.x, arrowData.y, "arrows", 75);
                arrowSprite.setOrigin(0.5, 0.5);
                arrowSprite.rotation = Math.atan2(arrowData.vy, arrowData.vx);
                arrowSprite.targetX = arrowData.x;
                arrowSprite.targetY = arrowData.y;
                arrowSprite.vx = arrowData.vx;
                arrowSprite.vy = arrowData.vy;
                arrowSprite.lastServerTime = arrowData.serverTime || Date.now();
                replaceArrowSprite(arrowData.ownerId, arrowSprite);
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

    socket.on('arrowImpact', data => {
        const arrow = arrowList[data.ownerId];
        if (arrow) {
            arrow.destroy();
            delete arrowList[data.ownerId];
        }

        // Spawn particles at the server-provided impact position
        if (Number.isFinite(data.x) && Number.isFinite(data.y)) {
            if (data.type === 'player') {
                // Use the hit player's colour, lightened heavily so red reads as pink not blood
                let particleTint = 0xffffff;
                const hitPlayer = data.targetId && players[data.targetId];
                if (hitPlayer && typeof hitPlayer.originalTint === 'number') {
                    particleTint = lightenColor(hitPlayer.originalTint, 0.65);
                }
                spawnHitParticles(scene, data.x, data.y, particleTint, 8);
            } else if (data.type === 'obstacle') {
                spawnHitParticles(scene, data.x, data.y, 0x8b6940, 8);
            }
        }

        const audio = getGameAudio();
        if (!audio) return;

        if (data.type === 'player' && typeof audio.playArrowHitPlayer === 'function') {
            audio.playArrowHitPlayer();
            return;
        }

        if (data.type === 'obstacle' && typeof audio.playArrowHitObstacle === 'function') {
            audio.playArrowHitObstacle();
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
            if (data.hp > 0) {
                flashHitEffect(p);
                playHurtAnimation(p);
            } else {
                handleDeath(p);
            }
        }
    });
}


function updateFacing(player) {
    const dx = player.x - player.prevX;
    const dy = player.y - player.prevY;
    // Remote players move via interpolation, so tiny decimal deltas are common.
    // Treat very small movement as noise to avoid animation flicker near idle.
    const movementEpsilon = 0.15;

    // Cache the frame-to-frame delta so the animation function uses the same
    // movement sample and does not re-calculate slightly different values.
    player.moveDx = dx;
    player.moveDy = dy;

    // Prefer vertical animations whenever there is any meaningful vertical motion.
    // This matches the local player rules and keeps diagonal movement stable:
    // up-right stays `up`, down-left stays `down`, instead of flickering.
    if (Math.abs(dy) > movementEpsilon) {
        player.facing = dy < 0 ? 'up' : 'down';
    } else if (Math.abs(dx) > movementEpsilon) {
        player.facing = dx < 0 ? 'left' : 'right';
    }
}

function playCorrectAnimation(player) {
    if (!player.facing || player.isPlayingHurt || player.isPlayingDeath) return; // no facing info or state animation active

    // Reuse the cached deltas from `updateFacing()` when available.
    // This keeps facing selection and idle detection in sync for the same frame.
    const dx = Number.isFinite(player.moveDx) ? player.moveDx : (player.x - player.prevX);
    const dy = Number.isFinite(player.moveDy) ? player.moveDy : (player.y - player.prevY);
    const movementEpsilon = 0.15;

    // For interpolated remote sprites, exact equality is unreliable because
    // positions often change by tiny fractions. Use the same epsilon threshold
    // to decide when the sprite is effectively idle.
    if ( Math.abs(dx) <= movementEpsilon && Math.abs(dy) <= movementEpsilon ) {
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

function areInputStatesEqual(a, b) {
    if (!a || !b) return false;
    return !!a.up === !!b.up && !!a.down === !!b.down && !!a.left === !!b.left && !!a.right === !!b.right;
}

function getCurrentInputState() {
    if (isTextInputActive()) {
        return { up: false, down: false, left: false, right: false };
    }

    return {
        left: !!((cursors && cursors.left && cursors.left.isDown) || (wasd && wasd.left && wasd.left.isDown)),
        right: !!((cursors && cursors.right && cursors.right.isDown) || (wasd && wasd.right && wasd.right.isDown)),
        up: !!((cursors && cursors.up && cursors.up.isDown) || (wasd && wasd.up && wasd.up.isDown)),
        down: !!((cursors && cursors.down && cursors.down.isDown) || (wasd && wasd.down && wasd.down.isDown))
    };
}

function getInputAxes(inputState) {
    let axisX = (inputState.right ? 1 : 0) - (inputState.left ? 1 : 0);
    let axisY = (inputState.down ? 1 : 0) - (inputState.up ? 1 : 0);

    if (axisX !== 0 || axisY !== 0) {
        const length = Math.hypot(axisX, axisY) || 1;
        axisX /= length;
        axisY /= length;
    }

    return { axisX, axisY };
}

function applyMovementInput(player, inputState, deltaSeconds) {
    const { axisX, axisY } = getInputAxes(inputState);
    player.predictedVx = axisX * PLAYER_MOVE_SPEED;
    player.predictedVy = axisY * PLAYER_MOVE_SPEED;
    player.prevX = player.x;
    player.prevY = player.y;
    const resolvedPosition = resolveLocalWallCollisions(
        player,
        player.x + player.predictedVx * deltaSeconds,
        player.y + player.predictedVy * deltaSeconds
    );
    player.x = resolvedPosition.x;
    player.y = resolvedPosition.y;
    player.x = Phaser.Math.Clamp(player.x, WORLD_MARGIN, config.width - WORLD_MARGIN);
    player.y = Phaser.Math.Clamp(player.y, WORLD_MARGIN, config.height - WORLD_MARGIN);

    if (Math.abs(axisY) > 0) {
        player.facing = axisY < 0 ? 'up' : 'down';
    } else if (Math.abs(axisX) > 0) {
        player.facing = axisX < 0 ? 'left' : 'right';
    }

    return axisX !== 0 || axisY !== 0;
}

function playLocalAnimation(player, isMoving) {
    if (player.isPlayingHurt || player.isPlayingDeath) {
        return;
    }

    if (isMoving) {
        if (player.facing === 'left') {
            player.anims.play('right', true);
            player.setFlipX(true);
        } else if (player.facing === 'right') {
            player.anims.play('right', true);
            player.setFlipX(false);
        } else {
            player.anims.play(player.facing, true);
        }
        return;
    }

    if (player.facing === 'left') {
        player.anims.play('idle-right', true);
        player.setFlipX(true);
    } else if (player.facing === 'right') {
        player.anims.play('idle-right', true);
        player.setFlipX(false);
    } else {
        player.anims.play('idle-' + player.facing, true);
        player.setFlipX(false);
    }
}

function sendCurrentInputState(inputState, force = false) {
    const now = Date.now();
    const isMoving = !!(inputState.left || inputState.right || inputState.up || inputState.down);
    const requiredInterval = isMoving ? INPUT_SEND_RATE_MS : INPUT_IDLE_HEARTBEAT_MS;
    const changed = !areInputStatesEqual(window.lastSentInputState, inputState);

    if (!force && !changed && now < (window.nextInputSendAt || 0)) {
        return;
    }

    window.localInputSeq = (window.localInputSeq || 0) + 1;
    sendMove({
        input: {
            up: !!inputState.up,
            down: !!inputState.down,
            left: !!inputState.left,
            right: !!inputState.right
        },
        seq: window.localInputSeq,
        clientTime: now
    });

    window.lastSentInputState = {
        up: !!inputState.up,
        down: !!inputState.down,
        left: !!inputState.left,
        right: !!inputState.right
    };
    window.nextInputSendAt = now + requiredInterval;
}

function reconcileLocalPlayer(player) {
    if (!player || !Number.isFinite(player.serverReconX) || !Number.isFinite(player.serverReconY)) {
        return;
    }

    const dx = player.serverReconX - player.x;
    const dy = player.serverReconY - player.y;
    const distance = Math.hypot(dx, dy);

    if (distance >= LOCAL_PLAYER_SNAP_DISTANCE) {
        player.x = player.serverReconX;
        player.y = player.serverReconY;
        return;
    }

    if (distance < 0.5) {
        return;
    }

    const correctionLerp = distance > 8 ? LOCAL_PLAYER_CORRECTION_LERP : LOCAL_PLAYER_MICRO_CORRECTION_LERP;
    player.x += dx * correctionLerp;
    player.y += dy * correctionLerp;
}

function handleDeath(player) {
    if (!player || player.dead) {
        return;
    }

    player.dead = true;
    const audio = getGameAudio();
    if (player.body) {
        player.body.stop();
    }

    if (audio && typeof audio.playPlayerDeath === 'function') {
        audio.playPlayerDeath();
    }

    playDeathAnimation(player);

    player.once('animationcomplete', () => {
        player.scene.tweens.add({
            targets: [player, player.healthBar],
            alpha: 0,
            duration: 500,
            onComplete: () => {

                // stop movement & disable physics simulation
                if (player.body) {
                    player.body.stop();
                    player.body.enable = false;
                }

                // hide and mark inactive so Phaser ignores it in updates
                player.setVisible(false);
                player.setActive(false);

                // optionally move it off-screen so nothing else collides with the sprite visually
                player.x = -9999;
                player.y = -9999;

                player.healthBar.destroy();
            }
        });
    });
}

function drawHealthBar(player) {

    if ( player.dead ) return;

    const sprite = player;
    const barWidth = 35;
    const barHeight = 3;
    const healthBar = player.healthBar;
    const healthPoints = player.healthPoints;
    // Use server-provided PLAYER_MAX_HP; fallback to 1 to avoid divide-by-zero
    const maxHp = (typeof PLAYER_MAX_HP === 'number' && PLAYER_MAX_HP > 0) ? PLAYER_MAX_HP : 1;

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


function update(time, delta) {
    if (!myId) return;

    const player = players[myId];
    // Guard against cases where players were cleaned up (e.g. returning to lobby)
    if (!player) {
        return;
    }
    const deltaSeconds = Math.min((delta || 16.6667) / 1000, 0.05);

    if (player.body) {
        player.body.setVelocity(0);
    }

    const currentInputState = player.dead ? { up: false, down: false, left: false, right: false } : getCurrentInputState();
    window.localInputState = currentInputState;
    sendCurrentInputState(currentInputState);

    if (player.dead == false) {
        const moving = applyMovementInput(player, currentInputState, deltaSeconds);
        playLocalAnimation(player, moving);
        reconcileLocalPlayer(player);
    }

    for (let id in players) 
    {
        // Not me:
        if (id === myId) continue;

        const enemy = players[id];
        if (!enemy) continue;

        if (window.NET_INTERP_ENABLED) {
            // compute render timestamp in server time
            const renderTs = Date.now() - (window.NET_INTERP_DELAY_MS || 120) - (window.serverTimeOffsetMs || 0);
            const applied = applyInterpolatedPosition(enemy, id, renderTs);
            if (!applied) {
                // nothing applied; keep existing sprite position
            }
            // drive animation from motion
            updateFacing(enemy);
            playCorrectAnimation(enemy);
        } else {
            // original behavior
            // updateFacing(enemy);
            playCorrectAnimation(enemy);
            enemy.prevX = enemy.x;
            enemy.prevY = enemy.y;
        }
    }

    // Arrow interpolation only (no client-side velocity)
    for (let ownerId in arrowList) {
        let arrow = arrowList[ownerId];
        if (!arrow) continue;
        if ((Date.now() - (arrow.lastServerTime || 0)) > ARROW_STALE_MS) {
            try { arrow.destroy(); } catch (e) {}
            delete arrowList[ownerId];
            continue;
        }
        const deltaSeconds = delta / 1000;
        arrow.x += (arrow.vx || 0) * deltaSeconds;
        arrow.y += (arrow.vy || 0) * deltaSeconds;
        arrow.x += (arrow.targetX - arrow.x) * 0.15;
        arrow.y += (arrow.targetY - arrow.y) * 0.15;
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

    let baseColor = 0xffffff;
    try {
        if (typeof colour === 'string') {
            baseColor = Phaser.Display.Color.HexStringToColor(colour).color;
        } else if (typeof colour === 'number') {
            baseColor = colour;
        }
    } catch (e) {
        baseColor = 0xffffff;
    }
    const lightColor = lightenColor(baseColor, 0.4);
    const healthBar = scene.add.graphics();

    // Apply tint
    players[id].setTint(lightColor);
    players[id].originalTint = lightColor;

    // Scale sprite
    const scale = 4;
    players[id].setScale(scale);

    players[id].body.setSize( 20, 20 );

    players[id].facing = 'down'; // default facing direction

    // Play default animation
    players[id].anims.play('idle-down', true);

    players[id].healthBar = healthBar;
    players[id].healthPoints = (typeof info.hp === 'number') ? info.hp : PLAYER_MAX_HP;
    players[id].scene = scene;
    players[id].dead = false;
    players[id].isPlayingHurt = false;
    players[id].isPlayingDeath = false;
    players[id].hurtAnimationResetEvent = null;

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
    // Initialize previous positions to avoid interpolation introducing movement on spawn
    players[id].prevX = players[id].x;
    players[id].prevY = players[id].y;
    // record last server-known position
    players[id].lastServerX = players[id].x;
    players[id].lastServerY = players[id].y;
    players[id].lastServerVx = Number(info.vx || 0);
    players[id].lastServerVy = Number(info.vy || 0);
    players[id].serverReconX = players[id].x;
    players[id].serverReconY = players[id].y;
    players[id].serverReconVx = Number(info.vx || 0);
    players[id].serverReconVy = Number(info.vy || 0);
}

// Interpolation helper: find interpolated position for a player at a given server-time
function getInterpolatedPosition(id, renderTs) {
    try {
        const buf = (window.serverSnapshots && window.serverSnapshots[id]) || null;
        if (!buf || buf.length === 0) return null;

        // ensure buffer is sorted by t
        // find two surrounding snapshots
        for (let i = 0; i < buf.length - 1; i++) {
            const a = buf[i];
            const b = buf[i+1];
            if (a.t <= renderTs && renderTs <= b.t) {
                const span = b.t - a.t || 1;
                const ratio = (renderTs - a.t) / span;
                return {
                    x: a.x + (b.x - a.x) * ratio,
                    y: a.y + (b.y - a.y) * ratio,
                    vx: (a.vx || 0) + ((b.vx || 0) - (a.vx || 0)) * ratio,
                    vy: (a.vy || 0) + ((b.vy || 0) - (a.vy || 0)) * ratio
                };
            }
        }

        // if renderTs is before first snapshot, return first
        if (renderTs <= buf[0].t) return { x: buf[0].x, y: buf[0].y, vx: buf[0].vx || 0, vy: buf[0].vy || 0 };

        // if after last, extrapolate briefly using last known velocity
        const last = buf[buf.length - 1];
        const previous = buf.length > 1 ? buf[buf.length - 2] : null;
        let vx = Number.isFinite(last.vx) ? last.vx : 0;
        let vy = Number.isFinite(last.vy) ? last.vy : 0;

        if ((!vx && !vy) && previous && last.t > previous.t) {
            const dtSeconds = (last.t - previous.t) / 1000;
            if (dtSeconds > 0) {
                vx = (last.x - previous.x) / dtSeconds;
                vy = (last.y - previous.y) / dtSeconds;
            }
        }

        const extraMs = Math.max(0, Math.min(renderTs - last.t, window.NET_EXTRAPOLATION_MAX_MS || REMOTE_EXTRAPOLATION_LIMIT_MS));
        const extraSeconds = extraMs / 1000;
        return {
            x: Phaser.Math.Clamp(last.x + vx * extraSeconds, WORLD_MARGIN, config.width - WORLD_MARGIN),
            y: Phaser.Math.Clamp(last.y + vy * extraSeconds, WORLD_MARGIN, config.height - WORLD_MARGIN),
            vx,
            vy,
            extrapolated: extraMs > 0
        };
    } catch (e) {
        return null;
    }
}

// Apply an interpolated position to a Phaser sprite safely.
function applyInterpolatedPosition(sprite, playerId, renderTs) {
    try {
        const ipos = getInterpolatedPosition(playerId, renderTs);
        if (ipos && Number.isFinite(ipos.x) && Number.isFinite(ipos.y)) {
            sprite.prevX = sprite.x;
            sprite.prevY = sprite.y;
            sprite.x = ipos.x;
            sprite.y = ipos.y;
            sprite.netVx = ipos.vx || 0;
            sprite.netVy = ipos.vy || 0;
            return true;
        }

        // fallback to last snapshot in buffer
        const buf = (window.serverSnapshots && window.serverSnapshots[playerId]) || [];
        if (buf.length) {
            const last = buf[buf.length - 1];
            sprite.prevX = sprite.x;
            sprite.prevY = sprite.y;
            sprite.x = Number(last.x || sprite.x || 0);
            sprite.y = Number(last.y || sprite.y || 0);
            sprite.netVx = Number(last.vx || 0);
            sprite.netVy = Number(last.vy || 0);
            return true;
        }

        // nothing to do; leave sprite where it is
        return false;
    } catch (e) {
        console.warn('applyInterpolatedPosition error', e);
        return false;
    }
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
