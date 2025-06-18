/**
 * Update Manager per Tauri v2
 * 
 * Gestisce il controllo e l'installazione degli aggiornamenti dell'applicazione
 * seguendo rigorosamente la guida ufficiale di Tauri v2.
 * https://v2.tauri.app/plugin/updater/
 */

import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';

export class UpdateManagerV2 {
    constructor() {
        this.updateAvailable = false;
        this.currentUpdate = null;
        this.isChecking = false;
        this.isDownloading = false;
        this.downloadProgress = 0;
        this.autoCheck = true;
        this.checkInterval = null;

        // Eventi personalizzati
        this.eventTarget = new EventTarget();

        // Inizializza il controllo automatico solo se non siamo in dev mode
        if (!this.isDevelopmentMode()) {
            this.startAutoCheck();
        }

        console.log('✅ UpdateManager v2 inizializzato per macOS');
    }

    /**
     * Verifica se siamo in modalità sviluppo
     */
    isDevelopmentMode() {
        // Permetti override per test degli aggiornamenti
        if (localStorage.getItem('presto_force_update_test') === 'true') {
            console.log('🧪 Modalità test aggiornamenti attiva - bypass controllo sviluppo');
            return false;
        }

        // Verifica se siamo in un ambiente Tauri
        if (!window.__TAURI__) {
            console.log('🔍 Non è un ambiente Tauri - modalità sviluppo');
            return true;
        }

        // Verifica se stiamo running da tauri dev (protocollo tauri: indica app compilata)
        if (window.location.protocol === 'tauri:') {
            console.log('🔍 Protocollo tauri: - app compilata');
            return false;
        }

        // Se stiamo usando localhost, siamo probabilmente in modalità dev
        if (window.location.hostname === 'localhost' ||
            window.location.href.includes('localhost') ||
            window.location.href.includes('127.0.0.1')) {
            console.log('🔍 Localhost rilevato - modalità sviluppo');
            return true;
        }

        // Default: se arriviamo qui probabilmente siamo in un'app compilata
        console.log('🔍 Ambiente sconosciuto - assumo app compilata');
        return false;
    }

    /**
     * Attiva la modalità test per gli aggiornamenti (solo per sviluppo)
     */
    enableTestMode() {
        localStorage.setItem('presto_force_update_test', 'true');
        console.warn('⚠️ MODALITÀ TEST AGGIORNAMENTI ATTIVATA - Solo per sviluppo!');
        console.log('🔄 Ricarica la pagina o riavvia l\'app per attivare la modalità test');

        if (!this.isDevelopmentMode() && this.autoCheck && !this.checkInterval) {
            this.startAutoCheck();
        }

        return 'Modalità test attivata! Usa checkForUpdates() per testare.';
    }

    /**
     * Disattiva la modalità test per gli aggiornamenti
     */
    disableTestMode() {
        localStorage.removeItem('presto_force_update_test');
        console.log('✅ Modalità test aggiornamenti disattivata');

        if (this.isDevelopmentMode()) {
            this.stopAutoCheck();
        }

        return 'Modalità test disattivata';
    }

    /**
     * Mostra un messaggio all'utente
     */
    async showMessage(content, options = {}) {
        try {
            const { message } = await import('@tauri-apps/plugin-dialog');
            return await message(content, options);
        } catch (error) {
            console.error('Errore mostrando messaggio:', error);
            alert(content);
        }
    }

    /**
     * Chiede conferma all'utente
     */
    async askUser(content, options = {}) {
        try {
            const { ask } = await import('@tauri-apps/plugin-dialog');
            return await ask(content, options);
        } catch (error) {
            console.error('Errore chiedendo conferma:', error);
            return confirm(content);
        }
    }

    /**
     * Mostra messaggio per modalità sviluppo
     */
    async showDevelopmentMessage() {
        await this.showMessage(
            'Controllo aggiornamenti non disponibile in modalità sviluppo.\n\nGli aggiornamenti funzioneranno solo nell\'applicazione compilata.',
            {
                title: 'Modalità Sviluppo',
                kind: 'info'
            }
        );
    }

