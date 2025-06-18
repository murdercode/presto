// Settings Manager for Global Shortcuts and Preferences
const { invoke } = window.__TAURI__.core;
import { NotificationUtils, KeyboardUtils, StorageUtils } from '../utils/common-utils.js';
import { TIMER_THEMES, getThemeById, getAllThemes, getCompatibleThemes, isThemeCompatible, getDefaultTheme, registerTheme } from '../utils/timer-themes.js';
import { initializeAutoThemeLoader } from '../utils/theme-loader.js';

export class SettingsManager {
    constructor() {
        this.settings = null;
        this.isRecordingShortcut = false;
        this.currentRecordingField = null;
        this.recordedKeys = [];
        this.autoSaveTimeout = null;
        this.autoSaveDelay = 1000; // 1 second delay for auto-save
    }

    async init() {
        // Clean up any existing auto-save feedback elements
        this.cleanupOldNotificationElements();

        // Load settings first
        await this.loadSettings();

        // Initialize auto theme loader to discover and load all themes
        await this.initializeAutoThemeLoader();

        this.setupEventListeners();
        await this.registerGlobalShortcuts();
        this.setupGlobalShortcutHandlers();
        this.setupSettingsNavigation();
        await this.initializeTheme();
        await this.initializeTimerTheme();
    }

    async initializeAutoThemeLoader() {
        try {
            console.log('🎨 Starting auto theme discovery...');
            const loadedThemes = await initializeAutoThemeLoader();
            console.log(`🎨 Auto-loaded ${loadedThemes.length} themes:`, loadedThemes);

            // Refresh theme selector if it exists and settings are loaded
            if (document.getElementById('timer-theme-grid') && this.settings) {
                this.initializeTimerThemeSelector();
            }

            return loadedThemes;
        } catch (error) {
            console.error('❌ Failed to initialize auto theme loader:', error);
            return [];
        }
    }

    cleanupOldNotificationElements() {
        // Remove any old auto-save feedback elements that might exist
        const oldFeedback = document.getElementById('auto-save-feedback');
        if (oldFeedback) {
            oldFeedback.remove();
        }
    }

    async loadSettings() {
        try {
            const loadedSettings = await invoke('load_settings');
            console.log('📋 Raw loaded settings:', loadedSettings);
            // Merge loaded settings with defaults to ensure all fields exist
            this.settings = this.mergeWithDefaults(loadedSettings);
            console.log('📋 Final merged settings:', this.settings);
            this.populateSettingsUI();
        } catch (error) {
            console.error('Failed to load settings:', error);
            this.settings = this.getDefaultSettings();
        }
    }

    // Merge loaded settings with defaults to ensure all required fields exist
    mergeWithDefaults(loadedSettings) {
        const defaultSettings = this.getDefaultSettings();

        return {
            shortcuts: { ...defaultSettings.shortcuts, ...loadedSettings.shortcuts },
            timer: { ...defaultSettings.timer, ...loadedSettings.timer },
            notifications: { ...defaultSettings.notifications, ...loadedSettings.notifications },
            appearance: { ...defaultSettings.appearance, ...loadedSettings.appearance },
            advanced: { ...defaultSettings.advanced, ...loadedSettings.advanced },
            autostart: loadedSettings.autostart !== undefined ? loadedSettings.autostart : defaultSettings.autostart,
            analytics_enabled: loadedSettings.analytics_enabled !== undefined ? loadedSettings.analytics_enabled : defaultSettings.analytics_enabled
        };
    }

    getDefaultSettings() {
        return {
            shortcuts: {
                start_stop: "CommandOrControl+Alt+Space",
                reset: "CommandOrControl+Alt+R", // Delete Session (focus) / Undo (break)
                skip: "CommandOrControl+Alt+S"   // Save Session
            },
            timer: {
                focus_duration: 25,
                break_duration: 5,
                long_break_duration: 20,
                total_sessions: 10,
                weekly_goal_minutes: 125
            },
            notifications: {
                desktop_notifications: true,
                sound_notifications: true,
                auto_start_timer: true, // Renamed from auto_start_breaks
                allow_continuous_sessions: false, // Allow sessions to continue beyond timer
                smart_pause: false,
                smart_pause_timeout: 30 // default 30 seconds
            },
            appearance: {
                theme: "auto", // auto, light, dark
                timer_theme: "espresso" // Timer color theme
            },
            advanced: {
                debug_mode: false // Debug mode with 3-second timers
            },
            autostart: false, // default to disabled
            analytics_enabled: true // Analytics enabled by default
        };
    }

