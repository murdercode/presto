// Main Application Entry Point - Presto Pomodoro Timer
import { NavigationManager } from './managers/navigation-manager.js';
import { SettingsManager } from './managers/settings-manager.js';
import { SessionManager } from './managers/session-manager.js';
import { TeamManager } from './managers/team-manager.js';
// Auth manager will be imported after Supabase is loaded
import { PomodoroTimer } from './core/pomodoro-timer.js';
import { NotificationUtils } from './utils/common-utils.js';
// Removed unused import: updateNotification

// Global application state
let timer = null;
let navigation = null;
let settingsManager = null;
let sessionManager = null;
let teamManager = null;

// Global functions for settings (backwards compatibility)
window.saveSettings = async function () {
  if (window.settingsManager) {
    await window.settingsManager.saveSettings();
  }
};

window.resetToDefaults = function () {
  if (window.settingsManager) {
    window.settingsManager.resetToDefaults();
  }
};

window.clearShortcut = function (shortcutType) {
  if (window.settingsManager) {
    window.settingsManager.clearShortcut(shortcutType);
  }
};

// Global functions for background management
window.addBackground = function (state) {
  showAddBackgroundModal(state);
};

window.removeBackground = function (backgroundId, state) {
  if (confirm('Are you sure you want to remove this background?')) {
    if (window.backgroundManager) {
      window.backgroundManager.removeBackground(state, backgroundId);
      if (window.settingsManager) {
        window.settingsManager.refreshBackgroundLists();
      }
    }
  }
};

window.previewBackground = function (backgroundId, state) {
  if (window.backgroundManager) {
    const backgrounds = window.backgroundManager.getBackgrounds(state);
    const background = backgrounds.find(bg => bg.id === backgroundId);
    if (background) {
      window.backgroundManager.applyBackground(background);
      window.backgroundManager.showCopyright(background);
    }
  }
};

window.exportBackgrounds = function () {
  if (window.backgroundManager) {
    const data = window.backgroundManager.exportBackgrounds();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'presto-backgrounds.json';
    a.click();
    URL.revokeObjectURL(url);
  }
};

window.importBackgrounds = function () {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = function (e) {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          const data = JSON.parse(e.target.result);
          if (window.backgroundManager && window.backgroundManager.importBackgrounds(data)) {
            if (window.settingsManager) {
              window.settingsManager.refreshBackgroundLists();
            }
            alert('Backgrounds imported successfully!');
          } else {
            alert('Failed to import backgrounds. Please check the file format.');
          }
        } catch (error) {
          alert('Invalid file format. Please select a valid background export file.');
        }
      };
      reader.readAsText(file);
    }
  };
  input.click();
};

function showAddBackgroundModal(state) {
  const modal = document.createElement('div');
  modal.className = 'background-modal';
  modal.innerHTML = `
    <div class="background-modal-content">
      <h3>Add Background for ${state === 'longBreak' ? 'Long Break' : state.charAt(0).toUpperCase() + state.slice(1)} State</h3>
      <form class="background-form" id="background-form">
        <div>
          <label for="bg-file">Select Background File:</label>
          <input type="file" id="bg-file" accept="image/*,video/*" required>
          <small style="color: var(--text-light); font-size: 0.8rem; margin-top: 0.25rem; display: block;">
            Supports images (jpg, png, gif, webp) and videos (mp4, webm)
          </small>
        </div>
        <div>
          <label for="bg-author">Author (optional):</label>
          <input type="text" id="bg-author" placeholder="Artist or creator name">
        </div>
        <div>
          <label for="bg-work">Work/Title (optional):</label>
          <input type="text" id="bg-work" placeholder="Work or title name">
        </div>
        <div class="background-form-actions">
          <button type="submit" class="btn-primary">Add Background</button>
          <button type="button" class="btn-cancel">Cancel</button>
        </div>
      </form>
    </div>
  `;

  // Add event listeners
  const form = modal.querySelector('#background-form');
  const cancelBtn = modal.querySelector('.btn-cancel');
  const fileInput = modal.querySelector('#bg-file');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const file = fileInput.files[0];
    const author = document.getElementById('bg-author').value;
    const work = document.getElementById('bg-work').value;

    if (!file) {
      alert('Please select a background file.');
      return;
    }

    // Check file size (max 10MB)
    // if (file.size > 10 * 1024 * 1024) {
    //   alert('File size must be less than 10MB.');
    //   return;
    // }

    const reader = new FileReader();
    reader.onload = async function (e) {
      const dataUrl = e.target.result;
      const type = file.type.startsWith('video/') ? 'video' : 'image';

      try {
        if (window.backgroundManager) {
          await window.backgroundManager.addBackground(state, {
            dataUrl,
            filename: file.name,
            type,
            author,
            work
          });
          if (window.settingsManager) {
            window.settingsManager.refreshBackgroundLists();
          }
        }

        document.body.removeChild(modal);
      } catch (error) {
        console.error('Error adding background:', error);
        if (error.name === 'QuotaExceededError') {
          alert('Storage quota exceeded. Large video files are automatically saved to a more efficient storage system. The background has been added successfully.');
          // Still remove modal and refresh since the background was likely added with IndexedDB fallback
          document.body.removeChild(modal);
          if (window.settingsManager) {
            window.settingsManager.refreshBackgroundLists();
          }
        } else {
          alert('Failed to add background: ' + error.message);
        }
      }
    };

    reader.onerror = function () {
      alert('Failed to read the file. Please try again.');
    };

    reader.readAsDataURL(file);
  });

  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  document.body.appendChild(modal);
  setTimeout(() => fileInput.focus(), 100);
}

window.confirmTotalReset = async function () {
  console.log("confirmTotalReset called"); // Debug log

  try {
    // Create custom confirmation dialogs
    const confirmed = await showCustomConfirm(
      "⚠️ ATTENZIONE",
      "Questa azione eliminerà PERMANENTEMENTE tutti i tuoi dati!\n\n" +
      "Questo include:\n" +
      "• Tutte le sessioni Pomodoro e statistiche\n" +
      "• Tutti i task e la cronologia\n" +
      "• Tutte le impostazioni personalizzate\n\n" +
      "Questa azione NON PUÒ essere annullata!\n\n" +
      "Sei assolutamente sicuro di voler continuare?",
      "warning"
    );

    console.log("First confirmation result:", confirmed);

    if (confirmed) {
      const doubleConfirm = await showCustomConfirm(
        "🚨 ULTIMO AVVISO 🚨",
        "Stai per eliminare TUTTI i dati del Pomodoro in modo permanente.\n\n" +
        "Clicca CONFERMA per procedere, o ANNULLA per interrompere.",
        "error"
      );

      console.log("Second confirmation result:", doubleConfirm);

      if (doubleConfirm) {
        console.log("Both confirmations received, calling performTotalReset");
        await window.performTotalReset();
      } else {
        console.log("Second confirmation cancelled by user");
      }
    } else {
      console.log("First confirmation cancelled by user");
    }

  } catch (error) {
    console.error("Error in confirmTotalReset:", error);

    // Fallback to browser confirm
    const manualConfirm = confirm("Si è verificato un errore nei dialog. Vuoi resettare tutti i dati comunque?");
    if (manualConfirm) {
      await window.performTotalReset();
    }
  }
};

