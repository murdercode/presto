/**
 * Update Manager per Tauri v2 - Versione Global (non-module)
 * 
 * Usa le API Tauri esposte tramite window.__TAURI__ e definisce
 * la classe UpdateManagerV2 come global per compatibilità massima.
 */

// Definisce la classe UpdateManagerV2 globalmente
window.UpdateManagerV2 = class UpdateManagerV2 {
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

        console.log('✅ UpdateManager v2 inizializzato (global)');
    }

    /**
     * Verifica se siamo in modalità sviluppo
     */
    isDevelopmentMode() {
        // Permetti override per test degli aggiornamenti
        if (localStorage.getItem('presto_force_update_test') === 'true') {
            console.log('🧪 Modalità test aggiornamenti attiva');
            return false;
        }

        // Verifica se siamo in un ambiente Tauri
        if (!window.__TAURI__) {
            console.log('🔍 Non è un ambiente Tauri - modalità sviluppo');
            return true;
        }

        // Verifica se stiamo running da tauri dev
        if (window.location.protocol === 'tauri:') {
            console.log('🔍 Protocollo tauri: - app compilata');
            return false;
        }

        // Se stiamo usando localhost, siamo in modalità dev
        if (window.location.hostname === 'localhost' ||
            window.location.href.includes('localhost') ||
            window.location.href.includes('127.0.0.1')) {
            console.log('🔍 Localhost rilevato - modalità sviluppo');
            return true;
        }

        console.log('🔍 Ambiente produzione rilevato');
        return false;
    }

    /**
     * Ottiene l'API updater di Tauri in modo sicuro
     */
    async getTauriUpdaterAPI() {
        if (!window.__TAURI__) {
            throw new Error('Ambiente Tauri non disponibile');
        }

        // Prova diverse modalità di accesso all'API updater
        if (window.__TAURI__.updater) {
            console.log('✅ Usando API updater globale');
            return window.__TAURI__.updater;
        }

        if (window.__TAURI__.core && window.__TAURI__.core.invoke) {
            console.log('✅ Usando API updater via invoke');
            return {
                check: () => window.__TAURI__.core.invoke('plugin:updater|check'),
                downloadAndInstall: (onProgress) => {
                    console.warn('⚠️ downloadAndInstall non supportato via invoke');
                    throw new Error('Download automatico non disponibile');
                }
            };
        }

        // Se non disponibile, usiamo fetch diretto
        console.log('ℹ️ API updater non disponibile, usando approccio manuale');
        return null;
    }

    /**
     * Ottiene l'API app per la versione
     */
    async getAppVersion() {
        try {
            if (window.__TAURI__?.app?.getVersion) {
                return await window.__TAURI__.app.getVersion();
            }

            if (window.__TAURI__?.core?.invoke) {
                return await window.__TAURI__.core.invoke('plugin:app|version');
            }

            throw new Error('API versione non disponibile');
        } catch (error) {
            console.warn('❌ Errore recupero versione:', error);
            return '0.2.2'; // fallback
        }
    }

    /**
     * Riavvia l'applicazione
     */
    async restartApp() {
        try {
            if (window.__TAURI__?.process?.relaunch) {
                await window.__TAURI__.process.relaunch();
                return;
            }

            if (window.__TAURI__?.core?.invoke) {
                await window.__TAURI__.core.invoke('plugin:process|restart');
                return;
            }

            throw new Error('API riavvio non disponibile');
        } catch (error) {
            console.error('❌ Errore riavvio:', error);
            await this.showMessage(
                'L\'aggiornamento è stato installato ma il riavvio automatico non è disponibile.\n\nRiavvia manualmente l\'applicazione.',
                { title: 'Riavvio Manuale', kind: 'warning' }
            );
        }
    }

    /**
     * Attiva la modalità test per gli aggiornamenti
     */
    enableTestMode() {
        localStorage.setItem('presto_force_update_test', 'true');
        console.warn('⚠️ MODALITÀ TEST AGGIORNAMENTI ATTIVATA');

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
        console.log('ℹ️ Modalità test aggiornamenti disattivata');

        if (this.isDevelopmentMode()) {
            this.stopAutoCheck();
        }

        return 'Modalità test disattivata!';
    }

    /**
     * Mostra messaggio usando le API Tauri disponibili
     */
    async showMessage(content, options = {}) {
        const defaultOptions = {
            title: 'Presto',
            kind: 'info'
        };
        const opts = { ...defaultOptions, ...options };

        try {
            if (window.__TAURI__?.dialog?.message) {
                await window.__TAURI__.dialog.message(content, opts);
                return;
            }

            if (window.__TAURI__?.core?.invoke) {
                await window.__TAURI__.core.invoke('plugin:dialog|message', {
                    message: content,
                    title: opts.title,
                    kind: opts.kind
                });
                return;
            }

            // Fallback al browser alert
            alert(`${opts.title}\n\n${content}`);
        } catch (error) {
            console.error('Errore mostrando messaggio:', error);
            alert(`${opts.title}\n\n${content}`);
        }
    }

    /**
     * Chiede conferma usando le API Tauri disponibili
     */
    async askConfirmation(content, options = {}) {
        const defaultOptions = {
            title: 'Conferma',
            okLabel: 'Sì',
            cancelLabel: 'No'
        };
        const opts = { ...defaultOptions, ...options };

        try {
            if (window.__TAURI__?.dialog?.ask) {
                return await window.__TAURI__.dialog.ask(content, opts);
            }

            if (window.__TAURI__?.core?.invoke) {
                return await window.__TAURI__.core.invoke('plugin:dialog|ask', {
                    message: content,
                    ...options
                });
            }

            // Fallback al browser confirm
            return confirm(content);
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
            console.log('⏹️ Controllo automatico fermato');
        }
    }

    /**
     * Confronta due versioni
     */
    compareVersions(a, b) {
        const cleanA = a.replace(/^v/, '');
        const cleanB = b.replace(/^v/, '');

        const aParts = cleanA.split('.').map(n => parseInt(n) || 0);
        const bParts = cleanB.split('.').map(n => parseInt(n) || 0);

        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
            const aPart = aParts[i] || 0;
            const bPart = bParts[i] || 0;

            if (aPart > bPart) return 1;
            if (aPart < bPart) return -1;
        }

        return 0;
    }

    /**
     * Controlla se sono disponibili aggiornamenti usando approccio ibrido sicuro
     */
    async checkForUpdates(showDialog = true) {
        if (this.isChecking) {
            console.log('⏳ Controllo già in corso');
            return false;
        }

        this.isChecking = true;
        this.emit('checkStarted');

        try {
            console.log('🔄 Controllo aggiornamenti...');

            // Verifica ambiente
            const isDevMode = this.isDevelopmentMode();
            const hasTestMode = localStorage.getItem('presto_force_update_test') === 'true';

            if (isDevMode && !hasTestMode) {
                console.warn('⚠️ Modalità sviluppo - controllo disabilitato');
                this.emit('updateNotAvailable');
                if (showDialog) {
                    await this.showDevelopmentMessage();
                }
                return false;
            }

            // Se è modalità test, simula un aggiornamento
            if (hasTestMode) {
                console.log('🧪 Modalità test - simulazione aggiornamento');
                const testUpdate = await this.simulateUpdate();
                return testUpdate;
            }

            // Controlla aggiornamenti reali
            // 1. Prima prova con l'API GitHub per avere info complete
            const currentVersion = await this.getAppVersion();
            console.log(`📋 Versione corrente: ${currentVersion}`);

            // Controlla GitHub API
            const response = await fetch('https://api.github.com/repos/StefanoNovelli/presto/releases/latest');
            if (!response.ok) {
                throw new Error(`GitHub API error: ${response.status}`);
            }

            const githubRelease = await response.json();
            const latestVersion = githubRelease.tag_name.replace(/^v/, '');

            console.log(`📋 Ultima versione GitHub: ${latestVersion}`);

            // Confronta versioni
            if (this.compareVersions(latestVersion, currentVersion) <= 0) {
                console.log('✅ Nessun aggiornamento disponibile');
                this.updateAvailable = false;
                this.currentUpdate = null;
                this.emit('updateNotAvailable');
                return false;
            }

            console.log('🎉 Aggiornamento disponibile!');

            // 2. Prova a usare l'API Tauri updater se disponibile
            try {
                const tauriAPI = await this.getTauriUpdaterAPI();
                if (tauriAPI) {
                    console.log('🔄 Usando API Tauri updater...');
                    const tauriUpdate = await tauriAPI.check();

                    if (tauriUpdate && tauriUpdate.available) {
                        console.log('✅ Aggiornamento confermato via Tauri API');
                        this.updateAvailable = true;
                        this.currentUpdate = {
                            ...tauriUpdate,
                            isAutoDownloadable: true,
                            source: 'tauri-api'
                        };
                        this.emit('updateAvailable', tauriUpdate);
                        return true;
                    }
                }
            } catch (error) {
                console.warn('⚠️ API Tauri updater non disponibile:', error.message);
            }

            // 3. Fallback: informazioni da GitHub con download manuale
            console.log('📦 Usando informazioni GitHub con download manuale');
            const manualUpdate = {
                version: latestVersion,
                date: githubRelease.published_at,
                body: githubRelease.body || 'Nessuna descrizione disponibile',
                downloadUrl: githubRelease.html_url,
                isAutoDownloadable: false,
                source: 'github-manual'
            };

            this.updateAvailable = true;
            this.currentUpdate = manualUpdate;
            this.emit('updateAvailable', manualUpdate);
            return true;

        } catch (error) {
            console.error('❌ Errore controllo aggiornamenti:', error);
            this.updateAvailable = false;
            this.currentUpdate = null;
            this.emit('checkError', error);

            if (showDialog) {
                await this.showMessage(
                    'Errore durante il controllo degli aggiornamenti.\n\nRiprova più tardi.',
                    { title: 'Errore', kind: 'error' }
                );
            }
            return false;
        } finally {
            this.isChecking = false;
            this.emit('checkFinished');
        }
    }

    /**
     * Simula un aggiornamento per test
     */
    async simulateUpdate() {
        console.log('🧪 Simulazione aggiornamento per test...');

        const currentVersion = await this.getAppVersion();
        const simulatedNewVersion = this.incrementVersion(currentVersion);

        const update = {
            version: simulatedNewVersion,
            date: new Date().toISOString(),
            body: `🧪 **Aggiornamento Simulato per Test**\n\nVersione: ${simulatedNewVersion}\n\n**Novità simulate:**\n- Miglioramenti delle prestazioni\n- Correzioni di bug\n- Nuove funzionalità\n\n*Questo è un aggiornamento di test. Non verranno effettuati download reali.*`,
            downloadUrl: 'https://github.com/StefanoNovelli/presto/releases',
            isAutoDownloadable: true, // Per testare anche il download automatico
            source: 'test-simulation'
        };

        this.updateAvailable = true;
        this.currentUpdate = update;
        this.emit('updateAvailable', update);
        return true;
    }

    /**
     * Incrementa la versione per simulazione
     */
    incrementVersion(version) {
        const parts = version.replace(/^v/, '').split('.').map(n => parseInt(n) || 0);
        parts[2] = (parts[2] || 0) + 1; // incrementa patch version
        return parts.join('.');
    }

    /**
     * Apre l'URL di download usando le API Tauri disponibili
     */
    async openDownloadUrl(url) {
        try {
            if (window.__TAURI__?.shell?.open) {
                await window.__TAURI__.shell.open(url);
                return;
            }

            if (window.__TAURI__?.core?.invoke) {
                await window.__TAURI__.core.invoke('plugin:shell|open', { url });
                return;
            }

            // Fallback
            window.open(url, '_blank');
        } catch (error) {
            console.error('Errore apertura URL:', error);
            window.open(url, '_blank');
        }
    }

    /**
     * Scarica e installa l'aggiornamento
     */
    async downloadAndInstall() {
        if (!this.updateAvailable || !this.currentUpdate) {
            throw new Error('Nessun aggiornamento disponibile');
        }

        // Se è un test, simula il download
        if (this.currentUpdate.source === 'test-simulation') {
            console.log('🧪 Simulazione download e installazione...');
            return await this.simulateDownloadAndInstall();
        }

        this.isDownloading = true;
        this.downloadProgress = 0;
        this.emit('downloadStarted');

        try {
            // Se supporta download automatico via Tauri
            if (this.currentUpdate.isAutoDownloadable && this.currentUpdate.source === 'tauri-api') {
                console.log('📥 Download automatico via Tauri...');

                const tauriAPI = await this.getTauriUpdaterAPI();
                if (tauriAPI && tauriAPI.downloadAndInstall) {
                    await tauriAPI.downloadAndInstall((progress) => {
                        console.log(`📥 Progresso download: ${progress}%`);
                        this.downloadProgress = progress;
                        this.emit('downloadProgress', {
                            progress,
                            chunkLength: progress,
                            contentLength: 100
                        });
                    });

                    this.downloadProgress = 100;
                    this.emit('downloadProgress', {
                        progress: 100,
                        chunkLength: 100,
                        contentLength: 100
                    });

                    this.emit('downloadFinished');

                    // Installa e riavvia
                    this.emit('installFinished');

                    const shouldRestart = await this.askConfirmation(
                        'Aggiornamento scaricato e installato con successo!\n\nVuoi riavviare ora l\'applicazione?',
                        { title: 'Aggiornamento Completato' }
                    );

                    if (shouldRestart) {
                        await this.restartApp();
                    }
                }
            } else {
                // Download manuale
                console.log('🌐 Reindirizzamento a download manuale...');
                await this.openDownloadUrl(this.currentUpdate.downloadUrl);

                this.emit('downloadError', new Error('Download manuale richiesto'));
            }

        } catch (error) {
            console.error('❌ Errore download:', error);
            this.emit('downloadError', error);
            throw error;
        } finally {
            this.isDownloading = false;
        }
    }

    /**
     * Simula download e installazione per test
     */
    async simulateDownloadAndInstall() {
        console.log('🧪 Simulazione download...');

        // Simula progresso download
        for (let i = 0; i <= 100; i += 10) {
            await new Promise(resolve => setTimeout(resolve, 100));
            this.downloadProgress = i;
            this.emit('downloadProgress', {
                progress: i,
                chunkLength: i,
                contentLength: 100
            });
        }

        this.emit('downloadFinished');
        console.log('🧪 Download simulato completato');

        // Simula installazione
        await new Promise(resolve => setTimeout(resolve, 500));
        this.emit('installFinished');
        console.log('🧪 Installazione simulata completata');

        await this.showMessage(
            '🧪 **Test Completato**\n\nL\'aggiornamento è stato simulato con successo!\n\nIn un ambiente reale, l\'applicazione si riavvierebbe ora.',
            { title: 'Test Aggiornamento', kind: 'info' }
        );
    }

    /**
     * Ottiene la versione corrente dell'app
     */
    async getCurrentVersion() {
        return await this.getAppVersion();
    }

    /**
     * Imposta il controllo automatico
     */
    setAutoCheck(enabled) {
        this.autoCheck = enabled;

        if (enabled) {
            this.startAutoCheck();
        } else {
            this.stopAutoCheck();
        }

        // Salva preferenza
        try {
            localStorage.setItem('presto_auto_check_updates', enabled.toString());
        } catch (error) {
            console.warn('Errore salvando preferenza auto-check:', error);
        }
    }

    /**
     * Carica le preferenze salvate
     */
    loadPreferences() {
        try {
            const autoCheck = localStorage.getItem('presto_auto_check_updates');
            if (autoCheck !== null) {
                this.setAutoCheck(autoCheck === 'true');
            }
        } catch (error) {
            console.warn('Errore caricamento preferenze:', error);
        }
    }

    // Event management
    on(event, callback) {
        this.eventTarget.addEventListener(event, callback);
    }

    off(event, callback) {
        this.eventTarget.removeEventListener(event, callback);
    }

    emit(event, data = null) {
        this.eventTarget.dispatchEvent(new CustomEvent(event, { detail: data }));
    }

    destroy() {
        this.stopAutoCheck();
        this.eventTarget = null;
    }
};

