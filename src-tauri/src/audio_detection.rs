use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioActivity {
    pub is_microphone_active: bool,
    pub is_speakers_active: bool,
    pub input_level: f32,
    pub output_level: f32,
    pub confidence: f32,
}

pub struct ConversationDetector {
    last_activity: Arc<Mutex<Instant>>,
    audio_levels: Arc<Mutex<AudioActivity>>,
    is_monitoring: Arc<Mutex<bool>>,
}

impl ConversationDetector {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        Ok(ConversationDetector {
            last_activity: Arc::new(Mutex::new(Instant::now())),
            audio_levels: Arc::new(Mutex::new(AudioActivity {
                is_microphone_active: false,
                is_speakers_active: false,
                input_level: 0.0,
                output_level: 0.0,
                confidence: 0.0,
            })),
            is_monitoring: Arc::new(Mutex::new(false)),
        })
    }

    pub fn start_monitoring(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let mut is_monitoring = self.is_monitoring.lock().unwrap();
        if *is_monitoring {
            return Ok(());
        }

        #[cfg(target_os = "macos")]
        {
            println!("🎤 Audio monitoring started on macOS (simulated)");
            // TODO: Implementare la vera rilevazione audio Core Audio
            // Per ora simuliamo l'attività
            self.simulate_audio_activity();
        }

        #[cfg(not(target_os = "macos"))]
        {
            println!("⚠️ Audio monitoring is only supported on macOS");
        }

        *is_monitoring = true;
        Ok(())
    }

    pub fn stop_monitoring(&mut self) {
        let mut is_monitoring = self.is_monitoring.lock().unwrap();
        if !*is_monitoring {
            return;
        }

        *is_monitoring = false;
        println!("🔇 Audio monitoring stopped");
    }

    pub fn get_current_activity(&self) -> AudioActivity {
        let activity = self.audio_levels.lock().unwrap();
        let last_activity = *self.last_activity.lock().unwrap();
        let elapsed = last_activity.elapsed();

        if elapsed > Duration::from_secs(5) {
            // Reset activity dopo 5 secondi di inattività
            AudioActivity {
                is_microphone_active: false,
                is_speakers_active: false,
                input_level: 0.0,
                output_level: 0.0,
                confidence: 0.0,
            }
        } else {
            activity.clone()
        }
    }

    pub fn is_in_conversation(&self) -> bool {
        let activity = self.get_current_activity();
        // Considera una conversazione quando sia microfono che speakers sono attivi
        activity.is_microphone_active && activity.is_speakers_active && activity.confidence > 0.5
    }

    pub fn get_conversation_confidence(&self) -> f32 {
        self.get_current_activity().confidence
    }

    // Simula attività audio per testing
    fn simulate_audio_activity(&self) {
        use std::thread;

        let audio_levels = self.audio_levels.clone();
        let last_activity = self.last_activity.clone();
        let is_monitoring = self.is_monitoring.clone();

        thread::spawn(move || {
            let mut counter = 0;

            while *is_monitoring.lock().unwrap() {
                thread::sleep(Duration::from_millis(1000));

                // Simula pattern di attività audio
                let mut activity = audio_levels.lock().unwrap();
                counter += 1;

                // Simula cicli di conversazione ogni 10 secondi
                let cycle_pos = counter % 20;

                if cycle_pos < 5 {
                    // Fase di conversazione attiva
                    activity.is_microphone_active = true;
                    activity.is_speakers_active = true;
                    activity.input_level = 0.3 + (cycle_pos as f32 * 0.1);
                    activity.output_level = 0.2 + (cycle_pos as f32 * 0.05);
                    activity.confidence = 0.7 + (cycle_pos as f32 * 0.05);
                } else if cycle_pos < 10 {
                    // Fase di solo ascolto
                    activity.is_microphone_active = false;
                    activity.is_speakers_active = true;
                    activity.input_level = 0.0;
                    activity.output_level = 0.4;
                    activity.confidence = 0.3;
                } else {
                    // Fase di silenzio
                    activity.is_microphone_active = false;
                    activity.is_speakers_active = false;
                    activity.input_level = 0.0;
                    activity.output_level = 0.0;
                    activity.confidence = 0.0;
                }

                *last_activity.lock().unwrap() = Instant::now();

                println!(
                    "🎵 Simulated audio activity: mic={}, speakers={}, confidence={:.1}",
                    activity.is_microphone_active, activity.is_speakers_active, activity.confidence
                );
            }

            println!("🔇 Audio simulation thread stopped");
        });
    }
}

impl Drop for ConversationDetector {
    fn drop(&mut self) {
        self.stop_monitoring();
    }
}

// Funzione di test
pub fn test_audio_detection() -> Result<AudioActivity, Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    {
        let mut detector = ConversationDetector::new()?;
        detector.start_monitoring()?;

        // Aspetta un po' per raccogliere dati simulati
        std::thread::sleep(Duration::from_millis(1500));

        let activity = detector.get_current_activity();
        detector.stop_monitoring();

        println!("🧪 Audio test completed: {:?}", activity);
        Ok(activity)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(AudioActivity {
            is_microphone_active: false,
            is_speakers_active: false,
            input_level: 0.0,
            output_level: 0.0,
            confidence: 0.0,
        })
    }
}
