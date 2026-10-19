//! IMAP-Sessions: ein Pool je Konto (get-or-connect), bei Verbindungs-
//! fehlern wird einmal neu verbunden und der Befehl wiederholt. Sessions,
//! die länger als [`STALE_AFTER`] ungenutzt waren, werden vor dem nächsten
//! Befehl verworfen und neu aufgebaut — nach Ruhezustand oder WLAN-Wechsel
//! ist die alte TCP-Verbindung oft tot, ohne dass es jemand merkt, und ein
//! Lesezugriff darauf hinge minutenlang.
//!
//! Verbindungsaufbau und TLS macht mailbox selbst (seit 1.0, Runde 2): TCP
//! mit Verbindungs-Timeout und Lese-/Schreib-Timeouts auf dem Socket, TLS
//! über rustls 0.23 (System-Zertifikate + Mozilla-Wurzeln), STARTTLS von
//! Hand. Die imap-Bibliothek bekommt nur noch den fertigen Datenstrom —
//! vorher hing ein mitten im Befehl schweigender Server das Konto auf, bis
//! TCP aufgab, und die Bibliothek zog rustls 0.22 mit offenen Meldungen.

use crate::accounts::{self, Account};
use crate::lang::tr;
use crate::state::AppState;
use imap::extensions::idle::SetReadTimeout;
use imap::{Client, Connection, Session};
use mailbox_core::Security;
use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::{Arc, Mutex, OnceLock};
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
        imap::Error::Io(io) if is_timeout(io) => timeout_msg(),
        imap::Error::Io(io) => format!("{}: {io}", tr("Verbindung fehlgeschlagen", "Connection failed")),
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

/// Fehler, nach denen die Session unbrauchbar ist (Strom kaputt oder
/// Protokoll aus dem Tritt) — sie wird verworfen, nie weiterbenutzt.
fn is_connection_error(e: &imap::Error) -> bool {
    matches!(
        e,
        imap::Error::Io(_)
            | imap::Error::ConnectionLost
            | imap::Error::Bye(_)
            | imap::Error::Parse(_)
            | imap::Error::TagMismatch(_)
            | imap::Error::Unexpected(_)
            | imap::Error::MissingStatusResponse
    )
}

/// Zeitüberschreitung: nicht wiederholen — ein Server, der eben 100 s
/// geschwiegen hat, tut es beim zweiten Versuch meist wieder.
fn is_timeout_error(e: &imap::Error) -> bool {
    matches!(e, imap::Error::Io(io) if is_timeout(io))
}

fn is_timeout(e: &io::Error) -> bool {
    // Unix meldet abgelaufene Socket-Timeouts als WouldBlock, Windows als TimedOut.
    matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut)
}

fn timeout_msg() -> String {
    format!(
        "{} ({} s)",
        tr("Zeitüberschreitung — der Server antwortet nicht", "Timeout — the server does not respond"),
        IO_TIMEOUT.as_secs()
    )
}

// --- Verbindung ---------------------------------------------------------------

/// Höchstdauer für den TCP-Verbindungsaufbau je Adresse.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// Lese-/Schreib-Timeout je Socket-Operation (nicht je Befehl): große
/// Abrufe laufen beliebig lange, solange Daten fließen.
pub(crate) const IO_TIMEOUT: Duration = Duration::from_secs(100);

/// TLS-Datenstrom für die imap-Bibliothek (braucht `SetReadTimeout`).
struct TlsStream(rustls::StreamOwned<rustls::ClientConnection, TcpStream>);

impl Read for TlsStream {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.0.read(buf)
    }
}

impl Write for TlsStream {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.write(buf)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.0.flush()
    }
}

impl SetReadTimeout for TlsStream {
    fn set_read_timeout(&mut self, timeout: Option<Duration>) -> imap::Result<()> {
        self.0.sock.set_read_timeout(timeout).map_err(imap::Error::Io)
    }
}

/// rustls-Konfiguration (einmal je Prozess): Wurzeln aus dem System
/// (Schlüsselbund/Zertifikatsspeicher — Firmen-CAs funktionieren) plus die
/// Mozilla-Liste als Rückfall. Zertifikats- und Namensprüfung immer an.
fn tls_config() -> Arc<rustls::ClientConfig> {
    static CFG: OnceLock<Arc<rustls::ClientConfig>> = OnceLock::new();
    CFG.get_or_init(|| {
        let mut roots = rustls::RootCertStore::empty();
        roots.add_parsable_certificates(rustls_native_certs::load_native_certs().certs);
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let cfg = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .expect("ring unterstützt TLS 1.2/1.3")
            .with_root_certificates(roots)
            .with_no_client_auth();
        Arc::new(cfg)
    })
    .clone()
}

fn conn_err(acc_host: &str, port: u16, msg: String) -> String {
    format!("IMAP {acc_host}:{port} — {msg}")
}

