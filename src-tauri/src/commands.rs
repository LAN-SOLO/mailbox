use crate::accounts::{self, Account, AccountInput};
use crate::imap::ImapSession;
use crate::settings::{self, Settings};
use crate::smtp::{self, Draft};
use crate::state::AppState;
use imap::types::Flag;
use imap_proto::{BodyStructure, NameAttribute};
use mailbox_core::{
    cache_file, decode_utf7, detect_role, load_cache, parse_message, parse_summary_headers,
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
        .map_err(|e| format!("Hintergrund-Task abgebrochen: {e}"))?
}

fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('\\', "\\\\").replace('"', "\\\""))
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
pub fn set_settings(app: AppHandle, st: State<'_, Shared>, settings: Settings) {
    settings::store(&app, &settings);
    *st.settings.lock().unwrap() = settings;
}

// --- accounts ---------------------------------------------------------------

#[tauri::command]
pub fn list_accounts(st: State<'_, Shared>) -> Vec<Account> {
    st.accounts.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_account(st: State<'_, Shared>, input: AccountInput) -> Result<Account, String> {
    if input.email.trim().is_empty() || !input.email.contains('@') {
        return Err("Bitte eine gültige E-Mail-Adresse angeben.".into());
    }
    if input.imap_host.trim().is_empty() || input.smtp_host.trim().is_empty() {
        return Err("IMAP- und SMTP-Server sind Pflichtfelder.".into());
    }
    let mut accounts = st.accounts.lock().unwrap();
    let existing = input.id.as_ref().and_then(|id| accounts.iter().find(|a| &a.id == id).cloned());
    let id = existing
        .as_ref()
        .map(|a| a.id.clone())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let password = input.password.clone().filter(|p| !p.is_empty());
    let stored = match (&password, &existing) {
        (Some(p), _) => accounts::store_password(&st.config_dir, &id, p)?,
        (None, Some(e)) => e.password_stored.clone(),
        (None, None) => "none".into(),
    };
    let mut username = input.username.trim().to_string();
    if username.is_empty() {
        username = input.email.trim().to_string();
    }
    let mut acc = input.into_account(id.clone(), stored);
    acc.username = username;
    acc.email = acc.email.trim().to_string();
    if acc.name.trim().is_empty() {
        acc.name = acc.email.clone();
    }
    if let Some(pos) = accounts.iter().position(|a| a.id == id) {
        accounts[pos] = acc.clone();
    } else {
        accounts.push(acc.clone());
    }
    accounts::store(&st.config_dir, &accounts)?;
    drop(accounts);
    // Neue Zugangsdaten → alte Session verwerfen.
    st.pool.drop_session(&id);
    Ok(acc)
}

#[tauri::command]
pub fn delete_account(st: State<'_, Shared>, account_id: String) -> Result<(), String> {
    st.pool.drop_session(&account_id);
    accounts::delete_password(&st.config_dir, &account_id);
    let mut accounts = st.accounts.lock().unwrap();
    accounts.retain(|a| a.id != account_id);
    accounts::store(&st.config_dir, &accounts)?;
    let _ = std::fs::remove_dir_all(cache_file(&st.cache_dir, &account_id, "x").parent().unwrap());
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
        let existing = input.id.as_ref().and_then(|id| st.account(id).ok());
        let password = match input.password.clone().filter(|p| !p.is_empty()) {
            Some(p) => p,
            None => match &existing {
                Some(e) => accounts::get_password(&st.config_dir, e)?,
                None => return Err("Bitte ein Passwort eingeben.".into()),
            },
        };
        let mut acc = input.into_account("probe".into(), "none".into());
        if acc.username.trim().is_empty() {
            acc.username = acc.email.clone();
        }
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
    blocking(move || st.pool.with(&st, &account_id, |s| s.create(&name))).await
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
    blocking(move || {
        let cache_path = cache_file(&st.cache_dir, &account_id, &folder);
        if !refresh && offset == 0 {
            if let Some(page) = load_cache::<MessageSummary>(&cache_path) {
                return Ok(MessagePage { messages: page.messages, total: page.total, from_cache: true });
            }
        }
        let limit = limit.clamp(1, 500);
        let page = st.pool.with(&st, &account_id, |s| {
            let mb = s.select(&folder)?;
            let total = mb.exists;
            if total == 0 || offset >= total {
                return Ok(MessagePage { messages: vec![], total, from_cache: false });
            }
            let end = total - offset;
            let start = end.saturating_sub(limit - 1).max(1);
            let fetches = s.fetch(format!("{start}:{end}"), SUMMARY_QUERY)?;
            Ok(MessagePage {
                messages: summaries_from_fetches(&fetches, &account_id, &folder),
                total,
                from_cache: false,
            })
        })?;
        if offset == 0 {
            let _ = save_cache(
                &cache_path,
                &CachedPage { total: page.total, messages: page.messages.clone() },
            );
        }
        Ok(page)
    })
    .await
}

fn imap_quoted(q: &str) -> String {
    // IMAP-Strings: Anführungszeichen und Backslash escapen, Zeilenumbrüche raus.
    let cleaned: String = q.chars().filter(|c| *c != '\r' && *c != '\n').collect();
    format!("\"{}\"", cleaned.replace('\\', "\\\\").replace('"', "\\\""))
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
    blocking(move || {
        let q = query.trim();
        if q.is_empty() {
            return Ok(vec![]);
        }
        let qq = imap_quoted(q);
        let criteria = match scope.as_str() {
            "subject" => format!("SUBJECT {qq}"),
            "from" => format!("FROM {qq}"),
            "to" => format!("TO {qq}"),
            "body" => format!("TEXT {qq}"),
            _ => format!("OR OR OR SUBJECT {qq} FROM {qq} TO {qq} TEXT {qq}"),
        };
        st.pool.with(&st, &account_id, |s| {
            s.select(&folder)?;
            // Erst UTF-8 (moderne Server), dann ohne CHARSET.
            let uids = match s.uid_search(format!("CHARSET UTF-8 {criteria}")) {
                Ok(u) => u,
                Err(_) => s.uid_search(&criteria)?,
            };
            let mut uids: Vec<u32> = uids.into_iter().collect();
            uids.sort_unstable_by(|a, b| b.cmp(a));
            uids.truncate(200);
            if uids.is_empty() {
                return Ok(vec![]);
            }
            let fetches = s.uid_fetch(uid_set(&uids), SUMMARY_QUERY)?;
            Ok(summaries_from_fetches(&fetches, &account_id, &folder))
        })
    })
    .await
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
        .ok_or_else(|| "Nachricht nicht gefunden — vielleicht wurde sie inzwischen verschoben.".to_string())
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
        let p = parse_message(&raw).ok_or("Nachricht konnte nicht gelesen werden")?;
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
            other => return Err(format!("Unbekanntes Flag: {other}")),
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
    if s.uid_mv(&set, target).is_ok() {
        return Ok(());
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
    blocking(move || {
        if uids.is_empty() {
            return Ok(());
        }
        st.pool.with(&st, &account_id, |s| {
            let folders = fetch_folders(s, false)?;
            let current_role = folders
                .iter()
                .find(|f| f.name == folder)
                .map(|f| f.role)
                .unwrap_or(FolderRole::Other);
            let trash = find_role(&folders, FolderRole::Trash);
            s.select(&folder)?;
            match (current_role, trash) {
                (FolderRole::Trash, _) | (_, None) => {
                    let set = uid_set(&uids);
                    s.uid_store(&set, "+FLAGS.SILENT (\\Deleted)")?;
                    if s.uid_expunge(&set).is_err() {
                        s.expunge()?;
                    }
                    Ok(())
                }
                (_, Some(trash)) => do_move(s, &uids, &trash),
            }
        })
    })
    .await
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
        let bytes = mailbox_core::attachment_bytes(&raw, index).ok_or("Anhang nicht gefunden")?;
        std::fs::write(&path, bytes).map_err(|e| format!("Speichern fehlgeschlagen: {e}"))
    })
    .await
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

#[tauri::command]
pub async fn send_message(st: State<'_, Shared>, draft: Draft) -> Result<(), String> {
    let st = st.inner().clone();
    blocking(move || {
        let acc = st.account(&draft.account_id)?;
        if mailbox_core::parse_addresses(&draft.to).is_empty()
            && mailbox_core::parse_addresses(&draft.cc).is_empty()
            && mailbox_core::parse_addresses(&draft.bcc).is_empty()
        {
            return Err("Bitte mindestens einen Empfänger angeben.".into());
        }
        let msg = smtp::build_message(&acc, &draft)?;
        let password = accounts::get_password(&st.config_dir, &acc)?;
        let bytes = smtp::send(&acc, &password, &msg)?;
        // Kopie in „Gesendet“ — Fehler hier sind kein Versandfehler.
        let _ = append_to_role(&st, &acc.id, FolderRole::Sent, None, &bytes, vec![Flag::Seen]);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn save_draft(st: State<'_, Shared>, draft: Draft) -> Result<(), String> {
    let st = st.inner().clone();
    blocking(move || {
        let acc = st.account(&draft.account_id)?;
        let msg = smtp::build_message(&acc, &draft)?;
        let bytes = msg.formatted();
        append_to_role(&st, &acc.id, FolderRole::Drafts, Some("Drafts"), &bytes, vec![Flag::Seen, Flag::Draft])?;
        Ok(())
    })
    .await
}

// --- misc -------------------------------------------------------------------

#[tauri::command]
pub fn data_path(st: State<'_, Shared>) -> String {
    st.config_dir.to_string_lossy().to_string()
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfoDto>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(Some(UpdateInfoDto {
            version: update.version.clone(),
            notes: update.body.clone(),
            date: update.date.map(|d| d.to_string()),
        })),
        Ok(None) => Ok(None),
        Err(e) => Err(format!("Update-Prüfung fehlgeschlagen: {e}")),
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Update-Prüfung fehlgeschlagen: {e}"))?
        .ok_or("Kein Update verfügbar")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("Update fehlgeschlagen: {e}"))?;
    app.restart();
}

#[cfg(test)]
mod e2e;