// Custom confirmation dialog function
function showCustomConfirm(title, message, type = 'warning') {
  return new Promise((resolve) => {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
      backdrop-filter: blur(5px);
    `;

    // Create modal content
    const modal = document.createElement('div');
    modal.className = 'custom-confirm-modal';
    modal.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 24px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
      text-align: center;
      font-family: system-ui, -apple-system, sans-serif;
    `;

    // Determine colors based on type
    const colors = {
      warning: { bg: '#fff3cd', border: '#ffeaa7', text: '#856404' },
      error: { bg: '#f8d7da', border: '#f5c6cb', text: '#721c24' }
    };
    const color = colors[type] || colors.warning;

    modal.innerHTML = `
      <div style="background: ${color.bg}; border: 2px solid ${color.border}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <h3 style="margin: 0 0 12px 0; color: ${color.text}; font-size: 20px;">${title}</h3>
        <p style="margin: 0; color: ${color.text}; line-height: 1.5; white-space: pre-line;">${message}</p>
      </div>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button id="confirm-btn" style="
          background: #dc3545;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 6px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        ">CONFERMA</button>
        <button id="cancel-btn" style="
          background: #6c757d;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 6px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        ">ANNULLA</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Add hover effects
    const confirmBtn = modal.querySelector('#confirm-btn');
    const cancelBtn = modal.querySelector('#cancel-btn');

    confirmBtn.addEventListener('mouseover', () => confirmBtn.style.background = '#bb2d3b');
    confirmBtn.addEventListener('mouseout', () => confirmBtn.style.background = '#dc3545');
    cancelBtn.addEventListener('mouseover', () => cancelBtn.style.background = '#5c636a');
    cancelBtn.addEventListener('mouseout', () => cancelBtn.style.background = '#6c757d');

    // Handle button clicks
    confirmBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve(true);
    });

    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve(false);
    });

    // Handle escape key
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        document.body.removeChild(overlay);
        document.removeEventListener('keydown', handleEscape);
        resolve(false);
      }
    };
    document.addEventListener('keydown', handleEscape);

    // Focus on cancel button by default
    setTimeout(() => cancelBtn.focus(), 100);
  });
}

window.performTotalReset = async function () {
  console.log("performTotalReset started"); // Debug log

  try {
    // Check if Tauri is available
    if (!window.__TAURI__ || !window.__TAURI__.core) {
      throw new Error("Tauri is not available - app might not be running in Tauri context");
    }

    // Show loading state
    const resetButton = document.querySelector('.btn-danger');
    const originalText = resetButton ? resetButton.textContent : '🗑️ Reset All Data';
    if (resetButton) {
      resetButton.textContent = '🔄 Resetting...';
      resetButton.disabled = true;
    }

    console.log("Calling reset_all_data..."); // Debug log

    // Call the backend to delete all data
    const { invoke } = window.__TAURI__.core;
    await invoke('reset_all_data');

    console.log("reset_all_data completed successfully"); // Debug log

    // Clear all localStorage data
    console.log("Clearing localStorage..."); // Debug log
    localStorage.removeItem('pomodoro-session');
    localStorage.removeItem('pomodoro-tasks');
    localStorage.removeItem('pomodoro-settings');
    localStorage.removeItem('pomodoro-history');
    localStorage.removeItem('pomodoro-stats');
    console.log("localStorage cleared"); // Debug log

    // Reset the timer in memory
    if (window.pomodoroTimer) {
      if (typeof window.pomodoroTimer.resetToInitialState === 'function') {
        window.pomodoroTimer.resetToInitialState();
        console.log("Timer reset to initial state"); // Debug log
      } else {
        console.warn("Timer resetToInitialState method not found");
      }
    }

    // Reset settings to defaults
    if (window.settingsManager) {
      if (typeof window.settingsManager.resetToDefaultsForce === 'function') {
        window.settingsManager.resetToDefaultsForce();
        console.log("Settings reset to defaults"); // Debug log
      } else {
        console.warn("SettingsManager resetToDefaultsForce method not found");
      }
    }

    // Reset navigation to timer view
    if (window.navigationManager) {
      if (typeof window.navigationManager.switchView === 'function') {
        window.navigationManager.switchView('timer');
        console.log("Switched to timer view"); // Debug log
      } else {
        console.warn("NavigationManager switchView method not found");
      }
    }

    // Show success message before reload
    console.log("Reset completed successfully, reloading..."); // Debug log

    // Refresh the UI to show reset state
    location.reload();

  } catch (error) {
    console.error('Failed to reset data:', error);
    console.error('Error stack:', error.stack);

    // Show detailed error information
    let errorMessage = 'Failed to reset data. ';
    if (error.message.includes('Tauri')) {
      errorMessage += 'Application context error. Please restart the app and try again.';
    } else {
      errorMessage += 'Error: ' + error.message;
    }

    alert('❌ ' + errorMessage);

    // Restore button state
    const resetButton = document.querySelector('.btn-danger');
    if (resetButton) {
      resetButton.textContent = '🗑️ Reset All Data';
      resetButton.disabled = false;
    }
  }
};

// Initialize theme early to prevent flash
async function initializeEarlyTheme() {
  // Helper function to convert theme preference to actual theme
  function getActualTheme(themePreference) {
    if (themePreference === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return themePreference;
  }

  // Helper function to check if Tauri is available and ready
  function isTauriReady() {
    return typeof window !== 'undefined' &&
      window.__TAURI__ &&
      window.__TAURI__.core &&
      typeof window.__TAURI__.core.invoke === 'function';
  }

  // Helper function to wait for Tauri to be ready (with timeout)
  function waitForTauri(maxWaitTime = 2000) {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const checkTauri = () => {
        if (isTauriReady()) {
          resolve(true);
          return;
        }

        if (Date.now() - startTime > maxWaitTime) {
          resolve(false);
          return;
        }

        setTimeout(checkTauri, 50);
      };

      checkTauri();
    });
  }

  try {
    // Wait for Tauri to be ready before trying to load settings
    const tauriReady = await waitForTauri();

    if (tauriReady) {
      console.log('🎨 Tauri is ready, loading theme from settings...');

      try {
        const { invoke } = window.__TAURI__.core;
        const savedSettings = await invoke('load_settings');
        const themeFromSettings = savedSettings?.appearance?.theme;
        const timerThemeFromSettings = savedSettings?.appearance?.timer_theme;

        if (themeFromSettings) {
          const actualTheme = getActualTheme(themeFromSettings);
          document.documentElement.setAttribute('data-theme', actualTheme);
          localStorage.setItem('theme-preference', themeFromSettings); // Store preference (could be "auto")
          console.log(`🎨 Early theme loaded from settings: ${themeFromSettings} -> actual: ${actualTheme}`);
        }

        // Also initialize timer theme early
        console.log(`🎨 DEBUG: timerThemeFromSettings value:`, timerThemeFromSettings);
        console.log(`🎨 DEBUG: savedSettings full object:`, savedSettings);
        
        if (timerThemeFromSettings) {
          document.documentElement.setAttribute('data-timer-theme', timerThemeFromSettings);
          localStorage.setItem('timer-theme-preference', timerThemeFromSettings);
          console.log(`🎨 Early timer theme loaded from settings: ${timerThemeFromSettings}`);
        } else {
          // Check localStorage first before defaulting
          const storedTimerTheme = localStorage.getItem('timer-theme-preference');
          console.log(`🎨 DEBUG: localStorage timer theme:`, storedTimerTheme);
          
          const themeToUse = storedTimerTheme || 'espresso';
          document.documentElement.setAttribute('data-timer-theme', themeToUse);
          localStorage.setItem('timer-theme-preference', themeToUse);
          console.log(`🎨 Early timer theme initialized to: ${themeToUse} (from ${storedTimerTheme ? 'localStorage' : 'default'})`);
        }

        if (themeFromSettings) {
          return;
        }
      } catch (settingsError) {
        console.log('🎨 Could not load theme from settings, using localStorage fallback:', settingsError.message);
      }
    } else {
      console.log('🎨 Tauri not ready within timeout, using localStorage fallback');
    }
  } catch (error) {
    console.log('🎨 Error waiting for Tauri, using localStorage fallback:', error.message);
  }

  // Fallback to localStorage or default for both themes
  const storedTheme = localStorage.getItem('theme-preference') || 'auto';
  const actualTheme = getActualTheme(storedTheme);
  document.documentElement.setAttribute('data-theme', actualTheme);
  console.log(`🎨 Early theme initialized from localStorage: ${storedTheme} -> actual: ${actualTheme}`);

  // Initialize timer theme with fallback
  const storedTimerTheme = localStorage.getItem('timer-theme-preference') || 'espresso';
  document.documentElement.setAttribute('data-timer-theme', storedTimerTheme);
  console.log(`🎨 Early timer theme initialized from localStorage fallback: ${storedTimerTheme}`);
}

// Request notification permission using Tauri v2 API
async function requestNotificationPermission() {
  try {
    if (window.__TAURI__ && window.__TAURI__.notification) {
      console.log('🔔 Requesting notification permission using Tauri v2...');
      const { isPermissionGranted, requestPermission } = window.__TAURI__.notification;

      // Check if permission is already granted
      let permissionGranted = await isPermissionGranted();

      // If not granted, request permission
      if (!permissionGranted) {
        console.log('Requesting notification permission...');
        const permission = await requestPermission();
        permissionGranted = permission === 'granted';

        if (permissionGranted) {
          console.log('✅ Notification permission granted');
        } else {
          console.log('❌ Notification permission denied');
        }
      } else {
        console.log('✅ Notification permission already granted');
      }
    } else {
      // Fallback to Web Notification API
      console.log('🔔 Requesting notification permission using Web API...');
      if ('Notification' in window) {
        const permission = await Notification.requestPermission();
        console.log(`Notification permission: ${permission}`);
      }
    }
  } catch (error) {
    console.error('Failed to request notification permission:', error);
    // Fallback to Web API
    if ('Notification' in window) {
      Notification.requestPermission();
    }
  }
}

// Show authentication screen
function showAuthScreen() {
  // Hide the main app content
  const appContent = document.querySelector('.app-content') || document.body;
  if (appContent.children.length > 0) {
    for (let child of appContent.children) {
      child.style.display = 'none';
    }
  }

  // Create auth overlay
  const authOverlay = document.createElement('div');
  authOverlay.id = 'auth-overlay';
  authOverlay.className = 'auth-overlay';
  authOverlay.innerHTML = `
    <div class="auth-container">
      <div class="auth-header">
        <h1>Welcome to Presto! 🍅</h1>
        <p>Your productivity companion is ready to help you stay focused.</p>
      </div>
      
      <div class="auth-content">
        <div class="auth-column auth-guest">
          <div class="guest-section">
            <div class="guest-icon">
              <i class="ri-user-line"></i>
            </div>
            <h3>Continue as Guest</h3>
            <p>Try Presto without creating an account. Your data will be stored locally only.</p>
            <button class="auth-btn guest-btn" id="continue-guest">
              <i class="ri-arrow-left-line"></i>
              Continue as Guest
            </button>
            <a href="#" class="guest-link" id="continue-guest-link" style="display: none;">
              <i class="ri-arrow-left-line"></i>
              Continue as Guest
            </a>
          </div>
        </div>
        
        <div class="auth-column auth-main">
          <h2>Sign in to sync your data</h2>
          
          <div class="auth-providers">
            <button class="auth-btn google-btn" data-provider="google">
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Google
            </button>
            
            <button class="auth-btn github-btn" data-provider="github">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              GitHub
            </button>
            
          </div>
          
          <div class="auth-divider">
            <span>or</span>
          </div>
          
          <form id="auth-form" class="email-auth">
            <div class="form-row">
              <input type="email" id="email" placeholder="Email address" required>
              <input type="password" id="password" placeholder="Password" required>
            </div>
            <div class="form-actions">
              <button type="submit" class="auth-btn primary-btn" data-action="signin">Login</button>
              <button type="button" class="auth-btn secondary-btn" data-action="signup">Register</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;

  // Add styles
  const authStyles = document.createElement('style');
  authStyles.textContent = `
    .auth-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: #ffffff;
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
      animation: fadeIn 0.3s ease-in;
    }
    
    .auth-container {
      background: white;
      border-radius: 16px;
      max-width: 480px;
      width: 90%;
      max-height: 90vh;
      overflow-y: auto;
      padding: 32px;
    }
    
    .auth-header {
      text-align: center;
      margin-bottom: 32px;
    }
    
    .auth-header h1 {
      margin: 0 0 8px 0;
      color: #2d3748;
      font-size: 28px;
      font-weight: 600;
    }
    
    .auth-header p {
      margin: 0;
      color: #718096;
      font-size: 16px;
    }
    
    .auth-section h2 {
      margin: 0 0 8px 0;
      color: #2d3748;
      font-size: 20px;
      font-weight: 600;
    }
    
    .auth-section p {
      margin: 0 0 24px 0;
      color: #718096;
      font-size: 14px;
    }
    
    .auth-providers {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 24px;
    }
    
    .auth-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 12px 16px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: white;
      color: #2d3748;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      text-decoration: none;
    }
    
    .auth-btn:hover {
      background: #f7fafc;
      border-color: #cbd5e0;
      transform: translateY(-1px);
    }
    
    .google-btn:hover {
      background: #f8f9ff;
      border-color: #4285F4;
    }
    
    .github-btn:hover {
      background: #f8f9fa;
      border-color: #24292e;
    }
    
    .apple-btn:hover {
      background: #f8f9fa;
      border-color: #000000;
    }
    
    .primary-btn {
      background: #4299e1;
      color: white;
      border-color: #4299e1;
    }
    
    .primary-btn:hover {
      background: #3182ce;
      border-color: #3182ce;
    }
    
    .secondary-btn {
      background: #e2e8f0;
      color: #4a5568;
      border-color: #e2e8f0;
    }
    
    .secondary-btn:hover {
      background: #cbd5e0;
      border-color: #cbd5e0;
    }
    
    .guest-btn {
      background: #48bb78;
      color: white;
      border-color: #48bb78;
      width: 100%;
    }
    
    .guest-btn:hover {
      background: #38a169;
      border-color: #38a169;
    }
    
    .auth-divider, .auth-divider-main {
      display: flex;
      align-items: center;
      margin: 24px 0;
      text-align: center;
    }
    
    .auth-divider::before, .auth-divider::after,
    .auth-divider-main::before, .auth-divider-main::after {
      content: '';
      flex: 1;
      height: 1px;
      background: #e2e8f0;
    }
    
    .auth-divider span, .auth-divider-main span {
      padding: 0 16px;
      color: #a0aec0;
      font-size: 12px;
      text-transform: uppercase;
      font-weight: 500;
    }
    
    .email-auth {
      margin-bottom: 24px;
    }
    
    .form-group {
      margin-bottom: 16px;
    }
    
    .form-group input {
      width: 100%;
      padding: 12px 16px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.2s ease;
      box-sizing: border-box;
    }
    
    .form-group input:focus {
      outline: none;
      border-color: #4299e1;
      box-shadow: 0 0 0 3px rgba(66, 153, 225, 0.1);
    }
    
    .form-actions {
      display: flex;
      gap: 12px;
    }
    
    .form-actions .auth-btn {
      flex: 1;
    }
    
    .guest-section {
      text-align: center;
      padding: 24px;
      background: #f7fafc;
      border-radius: 12px;
    }
    
    .guest-section h3 {
      margin: 0 0 8px 0;
      color: #2d3748;
      font-size: 18px;
      font-weight: 600;
    }
    
    .guest-section p {
      margin: 0 0 16px 0;
      color: #718096;
      font-size: 14px;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }
    
    .auth-loading {
      opacity: 0.7;
      pointer-events: none;
    }
    
    .auth-loading::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 20px;
      height: 20px;
      margin: -10px 0 0 -10px;
      border: 2px solid #ffffff;
      border-radius: 50%;
      border-top-color: transparent;
      animation: spin 1s ease-in-out infinite;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    /* New responsive layout styles */
    .auth-container {
      width: 100%;
      max-width: 900px;
      max-height: 95vh;
      overflow: hidden;
      margin: 20px;
    }
    
    .auth-header {
      text-align: center;
      padding: 32px 32px 24px 32px;
      border-bottom: 1px solid #f1f5f9;
      margin-bottom: 0;
    }
    
    .auth-header h1 {
      margin: 0 0 8px 0;
      color: #1e293b;
      font-size: 28px;
      font-weight: 700;
    }
    
    .auth-header p {
      margin: 0;
      color: #64748b;
      font-size: 16px;
    }
    
    .auth-content {
      display: grid;
      grid-template-columns: 1fr 1fr;
      min-height: calc(95vh - 140px);
    }
    
    .auth-column {
      padding: 32px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    
    .auth-main {
      border-left: 1px solid #f1f5f9;
    }
    
    .auth-main h2 {
      margin: 0 0 24px 0;
      color: #1e293b;
      font-size: 20px;
      font-weight: 600;
      text-align: center;
    }
    
    .auth-providers {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 0px;
    }
    
    .auth-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 16px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: white;
      color: #374151;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      text-decoration: none;
      min-height: 44px;
    }
    
    .auth-btn:hover {
      background: #f8fafc;
      border-color: #cbd5e0;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }
    
    .form-row input {
      width: 100%;
      padding: 12px 16px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      transition: all 0.2s ease;
      box-sizing: border-box;
    }
    
    .primary-btn {
      background: #3b82f6;
      color: white;
      border-color: #3b82f6;
    }
    
    .primary-btn:hover {
      background: #2563eb;
      border-color: #2563eb;
    }
    
    .secondary-btn {
      background: #f1f5f9;
      color: #475569;
      border-color: #e2e8f0;
    }
    
    .secondary-btn:hover {
      background: #e2e8f0;
      border-color: #cbd5e0;
    }
    
    .auth-guest {
      background: #f1f5f9;
      align-items: center;
      text-align: center;
    }
    
    .guest-section {
      max-width: 280px;
      margin: 0 auto;
      text-align: center;
      padding: 0;
      background: transparent;
      border-radius: 0;
    }
    
    .guest-icon {
      width: 80px;
      height: 80px;
      background: #e2e8f0;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px auto;
      box-shadow: 0 8px 25px rgba(226, 232, 240, 0.25);
    }
    
    .guest-icon i {
      font-size: 36px;
      color: #4a5568;
    }
    
    .guest-section h3 {
      margin: 0 0 12px 0;
      color: #1e293b;
      font-size: 22px;
      font-weight: 600;
    }
    
    .guest-section p {
      margin: 0 0 24px 0;
      color: #64748b;
      font-size: 14px;
      line-height: 1.5;
    }
    
    .guest-btn {
      background: #e2e8f0;
      color: #4a5568;
      border-color: #e2e8f0;
      font-weight: 600;
      padding: 14px 24px;
      border-radius: 12px;
      width: 100%;
      gap: 8px;
    }
    
    .guest-btn:hover {
      background: #cbd5e0;
      border-color: #cbd5e0;
      transform: translateY(-2px);
      box-shadow: 0 8px 25px rgba(226, 232, 240, 0.3);
    }
    
    /* Mobile responsiveness */
    @media (max-width: 768px) {
      .auth-container {
        margin: 0;
        border-radius: 0;
        max-height: 100vh;
        height: 100vh;
        box-shadow: none;
        border: none;
      }
      
      .auth-content {
        grid-template-columns: 1fr;
        min-height: calc(100vh - 140px);
        grid-template-areas: 
          "main"
          "guest";
      }
      
      .auth-main {
        border-left: none;
        border-bottom: 1px solid #f1f5f9;
        padding: 24px;
        grid-area: main;
      }
      
      .auth-guest {
        padding: 24px;
        grid-area: guest;
        background: transparent;
      }
      
      .guest-btn {
        display: none !important;
      }
      
      .guest-icon {
        display: none !important;
      }
      
      .guest-section h3 {
        display: none !important;
      }
      
      .guest-section p {
        display: none !important;
      }
      
      .guest-link {
        display: inline-flex !important;
        align-items: center;
        gap: 8px;
        color: #3b82f6;
        text-decoration: underline;
        background: none;
        border: none;
        padding: 0;
        font-size: 16px;
        font-weight: 500;
        cursor: pointer;
      }
      
      .guest-link:hover {
        color: #2563eb;
        transform: none;
        box-shadow: none;
      }
      
      .auth-providers {
        grid-template-columns: 1fr;
        gap: 10px;
      }
      
      .form-row {
        grid-template-columns: 1fr;
      }
      
      .guest-icon {
        width: 60px;
        height: 60px;
        margin-bottom: 16px;
      }
      
      .guest-icon i {
        font-size: 28px;
      }
      
      .guest-section h3 {
        font-size: 20px;
      }
    }
    
    @media (max-width: 480px) {
      .auth-header {
        padding: 24px 20px 20px 20px;
      }
      
      .auth-column {
        padding: 20px;
      }
      
      .auth-header h1 {
        font-size: 24px;
      }
      
      .auth-header p {
        font-size: 14px;
      }
    }
  `;

  document.head.appendChild(authStyles);
  document.body.appendChild(authOverlay);

  // Setup event listeners
  setupAuthEventListeners();
}

// Setup authentication event listeners
function setupAuthEventListeners() {
  const authOverlay = document.getElementById('auth-overlay');
  if (!authOverlay) return;

  // OAuth provider buttons
  const providerButtons = authOverlay.querySelectorAll('[data-provider]');
  providerButtons.forEach(button => {
    button.addEventListener('click', async (e) => {
      const provider = e.currentTarget.dataset.provider;
      await handleOAuthSignIn(provider, e.currentTarget);
    });
  });

  // Email form
  const authForm = document.getElementById('auth-form');
  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      await handleEmailAuth(email, password, 'signin', e.submitter);
    });

    // Sign up button
    const signUpBtn = authForm.querySelector('[data-action="signup"]');
    if (signUpBtn) {
      signUpBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        if (!email || !password) {
          alert('Please enter both email and password');
          return;
        }

        await handleEmailAuth(email, password, 'signup', e.currentTarget);
      });
    }
  }

  // Guest mode button
  const guestBtn = document.getElementById('continue-guest');
  if (guestBtn) {
    guestBtn.addEventListener('click', async () => {
      window.authManager.continueAsGuest();
    });
  }

  // Guest mode link
  const guestLink = document.getElementById('continue-guest-link');
  if (guestLink) {
    guestLink.addEventListener('click', async (e) => {
      e.preventDefault();
      window.authManager.continueAsGuest();
    });
  }

  // Listen for auth state changes (for manual sign-in/out via UI)
  if (window.authManager) {
    window.authManager.onAuthChange(async (status, user) => {
      if (status === 'authenticated' || status === 'guest') {
        await hideAuthScreen();
        // Note: App initialization is now handled directly, not through auth changes
      }
    });
  }
}

