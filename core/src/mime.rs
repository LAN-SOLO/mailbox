//! MIME → DTO: parst eine rohe RFC-5322-Nachricht (mail-parser) in die
//! Struktur, die das Frontend anzeigt.

use crate::address::Address;
use base64::Engine;
use mail_parser::{Address as MpAddress, HeaderValue, Message, MessageParser, MimeHeaders, PartType};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    /// Index des Parts in der Nachricht — für das Speichern.
    pub index: usize,
    pub filename: String,
    pub mime: String,
    pub size: usize,
    pub content_id: Option<String>,
    pub inline: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedMessage {
    pub from: Vec<Address>,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub bcc: Vec<Address>,
    pub reply_to: Vec<Address>,
    pub subject: String,
    /// ISO-8601 aus dem Date-Header, sonst None.
    pub date: Option<String>,
    pub message_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
    pub text: Option<String>,
    pub html: Option<String>,
    pub attachments: Vec<Attachment>,
    pub headers: Vec<(String, String)>,
}

/// Nur die Kopfzeilen, die die Liste braucht.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryHeaders {
    pub from: Vec<Address>,
    pub to: Vec<Address>,
    pub subject: String,
    pub date: Option<String>,
}

fn addresses(a: Option<&MpAddress<'_>>) -> Vec<Address> {
    a.map(|a| {
        a.iter()
            .filter_map(|x| x.address().map(|e| Address::new(x.name(), e)))
            .collect()
    })
    .unwrap_or_default()
}

fn header_string(v: &HeaderValue<'_>, raw: Option<&str>) -> String {
    match v {
        HeaderValue::Text(t) => t.to_string(),
        HeaderValue::TextList(l) => l.iter().map(|s| s.as_ref()).collect::<Vec<_>>().join(", "),
        HeaderValue::DateTime(d) => d.to_rfc3339(),
        HeaderValue::Address(a) => addresses(Some(a))
            .iter()
            .map(Address::to_rfc)
            .collect::<Vec<_>>()
            .join(", "),
        _ => unfold(raw.unwrap_or_default()),
    }
}

