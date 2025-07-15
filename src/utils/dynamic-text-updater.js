import { localizationManager } from './localization.js';
import * as m from '../paraglide/messages.js';

/**
 * Dynamic Text Updater
 * Updates text content when timer state changes or new content is added
 */
export class DynamicTextUpdater {
    constructor(localizationManager) {
        this.localizationManager = localizationManager;
        this.observers = new Map();
        this.setupMutationObserver();
    }

    /**
     * Setup mutation observer to detect DOM changes
     */
    setupMutationObserver() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    // Check if new elements were added that need localization
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.localizeNewElement(node);
                        }
                    });
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Localize newly added elements
     * @param {Element} element - The newly added element
     */
    localizeNewElement(element) {
        // Check for elements with data-i18n attributes
        const elementsToLocalize = element.querySelectorAll('[data-i18n]');
        elementsToLocalize.forEach(el => {
            const key = el.getAttribute('data-i18n');
            const messageFunction = this.getMessageFunction(key);
            if (messageFunction) {
                el.textContent = messageFunction();
            }
        });

        // Check for specific dynamic elements
        if (element.classList.contains('session-item')) {
            this.localizeSessionItem(element);
        }
        
        if (element.classList.contains('tag-item')) {
            this.localizeTagItem(element);
        }
    }

    /**
     * Get message function by key
     * @param {string} key - The message key (e.g., 'timer.focus')
     * @returns {Function|null} The message function or null
     */
    getMessageFunction(key) {
        const parts = key.split('.');
        let current = this.localizationManager.messages;
        
        for (const part of parts) {
            if (current && current[part]) {
                current = current[part];
            } else {
                return null;
            }
        }
        
        return typeof current === 'function' ? current : null;
    }

    /**
     * Localize session item
     * @param {Element} element - Session item element
     */
    localizeSessionItem(element) {
        // Update session-specific text content
        const deleteBtn = element.querySelector('.delete-session-btn');
        if (deleteBtn) {
            deleteBtn.textContent = m['common.delete']();
        }
    }

    /**
     * Localize tag item
     * @param {Element} element - Tag item element
     */
    localizeTagItem(element) {
        // Update tag-specific text content if needed
        // This would be implemented based on your tag item structure
    }

    /**
     * Update timer status text based on current state
     * @param {string} status - Timer status ('focus', 'break', 'longBreak')
     */
    updateTimerStatus(status) {
        const statusElement = document.getElementById('status-text');
        if (statusElement) {
            switch (status) {
                case 'focus':
                    statusElement.textContent = m['timer.focus']();
                    break;
                case 'break':
                    statusElement.textContent = 'Break'; // Add to messages
                    break;
                case 'longBreak':
                    statusElement.textContent = 'Long Break'; // Add to messages
                    break;
            }
        }
    }

    /**
     * Update progress indicators
     * @param {number} completed - Number of completed sessions
     * @param {number} total - Total sessions for the day
     */
    updateProgressIndicators(completed, total) {
        // Update any progress text that needs localization
        const progressElements = document.querySelectorAll('.progress-text');
        progressElements.forEach(el => {
            // Update with localized progress text
            el.textContent = `${completed}/${total} sessions`; // Add to messages
        });
    }
}

// Export for use in other modules
export const dynamicTextUpdater = new DynamicTextUpdater(localizationManager);