// Handle OAuth sign-in
async function handleOAuthSignIn(provider, button) {
  setButtonLoading(button, true);

  try {
    const result = await window.authManager.signInWithProvider(provider);
    if (!result.success) {
      alert(`Sign-in failed: ${result.error}`);
    }
  } catch (error) {
    console.error('OAuth sign-in error:', error);
    alert(`Sign-in failed: ${error.message}`);
  } finally {
    setButtonLoading(button, false);
  }
}

// Handle email authentication
async function handleEmailAuth(email, password, action, button) {
  if (!email || !password) {
    alert('Please enter both email and password');
    return;
  }

  setButtonLoading(button, true);

  try {
    let result;
    if (action === 'signin') {
      result = await window.authManager.signInWithEmail(email, password);
    } else {
      result = await window.authManager.signUpWithEmail(email, password);
    }

    if (!result.success) {
      alert(`${action === 'signin' ? 'Sign-in' : 'Sign-up'} failed: ${result.error}`);
    }
  } catch (error) {
    console.error('Email auth error:', error);
    alert(`${action === 'signin' ? 'Sign-in' : 'Sign-up'} failed: ${error.message}`);
  } finally {
    setButtonLoading(button, false);
  }
}

// Set button loading state
function setButtonLoading(button, loading) {
  if (loading) {
    button.classList.add('auth-loading');
    button.disabled = true;
  } else {
    button.classList.remove('auth-loading');
    button.disabled = false;
  }
}

