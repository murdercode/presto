// WebRTC Connection Detection System
// Detects call state by checking for active WebRTC connections

export class MeetingDetector {
    constructor() {
        this.isInMeeting = false;
        this.callbacks = [];
        this.checkInterval = null;
        this.checkFrequency = 3000; // Check every 3 seconds
        console.log('🎥 WebRTC connection detection initialized');
        this.init();
    }
    
    async init() {
        // Start monitoring WebRTC connections
        this.startPeriodicCheck();
        console.log('🎥 Started monitoring WebRTC connections');
    }
    
    // Check for active WebRTC connections
    async checkWebRTCConnections() {
        try {
            if (!window.__TAURI__ || !window.__TAURI__.core) {
                console.log('🎥 [DEBUG] Tauri API not available');
                return false;
            }
            
            const { invoke } = window.__TAURI__.core;
            
            // Use our new Tauri command to check WebRTC connections
            const webrtcActive = await invoke('check_webrtc_connections');
            
            console.log('🎥 [DEBUG] WebRTC connections check result:', webrtcActive);
            
            return webrtcActive;
            
        } catch (error) {
            console.log('🎥 [DEBUG] WebRTC connections check failed:', error);
            return false;
        }
    }
    
    // Main meeting state check
    async checkMeetingState() {
        const wasInMeeting = this.isInMeeting;
        
        try {
            const webrtcActive = await this.checkWebRTCConnections();
            this.isInMeeting = webrtcActive;
            
            // Trigger callbacks if state changed
            if (this.isInMeeting !== wasInMeeting) {
                if (this.isInMeeting) {
                    console.log('🎥 CALL DETECTED - WebRTC connections active');
                } else {
                    console.log('🎥 CALL ENDED - No WebRTC connections');
                }
                
                this.triggerCallbacks(this.isInMeeting, wasInMeeting);
            }
        } catch (error) {
            console.log('🎥 Meeting state check failed:', error);
        }
        
        return this.isInMeeting;
    }
    
    // Start periodic monitoring
    startPeriodicCheck() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
        
        this.checkInterval = setInterval(() => {
            this.checkMeetingState();
        }, this.checkFrequency);
        
        console.log('🎥 Periodic WebRTC connection check started (every', this.checkFrequency, 'ms)');
    }
    
    // Stop detection
    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        console.log('🎥 WebRTC connection monitoring stopped');
    }
    
    // Add callback for meeting state changes
    onMeetingStateChange(callback) {
        if (typeof callback === 'function') {
            this.callbacks.push(callback);
        }
    }
    
    // Remove callback
    removeMeetingStateChangeCallback(callback) {
        const index = this.callbacks.indexOf(callback);
        if (index > -1) {
            this.callbacks.splice(index, 1);
        }
    }
    
    // Trigger all callbacks
    triggerCallbacks(isInMeeting, wasInMeeting) {
        this.callbacks.forEach(callback => {
            try {
                callback(isInMeeting, wasInMeeting);
            } catch (error) {
                console.error('🎥 Error in meeting state callback:', error);
            }
        });
    }
    
    // Public methods
    getIsInMeeting() {
        return this.isInMeeting;
    }
    
    // Manual meeting state control (for testing)
    setMeetingState(isInMeeting) {
        const wasInMeeting = this.isInMeeting;
        this.isInMeeting = isInMeeting;
        console.log('🎥 [MANUAL] Meeting state set to:', isInMeeting);
        this.triggerCallbacks(this.isInMeeting, wasInMeeting);
        return this.isInMeeting;
    }
    
    // Manual toggle for testing
    toggleMeetingStateForTesting() {
        const wasInMeeting = this.isInMeeting;
        this.isInMeeting = !this.isInMeeting;
        console.log('🎥 [MANUAL] Toggled meeting state to:', this.isInMeeting);
        this.triggerCallbacks(this.isInMeeting, wasInMeeting);
        return this.isInMeeting;
    }
    
    // Force a manual check
    forceCheck() {
        return this.checkMeetingState();
    }
    
    // Force immediate comprehensive check
    async forceFullCheck() {
        console.log('🎥 [DEBUG] Forcing WebRTC connection check...');
        return await this.checkMeetingState();
    }
    
    // Legacy methods for compatibility
    setDebugMode(enabled) {
        console.log('🎥 Debug mode', enabled ? 'enabled' : 'disabled', '(WebRTC mode)');
    }
    
    getDebugStatus() {
        return {
            isInMeeting: this.isInMeeting,
            mode: 'webrtc_connections',
            lastCheck: new Date().toISOString()
        };
    }
}