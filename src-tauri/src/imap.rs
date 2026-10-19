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
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

pub type ImapSession = Session<Connection>;

/// Ungenutzte Sessions älter als das gelten als verdächtig. Wanduhr statt
/// `Instant`, weil `Instant` auf macOS im Ruhezustand stehen bleibt.
const STALE_AFTER: Duration = Duration::from_secs(4 * 60);

struct Pooled {
    session: ImapSession,
    knob: TimeoutKnob,
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

/// Gemeinsamer Regler für das Lese-/Schreib-Timeout einer Verbindung
/// (Millisekunden). Der Pool setzt ihn für die kurze NOOP-Probe herab; der
/// Datenstrom übernimmt den Wert vor der nächsten Socket-Operation. Die
/// imap-Bibliothek gibt ihren Strom nicht heraus, deshalb dieser Umweg.
#[derive(Clone)]
pub(crate) struct TimeoutKnob(Arc<AtomicU64>);

impl TimeoutKnob {
    fn new(d: Duration) -> Self {
        TimeoutKnob(Arc::new(AtomicU64::new(d.as_millis() as u64)))
    }
    fn set(&self, d: Duration) {
        self.0.store(d.as_millis().max(1) as u64, Ordering::SeqCst);
    }
}

enum Inner {
    Plain(TcpStream),
    Tls(Box<rustls::StreamOwned<rustls::ClientConnection, TcpStream>>),
}

/// Datenstrom für die imap-Bibliothek (Klartext oder TLS) mit verstellbarem
/// Timeout (braucht `SetReadTimeout`).
struct Stream {
    inner: Inner,
    knob: TimeoutKnob,
    applied: u64,
}

impl Stream {
    fn new(inner: Inner, knob: TimeoutKnob) -> Self {
        let applied = knob.0.load(Ordering::SeqCst);
        Stream { inner, knob, applied }
    }
    fn sock(&self) -> &TcpStream {
        match &self.inner {
            Inner::Plain(s) => s,
            Inner::Tls(t) => &t.sock,
        }
    }
    /// Timeout aus dem Regler übernehmen, falls er sich geändert hat.
    fn sync(&mut self) -> io::Result<()> {
        let want = self.knob.0.load(Ordering::SeqCst);
        if want != self.applied {
            let d = Some(Duration::from_millis(want.max(1)));
            self.sock().set_read_timeout(d)?;
            self.sock().set_write_timeout(d)?;
            self.applied = want;
        }
        Ok(())
    }
}

impl Read for Stream {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.sync()?;
        match &mut self.inner {
            Inner::Plain(s) => s.read(buf),
            Inner::Tls(t) => t.read(buf),
        }
    }
}

impl Write for Stream {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.sync()?;
        match &mut self.inner {
            Inner::Plain(s) => s.write(buf),
            Inner::Tls(t) => t.write(buf),
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        match &mut self.inner {
            Inner::Plain(s) => s.flush(),
            Inner::Tls(t) => t.flush(),
        }
    }
}

