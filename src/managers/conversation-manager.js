/**
 * Audio Conversation Detection Manager
 * Gestisce la rilevazione delle conversazioni utilizzando Core Audio su macOS
 */

class ConversationManager {
    constructor() {
        this.isMonitoring = false;
        this.currentActivity = null;
        this.monitoringInterval = null;
        this.callbacks = new Set();

        // Bind methods
        this.startMonitoring = this.startMonitoring.bind(this);
        this.stopMonitoring = this.stopMonitoring.bind(this);
        this.getStatus = this.getStatus.bind(this);
        this.onStatusChange = this.onStatusChange.bind(this);
    }

    /**
     * Inizia il monitoraggio delle conversazioni
     */
    async startMonitoring() {
        try {
            console.log('🎤 Starting conversation detection...');

            // Avvia la rilevazione audio nel backend
            await window.__TAURI__.core.invoke('start_conversation_detection');

            this.isMonitoring = true;

            // Avvia il polling per ottenere lo status
            this.monitoringInterval = setInterval(async () => {
                try {
                    const newActivity = await window.__TAURI__.core.invoke('get_conversation_status');

                    // Controlla se lo status è cambiato
                    if (this.hasActivityChanged(newActivity)) {
                        this.currentActivity = newActivity;
                        this.notifyCallbacks(newActivity);
                    }
                } catch (error) {
                    console.error('Error getting conversation status:', error);
                }
            }, 1000); // Aggiorna ogni secondo

            console.log('✅ Conversation detection started');
            return true;

        } catch (error) {
            console.error('Failed to start conversation detection:', error);
            this.isMonitoring = false;
            throw error;
        }
    }

    /**
     * Ferma il monitoraggio delle conversazioni
     */
    async stopMonitoring() {
        try {
            console.log('🔇 Stopping conversation detection...');

            // Ferma il polling
            if (this.monitoringInterval) {
                clearInterval(this.monitoringInterval);
                this.monitoringInterval = null;
            }

            // Ferma la rilevazione audio nel backend
            await window.__TAURI__.core.invoke('stop_conversation_detection');

            this.isMonitoring = false;
            this.currentActivity = null;

            console.log('✅ Conversation detection stopped');
            return true;

        } catch (error) {
            console.error('Failed to stop conversation detection:', error);
            throw error;
        }
    }

    /**
     * Ottiene lo status corrente della conversazione
     */
    async getStatus() {
        try {
            return await window.__TAURI__.core.invoke('get_conversation_status');
        } catch (error) {
            console.error('Failed to get conversation status:', error);
            return null;
        }
    }

    /**
     * Verifica se l'utente è attualmente in una conversazione
     */
    async isInConversation() {
        try {
            return await window.__TAURI__.core.invoke('is_in_conversation');
        } catch (error) {
            console.error('Failed to check conversation status:', error);
            return false;
        }
    }

    /**
     * Ottiene il livello di confidenza della rilevazione
     */
    async getConfidence() {
        try {
            return await window.__TAURI__.core.invoke('get_conversation_confidence');
        } catch (error) {
            console.error('Failed to get conversation confidence:', error);
            return 0.0;
        }
    }

    /**
     * Testa la rilevazione audio
     */
    async testAudioDetection() {
        try {
            return await window.__TAURI__.core.invoke('test_audio_detection');
        } catch (error) {
            console.error('Failed to test audio detection:', error);
            throw error;
        }
    }

    /**
     * Registra un callback per essere notificato dei cambiamenti di status
     */
    onStatusChange(callback) {
        this.callbacks.add(callback);

        // Ritorna una funzione per rimuovere il callback
        return () => {
            this.callbacks.delete(callback);
        };
    }

    /**
     * Controlla se l'attività audio è cambiata significativamente
     */
    hasActivityChanged(newActivity) {
        if (!this.currentActivity) return true;

        return (
            this.currentActivity.is_microphone_active !== newActivity.is_microphone_active ||
            this.currentActivity.is_speakers_active !== newActivity.is_speakers_active ||
            Math.abs(this.currentActivity.confidence - newActivity.confidence) > 0.1
        );
    }

    /**
     * Notifica tutti i callback registrati
     */
    notifyCallbacks(activity) {
        this.callbacks.forEach(callback => {
            try {
                callback(activity);
            } catch (error) {
                console.error('Error in conversation status callback:', error);
            }
        });
    }

    /**
     * Ottiene informazioni sullo stato del monitoraggio
     */
    getMonitoringInfo() {
        return {
            isMonitoring: this.isMonitoring,
            currentActivity: this.currentActivity,
            callbackCount: this.callbacks.size
        };
    }

    /**
     * Formatta l'attività audio per la visualizzazione
     */
    formatActivity(activity) {
        if (!activity) return 'No data available';

        const parts = [];

        if (activity.is_microphone_active) {
            parts.push(`🎤 Mic: ${(activity.input_level * 100).toFixed(1)}%`);
        }

        if (activity.is_speakers_active) {
            parts.push(`🔊 Speakers: ${(activity.output_level * 100).toFixed(1)}%`);
        }

        parts.push(`📊 Confidence: ${(activity.confidence * 100).toFixed(1)}%`);

        return parts.join(' | ');
    }

    /**
     * Cleanup quando il manager viene distrutto
     */
    destroy() {
        if (this.isMonitoring) {
            this.stopMonitoring();
        }
        this.callbacks.clear();
    }
}

// Crea un'istanza globale
window.conversationManager = window.conversationManager || new ConversationManager();

// Export per uso come modulo
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConversationManager;
}

console.log('📱 Conversation Manager loaded');

// Test function per debug
window.testAudioIntegration = async function () {
    console.log('🧪 Testing audio integration...');

    if (!window.conversationManager) {
        console.error('❌ Conversation manager not available');
        return;
    }

    try {
        console.log('🎤 Testing conversation manager...');
        const info = window.conversationManager.getMonitoringInfo();
        console.log('📊 Monitoring info:', info);

        console.log('🔧 Testing audio detection test function...');
        const testResult = await window.conversationManager.testAudioDetection();
        console.log('✅ Test result:', testResult);

        console.log('📱 Audio integration test completed successfully!');
        return true;
    } catch (error) {
        console.error('❌ Audio integration test failed:', error);
        return false;
    }
};

console.log('🔧 Audio integration test available: window.testAudioIntegration()');
