// Auto Theme Loader
// This utility automatically discovers and loads all theme CSS files from the themes folder

class ThemeLoader {
    constructor() {
        this.loadedThemes = new Set();
        this.themeStyles = new Map();
    }

    /**
     * Automatically discover and load all theme CSS files
     */
    async loadAllThemes() {
        try {
            // Get all CSS files from the themes directory
            const themeFiles = await this.discoverThemeFiles();

            console.log(`🎨 Discovered ${themeFiles.length} theme files:`, themeFiles);

            // Load each theme file
            for (const themeFile of themeFiles) {
                await this.loadThemeFile(themeFile);
            }

            console.log(`🎨 Auto-loaded ${this.loadedThemes.size} themes successfully`);
            return Array.from(this.loadedThemes);
        } catch (error) {
            console.error('❌ Failed to auto-load themes:', error);
            return [];
        }
    }

    /**
     * Discover all CSS files in the themes directory
     */
    async discoverThemeFiles() {
        // In a browser environment, we need to use a different approach
        // Since we can't directly read the filesystem, we'll use a predefined list
        // that gets updated by the build process or manually maintained

        // This could be enhanced to use a build-time script that generates this list
                                                                                                                                                                                                                                const knownThemes = [
            'espresso.css',
            'pipboy.css',
            'pommodore64.css'
        ];

        return knownThemes;
    }

    /**
     * Load a specific theme CSS file
     */
    async loadThemeFile(filename) {
        const themeId = filename.replace('.css', '');

        if (this.loadedThemes.has(themeId)) {
            console.log(`🎨 Theme ${themeId} already loaded, skipping`);
            return;
        }

        try {
            // Since CSS is already imported statically in main.css, 
            // we just need to register the theme in our loaded themes
            console.log(`✅ Theme registered: ${themeId}`);
            this.loadedThemes.add(themeId);

            // Extract theme metadata from CSS file
            await this.extractThemeMetadata(themeId);

        } catch (error) {
            console.error(`❌ Error registering theme ${themeId}:`, error);
        }
    }

    /**
     * Extract theme metadata from CSS comments
     */
    async extractThemeMetadata(themeId) {
        try {
            // Fetch the CSS file to read metadata from comments
            const response = await fetch(`./src/styles/themes/${themeId}.css`);
            const cssContent = await response.text();

            // Parse metadata from CSS comments
            const metadata = this.parseThemeMetadata(cssContent);

            if (metadata) {
                // Add to TIMER_THEMES dynamically
                const { TIMER_THEMES } = await import('./timer-themes.js');

                if (!TIMER_THEMES[themeId]) {
                    TIMER_THEMES[themeId] = {
                        name: metadata.name || this.capitalizeFirst(themeId),
                        description: metadata.description || `Auto-discovered theme: ${themeId}`,
                        supports: metadata.supports || ['light', 'dark'],
                        isDefault: false,
                        preview: metadata.preview || {
                            focus: '#e74c3c',
                            break: '#2ecc71',
                            longBreak: '#3498db'
                        }
                    };

                    console.log(`📝 Auto-registered theme: ${themeId}`, TIMER_THEMES[themeId]);
                }
            }
        } catch (error) {
            console.warn(`⚠️ Could not extract metadata for theme ${themeId}:`, error);
        }
    }

    /**
     * Parse theme metadata from CSS comments
     */
    parseThemeMetadata(cssContent) {
        try {
            // Look for theme metadata in CSS comments
            const metadataRegex = /\/\*\s*Timer Theme:\s*(.+?)\s*\*\s*Author:\s*(.+?)\s*\*\s*Description:\s*(.+?)\s*\*\s*Supports:\s*(.+?)\s*\*\//s;
            const match = cssContent.match(metadataRegex);

            if (match) {
                const [, name, author, description, supports] = match;

                // Parse supports field
                const supportsModes = supports.toLowerCase().includes('light') && supports.toLowerCase().includes('dark')
                    ? ['light', 'dark']
                    : supports.toLowerCase().includes('dark')
                        ? ['dark']
                        : ['light'];

                // Try to extract color values for preview
                const preview = this.extractPreviewColors(cssContent);

                return {
                    name: name.trim(),
                    author: author.trim(),
                    description: description.trim(),
                    supports: supportsModes,
                    preview
                };
            }
        } catch (error) {
            console.warn('Could not parse theme metadata:', error);
        }

        return null;
    }

    /**
     * Extract preview colors from CSS variables
     */
    extractPreviewColors(cssContent) {
        const colors = {
            focus: '#e74c3c',
            break: '#2ecc71',
            longBreak: '#3498db'
        };

        try {
            // Extract --focus-color, --break-color, --long-break-color
            const focusMatch = cssContent.match(/--focus-color:\s*([^;]+);/);
            const breakMatch = cssContent.match(/--break-color:\s*([^;]+);/);
            const longBreakMatch = cssContent.match(/--long-break-color:\s*([^;]+);/);

            if (focusMatch) colors.focus = focusMatch[1].trim();
            if (breakMatch) colors.break = breakMatch[1].trim();
            if (longBreakMatch) colors.longBreak = longBreakMatch[1].trim();
        } catch (error) {
            console.warn('Could not extract preview colors:', error);
        }

        return colors;
    }

    /**
     * Capitalize first letter of a string
     */
    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Remove a loaded theme
     */
    unloadTheme(themeId) {
        const linkElement = this.themeStyles.get(themeId);
        if (linkElement) {
            document.head.removeChild(linkElement);
            this.loadedThemes.delete(themeId);
            this.themeStyles.delete(themeId);
            console.log(`🗑️ Unloaded theme: ${themeId}`);
        }
    }

    /**
     * Get list of loaded themes
     */
    getLoadedThemes() {
        return Array.from(this.loadedThemes);
    }

    /**
     * Check if a theme is loaded
     */
    isThemeLoaded(themeId) {
        return this.loadedThemes.has(themeId);
    }
}

// Create and export a singleton instance
export const themeLoader = new ThemeLoader();

// Auto-load themes when this module is imported
export async function initializeAutoThemeLoader() {
    console.log('🎨 Initializing auto theme loader...');
    const loadedThemes = await themeLoader.loadAllThemes();
    return loadedThemes;
}

export default themeLoader;
