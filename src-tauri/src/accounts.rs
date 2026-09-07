//! Konten (accounts.json im Config-Ordner) und Passwörter: bevorzugt im
//! OS-Schlüsselbund, sonst — wenn der nicht erreichbar ist — in einer
//! Datei `credentials.json` mit 0600.

use mailbox_core::Security;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const KEYRING_SERVICE: &str = "com.lan-solo.mailbox";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub email: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_security: Security,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_security: Security,
    pub username: String,
    pub signature: String,
    pub color: String,
    /// "keychain" | "file" | "none"
    pub password_stored: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub email: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_security: Security,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_security: Security,
    pub username: String,
    #[serde(default)]
    pub signature: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub password: Option<String>,
}

impl AccountInput {
    pub fn into_account(self, id: String, password_stored: String) -> Account {
        Account {
            id,
            name: self.name,
            email: self.email,
            imap_host: self.imap_host,
            imap_port: self.imap_port,
            imap_security: self.imap_security,
            smtp_host: self.smtp_host,
            smtp_port: self.smtp_port,
            smtp_security: self.smtp_security,
            username: self.username,
            signature: self.signature,
            color: self.color,
            password_stored,
        }
    }
}

fn accounts_path(dir: &Path) -> PathBuf {
    dir.join("accounts.json")
}

fn credentials_path(dir: &Path) -> PathBuf {
    dir.join("credentials.json")
}

pub fn load(dir: &Path) -> Vec<Account> {
    std::fs::read_to_string(accounts_path(dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn store(dir: &Path, accounts: &[Account]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(accounts).map_err(|e| e.to_string())?;
    std::fs::write(accounts_path(dir), json).map_err(|e| e.to_string())
}

// --- Passwörter -----------------------------------------------------------

fn file_credentials(dir: &Path) -> HashMap<String, String> {
    std::fs::read_to_string(credentials_path(dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_file_credentials(dir: &Path, creds: &HashMap<String, String>) -> Result<(), String> {
    let path = credentials_path(dir);
    let json = serde_json::to_string_pretty(creds).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Speichert das Passwort; liefert zurück, wo es gelandet ist
/// ("keychain" oder "file").
pub fn store_password(dir: &Path, account_id: &str, password: &str) -> Result<String, String> {
    let keyring_ok = keyring::Entry::new(KEYRING_SERVICE, account_id)
        .and_then(|e| e.set_password(password))
        .is_ok();
    if keyring_ok {
        // Alten Datei-Eintrag entfernen, falls vorhanden.
        let mut creds = file_credentials(dir);
        if creds.remove(account_id).is_some() {
            let _ = write_file_credentials(dir, &creds);
        }
        return Ok("keychain".into());
    }
    let mut creds = file_credentials(dir);
    creds.insert(account_id.to_string(), password.to_string());
    write_file_credentials(dir, &creds)?;
    Ok("file".into())
}

pub fn get_password(dir: &Path, account: &Account) -> Result<String, String> {
    if account.password_stored == "keychain" {
        if let Ok(p) = keyring::Entry::new(KEYRING_SERVICE, &account.id).and_then(|e| e.get_password()) {
            return Ok(p);
        }
    }
    if let Some(p) = file_credentials(dir).get(&account.id) {
        return Ok(p.clone());
    }
    // Letzter Versuch: Schlüsselbund trotz anderer Markierung.
    keyring::Entry::new(KEYRING_SERVICE, &account.id)
        .and_then(|e| e.get_password())
        .map_err(|_| "Kein Passwort hinterlegt — bitte im Konto neu eingeben.".to_string())
}

pub fn delete_password(dir: &Path, account_id: &str) {
    if let Ok(e) = keyring::Entry::new(KEYRING_SERVICE, account_id) {
        let _ = e.delete_credential();
    }
    let mut creds = file_credentials(dir);
    if creds.remove(account_id).is_some() {
        let _ = write_file_credentials(dir, &creds);
    }
}