// Hide authentication screen
async function hideAuthScreen() {
  const authOverlay = document.getElementById('auth-overlay');
  if (authOverlay) {
    authOverlay.remove();
  }

  // Show the main app content
  const appContent = document.querySelector('.app-content') || document.body;
  if (appContent.children.length > 0) {
    for (let child of appContent.children) {
      child.style.display = '';
    }
  }

  // Update avatar UI after auth screen is hidden
  await updateUserAvatarUI();
}

// Update user avatar UI based on auth state
async function updateUserAvatarUI() {
  const avatarContainer = document.getElementById('user-avatar-container');
  const avatarImg = document.getElementById('user-avatar-img');
  const avatarFallback = document.getElementById('user-avatar-fallback');
  const guestIcon = document.getElementById('user-guest-icon');
  const userInitial = document.getElementById('user-initial');
  const userName = document.getElementById('user-name');
  const userStatus = document.getElementById('user-status');
  const signOutBtn = document.getElementById('user-sign-out');
  const signInBtn = document.getElementById('user-sign-in');
  const dropdown = document.getElementById('user-dropdown');

  if (!avatarContainer) return;

  // Hide dropdown if it's open
  if (dropdown) {
    dropdown.style.display = 'none';
  }

  // Always show avatar container
  avatarContainer.style.display = 'flex';

  // Reset all fallback elements
  if (guestIcon) guestIcon.style.display = 'none';
  if (userInitial) userInitial.style.display = 'none';

  if (window.authManager && window.authManager.isAuthenticated()) {
    // User is authenticated
    const user = window.authManager.getCurrentUser();
    const avatarUrl = window.authManager.getUserAvatarUrl();
    const displayName = window.authManager.getUserDisplayName();

    // Try to load avatar image
    if (avatarUrl) {
      try {
        // Test if the image loads successfully
        await testImageLoad(avatarUrl);
        avatarImg.src = avatarUrl;
        avatarImg.style.display = 'block';
        avatarFallback.style.display = 'none';
      } catch (error) {
        // Image failed to load, show initial
        avatarImg.style.display = 'none';
        avatarFallback.style.display = 'flex';
        if (userInitial) {
          userInitial.textContent = displayName.charAt(0).toUpperCase();
          userInitial.style.display = 'block';
        }
      }
    } else {
      // No avatar URL, show initial
      avatarImg.style.display = 'none';
      avatarFallback.style.display = 'flex';
      if (userInitial) {
        userInitial.textContent = displayName.charAt(0).toUpperCase();
        userInitial.style.display = 'block';
      }
    }

    // Update user info
    if (userName) userName.textContent = displayName;
    if (userStatus) userStatus.textContent = 'Signed In';

    // Show sign out, hide sign in
    if (signOutBtn) signOutBtn.style.display = 'flex';
    if (signInBtn) signInBtn.style.display = 'none';

  } else {
    // Guest mode or not authenticated - show user icon
    avatarImg.style.display = 'none';
    avatarFallback.style.display = 'flex';
    if (guestIcon) guestIcon.style.display = 'block';

    if (userName) userName.textContent = 'Guest';
    if (userStatus) userStatus.textContent = 'Sync your data and access your sessions across devices.';

    // Hide sign out, show sign in
    if (signOutBtn) signOutBtn.style.display = 'none';
    if (signInBtn) signInBtn.style.display = 'flex';
  }
}

