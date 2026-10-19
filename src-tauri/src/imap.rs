//! IMAP-Sessions: ein Pool je Konto (get-or-connect), bei Verbindungs-
//! fehlern wird einmal neu verbunden und der Befehl wiederholt. Sessions,
//! die länger als [`STALE_AFTER`] ungenutzt waren, werden vor dem nächsten
//! Befehl verworfen und neu aufgebaut — nach Ruhezustand oder WLAN-Wechsel
//! ist die alte TCP-Verbindung oft tot, ohne dass es jemand merkt, und ein
//! Lesezugriff darauf hinge minutenlang.

use crate::accounts::{self, Account};
use crate::lang::tr;
use crate::state::AppState;
use imap::{ClientBuilder, Connection, ConnectionMode, Session};
use mailbox_core::Security;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

pub type ImapSession = Session<Connection>;

/// Ungenutzte Sessions älter als das gelten als verdächtig. Wanduhr statt
/// `Instant`, weil `Instant` auf macOS im Ruhezustand stehen bleibt.
const STALE_AFTER: Duration = Duration::from_secs(4 * 60);

struct Pooled {
    session: ImapSession,
    last_used: SystemTime,
}

type Slot = Arc<Mutex<Option<Pooled>>>;

#[derive(Default)]
pub struct SessionPool {
    slots: Mutex<HashMap<String, Slot>>,
}

/// Lesbare Fehlermeldung aus einem IMAP-Fehler.
pub fn readable(e: &imap::Error) -> String {
    match e {
        imap::Error::Io(io) => format!("{}: {io}", tr("Verbindung fehlgeschlagen", "Connection failed")),
        imap::Error::RustlsHandshake(t) => format!("{}: {t}", tr("TLS-Fehler", "TLS error")),
        imap::Error::No(no) => format!("{}: {}", tr("Server lehnt ab", "Server refused"), no.information),
        imap::Error::Bad(bad) => format!("{}: {}", tr("Ungültiger Befehl", "Invalid command"), bad.information),
        imap::Error::Bye(bye) => format!(
            "{}: {}",
            tr("Server hat die Verbindung beendet", "Server closed the connection"),
            bye.information
        ),
        imap::Error::ConnectionLost => tr("Verbindung verloren", "Connection lost"),
        imap::Error::StartTlsNotAvailable => tr("Server bietet kein STARTTLS an", "Server does not offer STARTTLS"),
        imap::Error::Parse(p) => format!("{}: {p}", tr("Antwort nicht lesbar", "Unreadable response")),
        imap::Error::Validate(v) => format!("{}: {v}", tr("Ungültige Eingabe", "Invalid input")),
        other => other.to_string(),
    }
}

fn is_connection_error(e: &imap::Error) -> bool {
    matches!(
        e,
        imap::Error::Io(_) | imap::Error::ConnectionLost | imap::Error::Bye(_) | imap::Error::Parse(_)
    )
}

/// Neue Verbindung inkl. Login.
pub fn connect(acc: &Account, password: &str) -> Result<ImapSession, String> {
    let mode = match acc.imap_security {
        Security::Tls => ConnectionMode::Tls,
        Security::Starttls => ConnectionMode::StartTls,
        Security::None => ConnectionMode::Plaintext,
    };
    let client = ClientBuilder::new(acc.imap_host.as_str(), acc.imap_port)
        .mode(mode)
        .connect()
        .map_err(|e| format!("IMAP {}:{} — {}", acc.imap_host, acc.imap_port, readable(&e)))?;
    client
        .login(&acc.username, password)
        .map_err(|(e, _)| match &e {
            imap::Error::No(no) => format!("{}: {}", tr("Login fehlgeschlagen", "Login failed"), no.information),
            other => format!("{}: {}", tr("Login fehlgeschlagen", "Login failed"), readable(other)),
        })
}

impl SessionPool {
    fn slot(&self, account_id: &str) -> Slot {
        let mut map = self.slots.lock().unwrap();
        map.entry(account_id.to_string()).or_default().clone()
    }

    /// Session des Kontos schließen (Konto gelöscht / Zugangsdaten geändert).
    pub fn drop_session(&self, account_id: &str) {
        let slot = self.slot(account_id);
        let mut guard = slot.lock().unwrap();
        if let Some(mut p) = guard.take() {
            // Nur höflich abmelden, wenn die Verbindung frisch ist — auf einer
            // toten Verbindung hinge LOGOUT.
            if !is_stale(p.last_used) {
                let _ = p.session.logout();
            }
        }
    }

    /// Führt `f` auf der Session des Kontos aus; bei Verbindungsfehlern wird
    /// einmal neu verbunden und wiederholt.
    pub fn with<T>(
        &self,
        st: &AppState,
        account_id: &str,
        mut f: impl FnMut(&mut ImapSession) -> imap::Result<T>,
    ) -> Result<T, String> {
        let account = st.account(account_id)?;
        let slot = self.slot(account_id);
        let mut guard = slot.lock().unwrap();
        if guard.as_ref().is_some_and(|p| is_stale(p.last_used)) {
            // Socket schließen, ohne auf eine Antwort zu warten.
            *guard = None;
        }
        for attempt in 0..2 {
            if guard.is_none() {
                let password = accounts::get_password(&st.config_dir, &account)?;
                *guard = Some(Pooled { session: connect(&account, &password)?, last_used: SystemTime::now() });
            }
            let pooled = guard.as_mut().expect("session present");
            let result = f(&mut pooled.session);
            pooled.last_used = SystemTime::now();
            match result {
                Ok(v) => return Ok(v),
                Err(e) => {
                    if attempt == 0 && is_connection_error(&e) {
                        *guard = None;
                        continue;
                    }
                    return Err(readable(&e));
                }
            }
        }
        Err(tr("Verbindung fehlgeschlagen", "Connection failed"))
    }
}

fn is_stale(last_used: SystemTime) -> bool {
    // Uhr zurückgestellt (Err) zählt ebenfalls als verdächtig.
    SystemTime::now().duration_since(last_used).map(|d| d > STALE_AFTER).unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staleness() {
        assert!(!is_stale(SystemTime::now()));
        assert!(is_stale(SystemTime::now() - Duration::from_secs(5 * 60)));
        assert!(is_stale(SystemTime::now() + Duration::from_secs(60)));
    }
}
