use crate::accounts::Account;
use crate::imap::SessionPool;
use crate::settings::Settings;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub accounts: Mutex<Vec<Account>>,
    pub config_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub pool: SessionPool,
}

impl AppState {
    pub fn account(&self, id: &str) -> Result<Account, String> {
        self.accounts
            .lock()
            .unwrap()
            .iter()
            .find(|a| a.id == id)
            .cloned()
            .ok_or_else(|| "Konto nicht gefunden".to_string())
    }
}
