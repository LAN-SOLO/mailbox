use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FolderRole {
    Inbox,
    Sent,
    Drafts,
    Trash,
    Junk,
    Archive,
    Other,
}

/// Ermittelt die Rolle eines Ordners aus den Special-Use-Attributen
/// (RFC 6154, z. B. `\Sent`) und — falls der Server keine liefert — aus dem
/// Namen (DE/EN-Heuristik auf dem letzten Pfadsegment).
pub fn detect_role(name: &str, delimiter: Option<&str>, attributes: &[String]) -> FolderRole {
    if name.eq_ignore_ascii_case("inbox") {
        return FolderRole::Inbox;
    }
    for a in attributes {
        let a = a.trim_start_matches('\\').to_ascii_lowercase();
        match a.as_str() {
            "inbox" => return FolderRole::Inbox,
            "sent" => return FolderRole::Sent,
            "drafts" => return FolderRole::Drafts,
            "trash" => return FolderRole::Trash,
            "junk" | "spam" => return FolderRole::Junk,
            "archive" | "all" => return FolderRole::Archive,
            _ => {}
        }
    }
    let leaf = match delimiter {
        Some(d) if !d.is_empty() => name.rsplit(d).next().unwrap_or(name),
        _ => name,
    };
    let l = leaf.trim().to_lowercase();
    let full = name.to_lowercase();
    // Gmail-Systemordner liegen unter "[Gmail]/…" — Namen dort sind lokalisiert,
    // die Heuristik unten greift deshalb auf das letzte Segment.
    let _ = full;
    match l.as_str() {
        "sent" | "sent items" | "sent mail" | "sent messages" | "gesendet" | "gesendete objekte"
        | "gesendete elemente" | "gesendete" => FolderRole::Sent,
        "drafts" | "draft" | "entwürfe" | "entwuerfe" => FolderRole::Drafts,
        "trash" | "deleted" | "deleted items" | "deleted messages" | "bin" | "papierkorb"
        | "gelöscht" | "gelöschte elemente" | "gelöschte objekte" => FolderRole::Trash,
        "junk" | "junk e-mail" | "junk email" | "spam" | "spamverdacht" | "unerwünscht" => {
            FolderRole::Junk
        }
        "archive" | "archiv" | "archives" | "all mail" | "alle nachrichten" => FolderRole::Archive,
        _ => FolderRole::Other,
    }
}

/// Dekodiert einen IMAP-Ordnernamen aus Modified-UTF-7 (RFC 3501 §5.1.3)
/// für die Anzeige („&AOQ-“ → „ä“). Ungültige Sequenzen bleiben stehen.
pub fn decode_utf7(name: &str) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+,";
    let mut out = String::new();
    let mut chars = name.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '&' {
            out.push(c);
            continue;
        }
        if chars.peek() == Some(&'-') {
            chars.next();
            out.push('&');
            continue;
        }
        let mut enc = String::new();
        let mut closed = false;
        for d in chars.by_ref() {
            if d == '-' {
                closed = true;
                break;
            }
            enc.push(d);
        }
        let mut bits: u32 = 0;
        let mut nbits = 0;
        let mut bytes = Vec::new();
        let mut valid = closed;
        for e in enc.bytes() {
            match T.iter().position(|&t| t == e) {
                Some(v) => {
                    bits = (bits << 6) | v as u32;
                    nbits += 6;
                    if nbits >= 8 {
                        nbits -= 8;
                        bytes.push(((bits >> nbits) & 0xff) as u8);
                    }
                }
                None => {
                    valid = false;
                    break;
                }
            }
        }
        if !valid || bytes.len() % 2 != 0 {
            out.push('&');
            out.push_str(&enc);
            if closed {
                out.push('-');
            }
            continue;
        }
        let units: Vec<u16> = bytes.chunks(2).map(|p| u16::from_be_bytes([p[0], p[1]])).collect();
        out.push_str(&String::from_utf16_lossy(&units));
    }
    out
}

/// Sortier-Rang: INBOX zuerst, dann die Rollenordner, dann der Rest.
pub fn role_rank(role: FolderRole) -> u8 {
    match role {
        FolderRole::Inbox => 0,
        FolderRole::Sent => 1,
        FolderRole::Drafts => 2,
        FolderRole::Trash => 3,
        FolderRole::Junk => 4,
        FolderRole::Archive => 5,
        FolderRole::Other => 9,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn special_use_wins() {
        assert_eq!(detect_role("Foo", Some("/"), &s(&["\\Sent"])), FolderRole::Sent);
        assert_eq!(detect_role("[Gmail]/Bar", Some("/"), &s(&["\\HasNoChildren", "\\Trash"])), FolderRole::Trash);
        assert_eq!(detect_role("X", None, &s(&["\\Junk"])), FolderRole::Junk);
    }

    #[test]
    fn utf7_decoding() {
        assert_eq!(decode_utf7("Entw&APw-rfe"), "Entwürfe");
        assert_eq!(decode_utf7("Gel&APY-scht"), "Gelöscht");
        assert_eq!(decode_utf7("A&-B"), "A&B");
        assert_eq!(decode_utf7("INBOX/Projekte"), "INBOX/Projekte");
        assert_eq!(decode_utf7("&kaputt"), "&kaputt");
    }

    #[test]
    fn name_heuristics_de_en() {
        assert_eq!(detect_role("INBOX", Some("."), &[]), FolderRole::Inbox);
        assert_eq!(detect_role("INBOX.Gesendet", Some("."), &[]), FolderRole::Sent);
        assert_eq!(detect_role("Sent Items", Some("/"), &[]), FolderRole::Sent);
        assert_eq!(detect_role("INBOX/Entwürfe", Some("/"), &[]), FolderRole::Drafts);
        assert_eq!(detect_role("Papierkorb", None, &[]), FolderRole::Trash);
        assert_eq!(detect_role("Deleted Items", None, &[]), FolderRole::Trash);
        assert_eq!(detect_role("Spam", None, &[]), FolderRole::Junk);
        assert_eq!(detect_role("Junk", None, &[]), FolderRole::Junk);
        assert_eq!(detect_role("Archiv", None, &[]), FolderRole::Archive);
        assert_eq!(detect_role("Projekte/2026", Some("/"), &[]), FolderRole::Other);
    }
}