impl SetReadTimeout for Stream {
    fn set_read_timeout(&mut self, timeout: Option<Duration>) -> imap::Result<()> {
        self.sock().set_read_timeout(timeout).map_err(imap::Error::Io)
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
fn tls_wrap(host: &str, mut tcp: TcpStream) -> Result<Inner, String> {
    let name = rustls::pki_types::ServerName::try_from(host.to_string())
        .map_err(|_| format!("{} „{host}“", tr("Ungültiger Servername", "Invalid server name")))?;
    let mut conn = rustls::ClientConnection::new(tls_config(), name).map_err(tls_msg)?;
    while conn.is_handshaking() {
        conn.complete_io(&mut tcp).map_err(|e| if is_timeout(&e) { timeout_msg() } else { tls_msg(e) })?;
    }
    Ok(Inner::Tls(Box::new(rustls::StreamOwned::new(conn, tcp))))
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
fn starttls(host: &str, mut tcp: TcpStream) -> Result<Inner, String> {
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
/// Begrüßung ist gelesen. (Nur Tests; die App geht über [`connect`].)
#[cfg(test)]
pub(crate) fn open(host: &str, port: u16, security: Security) -> Result<Client<Connection>, String> {
    open_with(host, port, security, IO_TIMEOUT).map(|(c, _)| c)
}

fn open_with(
    host: &str,
    port: u16,
    security: Security,
    io_timeout: Duration,
) -> Result<(Client<Connection>, TimeoutKnob), String> {
    let tcp = tcp_connect(host, port, io_timeout).map_err(|m| conn_err(host, port, m))?;
    let inner = match security {
        Security::Tls => tls_wrap(host, tcp).map_err(|m| conn_err(host, port, m))?,
        Security::Starttls => starttls(host, tcp).map_err(|m| conn_err(host, port, m))?,
        Security::None => Inner::Plain(tcp),
    };
    let knob = TimeoutKnob::new(io_timeout);
    let stream: Connection = Box::new(Stream::new(inner, knob.clone()));
    let mut client = Client::new(stream);
    if security == Security::Starttls {
        // Die Begrüßung kam schon im Klartext.
        client.greeting_read = true;
    } else {
        client.read_greeting().map_err(|e| conn_err(host, port, readable(&e)))?;
    }
    Ok((client, knob))
}

/// Neue Verbindung inkl. Login.
pub fn connect(acc: &Account, password: &str) -> Result<ImapSession, String> {
    connect_knob(acc, password).map(|(s, _)| s)
}

fn connect_knob(acc: &Account, password: &str) -> Result<(ImapSession, TimeoutKnob), String> {
    let (client, knob) = open_with(&acc.imap_host, acc.imap_port, acc.imap_security, IO_TIMEOUT)?;
    let session = client.login(&acc.username, password).map_err(|(e, _)| match &e {
        imap::Error::No(no) => format!("{}: {}", tr("Login fehlgeschlagen", "Login failed"), no.information),
        other => format!("{}: {}", tr("Login fehlgeschlagen", "Login failed"), readable(other)),
    })?;
    Ok((session, knob))
}

/// Ob ein Befehl nach einer Zeitüberschreitung gefahrlos auf einer neuen
/// Verbindung wiederholt werden darf (Lesen, Flags setzen) — oder nicht
/// (Verschieben, Anhängen, Löschen: der erste Versuch kann schon durch sein).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Retry {
    Idempotent,
    Once,
}

/// Probe (NOOP) mit kurzem Timeout, bevor eine Session wiederbenutzt wird,
/// die länger als [`PROBE_AFTER`] ruhte: Nach WLAN-Wechsel ist die alte
/// TCP-Verbindung oft tot, ohne dass es jemand merkt — statt 100 s auf den
/// eigentlichen Befehl zu warten, fällt das nach höchstens [`PROBE_TIMEOUT`]
/// auf, und der Befehl läuft auf einer neuen Verbindung.
const PROBE_AFTER: Duration = Duration::from_secs(30);
pub(crate) const PROBE_TIMEOUT: Duration = Duration::from_secs(8);

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

    /// Test: Session künstlich altern lassen (Probe/Neuaufbau auslösen).
    #[cfg(test)]
    pub(crate) fn age(&self, account_id: &str, by: Duration) {
        if let Some(p) = self.slot(account_id).lock().unwrap().as_mut() {
            p.last_used -= by;
        }
    }

    /// Führt `f` auf der Session des Kontos aus; bei Verbindungsfehlern wird
    /// einmal neu verbunden und wiederholt — nach einer Zeitüberschreitung
    /// nur, wenn der Befehl idempotent ist ([`SessionPool::with`] ist
    /// [`Retry::Once`]: kein zweiter Versuch nach Timeout).
    pub fn with<T>(
        &self,
        st: &AppState,
        account_id: &str,
        f: impl FnMut(&mut ImapSession) -> imap::Result<T>,
    ) -> Result<T, String> {
        self.run(st, account_id, Retry::Once, f)
    }

    /// Wie [`SessionPool::with`], aber für lesende/idempotente Befehle: auch
    /// nach einer Zeitüberschreitung auf einer weiterbenutzten Verbindung
    /// wird einmal mit neuer Verbindung wiederholt.
    pub fn read<T>(
        &self,
        st: &AppState,
        account_id: &str,
        f: impl FnMut(&mut ImapSession) -> imap::Result<T>,
    ) -> Result<T, String> {
        self.run(st, account_id, Retry::Idempotent, f)
    }

    fn run<T>(
        &self,
        st: &AppState,
        account_id: &str,
        retry: Retry,
        mut f: impl FnMut(&mut ImapSession) -> imap::Result<T>,
    ) -> Result<T, String> {
        let account = st.account(account_id)?;
        let slot = self.slot(account_id);
        let mut guard = slot.lock().unwrap();
        // Während des Wartens auf die Session gelöscht → nicht neu verbinden
        // (die Session hinge sonst bis Programmende am entfernten Konto).
        st.account(account_id)?;
        if guard.as_ref().is_some_and(|p| is_stale(p.last_used)) {
            // Socket schließen, ohne auf eine Antwort zu warten.
            *guard = None;
        }
        if guard.as_ref().is_some_and(|p| idle_longer_than(p.last_used, PROBE_AFTER)) {
            let p = guard.as_mut().expect("session present");
            if !probe(p, PROBE_TIMEOUT) {
                *guard = None;
            }
        }
        for attempt in 0..2 {
            let fresh = guard.is_none();
            if fresh {
                let password = accounts::get_password(&st.config_dir, &account)?;
                let (session, knob) = connect_knob(&account, &password)?;
                *guard = Some(Pooled { session, knob, last_used: SystemTime::now() });
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
                        if attempt == 0 && should_retry(retry, is_timeout_error(&e), fresh) {
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

/// Zweiter Versuch nach einem Verbindungsfehler? Ohne Timeout immer (der
/// Befehl kam nicht durch: Verbindung weg). Nach Timeout nur bei
/// idempotenten Befehlen und nur, wenn die Verbindung schon älter war — eine
/// eben aufgebaute, die schweigt, deutet auf den Server, nicht auf das Netz.
fn should_retry(retry: Retry, timed_out: bool, fresh: bool) -> bool {
    !timed_out || (retry == Retry::Idempotent && !fresh)
}

/// NOOP mit kurzem Timeout; danach gilt wieder [`IO_TIMEOUT`].
fn probe(p: &mut Pooled, limit: Duration) -> bool {
    p.knob.set(limit);
    let ok = p.session.noop().is_ok();
    p.knob.set(IO_TIMEOUT);
    if ok {
        p.last_used = SystemTime::now();
    }
    ok
}

fn idle_longer_than(last_used: SystemTime, d: Duration) -> bool {
    SystemTime::now().duration_since(last_used).map(|x| x > d).unwrap_or(true)
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

    /// Fake-Server bis nach dem Login; danach antwortet er auf NOOP oder schweigt.
    fn logged_in(answer_noop: bool) -> Pooled {
        let port = fake_server(move |mut s| {
            s.write_all(b"* OK fake\r\n").unwrap();
            let login = read_cmd(&mut s);
            let tag = login.split(' ').next().unwrap_or("").to_string();
            s.write_all(format!("{tag} OK logged in\r\n").as_bytes()).unwrap();
            let noop = read_cmd(&mut s);
            if answer_noop {
                let tag = noop.split(' ').next().unwrap_or("").to_string();
                s.write_all(format!("{tag} OK noop\r\n").as_bytes()).unwrap();
            }
            thread::sleep(Duration::from_secs(3));
        });
        let (client, knob) = open_with("127.0.0.1", port, Security::None, IO_TIMEOUT).unwrap();
        let session = client.login("u", "p").map_err(|(e, _)| e).unwrap();
        Pooled { session, knob, last_used: SystemTime::now() }
    }

    #[test]
    fn probe_detects_dead_connection_quickly() {
        let mut dead = logged_in(false);
        let t0 = std::time::Instant::now();
        assert!(!probe(&mut dead, Duration::from_millis(300)));
        assert!(t0.elapsed() < Duration::from_secs(2), "Probe hing {:?}", t0.elapsed());
        // Danach gilt wieder das normale Timeout.
        assert_eq!(dead.knob.0.load(Ordering::SeqCst), IO_TIMEOUT.as_millis() as u64);
        let mut alive = logged_in(true);
        assert!(probe(&mut alive, Duration::from_millis(1500)));
    }

    #[test]
    fn retry_policy() {
        // Verbindung weg (kein Timeout): immer ein zweiter Versuch.
        assert!(should_retry(Retry::Once, false, false));
        assert!(should_retry(Retry::Idempotent, false, true));
        // Timeout: nur idempotent und nur auf einer älteren Verbindung.
        assert!(!should_retry(Retry::Once, true, false));
        assert!(should_retry(Retry::Idempotent, true, false));
        assert!(!should_retry(Retry::Idempotent, true, true));
    }

    #[test]
    fn staleness() {
        assert!(!is_stale(SystemTime::now()));
        assert!(is_stale(SystemTime::now() - Duration::from_secs(5 * 60)));
        assert!(is_stale(SystemTime::now() + Duration::from_secs(60)));
    }
}