// Test if an image URL loads successfully
function testImageLoad(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = url;
  });
}

// Position dropdown intelligently based on screen size and available space
function positionDropdown(avatarBtn, dropdown) {
  const isMobile = window.innerWidth <= 768;
  const avatarRect = avatarBtn.getBoundingClientRect();
  const dropdownRect = dropdown.getBoundingClientRect();

  // Reset any inline positioning
  dropdown.style.left = '';
  dropdown.style.right = '';
  dropdown.style.bottom = '';
  dropdown.style.top = '';
  dropdown.style.transform = '';

  if (isMobile) {
    // Mobile: position above the avatar, centered
    dropdown.style.bottom = '60px';
    dropdown.style.left = '50%';
    dropdown.style.transform = 'translateX(-50%)';

    // Check if dropdown would go off-screen horizontally
    const dropdownWidth = 200; // Our dropdown width
    const sidebarCenter = avatarRect.left + (avatarRect.width / 2);
    const leftEdge = sidebarCenter - (dropdownWidth / 2);
    const rightEdge = sidebarCenter + (dropdownWidth / 2);

    if (leftEdge < 10) {
      // Too far left, adjust
      dropdown.style.left = '10px';
      dropdown.style.transform = 'none';
    } else if (rightEdge > window.innerWidth - 10) {
      // Too far right, adjust
      dropdown.style.right = '10px';
      dropdown.style.left = 'auto';
      dropdown.style.transform = 'none';
    }
  } else {
    // Desktop: position to the right of the avatar
    dropdown.style.bottom = '0';
    dropdown.style.left = '70px';

    // Check if dropdown would go off-screen to the right
    const dropdownRight = avatarRect.right + 200; // dropdown width
    if (dropdownRight > window.innerWidth - 20) {
      // Position to the left instead
      dropdown.style.left = 'auto';
      dropdown.style.right = '70px';
    }

    // Check if dropdown would go off-screen vertically
    const dropdownBottom = avatarRect.bottom;
    const dropdownHeight = 120; // Approximate dropdown height
    if (dropdownBottom + dropdownHeight > window.innerHeight - 20) {
      // Position above instead
      dropdown.style.bottom = 'auto';
      dropdown.style.top = `-${dropdownHeight}px`;
    }
  }
}

