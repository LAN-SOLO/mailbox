use serde::{Deserialize, Serialize};

/// Eine E-Mail-Adresse mit optionalem Anzeigenamen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Address {
    pub name: Option<String>,
    pub email: String,
}

impl Address {
    pub fn new(name: Option<&str>, email: &str) -> Self {
        let name = name.map(str::trim).filter(|n| !n.is_empty()).map(String::from);
        Address { name, email: email.trim().to_string() }
    }

    /// RFC-5322-Darstellung „Name <adresse>“ bzw. nur die Adresse.
    pub fn to_rfc(&self) -> String {
        match &self.name {
            Some(n) if !n.is_empty() => {
                if n.chars().any(|c| matches!(c, '"' | ',' | '<' | '>' | '@' | ';' | ':')) {
                    format!("\"{}\" <{}>", n.replace('"', "\\\""), self.email)
                } else {
                    format!("{} <{}>", n, self.email)
                }
            }
            _ => self.email.clone(),
        }
    }
}

/// Zerlegt Freitext („Max Muster <max@x.de>, y@z.de; \"Doe, Jane\" <j@d.org>“)
/// in Adressen. Trennzeichen sind Komma und Semikolon außerhalb von
/// Anführungszeichen und spitzen Klammern; Einträge ohne `@` werden ignoriert.
pub fn parse_addresses(input: &str) -> Vec<Address> {
    split_entries(input).iter().filter_map(|e| parse_single(e)).collect()
}

/// Wie [`parse_addresses`], meldet aber Einträge, die keine Adresse ergeben
/// (Tippfehler wie „max@x.de, anna“), statt sie still zu verwerfen. Der
/// Fehler nennt die verworfenen Einträge.
pub fn parse_addresses_strict(input: &str) -> Result<Vec<Address>, Vec<String>> {
    let mut ok = Vec::new();
    let mut bad = Vec::new();
    for e in split_entries(input) {
        let t = e.trim();
        if t.is_empty() {
            continue;
        }
        match parse_single(t) {
            Some(a) if is_plausible(&a.email) => ok.push(a),
            _ => bad.push(t.to_string()),
        }
    }
    if bad.is_empty() {
        Ok(ok)
    } else {
        Err(bad)
    }
}

/// Grobe Plausibilität: genau ein `@`, nichts Leeres davor/danach, kein
/// Leer- oder Steuerzeichen.
fn is_plausible(email: &str) -> bool {
    let mut parts = email.split('@');
    let (Some(local), Some(domain), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    !local.is_empty()
        && !domain.is_empty()
        && !email.chars().any(|c| c.is_whitespace() || c.is_control() || matches!(c, '<' | '>' | ',' | ';'))
}

fn split_entries(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut in_quotes = false;
    let mut in_angle = false;
    for c in input.chars() {
        match c {
            '"' => {
                in_quotes = !in_quotes;
                buf.push(c);
            }
            '<' if !in_quotes => {
                in_angle = true;
                buf.push(c);
            }
            '>' if !in_quotes => {
                in_angle = false;
                buf.push(c);
            }
            ',' | ';' | '\n' if !in_quotes && !in_angle => {
                out.push(std::mem::take(&mut buf));
            }
            _ => buf.push(c),
        }
    }
    out.push(buf);
    out
}

fn parse_single(raw: &str) -> Option<Address> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if let (Some(lt), Some(gt)) = (raw.rfind('<'), raw.rfind('>')) {
        if lt < gt {
            let email = raw[lt + 1..gt].trim();
            if !email.contains('@') {
                return None;
            }
            let name = raw[..lt].trim().trim_matches('"').replace("\\\"", "\"");
            return Some(Address::new(Some(&name), email));
        }
    }
    let email = raw.trim_matches(|c| c == '"' || c == '\'');
    if email.contains('@') && !email.contains(char::is_whitespace) {
        Some(Address::new(None, email))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mixed_list() {
        let list = parse_addresses("Max Muster <max@x.de>, y@z.de; \"Doe, Jane\" <j@d.org>");
        assert_eq!(list.len(), 3);
        assert_eq!(list[0], Address::new(Some("Max Muster"), "max@x.de"));
        assert_eq!(list[1], Address::new(None, "y@z.de"));
        assert_eq!(list[2], Address::new(Some("Doe, Jane"), "j@d.org"));
    }

    #[test]
    fn ignores_garbage() {
        assert!(parse_addresses("kein-at, , ;").is_empty());
        assert_eq!(parse_addresses("  a@b.c  ").len(), 1);
    }

    #[test]
    fn strict_reports_typos() {
        assert_eq!(parse_addresses_strict("a@b.de, , Max <m@x.de>").unwrap().len(), 2);
        assert_eq!(parse_addresses_strict("").unwrap().len(), 0);
        assert_eq!(parse_addresses_strict("a@b.de, anna").unwrap_err(), vec!["anna".to_string()]);
        assert_eq!(parse_addresses_strict("Max <kein-at>").unwrap_err().len(), 1);
        assert_eq!(parse_addresses_strict("a@@b.de").unwrap_err().len(), 1);
        assert!(parse_addresses_strict("\"Doe, Jane\" <j@d.org>; y@z.de").is_ok());
    }

    #[test]
    fn rfc_rendering_quotes_special_names() {
        assert_eq!(Address::new(Some("Doe, Jane"), "j@d.org").to_rfc(), "\"Doe, Jane\" <j@d.org>");
        assert_eq!(Address::new(Some("Max"), "m@x.de").to_rfc(), "Max <m@x.de>");
        assert_eq!(Address::new(None, "m@x.de").to_rfc(), "m@x.de");
    }
}
