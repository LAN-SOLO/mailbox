//! mailbox core — reine Mail-Logik ohne Tauri: Adressen, Ordner-Rollen,
//! MIME → DTO, Provider-Presets und der lokale Summary-Cache.

pub mod address;
pub mod cache;
pub mod folders;
pub mod mime;
pub mod presets;

pub use address::{parse_addresses, Address};
pub use cache::{cache_file, load_cache, save_cache, CachedPage};
pub use folders::{decode_utf7, detect_role, role_rank, FolderRole};
pub use mime::{attachment_bytes, html_to_text, parse_message, parse_summary_headers, Attachment, ParsedMessage, SummaryHeaders};
pub use presets::{guess_servers, Security, ServerGuess};