fn unfold(raw: &str) -> String {
    raw.split(['\r', '\n'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn strip_angle(s: &str) -> String {
    s.trim().trim_start_matches('<').trim_end_matches('>').to_string()
}

fn mime_of(part: &mail_parser::MessagePart<'_>) -> String {
    match part.content_type() {
        Some(ct) => match ct.subtype() {
            Some(sub) => format!("{}/{}", ct.ctype(), sub).to_lowercase(),
            None => ct.ctype().to_lowercase(),
        },
        None => "application/octet-stream".into(),
    }
}

/// Vollständige Nachricht parsen. Gibt `None` zurück, wenn die Bytes keine
/// Mail ergeben.
pub fn parse_message(raw: &[u8]) -> Option<ParsedMessage> {
    let msg: Message<'_> = MessageParser::new().parse(raw)?;
    let mut out = ParsedMessage {
        from: addresses(msg.from()),
        to: addresses(msg.to()),
        cc: addresses(msg.cc()),
        bcc: addresses(msg.bcc()),
        reply_to: addresses(msg.reply_to()),
        subject: msg.subject().unwrap_or_default().to_string(),
        date: msg.date().map(|d| d.to_rfc3339()),
        message_id: msg.message_id().map(strip_angle),
        in_reply_to: match msg.in_reply_to() {
            HeaderValue::Text(t) => Some(strip_angle(t)),
            HeaderValue::TextList(l) => l.first().map(|t| strip_angle(t)),
            _ => None,
        },
        references: match msg.references() {
            HeaderValue::Text(t) => vec![strip_angle(t)],
            HeaderValue::TextList(l) => l.iter().map(|t| strip_angle(t)).collect(),
            _ => vec![],
        },
        ..Default::default()
    };

    // Kopfzeilen in Originalreihenfolge, dekodiert wo möglich.
    let raw_headers: Vec<(String, String)> = msg
        .headers_raw()
        .map(|(n, v)| (n.to_string(), v.to_string()))
        .collect();
    for (i, h) in msg.headers().iter().enumerate() {
        let raw = raw_headers.get(i).map(|(_, v)| v.as_str());
        out.headers.push((h.name().to_string(), header_string(h.value(), raw)));
    }

    out.text = msg.body_text(0).map(|t| t.to_string());
    out.html = msg.body_html(0).map(|t| t.to_string());

    // Anhänge & Inline-Parts (Index = Position in msg.parts).
    let attachment_ids: std::collections::HashSet<usize> = msg.attachments.iter().map(|&i| i as usize).collect();
    let mut inline_parts: Vec<(String, String, Vec<u8>)> = Vec::new();
    for (idx, part) in msg.parts.iter().enumerate() {
        let is_att = attachment_ids.contains(&idx);
        let cid = part.content_id().map(strip_angle);
        let disp_inline = part
            .content_disposition()
            .map(|d| d.ctype().eq_ignore_ascii_case("inline"))
            .unwrap_or(false);
        let binary = matches!(part.body, PartType::Binary(_) | PartType::InlineBinary(_) | PartType::Message(_));
        if !(is_att || (binary && cid.is_some())) {
            continue;
        }
        let mime = mime_of(part);
        let bytes: Vec<u8> = match &part.body {
            PartType::Message(m) => m.raw_message().to_vec(),
            _ => part.contents().to_vec(),
        };
        let filename = part
            .attachment_name()
            .map(String::from)
            .unwrap_or_else(|| default_name(&mime, idx));
        let referenced = cid
            .as_ref()
            .map(|c| out.html.as_deref().map(|h| h.contains(&format!("cid:{c}"))).unwrap_or(false))
            .unwrap_or(false);
        let inline = referenced || (disp_inline && cid.is_some());
        if let (Some(c), true) = (&cid, referenced) {
            inline_parts.push((c.clone(), mime.clone(), bytes.clone()));
        }
        out.attachments.push(Attachment {
            index: idx,
            filename,
            mime,
            size: bytes.len(),
            content_id: cid,
            inline,
        });
    }

    // cid:-Verweise durch data:-URIs ersetzen.
    if let Some(html) = out.html.as_mut() {
        for (cid, mime, bytes) in &inline_parts {
            let data = format!("data:{};base64,{}", mime, base64::engine::general_purpose::STANDARD.encode(bytes));
            *html = html.replace(&format!("cid:{cid}"), &data);
        }
    }

    if out.text.is_none() {
        if let Some(h) = &out.html {
            out.text = Some(html_to_text(h));
        }
    }
    Some(out)
}

/// Rohbytes eines Anhangs (Part-Index aus `Attachment.index`).
pub fn attachment_bytes(raw: &[u8], index: usize) -> Option<Vec<u8>> {
    let msg = MessageParser::new().parse(raw)?;
    let part = msg.parts.get(index)?;
    Some(match &part.body {
        PartType::Message(m) => m.raw_message().to_vec(),
        _ => part.contents().to_vec(),
    })
}

fn default_name(mime: &str, idx: usize) -> String {
    let ext = match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "application/pdf" => "pdf",
        "message/rfc822" => "eml",
        "text/calendar" => "ics",
        _ => "bin",
    };
    format!("attachment-{idx}.{ext}")
}

/// Nur Kopfzeilen (FROM/TO/SUBJECT/DATE) aus einem Header-Block.
pub fn parse_summary_headers(raw: &[u8]) -> SummaryHeaders {
    match MessageParser::new().parse_headers(raw) {
        Some(m) => SummaryHeaders {
            from: addresses(m.from()),
            to: addresses(m.to()),
            subject: m.subject().unwrap_or_default().to_string(),
            date: m.date().map(|d| d.to_rfc3339()),
        },
        None => SummaryHeaders::default(),
    }
}

/// HTML → lesbarer Klartext (Fallback, wenn keine text/plain-Alternative da ist).
pub fn html_to_text(html: &str) -> String {
    mail_parser::decoders::html::html_to_text(html).trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = "From: =?UTF-8?Q?J=C3=BCrgen_M=C3=BCller?= <j@example.de>\r\n\
To: Max <max@x.de>, y@z.de\r\n\
Cc: cc@x.de\r\n\
Subject: =?UTF-8?B?VGVzdCDDnGJlcnNjaHJpZnQ=?=\r\n\
Date: Mon, 07 Sep 2026 10:00:00 +0200\r\n\
Message-ID: <abc@example.de>\r\n\
In-Reply-To: <parent@example.de>\r\n\
References: <root@example.de> <parent@example.de>\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"outer\"\r\n\
\r\n\
--outer\r\n\
Content-Type: multipart/related; boundary=\"rel\"\r\n\
\r\n\
--rel\r\n\
Content-Type: multipart/alternative; boundary=\"alt\"\r\n\
\r\n\
--alt\r\n\
Content-Type: text/plain; charset=utf-8\r\n\
\r\n\
Hallo Welt\r\n\
--alt\r\n\
Content-Type: text/html; charset=utf-8\r\n\
\r\n\
<html><body><p>Hallo <b>Welt</b></p><img src=\"cid:logo123\"></body></html>\r\n\
--alt--\r\n\
--rel\r\n\
Content-Type: image/png\r\n\
Content-ID: <logo123>\r\n\
Content-Disposition: inline; filename=\"logo.png\"\r\n\
Content-Transfer-Encoding: base64\r\n\
\r\n\
iVBORw0KGgo=\r\n\
--rel--\r\n\
--outer\r\n\
Content-Type: application/pdf; name=\"Rechnung.pdf\"\r\n\
Content-Disposition: attachment; filename=\"Rechnung.pdf\"\r\n\
Content-Transfer-Encoding: base64\r\n\
\r\n\
JVBERi0xLjQK\r\n\
--outer--\r\n";

    #[test]
    fn parses_multipart_fixture() {
        let m = parse_message(FIXTURE.as_bytes()).expect("parse");
        assert_eq!(m.subject, "Test Überschrift");
        assert_eq!(m.from[0], Address::new(Some("Jürgen Müller"), "j@example.de"));
        assert_eq!(m.to.len(), 2);
        assert_eq!(m.cc[0].email, "cc@x.de");
        assert_eq!(m.message_id.as_deref(), Some("abc@example.de"));
        assert_eq!(m.in_reply_to.as_deref(), Some("parent@example.de"));
        assert_eq!(m.references, vec!["root@example.de", "parent@example.de"]);
        assert!(m.date.as_deref().unwrap().starts_with("2026-09-07T10:00:00"));
        assert_eq!(m.text.as_deref().map(str::trim), Some("Hallo Welt"));
        let html = m.html.as_deref().unwrap();
        assert!(html.contains("data:image/png;base64,iVBORw0KGgo="), "cid replaced: {html}");
        assert!(!html.contains("cid:"));
        // Anhänge: Inline-Logo + PDF
        let pdf = m.attachments.iter().find(|a| a.filename == "Rechnung.pdf").expect("pdf");
        assert_eq!(pdf.mime, "application/pdf");
        assert!(!pdf.inline);
        assert_eq!(attachment_bytes(FIXTURE.as_bytes(), pdf.index).unwrap(), b"%PDF-1.4\n");
        let logo = m.attachments.iter().find(|a| a.filename == "logo.png").expect("logo");
        assert!(logo.inline);
        assert_eq!(logo.content_id.as_deref(), Some("logo123"));
        // Header-Liste dekodiert
        let subj = m.headers.iter().find(|(n, _)| n == "Subject").unwrap();
        assert_eq!(subj.1, "Test Überschrift");
        assert!(m.headers.iter().any(|(n, _)| n == "Message-ID"));
    }

    #[test]
    fn summary_headers_decode() {
        let s = parse_summary_headers(FIXTURE.as_bytes());
        assert_eq!(s.subject, "Test Überschrift");
        assert_eq!(s.from[0].name.as_deref(), Some("Jürgen Müller"));
        assert!(s.date.is_some());
    }

    #[test]
    fn html_fallback_text() {
        let raw = "From: a@b.c\r\nSubject: x\r\nContent-Type: text/html\r\n\r\n<p>Eins</p><p>Zwei &amp; drei</p>";
        let m = parse_message(raw.as_bytes()).unwrap();
        let t = m.text.unwrap();
        assert!(t.contains("Eins"));
        assert!(t.contains("Zwei & drei"));
    }
}