    populateSettingsUI() {
        // Populate shortcuts
        console.log('🔧 Populating shortcuts UI with:', this.settings.shortcuts);
        document.getElementById('start-stop-shortcut').value = this.settings.shortcuts.start_stop || '';
        document.getElementById('reset-shortcut').value = this.settings.shortcuts.reset || '';
        document.getElementById('skip-shortcut').value = this.settings.shortcuts.skip || '';

        // Populate timer settings
        document.getElementById('focus-duration').value = this.settings.timer.focus_duration;
        document.getElementById('break-duration').value = this.settings.timer.break_duration;
        document.getElementById('long-break-duration').value = this.settings.timer.long_break_duration;
        document.getElementById('total-sessions').value = this.settings.timer.total_sessions;

        // Populate weekly goal
        const weeklyGoalField = document.getElementById('weekly-goal-minutes');
        if (weeklyGoalField) {
            weeklyGoalField.value = this.settings.timer.weekly_goal_minutes || 125;
        }

        // Populate appearance settings
        const themeSelect = document.getElementById('theme-select');
        if (themeSelect) {
            themeSelect.value = this.settings.appearance?.theme || 'auto';
        }

        // Populate theme selector buttons
        this.initializeThemeSelector();

        // Populate timer theme selector
        this.initializeTimerThemeSelector();

        // Populate notification settings
        // Check current notification permission and adjust desktop notifications setting
        const hasNotificationPermission = NotificationUtils.getNotificationPermission() === 'granted';
        const desktopNotificationsEnabled = this.settings.notifications.desktop_notifications && hasNotificationPermission;

        document.getElementById('desktop-notifications').checked = desktopNotificationsEnabled;
        document.getElementById('sound-notifications').checked = this.settings.notifications.sound_notifications;
        document.getElementById('auto-start-timer').checked = this.settings.notifications.auto_start_timer;

        // Debug log for continuous sessions
        console.log('🔧 PopulateUI - Raw continuous sessions value:', this.settings.notifications.allow_continuous_sessions);
        const continuousValue = this.settings.notifications.allow_continuous_sessions || false;
        console.log('🔧 PopulateUI - Final continuous sessions value:', continuousValue);

        document.getElementById('allow-continuous-sessions').checked = continuousValue;
        document.getElementById('smart-pause').checked = this.settings.notifications.smart_pause;

        // Populate smart pause timeout
        const timeoutValue = this.settings.notifications.smart_pause_timeout || 30;
        document.getElementById('smart-pause-timeout').value = timeoutValue;
        document.getElementById('timeout-value').textContent = timeoutValue;

        // Show/hide timeout setting based on smart pause checkbox
        this.toggleTimeoutSetting(this.settings.notifications.smart_pause);

        // Setup slider event listener
        this.setupSliderEventListener();

        // Populate advanced settings
        const debugModeCheckbox = document.getElementById('debug-mode');
        if (debugModeCheckbox) {
            debugModeCheckbox.checked = this.settings.advanced?.debug_mode || false;
        }

        // Populate autostart setting and check current system status
        this.loadAutostartSetting();

        // Populate analytics setting
        this.loadAnalyticsSetting();
    }

    setupEventListeners() {
        // Shortcut input listeners
        const shortcutInputs = document.querySelectorAll('.shortcut-input');
        shortcutInputs.forEach(input => {
            input.addEventListener('click', (e) => this.startRecordingShortcut(e.target));
            input.addEventListener('keydown', (e) => this.handleShortcutKeydown(e));
            input.addEventListener('blur', () => this.stopRecordingShortcut());
        });

        // Global shortcut listeners
        window.addEventListener('keydown', (e) => {
            if (this.isRecordingShortcut) {
                this.handleShortcutKeydown(e);
            }
        });

        // Smart pause checkbox event listener
        const smartPauseCheckbox = document.getElementById('smart-pause');
        if (smartPauseCheckbox) {
            smartPauseCheckbox.addEventListener('change', (e) => {
                this.toggleTimeoutSetting(e.target.checked);

                // Call the timer's enableSmartPause method directly to ensure consistency
                if (window.pomodoroTimer) {
                    // Use enableSmartPause instead of toggleSmartPause to avoid toggling twice
                    window.pomodoroTimer.enableSmartPause(e.target.checked).then(() => {
                        // Update the indicator to reflect the new state
                        window.pomodoroTimer.updateSettingIndicators();
                        // Schedule auto-save after the smart pause state is updated
                        this.scheduleAutoSave();
                    });
                } else {
                    // If timer is not available, just save the setting
                    this.scheduleAutoSave();
                }
            });
        }

        // Continuous sessions checkbox event listener
        const continuousSessionsCheckbox = document.getElementById('allow-continuous-sessions');
        if (continuousSessionsCheckbox) {
            continuousSessionsCheckbox.addEventListener('change', (e) => {
                // Call the timer's enableContinuousSessions method directly to ensure consistency
                if (window.pomodoroTimer) {
                    // Use enableContinuousSessions instead of toggleContinuousSessions to avoid toggling twice
                    window.pomodoroTimer.enableContinuousSessions(e.target.checked).then(() => {
                        // Update the indicator to reflect the new state
                        window.pomodoroTimer.updateSettingIndicators();
                        // Schedule auto-save after the continuous sessions state is updated
                        this.scheduleAutoSave();
                    });
                } else {
                    // If timer is not available, just save the setting
                    this.scheduleAutoSave();
                }
            });
        }

        // Auto-start timer checkbox event listener
        const autoStartCheckbox = document.getElementById('auto-start-timer');
        if (autoStartCheckbox) {
            autoStartCheckbox.addEventListener('change', (e) => {
                // Call the timer's enableAutoStart method directly to ensure consistency
                if (window.pomodoroTimer) {
                    // Use enableAutoStart instead of toggleAutoStart to avoid toggling twice
                    window.pomodoroTimer.enableAutoStart(e.target.checked).then(() => {
                        // Update the indicator to reflect the new state
                        window.pomodoroTimer.updateSettingIndicators();
                        // Schedule auto-save after the auto-start state is updated
                        this.scheduleAutoSave();
                    });
                } else {
                    // If timer is not available, just save the setting
                    this.scheduleAutoSave();
                }
            });
        }

        // Audio detection listeners
        this.setupAudioDetectionListeners();

        // Setup auto-save listeners for all settings fields
        this.setupAutoSaveListeners();
    }

    toggleTimeoutSetting(enabled) {
        const timeoutSetting = document.getElementById('smart-pause-timeout-setting');
        if (timeoutSetting) {
            if (enabled) {
                timeoutSetting.classList.add('visible');
            } else {
                timeoutSetting.classList.remove('visible');
            }
        }
    }