// Debug utilities disponibili globalmente
if (typeof window !== 'undefined') {
    window.updateManagerV2Debug = {
        enableTestMode: () => {
            localStorage.setItem('presto_force_update_test', 'true');
            console.warn('⚠️ MODALITÀ TEST AGGIORNAMENTI ATTIVATA');
            return 'Modalità test attivata! Usa window.updateManager.checkForUpdates() per testare.';
        },
        disableTestMode: () => {
            localStorage.removeItem('presto_force_update_test');
            console.log('ℹ️ Modalità test aggiornamenti disattivata');
            return 'Modalità test disattivata!';
        },
        testUpdate: () => {
            if (window.updateManager) {
                return window.updateManager.simulateUpdate();
            } else {
                console.error('UpdateManager non inizializzato');
                return Promise.reject('UpdateManager non trovato');
            }
        },
        checkRealUpdate: () => {
            if (window.updateManager) {
                return window.updateManager.checkForUpdates();
            } else {
                console.error('UpdateManager non inizializzato');
                return Promise.reject('UpdateManager non trovato');
            }
        },
        getStatus: () => {
            if (window.updateManager) {
                return {
                    updateAvailable: window.updateManager.updateAvailable,
                    currentUpdate: window.updateManager.currentUpdate,
                    isChecking: window.updateManager.isChecking,
                    isDownloading: window.updateManager.isDownloading,
                    autoCheck: window.updateManager.autoCheck,
                    isDevelopmentMode: window.updateManager.isDevelopmentMode()
                };
            } else {
                return { error: 'UpdateManager non inizializzato' };
            }
        },
        checkEnvironment: () => {
            const env = {
                hasTauri: !!window.__TAURI__,
                hasUpdater: !!window.__TAURI__?.updater,
                hasCore: !!window.__TAURI__?.core,
                hasApp: !!window.__TAURI__?.app,
                hasDialog: !!window.__TAURI__?.dialog,
                hasShell: !!window.__TAURI__?.shell,
                protocol: window.location.protocol,
                hostname: window.location.hostname
            };
            console.table(env);
            return env;
        }
    };

    console.log('🔧 UpdateManager V2 GLOBAL Debug disponibile: window.updateManagerV2Debug');
    console.log('📋 Comandi disponibili:');
    console.log('  - window.updateManagerV2Debug.testUpdate() // test simulato');
    console.log('  - window.updateManagerV2Debug.checkRealUpdate() // test reale');
    console.log('  - window.updateManagerV2Debug.getStatus()');
    console.log('  - window.updateManagerV2Debug.checkEnvironment() // verifica API Tauri');
}
