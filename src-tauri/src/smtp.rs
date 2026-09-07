//! SMTP-Versand und MIME-Aufbau (lettre).

use crate::accounts::Account;
use lettre::message::header::ContentType;
use lettre::message::{Attachment, Mailbox, Message, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{SmtpTransport, Transport};
use mailbox_core::{parse_addresses, Address, Security};
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub account_id: String,
    #[serde(default)]
    pub to: String,
    #[serde(default)]
    pub cc: String,
    #[serde(default)]
    pub bcc: String,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub attachments: Vec<String>,
    #[serde(default)]
    pub in_reply_to: Option<String>,
    #[serde(default)]
    pub references: Vec<String>,
    /// HTML-Fassung des Bodys (Expertenmodus, aus Markdown gerendert).
    /// Wenn gesetzt, geht die Nachricht als multipart/alternative raus —
    /// `body` bleibt als text/plain-Teil erhalten.
    #[serde(default)]
    pub html: Option<String>,
    /// Reply-To als Freitext-Adressliste (leer = keiner).
    #[serde(default)]
    pub reply_to: String,
    /// "normal" | "high" | "low" → X-Priority + Importance.
    #[serde(default)]
    pub priority: String,
    /// Lesebestätigung anfordern (Disposition-Notification-To).
    #[serde(default)]
    pub read_receipt: bool,
}

fn mailbox(a: &Address) -> Result<Mailbox, String> {
    let addr: lettre::Address = a
        .email
        .parse()
        .map_err(|e| format!("Ungültige Adresse „{}“: {e}", a.email))?;
    Ok(Mailbox::new(a.name.clone(), addr))
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("pdf") => "application/pdf",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("txt") | Some("md") | Some("log") => "text/plain",
        Some("csv") => "text/csv",
        Some("html") | Some("htm") => "text/html",
        Some("json") => "application/json",
        Some("xml") => "application/xml",
        Some("zip") => "application/zip",
        Some("7z") => "application/x-7z-compressed",
        Some("gz") | Some("tgz") => "application/gzip",
        Some("doc") => "application/msword",
        Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Some("xls") => "application/vnd.ms-excel",
        Some("xlsx") => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Some("ppt") => "application/vnd.ms-powerpoint",
        Some("pptx") => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        Some("ics") => "text/calendar",
        Some("mp3") => "audio/mpeg",
        Some("mp4") => "video/mp4",
        Some("eml") => "message/rfc822",
        _ => "application/octet-stream",
    }
}

/// Baut die RFC-5322-Nachricht aus dem Entwurf. Empfänger dürfen beim
/// Entwurf fehlen; beim Senden prüft der Aufrufer.
pub fn build_message(acc: &Account, draft: &Draft) -> Result<Message, String> {
    let from = Address::new(Some(&acc.name), &acc.email);
    let mut b = Message::builder().from(mailbox(&from)?).date_now();
    for a in parse_addresses(&draft.to) {
        b = b.to(mailbox(&a)?);
    }
    for a in parse_addresses(&draft.cc) {
        b = b.cc(mailbox(&a)?);
    }
    for a in parse_addresses(&draft.bcc) {
        b = b.bcc(mailbox(&a)?);
    }
    b = b.subject(draft.subject.clone());
    if let Some(id) = draft.in_reply_to.as_deref().filter(|s| !s.trim().is_empty()) {
        b = b.in_reply_to(angle(id));
    }
    if !draft.references.is_empty() {
        let refs = draft.references.iter().map(|r| angle(r)).collect::<Vec<_>>().join(" ");
        b = b.references(refs);
    }
    for a in parse_addresses(&draft.reply_to) {
        b = b.reply_to(mailbox(&a)?);
    }
    match draft.priority.as_str() {
        "high" => {
            b = b.raw_header(raw("X-Priority", "1 (Highest)"));
            b = b.raw_header(raw("Importance", "high"));
        }
        "low" => {
            b = b.raw_header(raw("X-Priority", "5 (Lowest)"));
            b = b.raw_header(raw("Importance", "low"));
        }
        _ => {}
    }
    if draft.read_receipt {
        let who = match acc.name.trim() {
            "" => acc.email.clone(),
            n => format!("{n} <{}>", acc.email),
        };
        b = b.raw_header(raw("Disposition-Notification-To", &who));
    }
    b = b.header(lettre::message::header::UserAgent::from("mailbox (lan-solo.com)".to_string()));

    let text = SinglePart::plain(draft.body.clone());
    let html = draft
        .html
        .as_deref()
        .filter(|h| !h.trim().is_empty())
        .map(|h| SinglePart::html(h.to_string()));
    if draft.attachments.is_empty() {
        return match html {
            Some(h) => b.multipart(MultiPart::alternative().singlepart(text).singlepart(h)),
            None => b.singlepart(text),
        }
        .map_err(|e| e.to_string());
    }
    let mut mp = match html {
        Some(h) => MultiPart::mixed().multipart(MultiPart::alternative().singlepart(text).singlepart(h)),
        None => MultiPart::mixed().singlepart(text),
    };
    for p in &draft.attachments {
        let path = Path::new(p);
        let bytes = std::fs::read(path).map_err(|e| format!("Anhang „{p}“: {e}"))?;
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("anhang")
            .to_string();
        let ct = ContentType::parse(mime_for(path)).map_err(|e| e.to_string())?;
        mp = mp.singlepart(Attachment::new(name).body(bytes, ct));
    }
    b.multipart(mp).map_err(|e| e.to_string())
}