// Setup user avatar event listeners
function setupUserAvatarEventListeners() {
  // Prevent multiple setups
  if (window.avatarListenersSetup) {
    console.log('🔄 Avatar listeners already setup, skipping...');
    return;
  }

  const avatarBtn = document.getElementById('user-avatar-btn');
  const dropdown = document.getElementById('user-dropdown');
  const signOutBtn = document.getElementById('user-sign-out');
  const signInBtn = document.getElementById('user-sign-in');

  console.log('🎯 Setting up avatar listeners...', { avatarBtn: !!avatarBtn, dropdown: !!dropdown });

  // Toggle dropdown on avatar click
  if (avatarBtn && dropdown) {
    avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('🖱️ Avatar clicked! Auth state:', {
        isAuthenticated: window.authManager?.isAuthenticated(),
        isGuest: window.authManager?.isGuestMode(),
        user: window.authManager?.getCurrentUser()?.email
      });

      // If user is not authenticated and not in guest mode, show auth screen
      if (!window.authManager || (!window.authManager.isAuthenticated() && !window.authManager.isGuestMode())) {
        localStorage.removeItem('presto-auth-seen');
        showAuthScreen();
        return;
      }

      // For both authenticated users and guests, show the dropdown
      // Guests will see "Sign In" option, authenticated users will see "Sign Out"

      // Toggle dropdown
      const isVisible = dropdown.style.display === 'block';
      console.log('🔽 Toggling dropdown. Currently visible:', isVisible);

      if (isVisible) {
        dropdown.style.display = 'none';
        console.log('🔼 Dropdown hidden');
      } else {
        // Show dropdown and position it intelligently
        dropdown.style.display = 'block';
        positionDropdown(avatarBtn, dropdown);
        console.log('🔽 Dropdown shown and positioned');
      }
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (dropdown && !dropdown.contains(e.target) && !avatarBtn.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  // Sign out handler
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      dropdown.style.display = 'none';

      const result = await window.authManager.signOut();
      if (result.success) {
        await updateUserAvatarUI();
        NotificationUtils.showNotificationPing('Signed out successfully! 👋', null, 'focus');
      } else {
        alert(`Sign out failed: ${result.error}`);
      }
    });
  }

  // Sign in handler
  if (signInBtn) {
    signInBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.style.display = 'none';

      // Clear the first run flag temporarily to show auth screen
      localStorage.removeItem('presto-auth-seen');
      showAuthScreen();
    });
  }

  // Listen for auth state changes
  if (window.authManager) {
    window.authManager.onAuthChange(async (status, user) => {
      console.log('🔄 Auth state changed:', status, user?.email || 'no user');
      await updateUserAvatarUI();
    });
  }

  // Reposition dropdown on window resize
  window.addEventListener('resize', () => {
    if (dropdown && dropdown.style.display === 'block') {
      positionDropdown(avatarBtn, dropdown);
    }
  });

  // Mark listeners as setup
  window.avatarListenersSetup = true;
  console.log('✅ Avatar listeners setup complete');
}


