// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod accounts;
mod commands;
mod imap;
mod settings;
mod smtp;
mod state;

use state::AppState;
use std::sync::{Arc, Mutex};
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let config_dir = settings::config_dir(&handle);
            let cache_dir = settings::cache_dir(&handle);
            let s = settings::load(&handle);
            let accounts = accounts::load(&config_dir);
            app.manage(Arc::new(AppState {
                settings: Mutex::new(s),
                accounts: Mutex::new(accounts),
                config_dir,
                cache_dir,
                pool: imap::SessionPool::default(),
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::set_settings,
            commands::list_accounts,
            commands::save_account,
            commands::delete_account,
            commands::guess_servers,
            commands::test_account,
            commands::list_folders,
            commands::create_folder,
            commands::delete_folder,
            commands::list_messages,
            commands::search_messages,
            commands::get_message,
            commands::get_message_source,
            commands::set_flag,
            commands::move_messages,
            commands::delete_messages,
            commands::empty_folder,
            commands::save_attachment,
            commands::send_message,
            commands::save_draft,
            commands::data_path,
            commands::check_update,
            commands::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while building mailbox");
}
