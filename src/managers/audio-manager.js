/**
 * AudioManager - Manages sound playback for the Presto timer
 * Handles ticking clock sounds and other audio notifications
 */

export class AudioManager {
    constructor() {
        this.audioContext = null;
        this.clockTickInterval = null;
        this.isClockTicking = false;
        this.volume = 0.5;
        this.clockTickEnabled = false;
        this.clockTickSound = 'standard'; // 'standard', 'tetris', or 'none'

        // Background noise properties
        this.backgroundNoiseEnabled = false;
        this.backgroundNoiseType = 'none'; // 'none', 'rain', 'fire', 'library', 'wind', 'storm', 'whitenoise'
        this.backgroundNoiseVolume = 0.5;
        this.backgroundNoiseAudio = null;
        this.isLoadingBackgroundNoise = false; // Prevent concurrent loading

        // Audio elements for preloaded sounds
        this.audioElements = {};

        // Tetris theme note sequence (simplified)
        this.tetrisNotes = [
            523.25, // C5
            392.00, // G4
            415.30, // G#4
            466.16, // A#4
            415.30, // G#4
            392.00, // G4
            349.23, // F4
            349.23, // F4
            415.30, // G#4
            523.25, // C5
            466.16, // A#4
            415.30, // G#4
            392.00, // G4
            392.00, // G4
            415.30, // G#4
            466.16, // A#4
            523.25  // C5
        ];
        this.tetrisNoteIndex = 0;

        // Initialize audio context
        this.initializeAudioContext();
    }

    /**
     * Initialize Web Audio API context
     */
    initializeAudioContext() {
        try {
            // Create audio context (with fallback for older browsers)
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Resume audio context if suspended (required by some browsers)
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
        } catch (error) {
            console.warn('Web Audio API not supported:', error);
            this.audioContext = null;
        }
    }


    /**
     * Generate a tick sound using Web Audio API
     */
    generateTickSound() {
        if (!this.audioContext) return;

        switch (this.clockTickSound) {
            case 'tetris':
                this.generateTetrisTickSound();
                break;
            case 'standard':
            default:
                this.generateStandardTickSound();
                break;
        }
    }