    setupAudioDetectionListeners() {
        // Audio detection enable/disable checkbox
        const audioDetectionCheckbox = document.getElementById('audio-detection-enabled');
        if (audioDetectionCheckbox) {
            audioDetectionCheckbox.addEventListener('change', async (e) => {
                if (e.target.checked) {
                    try {
                        await this.startAudioDetection();
                    } catch (error) {
                        console.error('Failed to start audio detection:', error);
                        e.target.checked = false;
                        alert('Failed to start audio detection. Make sure you have granted microphone permissions.');
                    }
                } else {
                    await this.stopAudioDetection();
                }
                this.scheduleAutoSave();
            });
        }

        // Detection sensitivity slider
        const sensitivitySlider = document.getElementById('detection-sensitivity');
        const sensitivityValue = document.getElementById('sensitivity-value');
        if (sensitivitySlider && sensitivityValue) {
            sensitivitySlider.addEventListener('input', (e) => {
                sensitivityValue.textContent = e.target.value;
                this.scheduleAutoSave();
            });
        }

        // Audio detection control buttons
        const startButton = document.getElementById('start-audio-detection');
        const stopButton = document.getElementById('stop-audio-detection');
        const testButton = document.getElementById('test-audio-detection');

        if (startButton) {
            startButton.addEventListener('click', async () => {
                try {
                    await this.startAudioDetection();
                    document.getElementById('audio-detection-enabled').checked = true;
                } catch (error) {
                    console.error('Failed to start audio detection:', error);
                    alert('Failed to start audio detection. Please check your microphone permissions.');
                }
            });
        }

        if (stopButton) {
            stopButton.addEventListener('click', async () => {
                await this.stopAudioDetection();
                document.getElementById('audio-detection-enabled').checked = false;
            });
        }

        if (testButton) {
            testButton.addEventListener('click', async () => {
                await this.testAudioDetection();
            });
        }

        // Setup status monitoring if conversation manager is available
        if (window.conversationManager) {
            this.setupAudioStatusMonitoring();
        }
    }

    async startAudioDetection() {
        if (!window.conversationManager) {
            throw new Error('Conversation manager not available');
        }

        try {
            await window.conversationManager.startMonitoring();
            this.updateAudioDetectionButtons(true);
            this.updateAudioDetectionStatus();
            console.log('✅ Audio detection started successfully');
        } catch (error) {
            console.error('❌ Failed to start audio detection:', error);
            throw error;
        }
    }

    async stopAudioDetection() {
        if (!window.conversationManager) {
            return;
        }

        try {
            await window.conversationManager.stopMonitoring();
            this.updateAudioDetectionButtons(false);
            this.resetAudioDetectionStatus();
            console.log('✅ Audio detection stopped successfully');
        } catch (error) {
            console.error('❌ Failed to stop audio detection:', error);
        }
    }

    async testAudioDetection() {
        try {
            const testResult = await window.conversationManager.testAudioDetection();

            // Show test results in an alert
            const formatted = window.conversationManager.formatActivity(testResult);
            alert(`Audio Detection Test Results:\n\n${formatted}\n\nThis is a quick test of your audio setup.`);

        } catch (error) {
            console.error('❌ Audio detection test failed:', error);
            alert('Audio detection test failed. Please check your audio setup and permissions.');
        }
    }

    updateAudioDetectionButtons(isRunning) {
        const startButton = document.getElementById('start-audio-detection');
        const stopButton = document.getElementById('stop-audio-detection');

        if (startButton && stopButton) {
            startButton.disabled = isRunning;
            stopButton.disabled = !isRunning;
        }
    }

    setupAudioStatusMonitoring() {
        // Set up real-time status updates
        window.conversationManager.onStatusChange((activity) => {
            this.updateAudioStatusDisplay(activity);
        });

        // Update status immediately if monitoring is active
        if (window.conversationManager.getMonitoringInfo().isMonitoring) {
            this.updateAudioDetectionButtons(true);
            this.updateAudioDetectionStatus();
        }
    }

    updateAudioStatusDisplay(activity) {
        const monitoringStatus = document.getElementById('monitoring-status');
        const micStatus = document.getElementById('mic-status');
        const speakerStatus = document.getElementById('speaker-status');
        const conversationStatus = document.getElementById('conversation-status');
        const confidenceLevel = document.getElementById('confidence-level');

        if (monitoringStatus) {
            monitoringStatus.textContent = window.conversationManager.isMonitoring ? '🟢 Active' : '🔴 Stopped';
            monitoringStatus.className = window.conversationManager.isMonitoring ? 'status-value active' : 'status-value inactive';
        }

        if (micStatus) {
            const isActive = activity.is_microphone_active;
            micStatus.textContent = isActive ? `🎤 Active (${(activity.input_level * 100).toFixed(1)}%)` : '🔇 Inactive';
            micStatus.className = isActive ? 'status-value active' : 'status-value inactive';
        }

        if (speakerStatus) {
            const isActive = activity.is_speakers_active;
            speakerStatus.textContent = isActive ? `🔊 Active (${(activity.output_level * 100).toFixed(1)}%)` : '🔇 Inactive';
            speakerStatus.className = isActive ? 'status-value active' : 'status-value inactive';
        }

        if (conversationStatus) {
            const inConversation = activity.is_microphone_active && activity.is_speakers_active;
            conversationStatus.textContent = inConversation ? '✅ Yes' : '❌ No';
            conversationStatus.className = inConversation ? 'status-value conversation-active' : 'status-value inactive';
        }

        if (confidenceLevel) {
            const confidence = Math.round(activity.confidence * 100);
            confidenceLevel.textContent = `${confidence}%`;
            confidenceLevel.className = confidence > 70 ? 'status-value active' : 'status-value';
        }
    }

