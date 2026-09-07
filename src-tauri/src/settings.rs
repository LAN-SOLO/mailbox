//! App-Einstellungen als JSON im Config-Ordner der App.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// "de" | "en"
    pub language: String,
    /// "simple" | "expert"
    pub mode: String,
    /// "dark" | "light"
    pub theme: String,
    /// "blue" | "emerald" | "violet" | "amber"
    pub accent: String,
    pub auto_update: bool,
    pub load_remote_images: bool,
    pub page_size: u32,
    pub check_interval_min: u32,
    pub mark_read_on_open: bool,
    pub confirm_delete: bool,
    pub quote_on_reply: bool,
    /// Formatierung (Markdown) beim Senden als HTML-Teil mitschicken —
    /// Klartext bleibt immer enthalten. Nur Expertenmodus.
    pub compose_html: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            language: if sys_locale_is_german() { "de" } else { "en" }.into(),
            mode: "simple".into(),
            theme: "dark".into(),
            accent: "blue".into(),
            auto_update: false,
            load_remote_images: false,
            page_size: 50,
            check_interval_min: 5,
            mark_read_on_open: true,
            confirm_delete: true,
            quote_on_reply: true,
            compose_html: true,
        }
    }
}

fn sys_locale_is_german() -> bool {
    sys_locale::get_locale()
        .map(|l| l.to_lowercase().starts_with("de"))
        .unwrap_or(false)
}

pub fn config_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| dirs::config_dir().unwrap_or_default().join("mailbox"));
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn cache_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| dirs::cache_dir().unwrap_or_default().join("mailbox"));
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    config_dir(app).join("settings.json")
}

pub fn load(app: &tauri::AppHandle) -> Settings {
    std::fs::read_to_string(settings_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn store(app: &tauri::AppHandle, settings: &Settings) {
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = std::fs::write(settings_path(app), json);
    }
}
