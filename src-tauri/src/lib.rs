use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, LazyLock, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use base64::{Engine as _, engine::general_purpose};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
#[cfg(not(target_os = "ios"))]
use tauri_plugin_aptabase::EventTracker;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tauri_plugin_oauth::start;

// Type alias for the app handle to avoid generic complexity
type AppHandle = tauri::AppHandle<tauri::Wry>;

// Global activity monitoring state
static ACTIVITY_MONITOR: Mutex<Option<ActivityMonitor>> = Mutex::new(None);

// Global shortcut debounce state
static SHORTCUT_DEBOUNCE: LazyLock<Mutex<HashMap<String, Instant>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

struct ActivityMonitor {
    last_activity: Arc<Mutex<Instant>>,
    is_monitoring: Arc<Mutex<bool>>,
    app_handle: AppHandle,
    inactivity_threshold: Arc<Mutex<Duration>>,
}

#[derive(Serialize, Deserialize, Clone)]
struct PomodoroSession {
    completed_pomodoros: u32,
    total_focus_time: u32, // in seconds
    current_session: u32,
    date: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct ManualSession {
    id: String,
    session_type: String, // "focus", "break", "longBreak", "custom"
    duration: u32,        // in minutes
    start_time: String,   // "HH:MM"
    end_time: String,     // "HH:MM"
    notes: Option<String>,
    created_at: String,   // ISO string
    date: String,         // Date string for the session date
    tags: Option<Vec<serde_json::Value>>, // Array of tag objects
}

#[derive(Serialize, Deserialize, Clone)]
struct Tag {
    id: String,
    name: String,
    icon: String,  // emoji or remix icon class
    color: String, // hex color code
    created_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct SessionTag {
    session_id: String,
    tag_id: String,
    duration: u32, // time spent on this tag in seconds
    created_at: String,
}

#[derive(Serialize, Deserialize)]
struct Task {
    id: u64,
    text: String,
    completed: bool,
    created_at: String,
    completed_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct AppSettings {
    shortcuts: ShortcutSettings,
    timer: TimerSettings,
    notifications: NotificationSettings,
    #[serde(default)]
    advanced: AdvancedSettings,
    autostart: bool,
    #[serde(default = "default_analytics_enabled")]
    analytics_enabled: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct ShortcutSettings {
    start_stop: Option<String>,
    reset: Option<String>,
    skip: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct TimerSettings {
    focus_duration: u32,
    break_duration: u32,
    long_break_duration: u32,
    total_sessions: u32,
    #[serde(default = "default_weekly_goal")]
    weekly_goal_minutes: u32,
}

fn default_weekly_goal() -> u32 {
    125
}

fn default_analytics_enabled() -> bool {
    true // Analytics enabled by default
}

// Helper function to check if analytics are enabled
async fn are_analytics_enabled(app: &AppHandle) -> bool {
    match load_settings(app.clone()).await {
        Ok(settings) => settings.analytics_enabled,
        Err(_) => true, // Default to enabled if we can't load settings
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct NotificationSettings {
    desktop_notifications: bool,
    sound_notifications: bool,
    auto_start_timer: bool,
    #[serde(default)]
    auto_start_focus: bool,
    #[serde(default)]
    allow_continuous_sessions: bool,
    smart_pause: bool,
    smart_pause_timeout: u32, // timeout in seconds
}

#[derive(Serialize, Deserialize, Clone)]
struct AdvancedSettings {
    #[serde(default)]
    debug_mode: bool, // Debug mode with 3-second timers
}

impl Default for AdvancedSettings {
    fn default() -> Self {
        Self { debug_mode: false }
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            shortcuts: ShortcutSettings {
                start_stop: Some("CommandOrControl+Alt+Space".to_string()),
                reset: Some("CommandOrControl+Alt+R".to_string()),
                skip: Some("CommandOrControl+Alt+S".to_string()),
            },
            timer: TimerSettings {
                focus_duration: 25,
                break_duration: 5,
                long_break_duration: 20,
                total_sessions: 10,
                weekly_goal_minutes: 125,
            },
            notifications: NotificationSettings {
                desktop_notifications: true,
                sound_notifications: true,
                auto_start_timer: true,
                auto_start_focus: false,          // default to disabled
                allow_continuous_sessions: false, // default to disabled
                smart_pause: false,
                smart_pause_timeout: 30, // default 30 seconds
            },
            advanced: AdvancedSettings::default(),
            autostart: false,        // default to disabled
            analytics_enabled: true, // default to enabled
        }
    }
}

// Helper function to check if a shortcut should be debounced
fn should_debounce_shortcut(action: &str) -> bool {
    let debounce_duration = Duration::from_millis(500); // 500ms debounce
    let mut debounce_map = SHORTCUT_DEBOUNCE.lock().unwrap();

    let now = Instant::now();
    if let Some(last_time) = debounce_map.get(action) {
        if now.duration_since(*last_time) < debounce_duration {
            return true; // Should debounce
        }
    }

    debounce_map.insert(action.to_string(), now);
    false // Should not debounce
}

impl ActivityMonitor {
    fn new(app_handle: AppHandle, timeout_seconds: u64) -> Self {
        Self {
            last_activity: Arc::new(Mutex::new(Instant::now())),
            is_monitoring: Arc::new(Mutex::new(false)),
            app_handle,
            inactivity_threshold: Arc::new(Mutex::new(Duration::from_secs(timeout_seconds))),
        }
    }

    #[cfg(target_os = "macos")]
    fn start_monitoring(&self) -> Result<(), String> {
        let mut is_monitoring = self.is_monitoring.lock().unwrap();
        if *is_monitoring {
            return Ok(()); // Already monitoring
        }
        *is_monitoring = true;

        let last_activity = Arc::clone(&self.last_activity);
        let is_monitoring_clone = Arc::clone(&self.is_monitoring);
        let inactivity_threshold = Arc::clone(&self.inactivity_threshold);
        let app_handle = self.app_handle.clone();

        thread::spawn(move || {
            loop {
                // Check if we should stop monitoring
                {
                    let monitoring = is_monitoring_clone.lock().unwrap();
                    if !*monitoring {
                        break;
                    }
                }

                // Get current threshold
                let threshold = {
                    let threshold_guard = inactivity_threshold.lock().unwrap();
                    *threshold_guard
                };

                // Check system activity
                let has_activity = Self::check_system_activity();

                if has_activity {
                    // Update last activity time
                    {
                        let mut last = last_activity.lock().unwrap();
                        *last = Instant::now();
                    }

                    // Emit activity event to frontend
                    let _ = app_handle.emit("user-activity", ());
                } else {
                    // Check if enough time has passed since last activity
                    let elapsed = {
                        let last = last_activity.lock().unwrap();
                        last.elapsed()
                    };

                    if elapsed >= threshold {
                        // Emit inactivity event to frontend
                        let _ = app_handle.emit("user-inactivity", ());

                        // Reset the timer to avoid spam
                        {
                            let mut last = last_activity.lock().unwrap();
                            *last = Instant::now();
                        }
                    }
                }

                thread::sleep(Duration::from_millis(500)); // Check every 500ms
            }
        });

        Ok(())
    }

    #[cfg(target_os = "macos")]
    fn check_system_activity() -> bool {
        // Check if system has been idle for less than 1 second
        Self::get_system_idle_time() < 1.0
    }

    #[cfg(target_os = "macos")]
    fn get_system_idle_time() -> f64 {
        use std::process::Command;

        // Use ioreg to get HID idle time - most reliable method on macOS
        let output = Command::new("ioreg").args(&["-c", "IOHIDSystem"]).output();

        if let Ok(output) = output {
            let output_str = String::from_utf8_lossy(&output.stdout);

            // Look for HIDIdleTime in the output
            for line in output_str.lines() {
                if line.contains("HIDIdleTime") {
                    // Line format: "HIDIdleTime" = 1234567890
                    if let Some(equals_pos) = line.find('=') {
                        let value_part = &line[equals_pos + 1..];
                        // Clean up the value (remove whitespace and potential trailing chars)
                        let cleaned = value_part
                            .trim()
                            .trim_end_matches(|c: char| !c.is_ascii_digit());

                        if let Ok(idle_ns) = cleaned.parse::<u64>() {
                            // Convert nanoseconds to seconds
                            return idle_ns as f64 / 1_000_000_000.0;
                        }
                    }
                }
            }
        }

        // If ioreg fails, assume no idle time (active)
        0.0
    }

    fn stop_monitoring(&self) {
        let mut is_monitoring = self.is_monitoring.lock().unwrap();
        *is_monitoring = false;
    }

    fn update_threshold(&self, timeout_seconds: u64) {
        let mut threshold = self.inactivity_threshold.lock().unwrap();
        *threshold = Duration::from_secs(timeout_seconds);
    }
}

#[tauri::command]
async fn start_activity_monitoring(app: AppHandle, timeout_seconds: u64) -> Result<(), String> {
    let mut monitor = ACTIVITY_MONITOR.lock().unwrap();

    if monitor.is_none() {
        *monitor = Some(ActivityMonitor::new(app, timeout_seconds));
    }

    if let Some(ref monitor) = *monitor {
        #[cfg(target_os = "macos")]
        {
            monitor.start_monitoring()?;
        }

        #[cfg(not(target_os = "macos"))]
        {
            return Err("Activity monitoring is only supported on macOS".to_string());
        }
    }

    Ok(())
}

#[tauri::command]
async fn stop_activity_monitoring() -> Result<(), String> {
    let monitor = ACTIVITY_MONITOR.lock().unwrap();

    if let Some(ref monitor) = *monitor {
        monitor.stop_monitoring();
    }

    Ok(())
}

#[tauri::command]
async fn update_activity_timeout(timeout_seconds: u64) -> Result<(), String> {
    let monitor = ACTIVITY_MONITOR.lock().unwrap();

    if let Some(ref monitor) = *monitor {
        monitor.update_threshold(timeout_seconds);
        Ok(())
    } else {
        Err("Activity monitor not initialized".to_string())
    }
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn save_session_data(session: PomodoroSession, app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    // Create the directory if it doesn't exist
    fs::create_dir_all(&app_data_dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    let file_path = app_data_dir.join("session.json");
    let json = serde_json::to_string_pretty(&session)
        .map_err(|e| format!("Failed to serialize session: {}", e))?;

    fs::write(file_path, json).map_err(|e| format!("Failed to write session file: {}", e))?;

    // Track session saved analytics (if enabled)
    if are_analytics_enabled(&app).await {
        let properties = Some(serde_json::json!({
            "completed_pomodoros": session.completed_pomodoros,
            "total_focus_time": session.total_focus_time,
            "current_session": session.current_session
        }));
        #[cfg(not(target_os = "ios"))]
        {
            let _ = app.track_event("session_saved", properties);
        }
    }

    Ok(())
}

#[tauri::command]
async fn load_session_data(app: AppHandle) -> Result<Option<PomodoroSession>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let file_path = app_data_dir.join("session.json");

    if !file_path.exists() {
        return Ok(None);
    }

    let content =
        fs::read_to_string(&file_path).map_err(|e| format!("Failed to read session file: {}", e))?;
    let mut session: PomodoroSession =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse session: {}", e))?;

    // Get today's date string
    let today = chrono::Local::now().format("%a %b %d %Y").to_string();
    
    // If the saved session is not from today, reset the counters but keep the date updated
    if session.date != today {
        session.completed_pomodoros = 0;
        session.total_focus_time = 0;
        session.current_session = 1;
        session.date = today;
        
        // Save the reset session back to file
        let json = serde_json::to_string_pretty(&session)
            .map_err(|e| format!("Failed to serialize reset session: {}", e))?;
        fs::write(file_path, json).map_err(|e| format!("Failed to write reset session file: {}", e))?;
    }

    Ok(Some(session))
}

#[tauri::command]
async fn save_tasks(tasks: Vec<Task>, app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    // Create the directory if it doesn't exist
    fs::create_dir_all(&app_data_dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    let file_path = app_data_dir.join("tasks.json");
    let json = serde_json::to_string_pretty(&tasks)
        .map_err(|e| format!("Failed to serialize tasks: {}", e))?;

    fs::write(file_path, json).map_err(|e| format!("Failed to write tasks file: {}", e))?;

    // Track tasks saved analytics (if enabled)
    if are_analytics_enabled(&app).await {
        #[cfg(not(target_os = "ios"))]
        {
            let _ = app.track_event("tasks_saved", None);
        }
    }

    Ok(())
}

#[tauri::command]
async fn load_tasks(app: AppHandle) -> Result<Vec<Task>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let file_path = app_data_dir.join("tasks.json");

    if !file_path.exists() {
        return Ok(Vec::new());
    }

    let content =
        fs::read_to_string(file_path).map_err(|e| format!("Failed to read tasks file: {}", e))?;
    let tasks: Vec<Task> =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse tasks: {}", e))?;

    Ok(tasks)
}

#[tauri::command]
async fn get_stats_history(app: AppHandle) -> Result<Vec<PomodoroSession>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let history_path = app_data_dir.join("history.json");

    if !history_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(history_path)
        .map_err(|e| format!("Failed to read history file: {}", e))?;
    let history: Vec<PomodoroSession> =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse history: {}", e))?;

    Ok(history)
}

#[tauri::command]
async fn save_daily_stats(session: PomodoroSession, app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    // Create the directory if it doesn't exist
    fs::create_dir_all(&app_data_dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    let history_path = app_data_dir.join("history.json");

    let mut history: Vec<PomodoroSession> = if history_path.exists() {
        let content = fs::read_to_string(&history_path)
            .map_err(|e| format!("Failed to read history: {}", e))?;
        serde_json::from_str(&content).unwrap_or_else(|_| Vec::new())
    } else {
        Vec::new()
    };

    // Remove existing entry for the same date and add the new one
    history.retain(|s| s.date != session.date);
    history.push(session);

    // Keep only last 30 days
    history.sort_by(|a, b| a.date.cmp(&b.date));
    if history.len() > 30 {
        let start_index = history.len() - 30;
        history.drain(0..start_index);
    }

    let json = serde_json::to_string_pretty(&history)
        .map_err(|e| format!("Failed to serialize history: {}", e))?;
    fs::write(history_path, json).map_err(|e| format!("Failed to write history file: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn update_tray_icon(
    app: AppHandle,
    timer_text: String,
    is_running: bool,
    session_mode: String,
    current_session: u32,
    total_sessions: u32,
    mode_icon: Option<String>,
) -> Result<(), String> {
    use std::sync::{Arc, Mutex};

    // Use Arc<Mutex<Result<(), String>>> to capture the result from the main thread
    let result = Arc::new(Mutex::new(Ok(())));
    let result_clone = Arc::clone(&result);

    // Clone the app handle to move into the closure
    let app_clone = app.clone();

    // Move the operation to the main thread using Tauri's app handle
    // This ensures macOS tray operations run on the main thread
    app.run_on_main_thread(move || {
        let mut result_guard = result_clone.lock().unwrap();
        *result_guard = (|| -> Result<(), String> {
            if let Some(tray) = app_clone.tray_by_id("main") {
                // Use the provided mode_icon or fallback to default icons
                let icon = mode_icon.unwrap_or_else(|| match session_mode.as_str() {
                    "focus" => "🧠".to_string(),
                    "break" => "☕".to_string(),
                    "longBreak" => "🌙".to_string(),
                    _ => "⏱️".to_string(),
                });

                let status = if is_running { "Running" } else { "Paused" };
                let title = format!("{} {}", icon, timer_text);
                tray.set_title(Some(title))
                    .map_err(|e| format!("Failed to set title: {}", e))?;

                let tooltip = if session_mode == "focus" {
                    format!(
                        "Presto - Session {}/{} ({})",
                        current_session, total_sessions, status
                    )
                } else {
                    format!(
                        "Presto - {} ({})",
                        if session_mode == "longBreak" {
                            "Long Break"
                        } else {
                            "Short Break"
                        },
                        status
                    )
                };

                tray.set_tooltip(Some(tooltip))
                    .map_err(|e| format!("Failed to set tooltip: {}", e))?;
            }
            Ok(())
        })();
    })
    .map_err(|e| format!("Failed to run on main thread: {}", e))?;

    // Extract the result from the mutex
    let final_result = result.lock().unwrap().clone();
    final_result
}

#[tauri::command]
async fn show_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .show()
            .map_err(|e| format!("Failed to show window: {}", e))?;
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus window: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn save_settings(settings: AppSettings, app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    fs::create_dir_all(&app_data_dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    let file_path = app_data_dir.join("settings.json");
    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(file_path, json).map_err(|e| format!("Failed to write settings file: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let file_path = app_data_dir.join("settings.json");

    if !file_path.exists() {
        return Ok(AppSettings::default());
    }

    let contents = fs::read_to_string(file_path)
        .map_err(|e| format!("Failed to read settings file: {}", e))?;
    let settings: AppSettings =
        serde_json::from_str(&contents).map_err(|e| format!("Failed to parse settings: {}", e))?;

    Ok(settings)
}

#[tauri::command]
async fn register_global_shortcuts(
    app: AppHandle,
    shortcuts: ShortcutSettings,
) -> Result<(), String> {
    // Unregister all existing shortcuts first
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("Failed to unregister shortcuts: {}", e))?;

    // Register start/stop shortcut
    if let Some(ref shortcut_str) = shortcuts.start_stop {
        let shortcut: Shortcut = shortcut_str
            .parse()
            .map_err(|e| format!("Invalid start/stop shortcut '{}': {}", shortcut_str, e))?;

        let app_handle = app.clone();
        app.global_shortcut()
            .on_shortcut(shortcut, move |_app, _shortcut, _event| {
                if !should_debounce_shortcut("start-stop") {
                    let _ = app_handle.emit("global-shortcut", "start-stop");
                }
            })
            .map_err(|e| format!("Failed to register start/stop shortcut: {}", e))?;
    }

    // Register reset shortcut
    if let Some(ref shortcut_str) = shortcuts.reset {
        let shortcut: Shortcut = shortcut_str
            .parse()
            .map_err(|e| format!("Invalid reset shortcut '{}': {}", shortcut_str, e))?;

        let app_handle = app.clone();
        app.global_shortcut()
            .on_shortcut(shortcut, move |_app, _shortcut, _event| {
                if !should_debounce_shortcut("reset") {
                    let _ = app_handle.emit("global-shortcut", "reset");
                }
            })
            .map_err(|e| format!("Failed to register reset shortcut: {}", e))?;
    }

    // Register skip shortcut
    if let Some(ref shortcut_str) = shortcuts.skip {
        let shortcut: Shortcut = shortcut_str
            .parse()
            .map_err(|e| format!("Invalid skip shortcut '{}': {}", shortcut_str, e))?;

        let app_handle = app.clone();
        app.global_shortcut()
            .on_shortcut(shortcut, move |_app, _shortcut, _event| {
                if !should_debounce_shortcut("skip") {
                    let _ = app_handle.emit("global-shortcut", "skip");
                }
            })
            .map_err(|e| format!("Failed to register skip shortcut: {}", e))?;
    }

    // Emit an event to the frontend to update local shortcuts as well
    app.emit("shortcuts-updated", &shortcuts)
        .map_err(|e| format!("Failed to emit shortcuts update: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn unregister_global_shortcuts(app: AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("Failed to unregister shortcuts: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn reset_all_data(app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let files_to_delete = vec![
        "session.json",
        "tasks.json",
        "history.json",
        "settings.json",
        "manual_sessions.json",
    ];

    for file_name in files_to_delete {
        let file_path = app_data_dir.join(file_name);
        if file_path.exists() {
            fs::remove_file(file_path)
                .map_err(|e| format!("Failed to delete {}: {}", file_name, e))?;
        }
    }

    /*
    if app_data_dir.exists() {
        let _ = fs::remove_dir(&app_data_dir);
    }
    */

    Ok(())
}

#[tauri::command]
async fn enable_autostart(app: AppHandle) -> Result<(), String> {
    let autostart_manager = app.autolaunch();
    autostart_manager
        .enable()
        .map_err(|e| format!("Failed to enable autostart: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn disable_autostart(app: AppHandle) -> Result<(), String> {
    let autostart_manager = app.autolaunch();
    autostart_manager
        .disable()
        .map_err(|e| format!("Failed to disable autostart: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn is_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    let autostart_manager = app.autolaunch();
    autostart_manager
        .is_enabled()
        .map_err(|e| format!("Failed to check autostart status: {}", e))
}

#[tauri::command]
async fn save_manual_sessions(sessions: Vec<ManualSession>, app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    // Create the directory if it doesn't exist
    fs::create_dir_all(&app_data_dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    let file_path = app_data_dir.join("manual_sessions.json");
    let json = serde_json::to_string_pretty(&sessions)
        .map_err(|e| format!("Failed to serialize manual sessions: {}", e))?;

    fs::write(file_path, json).map_err(|e| format!("Failed to write manual sessions file: {}", e))?;

    // Track manual sessions saved analytics (if enabled)
    if are_analytics_enabled(&app).await {
        let properties = Some(serde_json::json!({
            "session_count": sessions.len()
        }));
        #[cfg(not(target_os = "ios"))]
        {
            let _ = app.track_event("manual_sessions_saved", properties);
        }
    }

    Ok(())
}

#[tauri::command]
async fn load_manual_sessions(app: AppHandle) -> Result<Vec<ManualSession>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let file_path = app_data_dir.join("manual_sessions.json");

    if !file_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(file_path)
        .map_err(|e| format!("Failed to read manual sessions file: {}", e))?;
    let sessions: Vec<ManualSession> =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse manual sessions: {}", e))?;

    Ok(sessions)
}

#[tauri::command]
async fn save_manual_session(session: ManualSession, app: AppHandle) -> Result<(), String> {
    // Load existing sessions
    let mut sessions = load_manual_sessions(app.clone()).await?;
    
    // Remove existing session with same ID if it exists (for updates)
    sessions.retain(|s| s.id != session.id);
    
    // Add the new/updated session
    sessions.push(session);
    
    // Save all sessions back
    save_manual_sessions(sessions, app).await
}

#[tauri::command]
async fn delete_manual_session(session_id: String, app: AppHandle) -> Result<(), String> {
    // Load existing sessions
    let mut sessions = load_manual_sessions(app.clone()).await?;
    
    // Remove the session with the specified ID
    sessions.retain(|s| s.id != session_id);
    
    // Save the updated sessions back
    save_manual_sessions(sessions, app).await
}

#[tauri::command]
async fn get_manual_sessions_for_date(date: String, app: AppHandle) -> Result<Vec<ManualSession>, String> {
    let sessions = load_manual_sessions(app).await?;
    
    // Filter sessions for the specified date
    let filtered_sessions: Vec<ManualSession> = sessions
        .into_iter()
        .filter(|s| s.date == date)
        .collect();
    
    Ok(filtered_sessions)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::async_runtime::block_on(async {
        let mut builder = tauri::Builder::default()
            .plugin(tauri_plugin_opener::init())
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_notification::init())
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_oauth::init());

        #[cfg(not(target_os = "ios"))]
        {
            builder = builder.plugin(tauri_plugin_aptabase::Builder::new("A-EU-9457123106").build());
        }

        builder
            .invoke_handler(tauri::generate_handler![
                greet,
                save_session_data,
                load_session_data,
                save_tasks,
                load_tasks,
                get_stats_history,
                save_daily_stats,
                update_tray_icon,
                update_tray_menu,
                show_window,
                save_settings,
                load_settings,
                register_global_shortcuts,
                unregister_global_shortcuts,
                reset_all_data,
                start_activity_monitoring,
                stop_activity_monitoring,
                update_activity_timeout,
                enable_autostart,
                disable_autostart,
                is_autostart_enabled,
                save_manual_sessions,
                load_manual_sessions,
                save_manual_session,
                delete_manual_session,
                get_manual_sessions_for_date,
                load_tags,
                save_tags,
                save_tag,
                delete_tag,
                load_session_tags,
                save_session_tags,
                add_session_tag,
                write_excel_file,
                start_oauth_server
            ])
            .setup(|app| {
                // Track app started event (if enabled)
                let app_handle_analytics = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if are_analytics_enabled(&app_handle_analytics).await {
                        #[cfg(not(target_os = "ios"))]
                        {
                            let _ = app_handle_analytics.track_event("app_started", None);
                        }
                    }
                });

                let show_item =
                    MenuItem::with_id(app, "show", "Mostra Presto", true, None::<&str>)?;
                let start_session_item = MenuItem::with_id(
                    app,
                    "start_session",
                    "Inizia sessione",
                    false,
                    None::<&str>,
                )?;
                let pause_item = MenuItem::with_id(app, "pause", "Pausa", false, None::<&str>)?;
                let skip_item =
                    MenuItem::with_id(app, "skip", "Salta sessione", false, None::<&str>)?;
                let cancel_item = MenuItem::with_id(app, "cancel", "Annulla", false, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "Esci", true, None::<&str>)?;
                let menu = Menu::with_items(
                    app,
                    &[
                        &show_item,
                        &start_session_item,
                        &pause_item,
                        &skip_item,
                        &cancel_item,
                        &quit_item,
                    ],
                )?;

                let app_handle = app.handle().clone();
                let app_handle_for_click = app_handle.clone();

                let _tray = TrayIconBuilder::with_id("main")
                    .menu(&menu)
                    .show_menu_on_left_click(true)
                    .on_menu_event(move |_tray, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                #[cfg(not(target_os = "ios"))]
                                {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                        "start_session" => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.emit("tray-start-session", ());
                                #[cfg(not(target_os = "ios"))]
                                {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                        "pause" => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.emit("tray-pause", ());
                                #[cfg(not(target_os = "ios"))]
                                {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                        "skip" => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.emit("tray-skip", ());
                                #[cfg(not(target_os = "ios"))]
                                {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                        "cancel" => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.emit("tray-cancel", ());
                                #[cfg(not(target_os = "ios"))]
                                {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                        "quit" => {
                            app_handle.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(move |_tray, event| {
                        if let TrayIconEvent::Click { .. } = event {
                            if let Some(window) = app_handle_for_click.get_webview_window("main") {
                                #[cfg(not(target_os = "ios"))]
                                {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    })
                    .build(app)?;

                if let Some(window) = app.get_webview_window("main") {
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                        }
                    });
                }

                // Load and register global shortcuts
                let app_handle_for_shortcuts = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    match load_settings(app_handle_for_shortcuts.clone()).await {
                        Ok(settings) => {
                            if let Err(e) = register_global_shortcuts(
                                app_handle_for_shortcuts,
                                settings.shortcuts,
                            )
                            .await
                            {
                                eprintln!("Failed to register global shortcuts on startup: {}", e);
                            }
                        }
                        Err(e) => {
                            eprintln!("Failed to load settings on startup: {}", e);
                            // Try to register default shortcuts
                            let default_settings = AppSettings::default();
                            if let Err(e) = register_global_shortcuts(
                                app_handle_for_shortcuts,
                                default_settings.shortcuts,
                            )
                            .await
                            {
                                eprintln!("Failed to register default global shortcuts: {}", e);
                            }
                        }
                    }
                });

                Ok(())
            })
            .build(tauri::generate_context!())
            .expect("error while running tauri application")
            .run(|app_handle, event| match event {
                tauri::RunEvent::Exit { .. } => {
                    // Always track app exit event regardless of analytics settings
                    // since this is the final event and useful for crash detection
                    #[cfg(not(target_os = "ios"))]
                    {
                        let _ = app_handle.track_event("app_exited", None);
                        app_handle.flush_events_blocking();
                    }
                }
                _ => {}
            });
    })
}

#[tauri::command]
async fn load_tags(app: AppHandle) -> Result<Vec<Tag>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let file_path = app_data_dir.join("tags.json");
    
    if file_path.exists() {
        let content = fs::read_to_string(&file_path)
            .map_err(|e| format!("Failed to read tags: {}", e))?;
        Ok(serde_json::from_str(&content).unwrap_or_else(|_| Vec::new()))
    } else {
        // Return default focus tag if no tags exist
        let default_tag = Tag {
            id: "default-focus".to_string(),
            name: "Focus".to_string(),
            icon: "ri-brain-line".to_string(),
            color: "#4CAF50".to_string(),
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
                .to_string(),
        };
        Ok(vec![default_tag])
    }
}

#[tauri::command]
async fn save_tags(tags: Vec<Tag>, app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    fs::create_dir_all(&app_data_dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    let file_path = app_data_dir.join("tags.json");
    let json = serde_json::to_string_pretty(&tags)
        .map_err(|e| format!("Failed to serialize tags: {}", e))?;
    fs::write(file_path, json).map_err(|e| format!("Failed to write tags file: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn save_tag(tag: Tag, app: AppHandle) -> Result<(), String> {
    let mut tags = load_tags(app.clone()).await?;
    
    // Remove existing tag with same ID if it exists (for updates)
    tags.retain(|t| t.id != tag.id);
    
    // Add the new/updated tag
    tags.push(tag);
    
    // Save all tags back
    save_tags(tags, app).await
}

#[tauri::command]
async fn delete_tag(tag_id: String, app: AppHandle) -> Result<(), String> {
    let mut tags = load_tags(app.clone()).await?;
    
    // Remove the tag with the specified ID
    tags.retain(|t| t.id != tag_id);
    
    // Save the updated tags back
    save_tags(tags, app).await
}

#[tauri::command]
async fn load_session_tags(app: AppHandle) -> Result<Vec<SessionTag>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let file_path = app_data_dir.join("session_tags.json");
    
    if file_path.exists() {
        let content = fs::read_to_string(&file_path)
            .map_err(|e| format!("Failed to read session tags: {}", e))?;
        Ok(serde_json::from_str(&content).unwrap_or_else(|_| Vec::new()))
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
async fn save_session_tags(session_tags: Vec<SessionTag>, app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    fs::create_dir_all(&app_data_dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    let file_path = app_data_dir.join("session_tags.json");
    let json = serde_json::to_string_pretty(&session_tags)
        .map_err(|e| format!("Failed to serialize session tags: {}", e))?;
    fs::write(file_path, json).map_err(|e| format!("Failed to write session tags file: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn add_session_tag(session_tag: SessionTag, app: AppHandle) -> Result<(), String> {
    let mut session_tags = load_session_tags(app.clone()).await?;
    session_tags.push(session_tag);
    save_session_tags(session_tags, app).await
}


#[tauri::command]
async fn update_tray_menu(
    app: AppHandle,
    is_running: bool,
    is_paused: bool,
    current_mode: String,
) -> Result<(), String> {
    let tray = app.tray_by_id("main");

    if let Some(tray) = tray {
        let show_item = MenuItem::with_id(&app, "show", "Mostra Presto", true, None::<&str>)
            .map_err(|e| format!("Failed to create show item: {}", e))?;

        // Inizia sessione: abilitato solo se non è in esecuzione
        let start_session_item = MenuItem::with_id(
            &app,
            "start_session",
            "Inizia sessione",
            !is_running,
            None::<&str>,
        )
        .map_err(|e| format!("Failed to create start session item: {}", e))?;

        // Pausa: abilitata solo se è in esecuzione e non in pausa
        let pause_item = MenuItem::with_id(
            &app,
            "pause",
            "Pausa",
            is_running && !is_paused,
            None::<&str>,
        )
        .map_err(|e| format!("Failed to create pause item: {}", e))?;

        // Skip: abilitato solo se è in esecuzione
        let skip_item = MenuItem::with_id(&app, "skip", "Salta sessione", is_running, None::<&str>)
            .map_err(|e| format!("Failed to create skip item: {}", e))?;

        // Annulla: abilitato se è in modalità focus, disabilitato in break/longBreak (undo)
        let cancel_text = if current_mode == "focus" {
            "Annulla"
        } else {
            "Annulla ultima"
        };
        let cancel_item = MenuItem::with_id(&app, "cancel", cancel_text, true, None::<&str>)
            .map_err(|e| format!("Failed to create cancel item: {}", e))?;

        let quit_item = MenuItem::with_id(&app, "quit", "Esci", true, None::<&str>)
            .map_err(|e| format!("Failed to create quit item: {}", e))?;

        let new_menu = Menu::with_items(
            &app,
            &[
                &show_item,
                &start_session_item,
                &pause_item,
                &skip_item,
                &cancel_item,
                &quit_item,
            ],
        )
        .map_err(|e| format!("Failed to create menu: {}", e))?;

        tray.set_menu(Some(new_menu))
            .map_err(|e| format!("Failed to set tray menu: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
async fn write_excel_file(path: String, data: String) -> Result<(), String> {
    // Decode base64 data
    let decoded_data = general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("Failed to decode base64 data: {}", e))?;
    
    // Write the binary data to file
    fs::write(&path, decoded_data)
        .map_err(|e| format!("Failed to write Excel file to {}: {}", path, e))?;
    
    Ok(())
}

#[tauri::command]
async fn start_oauth_server(window: tauri::Window) -> Result<u16, String> {
    start(move |url| {
        println!("OAuth callback received: {}", url);
        // Emit the URL to the frontend
        let _ = window.emit("oauth-callback", url);
    })
    .map_err(|err| err.to_string())
}
