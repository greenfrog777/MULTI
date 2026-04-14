(function () {
    function createNoopAudio() {
        return {
            unlock() {},
            playArrowFire() {},
            playArrowHitObstacle() {},
            playArrowHitPlayer() {}
        };
    }

    function createGameAudio() {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return createNoopAudio();

        const context = new AudioCtor();
        const masterGain = context.createGain();
        masterGain.gain.value = 0.16;
        masterGain.connect(context.destination);

        let unlocked = context.state === 'running';

        function scheduleEnvelope(gainNode, startTime, attackSeconds, decaySeconds, peakGain, sustainGain) {
            gainNode.gain.cancelScheduledValues(startTime);
            gainNode.gain.setValueAtTime(0.0001, startTime);
            gainNode.gain.linearRampToValueAtTime(peakGain, startTime + attackSeconds);
            gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustainGain), startTime + attackSeconds + decaySeconds);
        }

        function createTone(options) {
            const now = context.currentTime;
            const oscillator = context.createOscillator();
            const gainNode = context.createGain();
            const filter = context.createBiquadFilter();

            oscillator.type = options.wave || 'sine';
            oscillator.frequency.setValueAtTime(options.startFrequency, now);
            if (typeof options.endFrequency === 'number') {
                oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, now + options.duration);
            }

            filter.type = options.filterType || 'lowpass';
            filter.frequency.setValueAtTime(options.filterFrequency || 2400, now);
            if (typeof options.filterQ === 'number') {
                filter.Q.setValueAtTime(options.filterQ, now);
            }

            scheduleEnvelope(
                gainNode,
                now,
                options.attack || 0.005,
                options.decay || Math.max(0.01, options.duration - 0.005),
                options.peakGain || 0.4,
                options.endGain || 0.0001
            );

            oscillator.connect(filter);
            filter.connect(gainNode);
            gainNode.connect(masterGain);
            oscillator.start(now);
            oscillator.stop(now + options.duration + 0.03);
        }

        function createNoiseBurst(options) {
            const now = context.currentTime;
            const duration = options.duration || 0.08;
            const sampleCount = Math.max(1, Math.floor(context.sampleRate * duration));
            const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
            const channel = buffer.getChannelData(0);

            for (let i = 0; i < sampleCount; i += 1) {
                channel[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
            }

            const source = context.createBufferSource();
            const filter = context.createBiquadFilter();
            const gainNode = context.createGain();

            source.buffer = buffer;
            filter.type = options.filterType || 'bandpass';
            filter.frequency.setValueAtTime(options.filterFrequency || 1200, now);
            if (typeof options.filterQ === 'number') {
                filter.Q.setValueAtTime(options.filterQ, now);
            }

            scheduleEnvelope(
                gainNode,
                now,
                options.attack || 0.001,
                options.decay || Math.max(0.01, duration - 0.001),
                options.peakGain || 0.2,
                options.endGain || 0.0001
            );

            source.connect(filter);
            filter.connect(gainNode);
            gainNode.connect(masterGain);
            source.start(now);
            source.stop(now + duration + 0.02);
        }

        function unlock() {
            if (context.state === 'running') {
                unlocked = true;
                return;
            }

            context.resume().then(() => {
                unlocked = context.state === 'running';
            }).catch(() => {
                unlocked = false;
            });
        }

        function withUnlockedAudio(fn) {
            if (!unlocked && context.state !== 'running') {
                unlock();
                if (context.state !== 'running') return;
            }

            unlocked = true;
            fn();
        }

        function installUnlockListeners() {
            const unlockOnce = () => {
                unlock();
                if (context.state === 'running') {
                    window.removeEventListener('pointerdown', unlockOnce);
                    window.removeEventListener('keydown', unlockOnce);
                    window.removeEventListener('touchstart', unlockOnce);
                }
            };

            window.addEventListener('pointerdown', unlockOnce, { passive: true });
            window.addEventListener('keydown', unlockOnce, { passive: true });
            window.addEventListener('touchstart', unlockOnce, { passive: true });
        }

        installUnlockListeners();

        return {
            unlock,
            playArrowFire() {
                withUnlockedAudio(() => {
                    createTone({
                        wave: 'triangle',
                        startFrequency: 920,
                        endFrequency: 420,
                        duration: 0.09,
                        attack: 0.003,
                        decay: 0.08,
                        peakGain: 0.12,
                        filterType: 'lowpass',
                        filterFrequency: 2600
                    });
                    createNoiseBurst({
                        duration: 0.04,
                        peakGain: 0.03,
                        filterType: 'highpass',
                        filterFrequency: 1800,
                        filterQ: 0.7
                    });
                });
            },
            playArrowHitObstacle() {
                withUnlockedAudio(() => {
                    createNoiseBurst({
                        duration: 0.08,
                        peakGain: 0.08,
                        filterType: 'bandpass',
                        filterFrequency: 1400,
                        filterQ: 1.4
                    });
                    createTone({
                        wave: 'square',
                        startFrequency: 340,
                        endFrequency: 140,
                        duration: 0.07,
                        attack: 0.001,
                        decay: 0.06,
                        peakGain: 0.05,
                        filterType: 'lowpass',
                        filterFrequency: 900
                    });
                });
            },
            playArrowHitPlayer() {
                withUnlockedAudio(() => {
                    createTone({
                        wave: 'sawtooth',
                        startFrequency: 220,
                        endFrequency: 96,
                        duration: 0.12,
                        attack: 0.002,
                        decay: 0.1,
                        peakGain: 0.1,
                        filterType: 'lowpass',
                        filterFrequency: 1100
                    });
                    createNoiseBurst({
                        duration: 0.05,
                        peakGain: 0.04,
                        filterType: 'bandpass',
                        filterFrequency: 700,
                        filterQ: 0.9
                    });
                });
            }
        };
    }

    window.GameAudio = createGameAudio();
}());