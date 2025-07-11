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
     * Cleanup audio manager
     */
    cleanup() {
        this.stopClockTicking();
        
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