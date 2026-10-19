//! Sprache der Backend-Meldungen (Fehler, Testergebnisse). Folgt der
//! App-Sprache aus den Einstellungen — gesetzt beim Start und bei jedem
//! `set_settings`.

use std::sync::atomic::{AtomicBool, Ordering};

static EN: AtomicBool = AtomicBool::new(false);

pub fn set(language: &str) {
    EN.store(language != "de", Ordering::Relaxed);
}

/// Wählt die deutsche oder englische Fassung einer Meldung.
pub fn tr(de: &str, en: &str) -> String {
    if EN.load(Ordering::Relaxed) { en } else { de }.to_string()
}