    /**
     * Avvia il controllo automatico degli aggiornamenti
     */
    startAutoCheck() {
        if (this.autoCheck && !this.checkInterval && !this.isDevelopmentMode()) {
            // Controlla ogni ora
            this.checkInterval = setInterval(() => {
                this.checkForUpdates(false); // silent check
            }, 60 * 60 * 1000);

            // Controllo iniziale dopo 30 secondi
            setTimeout(() => {
                this.checkForUpdates(false);
            }, 30000);

            console.log('🔄 Controllo automatico aggiornamenti avviato');
        }
    }

    /**
     * Ferma il controllo automatico degli aggiornamenti
     */
    stopAutoCheck() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
            console.log('⏹️ Controllo automatico aggiornamenti fermato');
        }
    }

    /**
     * Controlla se sono disponibili aggiornamenti usando l'API ufficiale di Tauri v2
     * @param {boolean} showDialog - Se mostrare dialoghi all'utente
     * @returns {Promise<boolean>} - True se sono disponibili aggiornamenti
     */
    async checkForUpdates(showDialog = true) {
        if (this.isChecking) {
            console.log('⏳ Controllo aggiornamenti già in corso');
            return false;
        }

        this.isChecking = true;
        this.emit('checkStarted');

        try {
            console.log('🔄 Controllo aggiornamenti con API Tauri v2...');

            // Verifica ambiente
            const isDevMode = this.isDevelopmentMode();
            const hasTestMode = localStorage.getItem('presto_force_update_test') === 'true';

            if (isDevMode && !hasTestMode) {
                console.warn('⚠️ Controllo aggiornamenti non disponibile in modalità sviluppo');
                this.emit('updateNotAvailable');
                if (showDialog) {
                    await this.showDevelopmentMessage();
                }
                return false;
            }

            // Se in test mode, simula invece di usare l'API reale
            if (hasTestMode) {
                return await this.checkForUpdatesSimulated(showDialog);
            }

            // Usa l'API ufficiale di Tauri v2
            console.log('📞 Chiamata API: check()');
            const update = await check({
                // Opzioni per macOS (se necessarie)
                target: 'darwin-x86_64' // o 'darwin-aarch64' per Apple Silicon
            });

            console.log('📦 Risposta controllo aggiornamenti:', update);

            if (update?.available) {
                console.log('✅ Aggiornamento disponibile:', update.version);
                this.updateAvailable = true;
                this.currentUpdate = update;
                this.emit('updateAvailable', update);

                if (showDialog) {
                    await this.showUpdateDialog(update);
                }

                return true;
            } else {
                console.log('✅ Nessun aggiornamento disponibile');
                this.updateAvailable = false;
                this.currentUpdate = null;
                this.emit('updateNotAvailable');

                if (showDialog) {
                    await this.showMessage('Stai usando la versione più recente!', {
                        title: 'Nessun aggiornamento',
                        kind: 'info'
                    });
                }

                return false;
            }
        } catch (error) {
            console.error('❌ Errore durante il controllo aggiornamenti:', error);
            this.emit('checkError', error);

            let errorMessage = 'Errore durante il controllo degli aggiornamenti.';

            if (error?.message) {
                if (error.message.includes('network') || error.message.includes('request')) {
                    errorMessage = 'Errore di rete. Verifica la connessione Internet e riprova.';
                } else if (error.message.includes('permission')) {
                    errorMessage = 'Permessi insufficienti per controllare gli aggiornamenti.';
                } else if (error.message.includes('not available')) {
                    errorMessage = 'Sistema di aggiornamenti non disponibile in questa versione.';
                }
            }

            if (showDialog) {
                await this.showMessage(`${errorMessage}\n\nDettagli: ${error?.message || 'Errore sconosciuto'}`, {
                    title: 'Errore Aggiornamenti',
                    kind: 'error'
                });
            }

            return false;
        } finally {
            this.isChecking = false;
            this.emit('checkFinished');
        }
    }

    /**
     * Controlla aggiornamenti in modalità simulata (per test)
     */
    async checkForUpdatesSimulated(showDialog = true) {
        console.log('🧪 Controllo aggiornamenti simulato...');

        try {
            // Simula delay di rete
            await new Promise(resolve => setTimeout(resolve, 1000));

            const currentVersion = await this.getCurrentVersion();
            console.log('📋 Versione corrente:', currentVersion);

            // Simula controllo con versione fittizia più alta
            const simulatedNewVersion = this.incrementVersion(currentVersion);

            console.log(`✅ Simulazione: Aggiornamento disponibile! ${currentVersion} → ${simulatedNewVersion}`);

            const update = {
                available: true,
                version: simulatedNewVersion,
                date: new Date().toISOString(),
                body: `🧪 AGGIORNAMENTO SIMULATO\n\nQuesto è un aggiornamento di test da ${currentVersion} a ${simulatedNewVersion}.\n\nIn modalità produzione, qui verrebbero mostrate le note di rilascio reali.`,
                downloadAndInstall: this.simulateDownloadAndInstall.bind(this)
            };

            this.updateAvailable = true;
            this.currentUpdate = update;
            this.emit('updateAvailable', update);

            if (showDialog) {
                await this.showUpdateDialog(update);
            }

            return true;
        } catch (error) {
            console.error('❌ Errore simulazione:', error);
            throw error;
        }
    }

    /**
     * Incrementa una versione per simulazione
     */
    incrementVersion(version) {
        const parts = version.split('.').map(n => parseInt(n) || 0);
        parts[2]++; // Incrementa la patch version
        return parts.join('.');
    }

    /**
     * Mostra il dialogo di conferma aggiornamento
     */
    async showUpdateDialog(update) {
        const shouldUpdate = await this.askUser(
            `È disponibile una nuova versione (${update.version}).\n\n${update.body ? update.body.substring(0, 200) + '...' : ''}\n\nVuoi scaricare e installare l'aggiornamento ora?`,
            {
                title: 'Aggiornamento disponibile',
                kind: 'info'
            }
        );

        if (shouldUpdate) {
            await this.downloadAndInstall();
        }
    }

    /**
     * Scarica e installa l'aggiornamento usando l'API ufficiale di Tauri v2
     */
    async downloadAndInstall() {
        if (!this.currentUpdate || this.isDownloading) {
            return;
        }

        this.isDownloading = true;
        this.downloadProgress = 0;
        this.emit('downloadStarted');

        try {
            console.log('📥 Inizio download aggiornamento con API Tauri v2...');

            // Usa l'API ufficiale downloadAndInstall con callback di progresso
            await this.currentUpdate.downloadAndInstall((event) => {
                switch (event.event) {
                    case 'Started':
                        console.log('📥 Download iniziato');
                        this.emit('downloadProgress', {
                            progress: 0,
                            contentLength: event.data.contentLength
                        });
                        break;
                    case 'Progress':
                        this.downloadProgress = Math.round((event.data.chunkLength / event.data.contentLength) * 100);
                        console.log(`📊 Progresso download: ${this.downloadProgress}%`);
                        this.emit('downloadProgress', {
                            progress: this.downloadProgress,
                            chunkLength: event.data.chunkLength,
                            contentLength: event.data.contentLength
                        });
                        break;
                    case 'Finished':
                        console.log('✅ Download completato');
                        this.downloadProgress = 100;
                        this.emit('downloadFinished');
                        break;
                }
            });

            console.log('🔄 Aggiornamento installato, riavvio...');
            this.emit('installFinished');

            // Mostra messaggio di successo prima del riavvio
            await this.showMessage('Aggiornamento installato con successo!\n\nL\'applicazione verrà riavviata ora.', {
                title: 'Aggiornamento completato',
                kind: 'info'
            });

            // Riavvia l'applicazione usando l'API ufficiale
            await relaunch();

        } catch (error) {
            console.error('❌ Errore durante l\'installazione:', error);
            this.emit('downloadError', error);

            await this.showMessage(`Errore durante l'installazione dell'aggiornamento: ${error.message}`, {
                title: 'Errore',
                kind: 'error'
            });
        } finally {
            this.isDownloading = false;
        }
    }

    /**
     * Simula il download e installazione per test
     */
    async simulateDownloadAndInstall(progressCallback) {
        console.log('🧪 Simulazione download e installazione...');

        const totalSize = 5 * 1024 * 1024; // 5MB simulati
        let downloaded = 0;

        // Simula l'evento di inizio
        if (progressCallback) {
            progressCallback({
                event: 'Started',
                data: { contentLength: totalSize }
            });
        }

        // Simula il download con progresso
        const chunks = 20;
        const chunkSize = totalSize / chunks;

        for (let i = 0; i < chunks; i++) {
            await new Promise(resolve => setTimeout(resolve, 200));
            downloaded += chunkSize;

            if (progressCallback) {
                progressCallback({
                    event: 'Progress',
                    data: {
                        chunkLength: downloaded,
                        contentLength: totalSize
                    }
                });
            }
        }

        // Simula completamento
        if (progressCallback) {
            progressCallback({
                event: 'Finished',
                data: {}
            });
        }

        console.log('🧪 Simulazione download completato!');

        // Simula riavvio
        await this.showMessage('🧪 MODALITÀ TEST: In un\'app vera, ora verrebbe riavviata automaticamente.', {
            title: 'Simulazione Riavvio',
            kind: 'info'
        });
    }

    /**
     * Ottiene la versione corrente dell'applicazione usando l'API ufficiale
     */
    async getCurrentVersion() {
        try {
            // Usa l'API ufficiale di Tauri v2
            const version = await getVersion();
            console.log('📋 Versione corrente da API Tauri:', version);
            return version;
        } catch (error) {
            console.warn('❌ Errore recupero versione con API Tauri:', error);
            // Fallback alla versione hardcoded
            return '0.2.2';
        }
    }

    /**
     * Apre la pagina delle release su GitHub
     */
    async openReleasePage() {
        try {
            const { open } = await import('@tauri-apps/plugin-opener');
            await open('https://github.com/murdercode/presto/releases');
        } catch (error) {
            console.error('Errore aprendo pagina release:', error);
            window.open('https://github.com/murdercode/presto/releases', '_blank');
        }
    }

    /**
     * Ottiene lo stato corrente degli aggiornamenti
     */
    getStatus() {
        return {
            updateAvailable: this.updateAvailable,
            currentUpdate: this.currentUpdate,
            isChecking: this.isChecking,
            isDownloading: this.isDownloading,
            downloadProgress: this.downloadProgress,
            autoCheck: this.autoCheck,
            developmentMode: this.isDevelopmentMode(),
            version: 'v2' // Indica che stiamo usando il manager v2
        };
    }

    /**
     * Attiva/disattiva il controllo automatico
     */
    setAutoCheck(enabled) {
        this.autoCheck = enabled;
        if (enabled) {
            this.startAutoCheck();
        } else {
            this.stopAutoCheck();
        }

        try {
            localStorage.setItem('presto_auto_check_updates', enabled.toString());
        } catch (error) {
            console.warn('Non riesco a salvare la preferenza auto-check:', error);
        }
    }

    /**
     * Carica le preferenze dell'utente
     */
    loadPreferences() {
        try {
            const autoCheck = localStorage.getItem('presto_auto_check_updates');
            if (autoCheck !== null) {
                this.setAutoCheck(autoCheck === 'true');
            }
        } catch (error) {
            console.warn('Non riesco a caricare le preferenze:', error);
        }
    }

    /**
     * Registra un listener per gli eventi
     */
    on(event, callback) {
        this.eventTarget.addEventListener(event, callback);
    }

    /**
     * Rimuove un listener per gli eventi
     */
    off(event, callback) {
        this.eventTarget.removeEventListener(event, callback);
    }

    /**
     * Emette un evento personalizzato
     */
    emit(event, data = null) {
        this.eventTarget.dispatchEvent(new CustomEvent(event, { detail: data }));
    }

    /**
     * Cleanup delle risorse
     */
    destroy() {
        this.stopAutoCheck();
        this.eventTarget = null;
    }
}

// Esporta un'istanza singleton
export const updateManager = new UpdateManagerV2();

// Debug utilities per test
if (typeof window !== 'undefined') {
    window.updateManagerV2Debug = {
        enableTestMode: () => updateManager.enableTestMode(),
        disableTestMode: () => updateManager.disableTestMode(),
        checkForUpdates: () => updateManager.checkForUpdates(true),
        getStatus: () => {
            const status = updateManager.getStatus();
            console.table(status);
            return status;
        },
        getCurrentVersion: () => updateManager.getCurrentVersion(),
        openReleasePage: () => updateManager.openReleasePage(),
        testUpdate: async () => {
            console.log('🧪 Test completo aggiornamento...');
            updateManager.enableTestMode();
            return await updateManager.checkForUpdates(true);
        }
    };

    console.log('🔧 UpdateManager V2 Debug disponibile: window.updateManagerV2Debug');
    console.log('📋 Comandi disponibili:');
    console.log('  - window.updateManagerV2Debug.testUpdate()');
    console.log('  - window.updateManagerV2Debug.checkForUpdates()');
    console.log('  - window.updateManagerV2Debug.getStatus()');
}
