import { setLocale, getLocale, locales } from '../paraglide/runtime.js';
import * as m from '../paraglide/messages.js';

/**
 * Localization Manager for Presto App
 * Handles language switching and text localization
 */
export class LocalizationManager {
    constructor() {
        this.currentLocale = getLocale();
        this.init();
    }

    /**
     * Initialize localization system
     */
    init() {
        // Load saved locale from localStorage or use default
        const savedLocale = localStorage.getItem('app-locale');
        if (savedLocale && locales.includes(savedLocale)) {
            this.setLocale(savedLocale);
        }
        
        // Update all text content on page
        this.updateAllText();
        
        // Set up locale switcher if exists
        this.setupLocaleSwitcher();
    }

    /**
     * Set the current locale
     * @param {string} locale - The locale to set (e.g., 'en', 'it')
     */
    setLocale(locale) {
        if (!locales.includes(locale)) {
            console.warn(`Locale '${locale}' is not supported. Available locales: ${locales.join(', ')}`);
            return;
        }
        
        setLocale(locale);
        this.currentLocale = locale;
        
        // Save to localStorage
        localStorage.setItem('app-locale', locale);
        
        // Update HTML lang attribute
        document.documentElement.lang = locale;
        
        // Update all text content
        this.updateAllText();
    }

    /**
     * Get current locale
     * @returns {string} Current locale
     */
    getLocale() {
        return this.currentLocale;
    }

    /**
     * Get available locales
     * @returns {string[]} Array of available locales
     */
    getAvailableLocales() {
        return [...locales];
    }

    /**
     * Update all text content on the page
     */
    updateAllText() {
        // Update page title
        document.title = m['app.title']();

        // Update navigation
        this.updateElement('timer-nav', 'title', m['navigation.timer']());
        this.updateElement('calendar-nav', 'title', m['navigation.calendar']());
        this.updateElement('team-nav', 'title', m['navigation.team']());
        this.updateElement('settings-nav', 'title', m['navigation.settings']());

        // Update user section
        this.updateElement('user-avatar-img', 'alt', m['user.avatar']());
        this.updateElement('user-name', 'textContent', m['user.guest']());
        this.updateElement('user-status', 'textContent', m['user.guestMode']());
        this.updateElement('user-sign-in', 'textContent', m['user.signIn']());
        this.updateElement('user-sign-out', 'textContent', m['user.signOut']());

        // Update timer section
        this.updateElement('status-text', 'textContent', m['timer.focus']());
        this.updateElement('smart-indicator', 'data-tooltip', m['timer.smartPause']());
        this.updateElement('auto-start-indicator', 'data-tooltip', m['timer.autoStart']());
        this.updateElement('continuous-session-indicator', 'data-tooltip', m['timer.continuousSessions']());
        this.updateElement('timer-minus-btn', 'title', m['timer.subtract5Minutes']());
        this.updateElement('timer-plus-btn', 'title', m['timer.add5Minutes']());

        // Update tag dropdown
        const tagDropdownHeader = document.querySelector('.tag-dropdown-header span');
        if (tagDropdownHeader) {
            tagDropdownHeader.textContent = m['timer.chooseTag']();
        }

        const newTagInput = document.getElementById('new-tag-name');
        if (newTagInput) {
            newTagInput.placeholder = m['timer.newTag']();
        }

        // Update calendar section
        this.updateCalendarSection();

        // Update team section
        this.updateTeamSection();

        // Update settings section
        this.updateSettingsSection();

        // Update modal
        this.updateModalSection();
    }

    /**
     * Update calendar section text
     */
    updateCalendarSection() {
        const calendarView = document.getElementById('calendar-view');
        if (calendarView) {
            const title = calendarView.querySelector('h1');
            if (title) title.textContent = m['calendar.title']();

            // Update summary labels
            this.updateElement('total-focus-week', 'textContent', null, '.metric-label', m['calendar.weeklyFocusTime']());
            this.updateElement('avg-focus-day', 'textContent', null, '.metric-label', m['calendar.averageFocusDay']());
            
            // Update chart titles
            const weeklyChartTitle = document.querySelector('.weekly-chart-card h3');
            if (weeklyChartTitle) weeklyChartTitle.textContent = m['calendar.thisWeeksSessions']();

            const dailyChartTitle = document.querySelector('.daily-chart-card h3');
            if (dailyChartTitle) dailyChartTitle.textContent = m['calendar.todaysDevelopment']();

            // Update legend
            const focusLegend = document.querySelector('.legend-item .legend-color.focus');
            if (focusLegend && focusLegend.nextSibling) {
                focusLegend.nextSibling.textContent = m['calendar.focusSessions']();
            }

            const breakLegend = document.querySelector('.legend-item .legend-color.break');
            if (breakLegend && breakLegend.nextSibling) {
                breakLegend.nextSibling.textContent = m['calendar.breakTime']();
            }

            // Update day labels
            const dayLabels = document.querySelectorAll('.week-days-labels span');
            const dayMessages = [
                m['calendar.days.mon'](),
                m['calendar.days.tue'](),
                m['calendar.days.wed'](),
                m['calendar.days.thu'](),
                m['calendar.days.fri'](),
                m['calendar.days.sat'](),
                m['calendar.days.sun']()
            ];
            dayLabels.forEach((label, index) => {
                if (dayMessages[index]) {
                    label.textContent = dayMessages[index];
                }
            });

            // Update table headers
            const tableHeaders = document.querySelectorAll('#sessions-table th');
            const headerMessages = [
                m['calendar.date'](),
                m['calendar.time'](),
                m['calendar.duration'](),
                m['calendar.tags'](),
                m['calendar.actions']()
            ];
            tableHeaders.forEach((header, index) => {
                if (headerMessages[index]) {
                    header.textContent = headerMessages[index];
                }
            });
        }
    }

