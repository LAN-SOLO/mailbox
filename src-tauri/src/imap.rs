//! IMAP-Sessions: ein Pool je Konto (get-or-connect), bei Verbindungs-
//! fehlern wird einmal neu verbunden und der Befehl wiederholt.

use crate::accounts::{self, Account};
use crate::state::AppState;
use imap::{ClientBuilder, Connection, ConnectionMode, Session};
use mailbox_core::Security;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub type ImapSession = Session<Connection>;

type Slot = Arc<Mutex<Option<ImapSession>>>;

#[derive(Default)]
pub struct SessionPool {
    slots: Mutex<HashMap<String, Slot>>,
}

/// Lesbare Fehlermeldung aus einem IMAP-Fehler.
pub fn readable(e: &imap::Error) -> String {
    match e {
        imap::Error::Io(io) => format!("Verbindung fehlgeschlagen: {io}"),
        imap::Error::RustlsHandshake(t) => format!("TLS-Fehler: {t}"),
        imap::Error::No(no) => format!("Server lehnt ab: {}", no.information),
        imap::Error::Bad(bad) => format!("Ungültiger Befehl: {}", bad.information),
        imap::Error::Bye(bye) => format!("Server hat die Verbindung beendet: {}", bye.information),
        imap::Error::ConnectionLost => "Verbindung verloren".into(),
        imap::Error::StartTlsNotAvailable => "Server bietet kein STARTTLS an".into(),
        imap::Error::Parse(p) => format!("Antwort nicht lesbar: {p}"),
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
            imap::Error::No(no) => format!("Login fehlgeschlagen: {}", no.information),
            other => format!("Login fehlgeschlagen: {}", readable(other)),
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
        if let Some(mut s) = guard.take() {
            let _ = s.logout();
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
        for attempt in 0..2 {
            if guard.is_none() {
                let password = accounts::get_password(&st.config_dir, &account)?;
                *guard = Some(connect(&account, &password)?);
            }
            let session = guard.as_mut().expect("session present");
            match f(session) {
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
        Err("Verbindung fehlgeschlagen".into())
    }
}