fn io_msg(e: &io::Error) -> String {
    if is_timeout(e) {
        timeout_msg()
    } else {
        format!("{}: {e}", tr("Verbindung fehlgeschlagen", "Connection failed"))
    }
}

/// TCP-Verbindung mit Timeouts; probiert alle Adressen des Namens (IPv6/IPv4).
fn tcp_connect(host: &str, port: u16, io_timeout: Duration) -> Result<TcpStream, String> {
    let addrs = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("{}: {e}", tr("Server nicht gefunden", "Server not found")))?;
    let mut last: Option<io::Error> = None;
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
            Ok(s) => {
                s.set_read_timeout(Some(io_timeout)).map_err(|e| io_msg(&e))?;
                s.set_write_timeout(Some(io_timeout)).map_err(|e| io_msg(&e))?;
                let _ = s.set_nodelay(true);
                return Ok(s);
            }
            Err(e) => last = Some(e),
        }
    }
    Err(match last {
        Some(e) => io_msg(&e),
        None => tr("Server nicht gefunden", "Server not found"),
    })
}

fn tls_msg(e: impl std::fmt::Display) -> String {
    format!("{}: {e}", tr("TLS-Fehler", "TLS error"))
}

/// TLS-Handshake vollständig hier — Zertifikatsfehler zeigen sich so beim
/// Verbinden, nicht erst beim ersten Befehl.
fn tls_wrap(host: &str, mut tcp: TcpStream) -> Result<TlsStream, String> {
    let name = rustls::pki_types::ServerName::try_from(host.to_string())
        .map_err(|_| format!("{} „{host}“", tr("Ungültiger Servername", "Invalid server name")))?;
    let mut conn = rustls::ClientConnection::new(tls_config(), name).map_err(tls_msg)?;
    while conn.is_handshaking() {
        conn.complete_io(&mut tcp).map_err(|e| if is_timeout(&e) { timeout_msg() } else { tls_msg(e) })?;
    }
    Ok(TlsStream(rustls::StreamOwned::new(conn, tcp)))
}

/// Eine Zeile (bis LF) direkt vom Socket lesen — Byte für Byte, damit vor
/// dem TLS-Handshake nichts im Puffer landet (eingeschleuster Klartext nach
/// STARTTLS wird so nie als Antwort gelesen).
fn read_line_raw(tcp: &mut TcpStream) -> io::Result<String> {
    let mut line = Vec::new();
    let mut b = [0u8; 1];
    loop {
        if tcp.read(&mut b)? == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "EOF"));
        }
        line.push(b[0]);
        if b[0] == b'\n' {
            break;
        }
        if line.len() > 16 * 1024 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "line too long"));
        }
    }
    Ok(String::from_utf8_lossy(&line).into_owned())
}

/// STARTTLS (RFC 3501 6.2.1): Begrüßung lesen, STARTTLS senden, auf das
/// getaggte OK warten, dann TLS. Ohne OK wird abgebrochen — nie im Klartext
/// weiter.
fn starttls(host: &str, mut tcp: TcpStream) -> Result<TlsStream, String> {
    let greeting = read_line_raw(&mut tcp).map_err(|e| io_msg(&e))?;
    if !greeting.to_ascii_uppercase().starts_with("* OK") {
        return Err(format!(
            "{}: {}",
            tr("Unerwartete Begrüßung", "Unexpected greeting"),
            greeting.trim_end()
        ));
    }
    tcp.write_all(b"m0 STARTTLS\r\n").map_err(|e| io_msg(&e))?;
    for _ in 0..64 {
        let line = read_line_raw(&mut tcp).map_err(|e| io_msg(&e))?;
        if let Some(rest) = line.strip_prefix("m0 ") {
            if rest.to_ascii_uppercase().starts_with("OK") {
                return tls_wrap(host, tcp);
            }
            return Err(tr("Server bietet kein STARTTLS an", "Server does not offer STARTTLS"));
        }
    }
    Err(tr("Server bietet kein STARTTLS an", "Server does not offer STARTTLS"))
}

/// Verbindung bis vor den Login: Datenstrom je nach Verschlüsselung, die
/// Begrüßung ist gelesen.
pub(crate) fn open(host: &str, port: u16, security: Security) -> Result<Client<Connection>, String> {
    open_with(host, port, security, IO_TIMEOUT)
}

fn open_with(host: &str, port: u16, security: Security, io_timeout: Duration) -> Result<Client<Connection>, String> {
    let tcp = tcp_connect(host, port, io_timeout).map_err(|m| conn_err(host, port, m))?;
    let stream: Connection = match security {
        Security::Tls => Box::new(tls_wrap(host, tcp).map_err(|m| conn_err(host, port, m))?),
        Security::Starttls => Box::new(starttls(host, tcp).map_err(|m| conn_err(host, port, m))?),
        Security::None => Box::new(tcp),
    };
    let mut client = Client::new(stream);
    if security == Security::Starttls {
        // Die Begrüßung kam schon im Klartext.
        client.greeting_read = true;
    } else {
        client.read_greeting().map_err(|e| conn_err(host, port, readable(&e)))?;
    }
    Ok(client)
}