// Initialize the application
async function initializeApplication() {
  // Prevent double initialization only if fully completed
  if (window._appFullyInitialized) {
    console.log('🚀 Application already fully initialized, skipping...');
    return;
  }

  // Prevent concurrent initialization attempts
  if (window._appInitializing) {
    console.log('🚀 Application initialization already in progress, skipping...');
    return;
  }

  // Set initialization flag early to prevent race conditions
  window._appInitializing = true;

  try {
    console.log('🚀 Initializing Presto application...');

    // Show loading state
    const loadingOverlay = document.createElement('div');
    loadingOverlay.id = 'app-loading';
    loadingOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 9999;
      color: white;
      font-size: 18px;
      font-family: system-ui, -apple-system, sans-serif;
    `;
    loadingOverlay.innerHTML = `
      <div style="text-align: center;">
        <div style="font-size: 48px; margin-bottom: 20px;">🍅</div>
        <div>Initializing Presto...</div>
      </div>
    `;
    document.body.appendChild(loadingOverlay);

    // Safety timeout to remove loading overlay if initialization hangs
    const safetyTimeout = setTimeout(() => {
      const stuckOverlay = document.getElementById('app-loading');
      if (stuckOverlay) {
        console.error('⚠️ Initialization timeout - removing loading overlay');
        stuckOverlay.remove();

        // Show error message
        NotificationUtils.showNotificationPing('Initialization timed out. Please refresh! 🔄', 'error');
      }
    }, 15000); // 15 seconds timeout

    // Helper function to update loading text
    const updateLoadingText = (text) => {
      const overlay = document.getElementById('app-loading');
      if (overlay) {
        const textElement = overlay.querySelector('div:last-child');
        if (textElement) {
          textElement.textContent = text;
        }
      }
    };

    // Initialize theme as early as possible
    updateLoadingText('Loading theme...');
    await initializeEarlyTheme();

    // Request notification permission using Tauri v2 API
    updateLoadingText('Requesting permissions...');
    await requestNotificationPermission();

    // Import and initialize auth manager 
    updateLoadingText('Loading authentication...');
    const { authManager } = await import('./managers/auth-manager.js');
    console.log('🔐 Initializing Auth Manager...');
    window.authManager = authManager;

    // Initialize auth manager (which will wait for Supabase)
    updateLoadingText('Connecting to services...');
    await authManager.init();

    // Initialize Update Manager early (needed by UpdateNotification)
    updateLoadingText('Initializing update system...');
    console.log('🔄 Initializing Update Manager...');
    window.updateManager = new window.UpdateManagerV2();
    window.updateManagerInstance = window.updateManager; // Alias for compatibility
    if (window.updateManager.loadPreferences) {
      window.updateManager.loadPreferences(); // Carica le preferenze salvate se supportato
    }

    // Skip first run authentication - proceed directly with guest mode
    if (authManager.isFirstRun()) {
      console.log('👋 First run detected, proceeding as guest...');
      // Set guest mode automatically
      authManager.continueAsGuest();
    }

    // Update user avatar UI based on current auth state
    await updateUserAvatarUI();

    // Initialize settings manager first (other modules depend on it)
    console.log('📋 Initializing Settings Manager...');
    settingsManager = new SettingsManager();
    window.settingsManager = settingsManager;
    await settingsManager.init();

    // Initialize the core timer
    console.log('⏱️ Initializing Pomodoro Timer...');
    timer = new PomodoroTimer();
    window.pomodoroTimer = timer; // Make it globally accessible

    // Apply settings to timer
    if (settingsManager.settings) {
      await timer.applySettings(settingsManager.settings);
    }

    // Initialize navigation manager
    console.log('🧭 Initializing Navigation Manager...');
    navigation = new NavigationManager();
    window.navigationManager = navigation;
    await navigation.init();

    // Initialize Session Manager
    console.log('📊 Initializing Session Manager...');
    sessionManager = new SessionManager(navigation);
    window.sessionManager = sessionManager;

    // Initialize Team Manager
    console.log('👥 Initializing Team Manager...');
    teamManager = new TeamManager();
    window.teamManager = teamManager;

    // Initialize Background Manager
    console.log('🎨 Initializing Background Manager...');
    const { backgroundManager } = await import('./managers/background-manager.js');
    window.backgroundManager = backgroundManager;

    // Update Manager already initialized earlier

    // Setup global event listeners
    setupGlobalEventListeners();

    // Setup user avatar event listeners
    setupUserAvatarEventListeners();

    // Setup update management
    setupUpdateManagement();

    console.log('✅ Application initialized successfully!');

    // Clear safety timeout
    clearTimeout(safetyTimeout);

    // Mark as fully initialized
    window._appFullyInitialized = true;
    window._appInitializing = false;

    // Remove loading overlay
    const loadingOverlaySuccess = document.getElementById('app-loading');
    if (loadingOverlaySuccess) {
      loadingOverlaySuccess.remove();
    }

    // Show welcome notification
    NotificationUtils.showNotificationPing('Welcome to Presto! 🍅', null, 'focus');

  } catch (error) {
    console.error('❌ Failed to initialize application:', error);

    // Clear safety timeout and remove loading overlay even on error
    clearTimeout(safetyTimeout);
    const loadingOverlayError = document.getElementById('app-loading');
    if (loadingOverlayError) {
      loadingOverlayError.remove();
    }

    // Show error notification
    NotificationUtils.showNotificationPing('Failed to initialize app. Please refresh! 🔄', 'error');

    // Reset initialization flags on error so user can retry
    window._appInitializing = false;
    window._appFullyInitialized = false;

    // Show error screen instead of leaving user with blank screen
    const errorScreen = document.createElement('div');
    errorScreen.id = 'app-error';
    errorScreen.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: #1a1a1a;
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 9999;
      color: white;
      font-family: system-ui, -apple-system, sans-serif;
    `;
    errorScreen.innerHTML = `
      <div style="text-align: center; max-width: 500px; padding: 40px;">
        <div style="font-size: 64px; margin-bottom: 20px;">⚠️</div>
        <h1 style="margin-bottom: 20px; color: #e74c3c;">Initialization Failed</h1>
        <p style="margin-bottom: 30px; line-height: 1.6; color: #bdc3c7;">
          The application failed to initialize properly. This might be due to:
        </p>
        <ul style="text-align: left; margin-bottom: 30px; color: #bdc3c7;">
          <li>Missing dependencies</li>
          <li>Corrupted settings</li>
          <li>System permission issues</li>
        </ul>
        <button onclick="location.reload()" style="
          background: #3498db;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 6px;
          font-size: 16px;
          cursor: pointer;
          margin-right: 10px;
        ">🔄 Retry</button>
        <button onclick="localStorage.clear(); location.reload()" style="
          background: #e74c3c;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 6px;
          font-size: 16px;
          cursor: pointer;
        ">🗑️ Reset & Retry</button>
      </div>
    `;
    document.body.appendChild(errorScreen);
  }
}

// Setup global event listeners
function setupGlobalEventListeners() {
  // Setup reset button event listener
  const resetButton = document.getElementById('reset-all-data-btn');
  if (resetButton) {
    resetButton.addEventListener('click', () => {
      console.log("Reset button clicked via event listener"); // Debug log
      window.confirmTotalReset();
    });
    console.log("Reset button event listener added"); // Debug log
  } else {
    console.error("Reset button not found in DOM"); // Debug log
  }

  // Setup other settings buttons event listeners
  const resetToDefaultsBtn = document.querySelector('.btn-secondary');
  if (resetToDefaultsBtn && resetToDefaultsBtn.textContent.includes('Reset to Defaults')) {
    resetToDefaultsBtn.addEventListener('click', () => {
      console.log("Reset to defaults button clicked via event listener");
      window.resetToDefaults();
    });
    // Remove onclick attribute
    resetToDefaultsBtn.removeAttribute('onclick');
  }

  // Global keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Escape key to close modals
    if (e.code === 'Escape') {
      // Close any open modals
      const modal = document.querySelector('.modal-overlay');
      if (modal) {
        modal.click(); // Trigger close
      }
    }
  });

  // Handle visibility change for smart pause
  document.addEventListener('visibilitychange', () => {
    if (timer && timer.smartPauseEnabled) {
      if (document.hidden) {
        // Page is hidden, user might be inactive
        console.log('Page hidden - potential inactivity');
      } else {
        // Page is visible again, user is active
        timer.handleUserActivity && timer.handleUserActivity();
      }
    }
  });
}

