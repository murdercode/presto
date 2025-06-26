// Meeting Detection System
// Rilevamento preciso di quando l'utente è in una call o meeting

export class MeetingDetector {
    constructor() {
        this.isInMeeting = false;
        this.lastMeetingState = false;
        this.checkInterval = null;
        this.checkFrequency = 2000; // Check every 2 seconds
        this.callbacks = [];
        
        // Meeting detection methods state
        this.detectionMethods = {
            webrtc: false,
            mediaDevices: false,
            screenShare: false,
            processDetection: false,
            audioLevels: false,
            audioDeviceMonitoring: false
        };
        
        // Active media streams
        this.activeStreams = new Set();
        this.peerConnections = new Set();
        
        // Audio context for voice detection
        this.audioContext = null;
        this.audioAnalyser = null;
        this.audioDataArray = null;
        
        // Audio device monitoring
        this.audioDeviceCheckInterval = null;
        this.audioDeviceCheckFrequency = 1000; // Check every 1 second
        this.lastAudioDevices = null;
        this.audioActivityDetected = false;
        this.audioActivityThreshold = 3; // Consecutive checks to confirm meeting
        
        // Process detection
        this.processCheckInterval = null;
        this.processActivityDetected = false;
        
        // Common meeting application processes (for future process detection)
        this.meetingProcesses = [
            'zoom.exe', 'zoom', 'ZoomOpener.exe',
            'Teams.exe', 'ms-teams', 'Microsoft Teams',
            'chrome.exe', 'chrome', // For web-based meetings
            'firefox.exe', 'firefox',
            'Skype.exe', 'skype',
            'Discord.exe', 'discord',
            'slack.exe', 'slack',
            'WebexHost.exe', 'webex',
            'gotomeeting.exe',
            'BlueJeans.exe'
        ];
        
        this.init();
    }
    
    async init() {
        console.log('🎥 Initializing MeetingDetector...');
        
        // Initialize detection methods
        await this.initializeWebRTCDetection();
        await this.initializeMediaDevicesDetection();
        await this.initializeScreenShareDetection();
        await this.initializeAudioLevelDetection();
        await this.initializeAudioDeviceMonitoring();
        
        // Start periodic checking
        this.startPeriodicCheck();
        
        const availableMethods = Object.entries(this.detectionMethods)
            .filter(([key, value]) => value)
            .map(([key]) => key);
        
        console.log('🎥 MeetingDetector initialized successfully');
        console.log('🎥 Available detection methods:', availableMethods.length > 0 ? availableMethods : 'WebRTC only');
        
        if (availableMethods.length === 0) {
            console.log('🎥 Note: Media APIs not available in Tauri - will rely on WebRTC detection for browser-based meetings');
        }
    }
    