    async updateAudioDetectionStatus() {
        if (!window.conversationManager || !window.conversationManager.isMonitoring) {
            this.resetAudioDetectionStatus();
            return;
        }

        try {
            const activity = await window.conversationManager.getStatus();
            if (activity) {
                this.updateAudioStatusDisplay(activity);
            }
        } catch (error) {
            console.error('Failed to get audio status:', error);
        }
    }

    resetAudioDetectionStatus() {
        const defaultActivity = {
            is_microphone_active: false,
            is_speakers_active: false,
            input_level: 0.0,
            output_level: 0.0,
            confidence: 0.0
        };
        this.updateAudioStatusDisplay(defaultActivity);

        const monitoringStatus = document.getElementById('monitoring-status');
        if (monitoringStatus) {
            monitoringStatus.textContent = '🔴 Stopped';
            monitoringStatus.className = 'status-value inactive';
        }
    }

    setupGlobalShortcutHandlers() {
        // Debounce mechanism to prevent repeated triggering
        let lastShortcutTime = {};
        const debounceDelay = 500; // 500ms debounce

        // Listen for global shortcut events from Rust
        window.__TAURI__.event.listen('global-shortcut', (event) => {
            const action = event.payload;
            const now = Date.now();

            // Check if this action was triggered too recently
            if (lastShortcutTime[action] && (now - lastShortcutTime[action]) < debounceDelay) {
                console.log(`Debounced global shortcut: ${action}`);
                return;
            }

            lastShortcutTime[action] = now;
            console.log(`Global shortcut triggered: ${action}`);

            switch (action) {
                case 'start-stop':
                    if (window.pomodoroTimer) {
                        if (window.pomodoroTimer.isRunning && !window.pomodoroTimer.isPaused && !window.pomodoroTimer.isAutoPaused) {
                            window.pomodoroTimer.pauseTimer();
                        } else {
                            window.pomodoroTimer.startTimer();
                        }
                    }
                    break;
                case 'reset':
                    if (window.pomodoroTimer) {
                        if (window.pomodoroTimer.currentMode === 'focus') {
                            window.pomodoroTimer.resetTimer();
                        } else {
                            window.pomodoroTimer.undoLastSession();
                        }
                    }
                    break;
                case 'skip':
                    if (window.pomodoroTimer) {
                        window.pomodoroTimer.skipSession();
                    }
                    break;
            }
        });

        // Listen for shortcuts update events
        window.__TAURI__.event.listen('shortcuts-updated', (event) => {
            console.log('Shortcuts updated:', event.payload);
            this.settings.shortcuts = event.payload;

            // Update the timer's keyboard shortcuts
            if (window.pomodoroTimer) {
                window.pomodoroTimer.updateKeyboardShortcuts(this.settings.shortcuts);
            }
        });
    }

    startRecordingShortcut(input) {
        if (this.isRecordingShortcut) return;

        this.isRecordingShortcut = true;
        this.currentRecordingField = input;
        this.recordedKeys = [];

        input.classList.add('recording');
        input.value = 'Press keys...';
        input.focus();
    }

    stopRecordingShortcut() {
        if (!this.isRecordingShortcut) return;

        this.isRecordingShortcut = false;

        if (this.currentRecordingField) {
            this.currentRecordingField.classList.remove('recording');

            if (this.recordedKeys.length > 0) {
                const shortcut = this.formatShortcut(this.recordedKeys);
                this.currentRecordingField.value = shortcut;
            } else {
                this.currentRecordingField.value = '';
            }
        }

        this.currentRecordingField = null;
        this.recordedKeys = [];
    }

    handleShortcutKeydown(e) {
        if (!this.isRecordingShortcut) return;

        e.preventDefault();
        e.stopPropagation();

        const key = e.key;
        const modifiers = [];

        if (e.metaKey || e.ctrlKey) modifiers.push('CommandOrControl');
        if (e.altKey) modifiers.push('Alt');
        if (e.shiftKey) modifiers.push('Shift');

        // Don't record modifier keys alone
        if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) return;

        this.recordedKeys = [...modifiers, key];

        if (this.currentRecordingField) {
            this.currentRecordingField.value = this.formatShortcut(this.recordedKeys);
        }