// Setup update management
function setupUpdateManagement() {
  console.log('🔄 Setting up update management...');

  // Update status elements
  const updateStatus = document.getElementById('update-status');
  const currentVersionElement = document.getElementById('current-version');
  const currentVersionDisplay = document.getElementById('current-version-display');
  const checkUpdatesBtn = document.getElementById('check-updates-btn');
  const autoCheckUpdates = document.getElementById('auto-check-updates');
  const viewReleasesLink = document.getElementById('view-releases-link');
  const updateSourceUrl = document.getElementById('update-source-url');

  // Progress elements
  const updateProgress = document.getElementById('update-progress');
  const progressTitle = document.getElementById('progress-title');
  const progressDescription = document.getElementById('progress-description');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  // Update info elements
  const updateInfo = document.getElementById('update-info');
  const latestVersionDisplay = document.getElementById('latest-version-display');
  const downloadUpdateBtn = document.getElementById('download-update-btn');
  const skipUpdateBtn = document.getElementById('skip-update-btn');

  // Set current version - get it from update manager
  async function setCurrentVersion() {
    try {
      const currentVersion = await updateManager.getCurrentVersion();
      if (currentVersionElement) {
        currentVersionElement.textContent = currentVersion;
      }
      if (currentVersionDisplay) {
        currentVersionDisplay.textContent = currentVersion;
      }
      console.log('📋 Versione corrente impostata:', currentVersion);
    } catch (error) {
      console.error('❌ Errore nel recupero versione corrente:', error);
      // Fallback ai valori di default
      if (currentVersionElement) {
        currentVersionElement.textContent = '0.1.0';
      }
      if (currentVersionDisplay) {
        currentVersionDisplay.textContent = '0.1.0';
      }
    }
  }

  // Imposta la versione corrente
  setCurrentVersion();

  // Setup repository link
  if (viewReleasesLink) {
    viewReleasesLink.href = 'https://github.com/murdercode/presto/releases';
    viewReleasesLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.__TAURI__?.shell) {
        window.__TAURI__.shell.open('https://github.com/murdercode/presto/releases');
      }
    });
  }

  // Setup source URL
  if (updateSourceUrl) {
    updateSourceUrl.textContent = 'GitHub Releases API';
  }

  // Check for updates button
  if (checkUpdatesBtn) {
    checkUpdatesBtn.addEventListener('click', async () => {
      checkUpdatesBtn.disabled = true;
      showUpdateProgress('Checking for updates...', 'Please wait while we check for the latest version.');

      try {
        const hasUpdate = await updateManager.checkForUpdates(false);
        hideUpdateProgress();

        if (hasUpdate) {
          showUpdateInfo(updateManager.currentUpdate);
          updateStatus.innerHTML = '<span class="status-text update-available">Update available!</span>';
        } else {
          updateStatus.innerHTML = '<span class="status-text up-to-date">You\'re up to date!</span>';
        }
      } catch (error) {
        hideUpdateProgress();
        updateStatus.innerHTML = '<span class="status-text error">Check failed</span>';
        console.error('Update check failed:', error);
      } finally {
        checkUpdatesBtn.disabled = false;
      }
    });
  }

  // Auto-check updates checkbox
  if (autoCheckUpdates) {
    autoCheckUpdates.checked = updateManager.autoCheck;
    autoCheckUpdates.addEventListener('change', (e) => {
      updateManager.setAutoCheck(e.target.checked);
    });
  }

  // Download update button
  if (downloadUpdateBtn) {
    downloadUpdateBtn.addEventListener('click', async () => {
      downloadUpdateBtn.disabled = true;
      hideUpdateInfo();
      showUpdateProgress('Downloading update...', 'Please wait while the update is downloaded and installed.');

      await updateManager.downloadAndInstall();
    });
  }

  // Skip update button
  if (skipUpdateBtn) {
    skipUpdateBtn.addEventListener('click', () => {
      hideUpdateInfo();
      updateStatus.innerHTML = '<span class="status-text">Update skipped</span>';
    });
  }

  // Update manager event handlers
  updateManager.on('checkStarted', () => {
    if (updateStatus) {
      updateStatus.innerHTML = '<span class="status-text checking">Checking for updates...</span>';
    }
  });

  updateManager.on('updateAvailable', (event) => {
    const update = event.detail;
    if (updateStatus) {
      updateStatus.innerHTML = '<span class="status-text update-available">Update available!</span>';
    }
    showUpdateInfo(update);
  });

  updateManager.on('updateNotAvailable', () => {
    if (updateStatus) {
      updateStatus.innerHTML = '<span class="status-text up-to-date">You\'re up to date!</span>';
    }
  });

  updateManager.on('checkError', () => {
    if (updateStatus) {
      updateStatus.innerHTML = '<span class="status-text error">Check failed</span>';
    }
  });

  updateManager.on('downloadProgress', (event) => {
    const { progress } = event.detail;
    updateProgressBar(progress);
  });

  updateManager.on('downloadFinished', () => {
    showUpdateProgress('Installing...', 'The update will be applied when the app restarts.');
    updateProgressBar(100);
  });

  // Helper functions
  function showUpdateProgress(title, description) {
    if (updateProgress) {
      updateProgress.style.display = 'block';
    }
    if (progressTitle) {
      progressTitle.textContent = title;
    }
    if (progressDescription) {
      progressDescription.textContent = description;
    }
    updateProgressBar(0);
  }

  function hideUpdateProgress() {
    if (updateProgress) {
      updateProgress.style.display = 'none';
    }
  }

  function updateProgressBar(progress) {
    if (progressFill) {
      progressFill.style.width = `${progress}%`;
    }
    if (progressText) {
      progressText.textContent = `${progress}%`;
    }
  }

  function showUpdateInfo(update) {
    if (updateInfo && latestVersionDisplay) {
      latestVersionDisplay.textContent = update.version;
      updateInfo.style.display = 'block';
    }
  }

  function hideUpdateInfo() {
    if (updateInfo) {
      updateInfo.style.display = 'none';
    }
  }

  // Initial status
  if (updateStatus) {
    updateStatus.innerHTML = '<span class="status-text">Ready to check for updates</span>';
  }

  console.log('✅ Update management setup complete');
}

// Application lifecycle management
window.addEventListener('beforeunload', () => {
  console.log('🔄 Application shutting down...');

  // Save any pending data
  if (timer) {
    timer.saveSessionData && timer.saveSessionData();
  }

  if (settingsManager) {
    settingsManager.saveSettings && settingsManager.saveSettings();
  }
});

// Handle errors gracefully
window.addEventListener('error', (event) => {
  console.error('Global error caught:', event.error);
  NotificationUtils.showNotificationPing('An error occurred. Check console for details.', 'error');
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  NotificationUtils.showNotificationPing('An error occurred. Check console for details.', 'error');
});

// Initialize when DOM is ready
function initializeWhenReady() {
  // Check if DOM is already loaded
  if (document.readyState === 'loading') {
    // DOM is still loading, wait for DOMContentLoaded
    document.addEventListener('DOMContentLoaded', initializeApplication);
  } else {
    // DOM is already loaded, initialize immediately
    initializeApplication();
  }
}

// Also add a backup initialization in case DOMContentLoaded doesn't fire
window.addEventListener('load', () => {
  if (!window._appFullyInitialized && !window._appInitializing) {
    console.log('🚀 Backup initialization triggered by window.load');
    initializeApplication();
  }
});

// Initialize when ready
initializeWhenReady();

// Export for debugging
window.app = {
  timer: () => timer,
  navigation: () => navigation,
  settingsManager: () => settingsManager,
  sessionManager: () => sessionManager,
  reinitialize: initializeApplication
};
