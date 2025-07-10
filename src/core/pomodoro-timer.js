// Pomodoro Timer Core Module
const { invoke } = window.__TAURI__.core;
import { NotificationUtils, TimeUtils, KeyboardUtils } from '../utils/common-utils.js';

export class PomodoroTimer {
    constructor() {
        // Timer states
        this.isRunning = false;
        this.isPaused = false;
        this.currentMode = 'focus'; // 'focus', 'break', 'longBreak'
        this.timeRemaining = 25 * 60; // 25 minutes in seconds
        this.timerInterval = null;

        // Smart pause states
        this.smartPauseEnabled = false;
        this.isAutoPaused = false;
        this.activityTimeout = null;
        this.inactivityThreshold = 30000; // 30 seconds in milliseconds (configurable)
        this.smartPauseCountdownInterval = null;
        this.smartPauseSecondsRemaining = 0;

        // Session tracking
        this.completedPomodoros = 0;
        this.currentSession = 1;
        this.totalSessions = 10;
        this.totalFocusTime = 0; // in seconds

        // Session time tracking
        this.sessionStartTime = null; // When the current session was started
        this.lastSessionStartTime = null; // Preserved start time for the last completed session
        this.currentSessionElapsedTime = 0; // Actual elapsed time for current session (in seconds)
        this.lastCompletedSessionTime = 0; // Time of the last completed session for undo functionality
        this.sessionCompletedButNotSaved = false; // Flag to track if session completed but not saved yet
        this.maxSessionTime = 120 * 60 * 1000; // Default 2 hours in milliseconds
        this.maxSessionTimeReached = false; // Flag to track if max session time was reached

        // Timer accuracy tracking (for background throttling fix)
        this.timerStartTime = null; // When the timer was started (Date.now())
        this.timerDuration = null; // Original duration when timer was started
        this.lastUpdateTime = null; // Last time we updated the display

        // Timer durations (in seconds)
        this.durations = {
            focus: 25 * 60,        // 25 minutes
            break: 5 * 60,         // 5 minutes
            longBreak: 20 * 60     // 20 minutes
        };

        // DOM elements
        this.timerMinutes = document.getElementById('timer-minutes');
        this.timerSeconds = document.getElementById('timer-seconds');
        this.timerStatus = document.getElementById('timer-status');
        this.statusIcon = document.getElementById('status-icon');
        this.statusText = document.getElementById('status-text');
        this.playPauseBtn = document.getElementById('play-pause-btn');
        this.playIcon = document.getElementById('play-icon');
        this.pauseIcon = document.getElementById('pause-icon');
        this.stopBtn = document.getElementById('stop-btn');
        this.stopIcon = document.getElementById('stop-icon');
        this.undoIcon = document.getElementById('undo-icon');
        this.skipBtn = document.getElementById('skip-btn');
        this.skipCoffeeIcon = document.getElementById('skip-coffee-icon');
        this.skipSleepIcon = document.getElementById('skip-sleep-icon');
        this.skipBrainIcon = document.getElementById('skip-brain-icon');
        this.skipDefaultIcon = document.getElementById('skip-default-icon');
        this.progressDots = document.getElementById('progress-dots');
        this.smartIndicator = document.getElementById('smart-indicator');
        this.smartPauseCountdown = document.getElementById('smart-pause-countdown');
        this.autoStartIndicator = document.getElementById('auto-start-indicator');
        this.continuousSessionIndicator = document.getElementById('continuous-session-indicator');
        this.timerPlusBtn = document.getElementById('timer-plus-btn');
        this.timerMinusBtn = document.getElementById('timer-minus-btn');

        // Task management
        this.tasks = [];
        this.currentTask = '';

        // Notification preferences
        this.autoStartTimer = true; // Default to enabled for skip auto-start
        this.allowContinuousSessions = false; // Allow focus sessions to continue beyond timer

        // Debug mode
        this.debugMode = false; // Debug mode with 3-second timers

        // Keyboard shortcuts (will be updated from settings)
        this.customShortcuts = {
            start_stop: "CommandOrControl+Alt+Space",
            reset: "CommandOrControl+Alt+R", // Delete Session (focus) / Undo (break)
            skip: "CommandOrControl+Alt+S"   // Save Session
        };

        // Midnight monitoring for daily reset
        this.midnightMonitorInterval = null;
        this.currentDateString = new Date().toDateString();

        this.init();
    }

