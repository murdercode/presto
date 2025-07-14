// Background Manager for Dynamic Theme
// Handles background selection, rotation, and copyright attribution

export class BackgroundManager {
    constructor() {
        this.currentTheme = null;
        this.backgroundData = {
            focus: [],
            break: [],
            longBreak: []
        };
        this.currentBackgroundIndex = {
            focus: 0,
            break: 0,
            longBreak: 0
        };
        this.rotationInterval = null;
        this.rotationDuration = 60000; // 1 minute in milliseconds
        this.copyrightElement = null;
        
        this.init();
    }

    async init() {
        console.log('🎨 Initializing Background Manager...');
        this.createCopyrightElement();
        this.loadBackgroundSettings();
        this.setupThemeListener();
    }

    // Create copyright attribution element
    createCopyrightElement() {
        this.copyrightElement = document.createElement('div');
        this.copyrightElement.className = 'background-copyright';
        this.copyrightElement.style.display = 'none';
        document.body.appendChild(this.copyrightElement);
    }

    // Setup theme change listener
    setupThemeListener() {
        // Listen for theme changes
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'data-timer-theme') {
                    const newTheme = document.documentElement.getAttribute('data-timer-theme');
                    if (newTheme === 'dynamic') {
                        this.enableBackgroundSystem();
                    } else {
                        this.disableBackgroundSystem();
                    }
                }
            });
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-timer-theme']
        });

        // Check initial theme
        const currentTheme = document.documentElement.getAttribute('data-timer-theme');
        if (currentTheme === 'dynamic') {
            this.enableBackgroundSystem();
        }
    }

    // Enable background system for Dynamic theme
    enableBackgroundSystem() {
        console.log('🎨 Enabling background system for Dynamic theme');
        this.currentTheme = 'dynamic';
        this.startBackgroundRotation();
        this.updateBackgroundForCurrentState();
    }

    // Disable background system
    disableBackgroundSystem() {
        console.log('🎨 Disabling background system');
        this.currentTheme = null;
        this.stopBackgroundRotation();
        this.clearBackground();
        this.hideCopyright();
    }

    // Load background settings from storage
    async loadBackgroundSettings() {
        try {
            const saved = localStorage.getItem('dynamic-theme-backgrounds');
            if (saved) {
                this.backgroundData = JSON.parse(saved);
                
                // Load large files from IndexedDB
                await this.loadLargeFilesFromIndexedDB();
            }
        } catch (error) {
            console.error('Error loading background settings:', error);
        }
    }

    // Save background settings
    async saveBackgroundSettings() {
        try {
            // Separate small and large files
            const dataToSave = JSON.parse(JSON.stringify(this.backgroundData)); // Deep clone
            const largeFiles = [];

            // Check each background and move large ones to IndexedDB
            ['focus', 'break', 'longBreak'].forEach(state => {
                dataToSave[state] = dataToSave[state].map(bg => {
                    // If it's a large data URL (>1MB), save to IndexedDB
                    if (bg.url && bg.url.startsWith('data:') && bg.url.length > 1024 * 1024) {
                        largeFiles.push({
                            id: bg.id,
                            url: bg.url
                        });
                        
                        // Replace with reference in localStorage data
                        return {
                            ...bg,
                            url: `indexeddb:${bg.id}`,
                            isLarge: true
                        };
                    }
                    return bg;
                });
            });

            // Save large files to IndexedDB
            if (largeFiles.length > 0) {
                await this.saveLargeFilesToIndexedDB(largeFiles);
            }

            // Save the rest to localStorage
            localStorage.setItem('dynamic-theme-backgrounds', JSON.stringify(dataToSave));
        } catch (error) {
            console.error('Error saving background settings:', error);
            
            // Fallback: Try to save without large files
            try {
                const fallbackData = JSON.parse(JSON.stringify(this.backgroundData));
                ['focus', 'break', 'longBreak'].forEach(state => {
                    fallbackData[state] = fallbackData[state].filter(bg => 
                        !bg.url || !bg.url.startsWith('data:') || bg.url.length <= 1024 * 1024
                    );
                });
                localStorage.setItem('dynamic-theme-backgrounds', JSON.stringify(fallbackData));
                
                alert('Large video files could not be saved due to storage limitations. Only smaller images have been saved.');
            } catch (fallbackError) {
                console.error('Fallback save failed:', fallbackError);
                alert('Failed to save backgrounds due to storage limitations.');
            }
        }
    }

    // IndexedDB operations for large files
    async openIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('PrestoBackgrounds', 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('backgrounds')) {
                    db.createObjectStore('backgrounds', { keyPath: 'id' });
                }
            };
        });
    }

    async saveLargeFilesToIndexedDB(largeFiles) {
        try {
            const db = await this.openIndexedDB();
            const transaction = db.transaction(['backgrounds'], 'readwrite');
            const store = transaction.objectStore('backgrounds');
            
            for (const file of largeFiles) {
                await new Promise((resolve, reject) => {
                    const request = store.put(file);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
            }
            
            console.log(`🎨 Saved ${largeFiles.length} large files to IndexedDB`);
        } catch (error) {
            console.error('Error saving to IndexedDB:', error);
            throw error;
        }
    }

    async loadLargeFilesFromIndexedDB() {
        try {
            const db = await this.openIndexedDB();
            const transaction = db.transaction(['backgrounds'], 'readonly');
            const store = transaction.objectStore('backgrounds');
            
            // Replace IndexedDB references with actual URLs
            ['focus', 'break', 'longBreak'].forEach(state => {
                this.backgroundData[state] = this.backgroundData[state].map(bg => {
                    if (bg.url && bg.url.startsWith('indexeddb:')) {
                        const id = bg.url.replace('indexeddb:', '');
                        
                        // Load from IndexedDB (async operation)
                        this.loadSingleFileFromIndexedDB(id, state, bg.id);
                        
                        // Return placeholder for now
                        return {
                            ...bg,
                            url: '', // Will be updated when loaded
                            loading: true
                        };
                    }
                    return bg;
                });
            });
        } catch (error) {
            console.error('Error loading from IndexedDB:', error);
        }
    }

    async loadSingleFileFromIndexedDB(fileId, state, backgroundId) {
        try {
            const db = await this.openIndexedDB();
            const transaction = db.transaction(['backgrounds'], 'readonly');
            const store = transaction.objectStore('backgrounds');
            
            const request = store.get(fileId);
            request.onsuccess = () => {
                if (request.result) {
                    // Update the background data with the loaded URL
                    const background = this.backgroundData[state].find(bg => bg.id === backgroundId);
                    if (background) {
                        background.url = request.result.url;
                        background.loading = false;
                        
                        // Refresh UI if needed
                        if (window.settingsManager) {
                            window.settingsManager.refreshBackgroundLists();
                        }
                        
                        // Update current background if this is the active one
                        if (this.currentTheme === 'dynamic') {
                            const currentState = this.getCurrentTimerState();
                            const currentIndex = this.currentBackgroundIndex[currentState];
                            const currentBackground = this.backgroundData[currentState][currentIndex];
                            
                            if (currentBackground && currentBackground.id === backgroundId) {
                                console.log('🎨 Updating active background after IndexedDB load:', background);
                                this.updateBackgroundForCurrentState();
                            }
                        }
                    }
                }
            };
        } catch (error) {
            console.error('Error loading single file from IndexedDB:', error);
        }
    }

    // Add background to a specific state
    async addBackground(state, backgroundData) {
        if (!['focus', 'break', 'longBreak'].includes(state)) {
            console.error('Invalid state:', state);
            return false;
        }

        const background = {
            id: Date.now().toString(),
            url: backgroundData.url || backgroundData.dataUrl, // Support both URL and data URL
            filename: backgroundData.filename || 'Custom background',
            type: backgroundData.type || 'image', // 'image' or 'video'
            author: backgroundData.author || '',
            work: backgroundData.work || '',
            addedAt: new Date().toISOString()
        };

        this.backgroundData[state].push(background);
        await this.saveBackgroundSettings();
        
        console.log(`🎨 Added background to ${state}:`, background);
        return background.id;
    }

    // Remove background from a specific state
    removeBackground(state, backgroundId) {
        if (!['focus', 'break', 'longBreak'].includes(state)) {
            console.error('Invalid state:', state);
            return false;
        }

        const index = this.backgroundData[state].findIndex(bg => bg.id === backgroundId);
        if (index !== -1) {
            this.backgroundData[state].splice(index, 1);
            this.saveBackgroundSettings();
            
            // Reset index if it's now out of bounds
            if (this.currentBackgroundIndex[state] >= this.backgroundData[state].length) {
                this.currentBackgroundIndex[state] = 0;
            }
            
            console.log(`🎨 Removed background from ${state}:`, backgroundId);
            return true;
        }
        
        return false;
    }

    // Get all backgrounds for a state
    getBackgrounds(state) {
        if (!['focus', 'break', 'longBreak'].includes(state)) {
            return [];
        }
        return [...this.backgroundData[state]];
    }

    // Get current timer state from DOM
    getCurrentTimerState() {
        const body = document.body;
        if (body.classList.contains('focus')) return 'focus';
        if (body.classList.contains('break')) return 'break';
        if (body.classList.contains('longBreak')) return 'longBreak';
        return 'focus'; // default
    }

    // Update background for current timer state
    updateBackgroundForCurrentState() {
        if (this.currentTheme !== 'dynamic') return;

        const currentState = this.getCurrentTimerState();
        const backgrounds = this.backgroundData[currentState];
        
        if (backgrounds.length === 0) {
            this.clearBackground();
            this.hideCopyright();
            return;
        }

        const currentIndex = this.currentBackgroundIndex[currentState];
        const background = backgrounds[currentIndex];
        
        if (background) {
            this.applyBackground(background);
            this.showCopyright(background);
        }
    }

    // Apply background to timer view only
    applyBackground(background) {
        // Check if we're on the timer view - use multiple methods for reliability
        const currentView = document.querySelector('.view-section.active')?.id || 
                           document.querySelector('.view-container:not(.hidden)')?.id;
        
        if (currentView !== 'timer-view' || this.currentTheme !== 'dynamic') {
            return;
        }

        const timerView = document.getElementById('timer-view');
        if (!timerView) return;
        
        console.log('🎨 Applying background:', {
            type: background.type,
            hasUrl: !!background.url,
            urlType: background.url ? background.url.substring(0, 20) + '...' : 'none',
            loading: background.loading,
            filename: background.filename
        });
        
        if (background.type === 'video' && background.url && (background.url.startsWith('data:video') || background.url.startsWith('blob:'))) {
            // Create video background for timer view
            this.createVideoBackground(timerView, background);
        } else if (background.url && !background.loading) {
            // Apply image background
            timerView.style.backgroundImage = `url("${background.url}")`;
            timerView.style.backgroundSize = 'cover';
            timerView.style.backgroundPosition = 'center';
            timerView.style.backgroundAttachment = 'fixed';
            timerView.style.backgroundRepeat = 'no-repeat';
            
            // Remove any existing video background
            this.removeVideoBackground(timerView);
        } else if (background.loading) {
            // Background is still loading from IndexedDB, show placeholder
            console.log('🎨 Background still loading from IndexedDB:', background);
            this.clearBackground();
        }
    }

    // Create video background element
    createVideoBackground(container, background) {
        // Remove existing video background
        this.removeVideoBackground(container);
        
        const video = document.createElement('video');
        video.className = 'dynamic-background-video';
        video.src = background.url;
        video.autoplay = true;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        
        video.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            object-fit: cover;
            z-index: -2;
            pointer-events: none;
        `;
        
        // Clear any image background
        container.style.backgroundImage = '';
        
        container.appendChild(video);
        
        // Start playing
        video.play().catch(error => {
            console.warn('Video autoplay failed:', error);
        });
    }

    // Remove video background
    removeVideoBackground(container) {
        const existingVideo = container.querySelector('.dynamic-background-video');
        if (existingVideo) {
            existingVideo.remove();
        }
    }

    // Clear background
    clearBackground() {
        const timerView = document.getElementById('timer-view');
        if (timerView) {
            timerView.style.backgroundImage = '';
            timerView.style.backgroundSize = '';
            timerView.style.backgroundPosition = '';
            timerView.style.backgroundAttachment = '';
            timerView.style.backgroundRepeat = '';
            
            // Remove any video backgrounds
            this.removeVideoBackground(timerView);
        }
    }

    // Show copyright attribution
    showCopyright(background) {
        if (!background.author && !background.work) {
            this.hideCopyright();
            return;
        }

        let copyrightText = '';
        if (background.author && background.work) {
            copyrightText = `© ${background.author} - ${background.work}`;
        } else if (background.author) {
            copyrightText = `© ${background.author}`;
        } else if (background.work) {
            copyrightText = `© ${background.work}`;
        }

        this.copyrightElement.textContent = copyrightText;
        this.copyrightElement.style.display = 'block';
    }

    // Hide copyright attribution
    hideCopyright() {
        if (this.copyrightElement) {
            this.copyrightElement.style.display = 'none';
        }
    }

    // Start background rotation
    startBackgroundRotation() {
        this.stopBackgroundRotation(); // Clear any existing interval
        
        this.rotationInterval = setInterval(() => {
            this.rotateBackground();
        }, this.rotationDuration);
        
        console.log(`🎨 Started background rotation (${this.rotationDuration}ms)`);
    }

    // Stop background rotation
    stopBackgroundRotation() {
        if (this.rotationInterval) {
            clearInterval(this.rotationInterval);
            this.rotationInterval = null;
            console.log('🎨 Stopped background rotation');
        }
    }

    // Rotate to next background for current state
    rotateBackground() {
        if (this.currentTheme !== 'dynamic') return;

        const currentState = this.getCurrentTimerState();
        const backgrounds = this.backgroundData[currentState];
        
        if (backgrounds.length <= 1) return; // No rotation needed

        this.currentBackgroundIndex[currentState] = 
            (this.currentBackgroundIndex[currentState] + 1) % backgrounds.length;
        
        this.updateBackgroundForCurrentState();
        console.log(`🎨 Rotated background for ${currentState} to index ${this.currentBackgroundIndex[currentState]}`);
    }

    // Set rotation duration (in minutes)
    setRotationDuration(minutes) {
        this.rotationDuration = minutes * 60 * 1000;
        
        // Restart rotation with new duration if currently active
        if (this.rotationInterval) {
            this.startBackgroundRotation();
        }
        
        console.log(`🎨 Set rotation duration to ${minutes} minutes`);
    }

    // Get background statistics
    getStats() {
        return {
            focus: this.backgroundData.focus.length,
            break: this.backgroundData.break.length,
            longBreak: this.backgroundData.longBreak.length,
            total: this.backgroundData.focus.length + 
                   this.backgroundData.break.length + 
                   this.backgroundData.longBreak.length,
            rotationEnabled: !!this.rotationInterval,
            rotationDuration: this.rotationDuration / 60000 // in minutes
        };
    }

    // Export all background data
    exportBackgrounds() {
        return {
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            data: this.backgroundData
        };
    }

    // Import background data
    importBackgrounds(exportData) {
        try {
            if (exportData.version && exportData.data) {
                this.backgroundData = exportData.data;
                this.saveBackgroundSettings();
                
                // Reset indices
                this.currentBackgroundIndex = {
                    focus: 0,
                    break: 0,
                    longBreak: 0
                };
                
                // Update current background if Dynamic theme is active
                if (this.currentTheme === 'dynamic') {
                    this.updateBackgroundForCurrentState();
                }
                
                console.log('🎨 Imported background data successfully');
                return true;
            }
        } catch (error) {
            console.error('Error importing background data:', error);
        }
        return false;
    }

    // Listen for timer state changes
    setupTimerStateListener() {
        // Listen for body class changes to detect timer state changes
        const observer = new MutationObserver(() => {
            if (this.currentTheme === 'dynamic') {
                this.updateBackgroundForCurrentState();
            }
        });

        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class']
        });
    }

    // Initialize timer state listener
    initTimerStateListener() {
        this.setupTimerStateListener();
        this.setupViewChangeListener();
    }

    // Setup view change listener to clear backgrounds when leaving timer
    setupViewChangeListener() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const currentView = document.querySelector('.view-section.active')?.id;
                    
                    // If we're not on timer view, clear backgrounds
                    if (currentView !== 'timer-view') {
                        this.clearBackground();
                        this.hideCopyright();
                    } else if (currentView === 'timer-view' && this.currentTheme === 'dynamic') {
                        // If we switched back to timer view, update background
                        this.updateBackgroundForCurrentState();
                    }
                }
            });
        });

        // Observe all view sections for class changes
        const viewSections = document.querySelectorAll('.view-section');
        viewSections.forEach(section => {
            observer.observe(section, {
                attributes: true,
                attributeFilter: ['class']
            });
        });
    }
}

// Create and export singleton instance
export const backgroundManager = new BackgroundManager();

// Initialize timer state listener when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        backgroundManager.initTimerStateListener();
    });
} else {
    backgroundManager.initTimerStateListener();
}

export default backgroundManager;