/// Neue Verbindung inkl. Login.
pub fn connect(acc: &Account, password: &str) -> Result<ImapSession, String> {
    let client = open(&acc.imap_host, acc.imap_port, acc.imap_security)?;
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
                    if is_connection_error(&e) {
                        // Strom kaputt oder Protokoll aus dem Tritt: nie weiterbenutzen.
                        *guard = None;
                        if attempt == 0 && !is_timeout_error(&e) {
                            continue;
                        }
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

    use std::net::TcpListener;
    use std::thread;

    /// Mini-Server auf 127.0.0.1: `script` bekommt den angenommenen Socket.
    fn fake_server(script: impl FnOnce(TcpStream) + Send + 'static) -> u16 {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        thread::spawn(move || {
            if let Ok((s, _)) = l.accept() {
                script(s);
            }
        });
        port
    }

    fn read_cmd(s: &mut TcpStream) -> String {
        read_line_raw(s).unwrap_or_default()
    }

    #[test]
    fn plaintext_greeting_is_read() {
        let port = fake_server(|mut s| {
            s.write_all(b"* OK fake ready\r\n").unwrap();
            thread::sleep(Duration::from_millis(300));
        });
        assert!(open_with("127.0.0.1", port, Security::None, Duration::from_secs(5)).is_ok());
    }

    #[test]
    fn silent_server_times_out_instead_of_hanging() {
        let port = fake_server(|_s| thread::sleep(Duration::from_secs(3)));
        let t0 = std::time::Instant::now();
        let err = open_with("127.0.0.1", port, Security::Tls, Duration::from_millis(300)).err().unwrap();
        assert!(t0.elapsed() < Duration::from_secs(2), "hing {:?}", t0.elapsed());
        assert!(err.contains("Zeitüberschreitung") || err.contains("Timeout"), "{err}");
        let port = fake_server(|_s| thread::sleep(Duration::from_secs(3)));
        let err = open_with("127.0.0.1", port, Security::None, Duration::from_millis(300)).err().unwrap();
        assert!(err.contains("Zeitüberschreitung") || err.contains("Timeout"), "{err}");
    }

    #[test]
    fn starttls_refused_never_falls_back_to_plaintext() {
        let port = fake_server(|mut s| {
            s.write_all(b"* OK fake\r\n").unwrap();
            let cmd = read_cmd(&mut s);
            assert_eq!(cmd, "m0 STARTTLS\r\n");
            s.write_all(b"* BYE nope\r\nm0 NO no tls here\r\n").unwrap();
            thread::sleep(Duration::from_millis(300));
        });
        let err = open_with("127.0.0.1", port, Security::Starttls, Duration::from_secs(5)).err().unwrap();
        assert!(err.contains("STARTTLS"), "{err}");
    }

    #[test]
    fn starttls_injected_plaintext_breaks_handshake() {
        // Klartext, den ein Angreifer hinter das OK hängt, darf nie als
        // IMAP-Antwort gelesen werden — er landet im TLS-Handshake und scheitert.
        let port = fake_server(|mut s| {
            s.write_all(b"* OK fake\r\n").unwrap();
            let _ = read_cmd(&mut s);
            s.write_all(b"m0 OK go\r\n* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] injected\r\n").unwrap();
            thread::sleep(Duration::from_millis(500));
        });
        let err = open_with("localhost", port, Security::Starttls, Duration::from_secs(5)).err().unwrap();
        assert!(err.contains("TLS"), "{err}");
    }

    #[test]
    fn bad_starttls_greeting_rejected() {
        let port = fake_server(|mut s| {
            s.write_all(b"HTTP/1.1 400 Bad Request\r\n").unwrap();
        });
        let err = open_with("127.0.0.1", port, Security::Starttls, Duration::from_secs(5)).err().unwrap();
        assert!(err.contains("Begrüßung") || err.contains("greeting"), "{err}");
    }

    /// Echte TLS-Gegenstellen (Netz nötig): `cargo test -p mailbox -- --ignored net_tls`
    #[test]
    #[ignore]
    fn net_tls_public_servers() {
        open("imap.gmail.com", 993, Security::Tls).expect("TLS 993");
        open("imap.gmx.net", 143, Security::Starttls).expect("STARTTLS 143");
        let err = open("wrong.host.badssl.com", 443, Security::Tls).expect_err("falscher Name muss scheitern");
        assert!(err.contains("TLS"), "{err}");
        let err = open("self-signed.badssl.com", 443, Security::Tls).expect_err("selbst signiert muss scheitern");
        assert!(err.contains("TLS"), "{err}");
    }

    #[test]
    fn staleness() {
        assert!(!is_stale(SystemTime::now()));
        assert!(is_stale(SystemTime::now() - Duration::from_secs(5 * 60)));
        assert!(is_stale(SystemTime::now() + Duration::from_secs(60)));
    }
}
