use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, LazyLock, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
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
    created_at: String,                   // ISO string
    date: String,                         // Date string for the session date
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
        let _ = app.track_event("session_saved", properties);
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
        fs::read_to_string(file_path).map_err(|e| format!("Failed to read session file: {}", e))?;
    let session: PomodoroSession =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse session: {}", e))?;

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
        let _ = app.track_event("tasks_saved", None);
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

    fs::write(file_path, json)
        .map_err(|e| format!("Failed to write manual sessions file: {}", e))?;

    // Track manual sessions saved analytics (if enabled)
    if are_analytics_enabled(&app).await {
        let properties = Some(serde_json::json!({
            "session_count": sessions.len()
        }));
        let _ = app.track_event("manual_sessions_saved", properties);
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
    let sessions: Vec<ManualSession> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse manual sessions: {}", e))?;

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
async fn get_manual_sessions_for_date(
    date: String,
    app: AppHandle,
) -> Result<Vec<ManualSession>, String> {
    let sessions = load_manual_sessions(app).await?;

    // Filter sessions for the specified date
    let filtered_sessions: Vec<ManualSession> =
        sessions.into_iter().filter(|s| s.date == date).collect();

    Ok(filtered_sessions)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::async_runtime::block_on(async {
        tauri::Builder::default()
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
            .plugin(tauri_plugin_oauth::init())
            .plugin(tauri_plugin_aptabase::Builder::new("A-EU-9457123106").build())
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
                get_env_var,
                write_excel_file,
                start_oauth_server,
                get_platform,
                execute_shell_command,
                check_camera_microphone_usage,
                check_webrtc_connections,
                check_high_bandwidth_connections
            ])
            .setup(|app| {
                // Track app started event (if enabled)
                let app_handle_analytics = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if are_analytics_enabled(&app_handle_analytics).await {
                        let _ = app_handle_analytics.track_event("app_started", None);
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
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "start_session" => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.emit("tray-start-session", ());
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "pause" => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.emit("tray-pause", ());
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "skip" => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.emit("tray-skip", ());
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "cancel" => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.emit("tray-cancel", ());
                                let _ = window.show();
                                let _ = window.set_focus();
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
                                let _ = window.show();
                                let _ = window.set_focus();
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
                    let _ = app_handle.track_event("app_exited", None);
                    app_handle.flush_events_blocking();
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
        let content =
            fs::read_to_string(&file_path).map_err(|e| format!("Failed to read tags: {}", e))?;
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
async fn get_env_var(key: String) -> Result<String, String> {
    // First try to get from environment variables
    if let Ok(value) = std::env::var(&key) {
        return Ok(value);
    }

    // Try multiple possible locations for .env file
    let possible_paths = vec![
        std::env::current_dir().ok().map(|p| p.join(".env")),
        std::env::current_dir()
            .ok()
            .and_then(|p| p.parent().map(|parent| parent.join(".env"))),
        Some(std::path::PathBuf::from(
            "/Users/stefanonovelli/Sites/Personal/presto/.env",
        )),
    ];

    for path_opt in possible_paths {
        if let Some(env_path) = path_opt {
            println!("Checking .env path: {:?}", env_path);
            if env_path.exists() {
                println!("Found .env file at: {:?}", env_path);
                if let Ok(content) = std::fs::read_to_string(&env_path) {
                    for line in content.lines() {
                        let line = line.trim();
                        if line.starts_with(&format!("{}=", key)) {
                            if let Some(value) = line.split('=').nth(1) {
                                return Ok(value.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    Err(format!(
        "Environment variable '{}' not found in any location",
        key
    ))
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

#[tauri::command]
async fn get_platform() -> Result<String, String> {
    Ok(std::env::consts::OS.to_string())
}

#[tauri::command]
async fn execute_shell_command(command: String, args: Vec<String>) -> Result<String, String> {
    use std::process::Command;

    let output = Command::new(&command)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute command '{}': {}", command, e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        // Return stderr as error info but don't fail completely
        let stderr = String::from_utf8_lossy(&output.stderr);
        Ok(format!("Command failed with stderr: {}", stderr))
    }
}

#[tauri::command]
async fn check_camera_microphone_usage() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // Simple and effective: Check if camera or microphone are actively being used

        // Method 1: Check if ANY process is using the camera
        let camera_check = Command::new("lsof").args(&["/dev/video0"]).output();

        println!("DEBUG: Checking camera usage with lsof /dev/video0");
        if let Ok(camera_result) = camera_check {
            let camera_content = String::from_utf8_lossy(&camera_result.stdout);
            println!("DEBUG: Camera lsof result: '{}'", camera_content);
            println!(
                "DEBUG: Camera lsof line count: {}",
                camera_content.lines().count()
            );
            if !camera_content.trim().is_empty() && camera_content.lines().count() > 1 {
                println!("Camera in active use: {}", camera_content);
                return Ok(true);
            }
        } else {
            println!("DEBUG: Camera lsof command failed");
        }

        // Method 2: Check for active microphone usage via system profiler
        let mic_check = Command::new("system_profiler")
            .args(&["SPAudioDataType", "-json"])
            .output();

        println!("DEBUG: Checking audio with system_profiler");
        if let Ok(mic_result) = mic_check {
            let mic_content = String::from_utf8_lossy(&mic_result.stdout);
            println!(
                "DEBUG: Audio contains 'input': {}",
                mic_content.contains("\"input\"")
            );
            println!(
                "DEBUG: Audio contains 'Built-in': {}",
                mic_content.contains("Built-in")
            );

            // Look for active input in the audio data
            if mic_content.contains("\"input\"") && mic_content.contains("Built-in") {
                // Parse to see if there's actual activity
                println!("Audio input device detected as active");

                // Additional check: see if any meeting apps are running with moderate CPU
                let ps_check = Command::new("ps").args(&["aux"]).output();

                if let Ok(ps_result) = ps_check {
                    let ps_content = String::from_utf8_lossy(&ps_result.stdout);
                    let meeting_apps = [
                        "zoom", "Teams", 
                        // "Discord", 
                        "Skype", "Chrome", "Safari", "Firefox", "meet",
                    ];

                    println!("DEBUG: Checking CPU usage for meeting apps");
                    for line in ps_content.lines() {
                        for app in &meeting_apps {
                            if line.to_lowercase().contains(&app.to_lowercase()) {
                                let parts: Vec<&str> = line.split_whitespace().collect();
                                if parts.len() >= 3 {
                                    if let Ok(cpu_usage) = parts[2].parse::<f32>() {
                                        println!("DEBUG: {} using {}% CPU", app, cpu_usage);
                                        // Even moderate CPU usage (>5%) with active audio = likely in call
                                        if cpu_usage > 5.0 {
                                            println!(
                                                "Meeting app {} using {}% CPU with active audio",
                                                app, cpu_usage
                                            );
                                            return Ok(true);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else {
            println!("DEBUG: system_profiler command failed");
        }

        // Method 3: Check for recent AVCaptureSession activity (camera sessions)
        let capture_check = Command::new("log")
            .args(&[
                "show",
                "--predicate",
                "eventMessage contains 'AVCaptureSession'",
                "--style",
                "syslog",
                "--last",
                "10s",
            ])
            .output();

        println!("DEBUG: Checking AVCaptureSession logs");
        if let Ok(capture_result) = capture_check {
            let capture_content = String::from_utf8_lossy(&capture_result.stdout);
            let line_count = capture_content.lines().count();
            println!("DEBUG: AVCaptureSession log lines: {}", line_count);
            if line_count > 5 {
                // Multiple recent camera events
                println!("Multiple recent camera capture sessions detected");
                return Ok(true);
            }
        } else {
            println!("DEBUG: AVCaptureSession log command failed");
        }

        Ok(false)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Camera/microphone detection only supported on macOS".to_string())
    }
}

#[tauri::command]
async fn check_webrtc_connections() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        println!("DEBUG: Checking for WebRTC connections with DNS filtering...");

        // Known IP ranges for major meeting platforms (first two octets) - moved to top for global access
        let meeting_ip_ranges = [
            // Google (Meet, YouTube, etc.) - Enable specific ranges for Meet
            ("74.125.", "Google"),
            ("142.250.", "Google"),  
            ("172.217.", "Google"),
            ("108.177.", "Google"),
            ("216.58.", "Google"),
            
            // Microsoft (Teams)
            ("52.112.", "Microsoft"),
            ("52.114.", "Microsoft"),
            ("52.115.", "Microsoft"),
            ("13.107.", "Microsoft"),
            
            // Discord
            // ("162.159.", "Discord"),
            // ("104.16.", "Discord"),
            
            // Zoom  
            ("3.7.", "Zoom"),
            ("3.21.", "Zoom"),
            ("3.22.", "Zoom"),
            ("3.23.", "Zoom"),
            ("52.61.", "Zoom"),
            ("160.1.", "Zoom"),
        ];

        // Step 1: Check for active connections to known meeting domains
        let netstat_check = Command::new("netstat").args(&["-an"]).output();
        
        let mut has_meeting_domain_connections = false;
        let mut netstat_content = String::new(); // Declare here for broader scope
        
        if let Ok(netstat_result) = netstat_check {
            netstat_content = String::from_utf8_lossy(&netstat_result.stdout).to_string();
            
            // Check if any network connections are to meeting platform IP ranges
            for line in netstat_content.lines() {
                if line.contains("ESTABLISHED") || line.contains("UDP") {
                    for (ip_range, platform) in &meeting_ip_ranges {
                        if line.contains(ip_range) {
                            println!("DEBUG: Found connection to {} ({}.*): {}", platform, ip_range, line.trim());
                            has_meeting_domain_connections = true;
                        }
                    }
                }
            }
        }
        
        // Step 2: Only proceed with WebRTC check if we have meeting domain connections
        if !has_meeting_domain_connections {
            println!("DEBUG: No connections to known meeting domains found");
            return Ok(false);
        }
        
        println!("DEBUG: Meeting domain connections found, checking for WebRTC...");
        
        // If we have Google connections and a browser that might be running Meet, be more permissive
        let is_google_connection = netstat_content.lines().any(|line| {
            line.contains("216.58.") || line.contains("74.125.") || line.contains("142.250.") || line.contains("108.177.")
        });
        
        // Step 2.5: Check if there are browser processes running that might be using Google Meet
        let ps_check = Command::new("ps").args(&["aux"]).output();
        let mut has_potential_meet_browser = false;
        
        if let Ok(ps_result) = ps_check {
            let ps_content = String::from_utf8_lossy(&ps_result.stdout);
            
            // First, check for explicit meeting indicators
            for line in ps_content.lines() {
                if (line.to_lowercase().contains("chrome") || 
                    line.to_lowercase().contains("safari") || 
                    line.to_lowercase().contains("firefox")) &&
                   (line.to_lowercase().contains("meet") || 
                    line.to_lowercase().contains("googlemeet") ||
                    line.contains("--app=")) {
                    println!("DEBUG: Found explicit Google Meet browser process: {}", line.split_whitespace().collect::<Vec<_>>().get(10).unwrap_or(&"unknown"));
                    has_potential_meet_browser = true;
                    break;
                }
            }
            
            // If no explicit meeting process found, but we have Google connections,
            // check if any browser is running (they could be in a Meet tab)
            if !has_potential_meet_browser && is_google_connection {
                for line in ps_content.lines() {
                    if line.to_lowercase().contains("chrome") || 
                       line.to_lowercase().contains("safari") || 
                       line.to_lowercase().contains("firefox") {
                        println!("DEBUG: Found browser that could be running Meet: {}", 
                               line.split_whitespace().collect::<Vec<_>>().get(10).unwrap_or(&"unknown"));
                        has_potential_meet_browser = true;
                        break;
                    }
                }
            }
        }
        
        println!("DEBUG: Has Google connections: {}, Has potential Meet browser: {}", is_google_connection, has_potential_meet_browser);
        
        // Step 3: Check for WebRTC-specific connections
        let lsof_udp_check = Command::new("lsof").args(&["-i", "UDP"]).output();

        if let Ok(lsof_result) = lsof_udp_check {
            let lsof_content = String::from_utf8_lossy(&lsof_result.stdout);

            // Look for UDP connections that are NOT system services - much more restrictive
            let filtered_udp_connections = lsof_content
                .lines()
                .filter(|line| {
                    line.contains("UDP") && 
                    line.contains("->") && // Only outbound connections
                    !line.contains("*:*") && // Exclude listening sockets
                    
                    // Exclude system services (comprehensive list)
                    !line.contains("rapportd") &&
                    !line.contains("identitys") &&
                    !line.contains("mDNSResponder") &&
                    !line.contains("configd") &&
                    !line.contains("systemstats") &&
                    !line.contains("networkd") &&
                    !line.contains("kernel_task") &&
                    !line.contains("launchd") &&
                    !line.contains("UserEventAgent") &&
                    !line.contains("bluetoothd") &&
                    !line.contains("syslogd") &&
                    !line.contains("notifyd") &&
                    !line.contains("distnoted") &&
                    !line.contains("cfprefsd") &&
                    !line.contains("trustd") &&
                    !line.contains("installd") &&
                    !line.contains("nsurlsessiond") &&
                    !line.contains("cloudd") &&
                    !line.contains("bird") &&
                    !line.contains("sharingd") &&
                    !line.contains("akd") &&
                    !line.contains("secd") &&
                    !line.contains("opendirectoryd") &&
                    !line.contains("deleted") &&
                    
                    // Exclude Apple system services and frameworks
                    !line.contains("avconfere") &&      // AVConferenceFramework
                    !line.contains("AVConference") &&
                    !line.contains("controlcenter") &&
                    !line.contains("CommCenter") &&
                    !line.contains("callservicesd") &&
                    !line.contains("mediaremoted") &&
                    !line.contains("coreaudiod") &&
                    !line.contains("audiomxd") &&
                    
                    // Exclude non-meeting apps
                    !line.contains("Spotify") &&
                    !line.contains("SetappAge") &&
                    !line.contains("Setapp") &&
                    !line.contains("Music") &&
                    !line.contains("iTunes") &&
                    !line.contains("VLC") &&
                    !line.contains("QuickTime") &&
                    !line.contains("IINA") &&
                    !line.contains("Plex") &&
                    !line.contains("Netflix") &&
                    !line.contains("YouTube") &&
                    !line.contains("Twitch") &&
                    !line.contains("Steam") &&
                    
                    // Exclude local network connections (AirDrop, AirPlay, etc.)
                    !line.contains(".local:") &&
                    !line.contains("192.168.") &&
                    
                    // Exclude common system ports 
                    !line.contains(":53") &&    // DNS
                    !line.contains(":123") &&   // NTP
                    !line.contains(":67") &&    // DHCP
                    !line.contains(":68") &&    // DHCP
                    !line.contains(":5353") &&  // mDNS
                    !line.contains(":1900") &&  // UPnP
                    !line.contains(":443") &&   // HTTPS (too generic)
                    !line.contains(":8125") &&  // StatsD/metrics
                    
                    // Only include specific meeting apps - much more restrictive
                    (line.to_lowercase().contains("zoom") ||
                     line.to_lowercase().contains("teams") ||
                     line.to_lowercase().contains("slack") ||
                     line.to_lowercase().contains("skype") ||
                     line.to_lowercase().contains("webex") ||
                     line.to_lowercase().contains("meet") ||
                     line.to_lowercase().contains("googlemeet") ||
                     line.to_lowercase().contains("hangouts") ||
                     (line.to_lowercase().contains("chrome") && line.contains("meet")) ||
                     (line.to_lowercase().contains("safari") && line.contains("meet")) ||
                     (line.to_lowercase().contains("firefox") && line.contains("meet")))
                })
                .collect::<Vec<&str>>();

            println!("DEBUG: Filtered UDP connections found: {}", filtered_udp_connections.len());

            // Show all filtered connections for debugging
            for connection in filtered_udp_connections.iter().take(5) {
                println!("DEBUG: Filtered UDP: {}", connection);
            }

            // Only detect if we have significant outbound UDP connections to meeting platforms (more restrictive)
            if filtered_udp_connections.len() >= 2 {
                println!("Meeting detected: Meeting domain connections + {} filtered UDP connections to meeting platforms", filtered_udp_connections.len());
                return Ok(true);
            }
            
            // Special case for Google Meet: if we have Google TCP connections and potential browser, check for any UDP at all
            if is_google_connection && has_potential_meet_browser {
                let any_browser_udp = lsof_content
                    .lines()
                    .filter(|line| {
                        (line.to_lowercase().contains("chrome") || 
                         line.to_lowercase().contains("safari") || 
                         line.to_lowercase().contains("firefox")) &&
                        line.contains("UDP") && 
                        line.contains("->") &&
                        !line.contains("*:*") &&
                        !line.contains(":53") && // Exclude DNS
                        !line.contains(":123") // Exclude NTP
                    })
                    .collect::<Vec<&str>>();
                    
                println!("DEBUG: Found {} browser UDP connections (potential Meet)", any_browser_udp.len());
                
                if any_browser_udp.len() >= 1 {
                    println!("Meeting detected: Google connections + browser + {} UDP connections", any_browser_udp.len());
                    for connection in any_browser_udp.iter().take(2) {
                        println!("DEBUG: Browser UDP: {}", connection);
                    }
                    return Ok(true);
                }
            }
            
            // Even more permissive: if we have multiple Google connections, likely a meeting
            let google_connection_count = netstat_content.lines().filter(|line| {
                line.contains("ESTABLISHED") && (
                    line.contains("216.58.") || line.contains("74.125.") || 
                    line.contains("142.250.") || line.contains("108.177.")
                )
            }).count();
            
            println!("DEBUG: Google connection count: {}", google_connection_count);
            
            if google_connection_count >= 3 && has_potential_meet_browser {
                println!("Meeting detected: {} Google connections + browser (likely Meet)", google_connection_count);
                return Ok(true);
            }
            
            // Alternative check: Look for browser processes with outbound UDP connections TO MEETING DOMAINS
            let browser_processes = ["chrome", "safari", "firefox"];
            
            for browser in &browser_processes {
                let browser_connections = lsof_content
                    .lines()
                    .filter(|line| {
                        line.to_lowercase().contains(browser) && 
                        line.contains("UDP") && 
                        line.contains("->") && // Only outbound connections
                        !line.contains("*:*") && // Exclude listening sockets
                        // Exclude common browser UDP that's not WebRTC
                        !line.contains(":53") && // DNS
                        !line.contains(":123") && // NTP
                        !line.contains(":443") && // HTTPS
                        // Only include connections to meeting platform IPs
                        meeting_ip_ranges.iter().any(|range| line.contains(range.0))
                    })
                    .collect::<Vec<&str>>();
                    
                if browser_connections.len() >= 2 {
                    println!("DEBUG: Browser {} has {} outbound UDP connections to meeting domains", browser, browser_connections.len());
                    
                    // Show browser UDP examples
                    for connection in browser_connections.iter().take(2) {
                        println!("DEBUG: Browser UDP to meeting domain: {}", connection);
                    }
                    
                    return Ok(true);
                }
            }
            
            // Even more permissive: if we have meeting connections and any process has UDP, likely in call
            // Check if we have any UDP connections to meeting IP ranges specifically
            let meeting_udp_connections = lsof_content
                .lines()
                .filter(|line| {
                    line.contains("UDP") && meeting_ip_ranges.iter().any(|range| line.contains(range.0))
                })
                .collect::<Vec<&str>>();
                
            if !meeting_udp_connections.is_empty() {
                println!("DEBUG: Found {} UDP connections directly to meeting platforms", meeting_udp_connections.len());
                
                for connection in meeting_udp_connections.iter().take(2) {
                    println!("DEBUG: Meeting UDP: {}", connection);
                }
                
                return Ok(true);
            }
            
            // FINAL FALLBACK: If we have Google connections AND a potential browser, consider it a meeting
            // This covers the case where Google Meet is active but UDP is not clearly detectable
            if is_google_connection && has_potential_meet_browser {
                println!("Meeting detected: Google connections + potential Meet browser (final fallback)");
                return Ok(true);
            }
        }

        println!("DEBUG: Meeting domain connections found but no WebRTC detected");
        Ok(false)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("WebRTC detection only supported on macOS".to_string())
    }
}

#[tauri::command]
async fn check_high_bandwidth_connections() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // Define meeting apps at function scope
        let meeting_apps = [
            // "Discord", "discord", 
            "zoom", "Zoom", "Teams", "Skype", "slack",
        ];

        // Get network statistics for processes with high UDP traffic
        let nettop_output = Command::new("nettop")
            .args(&["-P", "-l", "1", "-t", "external"])
            .output()
            .map_err(|e| format!("Failed to run nettop: {}", e))?;

        println!("DEBUG: Running nettop for bandwidth check");
        if nettop_output.status.success() {
            let nettop_content = String::from_utf8_lossy(&nettop_output.stdout);
            println!(
                "DEBUG: nettop output length: {} chars",
                nettop_content.len()
            );

            // Parse nettop output to find processes with high network usage
            let mut high_traffic_apps = Vec::new();

            for line in nettop_content.lines() {
                // Skip header lines
                if line.contains("time") || line.contains("=") || line.trim().is_empty() {
                    continue;
                }

                // Parse nettop line format: bytes_in/bytes_out for each process
                for app in &meeting_apps {
                    if line.contains(app) {
                        // Extract network traffic data
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if parts.len() >= 3 {
                            // Look for traffic indicators in KB/s or MB/s
                            let traffic_info = parts.join(" ");

                            // Check for continuous high traffic (>50KB/s typically indicates voice call)
                            if traffic_info.contains("KB/s") || traffic_info.contains("MB/s") {
                                // Parse traffic values
                                for part in &parts {
                                    if part.contains("KB/s") || part.contains("MB/s") {
                                        if let Some(traffic_val) =
                                            part.strip_suffix("KB/s").or(part.strip_suffix("MB/s"))
                                        {
                                            if let Ok(val) = traffic_val.parse::<f32>() {
                                                // Voice calls typically use 50-200 KB/s
                                                // Video calls use 500KB/s - 2MB/s+
                                                if val > 50.0 {
                                                    println!(
                                                        "High traffic detected for {}: {} traffic",
                                                        app, part
                                                    );
                                                    high_traffic_apps.push(app.to_string());
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        break;
                    }
                }
            }

            if !high_traffic_apps.is_empty() {
                println!(
                    "Meeting apps with high network traffic: {:?}",
                    high_traffic_apps
                );
                return Ok(true);
            }
        }

        // Fallback: Use netstat to check for sustained UDP connections
        let netstat_output = Command::new("netstat").args(&["-u", "-n"]).output();

        if let Ok(netstat_result) = netstat_output {
            let netstat_content = String::from_utf8_lossy(&netstat_result.stdout);

            // Count UDP connections to external addresses
            let mut external_udp_count = 0;

            for line in netstat_content.lines() {
                if line.contains("udp")
                    && !line.contains("127.0.0.1")
                    && !line.contains("localhost")
                {
                    // Look for established UDP connections to external addresses
                    if line.contains("ESTABLISHED") || line.contains("*.*") {
                        external_udp_count += 1;
                    }
                }
            }

            // If we have many external UDP connections, might be in a call
            if external_udp_count > 5 {
                println!(
                    "Many external UDP connections detected: {}",
                    external_udp_count
                );

                // Additional check: Use lsof to see which processes own these connections
                let lsof_udp = Command::new("lsof").args(&["-i", "UDP", "-n"]).output();

                if let Ok(lsof_result) = lsof_udp {
                    let lsof_content = String::from_utf8_lossy(&lsof_result.stdout);

                    for app in &meeting_apps {
                        if lsof_content.contains(app) {
                            // Count how many UDP connections this app has
                            let app_udp_count = lsof_content
                                .lines()
                                .filter(|line| line.contains(app) && line.contains("UDP"))
                                .count();

                            if app_udp_count >= 2 {
                                println!(
                                    "Meeting app {} has {} UDP connections",
                                    app, app_udp_count
                                );
                                return Ok(true);
                            }
                        }
                    }
                }
            }
        }

        Ok(false)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("High bandwidth detection only supported on macOS".to_string())
    }
}