    /**
     * Generate the standard tick sound
     */
    generateStandardTickSound() {
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        // Connect oscillator to gain node to speakers
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        // Configure the tick sound with lower frequency
        oscillator.frequency.setValueAtTime(400, this.audioContext.currentTime);
        oscillator.type = 'square';

        // Configure volume envelope for a sharp tick
        gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(this.volume * 0.3, this.audioContext.currentTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);

        // Play the tick sound
        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + 0.1);
    }

    /**
     * Generate a Tetris-themed tick sound
     */
    generateTetrisTickSound() {
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        // Connect oscillator to gain node to speakers
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        // Get the current note from the Tetris sequence
        const frequency = this.tetrisNotes[this.tetrisNoteIndex];
        this.tetrisNoteIndex = (this.tetrisNoteIndex + 1) % this.tetrisNotes.length;

        // Configure the sound with Tetris-like characteristics
        oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        oscillator.type = 'square'; // Retro 8-bit sound

        // Configure volume envelope for a musical note
        gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(this.volume * 0.2, this.audioContext.currentTime + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.25);

        // Play the note
        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + 0.25);
    }

    /**
     * Start the clock ticking sound
     */
    startClockTicking() {
        if (this.isClockTicking || !this.clockTickEnabled) return;

        console.log('🔊 Starting clock ticking...');
        this.isClockTicking = true;

        // Generate immediate tick
        this.generateTickSound();

        // Set up interval for continuous ticking (every 1 second)
        this.clockTickInterval = setInterval(() => {
            if (this.clockTickEnabled) {
                this.generateTickSound();
            }
        }, 1000);
    }

    /**
     * Stop the clock ticking sound
     */
    stopClockTicking() {
        if (!this.isClockTicking) return;

        console.log('🔇 Stopping clock ticking...');
        this.isClockTicking = false;

        if (this.clockTickInterval) {
            clearInterval(this.clockTickInterval);
            this.clockTickInterval = null;
        }
    }

    /**
     * Enable or disable clock ticking
     */
    setClockTickEnabled(enabled) {
        this.clockTickEnabled = enabled;

        if (!enabled && this.isClockTicking) {
            this.stopClockTicking();
        }
    }

    /**
     * Set the clock tick sound type
     * @param {string} soundType - The sound type ('standard', 'tetris', 'none')
     */
    setClockTickSound(soundType) {
        this.clockTickSound = soundType;

        // Reset Tetris note index when switching to Tetris theme
        if (soundType === 'tetris') {
            this.tetrisNoteIndex = 0;
        }
    }

    /**
     * Set volume for all audio (0.0 to 1.0)
     */
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        console.log(`🔊 Audio volume set to: ${Math.round(this.volume * 100)}%`);
    }

    /**
     * Get current volume
     */
    getVolume() {
        return this.volume;
    }

    /**
     * Check if clock ticking is enabled
     */
    isClockTickingEnabled() {
        return this.clockTickEnabled;
    }

    /**
     * Check if clock is currently ticking
     */
    isCurrentlyTicking() {
        return this.isClockTicking;
    }

    /**
     * Play a one-time notification sound
     */
    playNotificationSound() {
        if (!this.audioContext) return;

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        // Configure notification sound (different from tick)
        oscillator.frequency.setValueAtTime(600, this.audioContext.currentTime);
        oscillator.frequency.setValueAtTime(900, this.audioContext.currentTime + 0.1);
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(this.volume * 0.5, this.audioContext.currentTime + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);

        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + 0.3);
    }

    /**
     * Resume audio context if suspended (call this on user interaction)
     */
    resumeAudioContext() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    /**
     * Create audio path for a noise type
     */
    getAudioPath(noiseType) {
        const extension = noiseType === 'whitenoise' ? 'wav' : 'mp3';
        return `/assets/audio/backgrounds/${noiseType}.${extension}`;
    }

    /**
     * Load audio with single path
     */
    async loadAudio(noiseType) {
        const audioPath = this.getAudioPath(noiseType);
        console.log(`🎵 Loading audio: ${audioPath}`);

        return new Promise((resolve, reject) => {
            const audio = new Audio(audioPath);
            audio.loop = true;
            audio.volume = this.backgroundNoiseVolume;

            audio.addEventListener('canplaythrough', () => {
                console.log(`✅ Audio loaded successfully: ${audioPath}`);
                resolve(audio);
            });

            audio.addEventListener('error', (e) => {
                console.error(`❌ Failed to load ${audioPath}:`, e.target.error);
                reject(new Error(`Could not load ${noiseType} audio file`));
            });

            // Trigger loading
            audio.load();
        });
    }

    /**
     * Start background noise - ATOMIC operation
     */
    async startBackgroundNoise() {
        console.log(`🌊 startBackgroundNoise called - type: "${this.backgroundNoiseType}", enabled: ${this.backgroundNoiseEnabled}, loading: ${this.isLoadingBackgroundNoise}`);

        // Check if we should stop
        if (this.backgroundNoiseType === 'none' || !this.backgroundNoiseEnabled) {
            console.log(`🌊 Stopping background noise (type: none or disabled)`);
            this.stopBackgroundNoise();
            return;
        }

        // Prevent concurrent calls
        if (this.isLoadingBackgroundNoise) {
            console.log(`🌊 Already loading background noise, skipping...`);
            return;
        }

        this.isLoadingBackgroundNoise = true;

        try {
            // Always stop current audio first
            this.stopBackgroundNoise();

            console.log(`🌊 Loading background noise: ${this.backgroundNoiseType}`);
            const newAudio = await this.loadAudio(this.backgroundNoiseType);
            
            // Check if we were cancelled during loading
            if (!this.backgroundNoiseEnabled || this.backgroundNoiseType === 'none') {
                console.log(`🌊 Background noise was disabled during loading, aborting`);
                newAudio.pause();
                newAudio.src = '';
                return;
            }

            // Set the new audio as active
            this.backgroundNoiseAudio = newAudio;

            // Start playing
            await this.backgroundNoiseAudio.play();
            console.log(`🌊 Successfully started background noise: ${this.backgroundNoiseType}`);

        } catch (error) {
            console.error(`❌ Failed to start background noise ${this.backgroundNoiseType}:`, error);
            if (window.NotificationUtils) {
                window.NotificationUtils.showNotificationPing(
                    `❌ ${this.backgroundNoiseType} file not found`,
                    'error'
                );
            }
        } finally {
            this.isLoadingBackgroundNoise = false;
        }
    }

    /**
     * Stop background noise - IMMEDIATE operation
     */
    stopBackgroundNoise() {
        if (this.backgroundNoiseAudio) {
            console.log('🔇 Stopping background noise...');

            // Stop the audio completely
            this.backgroundNoiseAudio.pause();
            this.backgroundNoiseAudio.currentTime = 0;

            // Remove the source to fully stop it
            this.backgroundNoiseAudio.src = '';
            this.backgroundNoiseAudio.load(); // This clears the audio completely

            // Clear the reference
            this.backgroundNoiseAudio = null;
            console.log('🔇 Background noise stopped and cleaned up');
        }
        
        // Reset loading flag to allow new operations
        this.isLoadingBackgroundNoise = false;
    }

    /**
     * Set background noise type
     * @param {string} noiseType - The noise type ('none', 'rain', 'fire', 'library', 'wind', 'storm', 'whitenoise')
     */
    setBackgroundNoiseType(noiseType) {
        console.log(`🔄 Changing background noise from "${this.backgroundNoiseType}" to "${noiseType}" (loading: ${this.isLoadingBackgroundNoise})`);

        // If same type, skip entirely
        if (this.backgroundNoiseType === noiseType) {
            console.log(`🔄 Same type "${noiseType}", skipping...`);
            return;
        }

        // If currently loading, skip to prevent multiple loads
        if (this.isLoadingBackgroundNoise) {
            console.log(`🔄 Already loading, skipping change to "${noiseType}"`);
            return;
        }

        const wasPlaying = this.backgroundNoiseAudio && !this.backgroundNoiseAudio.paused;
        
        // Always stop current audio immediately
        this.stopBackgroundNoise();

        // Update the type and enabled state
        this.backgroundNoiseType = noiseType;
        this.backgroundNoiseEnabled = noiseType !== 'none';

        // If it was playing or we're enabling a new type, start the audio
        if ((wasPlaying || this.backgroundNoiseEnabled) && noiseType !== 'none') {
            console.log(`🔄 Starting background noise: ${noiseType}`);
            this.startBackgroundNoise();
        }
    }

    /**
     * Enable or disable background noise
     */
    setBackgroundNoiseEnabled(enabled) {
        console.log(`🔄 setBackgroundNoiseEnabled called with: ${enabled} (current: ${this.backgroundNoiseEnabled})`);
        this.backgroundNoiseEnabled = enabled;
        if (enabled) {
            console.log(`🔄 Background noise enabled, starting audio`);
            this.startBackgroundNoise();
        } else {
            console.log(`🔄 Background noise disabled, stopping audio`);
            this.stopBackgroundNoise();
        }
    }

    /**
     * Set background noise volume (0.0 to 1.0)
     */
    setBackgroundNoiseVolume(volume) {
        this.backgroundNoiseVolume = Math.max(0, Math.min(1, volume));
        if (this.backgroundNoiseAudio) {
            this.backgroundNoiseAudio.volume = this.backgroundNoiseVolume;
        }
        console.log(`🌊 Background noise volume set to: ${Math.round(this.backgroundNoiseVolume * 100)}%`);
    }

    /**
     * Get current background noise volume
     */
    getBackgroundNoiseVolume() {
        return this.backgroundNoiseVolume;
    }

    /**
     * Get current background noise type
     */
    getBackgroundNoiseType() {
        return this.backgroundNoiseType;
    }

    /**
     * Check if background noise is enabled
     */
    isBackgroundNoiseEnabled() {
        return this.backgroundNoiseEnabled;
    }

    /**
     * Test background noise (play for 3 seconds)
     */
    async testBackgroundNoise(noiseType = null) {
        const typeToTest = noiseType || this.backgroundNoiseType;
        if (typeToTest === 'none') return;

        try {
            console.log(`🧪 Testing background noise: ${typeToTest}`);
            const testAudio = await this.loadAudio(typeToTest);

            testAudio.play().catch(error => {
                console.error('❌ Could not test background noise:', error);
                if (window.NotificationUtils) {
                    window.NotificationUtils.showNotificationPing(
                        `❌ Audio test failed: ${error.name}`,
                        'error'
                    );
                }
            });

            // Stop after 3 seconds
            setTimeout(() => {
                testAudio.pause();
                testAudio.currentTime = 0;
                testAudio.src = '';
            }, 3000);

            console.log(`🎵 Testing background noise: ${typeToTest}`);

        } catch (error) {
            console.error(`❌ Failed to test background noise ${typeToTest}:`, error);
            if (window.NotificationUtils) {
                window.NotificationUtils.showNotificationPing(
                    `❌ ${typeToTest} file not found - check backgrounds folder`,
                    'error'
                );
            }
        }
    }

    /**
     * Cleanup audio manager
     */
    cleanup() {
        this.stopClockTicking();
        this.stopBackgroundNoise();

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        // Clean up audio elements
        Object.values(this.audioElements).forEach(audio => {
            if (audio.src) {
                audio.src = '';
            }
        });
        this.audioElements = {};
    }
}

// Create and export singleton instance
export const audioManager = new AudioManager();