        // Auto-finish recording after a short delay
        setTimeout(() => {
            this.stopRecordingShortcut();
            // Schedule auto-save after shortcut is set
            this.scheduleAutoSave();
        }, 500);
    }

    formatShortcut(keys) {
        return keys.join('+');
    }

    async saveSettings() {
        try {
            // Get values from UI
            this.settings.shortcuts.start_stop = document.getElementById('start-stop-shortcut').value || null;
            this.settings.shortcuts.reset = document.getElementById('reset-shortcut').value || null;
            this.settings.shortcuts.skip = document.getElementById('skip-shortcut').value || null;

            this.settings.timer.focus_duration = parseInt(document.getElementById('focus-duration').value);
            this.settings.timer.break_duration = parseInt(document.getElementById('break-duration').value);
            this.settings.timer.long_break_duration = parseInt(document.getElementById('long-break-duration').value);
            this.settings.timer.total_sessions = parseInt(document.getElementById('total-sessions').value);

            // Appearance settings
            const themeSelect = document.getElementById('theme-select');
            if (themeSelect) {
                this.settings.appearance.theme = themeSelect.value;
                await this.applyTheme(themeSelect.value);
            }

            // Apply timer theme
            await this.applyTimerTheme(this.settings.appearance.timer_theme);

            this.settings.notifications.desktop_notifications = document.getElementById('desktop-notifications').checked;
            this.settings.notifications.sound_notifications = document.getElementById('sound-notifications').checked;
            this.settings.notifications.auto_start_timer = document.getElementById('auto-start-timer').checked;
            this.settings.notifications.allow_continuous_sessions = document.getElementById('allow-continuous-sessions').checked;
            this.settings.notifications.smart_pause = document.getElementById('smart-pause').checked;
            this.settings.notifications.smart_pause_timeout = parseInt(document.getElementById('smart-pause-timeout').value);

            // Advanced settings
            const debugModeCheckbox = document.getElementById('debug-mode');
            if (debugModeCheckbox) {
                if (!this.settings.advanced) {
                    this.settings.advanced = {};
                }
                this.settings.advanced.debug_mode = debugModeCheckbox.checked;
            }

            // Save to file
            await invoke('save_settings', { settings: this.settings });

            // Re-register global shortcuts
            await this.registerGlobalShortcuts();

            // Update timer with new settings
            if (window.pomodoroTimer) {
                await window.pomodoroTimer.applySettings(this.settings);

                // If smart pause is active and countdown is running, restart it with new timeout
                if (window.pomodoroTimer.smartPauseEnabled &&
                    window.pomodoroTimer.smartPauseCountdownInterval &&
                    window.pomodoroTimer.currentMode === 'focus' &&
                    window.pomodoroTimer.isRunning) {
                    window.pomodoroTimer.handleUserActivity();
                }
            }

            NotificationUtils.showNotificationPing('✓ Settings saved successfully!', 'success');
        } catch (error) {
            console.error('Failed to save settings:', error);
            NotificationUtils.showNotificationPing('❌ Failed to save settings', 'error');
        }
    }

    async registerGlobalShortcuts() {
        try {
            console.log('🔧 Registering global shortcuts:', this.settings.shortcuts);
            await invoke('register_global_shortcuts', { shortcuts: this.settings.shortcuts });
        } catch (error) {
            console.error('Failed to register global shortcuts:', error);
        }
    }

    resetToDefaults() {
        if (confirm('Are you sure you want to reset all settings to defaults?')) {
            this.settings = this.getDefaultSettings();
            this.populateSettingsUI();
            this.saveSettings();
        }
    }

    // Complete reset for total data reset
    resetToDefaultsForce() {
        this.settings = this.getDefaultSettings();
        this.populateSettingsUI();
        // Don't save here since we're doing a complete reset
    }

    clearShortcut(shortcutType) {
        const inputId = shortcutType + '-shortcut';
        const input = document.getElementById(inputId);
        if (input) {
            input.value = '';
            // Schedule auto-save after clearing shortcut
            this.scheduleAutoSave();
        }
    }

    setupSliderEventListener() {
        const slider = document.getElementById('smart-pause-timeout');
        const valueDisplay = document.getElementById('timeout-value');

        if (slider && valueDisplay) {
            slider.addEventListener('input', (e) => {
                valueDisplay.textContent = e.target.value;
                this.scheduleAutoSave();
            });
        }
    }

    setupAutoSaveListeners() {
        // Timer settings
        const timerFields = [
            'focus-duration',
            'break-duration',
            'long-break-duration',
            'total-sessions',
            'weekly-goal-minutes'
        ];

        // Appearance settings
        const appearanceFields = [
            'theme-select'
        ];

        timerFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.addEventListener('change', () => this.scheduleAutoSave());
                field.addEventListener('input', () => this.scheduleAutoSave());
            }
        });

        appearanceFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                if (fieldId === 'theme-select') {
                    // Handle theme changes specially to apply theme immediately
                    // applyTheme() already saves settings, so no need to scheduleAutoSave
                    field.addEventListener('change', async () => {
                        await this.applyTheme(field.value);
                    });
                } else {
                    field.addEventListener('change', () => this.scheduleAutoSave());
                }
            }
        });

        // Handle desktop notifications checkbox separately (requires permission request)
        const desktopNotificationsCheckbox = document.getElementById('desktop-notifications');
        if (desktopNotificationsCheckbox) {
            desktopNotificationsCheckbox.addEventListener('change', async (e) => {
                if (e.target.checked) {
                    try {
                        // Request notification permission when enabling
                        const permission = await NotificationUtils.requestNotificationPermission();
                        if (permission !== 'granted') {
                            // Show warning but don't prevent saving the setting
                            const message = permission === 'unsupported'
                                ? 'Desktop notifications are not supported in this browser.'
                                : 'Notification permission denied. Settings saved, but notifications won\'t work until permission is granted.';
                            NotificationUtils.showNotificationPing(message, 'warning');
                            // Don't uncheck the box - let the user's choice be saved
                        }
                    } catch (error) {
                        console.warn('Failed to request notification permission, but allowing setting to be saved:', error);
                        // Don't prevent the setting from being saved even if permission request fails
                        // This allows the setting to work when Tauri notifications are properly configured
                        NotificationUtils.showNotificationPing('Settings saved. Notifications will work when properly configured.', 'info');
                    }
                }
                // Always save the setting regardless of permission status
                this.scheduleAutoSave();
            });
        }

        // Other notification checkboxes
        const checkboxFields = [
            'sound-notifications',
            'debug-mode'
        ];

        checkboxFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                // Skip desktop-notifications as it has special handling above
                if (fieldId !== 'desktop-notifications') {
                    field.addEventListener('change', () => this.scheduleAutoSave());
                }
            }
        });

        // Smart pause timeout slider is already handled in setupSliderEventListener
    }

    scheduleAutoSave() {
        // Clear existing timeout
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }

        // Schedule new auto-save
        this.autoSaveTimeout = setTimeout(() => {
            this.autoSaveSettings();
        }, this.autoSaveDelay);
    }

    async autoSaveSettings() {
        try {
            // Get values from UI (same logic as saveSettings but without the alert)
            this.settings.shortcuts.start_stop = document.getElementById('start-stop-shortcut').value || null;
            this.settings.shortcuts.reset = document.getElementById('reset-shortcut').value || null;
            this.settings.shortcuts.skip = document.getElementById('skip-shortcut').value || null;

            this.settings.timer.focus_duration = parseInt(document.getElementById('focus-duration').value);
            this.settings.timer.break_duration = parseInt(document.getElementById('break-duration').value);
            this.settings.timer.long_break_duration = parseInt(document.getElementById('long-break-duration').value);
            this.settings.timer.total_sessions = parseInt(document.getElementById('total-sessions').value);

            // Weekly goal setting
            const weeklyGoalField = document.getElementById('weekly-goal-minutes');
            if (weeklyGoalField) {
                this.settings.timer.weekly_goal_minutes = parseInt(weeklyGoalField.value) || 125;
            }

            // Appearance settings
            const themeSelect = document.getElementById('theme-select');
            if (themeSelect) {
                this.settings.appearance.theme = themeSelect.value;
                // Note: Don't call applyTheme here to avoid duplicate saves
            }

            // Timer theme (will be saved but not applied in auto-save to avoid performance issues)

            this.settings.notifications.desktop_notifications = document.getElementById('desktop-notifications').checked;
            this.settings.notifications.sound_notifications = document.getElementById('sound-notifications').checked;
            this.settings.notifications.auto_start_timer = document.getElementById('auto-start-timer').checked;
            this.settings.notifications.allow_continuous_sessions = document.getElementById('allow-continuous-sessions').checked;
            this.settings.notifications.smart_pause = document.getElementById('smart-pause').checked;
            this.settings.notifications.smart_pause_timeout = parseInt(document.getElementById('smart-pause-timeout').value);

            // Advanced settings
            const debugModeCheckbox = document.getElementById('debug-mode');
            if (debugModeCheckbox) {
                if (!this.settings.advanced) {
                    this.settings.advanced = {};
                }
                this.settings.advanced.debug_mode = debugModeCheckbox.checked;
            }

            // Debug logging for continuous sessions
            console.log('🔧 AutoSave - Reading checkbox values:');
            console.log('auto_start_timer checkbox:', document.getElementById('auto-start-timer').checked);
            console.log('allow_continuous_sessions checkbox:', document.getElementById('allow-continuous-sessions').checked);
            console.log('smart_pause checkbox:', document.getElementById('smart-pause').checked);

            // Debug log the full settings object being saved
            console.log('🔧 AutoSave - Full settings object being saved:', this.settings);

            // Save to file
            await invoke('save_settings', { settings: this.settings });

            // Re-register global shortcuts
            await this.registerGlobalShortcuts();

            // Update timer with new settings
            if (window.pomodoroTimer) {
                await window.pomodoroTimer.applySettings(this.settings);

                // If smart pause is active and countdown is running, restart it with new timeout
                if (window.pomodoroTimer.smartPauseEnabled &&
                    window.pomodoroTimer.smartPauseCountdownInterval &&
                    window.pomodoroTimer.currentMode === 'focus' &&
                    window.pomodoroTimer.isRunning) {
                    window.pomodoroTimer.handleUserActivity();
                }
            }

            // Show a subtle feedback that settings were saved
            this.showAutoSaveFeedback();

        } catch (error) {
            console.error('Failed to auto-save settings:', error);
            // Don't show an alert for auto-save failures, just log the error
        }
    }

    showAutoSaveFeedback() {
        // Use the unified notification system instead of custom feedback
        NotificationUtils.showNotificationPing('✓ Settings saved', 'success');
    }

    setupSettingsNavigation() {
        // Setup navigation between settings categories
        const navItems = document.querySelectorAll('.settings-nav-item');
        const categories = document.querySelectorAll('.settings-category');

        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const targetCategory = item.dataset.category;

                // Remove active class from all nav items and categories
                navItems.forEach(nav => nav.classList.remove('active'));
                categories.forEach(cat => cat.classList.remove('active'));

                // Add active class to clicked nav item and corresponding category
                item.classList.add('active');
                const targetElement = document.getElementById(`category-${targetCategory}`);
                if (targetElement) {
                    targetElement.classList.add('active');
                }
            });
        });
    }

    async loadAutostartSetting() {
        try {
            // Check if autostart is enabled in the system
            const isEnabled = await invoke('is_autostart_enabled');

            // Update the setting and UI
            this.settings.autostart = isEnabled;
            const checkbox = document.getElementById('autostart-enabled');
            if (checkbox) {
                checkbox.checked = isEnabled;

                // Setup event listener for the autostart checkbox
                checkbox.addEventListener('change', async (e) => {
                    await this.toggleAutostart(e.target.checked);
                });
            }
        } catch (error) {
            console.error('Failed to check autostart status:', error);
            // Default to false if we can't check the status
            const checkbox = document.getElementById('autostart-enabled');
            if (checkbox) {
                checkbox.checked = false;
                checkbox.addEventListener('change', async (e) => {
                    await this.toggleAutostart(e.target.checked);
                });
            }
        }
    }

    async toggleAutostart(enabled) {
        try {
            if (enabled) {
                await invoke('enable_autostart');
                console.log('Autostart enabled');
                NotificationUtils.showNotificationPing('✓ Autostart enabled - Presto will start with your system', 'success');
            } else {
                await invoke('disable_autostart');
                console.log('Autostart disabled');
                NotificationUtils.showNotificationPing('✓ Autostart disabled', 'success');
            }

            // Update our settings
            this.settings.autostart = enabled;

            // Schedule auto-save to persist the setting
            this.scheduleAutoSave();

        } catch (error) {
            console.error('Failed to toggle autostart:', error);
            NotificationUtils.showNotificationPing('❌ Failed to toggle autostart: ' + error, 'error');

            // Revert the checkbox state on error
            const checkbox = document.getElementById('autostart-enabled');
            if (checkbox) {
                checkbox.checked = !enabled;
            }
        }
    }

    async loadAnalyticsSetting() {
        try {
            // Get current analytics setting from our stored settings
            const analyticsEnabled = this.settings.analytics_enabled;

            const checkbox = document.getElementById('analytics-enabled');
            if (checkbox) {
                checkbox.checked = analyticsEnabled;

                // Setup event listener for the analytics checkbox
                checkbox.addEventListener('change', async (e) => {
                    await this.toggleAnalytics(e.target.checked);
                });
            }
        } catch (error) {
            console.error('Failed to load analytics setting:', error);
            // Default to enabled if we can't check the status
            const checkbox = document.getElementById('analytics-enabled');
            if (checkbox) {
                checkbox.checked = true;
                checkbox.addEventListener('change', async (e) => {
                    await this.toggleAnalytics(e.target.checked);
                });
            }
        }
    }

    async toggleAnalytics(enabled) {
        try {
            // Update our settings
            this.settings.analytics_enabled = enabled;

            // Show user feedback
            if (enabled) {
                console.log('Analytics enabled');
                NotificationUtils.showNotificationPing('✓ Analytics enabled - Help improve Presto!', 'success');
            } else {
                console.log('Analytics disabled');
                NotificationUtils.showNotificationPing('✓ Analytics disabled - No data will be collected', 'success');
            }

            // Schedule auto-save to persist the setting
            this.scheduleAutoSave();

        } catch (error) {
            console.error('Failed to toggle analytics:', error);
            NotificationUtils.showNotificationPing('❌ Failed to toggle analytics: ' + error, 'error');

            // Revert the checkbox state on error
            const checkbox = document.getElementById('analytics-enabled');
            if (checkbox) {
                checkbox.checked = !enabled;
            }
        }
    }

    // Theme management functions
    async applyTheme(theme) {
        const html = document.documentElement;

        // Remove existing theme attributes
        html.removeAttribute('data-theme');

        // Determine the actual theme to apply
        let actualTheme = theme;
        if (theme === 'auto') {
            // For auto mode, detect system preference and apply the actual theme
            actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            console.log(`🎨 Auto theme detected system preference: ${actualTheme}`);
        }

        // Apply the actual theme (never "auto")
        html.setAttribute('data-theme', actualTheme);

        // Store theme preference in localStorage for quick access
        localStorage.setItem('theme-preference', theme); // Store user preference (could be "auto")

        // Update settings object and save immediately to prevent loss on app close
        if (this.settings && this.settings.appearance) {
            this.settings.appearance.theme = theme; // Store user preference (could be "auto")
            try {
                // Save immediately to file
                await invoke('save_settings', { settings: this.settings });
                console.log(`🎨 Theme preference saved: ${theme}, actual theme applied: ${actualTheme}`);
            } catch (error) {
                console.error('Failed to save theme setting:', error);
            }
        }

        // Setup system theme listener for auto mode
        if (theme === 'auto') {
            this.setupSystemThemeListener();
        } else {
            this.removeSystemThemeListener();
        }

        console.log(`🎨 Theme preference: ${theme}, actual theme applied: ${actualTheme}`);

        // Update timer theme compatibility when color mode changes
        this.updateTimerThemeCompatibility();
    }

    setupSystemThemeListener() {
        // Remove existing listener if any
        this.removeSystemThemeListener();

        // Create new listener
        this.systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this.systemThemeListener = (e) => {
            const newSystemTheme = e.matches ? 'dark' : 'light';
            console.log(`🎨 System theme changed: ${newSystemTheme}`);

            // Only apply if current preference is "auto"
            const currentPreference = this.settings?.appearance?.theme || 'auto';
            if (currentPreference === 'auto') {
                const html = document.documentElement;
                html.setAttribute('data-theme', newSystemTheme);
                console.log(`🎨 Auto theme updated to: ${newSystemTheme}`);

                // Update timer theme compatibility
                this.updateTimerThemeCompatibility();
            }
        };

        this.systemThemeMediaQuery.addEventListener('change', this.systemThemeListener);
    }

    updateTimerThemeCompatibility() {
        // Aggiorna la compatibilità del tema timer quando cambia il tema dell'app
        const currentTimerTheme = this.settings?.appearance?.timer_theme;
        if (currentTimerTheme) {
            const timerThemeGrid = document.getElementById('timer-theme-grid');
            if (timerThemeGrid) {
                // Ricarica il selettore dei temi timer per aggiornare la compatibilità
                this.initializeTimerThemeSelector();
            }
        }
    }

    removeSystemThemeListener() {
        if (this.systemThemeMediaQuery && this.systemThemeListener) {
            this.systemThemeMediaQuery.removeEventListener('change', this.systemThemeListener);
            this.systemThemeMediaQuery = null;
            this.systemThemeListener = null;
        }
    }

    async initializeTheme() {
        // Check if theme was already initialized early
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const storedTheme = localStorage.getItem('theme-preference');

        // If early theme was set and matches localStorage, check if we need to process it
        if (currentTheme && storedTheme && currentTheme === storedTheme) {
            console.log(`🎨 Early initialized theme found: ${currentTheme}`);

            // If the stored theme is "auto", we need to apply the correct auto logic
            // because data-theme should never be "auto" - it should be "light" or "dark"
            if (storedTheme === 'auto') {
                console.log(`🎨 Converting auto theme to actual theme`);
                await this.applyTheme('auto'); // This will set data-theme to light/dark
                return;
            }

            // For non-auto themes, keep the early initialization
            console.log(`🎨 Keeping early initialized theme: ${currentTheme}`);

            // Update settings to match current theme
            if (this.settings && this.settings.appearance) {
                this.settings.appearance.theme = currentTheme;
                try {
                    await invoke('save_settings', { settings: this.settings });
                    console.log(`🎨 Settings updated to match current theme: ${currentTheme}`);
                } catch (error) {
                    console.error('Failed to update theme in settings:', error);
                }
            }
            return;
        }

        // Otherwise apply the theme from settings or default to auto
        const theme = this.settings?.appearance?.theme || 'auto';
        await this.applyTheme(theme);
    }

    initializeThemeSelector() {
        const themeSelector = document.getElementById('theme-selector');
        const themeSelect = document.getElementById('theme-select');

        if (!themeSelector) return;

        const currentTheme = this.settings.appearance?.theme || 'auto';

        // Set active theme button
        this.updateThemeSelector(currentTheme);

        // Add event listeners to theme buttons
        const themeButtons = themeSelector.querySelectorAll('.theme-option');
        themeButtons.forEach(button => {
            button.addEventListener('click', async (e) => {
                const selectedTheme = button.getAttribute('data-theme');

                // Update visual state
                this.updateThemeSelector(selectedTheme);

                // Update hidden select for compatibility
                if (themeSelect) {
                    themeSelect.value = selectedTheme;
                }

                // Apply theme immediately
                this.settings.appearance.theme = selectedTheme;
                await this.applyTheme(selectedTheme);

                // Save settings
                try {
                    await this.saveSettings();
                    console.log(`🎨 Theme changed to: ${selectedTheme}`);
                } catch (error) {
                    console.error('Failed to save theme setting:', error);
                }
            });
        });
    }

    updateThemeSelector(theme) {
        const themeSelector = document.getElementById('theme-selector');
        if (!themeSelector) return;

        // Remove active class from all buttons
        const themeButtons = themeSelector.querySelectorAll('.theme-option');
        themeButtons.forEach(button => {
            button.classList.remove('active');
        });

        // Add active class to selected button
        const activeButton = themeSelector.querySelector(`[data-theme="${theme}"]`);
        if (activeButton) {
            activeButton.classList.add('active');
        }
    }

    async initializeTimerTheme() {
        // Check if timer theme was already initialized early
        const currentTimerTheme = document.documentElement.getAttribute('data-timer-theme');
        const storedTimerTheme = localStorage.getItem('timer-theme-preference');

        // If early timer theme was set and matches localStorage, keep it
        if (currentTimerTheme && storedTimerTheme && currentTimerTheme === storedTimerTheme) {
            console.log(`🎨 Keeping early initialized timer theme: ${currentTimerTheme}`);

            // Update settings to match current timer theme
            if (this.settings && this.settings.appearance) {
                this.settings.appearance.timer_theme = currentTimerTheme;
                try {
                    await invoke('save_settings', { settings: this.settings });
                    console.log(`🎨 Settings updated to match current timer theme: ${currentTimerTheme}`);
                } catch (error) {
                    console.error('Failed to update timer theme in settings:', error);
                }
            }
            return;
        }

        // Otherwise apply the timer theme from settings or default to espresso
        const timerTheme = this.settings?.appearance?.timer_theme || 'espresso';
        await this.applyTimerTheme(timerTheme);
    }

    async applyTimerTheme(themeId) {
        const html = document.documentElement;

        // Remove existing timer theme attribute
        html.removeAttribute('data-timer-theme');

        // Apply new timer theme
        html.setAttribute('data-timer-theme', themeId);

        // Store timer theme preference in localStorage for quick access
        localStorage.setItem('timer-theme-preference', themeId);

        // Update settings object
        if (this.settings && this.settings.appearance) {
            this.settings.appearance.timer_theme = themeId;
        }

        console.log(`🎨 Timer theme applied: ${themeId}`);
    }

    initializeTimerThemeSelector() {
        const timerThemeGrid = document.getElementById('timer-theme-grid');
        if (!timerThemeGrid || !this.settings || !this.settings.appearance) {
            return; // Exit early if elements or settings not ready
        }

        const currentTimerTheme = this.settings.appearance?.timer_theme || 'espresso';

        // Clear existing content
        timerThemeGrid.innerHTML = '';

        // Create basic timer theme options
        const themes = [
            { id: 'espresso', name: 'Espresso' },
            { id: 'matrix', name: 'Matrix' },
            { id: 'pommodore64', name: 'Commodore 64' }
        ];

        themes.forEach(theme => {
            const themeOption = this.createBasicTimerThemeOption(theme, currentTimerTheme);
            timerThemeGrid.appendChild(themeOption);
        });
    }

    createBasicTimerThemeOption(theme, currentTimerTheme) {
        const option = document.createElement('div');
        option.className = 'timer-theme-option';
        option.setAttribute('data-timer-theme', theme.id);

        const isActive = theme.id === currentTimerTheme;
        if (isActive) option.classList.add('active');

        option.innerHTML = `
            <div class="timer-theme-header">
                <h4 class="timer-theme-name">${theme.name}</h4>
            </div>
            <div class="timer-theme-preview">
                <div class="timer-preview-display" data-preview-theme="${theme.id}">
                    <div class="timer-preview-time">25:00</div>
                    <div class="timer-preview-status">Focus Session</div>
                </div>
            </div>
        `;

        // Add click handler
        option.addEventListener('click', async () => {
            await this.selectTimerTheme(theme.id);
        });

        return option;
    }

    async selectTimerTheme(themeId) {
        // Update visual state
        this.updateTimerThemeSelector(themeId);

        // Apply theme immediately
        await this.applyTimerTheme(themeId);

        // Save to settings
        this.settings.appearance.timer_theme = themeId;

        try {
            await invoke('save_settings', { settings: this.settings });
            console.log(`🎨 Timer theme saved: ${themeId}`);
        } catch (error) {
            console.error('Failed to save timer theme setting:', error);
        }
    }
}