//! Konten (accounts.json im Config-Ordner) und Passwörter: bevorzugt im
//! OS-Schlüsselbund, sonst — wenn der nicht erreichbar ist — in einer
//! Datei `credentials.json` mit 0600.

use crate::lang::tr;
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

/// Kein `Debug`: die Struktur trägt das Klartext-Passwort und soll nie in
/// einem Log oder einer Panic-Meldung landen.
#[derive(Clone, Deserialize)]
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
    write_atomic(&accounts_path(dir), json.as_bytes(), false).map_err(|e| e.to_string())
}

/// Schreibt erst in eine Nachbardatei und benennt dann um — ein Absturz
/// mitten im Schreiben hinterlässt so nie eine halbe JSON-Datei. Mit
/// `private` entsteht die Datei auf Unix gleich mit 0600 (nicht erst
/// lesbar angelegt und danach eingeschränkt). Auf Windows liegt der
/// App-Datenordner ohnehin im Benutzerprofil mit Benutzer-ACL.
pub fn write_atomic(path: &Path, data: &[u8], private: bool) -> std::io::Result<()> {
    use std::io::Write;
    let tmp = path.with_extension("json.tmp");
    let _ = std::fs::remove_file(&tmp);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        if private {
            opts.mode(0o600);
        }
    }
    #[cfg(not(unix))]
    let _ = private;
    let mut f = opts.open(&tmp)?;
    f.write_all(data)?;
    f.sync_all()?;
    drop(f);
    std::fs::rename(&tmp, path)
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
    write_atomic(&path, json.as_bytes(), true).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        // Altbestand (vor 1.0 ggf. kurz lesbar angelegt) ebenfalls einschränken.
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
        .map_err(|_| {
            tr(
                "Kein Passwort hinterlegt — bitte im Konto neu eingeben.",
                "No password stored — please enter it again in the account.",
            )
        })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_file_is_private_and_atomic() {
        let dir = std::env::temp_dir().join(format!("mailbox-acc-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut creds = HashMap::new();
        creds.insert("a1".to_string(), "geheim".to_string());
        write_file_credentials(&dir, &creds).unwrap();
        creds.insert("a2".to_string(), "zwei".to_string());
        write_file_credentials(&dir, &creds).unwrap();
        let back = file_credentials(&dir);
        assert_eq!(back.get("a1").map(String::as_str), Some("geheim"));
        assert_eq!(back.len(), 2);
        assert!(!dir.join("credentials.json.tmp").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(credentials_path(&dir)).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