    // WebRTC PeerConnection detection
    async initializeWebRTCDetection() {
        try {
            // Override RTCPeerConnection constructor to track connections
            const originalRTCPeerConnection = window.RTCPeerConnection;
            const self = this;
            
            window.RTCPeerConnection = function(...args) {
                const pc = new originalRTCPeerConnection(...args);
                
                // Track this peer connection
                self.peerConnections.add(pc);
                console.log('🎥 WebRTC: New PeerConnection created, total:', self.peerConnections.size);
                
                // Listen for connection state changes
                pc.addEventListener('connectionstatechange', () => {
                    console.log('🎥 WebRTC: Connection state changed:', pc.connectionState);
                    if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
                        self.peerConnections.delete(pc);
                        console.log('🎥 WebRTC: PeerConnection removed, total:', self.peerConnections.size);
                    }
                    self.checkMeetingState();
                });
                
                pc.addEventListener('iceconnectionstatechange', () => {
                    console.log('🎥 WebRTC: ICE connection state changed:', pc.iceConnectionState);
                    self.checkMeetingState();
                });
                
                return pc;
            };
            
            // Copy static methods and properties
            Object.setPrototypeOf(window.RTCPeerConnection, originalRTCPeerConnection);
            Object.defineProperty(window.RTCPeerConnection, 'prototype', {
                value: originalRTCPeerConnection.prototype
            });
            
            this.detectionMethods.webrtc = true;
            console.log('🎥 WebRTC detection initialized');
            
        } catch (error) {
            console.warn('🎥 WebRTC detection failed to initialize:', error);
            this.detectionMethods.webrtc = false;
        }
    }
    
    // Media Devices API detection
    async initializeMediaDevicesDetection() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                console.log('🎥 Media Devices API not available in this environment (expected in Tauri)');
                this.detectionMethods.mediaDevices = false;
                return;
            }
            
            // Override getUserMedia to track media streams
            const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
            const self = this;
            
            navigator.mediaDevices.getUserMedia = async function(constraints) {
                console.log('🎥 Media: getUserMedia called with constraints:', constraints);
                
                try {
                    const stream = await originalGetUserMedia.call(this, constraints);
                    
                    // Track this stream
                    self.activeStreams.add(stream);
                    console.log('🎥 Media: New stream obtained, total active:', self.activeStreams.size);
                    
                    // Listen for stream end
                    stream.getTracks().forEach(track => {
                        track.addEventListener('ended', () => {
                            console.log('🎥 Media: Track ended:', track.kind);
                            self.activeStreams.delete(stream);
                            console.log('🎥 Media: Stream removed, total active:', self.activeStreams.size);
                            self.checkMeetingState();
                        });
                    });
                    
                    self.checkMeetingState();
                    return stream;
                    
                } catch (error) {
                    console.log('🎥 Media: getUserMedia failed:', error);
                    throw error;
                }
            };
            
            this.detectionMethods.mediaDevices = true;
            console.log('🎥 Media Devices detection initialized');
            
        } catch (error) {
            console.log('🎥 Media Devices detection not available:', error.message);
            this.detectionMethods.mediaDevices = false;
        }
    }
    
    // Screen Share detection
    async initializeScreenShareDetection() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                console.log('🎥 Screen Share API not available in this environment (expected in Tauri)');
                this.detectionMethods.screenShare = false;
                return;
            }
            
            // Override getDisplayMedia to track screen sharing
            const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia;
            const self = this;
            
            navigator.mediaDevices.getDisplayMedia = async function(constraints) {
                console.log('🎥 Screen: getDisplayMedia called with constraints:', constraints);
                
                try {
                    const stream = await originalGetDisplayMedia.call(this, constraints);
                    
                    // Track screen share stream
                    self.activeStreams.add(stream);
                    console.log('🎥 Screen: Screen sharing started, total streams:', self.activeStreams.size);
                    
                    // Listen for screen share end
                    stream.getTracks().forEach(track => {
                        track.addEventListener('ended', () => {
                            console.log('🎥 Screen: Screen sharing ended');
                            self.activeStreams.delete(stream);
                            console.log('🎥 Screen: Stream removed, total active:', self.activeStreams.size);
                            self.checkMeetingState();
                        });
                    });
                    
                    self.checkMeetingState();
                    return stream;
                    
                } catch (error) {
                    console.log('🎥 Screen: getDisplayMedia failed:', error);
                    throw error;
                }
            };
            
            this.detectionMethods.screenShare = true;
            console.log('🎥 Screen Share detection initialized');
            
        } catch (error) {
            console.log('🎥 Screen Share detection not available:', error.message);
            this.detectionMethods.screenShare = false;
        }
    }
    
    // Audio level detection for voice activity
    async initializeAudioLevelDetection() {
        try {
            // Initialize audio context for voice detection
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.audioAnalyser = this.audioContext.createAnalyser();
            this.audioAnalyser.fftSize = 256;
            this.audioDataArray = new Uint8Array(this.audioAnalyser.frequencyBinCount);
            
            this.detectionMethods.audioLevels = true;
            console.log('🎥 Audio level detection initialized');
            
        } catch (error) {
            console.log('🎥 Audio level detection not available:', error.message);
            this.detectionMethods.audioLevels = false;
        }
    }
    
    // Audio Device Monitoring - monitors system audio devices usage
    async initializeAudioDeviceMonitoring() {
        try {
            // In Tauri, try alternative detection methods
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
                console.log('🎥 Audio Device Monitoring: enumerateDevices not available, trying alternative detection');
                
                // Try process detection for Tauri environment
                await this.initializeProcessDetection();
                
                this.detectionMethods.audioDeviceMonitoring = false;
                return;
            }
            
            // Start monitoring audio device changes and usage
            this.startAudioDeviceMonitoring();
            
            this.detectionMethods.audioDeviceMonitoring = true;
            console.log('🎥 Audio Device Monitoring initialized');
            
        } catch (error) {
            console.log('🎥 Audio Device Monitoring not available:', error.message);
            this.detectionMethods.audioDeviceMonitoring = false;
        }
    }
    
    async startAudioDeviceMonitoring() {
        if (this.audioDeviceCheckInterval) {
            clearInterval(this.audioDeviceCheckInterval);
        }
        
        // Get initial device list
        try {
            this.lastAudioDevices = await navigator.mediaDevices.enumerateDevices();
            console.log('🎥 Audio: Initial device count:', this.lastAudioDevices.length);
        } catch (error) {
            console.log('🎥 Audio: Failed to get initial devices:', error.message);
            return;
        }
        
        // Start periodic checking of audio device usage
        this.audioDeviceCheckInterval = setInterval(async () => {
            await this.checkAudioDeviceActivity();
        }, this.audioDeviceCheckFrequency);
        
        console.log('🎥 Audio Device Monitoring started (checking every', this.audioDeviceCheckFrequency, 'ms)');
    }
    
    async checkAudioDeviceActivity() {
        try {
            // Try to access audio stream to check if devices are in use
            const constraints = { 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }, 
                video: false 
            };
            
            // Attempt to get user media - if successful, likely in a call
            try {
                const stream = await navigator.mediaDevices.getUserMedia(constraints);
                
                // Check audio levels to confirm active usage
                if (this.audioContext && this.audioContext.state !== 'closed') {
                    const source = this.audioContext.createMediaStreamSource(stream);
                    source.connect(this.audioAnalyser);
                    
                    this.audioAnalyser.getByteFrequencyData(this.audioDataArray);
                    const averageVolume = this.audioDataArray.reduce((sum, value) => sum + value, 0) / this.audioDataArray.length;
                    
                    // If we detect significant audio activity
                    if (averageVolume > 10) {
                        this.audioActivityDetected = true;
                        console.log('🎥 Audio: Activity detected (volume:', Math.round(averageVolume), ')');
                        this.checkMeetingState();
                    } else {
                        this.audioActivityDetected = false;
                    }
                    
                    source.disconnect();
                }
                
                // Clean up stream immediately
                stream.getTracks().forEach(track => {
                    track.stop();
                });
                
            } catch (streamError) {
                // If we can't get audio stream, device might be in use by another app
                if (streamError.name === 'NotReadableError' || 
                    streamError.name === 'AbortError' ||
                    streamError.message.includes('in use')) {
                    
                    this.audioActivityDetected = true;
                    console.log('🎥 Audio: Device busy (likely in use by meeting app)');
                    this.checkMeetingState();
                } else {
                    this.audioActivityDetected = false;
                }
            }
            
        } catch (error) {
            // Permissions denied or other issues
            this.audioActivityDetected = false;
            console.log('🎥 Audio: Check failed:', error.message);
        }
    }
    
    // Process Detection - specifically for Tauri environment to detect desktop apps
    async initializeProcessDetection() {
        try {
            console.log('🎥 Initializing Process Detection for meeting apps...');
            
            // Start periodic process checking
            this.processCheckInterval = setInterval(async () => {
                await this.checkRunningProcesses();
            }, 3000); // Check every 3 seconds
            
            this.detectionMethods.processDetection = true;
            console.log('🎥 Process Detection initialized - checking for:', this.meetingProcesses.slice(0, 5), '...');
            
        } catch (error) {
            console.log('🎥 Process Detection failed to initialize:', error.message);
            this.detectionMethods.processDetection = false;
        }
    }
    
    async checkRunningProcesses() {
        try {
            // Try to use Tauri's shell command to check running processes
            if (window.__TAURI__ && window.__TAURI__.core) {
                const { invoke } = window.__TAURI__.core;
                
                // Check for Discord and other meeting apps using Tauri shell
                const hasMeetingApp = await this.checkMeetingProcessesViaTauri(invoke);
                
                if (hasMeetingApp !== this.processActivityDetected) {
                    this.processActivityDetected = hasMeetingApp;
                    console.log('🎥 Process: Meeting app detection changed to:', hasMeetingApp);
                    this.checkMeetingState();
                }
            }
        } catch (error) {
            console.log('🎥 Process check failed:', error.message);
            this.processActivityDetected = false;
        }
    }
    
    async checkMeetingProcessesViaTauri(invoke) {
        try {
            console.log('🎥 [DEBUG] Checking camera/microphone and bandwidth usage via Tauri...');
            
            // Check 1: Camera/Microphone usage (most reliable indicator)
            const hasCameraMic = await invoke('check_camera_microphone_usage');
            console.log('🎥 [DEBUG] Camera/microphone usage detected:', hasCameraMic);
            
            if (hasCameraMic) {
                console.log('🎥 [DEBUG] Active camera/microphone usage detected - in meeting/call');
                return true;
            }
            
            // Check 2: High bandwidth connections (secondary check)
            const hasHighBandwidth = await invoke('check_high_bandwidth_connections');
            console.log('🎥 [DEBUG] High bandwidth meeting connections detected:', hasHighBandwidth);
            
            if (hasHighBandwidth) {
                console.log('🎥 [DEBUG] Active high bandwidth detected - likely in voice/video call');
                return true;
            }
            
            console.log('🎥 [DEBUG] No meeting activity detected (camera/mic and bandwidth both negative)');
            return false;
            
        } catch (error) {
            console.log('🎥 [DEBUG] Meeting detection check failed:', error.message);
            return false;
        }
    }
    
    async checkOtherMeetingProcesses() {
        // For now, return false - we can enhance this later with Tauri process detection
        return false;
    }
    
    // Main meeting state check
    checkMeetingState() {
        const wasInMeeting = this.isInMeeting;
        let meetingDetected = false;
        
        // Check WebRTC connections
        if (this.detectionMethods.webrtc) {
            const activeConnections = Array.from(this.peerConnections).filter(pc => 
                pc.connectionState === 'connected' || 
                pc.connectionState === 'connecting' ||
                pc.iceConnectionState === 'connected' ||
                pc.iceConnectionState === 'completed'
            );
            
            if (activeConnections.length > 0) {
                console.log('🎥 Meeting detected via WebRTC: active connections =', activeConnections.length);
                meetingDetected = true;
            }
        }
        
        // Check active media streams
        if (this.detectionMethods.mediaDevices || this.detectionMethods.screenShare) {
            const activeStreamCount = Array.from(this.activeStreams).filter(stream => 
                stream.active && stream.getTracks().some(track => track.readyState === 'live')
            ).length;
            
            if (activeStreamCount > 0) {
                console.log('🎥 Meeting detected via Media Streams: active streams =', activeStreamCount);
                meetingDetected = true;
            }
        }
        
        // Check audio device activity
        if (this.detectionMethods.audioDeviceMonitoring && this.audioActivityDetected) {
            console.log('🎥 Meeting detected via Audio Device Activity');
            meetingDetected = true;
        }
        
        // Check process detection
        if (this.detectionMethods.processDetection && this.processActivityDetected) {
            console.log('🎥 Meeting detected via Process Detection');
            meetingDetected = true;
        }
        
        // Update meeting state
        this.isInMeeting = meetingDetected;
        
        // Trigger callbacks if state changed
        if (this.isInMeeting !== wasInMeeting) {
            if (this.isInMeeting) {
                console.log('🎥 MEETING STARTED: User entered a meeting/call');
            } else {
                console.log('🎥 MEETING ENDED: User left the meeting/call');
            }
            
            this.triggerCallbacks(this.isInMeeting, wasInMeeting);
        }
        
        return this.isInMeeting;
    }
    
    // Periodic check for meeting state
    startPeriodicCheck() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
        
        this.checkInterval = setInterval(() => {
            this.checkMeetingState();
        }, this.checkFrequency);
        
        console.log('🎥 Periodic meeting check started (every', this.checkFrequency, 'ms)');
    }
    
    // Stop detection
    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        
        if (this.audioDeviceCheckInterval) {
            clearInterval(this.audioDeviceCheckInterval);
            this.audioDeviceCheckInterval = null;
        }
        
        if (this.processCheckInterval) {
            clearInterval(this.processCheckInterval);
            this.processCheckInterval = null;
        }
        
        // Clean up audio context
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }
        
        // Clear tracked connections and streams
        this.peerConnections.clear();
        this.activeStreams.clear();
        
        console.log('🎥 MeetingDetector stopped');
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
    
    getDetectionMethods() {
        return { ...this.detectionMethods };
    }
    
    getActiveConnectionsCount() {
        return this.peerConnections.size;
    }
    
    getActiveStreamsCount() {
        return this.activeStreams.size;
    }
    
    // Force a manual check
    forceCheck() {
        return this.checkMeetingState();
    }
    
    // Manual toggle for testing - simulate meeting state
    toggleMeetingStateForTesting() {
        this.processActivityDetected = !this.processActivityDetected;
        console.log('🎥 [TEST] Manually toggled meeting state to:', this.processActivityDetected);
        this.checkMeetingState();
        return this.processActivityDetected;
    }
    
    // Manual meeting state control
    setMeetingState(isInMeeting) {
        this.processActivityDetected = isInMeeting;
        console.log('🎥 [MANUAL] Meeting state set to:', isInMeeting);
        this.checkMeetingState();
        return this.processActivityDetected;
    }
}