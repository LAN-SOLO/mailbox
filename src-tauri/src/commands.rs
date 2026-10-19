use crate::accounts::{self, Account, AccountInput};
use crate::lang::{self, tr};
use crate::imap::ImapSession;
use crate::settings::{self, Settings};
use crate::smtp::{self, Draft, ExtraAttachment, MessageRef, ServerAttachments};
use crate::state::AppState;
use imap::types::Flag;
use imap_proto::{BodyStructure, NameAttribute};
use mailbox_core::{
    cache_file, decode_utf7, detect_role, encode_utf7, load_cache, parse_message, parse_summary_headers,
    role_rank, save_cache, Address, Attachment, CachedPage, FolderRole, ServerGuess,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, State};

// --- DTOs (Vertrag: src/api.ts) --------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub name: String,
    pub delimiter: Option<String>,
    pub display: String,
    pub role: FolderRole,
    pub no_select: bool,
    pub depth: u32,
    pub unread: Option<u32>,
    pub total: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSummary {
    pub uid: u32,
    pub account_id: String,
    pub folder: String,
    pub from: Vec<Address>,
    pub to: Vec<Address>,
    pub subject: String,
    pub date: Option<String>,
    pub seen: bool,
    pub flagged: bool,
    pub answered: bool,
    pub draft: bool,
    pub size: u32,
    pub has_attachments: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageDetail {
    #[serde(flatten)]
    pub summary: MessageSummary,
    pub cc: Vec<Address>,
    pub bcc: Vec<Address>,
    pub reply_to: Vec<Address>,
    pub message_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
    pub text: Option<String>,
    pub html: Option<String>,
    pub attachments: Vec<Attachment>,
    pub headers: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagePage {
    pub messages: Vec<MessageSummary>,
    pub total: u32,
    pub from_cache: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub imap: String,
    pub smtp: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfoDto {
    pub version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

type Shared = Arc<AppState>;

/// Netzwerk-Arbeit vom UI-Thread fernhalten.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("{}: {e}", tr("Hintergrund-Task abgebrochen", "Background task aborted")))?
}

fn quote(name: &str) -> String {
    let cleaned: String = name.chars().filter(|c| *c != '\r' && *c != '\n').collect();
    format!("\"{}\"", cleaned.replace('\\', "\\\\").replace('"', "\\\""))
}

fn uid_set(uids: &[u32]) -> String {
    uids.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",")
}

// --- settings ---------------------------------------------------------------

#[tauri::command]
pub fn get_settings(st: State<'_, Shared>) -> Settings {
    st.settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_settings(app: AppHandle, st: State<'_, Shared>, settings: Settings) -> Result<(), String> {
    let settings = settings.sanitized();
    lang::set(&settings.language);
    *st.settings.lock().unwrap() = settings.clone();
    settings::store(&app, &settings)
        .map_err(|e| format!("{}: {e}", tr("Einstellungen nicht gespeichert", "Settings not saved")))
}

// --- accounts ---------------------------------------------------------------

#[tauri::command]
pub fn list_accounts(st: State<'_, Shared>) -> Vec<Account> {
    st.accounts.lock().unwrap().clone()
}

/// Async: Schlüsselbund-Zugriffe und das Schließen einer laufenden
/// IMAP-Session (wartet, bis deren Befehl fertig ist) blockieren sonst den
/// UI-Thread — synchrone Tauri-Befehle laufen auf dem Hauptthread.
#[tauri::command]
pub async fn save_account(st: State<'_, Shared>, input: AccountInput) -> Result<Account, String> {
    let st = st.inner().clone();
    blocking(move || do_save_account(&st, input)).await
}

pub(crate) fn do_save_account(st: &AppState, input: AccountInput) -> Result<Account, String> {
    let input = validate_input(input)?;
    let existing = {
        let accounts = st.accounts.lock().unwrap();
        input.id.as_ref().and_then(|id| accounts.iter().find(|a| &a.id == id).cloned())
    };
    let id = existing
        .as_ref()
        .map(|a| a.id.clone())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let password = input.password.clone().filter(|p| !p.is_empty());
    // Schlüsselbund ohne gehaltene Kontenliste: eine Rückfrage des Systems
    // („mailbox möchte auf den Schlüsselbund zugreifen“) hielte sonst jeden
    // Befehl auf, der die Liste braucht — auch synchrone auf dem UI-Thread.
    let stored = match (&password, &existing) {
        (Some(p), _) => accounts::store_password(&st.config_dir, &id, p)?,
        (None, Some(e)) => e.password_stored.clone(),
        (None, None) => "none".into(),
    };
    let mut acc = input.into_account(id.clone(), stored);
    if acc.name.trim().is_empty() {
        acc.name = acc.email.clone();
    }
    let mut accounts = st.accounts.lock().unwrap();
    if existing.is_some() && !accounts.iter().any(|a| a.id == id) {
        // Währenddessen gelöscht: nicht wieder anlegen.
        drop(accounts);
        accounts::delete_password(&st.config_dir, &id);
        return Err(tr("Konto nicht gefunden", "Account not found"));
    }
    let before = accounts.clone();
    if let Some(pos) = accounts.iter().position(|a| a.id == id) {
        accounts[pos] = acc.clone();
    } else {
        accounts.push(acc.clone());
    }
    if let Err(e) = accounts::store(&st.config_dir, &accounts) {
        // Speicher und Datei nicht auseinanderlaufen lassen.
        *accounts = before;
        if existing.is_none() && password.is_some() {
            accounts::delete_password(&st.config_dir, &id);
        }
        return Err(format!("{}: {e}", tr("Konto nicht gespeichert", "Account not saved")));
    }
    drop(accounts);
    // Neue Zugangsdaten → alte Session verwerfen.
    st.pool.drop_session(&id);
    Ok(acc)
}

/// Eingaben des Konto-Dialogs prüfen und normalisieren (getrimmt,
/// Benutzername = Adresse, wenn leer). Hostnamen ohne Leerzeichen/Schema,
/// Ports 1–65535.
pub(crate) fn validate_input(mut input: AccountInput) -> Result<AccountInput, String> {
    input.email = input.email.trim().to_string();
    input.name = input.name.trim().to_string();
    input.imap_host = input.imap_host.trim().to_string();
    input.smtp_host = input.smtp_host.trim().to_string();
    input.username = input.username.trim().to_string();
    if input.username.is_empty() {
        input.username = input.email.clone();
    }
    match mailbox_core::parse_addresses_strict(&input.email) {
        Ok(list) if list.len() == 1 && list[0].email == input.email => {}
        _ => return Err(tr("Bitte eine gültige E-Mail-Adresse angeben.", "Please enter a valid e-mail address.")),
    }
    for host in [&input.imap_host, &input.smtp_host] {
        if host.is_empty() {
            return Err(tr("IMAP- und SMTP-Server sind Pflichtfelder.", "IMAP and SMTP server are required."));
        }
        if host.contains(|c: char| c.is_whitespace() || c.is_control() || matches!(c, '/' | '@' | '\\')) {
            return Err(format!(
                "{} „{host}“ — {}",
                tr("Ungültiger Servername", "Invalid server name"),
                tr("nur der Hostname, z. B. imap.example.org", "host name only, e.g. imap.example.org")
            ));
        }
    }
    if input.imap_port == 0 || input.smtp_port == 0 {
        return Err(tr("Ports müssen zwischen 1 und 65535 liegen.", "Ports must be between 1 and 65535."));
    }
    Ok(input)
}

#[tauri::command]
pub async fn delete_account(st: State<'_, Shared>, account_id: String) -> Result<(), String> {
    let st = st.inner().clone();
    blocking(move || do_delete_account(&st, &account_id)).await
}

/// Erst aus der Liste nehmen (laufende und neue Befehle finden das Konto
/// dann nicht mehr), dann die Session schließen — `drop_session` wartet auf
/// einen gerade laufenden Befehl —, zuletzt Passwort und Cache löschen.
pub(crate) fn do_delete_account(st: &AppState, account_id: &str) -> Result<(), String> {
    {
        let mut accounts = st.accounts.lock().unwrap();
        let before = accounts.clone();
        accounts.retain(|a| a.id != account_id);
        if let Err(e) = accounts::store(&st.config_dir, &accounts) {
            *accounts = before;
            return Err(format!("{}: {e}", tr("Konto nicht entfernt", "Account not removed")));
        }
    }
    st.pool.drop_session(account_id);
    accounts::delete_password(&st.config_dir, account_id);
    if let Some(dir) = cache_file(&st.cache_dir, account_id, "x").parent() {
        let _ = std::fs::remove_dir_all(dir);
    }
    Ok(())
}

#[tauri::command]
pub fn guess_servers(email: String) -> Option<ServerGuess> {
    mailbox_core::guess_servers(&email)
}

#[tauri::command]
pub async fn test_account(st: State<'_, Shared>, input: AccountInput) -> Result<TestResult, String> {
    let st = st.inner().clone();
    blocking(move || {
        let input = validate_input(input)?;
        let existing = input.id.as_ref().and_then(|id| st.account(id).ok());
        let password = match input.password.clone().filter(|p| !p.is_empty()) {
            Some(p) => p,
            None => match &existing {
                Some(e) => accounts::get_password(&st.config_dir, e)?,
                None => return Err(tr("Bitte ein Passwort eingeben.", "Please enter a password.")),
            },
        };
        let acc = input.into_account("probe".into(), "none".into());
        let imap = {
            let mut session = crate::imap::connect(&acc, &password)?;
            let caps = session.capabilities().map(|c| c.iter().count()).unwrap_or(0);
            let _ = session.logout();
            format!(
                "OK — {}:{} ({}, {} Capabilities)",
                acc.imap_host,
                acc.imap_port,
                smtp::sec_label(acc.imap_security),
                caps
            )
        };
        let smtp = smtp::test(&acc, &password)?;
        Ok(TestResult { imap, smtp })
    })
    .await
}

// --- folders ----------------------------------------------------------------

fn attr_name(a: &NameAttribute<'_>) -> String {
    match a {
        NameAttribute::NoInferiors => "\\NoInferiors".into(),
        NameAttribute::NoSelect => "\\NoSelect".into(),
        NameAttribute::Marked => "\\Marked".into(),
        NameAttribute::Unmarked => "\\Unmarked".into(),
        NameAttribute::All => "\\All".into(),
        NameAttribute::Archive => "\\Archive".into(),
        NameAttribute::Drafts => "\\Drafts".into(),
        NameAttribute::Flagged => "\\Flagged".into(),
        NameAttribute::Junk => "\\Junk".into(),
        NameAttribute::Sent => "\\Sent".into(),
        NameAttribute::Trash => "\\Trash".into(),
        NameAttribute::Extension(s) => s.to_string(),
        _ => String::new(),
    }
}

fn fetch_folders(session: &mut ImapSession, with_status: bool) -> imap::Result<Vec<Folder>> {
    let names = session.list(Some(""), Some("*"))?;
    let mut out: Vec<Folder> = names
        .iter()
        .map(|n| {
            let attrs: Vec<String> = n.attributes().iter().map(attr_name).collect();
            let delimiter = n.delimiter().map(String::from);
            let name = n.name().to_string();
            let leaf = match delimiter.as_deref() {
                Some(d) if !d.is_empty() => name.rsplit(d).next().unwrap_or(&name).to_string(),
                _ => name.clone(),
            };
            let depth = match delimiter.as_deref() {
                Some(d) if !d.is_empty() => name.matches(d).count() as u32,
                _ => 0,
            };
            Folder {
                role: detect_role(&name, delimiter.as_deref(), &attrs),
                no_select: n.attributes().iter().any(|a| matches!(a, NameAttribute::NoSelect)),
                display: decode_utf7(&leaf),
                delimiter,
                depth,
                name,
                unread: None,
                total: None,
            }
        })
        .collect();
    // Rollenordner nur einmal: der erste Treffer je Rolle behält sie.
    let mut seen_roles: Vec<FolderRole> = Vec::new();
    for f in out.iter_mut() {
        if f.role != FolderRole::Other {
            if seen_roles.contains(&f.role) {
                f.role = FolderRole::Other;
            } else {
                seen_roles.push(f.role);
            }
        }
    }
    out.sort_by(|a, b| {
        role_rank(a.role)
            .cmp(&role_rank(b.role))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    if with_status {
        for f in out.iter_mut().filter(|f| !f.no_select) {
            if let Ok(mb) = session.status(&f.name, "(MESSAGES UNSEEN)") {
                f.total = Some(mb.exists);
                f.unread = mb.unseen;
            }
        }
    }
    Ok(out)
}

fn find_role(folders: &[Folder], role: FolderRole) -> Option<String> {
    folders.iter().find(|f| f.role == role && !f.no_select).map(|f| f.name.clone())
}

#[tauri::command]
pub async fn list_folders(
    st: State<'_, Shared>,
    account_id: String,
    with_status: bool,
) -> Result<Vec<Folder>, String> {
    let st = st.inner().clone();
    blocking(move || st.pool.with(&st, &account_id, |s| fetch_folders(s, with_status))).await
}

#[tauri::command]
pub async fn create_folder(st: State<'_, Shared>, account_id: String, name: String) -> Result<(), String> {
    let st = st.inner().clone();
    blocking(move || do_create_folder(&st, &account_id, &name)).await
}

/// Ordnernamen kommen als Unicode aus der UI und gehen als Modified-UTF-7
/// an den Server („Entwürfe“ → „Entw&APw-rfe“).
pub(crate) fn do_create_folder(st: &AppState, account_id: &str, name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() || name.contains(['\r', '\n']) {
        return Err(tr("Bitte einen Ordnernamen angeben.", "Please enter a folder name."));
    }
    let encoded = encode_utf7(name);
    st.pool.with(st, account_id, |s| s.create(&encoded))
}

#[tauri::command]
pub async fn delete_folder(st: State<'_, Shared>, account_id: String, name: String) -> Result<(), String> {
    let st = st.inner().clone();
    blocking(move || {
        st.pool.with(&st, &account_id, |s| {
            // Ein selektierter Ordner lässt sich nicht löschen — vorher wegwechseln.
            let _ = s.examine("INBOX");
            s.delete(&name)
        })
    })
    .await
}

// --- messages ---------------------------------------------------------------

const SUMMARY_QUERY: &str =
    "(UID FLAGS RFC822.SIZE INTERNALDATE BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)])";

fn structure_has_attachment(bs: &BodyStructure<'_>) -> bool {
    match bs {
        BodyStructure::Multipart { bodies, .. } => bodies.iter().any(structure_has_attachment),
        BodyStructure::Message { .. } => true,
        BodyStructure::Text { common, .. } => common
            .disposition
            .as_ref()
            .map(|d| d.ty.eq_ignore_ascii_case("attachment"))
            .unwrap_or(false),
        BodyStructure::Basic { common, .. } => {
            let ty = common.ty.ty.to_ascii_lowercase();
            let sub = common.ty.subtype.to_ascii_lowercase();
            let is_sig = ty == "application" && (sub == "pgp-signature" || sub == "pkcs7-signature");
            !is_sig
        }
    }
}

fn summaries_from_fetches(
    fetches: &imap::types::Fetches,
    account_id: &str,
    folder: &str,
) -> Vec<MessageSummary> {
    let mut out: Vec<MessageSummary> = fetches
        .iter()
        .map(|f| {
            let hdr = f.header().map(parse_summary_headers).unwrap_or_default();
            let flags = f.flags();
            let date = hdr
                .date
                .clone()
                .or_else(|| f.internal_date().map(|d| d.to_rfc3339()));
            MessageSummary {
                uid: f.uid.unwrap_or(0),
                account_id: account_id.to_string(),
                folder: folder.to_string(),
                from: hdr.from,
                to: hdr.to,
                subject: hdr.subject,
                date,
                seen: flags.contains(&Flag::Seen),
                flagged: flags.contains(&Flag::Flagged),
                answered: flags.contains(&Flag::Answered),
                draft: flags.contains(&Flag::Draft),
                size: f.size.unwrap_or(0),
                has_attachments: f.bodystructure().map(structure_has_attachment).unwrap_or(false),
            }
        })
        .collect();
    out.sort_by_key(|m| std::cmp::Reverse(m.uid));
    out
}

#[tauri::command]
pub async fn list_messages(
    st: State<'_, Shared>,
    account_id: String,
    folder: String,
    offset: u32,
    limit: u32,
    refresh: bool,
) -> Result<MessagePage, String> {
    let st = st.inner().clone();
    blocking(move || do_list(&st, &account_id, &folder, offset, limit, refresh)).await
}

pub(crate) fn do_list(
    st: &AppState,
    account_id: &str,
    folder: &str,
    offset: u32,
    limit: u32,
    refresh: bool,
) -> Result<MessagePage, String> {
    {
        let cache_path = cache_file(&st.cache_dir, account_id, folder);
        if !refresh && offset == 0 {
            if let Some(page) = load_cache::<MessageSummary>(&cache_path) {
                return Ok(MessagePage { messages: page.messages, total: page.total, from_cache: true });
            }
        }
        let limit = limit.clamp(1, 500);
        let page = st.pool.with(st, account_id, |s| {
            let mb = s.select(folder)?;
            let total = mb.exists;
            if total == 0 || offset >= total {
                return Ok(MessagePage { messages: vec![], total, from_cache: false });
            }
            let end = total - offset;
            let start = end.saturating_sub(limit - 1).max(1);
            let fetches = s.fetch(format!("{start}:{end}"), SUMMARY_QUERY)?;
            Ok(MessagePage {
                messages: summaries_from_fetches(&fetches, account_id, folder),
                total,
                from_cache: false,
            })
        })?;
        // Konto inzwischen gelöscht → keinen Cache neu anlegen (Betreffzeilen
        // eines entfernten Kontos blieben sonst unverschlüsselt liegen).
        if offset == 0 && st.account(account_id).is_ok() {
            let _ = save_cache(
                &cache_path,
                &CachedPage { total: page.total, messages: page.messages.clone() },
            );
        }
        Ok(page)
    }
}

fn imap_quoted(q: &str) -> String {
    // IMAP-Strings: Anführungszeichen und Backslash escapen, Zeilenumbrüche raus.
    let cleaned: String = q.chars().filter(|c| *c != '\r' && *c != '\n').collect();
    format!("\"{}\"", cleaned.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Suchbegriff als IMAP-String. Quoted Strings dürfen laut RFC 3501 nur
/// 7-Bit enthalten — Umlaute in Anführungszeichen findet ein strikter
/// Server (z. B. GreenMail, im Test nachgewiesen) schlicht nicht. Nicht-ASCII
/// geht deshalb als nicht-synchrones Literal `{n+}` (LITERAL+/LITERAL-,
/// RFC 7888 — Gmail, Outlook, Dovecot, GreenMail). Synchrone Literale kann
/// die imap-Bibliothek für SEARCH nicht; ohne LITERAL+ bleibt es beim
/// 8-Bit-Quoted-String, den nachsichtige Server akzeptieren.
fn imap_search_string(q: &str, literal_plus: bool) -> String {
    let cleaned: String = q.chars().filter(|c| *c != '\r' && *c != '\n').collect();
    if cleaned.is_ascii() || !literal_plus {
        return imap_quoted(&cleaned);
    }
    format!("{{{}+}}\r\n{cleaned}", cleaned.len())
}

/// Suchkriterien je Suchbereich (Betreff, Absender, Empfänger, Text, alles).
fn search_criteria(scope: &str, q: &str, literal_plus: bool) -> String {
    let qq = imap_search_string(q, literal_plus);
    let c = match scope {
        "subject" => format!("SUBJECT {qq}"),
        "from" => format!("FROM {qq}"),
        "to" => format!("TO {qq}"),
        "body" => format!("TEXT {qq}"),
        _ => format!("OR OR OR SUBJECT {qq} FROM {qq} TO {qq} TEXT {qq}"),
    };
    if q.is_ascii() {
        c
    } else {
        format!("CHARSET UTF-8 {c}")
    }
}

#[tauri::command]
pub async fn search_messages(
    st: State<'_, Shared>,
    account_id: String,
    folder: String,
    query: String,
    scope: String,
) -> Result<Vec<MessageSummary>, String> {
    let st = st.inner().clone();
    blocking(move || do_search(&st, &account_id, &folder, &query, &scope)).await
}

pub(crate) fn do_search(
    st: &AppState,
    account_id: &str,
    folder: &str,
    query: &str,
    scope: &str,
) -> Result<Vec<MessageSummary>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    // Suchbegriffe sind kurz; überlange Eingaben kappen (auch für LITERAL-).
    let q: String = q.chars().take(1000).collect();
    st.pool.with(st, account_id, |s| {
        let literal_plus = s
            .capabilities()
            .map(|c| c.has_str("LITERAL+") || c.has_str("LITERAL-"))
            .unwrap_or(false);
        s.select(folder)?;
        let uids = s.uid_search(search_criteria(scope, &q, literal_plus))?;
        let mut uids: Vec<u32> = uids.into_iter().collect();
        uids.sort_unstable_by(|a, b| b.cmp(a));
        uids.truncate(200);
        if uids.is_empty() {
            return Ok(vec![]);
        }
        let fetches = s.uid_fetch(uid_set(&uids), SUMMARY_QUERY)?;
        Ok(summaries_from_fetches(&fetches, account_id, folder))
    })
}

type RawMessage = (Vec<u8>, Vec<Flag<'static>>, u32, Option<String>);

fn fetch_raw(s: &mut ImapSession, folder: &str, uid: u32) -> imap::Result<Option<RawMessage>> {
    s.select(folder)?;
    let fetches = s.uid_fetch(uid.to_string(), "(UID FLAGS RFC822.SIZE INTERNALDATE BODY.PEEK[])")?;
    let Some(f) = fetches.iter().next() else {
        return Ok(None);
    };
    let body = f.body().map(|b| b.to_vec()).unwrap_or_default();
    let flags: Vec<Flag<'static>> = f.flags().iter().map(|fl| fl.clone().into_owned()).collect();
    Ok(Some((body, flags, f.size.unwrap_or(0), f.internal_date().map(|d| d.to_rfc3339()))))
}

fn fetch_raw_or_err(st: &AppState, account_id: &str, folder: &str, uid: u32) -> Result<RawMessage, String> {
    st.pool
        .with(st, account_id, |s| fetch_raw(s, folder, uid))?
        .ok_or_else(|| {
            tr(
                "Nachricht nicht gefunden — vielleicht wurde sie inzwischen verschoben.",
                "Message not found — it may have been moved in the meantime.",
            )
        })
}

#[tauri::command]
pub async fn get_message(
    st: State<'_, Shared>,
    account_id: String,
    folder: String,
    uid: u32,
) -> Result<MessageDetail, String> {
    let st = st.inner().clone();
    blocking(move || {
        let (raw, flags, size, internal) = fetch_raw_or_err(&st, &account_id, &folder, uid)?;
        let p = parse_message(&raw).ok_or_else(|| tr("Nachricht konnte nicht gelesen werden", "Message could not be parsed"))?;
        Ok(MessageDetail {
            summary: MessageSummary {
                uid,
                account_id: account_id.clone(),
                folder: folder.clone(),
                from: p.from,
                to: p.to,
                subject: p.subject,
                date: p.date.or(internal),
                seen: flags.contains(&Flag::Seen),
                flagged: flags.contains(&Flag::Flagged),
                answered: flags.contains(&Flag::Answered),
                draft: flags.contains(&Flag::Draft),
                size: if size > 0 { size } else { raw.len() as u32 },
                has_attachments: p.attachments.iter().any(|a| !a.inline),
            },
            cc: p.cc,
            bcc: p.bcc,
            reply_to: p.reply_to,
            message_id: p.message_id,
            in_reply_to: p.in_reply_to,
            references: p.references,
            text: p.text,
            html: p.html,
            attachments: p.attachments,
            headers: p.headers,
        })
    })
    .await
}

#[tauri::command]
pub async fn get_message_source(
    st: State<'_, Shared>,
    account_id: String,
    folder: String,
    uid: u32,
) -> Result<String, String> {
    let st = st.inner().clone();
    blocking(move || {
        let (raw, ..) = fetch_raw_or_err(&st, &account_id, &folder, uid)?;
        Ok(String::from_utf8_lossy(&raw).into_owned())
    })
    .await
}

#[tauri::command]
pub async fn set_flag(
    st: State<'_, Shared>,
    account_id: String,
    folder: String,
    uids: Vec<u32>,
    flag: String,
    value: bool,
) -> Result<(), String> {
    let st = st.inner().clone();
    blocking(move || {
        if uids.is_empty() {
            return Ok(());
        }
        let imap_flag = match flag.as_str() {
            "seen" => "\\Seen",
            "flagged" => "\\Flagged",
            "answered" => "\\Answered",
            other => return Err(format!("{}: {other}", tr("Unbekanntes Flag", "Unknown flag"))),
        };
        let op = if value { "+FLAGS.SILENT" } else { "-FLAGS.SILENT" };
        st.pool.with(&st, &account_id, |s| {
            s.select(&folder)?;
            s.uid_store(uid_set(&uids), format!("{op} ({imap_flag})"))?;
            Ok(())
        })
    })
    .await
}

fn do_move(s: &mut ImapSession, uids: &[u32], target: &str) -> imap::Result<()> {
    let set = uid_set(uids);
    match s.uid_mv(&set, target) {
        Ok(()) => return Ok(()),
        // Nur „kann ich nicht“ (kein MOVE) fällt auf COPY zurück — nach einem
        // Verbindungsfehler weiß niemand, ob das MOVE schon durch ist.
        Err(imap::Error::No(_) | imap::Error::Bad(_)) => {}
        Err(e) => return Err(e),
    }
    s.uid_copy(&set, quote(target))?;
    s.uid_store(&set, "+FLAGS.SILENT (\\Deleted)")?;
    if s.uid_expunge(&set).is_err() {
        s.expunge()?;
    }
    Ok(())
}

#[tauri::command]
pub async fn move_messages(
    st: State<'_, Shared>,
    account_id: String,
    folder: String,
    uids: Vec<u32>,
    target: String,
) -> Result<(), String> {
    let st = st.inner().clone();
    blocking(move || {
        if uids.is_empty() || folder == target {
            return Ok(());
        }
        st.pool.with(&st, &account_id, |s| {
            s.select(&folder)?;
            do_move(s, &uids, &target)
        })
    })
    .await
}

#[tauri::command]
pub async fn delete_messages(
    st: State<'_, Shared>,
    account_id: String,
    folder: String,
    uids: Vec<u32>,
) -> Result<(), String> {
    let st = st.inner().clone();
    blocking(move || do_delete(&st, &account_id, &folder, &uids)).await
}

/// In den Papierkorb verschieben — im Papierkorb selbst (oder ohne
/// Papierkorb) endgültig löschen.
pub(crate) fn do_delete(st: &AppState, account_id: &str, folder: &str, uids: &[u32]) -> Result<(), String> {
    {
        if uids.is_empty() {
            return Ok(());
        }
        st.pool.with(st, account_id, |s| {
            let folders = fetch_folders(s, false)?;
            let current_role = folders
                .iter()
                .find(|f| f.name == folder)
                .map(|f| f.role)
                .unwrap_or(FolderRole::Other);
            let trash = find_role(&folders, FolderRole::Trash);
            s.select(folder)?;
            match (current_role, trash) {
                (FolderRole::Trash, _) | (_, None) => expunge_uids(s, uids),
                (_, Some(trash)) => do_move(s, uids, &trash),
            }
        })
    }
}

/// \Deleted setzen und genau diese UIDs entfernen (UIDPLUS); ohne UIDPLUS
/// bleibt nur EXPUNGE auf den ganzen Ordner.
fn expunge_uids(s: &mut ImapSession, uids: &[u32]) -> imap::Result<()> {
    let set = uid_set(uids);
    s.uid_store(&set, "+FLAGS.SILENT (\\Deleted)")?;
    if s.uid_expunge(&set).is_err() {
        s.expunge()?;
    }
    Ok(())
}

#[tauri::command]
pub async fn empty_folder(st: State<'_, Shared>, account_id: String, folder: String) -> Result<(), String> {
    let st = st.inner().clone();
    blocking(move || {
        st.pool.with(&st, &account_id, |s| {
            let mb = s.select(&folder)?;
            if mb.exists == 0 {
                return Ok(());
            }
            s.store("1:*", "+FLAGS.SILENT (\\Deleted)")?;
            s.expunge()?;
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn save_attachment(
    st: State<'_, Shared>,
    account_id: String,
    folder: String,
    uid: u32,
    index: usize,
    path: String,
) -> Result<(), String> {
    let st = st.inner().clone();
    blocking(move || {
        let (raw, ..) = fetch_raw_or_err(&st, &account_id, &folder, uid)?;
        let bytes = mailbox_core::attachment_bytes(&raw, index)
            .ok_or_else(|| tr("Anhang nicht gefunden", "Attachment not found"))?;
        write_file_safely(std::path::Path::new(&path), &bytes)
    })
    .await
}

/// Datei erst neben dem Ziel schreiben, dann umbenennen: ein Abbruch
/// hinterlässt nie eine halbe Datei unter dem gewählten Namen, und eine
/// bestehende Datei bleibt bis zum Schluss heil. Die Umbenennung wiederholt
/// kurz bei Windows-Sperren (Virenscanner, OneDrive).
pub(crate) fn write_file_safely(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let fail = |e: std::io::Error| {
        let hint = if accounts::is_transient_lock(e.raw_os_error()) && cfg!(windows) {
            format!(
                " — {}",
                tr(
                    "die Datei ist vermutlich in einem anderen Programm geöffnet",
                    "the file is probably open in another program"
                )
            )
        } else {
            String::new()
        };
        format!("{}: {e}{hint}", tr("Speichern fehlgeschlagen", "Saving failed"))
    };
    // Temp-Name kurz halten (lange Anhangsnamen + Zusatz sprengten sonst die
    // 255er-Grenze von APFS/NTFS) und je Aufruf eindeutig (zwei gleichzeitige
    // Speichervorgänge in denselben Ordner).
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let short: String = path
        .file_name()
        .map(|n| n.to_string_lossy().chars().take(32).collect())
        .unwrap_or_default();
    let tmp = path.with_file_name(format!(".{short}.mailbox-{}-{seq}.part", std::process::id()));
    let res = (|| {
        let mut f = match std::fs::File::create(&tmp) {
            Ok(f) => f,
            // Nur die gewählte Datei ist freigegeben, nicht der Ordner (macOS-
            // Datenschutz für Downloads/Dokumente/Schreibtisch nach „Nein“,
            // Ablagen mit reinem Schreibrecht auf die Datei): direkt schreiben
            // wie bis 1.0 — besser als gar nicht speichern.
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => return std::fs::write(path, bytes),
            Err(e) => return Err(e),
        };
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        accounts::rename_retry(&tmp, path)
    })();
    if let Err(e) = res {
        let _ = std::fs::remove_file(&tmp);
        return Err(fail(e));
    }
    Ok(())
}

// --- compose ----------------------------------------------------------------

fn append_to_role(
    st: &AppState,
    account_id: &str,
    role: FolderRole,
    create_name: Option<&str>,
    bytes: &[u8],
    flags: Vec<Flag<'static>>,
) -> Result<bool, String> {
    st.pool.with(st, account_id, |s| {
        let folders = fetch_folders(s, false)?;
        let target = match find_role(&folders, role) {
            Some(t) => t,
            None => match create_name {
                Some(n) => {
                    s.create(n)?;
                    n.to_string()
                }
                None => return Ok(false),
            },
        };
        s.append(&target, bytes).flags(flags.clone()).finish()?;
        Ok(true)
    })
}

/// Anhänge einer Nachricht auf dem Server laden (Weiterleiten mit Anhängen,
/// Entwurf fortsetzen). Dateinamen sind bereits entschärft (core).
pub(crate) fn load_server_attachments(
    st: &AppState,
    account_id: &str,
    src: &ServerAttachments,
) -> Result<Vec<ExtraAttachment>, String> {
    if src.indices.is_empty() {
        return Ok(vec![]);
    }
    let account_id = src.account_id.as_deref().filter(|a| !a.is_empty()).unwrap_or(account_id);
    let (raw, ..) = fetch_raw_or_err(st, account_id, &src.folder, src.uid)?;
    let parsed = parse_message(&raw).ok_or_else(|| tr("Nachricht konnte nicht gelesen werden", "Message could not be parsed"))?;
    let mut out = Vec::new();
    for &i in &src.indices {
        let meta = parsed
            .attachments
            .iter()
            .find(|a| a.index == i)
            .ok_or_else(|| tr("Anhang nicht gefunden", "Attachment not found"))?;
        let bytes = mailbox_core::attachment_bytes(&raw, i)
            .ok_or_else(|| tr("Anhang nicht gefunden", "Attachment not found"))?;
        out.push(ExtraAttachment { filename: meta.filename.clone(), mime: meta.mime.clone(), bytes });
    }
    Ok(out)
}

/// Alten Entwurf entfernen, nachdem er ersetzt (gespeichert/gesendet) wurde.
/// Nur Nachrichten mit \Draft-Flag — ein falscher Verweis löscht so keine
/// gewöhnliche Mail.
fn remove_draft(st: &AppState, account_id: &str, r: &MessageRef) -> Result<(), String> {
    let account_id = r.account_id.as_deref().filter(|a| !a.is_empty()).unwrap_or(account_id);
    st.pool.with(st, account_id, |s| {
        s.select(&r.folder)?;
        let fetches = s.uid_fetch(r.uid.to_string(), "(UID FLAGS)")?;
        let is_draft = fetches.iter().any(|f| f.flags().contains(&Flag::Draft));
        if !is_draft {
            return Ok(());
        }
        expunge_uids(s, &[r.uid])
    })
}

pub(crate) fn do_send(st: &AppState, draft: &Draft) -> Result<(), String> {
    let acc = st.account(&draft.account_id)?;
    let any = |f: &str| !mailbox_core::parse_addresses(f).is_empty();
    if !any(&draft.to) && !any(&draft.cc) && !any(&draft.bcc) {
        return Err(tr("Bitte mindestens einen Empfänger angeben.", "Please enter at least one recipient."));
    }
    let extra = match &draft.server_attachments {
        Some(src) => load_server_attachments(st, &acc.id, src)?,
        None => vec![],
    };
    let msg = smtp::build_message(&acc, draft, &extra, true)?;
    let password = accounts::get_password(&st.config_dir, &acc)?;
    let bytes = smtp::send(&acc, &password, &msg)?;
    // Kopie in „Gesendet“ und alten Entwurf aufräumen — Fehler hier sind
    // kein Versandfehler (die Mail ist raus).
    let _ = append_to_role(st, &acc.id, FolderRole::Sent, None, &bytes, vec![Flag::Seen]);
    if let Some(r) = &draft.replaces_draft {
        let _ = remove_draft(st, &acc.id, r);
    }
    Ok(())
}

pub(crate) fn do_save_draft(st: &AppState, draft: &Draft) -> Result<(), String> {
    let acc = st.account(&draft.account_id)?;
    let extra = match &draft.server_attachments {
        Some(src) => load_server_attachments(st, &acc.id, src)?,
        None => vec![],
    };
    let msg = smtp::build_message(&acc, draft, &extra, false)?;
    let bytes = msg.formatted();
    append_to_role(st, &acc.id, FolderRole::Drafts, Some("Drafts"), &bytes, vec![Flag::Seen, Flag::Draft])?;
    // Erst nach erfolgreichem Speichern den Vorgänger entfernen.
    if let Some(r) = &draft.replaces_draft {
        let _ = remove_draft(st, &acc.id, r);
    }
    Ok(())
}

#[tauri::command]
pub async fn send_message(st: State<'_, Shared>, draft: Draft) -> Result<(), String> {
    let st = st.inner().clone();
    blocking(move || do_send(&st, &draft)).await
}

#[tauri::command]
pub async fn save_draft(st: State<'_, Shared>, draft: Draft) -> Result<(), String> {
    let st = st.inner().clone();
    blocking(move || do_save_draft(&st, &draft)).await
}

// --- misc -------------------------------------------------------------------

#[tauri::command]
pub fn data_path(st: State<'_, Shared>) -> String {
    st.config_dir.to_string_lossy().to_string()
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfoDto>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app
        .updater()
        .map_err(|e| format!("{}: {e}", tr("Update-Prüfung fehlgeschlagen", "Update check failed")))?;
    match updater.check().await {
        Ok(Some(update)) => Ok(Some(UpdateInfoDto {
            version: update.version.clone(),
            notes: update.body.clone(),
            date: update.date.map(|d| d.to_string()),
        })),
        Ok(None) => Ok(None),
        Err(e) => Err(format!("{}: {e}", tr("Update-Prüfung fehlgeschlagen", "Update check failed"))),
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app
        .updater()
        .map_err(|e| format!("{}: {e}", tr("Update fehlgeschlagen", "Update failed")))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("{}: {e}", tr("Update-Prüfung fehlgeschlagen", "Update check failed")))?
        .ok_or_else(|| tr("Kein Update verfügbar", "No update available"))?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("{}: {e}", tr("Update fehlgeschlagen", "Update failed")))?;
    app.restart();
}

#[cfg(test)]
mod e2e;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attachment_written_atomically_with_umlaut_path() {
        let dir = std::env::temp_dir().join(format!("mailbox anhang Ä {}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("Prüfung (final) & Co.pdf");
        write_file_safely(&p, b"alt").unwrap();
        write_file_safely(&p, b"neu").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"neu");
        let left: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(left.len(), 1, "Temp-Datei liegen geblieben: {left:?}");
        // Ziel nicht schreibbar (Ordner) → Fehler mit Text, keine Reste.
        let d = dir.join("ordner");
        std::fs::create_dir_all(d.join("x")).unwrap();
        let err = write_file_safely(&d, b"x").unwrap_err();
        assert!(err.contains("Speichern fehlgeschlagen") || err.contains("Saving failed"), "{err}");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 2);
        // Langer Name (250 Bytes): der Temp-Name darf die 255er-Grenze nicht sprengen.
        let long = dir.join(format!("{}.pdf", "a".repeat(246)));
        write_file_safely(&long, b"lang").unwrap();
        assert_eq!(std::fs::read(&long).unwrap(), b"lang");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 3);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Ordner ohne Schreibrecht, Datei selbst beschreibbar (wie eine per
    /// Dialog freigegebene Datei in einem geschützten Ordner): direkt schreiben.
    #[cfg(unix)]
    #[test]
    fn attachment_falls_back_when_folder_is_not_writable() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("mailbox-ro-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("Rechnung.pdf");
        std::fs::write(&p, b"alt").unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).unwrap();
        let r = write_file_safely(&p, b"neu");
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        r.unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"neu");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_account_removes_from_list_first() {
        let dir = std::env::temp_dir().join(format!("mailbox-del-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let acc = Account {
            id: "x1".into(),
            name: "n".into(),
            email: "a@b.de".into(),
            imap_host: "h".into(),
            imap_port: 993,
            imap_security: mailbox_core::Security::Tls,
            smtp_host: "h".into(),
            smtp_port: 465,
            smtp_security: mailbox_core::Security::Tls,
            username: "a@b.de".into(),
            signature: String::new(),
            color: String::new(),
            password_stored: "none".into(),
        };
        let st = AppState {
            settings: std::sync::Mutex::new(Settings::default()),
            accounts: std::sync::Mutex::new(vec![acc]),
            config_dir: dir.clone(),
            cache_dir: dir.join("cache"),
            pool: crate::imap::SessionPool::default(),
        };
        let cache = cache_file(&st.cache_dir, "x1", "INBOX");
        save_cache(&cache, &CachedPage::<u32> { total: 0, messages: vec![] }).unwrap();
        do_delete_account(&st, "x1").unwrap();
        assert!(st.account("x1").is_err());
        assert!(!cache.exists());
        assert!(accounts::load(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
