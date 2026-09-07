//! Lokaler Cache der zuletzt geladenen Listen-Seite je Konto+Ordner — damit
//! die Liste beim Start sofort steht, bevor der Server geantwortet hat.

use serde::{de::DeserializeOwned, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedPage<T> {
    pub total: u32,
    pub messages: Vec<T>,
}

/// Dateiname: `<cache_dir>/<account>/<ordner, base64url>.json`.
pub fn cache_file(cache_dir: &Path, account_id: &str, folder: &str) -> PathBuf {
    let enc = b64url(folder.as_bytes());
    cache_dir.join(sanitize(account_id)).join(format!("{enc}.json"))
}

pub fn load_cache<T: DeserializeOwned>(path: &Path) -> Option<CachedPage<T>> {
    let data = std::fs::read(path).ok()?;
    serde_json::from_slice(&data).ok()
}

pub fn save_cache<T: Serialize>(path: &Path, page: &CachedPage<T>) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let data = serde_json::to_vec(page).map_err(std::io::Error::other)?;
    std::fs::write(path, data)
}

fn sanitize(s: &str) -> String {
    s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect()
}

fn b64url(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            out.push(T[(n >> 6) as usize & 63] as char);
        }
        if chunk.len() > 2 {
            out.push(T[n as usize & 63] as char);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let dir = std::env::temp_dir().join(format!("mailbox-cache-test-{}", std::process::id()));
        let path = cache_file(&dir, "acc-1", "INBOX/Projekte");
        let page = CachedPage { total: 3, messages: vec![1u32, 2, 3] };
        save_cache(&path, &page).unwrap();
        let back: CachedPage<u32> = load_cache(&path).unwrap();
        assert_eq!(back.total, 3);
        assert_eq!(back.messages, vec![1, 2, 3]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn filename_is_safe() {
        let root = Path::new("root");
        let p = cache_file(root, "a/b", "Ordner mit Leerzeichen/Ü");
        // Plattformneutral über Komponenten prüfen — Windows nutzt Backslashes.
        let rel = p.strip_prefix(root).unwrap();
        let parts: Vec<_> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], "a_b");
        assert!(parts[1].ends_with(".json"));
        assert!(parts[1].chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')));
    }
}
