use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Security {
    Tls,
    Starttls,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerGuess {
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_security: Security,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_security: Security,
}

impl ServerGuess {
    fn tls(imap: &str, smtp: &str) -> Self {
        ServerGuess {
            imap_host: imap.into(),
            imap_port: 993,
            imap_security: Security::Tls,
            smtp_host: smtp.into(),
            smtp_port: 465,
            smtp_security: Security::Tls,
        }
    }
    fn starttls_smtp(imap: &str, smtp: &str) -> Self {
        ServerGuess {
            imap_host: imap.into(),
            imap_port: 993,
            imap_security: Security::Tls,
            smtp_host: smtp.into(),
            smtp_port: 587,
            smtp_security: Security::Starttls,
        }
    }
}

/// Bekannte Anbieter (Domain → Server). Alles andere fällt auf die
/// `imap.<domain>`/`smtp.<domain>`-Heuristik zurück.
fn preset(domain: &str) -> Option<ServerGuess> {
    Some(match domain {
        "gmail.com" | "googlemail.com" => ServerGuess::tls("imap.gmail.com", "smtp.gmail.com"),
        "outlook.com" | "outlook.de" | "hotmail.com" | "hotmail.de" | "live.com" | "live.de"
        | "msn.com" => ServerGuess::starttls_smtp("outlook.office365.com", "smtp-mail.outlook.com"),
        "gmx.de" | "gmx.net" | "gmx.at" | "gmx.ch" => {
            ServerGuess::starttls_smtp("imap.gmx.net", "mail.gmx.net")
        }
        "web.de" => ServerGuess::starttls_smtp("imap.web.de", "smtp.web.de"),
        "t-online.de" => ServerGuess::tls("secureimap.t-online.de", "securesmtp.t-online.de"),
        "icloud.com" | "me.com" | "mac.com" => {
            ServerGuess::starttls_smtp("imap.mail.me.com", "smtp.mail.me.com")
        }
        "yahoo.com" | "yahoo.de" | "ymail.com" => {
            ServerGuess::tls("imap.mail.yahoo.com", "smtp.mail.yahoo.com")
        }
        "posteo.de" | "posteo.net" => ServerGuess::tls("posteo.de", "posteo.de"),
        "mailbox.org" => ServerGuess::tls("imap.mailbox.org", "smtp.mailbox.org"),
        "ionos.de" | "1und1.de" | "1and1.com" => {
            ServerGuess::starttls_smtp("imap.ionos.de", "smtp.ionos.de")
        }
        "freenet.de" => ServerGuess::starttls_smtp("mx.freenet.de", "mx.freenet.de"),
        "strato.de" => ServerGuess::tls("imap.strato.de", "smtp.strato.de"),
        "kasserver.com" | "all-inkl.com" => ServerGuess::tls("imap.kasserver.com", "smtp.kasserver.com"),
        _ => return None,
    })
}

/// Server-Vorschlag aus der Domain der E-Mail-Adresse.
pub fn guess_servers(email: &str) -> Option<ServerGuess> {
    let domain = email.trim().rsplit('@').next()?.trim().to_lowercase();
    if domain.is_empty() || !domain.contains('.') || email.matches('@').count() != 1 {
        return None;
    }
    Some(preset(&domain).unwrap_or_else(|| {
        ServerGuess::starttls_smtp(&format!("imap.{domain}"), &format!("smtp.{domain}"))
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_provider() {
        let g = guess_servers("Someone@GMAIL.com").unwrap();
        assert_eq!(g.imap_host, "imap.gmail.com");
        assert_eq!(g.smtp_port, 465);
        assert_eq!(g.smtp_security, Security::Tls);
    }

    #[test]
    fn heuristic_fallback() {
        let g = guess_servers("x@example.org").unwrap();
        assert_eq!(g.imap_host, "imap.example.org");
        assert_eq!(g.smtp_host, "smtp.example.org");
        assert_eq!(g.smtp_security, Security::Starttls);
    }

    #[test]
    fn invalid_input() {
        assert!(guess_servers("nope").is_none());
        assert!(guess_servers("a@b").is_none());
        assert!(guess_servers("a@b@c.de").is_none());
    }
}