    /**
     * Update team section text
     */
    updateTeamSection() {
        const teamTitle = document.querySelector('#team-view .page-header');
        if (teamTitle) teamTitle.textContent = m['team.title']();

        const teamSubtitle = document.querySelector('#team-view .team-subtitle');
        if (teamSubtitle) teamSubtitle.textContent = m['team.subtitle']();

        // Update team stat labels
        const statLabels = document.querySelectorAll('.team-stat-card .stat-label');
        const statMessages = [
            m['team.focusing'](),
            m['team.onBreak'](),
            m['team.privacyMode'](),
            m['team.offline']()
        ];
        statLabels.forEach((label, index) => {
            if (statMessages[index]) {
                label.textContent = statMessages[index];
            }
        });

        const teamsOverview = document.querySelector('.team-members-container h2');
        if (teamsOverview) teamsOverview.textContent = m['team.teamsOverview']();
    }

    /**
     * Update settings section text
     */
    updateSettingsSection() {
        // Update settings navigation
        const settingsNav = document.querySelectorAll('.settings-nav-item span');
        const navMessages = [
            m['settings.categories.general'](),
            m['settings.categories.shortcuts'](),
            m['settings.categories.notifications'](),
            m['settings.categories.theme'](),
            m['settings.categories.automation'](),
            m['settings.categories.goals'](),
            m['settings.categories.advanced'](),
            m['settings.categories.updates']()
        ];
        settingsNav.forEach((nav, index) => {
            if (navMessages[index]) {
                nav.textContent = navMessages[index];
            }
        });

        // Update settings main title
        const settingsTitle = document.querySelector('.settings-sidebar h2');
        if (settingsTitle) settingsTitle.textContent = m['settings.title']();

        // Update category titles and descriptions
        this.updateSettingsCategories();
    }

    /**
     * Update settings categories
     */
    updateSettingsCategories() {
        // General settings
        const generalTitle = document.querySelector('#category-general .category-header h1');
        if (generalTitle) generalTitle.textContent = m['settings.general.title']();

        const generalDesc = document.querySelector('#category-general .category-description');
        if (generalDesc) generalDesc.textContent = m['settings.general.description']();

        // Update more settings sections as needed...
        // This would be quite extensive, so I'll show the pattern
    }

    /**
     * Update modal section text
     */
    updateModalSection() {
        this.updateElement('session-modal-title', 'textContent', m['modal.addSession']());
        
        const durationLabel = document.querySelector('label[for="session-duration"]');
        if (durationLabel) durationLabel.textContent = m['modal.durationMinutes']();

        const startTimeLabel = document.querySelector('label[for="session-start-time"]');
        if (startTimeLabel) startTimeLabel.textContent = m['modal.startTime']();

        const endTimeLabel = document.querySelector('label[for="session-end-time"]');
        if (endTimeLabel) endTimeLabel.textContent = m['modal.endTime']();

        this.updateElement('cancel-session-btn', 'textContent', m['modal.cancel']());
        this.updateElement('delete-session-btn', 'textContent', m['modal.delete']());
        this.updateElement('save-session-btn', 'textContent', m['modal.saveSession']());
    }

    /**
     * Helper method to update element content
     * @param {string} id - Element ID
     * @param {string} property - Property to update ('textContent', 'title', etc.)
     * @param {string} value - New value
     * @param {string} selector - Additional selector if needed
     * @param {string} altValue - Alternative value if element not found by ID
     */
    updateElement(id, property, value, selector = null, altValue = null) {
        let element = document.getElementById(id);
        
        if (!element && selector) {
            element = document.querySelector(selector);
        }
        
        if (element && value) {
            element[property] = value;
        } else if (element && altValue) {
            element[property] = altValue;
        }
    }

    /**
     * Set up locale switcher UI
     */
    setupLocaleSwitcher() {
        // Find existing locale switcher in settings
        const switcher = document.getElementById('locale-switcher');
        if (switcher) {
            // Add event listeners
            switcher.addEventListener('change', (e) => {
                this.setLocale(e.target.value);
            });
            
            // Set current value
            switcher.value = this.currentLocale;
        }
    }

    /**
     * Create locale switcher element
     * @returns {HTMLElement} Locale switcher element
     */
    createLocaleSwitcher() {
        const switcher = document.createElement('select');
        switcher.id = 'locale-switcher';
        switcher.className = 'locale-switcher';
        
        locales.forEach(locale => {
            const option = document.createElement('option');
            option.value = locale;
            option.textContent = locale.toUpperCase();
            switcher.appendChild(option);
        });
        
        // Add to settings or navigation area
        const settingsNav = document.querySelector('.settings-nav');
        if (settingsNav) {
            const switcherContainer = document.createElement('div');
            switcherContainer.className = 'locale-switcher-container';
            switcherContainer.innerHTML = `
                <label for="locale-switcher">Language:</label>
            `;
            switcherContainer.appendChild(switcher);
            settingsNav.appendChild(switcherContainer);
        }
        
        return switcher;
    }
}

// Export singleton instance
export const localizationManager = new LocalizationManager();