    async init() {
        // Verify all DOM elements are found
        if (!this.undoIcon) {
            console.error('Undo icon element not found, re-searching...');
            this.undoIcon = document.getElementById('undo-icon');
        }
        if (!this.stopIcon) {
            console.error('Stop icon element not found, re-searching...');
            this.stopIcon = document.getElementById('stop-icon');
        }

        // Generate initial progress dots
        this.generateProgressDots();
        this.updateDisplay();
        await this.updateProgressDots();
        this.updateStopUndoButton(); // Initialize stop/undo button state
        this.updateSkipIcon(); // Initialize skip button icon
        this.updateSmartIndicator(); // Initialize smart pause indicator

        // Add tooltip to smart indicator if NavigationManager is available
        if (window.navigationManager && this.smartIndicator) {
            window.navigationManager.addTooltipEvents(this.smartIndicator);
        }
        this.setupEventListeners();
        await this.loadSessionData();
        await this.loadTasks();

        // Initialize task input if it exists
        this.taskInput = document.getElementById('task-input');
        this.taskList = document.getElementById('task-list');

        if (this.taskInput) {
            this.taskInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.addTask();
                }
            });
        }

        // Render loaded tasks
        this.renderTasks();

        // Initialize smart indicator tooltip and click handler
        if (this.smartIndicator) {
            // Add click handler for toggle
            this.smartIndicator.addEventListener('click', () => {
                this.toggleSmartPause();
            });

            // Add tooltip using NavigationManager
            if (window.navigation) {
                window.navigation.addTooltipEvents(this.smartIndicator);
            }
        }

        // Initialize auto-start indicator
        if (this.autoStartIndicator) {
            this.autoStartIndicator.addEventListener('click', () => {
                this.toggleAutoStart();
            });

            // Add tooltip using NavigationManager
            if (window.navigation) {
                window.navigation.addTooltipEvents(this.autoStartIndicator);
            }
        }

        // Initialize continuous session indicator
        if (this.continuousSessionIndicator) {
            this.continuousSessionIndicator.addEventListener('click', () => {
                this.toggleContinuousSessions();
            });

            // Add tooltip using NavigationManager
            if (window.navigation) {
                window.navigation.addTooltipEvents(this.continuousSessionIndicator);
            }
        }

        // Update all setting indicators
        // Note: This will be called again in applySettings() with the correct values
        this.updateSettingIndicators();

        // Initialize sidebar state to match timer
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.className = `sidebar ${this.currentMode}`;
        }

        // Initialize tray menu state
        this.updateTrayMenu();

        // Start midnight monitoring for daily reset
        this.startMidnightMonitoring();

        // Setup event listeners for session synchronization
        this.setupSessionEventListeners();
    }

    setupSessionEventListeners() {
        // Listen for session changes from SessionManager to keep dots synchronized
        window.addEventListener('sessionAdded', async (event) => {
            const { date } = event.detail;
            const today = new Date().toDateString();
            
            // Only update dots if the session was added for today
            if (date === today) {
                await this.updateProgressDots();
            }
        });

        window.addEventListener('sessionDeleted', async (event) => {
            const { date } = event.detail;
            const today = new Date().toDateString();
            
            // Only update dots if the session was deleted from today
            if (date === today) {
                await this.updateProgressDots();
            }
        });

        window.addEventListener('sessionUpdated', async (event) => {
            const { date } = event.detail;
            const today = new Date().toDateString();
            
            // Only update dots if the session was updated for today
            if (date === today) {
                await this.updateProgressDots();
            }
        });
    }

    setupEventListeners() {
        this.playPauseBtn.addEventListener('click', () => {
            if (this.isRunning && !this.isPaused && !this.isAutoPaused) {
                this.pauseTimer();
            } else {
                this.startTimer();
            }
        });

        this.skipBtn.addEventListener('click', async () => await this.skipSession());

        this.stopBtn.addEventListener('click', () => {
            if (this.currentMode === 'focus') {
                // Delete/reset the current session
                this.resetTimer();
            } else {
                // In break/longBreak mode: undo last session
                this.undoLastSession();
            }
        });

        // Timer adjustment buttons
        if (this.timerPlusBtn) {
            this.timerPlusBtn.addEventListener('click', () => {
                this.adjustTimer(5);
            });
        }

        if (this.timerMinusBtn) {
            this.timerMinusBtn.addEventListener('click', () => {
                this.adjustTimer(-5);
            });
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', async (e) => {
            // Only trigger if not typing in an input
            if (e.target.tagName !== 'INPUT') {
                // Check custom shortcuts first
                if (this.matchesShortcut(e, this.customShortcuts.start_stop)) {
                    e.preventDefault();
                    if (this.isRunning && !this.isPaused && !this.isAutoPaused) {
                        this.pauseTimer();
                    } else {
                        this.startTimer();
                    }
                } else if (this.matchesShortcut(e, this.customShortcuts.reset)) {
                    e.preventDefault();
                    if (this.currentMode === 'focus') {
                        this.resetTimer();
                    } else {
                        this.undoLastSession();
                    }
                } else if (this.matchesShortcut(e, this.customShortcuts.skip)) {
                    e.preventDefault();
                    await this.skipSession();
                }
                // Keep existing hardcoded shortcuts as fallback
                else {
                    switch (e.code) {
                        case 'Space':
                            e.preventDefault();
                            if (this.isRunning && !this.isPaused && !this.isAutoPaused) {
                                this.pauseTimer();
                            } else {
                                this.startTimer();
                            }
                            break;
                        case 'KeyH':
                            if (e.ctrlKey || e.metaKey) {
                                e.preventDefault();
                                this.showHistoryModal();
                            }
                            break;
                        case 'Escape':
                            this.closeHistoryModal();
                            break;
                    }
                }
            }
        });

        // Prevent accidental closure during active session
        window.addEventListener('beforeunload', (e) => {
            if (this.isRunning && this.currentMode === 'focus') {
                e.preventDefault();
                e.returnValue = 'You have an active pomodoro session. Are you sure you want to leave?';
                return e.returnValue;
            }
        });

        // Listen for tray icon events
        this.setupTrayEventListeners();
    }

    async setupTrayEventListeners() {
        const { listen } = window.__TAURI__.event;

        // Listen for start session from tray
        await listen('tray-start-session', () => {
            this.startTimer();
        });

        // Listen for pause from tray
        await listen('tray-pause', () => {
            this.pauseTimer();
        });

        // Listen for skip from tray
        await listen('tray-skip', async () => {
            await this.skipSession();
        });

        // Listen for cancel from tray
        await listen('tray-cancel', () => {
            if (this.currentMode === 'focus') {
                // Delete/reset the current session
                this.resetTimer();
            } else {
                // In break/longBreak mode: undo last session
                this.undoLastSession();
            }
        });
    }

    // Update tray menu based on current timer state
    async updateTrayMenu() {
        try {
            await invoke('update_tray_menu', {
                isRunning: this.isRunning,
                isPaused: this.isPaused,
                currentMode: this.currentMode
            });
        } catch (error) {
            console.error('Failed to update tray menu:', error);
        }
    }

    // Update keyboard shortcuts from settings
    updateKeyboardShortcuts(shortcuts) {
        this.customShortcuts = { ...shortcuts };
        console.log('Updated keyboard shortcuts:', this.customShortcuts);
    }

    // Helper method to parse shortcut string into components
    parseShortcut(shortcutString) {
        return KeyboardUtils.parseShortcut(shortcutString);
    }

    // Check if a keyboard event matches a shortcut
    matchesShortcut(event, shortcutString) {
        return KeyboardUtils.matchesShortcut(event, shortcutString);
    }

    // Smart Pause Methods
    setupSmartPause() {
        if (!this.smartPauseEnabled) return;

        // Setup event listeners for global activity monitoring
        this.setupGlobalActivityListeners();

        console.log('Smart pause enabled with global monitoring');
    }

    async setupGlobalActivityListeners() {
        try {
            // Start global activity monitoring with configurable timeout
            const timeoutSeconds = Math.floor(this.inactivityThreshold / 1000); // convert from milliseconds to seconds
            await invoke('start_activity_monitoring', { timeoutSeconds: timeoutSeconds });

            // Listen for activity events from backend
            const { listen } = window.__TAURI__.event;

            // Listen for user activity
            await listen('user-activity', () => {
                // console.log('🔄 ACTIVITY: Global activity detected via Tauri backend');
                this.handleUserActivity();
            });

            // Listen for user inactivity
            await listen('user-inactivity', () => {
                // console.log('💤 INACTIVITY: Global inactivity detected via Tauri backend');
                this.autoPauseTimer();
            });

            // Start initial timeout for local fallback
            this.handleUserActivity();

            console.log('Global activity listeners setup complete');
        } catch (error) {
            console.error('Failed to setup global activity monitoring:', error);
            // Fallback to local monitoring
            this.setupLocalActivityListeners();
        }
    }

    setupLocalActivityListeners() {
        console.log('Falling back to local activity monitoring');
        // List of events that indicate user activity
        const activityEvents = ['mousemove', 'mousedown', 'keydown', 'scroll', 'click'];

        // Setup activity listeners
        activityEvents.forEach(event => {
            document.addEventListener(event, () => this.handleUserActivity(), { passive: true });
        });

        // Start initial timeout
        this.handleUserActivity();
    }

    handleUserActivity() {
        // console.log('🎯 handleUserActivity called - smartPauseEnabled:', this.smartPauseEnabled, 'isRunning:', this.isRunning, 'currentMode:', this.currentMode, 'isAutoPaused:', this.isAutoPaused);

        // if (!this.smartPauseEnabled || !this.isRunning || this.currentMode !== 'focus') {
        //     console.log('❌ handleUserActivity early return due to conditions');
        //     return;
        // }

        // If currently auto-paused, resume the timer
        if (this.isAutoPaused) {
            console.log('🔄 Timer is auto-paused, calling resumeFromAutoPause()');
            this.resumeFromAutoPause();
            return; // Exit early after resume to avoid setting new timeout immediately
        }

        // Clear existing timeout and countdown
        if (this.activityTimeout) {
            clearTimeout(this.activityTimeout);
        }
        this.stopSmartPauseCountdown();

        // Set new timeout for auto-pause after configured inactivity period
        this.activityTimeout = setTimeout(() => {
            this.autoPauseTimer();
        }, this.inactivityThreshold); // Use configurable timeout

        // Start countdown display
        this.startSmartPauseCountdown();
    }

    startSmartPauseCountdown() {
        if (!this.smartPauseEnabled || !this.smartPauseCountdown) return;

        this.smartPauseSecondsRemaining = Math.floor(this.inactivityThreshold / 1000);
        this.updateSmartPauseCountdownDisplay();

        // Start the countdown interval
        this.smartPauseCountdownInterval = setInterval(() => {
            this.smartPauseSecondsRemaining--;
            this.updateSmartPauseCountdownDisplay();

            if (this.smartPauseSecondsRemaining <= 0) {
                this.stopSmartPauseCountdown();
            }
        }, 1000);
    }

    stopSmartPauseCountdown() {
        if (this.smartPauseCountdownInterval) {
            clearInterval(this.smartPauseCountdownInterval);
            this.smartPauseCountdownInterval = null;
        }

        if (this.smartPauseCountdown) {
            this.smartPauseCountdown.style.display = 'none';
        }

        this.smartPauseSecondsRemaining = 0;
    }

    updateSmartPauseCountdownDisplay() {
        if (!this.smartPauseCountdown) return;

        if (this.smartPauseSecondsRemaining > 0 && this.smartPauseSecondsRemaining <= 10) {
            this.smartPauseCountdown.textContent = this.smartPauseSecondsRemaining;
            this.smartPauseCountdown.style.display = 'flex';
        } else {
            this.smartPauseCountdown.style.display = 'none';
        }
    }

    autoPauseTimer() {
        console.log('🚨 autoPauseTimer called - isRunning:', this.isRunning, 'isPaused:', this.isPaused, 'isAutoPaused:', this.isAutoPaused, 'currentMode:', this.currentMode);

        if (!this.isRunning || this.isPaused || this.isAutoPaused || this.currentMode !== 'focus') {
            console.log('❌ autoPauseTimer early return due to conditions');
            return;
        }

        console.log('💤 Auto-pausing timer due to inactivity');
        this.isAutoPaused = true;
        this.isPaused = true;
        console.log('🔧 States set: isAutoPaused =', this.isAutoPaused, 'isPaused =', this.isPaused);

        // Stop the timer interval and countdown
        clearInterval(this.timerInterval);
        this.timerInterval = null;
        this.stopSmartPauseCountdown();

        // Show auto-pause notification
        NotificationUtils.showNotificationPing('Timer auto-paused due to inactivity 💤', 'warning', this.currentMode);

        // Update UI to show auto-pause state
        this.updateDisplay();
        this.updateButtons();
        this.updateTrayIcon();
    }

    resumeFromAutoPause() {
        if (!this.isAutoPaused) return;

        console.log('🔄 Resuming from auto-pause...');

        // Clear any existing timer interval first
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        // Set states to resume - be very explicit about the state
        this.isAutoPaused = false;
        this.isPaused = false;
        this.isRunning = true;
        this._justResumedFromAutoPause = true; // Flag to ensure status update happens

        console.log('✅ States set: isAutoPaused =', this.isAutoPaused, 'isPaused =', this.isPaused, 'isRunning =', this.isRunning);

        // Initialize timer accuracy tracking for resume
        this.timerStartTime = Date.now();
        this.timerDuration = this.timeRemaining;

        // Restart the timer interval with accuracy updates
        this.timerInterval = setInterval(() => {
            this.updateTimerWithAccuracy();
        }, 100);

        // Force synchronous UI update first
        this.updateDisplay();
        this.updateButtons();
        this.updateTrayIcon();

        // Clear the resume flag after UI update
        this._justResumedFromAutoPause = false;

        // Show resume notification after UI update
        NotificationUtils.showNotificationPing('Timer resumed - you\'re back! 🎯', 'info', this.currentMode);

        // Restart smart pause monitoring by setting new timeout
        if (this.smartPauseEnabled && this.currentMode === 'focus') {
            // Clear any existing timeout first
            if (this.activityTimeout) {
                clearTimeout(this.activityTimeout);
            }
            this.stopSmartPauseCountdown();

            // Set new timeout for auto-pause
            this.activityTimeout = setTimeout(() => {
                this.autoPauseTimer();
            }, this.inactivityThreshold);

            // Start countdown display
            this.startSmartPauseCountdown();
        }

        // Update display to remove (Auto-paused) status
        this.updateDisplay();
        this.updateButtons();

        console.log('🎯 Resume complete, timer should be running normally');
    }

    async enableSmartPause(enabled) {
        this.smartPauseEnabled = enabled;

        if (enabled) {
            await this.setupSmartPause();
            // Start monitoring if timer is already running and in focus mode
            if (this.isRunning && !this.isPaused && this.currentMode === 'focus') {
                this.handleUserActivity();
            }
        } else {
            // Stop global monitoring
            try {
                await invoke('stop_activity_monitoring');
            } catch (error) {
                console.error('Failed to stop activity monitoring:', error);
            }

            // Clear local timeout, countdown, and resume if auto-paused
            if (this.activityTimeout) {
                clearTimeout(this.activityTimeout);
                this.activityTimeout = null;
            }
            this.stopSmartPauseCountdown();

            if (this.isAutoPaused) {
                this.resumeFromAutoPause();
            }
        }

        console.log('Smart pause', enabled ? 'enabled' : 'disabled');

        // Update the smart indicator
        this.updateSmartIndicator();
    }

    startTimer() {
        if (!this.isRunning) {
            const wasResuming = this.isPaused; // Check if we're resuming from pause

            this.isRunning = true;
            this.isPaused = false;

            // Set flag to ensure status update when resuming from manual pause
            if (wasResuming) {
                this._justResumedFromPause = true;
            }

            // Track session start time if not already set
            if (!this.sessionStartTime) {
                this.sessionStartTime = Date.now();
                console.log('🟢 NEW SESSION STARTED - sessionStartTime set to:', {
                    timestamp: this.sessionStartTime,
                    dateISO: new Date(this.sessionStartTime).toISOString(),
                    dateLocal: new Date(this.sessionStartTime).toString()
                });
                this.currentSessionElapsedTime = 0;
                this.sessionCompletedButNotSaved = false; // Reset flag for new session
            } else {
                console.log('⚠️ Session already started - not updating sessionStartTime:', {
                    existingTimestamp: this.sessionStartTime,
                    existingDateISO: new Date(this.sessionStartTime).toISOString(),
                    existingDateLocal: new Date(this.sessionStartTime).toString()
                });
            }

            // Initialize timer accuracy tracking
            this.timerStartTime = Date.now();
            this.timerDuration = this.timeRemaining;
            this.lastUpdateTime = this.timerStartTime;

            this.timerInterval = setInterval(() => {
                this.updateTimerWithAccuracy();
            }, 100); // Update more frequently (10 times per second) for smoother display

            this.updateButtons();
            this.updateDisplay();

            // Start clock ticking for focus sessions
            if (this.currentMode === 'focus' && window.audioManager) {
                window.audioManager.resumeAudioContext();
                if (window.audioManager.isClockTickingEnabled()) {
                    window.audioManager.startClockTicking();
                }
            }

            // Clear the resume flag after UI update
            if (wasResuming) {
                this._justResumedFromPause = false;
            }

            if (this.enableSoundNotifications) {
                NotificationUtils.playNotificationSound();
            }
            NotificationUtils.showNotificationPing('Timer started! 🍅', 'info', this.currentMode);

            // Start smart pause monitoring if enabled
            if (this.smartPauseEnabled && this.currentMode === 'focus') {
                this.handleUserActivity();
            }

            // Update tray menu
            this.updateTrayMenu();

            // Notify tag manager about timer start or resume
            if (window.tagManager) {
                if (wasResuming) {
                    window.tagManager.onTimerResume();
                } else {
                    window.tagManager.onTimerStart();
                }
            }
        }
    }

    // New method for accurate timer updates that works even when app is in background
    updateTimerWithAccuracy() {
        const now = Date.now();
        const elapsedSinceStart = Math.floor((now - this.timerStartTime) / 1000);
        const newTimeRemaining = this.timerDuration - elapsedSinceStart;

        // Only update if the time has actually changed (to avoid unnecessary updates)
        if (newTimeRemaining !== this.timeRemaining) {
            const oldTimeRemaining = this.timeRemaining;
            this.timeRemaining = newTimeRemaining;

            // Track elapsed time for focus sessions based on actual time passed
            if (this.currentMode === 'focus') {
                const timeDiff = oldTimeRemaining - this.timeRemaining;
                if (timeDiff > 0) {
                    this.currentSessionElapsedTime += timeDiff;
                }
            }

            // Check if max session time has been reached
            this.checkMaxSessionTime();

            this.updateDisplay();

            // Warning when less than 2 minutes remaining
            if (this.timeRemaining <= 120 && this.timeRemaining > 0 && oldTimeRemaining > 120 && this.currentMode === 'focus') {
                this.addWarningClass();
                NotificationUtils.showNotificationPing('2 minutes remaining! 🔥', 'warning', this.currentMode);
            }

            // Final warning at 30 seconds
            if (this.timeRemaining <= 30 && this.timeRemaining > 0 && oldTimeRemaining > 30) {
                NotificationUtils.showNotificationPing('30 seconds left! ⏰', 'warning', this.currentMode);
            }

            // Check if timer should complete
            if (this.timeRemaining <= 0 && oldTimeRemaining > 0) {
                if (this.allowContinuousSessions) {
                    // For continuous sessions, show completion notification but keep timer running
                    this.showSessionCompletedNotification();
                    // Reset timer tracking for overtime
                    this.timerStartTime = now;
                    this.timerDuration = 0; // Start from 0 for overtime
                } else {
                    // Traditional behavior - complete and stop the session
                    this.completeSession();
                }
            }
        }
    }

    checkMaxSessionTime() {
        // Only check during focus sessions and if a session is active
        if (this.currentMode !== 'focus' || !this.sessionStartTime || this.maxSessionTimeReached) {
            return;
        }

        const now = Date.now();
        const sessionElapsed = now - this.sessionStartTime;

        // Check if session has exceeded max time
        if (sessionElapsed >= this.maxSessionTime) {
            this.maxSessionTimeReached = true;
            this.pauseTimer();
            
            // Show notification
            const maxTimeInMinutes = Math.floor(this.maxSessionTime / (60 * 1000));
            NotificationUtils.showNotificationPing(
                `Session automatically paused after ${maxTimeInMinutes} minutes. Take a break! 🛑`,
                'warning'
            );
            
            // Show desktop notification if enabled
            NotificationUtils.showDesktopNotification(
                'Session Time Limit Reached',
                `Your session has been automatically paused after ${maxTimeInMinutes} minutes. Consider taking a break!`
            );
        }
    }

    pauseTimer() {
        if (this.isRunning) {
            this.isRunning = false;
            this.isPaused = true;
            this.isAutoPaused = false; // Manual pause overrides auto-pause
            clearInterval(this.timerInterval);

            // Update timer with current accurate time before pausing
            if (this.timerStartTime) {
                const now = Date.now();
                const elapsedSinceStart = Math.floor((now - this.timerStartTime) / 1000);
                this.timeRemaining = this.timerDuration - elapsedSinceStart;
            }

            // Clear smart pause timeout and countdown
            if (this.activityTimeout) {
                clearTimeout(this.activityTimeout);
                this.activityTimeout = null;
            }
            this.stopSmartPauseCountdown();

            this.updateButtons();
            this.updateDisplay();
            
            // Stop clock ticking when paused
            if (window.audioManager) {
                window.audioManager.stopClockTicking();
            }
            
            NotificationUtils.showNotificationPing('Timer paused ⏸️');

            // Update tray menu
            this.updateTrayMenu();

            // Notify tag manager about timer pause
            if (window.tagManager) {
                window.tagManager.onTimerPause();
            }
        }
    }

    resetTimer() {
        this.isRunning = false;
        this.isPaused = false;
        this.isAutoPaused = false;
        clearInterval(this.timerInterval);

        // Clear smart pause timeout and countdown
        if (this.activityTimeout) {
            clearTimeout(this.activityTimeout);
            this.activityTimeout = null;
        }
        this.stopSmartPauseCountdown();

        // Reset session tracking
        this.sessionStartTime = null;
        this.currentSessionElapsedTime = 0;
        this.sessionCompletedButNotSaved = false; // Reset flag
        this.maxSessionTimeReached = false; // Reset max session time flag

        // Reset timer accuracy tracking
        this.timerStartTime = null;
        this.timerDuration = null;
        this.lastUpdateTime = null;

        this.timeRemaining = this.durations[this.currentMode];
        this.updateDisplay();
        this.updateButtons();
        NotificationUtils.showNotificationPing('Session deleted ❌', 'warning');

        // Update tray menu
        this.updateTrayMenu();

        // Notify tag manager about timer stop
        if (window.tagManager) {
            window.tagManager.onTimerStop();
        }
    }

    adjustTimer(minutes) {
        // Convert minutes to seconds
        const adjustment = minutes * 60;
        
        // Add the adjustment to the current time remaining
        this.timeRemaining += adjustment;
        
        // Ensure we don't go below 0 seconds
        if (this.timeRemaining < 0) {
            this.timeRemaining = 0;
        }
        
        // If timer is running, we need to update the accuracy tracking
        if (this.isRunning && this.timerStartTime) {
            // Calculate how much time should remain based on the adjustment
            const now = Date.now();
            const elapsedSinceStart = Math.floor((now - this.timerStartTime) / 1000);
            
            // Update the timer duration to account for the adjustment
            this.timerDuration = elapsedSinceStart + this.timeRemaining;
        }
        
        // Update the display immediately
        this.updateDisplay();
        
        // Show notification
        const action = minutes > 0 ? 'added' : 'subtracted';
        const absMinutes = Math.abs(minutes);
        NotificationUtils.showNotificationPing(
            `${absMinutes} minute${absMinutes !== 1 ? 's' : ''} ${action} ${minutes > 0 ? 'to' : 'from'} timer ⏰`
        );
    }

    // Midnight monitoring methods for daily reset
    startMidnightMonitoring() {
        // Clear any existing monitoring
        this.stopMidnightMonitoring();

        // Check for date change every minute
        this.midnightMonitorInterval = setInterval(() => {
            this.checkForMidnightReset();
        }, 60000); // Check every minute

        console.log('🌙 Midnight monitoring started');
    }

    stopMidnightMonitoring() {
        if (this.midnightMonitorInterval) {
            clearInterval(this.midnightMonitorInterval);
            this.midnightMonitorInterval = null;
            console.log('🌙 Midnight monitoring stopped');
        }
    }

    checkForMidnightReset() {
        const newDateString = new Date().toDateString();
        
        if (newDateString !== this.currentDateString) {
            console.log('🌙 Date change detected:', this.currentDateString, '→', newDateString);
            this.currentDateString = newDateString;
            this.performMidnightReset();
        }
    }

    async performMidnightReset() {
        console.log('🌅 Performing midnight reset...');

        // Store previous session count for notification
        const previousPomodoros = this.completedPomodoros;

        // Use enhanced loadSessionData with force reset to ensure clean state
        await this.loadSessionData(true);
        
        // Update display to show the reset state
        this.updateDisplay();
        
        // Save the reset state
        await this.saveSessionData();

        // Show user notification about the reset
        if (previousPomodoros > 0) {
            NotificationUtils.showNotificationPing(
                `New day! Yesterday's ${previousPomodoros} sessions have been saved. Fresh start! 🌅`,
                'info'
            );
        } else {
            NotificationUtils.showNotificationPing(
                'Good morning! Ready for a productive new day? 🌅',
                'info'
            );
        }

        // Update all visual elements
        this.updateTrayIcon();
        
        // Refresh navigation charts if available
        if (window.navigationManager) {
            try {
                await window.navigationManager.updateDailyChart();
                await window.navigationManager.updateFocusSummary();
                await window.navigationManager.updateWeeklySessionsChart();
            } catch (error) {
                console.error('Failed to update navigation charts after midnight reset:', error);
            }
        }

        console.log('✅ Midnight reset completed successfully');
    }

    async skipSession() {
        this.isRunning = false;
        this.isPaused = false;
        this.isAutoPaused = false;
        clearInterval(this.timerInterval);

        // Clear smart pause timeout and countdown
        if (this.activityTimeout) {
            clearTimeout(this.activityTimeout);
            this.activityTimeout = null;
        }
        this.stopSmartPauseCountdown();

        // Track if we need to save session data
        let shouldSaveSession = false;

        // OVERTIME: If in overtime and continuous sessions, save session and skip double-counting
        if (this.timeRemaining < 0 && this.allowContinuousSessions) {
            shouldSaveSession = true;
            this.sessionCompletedButNotSaved = false;

            // Save overtime focus session to SessionManager as individual session
            // Only save if session lasted at least 1 minute
            if (this.currentMode === 'focus' && this.lastCompletedSessionTime > 3) {
                await this.saveCompletedFocusSession();
            }

            // Move to next mode as usual
            if (this.currentMode === 'focus') {
                if (this.completedPomodoros % 4 === 0) {
                    this.currentMode = 'longBreak';
                } else {
                    this.currentMode = 'break';
                }
                
                // Reset display state tracking when switching to break modes
                this._lastLoggedState = null;
                this._lastAutoPausedLogged = false;
                this._lastPausedLogged = false;
            } else {
                this.currentMode = 'focus';
                
                // Reset display state tracking when switching to focus mode
                this._lastLoggedState = null;
                this._lastAutoPausedLogged = false;
                this._lastPausedLogged = false;
                
                // Restore TagManager display when returning to focus mode
                if (window.tagManager) {
                    window.tagManager.updateStatusDisplay();
                }
                
                if (this.completedPomodoros < this.totalSessions) {
                    this.currentSession = this.completedPomodoros + 1;
                }
            }
            this.timeRemaining = this.durations[this.currentMode];
            this.updateDisplay();
            this.updateButtons();
            
            // Handle audio for mode changes
            this.handleAudioForModeChange();
            
            if (shouldSaveSession) {
                this.saveSessionData();
            }
            
            // Reset session start time for next session (after saving)
            console.log('🔄 Resetting sessionStartTime after overtime skip:', {
                beforeReset: this.sessionStartTime,
                beforeResetISO: this.sessionStartTime ? new Date(this.sessionStartTime).toISOString() : null
            });
            this.sessionStartTime = null;
            
            const messages = {
                focus: 'Focus session skipped. Time for a break! 😌',
                break: 'Break skipped. Ready to focus? 🍅',
                longBreak: 'Long break skipped. Time to get back to work! 🚀'
            };
            NotificationUtils.showNotificationPing(messages[this.currentMode] || 'Session skipped 📤', 'info', this.currentMode);
            if (this.autoStartTimer) {
                setTimeout(() => {
                    this.startTimer();
                }, 1500);
            }
            this.updateTrayMenu();
            return; // Prevent double-counting
        }

        // NORMAL SKIP LOGIC
        if (this.currentMode === 'focus') {
            if (!this.sessionCompletedButNotSaved) {
                this.completedPomodoros++;
                await this.updateProgressDots();
                const actualElapsedTime = this.currentSessionElapsedTime || (this.durations.focus - this.timeRemaining);
                this.totalFocusTime += actualElapsedTime;
                this.lastCompletedSessionTime = actualElapsedTime;
                
                // Preserve session start time for saving
                console.log('Preserving session start time:', {
                    before: this.lastSessionStartTime,
                    sessionStartTime: this.sessionStartTime,
                    preservedValue: this.sessionStartTime
                });
                this.lastSessionStartTime = this.sessionStartTime;

                // Save skipped focus session to SessionManager as individual session
                // Only save if session lasted at least 1 minute
                if (this.lastCompletedSessionTime > 60) {
                    await this.saveCompletedFocusSession();
                }
            }
            shouldSaveSession = true;
            this.sessionCompletedButNotSaved = false;
            if (this.completedPomodoros % 4 === 0) {
                this.currentMode = 'longBreak';
            } else {
                this.currentMode = 'break';
            }
            
            // Reset display state tracking when switching to break modes
            this._lastLoggedState = null;
            this._lastAutoPausedLogged = false;
            this._lastPausedLogged = false;
        } else {
            this.currentMode = 'focus';
            
            // Reset display state tracking when switching to focus mode
            this._lastLoggedState = null;
            this._lastAutoPausedLogged = false;
            this._lastPausedLogged = false;

            // Restore TagManager display when returning to focus mode
            if (window.tagManager) {
                window.tagManager.updateStatusDisplay();
            }

            if (this.completedPomodoros < this.totalSessions) {
                this.currentSession = this.completedPomodoros + 1;
            }
        }
        this.timeRemaining = this.durations[this.currentMode];
        this.updateDisplay();
        this.updateButtons();
        if (shouldSaveSession) {
            this.saveSessionData();
        }
        
        // Reset session start time for next session (after saving)
        console.log('🔄 Resetting sessionStartTime after normal skip:', {
            beforeReset: this.sessionStartTime,
            beforeResetISO: this.sessionStartTime ? new Date(this.sessionStartTime).toISOString() : null
        });
        this.sessionStartTime = null;
        
        const messages = {
            focus: 'Focus session skipped. Time for a break! 😌',
            break: 'Break skipped. Ready to focus? 🍅',
            longBreak: 'Long break skipped. Time to get back to work! 🚀'
        };
        NotificationUtils.showNotificationPing(messages[this.currentMode] || 'Session skipped 📤', 'info', this.currentMode);
        if (this.autoStartTimer) {
            setTimeout(() => {
                this.startTimer();
            }, 1500);
        }
        this.updateTrayMenu();
    }

    async completeSession() {
        this.isRunning = false;
        this.isPaused = false;
        clearInterval(this.timerInterval);

        // Clear smart pause timeout and countdown
        if (this.activityTimeout) {
            clearTimeout(this.activityTimeout);
            this.activityTimeout = null;
        }
        this.stopSmartPauseCountdown();

        // Track completion state
        let shouldChangeMode = true;

        if (this.currentMode === 'focus') {
            this.completedPomodoros++;
            await this.updateProgressDots();

            // Calculate actual elapsed time for focus sessions
            const actualElapsedTime = this.currentSessionElapsedTime || (this.durations.focus - this.timeRemaining);
            this.totalFocusTime += actualElapsedTime;

            // Store the actual elapsed time for undo functionality
            this.lastCompletedSessionTime = actualElapsedTime;
            
            // Preserve session start time for saving
            console.log('Preserving session start time (timer completion):', {
                before: this.lastSessionStartTime,
                sessionStartTime: this.sessionStartTime,
                preservedValue: this.sessionStartTime
            });
            this.lastSessionStartTime = this.sessionStartTime;

            // Mark current task as completed if exists
            if (this.currentTask.trim()) {
                await this.markTaskCompleted(this.currentTask.trim());
                if (this.taskInput) {
                    this.taskInput.value = '';
                }
                this.currentTask = '';
            }

            // Check if continuous sessions are enabled
            if (this.allowContinuousSessions) {
                // Don't change mode - stay in focus for continuous sessions
                shouldChangeMode = false;
            } else {
                // Determine next mode for traditional behavior
                if (this.completedPomodoros % 4 === 0) {
                    this.currentMode = 'longBreak';
                } else {
                    this.currentMode = 'break';
                }
                
                // Reset display state tracking when switching to break modes
                this._lastLoggedState = null;
                this._lastAutoPausedLogged = false;
                this._lastPausedLogged = false;
            }
        } else {
            // Break completed
            if (this.allowContinuousSessions) {
                // Don't change mode - stay in current break type for continuous sessions
                shouldChangeMode = false;
            } else {
                // Traditional behavior - go back to focus
                this.currentMode = 'focus';
                
                // Reset display state tracking when switching to focus mode
                this._lastLoggedState = null;
                this._lastAutoPausedLogged = false;
                this._lastPausedLogged = false;

                // Restore TagManager display when returning to focus mode
                if (window.tagManager) {
                    window.tagManager.updateStatusDisplay();
                }
                if (this.completedPomodoros < this.totalSessions) {
                    this.currentSession = this.completedPomodoros + 1;
                }
            }
        }

        // Save completed focus session to SessionManager as individual session BEFORE resetting sessionStartTime
        if (this.lastCompletedSessionTime > 0 && this.completedPomodoros > 0) {
            await this.saveCompletedFocusSession();
        }

        // Reset session tracking for next session
        console.log('Resetting sessionStartTime for next session (from completeSession)');
        this.sessionStartTime = null;
        this.currentSessionElapsedTime = 0;
        this.sessionCompletedButNotSaved = false; // Reset flag
        this.maxSessionTimeReached = false; // Reset max session time flag

        // Reset timer accuracy tracking
        this.timerStartTime = null;
        this.timerDuration = null;
        this.lastUpdateTime = null;

        this.timeRemaining = this.durations[this.currentMode];
        this.updateDisplay();
        this.updateButtons();

        // Only save aggregated session data, individual sessions are handled by saveCompletedFocusSession
        await this.saveSessionData();
        this.showNotification();
        if (this.enableSoundNotifications) {
            NotificationUtils.playNotificationSound();
        }

        // Show completion message
        let completionMessage;
        if (this.allowContinuousSessions) {
            // Messages for continuous sessions
            const continuousMessages = {
                focus: 'Pomodoro completed! Continue working or take a break? 🍅',
                break: 'Break time completed! Continue resting or ready to focus? ☕',
                longBreak: 'Long break completed! Continue resting or ready to work? 🌙'
            };
            completionMessage = continuousMessages[this.currentMode];
        } else {
            // Messages for traditional mode
            const traditionalMessages = {
                focus: this.currentMode === 'longBreak' ? 'Great work! Take a long break 🎉' : 'Pomodoro completed! Take a short break 😌',
                break: 'Break over! Ready to focus? 🍅',
                longBreak: 'Long break over! Time to get back to work 🚀'
            };
            completionMessage = traditionalMessages[this.currentMode] || traditionalMessages.focus;
        }

        NotificationUtils.showNotificationPing(completionMessage, 'success', this.currentMode);

        // Stop the timer after session completion
        this.isRunning = false;
        this.isPaused = false;
        this.isAutoPaused = false;

        // Clear intervals and timeouts
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        if (this.activityTimeout) {
            clearTimeout(this.activityTimeout);
            this.activityTimeout = null;
        }

        // Update display and buttons to reflect stopped state
        this.updateDisplay();
        this.updateButtons();
        this.updateTrayIcon();

        // Auto-start new session if enabled and mode changed (traditional mode only)
        if (this.autoStartTimer && !this.allowContinuousSessions && shouldChangeMode) {
            console.log('Auto-starting new session after completion in 1.5 seconds...');
            // Add a small delay to let the user see the completion message
            setTimeout(() => {
                this.startTimer();
            }, 1500); // 1.5 second delay
        }

        // Update tray menu
        this.updateTrayMenu();

        // Notify tag manager about timer completion
        if (window.tagManager) {
            window.tagManager.onTimerComplete();
        }
    }

    // Show completion notification for continuous sessions without stopping the timer
    async showSessionCompletedNotification() {
        // Update completed sessions count for focus sessions
        if (this.currentMode === 'focus') {
            this.completedPomodoros++;
            await this.updateProgressDots();

            // Calculate actual elapsed time for focus sessions
            const actualElapsedTime = this.currentSessionElapsedTime || this.durations.focus;
            this.totalFocusTime += actualElapsedTime;

            // Store the actual elapsed time for undo functionality
            this.lastCompletedSessionTime = actualElapsedTime;
            
            // Preserve session start time for saving
            console.log('Preserving session start time (overtime):', {
                before: this.lastSessionStartTime,
                sessionStartTime: this.sessionStartTime,
                preservedValue: this.sessionStartTime
            });
            this.lastSessionStartTime = this.sessionStartTime;

            // Mark current task as completed if exists
            if (this.currentTask.trim()) {
                await this.markTaskCompleted(this.currentTask.trim());
                if (this.taskInput) {
                    this.taskInput.value = '';
                }
                this.currentTask = '';
            }

            // Mark session as completed but not saved yet (will be saved when user skips)
            this.sessionCompletedButNotSaved = true;

            // Save completed focus session to SessionManager immediately
            await this.saveCompletedFocusSession();
        }

        // For continuous sessions, don't save the session data here
        // It will be saved when the user skips the session
        if (!this.allowContinuousSessions) {
            // Save session data only for traditional mode
            await this.saveSessionData();
            await this.updateWeeklyStats();
        }

        // Show notification
        this.showNotification();
        if (this.enableSoundNotifications) {
            NotificationUtils.playNotificationSound();
        }

        // Show completion message for continuous sessions
        const continuousMessages = {
            focus: 'Pomodoro completed! You can continue working or take a break 🍅⏰',
            break: 'Break time completed! You can continue resting or start focusing ☕⏰',
            longBreak: 'Long break completed! You can continue resting or start working 🌙⏰'
        };

        const completionMessage = continuousMessages[this.currentMode];
        NotificationUtils.showNotificationPing(completionMessage, 'success', this.currentMode);

        // Update tray icon to show completion but keep running
        this.updateTrayIcon();
    }

    updateDisplay() {
        let displayMinutes, displaySeconds, isOvertime = false;

        if (this.timeRemaining < 0 && this.allowContinuousSessions) {
            // Show overtime in continuous sessions
            isOvertime = true;
            const overtimeSeconds = Math.abs(this.timeRemaining);
            displayMinutes = Math.floor(overtimeSeconds / 60);
            displaySeconds = overtimeSeconds % 60;
        } else {
            // Normal display or traditional mode
            const absTime = Math.abs(this.timeRemaining);
            displayMinutes = Math.floor(absTime / 60);
            displaySeconds = absTime % 60;
        }

        // Update the split display
        this.timerMinutes.textContent = displayMinutes.toString().padStart(2, '0');
        this.timerSeconds.textContent = displaySeconds.toString().padStart(2, '0');

        // Update status - respect TagManager when tags are selected
        const statusTexts = {
            focus: 'Focus',
            break: 'Break',
            longBreak: 'Long Break'
        };

        let statusText = statusTexts[this.currentMode];
        let shouldUpdateStatus = true;

        // Check if TagManager is active and has selected tags for focus mode
        if (this.currentMode === 'focus' && window.tagManager && window.tagManager.getCurrentTags().length > 0) {
            // Don't override tag display during normal focus sessions
            // BUT always allow status updates when just resumed from pause to clear pause labels
            if (!isOvertime && !this.isAutoPaused && !(this.isPaused && !this.isRunning) && !this._justResumedFromAutoPause && !this._justResumedFromPause) {
                shouldUpdateStatus = false;
            } else {
                // For special states, append to tag name instead of overriding
                const currentTags = window.tagManager.getCurrentTags();
                if (currentTags.length === 1) {
                    statusText = currentTags[0].name;
                } else if (currentTags.length > 1) {
                    statusText = `${currentTags.length} Tags`;
                }
            }
        }

        // Add state indicators
        if (shouldUpdateStatus) {
            // Only log state changes, not every update to reduce spam
            const currentState = `${isOvertime}-${this.isAutoPaused}-${this.isPaused}-${this.isRunning}`;
            if (!this._lastLoggedState || this._lastLoggedState !== currentState || this._justResumedFromAutoPause || this._justResumedFromPause) {
                console.log('📊 updateDisplay - isOvertime:', isOvertime, 'isAutoPaused:', this.isAutoPaused, 'isPaused:', this.isPaused, 'isRunning:', this.isRunning, 'justResumedFromAutoPause:', this._justResumedFromAutoPause, 'justResumedFromPause:', this._justResumedFromPause);
                this._lastLoggedState = currentState;
            }

            if (isOvertime) {
                statusText += ' (Overtime)';
                if (!this._lastLoggedState || !this._lastLoggedState.startsWith('true-')) {
                    console.log('⏰ Showing Overtime status');
                }
            }
            else if (this.isAutoPaused) {
                statusText += ' (Auto-paused)';
                if (!this._lastAutoPausedLogged) {
                    console.log('💤 Showing Auto-paused status');
                    this._lastAutoPausedLogged = true;
                }
            } else if (this.isPaused && !this.isRunning) {
                statusText += ' (Paused)';
                if (!this._lastPausedLogged) {
                    console.log('⏸️ Showing Paused status');
                    this._lastPausedLogged = true;
                }
            } else {
                // Reset paused flags when not in those states
                this._lastAutoPausedLogged = false;
                this._lastPausedLogged = false;
                if (this._lastLoggedState && (this._lastLoggedState.includes('true') || this._justResumedFromAutoPause || this._justResumedFromPause)) {
                    console.log('▶️ No status suffix (timer running normally)');
                }
            }

            // Update status text only when necessary
            const statusTextElement = document.getElementById('status-text');
            if (statusTextElement) {
                statusTextElement.textContent = statusText;
            } else {
                // Fallback to setting the entire timer status if span doesn't exist
                this.timerStatus.textContent = statusText;
            }
        }

        // Update status icon based on current mode (only for break modes or special states)
        if (this.currentMode !== 'focus' || isOvertime || this.isAutoPaused || (this.isPaused && !this.isRunning)) {
            this.updateStatusIcon();
        }

        // Update play/pause button
        if (this.isRunning && !this.isPaused && !this.isAutoPaused) {
            this.playIcon.style.display = 'none';
            this.pauseIcon.style.display = 'block';
        } else {
            this.playIcon.style.display = 'block';
            this.pauseIcon.style.display = 'none';
        }

        // Update main container class for background styling
        const mainContainer = document.querySelector('.container');
        let containerClass = `container ${this.currentMode}`;
        if (isOvertime) {
            containerClass += ' overtime';
        }
        mainContainer.className = containerClass;

        // Update body class to match current timer state for background (only in timer view)
        const body = document.body;
        const navigationManager = window.navigationManager;
        // Always apply timer classes if we're in timer view OR if navigation manager isn't initialized yet (default view is timer)
        if (body && (!navigationManager || navigationManager.currentView === 'timer')) {
            let bodyClass = `${this.currentMode}`;
            if (isOvertime) {
                bodyClass += ' overtime';
            }
            body.className = bodyClass;
        }

        // Update sidebar class to match current timer state
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            let sidebarClass = `sidebar ${this.currentMode}`;
            if (isOvertime) {
                sidebarClass += ' overtime';
            }
            sidebar.className = sidebarClass;
        }

        // Update timer container class for styling
        const timerContainer = document.querySelector('.timer-container');
        timerContainer.className = `timer-container ${this.currentMode}`;

        // Update controls class to match current timer state
        const controls = document.querySelector('.controls');
        if (controls) {
            controls.className = `controls ${this.currentMode}`;
        }

        // Add running class when timer is active
        if (this.isRunning) {
            timerContainer.classList.add('running');
        }

        // Add auto-paused class when in auto-pause state
        if (this.isAutoPaused) {
            timerContainer.classList.add('auto-paused');
        }

        // Add warning class when time is running low
        if (this.timeRemaining <= 120 && this.timeRemaining > 0 && this.isRunning) {
            timerContainer.classList.add('warning');
        }

        // Update page title
        const statusIcon = this.currentMode === 'focus' ? '🍅' : (this.currentMode === 'break' ? '😌' : '🎉');
        const overtimePrefix = isOvertime ? '+' : '';
        document.title = `${statusIcon} ${overtimePrefix}${displayMinutes.toString().padStart(2, '0')}:${displaySeconds.toString().padStart(2, '0')} - Presto`;

        // Update stop/undo button icon based on current mode
        this.updateStopUndoButton();

        // Update skip button icon based on current mode and next state
        this.updateSkipIcon();

        // Update progress dots
        this.updateProgressDots();

        // Update tray icon with timer information
        this.updateTrayIcon();

        // Hide smart pause countdown if not in focus mode
        if (this.currentMode !== 'focus') {
            this.stopSmartPauseCountdown();
        }
    }

    // Update status icon based on current mode
    updateStatusIcon() {
        if (!this.statusIcon) {
            console.error('Status icon element not found!');
            return;
        }

        // Define icon classes for different modes
        const iconClasses = {
            focus: 'ri-brain-line',
            break: 'ri-cup-fill',
            longBreak: 'ri-moon-line'
        };

        // Apply the appropriate Remix Icon class based on current mode
        const newClass = iconClasses[this.currentMode] || 'ri-brain-line';
        this.statusIcon.className = newClass;

        // Clear any fallback text content since we're using icons
        this.statusIcon.textContent = '';
    }

    // Update all setting indicators
    updateSettingIndicators() {
        console.log('🔄 Updating setting indicators...');
        console.log('autoStartTimer:', this.autoStartTimer);
        console.log('allowContinuousSessions:', this.allowContinuousSessions);
        console.log('smartPauseEnabled:', this.smartPauseEnabled);

        // Update smart pause indicator
        if (this.smartIndicator) {
            // Always show the indicator
            this.smartIndicator.style.display = 'block';

            if (this.smartPauseEnabled) {
                // Use filled bulb icon when active
                this.smartIndicator.className = 'ri-lightbulb-fill active';
            } else {
                // Use line bulb icon when inactive
                this.smartIndicator.className = 'ri-lightbulb-line';
            }
            console.log('✅ Smart indicator updated:', this.smartIndicator.className);
        } else {
            console.log('❌ Smart indicator element not found');
        }

        // Update auto-start indicator
        if (this.autoStartIndicator) {
            if (this.autoStartTimer) {
                // Use filled play icon when active
                this.autoStartIndicator.className = 'ri-play-circle-fill active';
            } else {
                // Use line play icon when inactive
                this.autoStartIndicator.className = 'ri-play-circle-line';
            }
            console.log('✅ Auto-start indicator updated:', this.autoStartIndicator.className);
        } else {
            console.log('❌ Auto-start indicator element not found');
        }

        // Update continuous session indicator
        if (this.continuousSessionIndicator) {
            if (this.allowContinuousSessions) {
                // Use filled repeat icon when active
                this.continuousSessionIndicator.className = 'ri-repeat-fill active';
            } else {
                // Use line repeat icon when inactive
                this.continuousSessionIndicator.className = 'ri-repeat-line';
            }
            console.log('✅ Continuous sessions indicator updated:', this.continuousSessionIndicator.className);
        } else {
            console.log('❌ Continuous sessions indicator element not found');
        }
    }

    // Legacy method for backward compatibility
    updateSmartIndicator() {
        this.updateSettingIndicators();
    }

    // Toggle smart pause on/off
    async toggleSmartPause() {
        const newState = !this.smartPauseEnabled;
        await this.enableSmartPause(newState);

        // Save the setting by updating checkbox and triggering auto-save
        if (window.settingsManager) {
            const smartPauseCheckbox = document.getElementById('smart-pause');
            if (smartPauseCheckbox) {
                smartPauseCheckbox.checked = newState;
                window.settingsManager.scheduleAutoSave();
            }
        }

        // Show notification
        const message = newState
            ? 'Smart Pause enabled! Timer will auto-pause during inactivity 🧠'
            : 'Smart Pause disabled 💡';
        NotificationUtils.showNotificationPing(message, 'info');
    }

    // Enable/disable auto-start timer
    async enableAutoStart(enabled) {
        this.autoStartTimer = enabled;
        console.log('📍 enableAutoStart called with:', enabled);

        // Update the indicator to reflect the new state
        this.updateSettingIndicators();
    }

    // Toggle auto-start on/off
    async toggleAutoStart() {
        const newState = !this.autoStartTimer;
        await this.enableAutoStart(newState);

        // Save the setting by updating checkbox and triggering auto-save
        if (window.settingsManager) {
            const autoStartCheckbox = document.getElementById('auto-start-timer');
            if (autoStartCheckbox) {
                autoStartCheckbox.checked = newState;
                window.settingsManager.scheduleAutoSave();
            }
        }

        // Show notification
        const message = newState
            ? 'Auto-start enabled! Sessions will start automatically ⚡'
            : 'Auto-start disabled 🛑';
        NotificationUtils.showNotificationPing(message, 'info');
    }

    // Enable/disable continuous sessions
    async enableContinuousSessions(enabled) {
        this.allowContinuousSessions = enabled;
        console.log('📍 enableContinuousSessions called with:', enabled);

        // Update the indicator to reflect the new state
        this.updateSettingIndicators();
    }

    // Toggle continuous sessions on/off
    async toggleContinuousSessions() {
        const newState = !this.allowContinuousSessions;
        await this.enableContinuousSessions(newState);

        // Save the setting by updating checkbox and triggering auto-save
        if (window.settingsManager) {
            const continuousCheckbox = document.getElementById('allow-continuous-sessions');
            if (continuousCheckbox) {
                continuousCheckbox.checked = newState;
                console.log('🔄 Toggle - Set checkbox to:', newState);
                console.log('🔄 Toggle - Checkbox actual value:', continuousCheckbox.checked);
                window.settingsManager.scheduleAutoSave();
            } else {
                console.log('❌ Toggle - Checkbox element not found!');
            }
        }

        // Show notification
        const message = newState
            ? 'Continuous Sessions enabled! Sessions will continue beyond timer ♾️'
            : 'Continuous Sessions disabled ⏹️';
        NotificationUtils.showNotificationPing(message, 'info');
    }

    updateButtons() {
        /*
        if (this.isRunning) {
          this.startBtn.disabled = true;
          this.pauseBtn.disabled = false;
          this.startBtn.textContent = 'Running...';
        } else if (this.isPaused) {
          this.startBtn.disabled = false;
          this.pauseBtn.disabled = true;
          this.startBtn.textContent = 'Resume';
        } else {
          this.startBtn.disabled = false;
          this.pauseBtn.disabled = true;
          this.startBtn.textContent = 'Start';
        }
        */
    }

    // Update stop/undo button icon based on current mode
    updateStopUndoButton() {
        // Check if DOM elements exist
        if (!this.stopIcon || !this.undoIcon) {
            console.error('Stop or undo icon elements not found!');
            console.log('stopIcon:', this.stopIcon);
            console.log('undoIcon:', this.undoIcon);
            return;
        }

        if (this.currentMode === 'focus') {
            // Show X icon during focus sessions for deletion
            this.stopIcon.style.display = 'block';
            this.undoIcon.style.display = 'none';
        } else {
            // Show undo icon during break/longBreak sessions (only if there's a session to undo)
            if (this.completedPomodoros > 0) {
                this.stopIcon.style.display = 'none';
                this.undoIcon.style.display = 'block';
            } else {
                // No sessions to undo, show X icon
                this.stopIcon.style.display = 'block';
                this.undoIcon.style.display = 'none';
            }
        }
    }

    // Update skip button icon based on current mode and next state
    updateSkipIcon() {
        // Hide all skip icons first
        this.skipCoffeeIcon.style.display = 'none';
        this.skipSleepIcon.style.display = 'none';
        this.skipBrainIcon.style.display = 'none';
        this.skipDefaultIcon.style.display = 'none';

        if (this.currentMode === 'focus') {
            // During focus: skip will go to break/longBreak
            // Show icon representing the next break type
            if ((this.completedPomodoros + 1) % 4 === 0) {
                // Next will be long break - show sleep icon
                this.skipSleepIcon.style.display = 'block';
            } else {
                // Next will be short break - show coffee icon
                this.skipCoffeeIcon.style.display = 'block';
            }
        } else {
            // During break/longBreak: skip will go to focus
            // Show brain icon
            this.skipBrainIcon.style.display = 'block';
        }
    }

    // Undo the last completed session
    async undoLastSession() {
        if (this.completedPomodoros === 0) {
            NotificationUtils.showNotificationPing('No sessions to undo! 🤷‍♂️', 'warning');
            return;
        }

        // Decrease completed pomodoros count
        this.completedPomodoros--;

        // Subtract the actual focus time from total (use stored time or fallback to duration)
        const timeToSubtract = this.lastCompletedSessionTime || this.durations.focus;
        this.totalFocusTime = Math.max(0, this.totalFocusTime - timeToSubtract);

        // Return to focus mode
        this.currentMode = 'focus';
        this.currentSession = this.completedPomodoros + 1;

        // Restore TagManager display when returning to focus mode
        if (window.tagManager) {
            window.tagManager.updateStatusDisplay();
        }

        // Reset timer to focus duration
        this.timeRemaining = this.durations.focus;
        this.isRunning = false;
        this.isPaused = false;
        this.isAutoPaused = false;
        clearInterval(this.timerInterval);

        // Reset session tracking
        this.sessionStartTime = null;
        this.currentSessionElapsedTime = 0;
        this.lastCompletedSessionTime = 0;
        this.sessionCompletedButNotSaved = false; // Reset flag
        this.maxSessionTimeReached = false; // Reset max session time flag

        // Reset timer accuracy tracking
        this.timerStartTime = null;
        this.timerDuration = null;
        this.lastUpdateTime = null;

        // Update all displays
        this.updateDisplay();
        await this.updateProgressDots();
        this.updateButtons();
        await this.saveSessionData();
        this.updateTrayIcon();

        // Show undo notification
        NotificationUtils.showNotificationPing('Last session undone! Back to focus mode 🔄', 'info', this.currentMode);

        // Update tray menu
        this.updateTrayMenu();
    }

    // Progress dots generation
    generateProgressDots() {
        if (!this.progressDots) return;

        // Clear existing dots
        this.progressDots.innerHTML = '';

        // Generate new dots based on totalSessions
        for (let i = 0; i < this.totalSessions; i++) {
            const dot = document.createElement('div');
            dot.className = 'dot';
            this.progressDots.appendChild(dot);
        }
    }

    // Progress dots update
    async updateProgressDots() {
        const dots = this.progressDots.querySelectorAll('.dot');

        // Remove any existing overflow indicators
        const existingOverflows = this.progressDots.querySelectorAll('.overflow-indicator');
        existingOverflows.forEach(overflow => overflow.remove());

        // Get actual completed sessions count from SessionManager
        const actualCompletedSessions = await this.getCompletedSessionsToday();

        // Update each dot based on actual completed sessions and current session
        dots.forEach((dot, index) => {
            // Remove all classes first
            dot.classList.remove('completed', 'current');

            if (index < actualCompletedSessions) {
                dot.classList.add('completed');
            } else if (index === actualCompletedSessions && this.currentMode === 'focus') {
                dot.classList.add('current');
            }
        });

        if (actualCompletedSessions > this.totalSessions) {
            const overflowCount = actualCompletedSessions - this.totalSessions;
            const overflowIndicator = document.createElement('div');
            overflowIndicator.className = 'overflow-indicator';
            overflowIndicator.textContent = `+${overflowCount}`;
            this.progressDots.appendChild(overflowIndicator);
        }
    }

    // Task Management
    async addTask() {
        if (!this.taskInput) return; // Skip if task input element doesn't exist

        const taskText = this.taskInput.value.trim();
        if (taskText) {
            const task = {
                id: Date.now(),
                text: taskText,
                completed: false,
                created_at: new Date().toISOString()
            };

            this.tasks.unshift(task);
            await this.saveTasks();
            this.renderTasks();
            this.taskInput.value = '';
        }
    }

    async markTaskCompleted(taskText) {
        const task = this.tasks.find(t => t.text === taskText && !t.completed);
        if (task) {
            task.completed = true;
            task.completed_at = new Date().toISOString();
            await this.saveTasks();
            this.renderTasks();
        }
    }

    async deleteTask(taskId) {
        this.tasks = this.tasks.filter(t => t.id !== taskId);
        await this.saveTasks();
        this.renderTasks();
    }

    renderTasks() {
        if (!this.taskList) return; // Skip if task list element doesn't exist

        this.taskList.innerHTML = '';

        // Show recent tasks (last 5)
        const recentTasks = this.tasks.slice(0, 5);

        recentTasks.forEach(task => {
            const taskEl = document.createElement('div');
            taskEl.className = `task-item ${task.completed ? 'completed' : ''}`;

            taskEl.innerHTML = `
        <span>${task.text}</span>
        <button class="task-delete" onclick="timer.deleteTask(${task.id})">×</button>
      `;

            this.taskList.appendChild(taskEl);
        });
    }

    // Weekly Statistics
    async updateWeeklyStats() {
        try {
            const history = await invoke('get_stats_history');
            this.renderWeeklyStats(history);
        } catch (error) {
            console.error('Failed to load history:', error);
            this.renderWeeklyStats([]);
        }
    }

    renderWeeklyStats(history) {
        const weeklyStatsContainer = document.getElementById('weekly-stats');
        if (!weeklyStatsContainer) return;

        const today = new Date();
        const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        weeklyStatsContainer.innerHTML = '';

        // Generate last 7 days
        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);

            const dayElement = document.createElement('div');
            dayElement.className = 'day-stat';

            if (i === 0) {
                dayElement.classList.add('today');
            }

            // Find data for this date
            const dayData = history.find(h => h.date === date.toDateString());
            const completed = dayData ? dayData.completed_pomodoros : 0;
            const focusTime = dayData ? dayData.total_focus_time : 0;

            if (completed > 0) {
                dayElement.classList.add('has-data');
            }

            const hours = Math.floor(focusTime / 3600);
            const minutes = Math.floor((focusTime % 3600) / 60);

            dayElement.innerHTML = `
        <div class="day-label">${weekDays[date.getDay()]}</div>
        <div class="day-count">${completed}</div>
        <div class="day-time">${hours}h ${minutes}m</div>
      `;

            weeklyStatsContainer.appendChild(dayElement);
        }
    }

    // History Modal
    async showHistoryModal() {
        try {
            const history = await invoke('get_stats_history');
            this.createHistoryModal(history);
        } catch (error) {
            console.error('Failed to load history:', error);
            NotificationUtils.showNotificationPing('Failed to load history 😞');
        }
    }

    createHistoryModal(history) {
        // Remove existing modal
        const existing = document.querySelector('.history-modal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.className = 'history-modal';

        modal.innerHTML = `
      <div class="history-content">
        <div class="history-header">
          <h3>Your Progress History</h3>
          <button class="close-btn">&times;</button>
        </div>
        <div class="history-list">
          ${history.length === 0 ? '<p>No history data yet. Start your first pomodoro session!</p>' :
                history.slice().reverse().map(day => {
                    const date = new Date(day.date);
                    const hours = Math.floor(day.total_focus_time / 3600);
                    const minutes = Math.floor((day.total_focus_time % 3600) / 60);

                    return `
                <div class="history-item">
                  <div class="history-date">${date.toLocaleDateString('it-IT', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    })}</div>
                  <div class="history-stats">
                    <span>🍅 ${day.completed_pomodoros} pomodoros</span>
                    <span>⏰ ${hours}h ${minutes}m focus</span>
                  </div>
                </div>
              `;
                }).join('')
            }
        </div>
      </div>
    `;

        document.body.appendChild(modal);

        // Add event listeners
        const closeBtn = modal.querySelector('.close-btn');
        closeBtn.addEventListener('click', () => this.closeHistoryModal());

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeHistoryModal();
            }
        });

        // Show modal with animation
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);
    }

    closeHistoryModal() {
        const modal = document.querySelector('.history-modal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => {
                if (modal.parentNode) {
                    modal.parentNode.removeChild(modal);
                }
            }, 300);
        }
    }

    // Data Persistence
    async saveTasks() {
        try {
            await invoke('save_tasks', { tasks: this.tasks });
        } catch (error) {
            console.error('Failed to save tasks:', error);
            // Fallback to localStorage
            localStorage.setItem('pomodoro-tasks', JSON.stringify(this.tasks));
        }
    }

    async loadTasks() {
        try {
            this.tasks = await invoke('load_tasks');
            console.log('Loaded tasks from Tauri:', this.tasks.length);
        } catch (error) {
            console.error('Failed to load tasks from Tauri, using localStorage:', error);
            const saved = localStorage.getItem('pomodoro-tasks');
            this.tasks = saved ? JSON.parse(saved) : [];
        }
    }

    async saveSessionData() {
        const data = {
            completed_pomodoros: this.completedPomodoros,
            total_focus_time: this.totalFocusTime,
            current_session: this.currentSession,
            date: new Date().toDateString()
        };

        try {
            await invoke('save_session_data', { session: data });
            // Also save daily stats for history
            await invoke('save_daily_stats', { session: data });
        } catch (error) {
            console.error('Failed to save session data:', error);
            // Fallback to localStorage
            localStorage.setItem('pomodoro-session', JSON.stringify(data));
        }

        // Update navigation charts if navigation manager is available
        if (window.navigationManager) {
            try {
                await window.navigationManager.updateDailyChart();
                await window.navigationManager.updateFocusSummary();
                await window.navigationManager.updateWeeklySessionsChart();
            } catch (error) {
                console.error('Failed to update navigation charts:', error);
            }
        }
    }

    async getCompletedSessionsToday() {
        if (!window.sessionManager) {
            return this.completedPomodoros; // Fallback to internal counter
        }

        try {
            const today = new Date(); // Pass Date object instead of string
            const todaySessions = await window.sessionManager.getSessionsForDate(today);
            return todaySessions ? todaySessions.length : 0;
        } catch (error) {
            console.error('Failed to get completed sessions from SessionManager:', error);
            return this.completedPomodoros; // Fallback to internal counter
        }
    }

    async saveCompletedFocusSession() {
        if (!window.sessionManager) {
            console.log('SessionManager not available, skipping individual session save');
            return;
        }

        const now = new Date();
        const durationMinutes = Math.round(this.lastCompletedSessionTime / 60);

        // Use preserved session start time if available, otherwise fall back to calculating backwards
        let startHour, startMinute;
        const actualSessionStartTime = this.lastSessionStartTime;
        
        console.log('Session saving debug:', {
            lastSessionStartTime: this.lastSessionStartTime,
            sessionStartTime: this.sessionStartTime,
            actualSessionStartTime: actualSessionStartTime,
            durationMinutes: durationMinutes,
            nowISO: now.toISOString(),
            nowLocal: now.toString()
        });
        
        if (actualSessionStartTime) {
            const sessionStart = new Date(actualSessionStartTime);
            startHour = sessionStart.getHours();
            startMinute = sessionStart.getMinutes();
            console.log('Using preserved session start time:', {
                timestampUTC: sessionStart.toISOString(),
                timestampLocal: sessionStart.toString(),
                extractedHour: startHour,
                extractedMinute: startMinute
            });
        } else {
            // Fallback to calculating backwards from duration
            const endHour = now.getHours();
            const endMinute = now.getMinutes();
            const startTotalMinutes = endHour * 60 + endMinute - durationMinutes;
            startHour = Math.max(0, Math.floor(startTotalMinutes / 60));
            startMinute = Math.max(0, startTotalMinutes % 60);
            console.log('Using fallback calculation for session start time (no preserved time available)');
        }

        const endHour = now.getHours();
        const endMinute = now.getMinutes();
        
        console.log('Final time values:', {
            startHour: startHour,
            startMinute: startMinute,
            endHour: endHour,
            endMinute: endMinute,
            startTimeString: `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}`,
            endTimeString: `${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}`
        });

        // Get current tags from TagManager
        const currentTags = window.tagManager ? window.tagManager.getCurrentTags() : [];
        
        const sessionData = {
            id: `timer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            session_type: 'focus',
            duration: durationMinutes,
            start_time: `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}`,
            end_time: `${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}`,
            notes: this.currentTask && this.currentTask.trim() ? this.currentTask.trim() : null,
            tags: currentTags, // Include current tags from TagManager
            created_at: now.toISOString()
        };

        try {
            await window.sessionManager.addSession(sessionData);
            console.log('Timer session saved to SessionManager:', sessionData);
            
            // Clear the preserved session start time after successful save
            this.lastSessionStartTime = null;
            console.log('Cleared lastSessionStartTime after successful save');
        } catch (error) {
            console.error('Failed to save timer session to SessionManager:', error);
        }
    }

    async loadSessionData(forceReset = false) {
        const today = new Date().toDateString();
        
        // Update current date string for midnight monitoring
        this.currentDateString = today;
        
        try {
            const data = await invoke('load_session_data');
            if (data && data.date === today && !forceReset) {
                // Load today's session data
                this.completedPomodoros = data.completed_pomodoros || 0;
                this.totalFocusTime = data.total_focus_time || 0;
                this.currentSession = data.current_session || 1;
                await this.updateProgressDots();
                console.log('📊 Loaded existing session data for today');
            } else {
                // Reset to default values for new day, no data, or forced reset
                this.completedPomodoros = 0;
                this.totalFocusTime = 0;
                this.currentSession = 1;
                await this.updateProgressDots();
                console.log('🌅 Reset session data for new day or forced reset');
            }
        } catch (error) {
            console.error('Failed to load session data from Tauri, using localStorage:', error);
            const saved = localStorage.getItem('pomodoro-session');
            
            if (saved) {
                const data = JSON.parse(saved);
                if (data.date === today && !forceReset) {
                    // Load today's session data from localStorage
                    this.completedPomodoros = data.completedPomodoros || 0;
                    this.totalFocusTime = data.totalFocusTime || 0;
                    this.currentSession = data.currentSession || 1;
                    await this.updateProgressDots();
                    console.log('📊 Loaded existing session data from localStorage');
                } else {
                    // Reset to default values for new day, no data, or forced reset
                    this.completedPomodoros = 0;
                    this.totalFocusTime = 0;
                    this.currentSession = 1;
                    await this.updateProgressDots();
                    console.log('🌅 Reset session data from localStorage for new day or forced reset');
                }
            } else {
                // No saved data at all, reset to defaults
                this.completedPomodoros = 0;
                this.totalFocusTime = 0;
                this.currentSession = 1;
                await this.updateProgressDots();
                console.log('🌅 No saved data found, using defaults');
            }
        }
    }

    // Simple notification system
    async showNotification() {
        try {
            // Check if we're in a Tauri context and use Tauri notifications
            if (window.__TAURI__ && window.__TAURI__.notification) {
                const { isPermissionGranted, requestPermission, sendNotification } = window.__TAURI__.notification;

                // Check if permission is granted
                let permissionGranted = await isPermissionGranted();

                // If not granted, request permission
                if (!permissionGranted) {
                    const permission = await requestPermission();
                    permissionGranted = permission === 'granted';
                }

                // Send notification if permission is granted
                if (permissionGranted) {
                    const messages = {
                        focus: 'Break time! Take a rest 😌',
                        break: 'Break over! Time to focus 🍅',
                        longBreak: 'Long break over! Ready for more focus? 🚀'
                    };

                    await sendNotification({
                        title: 'Presto - Pomodoro Timer',
                        body: messages[this.currentMode],
                        icon: '/assets/tauri.svg'
                    });
                }
            } else {
                // Fallback to Web Notification API
                if ('Notification' in window && Notification.permission === 'granted') {
                    const messages = {
                        focus: 'Break time! Take a rest 😌',
                        break: 'Break over! Time to focus 🍅',
                        longBreak: 'Long break over! Ready for more focus? 🚀'
                    };

                    NotificationUtils.showDesktopNotification('Presto - Pomodoro Timer', messages[this.currentMode]);
                }
            }
        } catch (error) {
            console.error('Failed to show notification:', error);
            // Fallback to in-app notification
            this.showNotificationPing(
                this.currentMode === 'focus' ? 'Break time! Take a rest 😌' :
                    this.currentMode === 'break' ? 'Break over! Time to focus 🍅' :
                        'Long break over! Ready for more focus? 🚀'
            );
        }
    }

    // Add warning styling
    addWarningClass() {
        const container = document.querySelector('.timer-container');
        if (!container.classList.contains('warning')) {
            container.classList.add('warning');
        }
    }

    // Update tray icon with timer information
    async updateTrayIcon() {
        try {
            let displayMinutes, displaySeconds, isOvertime = false;

            if (this.timeRemaining < 0 && this.allowContinuousSessions) {
                // Show overtime in continuous sessions
                isOvertime = true;
                const overtimeSeconds = Math.abs(this.timeRemaining);
                displayMinutes = Math.floor(overtimeSeconds / 60);
                displaySeconds = overtimeSeconds % 60;
            } else {
                // Normal display or traditional mode
                const absTime = Math.abs(this.timeRemaining);
                displayMinutes = Math.floor(absTime / 60);
                displaySeconds = absTime % 60;
            }

            const timerText = `${displayMinutes.toString().padStart(2, '0')}:${displaySeconds.toString().padStart(2, '0')}`;
            const overtimePrefix = isOvertime ? '+' : '';
            const fullTimerText = `${overtimePrefix}${timerText}`;

            // Add session counter to timer text
            const sessionCounter = `(${this.completedPomodoros}/${this.totalSessions})`;
            const completeTimerText = `${fullTimerText} ${sessionCounter}`;

            // Define icons for different modes
            const modeIcons = {
                focus: '🧠',
                break: '☕',
                longBreak: '🌙'
            };

            // Show pause icon if timer is paused or auto-paused
            let modeIcon;
            if (this.isPaused || this.isAutoPaused) {
                modeIcon = '⏸️';
            } else if (isOvertime) {
                // Show overtime indicator in tray
                modeIcon = '⏰';
            } else {
                modeIcon = modeIcons[this.currentMode] || '🧠';
            }

            await invoke('update_tray_icon', {
                timerText: completeTimerText,
                isRunning: this.isRunning,
                sessionMode: this.currentMode,
                currentSession: this.currentSession,
                totalSessions: this.totalSessions,
                modeIcon: modeIcon
            });
        } catch (error) {
            console.warn('Failed to update tray icon:', error);
        }
    }

    async applySettings(settings) {
        // Update timer durations
        this.durations.focus = settings.timer.focus_duration * 60;
        this.durations.break = settings.timer.break_duration * 60;
        this.durations.longBreak = settings.timer.long_break_duration * 60;

        // Apply debug mode if enabled (overrides all timer durations)
        if (settings.advanced?.debug_mode) {
            console.log('Debug mode enabled - all timers set to 3 seconds');
            this.durations.focus = 3;
            this.durations.break = 3;
            this.durations.longBreak = 3;
        }

        this.totalSessions = settings.timer.total_sessions;
        
        // Update max session time (convert from minutes to milliseconds)
        this.maxSessionTime = (settings.timer.max_session_time || 120) * 60 * 1000;

        // If timer is not running, update current time remaining
        if (!this.isRunning) {
            this.timeRemaining = this.durations[this.currentMode];
            this.updateDisplay();
        }

        // Regenerate progress dots when total sessions change
        this.generateProgressDots();
        await this.updateProgressDots();

        // Update notification preferences
        this.enableDesktopNotifications = settings.notifications.desktop_notifications;
        this.enableSoundNotifications = settings.notifications.sound_notifications;

        // Enable auto-start using the dedicated method
        await this.enableAutoStart(settings.notifications.auto_start_timer);

        // Enable continuous sessions using the dedicated method
        await this.enableContinuousSessions(settings.notifications.allow_continuous_sessions || false);

        // Update debug mode state
        this.debugMode = settings.advanced?.debug_mode || false;

        console.log('🔧 Applying settings in PomodoroTimer:');
        console.log('Auto-start timer setting:', this.autoStartTimer);
        console.log('Allow continuous sessions setting:', this.allowContinuousSessions);
        console.log('Debug mode setting:', this.debugMode);

        // Update smart pause setting and timeout
        this.inactivityThreshold = (settings.notifications.smart_pause_timeout || 30) * 1000; // convert to milliseconds

        // Update keyboard shortcuts
        if (settings.shortcuts) {
            this.updateKeyboardShortcuts(settings.shortcuts);
        }

        // Update backend timeout if smart pause is enabled and monitoring is active
        if (this.smartPauseEnabled) {
            try {
                const timeoutSeconds = Math.floor(this.inactivityThreshold / 1000);
                await invoke('update_activity_timeout', { timeoutSeconds: timeoutSeconds });
            } catch (error) {
                console.log('Activity monitoring not active or failed to update timeout:', error);
            }
        }

        // Enable smart pause using the dedicated method
        await this.enableSmartPause(settings.notifications.smart_pause);

        // Apply audio settings
        if (settings.audio && window.audioManager) {
            window.audioManager.setClockTickEnabled(settings.audio.clock_tick_enabled || false);
            window.audioManager.setVolume((settings.audio.clock_tick_volume || 50) / 100);
        }

        // Update all setting indicators to reflect current state
        console.log('🔄 Calling updateSettingIndicators from applySettings...');
        this.updateSettingIndicators();
    }

    resetToInitialState() {
        // Stop any running timer
        this.isRunning = false;
        this.isPaused = false;
        this.isAutoPaused = false;
        clearInterval(this.timerInterval);

        // Clear smart pause timeout and disable
        if (this.activityTimeout) {
            clearTimeout(this.activityTimeout);
            this.activityTimeout = null;
        }
        this.stopSmartPauseCountdown();
        this.smartPauseEnabled = false;
        this.inactivityThreshold = 30000; // Reset to default 30 seconds

        // Clear midnight monitoring
        this.stopMidnightMonitoring();

        // Reset all counters and state
        this.completedPomodoros = 0;
        this.generateProgressDots();
        this.updateProgressDots();
        this.currentSession = 1;
        this.totalFocusTime = 0;
        this.currentMode = 'focus';

        // Reset session tracking
        this.sessionStartTime = null;
        this.currentSessionElapsedTime = 0;
        this.lastCompletedSessionTime = 0;
        this.maxSessionTimeReached = false; // Reset max session time flag

        // Reset timer accuracy tracking
        this.timerStartTime = null;
        this.timerDuration = null;
        this.lastUpdateTime = null;

        // Reset durations to defaults
        this.durations = {
            focus: 25 * 60,
            break: 5 * 60,
            longBreak: 20 * 60
        };
        this.totalSessions = 10;

        // Reset timer display
        this.timeRemaining = this.durations[this.currentMode];

        // Clear task input
        this.currentTask = '';
        if (this.taskInput) {
            this.taskInput.value = '';
        }

        // Reset notification preferences to defaults
        this.autoStartTimer = true;
        this.allowContinuousSessions = false;

        // Update all displays
        this.updateDisplay();
        this.updateButtons();
        this.renderTasks();
        this.updateWeeklyStats();
        this.updateTrayIcon();
        this.updateSettingIndicators();

        // Restart midnight monitoring
        this.startMidnightMonitoring();

        console.log('Timer reset to initial state');
    }

    /**
     * Handle audio based on current mode and running state
     */
    handleAudioForModeChange() {
        if (!window.audioManager) return;

        // Stop ticking if we're not in focus mode or not running
        if (this.currentMode !== 'focus' || !this.isRunning || this.isPaused) {
            window.audioManager.stopClockTicking();
        } else {
            // Start ticking if we're in focus mode and running
            if (window.audioManager.isClockTickingEnabled()) {
                window.audioManager.startClockTicking();
            }
        }
    }
}