/// Rohe Kopfzeile ohne Encoding — nur für ASCII-Namen und -Werte gedacht.
fn raw(name: &'static str, value: &str) -> lettre::message::header::HeaderValue {
    use lettre::message::header::{HeaderName, HeaderValue};
    HeaderValue::new(HeaderName::new_from_ascii_str(name), value.to_string())
}

fn angle(id: &str) -> String {
    let id = id.trim();
    if id.starts_with('<') {
        id.to_string()
    } else {
        format!("<{id}>")
    }
}

fn transport(acc: &Account, password: &str) -> Result<SmtpTransport, String> {
    let host = acc.smtp_host.as_str();
    let builder = match acc.smtp_security {
        Security::Tls => SmtpTransport::relay(host).map_err(|e| readable(&e))?,
        Security::Starttls => SmtpTransport::starttls_relay(host).map_err(|e| readable(&e))?,
        Security::None => SmtpTransport::builder_dangerous(host),
    };
    Ok(builder
        .port(acc.smtp_port)
        .credentials(Credentials::new(acc.username.clone(), password.to_string()))
        .timeout(Some(Duration::from_secs(30)))
        .build())
}

pub fn readable(e: &lettre::transport::smtp::Error) -> String {
    if e.is_tls() {
        format!("TLS-Fehler: {e}")
    } else if e.is_timeout() {
        format!("Zeitüberschreitung: {e}")
    } else if e.is_permanent() {
        format!("Server lehnt ab: {e}")
    } else if e.is_client() {
        format!("Client-Fehler: {e}")
    } else {
        e.to_string()
    }
}

/// Sendet die Nachricht; liefert die formatierten Bytes für die Kopie im
/// Gesendet-Ordner zurück.
pub fn send(acc: &Account, password: &str, msg: &Message) -> Result<Vec<u8>, String> {
    let t = transport(acc, password)?;
    t.send(msg).map_err(|e| format!("Versand fehlgeschlagen: {}", readable(&e)))?;
    Ok(msg.formatted())
}

/// Verbindungs-/Login-Test: EHLO + Auth, ohne etwas zu senden.
pub fn test(acc: &Account, password: &str) -> Result<String, String> {
    let t = transport(acc, password)?;
    match t.test_connection() {
        Ok(true) => Ok(format!("OK — {}:{} ({})", acc.smtp_host, acc.smtp_port, sec_label(acc.smtp_security))),
        Ok(false) => Err("Server antwortet nicht".into()),
        Err(e) => Err(if e.is_permanent() {
            format!("Login fehlgeschlagen: {}", readable(&e))
        } else {
            readable(&e)
        }),
    }
}

pub fn sec_label(s: Security) -> &'static str {
    match s {
        Security::Tls => "TLS",
        Security::Starttls => "STARTTLS",
        Security::None => "unverschlüsselt",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn acc() -> Account {
        Account {
            id: "t".into(),
            name: "Max Muster".into(),
            email: "max@lan-solo.test".into(),
            imap_host: "localhost".into(),
            imap_port: 143,
            imap_security: Security::None,
            smtp_host: "localhost".into(),
            smtp_port: 25,
            smtp_security: Security::None,
            username: "max".into(),
            signature: String::new(),
            color: "#38bdf8".into(),
            password_stored: "file".into(),
        }
    }

    fn fmt(d: &Draft) -> String {
        String::from_utf8(build_message(&acc(), d).unwrap().formatted()).unwrap()
    }

    #[test]
    fn plain_only_stays_singlepart() {
        let out = fmt(&Draft { to: "a@lan-solo.test".into(), body: "hallo".into(), ..Default::default() });
        assert!(out.contains("Content-Type: text/plain"));
        assert!(!out.contains("multipart/alternative"));
        assert!(!out.contains("X-Priority"));
        assert!(!out.contains("Reply-To"));
    }

    #[test]
    fn html_goes_multipart_alternative() {
        let out = fmt(&Draft {
            to: "a@lan-solo.test".into(),
            body: "**fett**".into(),
            html: Some("<p><b>fett</b></p>".into()),
            ..Default::default()
        });
        assert!(out.contains("multipart/alternative"));
        assert!(out.contains("text/plain"));
        assert!(out.contains("text/html"));
        assert!(out.contains("<b>fett</b>"));
    }

    #[test]
    fn html_with_attachment_nests_alternative_in_mixed() {
        let dir = std::env::temp_dir().join("mailbox-smtp-test");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.txt");
        std::fs::write(&file, b"x").unwrap();
        let out = fmt(&Draft {
            to: "a@lan-solo.test".into(),
            body: "t".into(),
            html: Some("<p>t</p>".into()),
            attachments: vec![file.to_string_lossy().to_string()],
            ..Default::default()
        });
        let mixed = out.find("multipart/mixed").unwrap();
        let alt = out.find("multipart/alternative").unwrap();
        assert!(mixed < alt);
        assert!(out.contains("a.txt"));
    }

    #[test]
    fn expert_headers() {
        let out = fmt(&Draft {
            to: "a@lan-solo.test".into(),
            reply_to: "Büro <buero@lan-solo.test>".into(),
            priority: "high".into(),
            read_receipt: true,
            ..Default::default()
        });
        assert!(out.contains("Reply-To:"));
        assert!(out.contains("buero@lan-solo.test"));
        assert!(out.contains("X-Priority: 1 (Highest)"));
        assert!(out.contains("Importance: high"));
        assert!(out.contains("Disposition-Notification-To: Max Muster <max@lan-solo.test>"));
        let low = fmt(&Draft { to: "a@lan-solo.test".into(), priority: "low".into(), ..Default::default() });
        assert!(low.contains("X-Priority: 5 (Lowest)"));
    }
}
