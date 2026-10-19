//! End-to-End gegen einen lokalen IMAP/SMTP-Testserver (z. B. GreenMail):
//!   docker run -d -p 3025:3025 -p 3143:3143 \
//!     -e GREENMAIL_OPTS='-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 \
//!        -Dgreenmail.users=test:pass@lan-solo.test,anna:pass@lan-solo.test' \
//!     greenmail/standalone:2.1.0
//!   cargo test -p mailbox -- --ignored e2e
//! Andere Host-Ports (z. B. wenn 3025/3143 belegt sind):
//!   MAILBOX_E2E_SMTP_PORT=13025 MAILBOX_E2E_IMAP_PORT=13143 cargo test -p mailbox -- --ignored e2e
//! Passwörter kommen aus credentials.json (Datei-Fallback) — der
//! Schlüsselbund bleibt im Test unberührt.

use super::*;
use crate::imap::SessionPool;
use crate::settings::Settings;
use mailbox_core::Security;
use std::sync::Mutex;

fn port(var: &str, default: u16) -> u16 {
    std::env::var(var).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn account(id: &str, user: &str) -> Account {
    Account {
        id: id.into(),
        name: format!("{user} Test"),
        email: format!("{user}@lan-solo.test"),
        imap_host: "localhost".into(),
        imap_port: port("MAILBOX_E2E_IMAP_PORT", 3143),
        imap_security: Security::None,
        smtp_host: "localhost".into(),
        smtp_port: port("MAILBOX_E2E_SMTP_PORT", 3025),
        smtp_security: Security::None,
        username: user.into(),
        signature: "-- \nmailbox e2e".into(),
        color: "#38bdf8".into(),
        password_stored: "file".into(),
    }
}

fn state(accs: Vec<Account>) -> Arc<AppState> {
    let dir = std::env::temp_dir().join(format!("mailbox-e2e-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let creds: std::collections::HashMap<String, String> =
        accs.iter().map(|a| (a.id.clone(), "pass".to_string())).collect();
    std::fs::write(dir.join("credentials.json"), serde_json::to_string(&creds).unwrap()).unwrap();
    Arc::new(AppState {
        settings: Mutex::new(Settings::default()),
        accounts: Mutex::new(accs),
        config_dir: dir.clone(),
        cache_dir: dir.join("cache"),
        pool: SessionPool::default(),
    })
}

fn list(st: &AppState, id: &str, folder: &str) -> Vec<MessageSummary> {
    st.pool
        .with(st, id, |s| {
            let mb = s.select(folder)?;
            if mb.exists == 0 {
                return Ok(vec![]);
            }
            let fetches = s.fetch(format!("1:{}", mb.exists), SUMMARY_QUERY)?;
            Ok(summaries_from_fetches(&fetches, id, folder))
        })
        .unwrap()
}

#[test]
#[ignore]
fn e2e_roundtrip() {
    let st = state(vec![account("t", "test"), account("a", "anna")]);
    let run = format!("{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());

    // --- Seed: zwei Mails per SMTP von anna, eine HTML-Mail mit Anhang per APPEND
    let anna = st.account("a").unwrap();
    let seed = |subject: &str, body: &str| {
        let d = Draft {
            account_id: "a".into(),
            to: "test@lan-solo.test".into(),
            cc: String::new(),
            bcc: String::new(),
            subject: subject.into(),
            body: body.into(),
            attachments: vec![],
            in_reply_to: None,
            references: vec![],
            ..Default::default()
        };
        let m = smtp::build_message(&anna, &d, &[], true).unwrap();
        smtp::send(&anna, "pass", &m).unwrap();
    };
    let s_welcome = format!("Willkommen bei mailbox {run}");
    let s_termin = format!("Re: Terminvorschlag {run}");
    let s_angebot = format!("Angebot Q4 {run}");
    seed(&s_welcome, "Hallo,\n\ndies ist eine Klartext-Testmail mit Umlauten: äöü ß.\n\nViele Grüße\nAnna");
    seed(&s_termin, "Passt mir gut.\n\n> Wie wäre Dienstag?");
    let html_raw = format!(
        "From: =?utf-8?q?Anna_Beispiel?= <anna@lan-solo.test>\r\nTo: test@lan-solo.test\r\nSubject: {s_angebot}\r\nDate: Mon, 07 Sep 2026 10:00:00 +0200\r\nMessage-ID: <angebot-{run}@lan-solo.test>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"b1\"\r\n\r\n--b1\r\nContent-Type: multipart/alternative; boundary=\"b2\"\r\n\r\n--b2\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nAnbei das Angebot.\r\n--b2\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><body><h2>Angebot Q4</h2><p>Anbei das <b>Angebot</b>.</p><img src=\"https://example.com/t.gif\"></body></html>\r\n--b2--\r\n--b1\r\nContent-Type: application/pdf; name=\"Angebot.pdf\"\r\nContent-Disposition: attachment; filename=\"Angebot.pdf\"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQgdGVzdA==\r\n--b1--\r\n"
    );
    st.pool
        .with(&st, "t", |s| s.append("INBOX", html_raw.as_bytes()).finish())
        .unwrap();

    // Ordner: INBOX mit Rolle
    let folders = st.pool.with(&st, "t", |s| fetch_folders(s, true)).unwrap();
    let inbox = folders.iter().find(|f| f.role == FolderRole::Inbox).expect("INBOX");
    assert_eq!(inbox.name, "INBOX");
    assert!(inbox.total.unwrap_or(0) >= 3, "seeded messages expected");

    // Liste: Header dekodiert, Anhang erkannt
    let msgs = list(&st, "t", "INBOX");
    assert!(msgs.len() >= 3);
    let angebot = msgs.iter().find(|m| m.subject == s_angebot).expect("Angebot");
    assert!(angebot.has_attachments);
    assert_eq!(angebot.from[0].name.as_deref(), Some("Anna Beispiel"));
    let welcome = msgs.iter().find(|m| m.subject == s_welcome).unwrap();
    assert!(!welcome.has_attachments);
    assert!(!welcome.seen);
    assert_eq!(welcome.from[0].email, "anna@lan-solo.test");

    // Lesen: Text, HTML, Anhang
    let (raw, _flags, _size, _internal) = fetch_raw_or_err(&st, "t", "INBOX", angebot.uid).unwrap();
    let p = parse_message(&raw).unwrap();
    assert!(p.html.as_deref().unwrap_or("").contains("Angebot Q4"));
    assert!(p.text.as_deref().unwrap_or("").contains("Anbei das Angebot"));
    assert_eq!(p.attachments.len(), 1);
    assert_eq!(p.attachments[0].filename, "Angebot.pdf");
    let (raw, ..) = fetch_raw_or_err(&st, "t", "INBOX", welcome.uid).unwrap();
    let p = parse_message(&raw).unwrap();
    assert!(p.text.unwrap().contains("äöü ß"));

    // Flags
    st.pool
        .with(&st, "t", |s| {
            s.select("INBOX")?;
            s.uid_store(welcome.uid.to_string(), "+FLAGS (\\Seen \\Flagged)")?;
            Ok(())
        })
        .unwrap();
    let again = list(&st, "t", "INBOX");
    let w = again.iter().find(|m| m.uid == welcome.uid).unwrap();
    assert!(w.seen && w.flagged);

    // Suche
    let found = st
        .pool
        .with(&st, "t", |s| {
            s.select("INBOX")?;
            s.uid_search(format!("SUBJECT {}", imap_quoted(&s_termin)))
        })
        .unwrap();
    assert_eq!(found.len(), 1);

    // Senden an anna + Kopie in „Gesendet“
    let s_reply = format!("e2e: Grüße aus mailbox {run}");
    let draft = Draft {
        account_id: "t".into(),
        to: "Anna <anna@lan-solo.test>".into(),
        cc: String::new(),
        bcc: String::new(),
        subject: s_reply.clone(),
        body: "Hallo Anna,\n\ndas ist ein Test.\n\n-- \nmailbox e2e".into(),
        attachments: vec![],
        in_reply_to: Some("<abc@lan-solo.test>".into()),
        references: vec!["<abc@lan-solo.test>".into()],
        ..Default::default()
    };
    let acc = st.account("t").unwrap();
    let msg = smtp::build_message(&acc, &draft, &[], true).unwrap();
    let bytes = smtp::send(&acc, "pass", &msg).unwrap();
    let _ = append_to_role(&st, "t", FolderRole::Sent, None, &bytes, vec![Flag::Seen]).unwrap();
    let anna_inbox = list(&st, "a", "INBOX");
    let got = anna_inbox.iter().find(|m| m.subject == s_reply).expect("delivered");
    assert_eq!(got.from[0].email, "test@lan-solo.test");
    let (raw, ..) = fetch_raw_or_err(&st, "a", "INBOX", got.uid).unwrap();
    let p = parse_message(&raw).unwrap();
    // mail-parser liefert Message-IDs ohne spitze Klammern
    assert_eq!(p.in_reply_to.as_deref(), Some("abc@lan-solo.test"));

    // Entwurf: Ordner wird bei Bedarf angelegt und bekommt die Rolle
    assert!(append_to_role(&st, "t", FolderRole::Drafts, Some("Drafts"), &bytes, vec![Flag::Seen, Flag::Draft]).unwrap());
    let folders = st.pool.with(&st, "t", |s| fetch_folders(s, true)).unwrap();
    let drafts = folders.iter().find(|f| f.role == FolderRole::Drafts).expect("Drafts");
    assert!(drafts.total.unwrap_or(0) >= 1);
    let d = list(&st, "t", &drafts.name);
    assert!(d.iter().all(|m| m.draft));

    // Verschieben in neuen Ordner
    let archiv = format!("Archiv-{run}");
    st.pool.with(&st, "t", |s| s.create(&archiv)).unwrap();
    st.pool
        .with(&st, "t", |s| {
            s.select("INBOX")?;
            s.uid_mv(welcome.uid.to_string(), &archiv)
        })
        .unwrap();
    let moved = list(&st, "t", &archiv);
    assert_eq!(moved.len(), 1);
    assert_eq!(moved[0].subject, s_welcome);
    let folders = st.pool.with(&st, "t", |s| fetch_folders(s, false)).unwrap();
    assert!(folders.iter().any(|f| f.name == archiv));

    // Konto-Probe (SMTP-Test)
    assert!(smtp::test(&acc, "pass").unwrap().starts_with("OK"));
}

/// Die Kommando-Logik selbst (do_*-Funktionen hinter den Tauri-Commands):
/// Liste + Cache, Suche, Ordner mit Umlauten, Weiterleiten mit Anhängen,
/// Entwurf fortsetzen/ersetzen, Löschen in den Papierkorb und endgültig.
#[test]
#[ignore]
fn e2e_commands() {
    let st = state(vec![account("t", "test"), account("a", "anna")]);
    let run = format!("{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());

    // Seed: Mail mit PDF-Anhang direkt in test/INBOX
    let subject = format!("Anhang-Test {run}");
    let raw = format!(
        "From: Anna <anna@lan-solo.test>\r\nTo: test@lan-solo.test\r\nSubject: {subject}\r\nMessage-ID: <att-{run}@lan-solo.test>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"b1\"\r\n\r\n--b1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nAnbei.\r\n--b1\r\nContent-Type: application/pdf; name=\"Angebot.pdf\"\r\nContent-Disposition: attachment; filename=\"../../Angebot.pdf\"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQgdGVzdA==\r\n--b1--\r\n"
    );
    st.pool.with(&st, "t", |s| s.append("INBOX", raw.as_bytes()).finish()).unwrap();

    // Liste über do_list: erst Server, dann Cache
    let page = do_list(&st, "t", "INBOX", 0, 50, true).unwrap();
    assert!(!page.from_cache);
    let m = page.messages.iter().find(|m| m.subject == subject).expect("seeded").clone();
    assert!(m.has_attachments);
    let cached = do_list(&st, "t", "INBOX", 0, 50, false).unwrap();
    assert!(cached.from_cache);
    assert_eq!(cached.total, page.total);

    // Anhangsname ist entschärft
    let (raw_back, ..) = fetch_raw_or_err(&st, "t", "INBOX", m.uid).unwrap();
    let parsed = parse_message(&raw_back).unwrap();
    let att = parsed.attachments.iter().find(|a| !a.inline).unwrap();
    assert_eq!(att.filename, "Angebot.pdf");

    // Ordner mit Umlaut anlegen → UTF-7 auf dem Server, Anzeige dekodiert
    let fname = format!("Prüfung {run}");
    do_create_folder(&st, "t", &fname).unwrap();
    let folders = st.pool.with(&st, "t", |s| fetch_folders(s, false)).unwrap();
    let f = folders.iter().find(|f| f.display == fname).expect("utf7 folder");
    assert!(f.name.is_ascii() && f.name.contains("&APw-"), "{}", f.name);
    assert!(do_create_folder(&st, "t", "  ").is_err());

    // Weiterleiten mit Originalanhang an anna
    let fwd_subject = format!("Fwd: {subject}");
    let fwd = Draft {
        account_id: "t".into(),
        to: "anna@lan-solo.test".into(),
        subject: fwd_subject.clone(),
        body: "siehe Anhang".into(),
        server_attachments: Some(ServerAttachments { account_id: None, folder: "INBOX".into(), uid: m.uid, indices: vec![att.index] }),
        ..Default::default()
    };
    do_send(&st, &fwd).unwrap();
    let anna = list(&st, "a", "INBOX");
    let got = anna.iter().find(|x| x.subject == fwd_subject).expect("forward delivered");
    let (raw_fwd, ..) = fetch_raw_or_err(&st, "a", "INBOX", got.uid).unwrap();
    let p = parse_message(&raw_fwd).unwrap();
    let a = p.attachments.iter().find(|a| a.filename == "Angebot.pdf").expect("attachment forwarded");
    assert_eq!(mailbox_core::attachment_bytes(&raw_fwd, a.index).unwrap(), b"%PDF-1.4 test");

    // Weiterleiten über ein anderes Konto: Anhang kommt trotzdem vom Quellkonto
    let x_subject = format!("Fwd über anna {run}");
    let cross = Draft {
        account_id: "a".into(),
        to: "test@lan-solo.test".into(),
        subject: x_subject.clone(),
        server_attachments: Some(ServerAttachments { account_id: Some("t".into()), folder: "INBOX".into(), uid: m.uid, indices: vec![att.index] }),
        ..Default::default()
    };
    do_send(&st, &cross).unwrap();
    let back = list(&st, "t", "INBOX");
    let got = back.iter().find(|x| x.subject == x_subject).expect("cross forward delivered");
    assert!(got.has_attachments);

    // Tippfehler im Empfänger: Senden verweigert, nichts verschickt
    let bad = Draft { account_id: "t".into(), to: "anna@lan-solo.test, anna".into(), subject: "x".into(), ..Default::default() };
    assert!(do_send(&st, &bad).unwrap_err().contains("anna"));

    // Entwurf speichern, dann fortsetzen und ersetzen → genau einer bleibt
    let dsub = format!("Entwurf {run}");
    let d1 = Draft { account_id: "t".into(), to: "anna@lan-solo.test, unfertig".into(), subject: dsub.clone(), body: "v1".into(), ..Default::default() };
    do_save_draft(&st, &d1).unwrap();
    let folders = st.pool.with(&st, "t", |s| fetch_folders(s, false)).unwrap();
    let drafts = find_role(&folders, FolderRole::Drafts).expect("drafts folder");
    let first = list(&st, "t", &drafts).into_iter().find(|x| x.subject == dsub).expect("draft v1");
    let d2 = Draft {
        account_id: "t".into(),
        to: "anna@lan-solo.test".into(),
        subject: dsub.clone(),
        body: "v2".into(),
        replaces_draft: Some(MessageRef { account_id: None, folder: drafts.clone(), uid: first.uid }),
        ..Default::default()
    };
    do_save_draft(&st, &d2).unwrap();
    let now: Vec<_> = list(&st, "t", &drafts).into_iter().filter(|x| x.subject == dsub).collect();
    assert_eq!(now.len(), 1, "old draft replaced");
    assert_ne!(now[0].uid, first.uid);
    // Senden aus dem Entwurf entfernt ihn
    let d3 = Draft { replaces_draft: Some(MessageRef { account_id: Some("t".into()), folder: drafts.clone(), uid: now[0].uid }), ..d2.clone() };
    do_send(&st, &d3).unwrap();
    assert!(list(&st, "t", &drafts).iter().all(|x| x.subject != dsub), "draft removed after send");
    // Ein Verweis auf eine gewöhnliche Mail löscht nichts
    remove_draft(&st, "t", &MessageRef { account_id: None, folder: "INBOX".into(), uid: m.uid }).unwrap();
    assert!(list(&st, "t", "INBOX").iter().any(|x| x.uid == m.uid));

    // Löschen: erst Papierkorb (wird bei Bedarf über Rolle gefunden), dort endgültig
    let trash_name = format!("Trash-{run}");
    let has_trash = find_role(&st.pool.with(&st, "t", |s| fetch_folders(s, false)).unwrap(), FolderRole::Trash);
    let trash = match has_trash {
        Some(t) => t,
        None => {
            st.pool.with(&st, "t", |s| s.create(&trash_name)).unwrap();
            // GreenMail kennt kein SPECIAL-USE: Rolle über den Namen „Trash“
            st.pool.with(&st, "t", |s| s.create("Trash")).ok();
            "Trash".to_string()
        }
    };
    do_delete(&st, "t", "INBOX", &[m.uid]).unwrap();
    assert!(list(&st, "t", "INBOX").iter().all(|x| x.uid != m.uid));
    let in_trash = list(&st, "t", &trash);
    let t_msg = in_trash.iter().find(|x| x.subject == subject).expect("moved to trash");
    do_delete(&st, "t", &trash, &[t_msg.uid]).unwrap();
    assert!(list(&st, "t", &trash).iter().all(|x| x.subject != subject), "deleted permanently");
}

/// Ohne Server: Eingabeprüfung des Konto-Dialogs.
#[test]
fn account_validation() {
    let mut input: AccountInput = serde_json::from_value(serde_json::json!({
        "name": "", "email": " neu@lan-solo.test ", "imapHost": " localhost ", "imapPort": 3143,
        "imapSecurity": "none", "smtpHost": "localhost", "smtpPort": 3025, "smtpSecurity": "none",
        "username": ""
    }))
    .unwrap();
    let ok = validate_input(input.clone()).unwrap();
    assert_eq!(ok.email, "neu@lan-solo.test");
    assert_eq!(ok.username, "neu@lan-solo.test");
    assert_eq!(ok.imap_host, "localhost");
    input.imap_port = 0;
    assert!(validate_input(input.clone()).is_err());
    input.imap_port = 993;
    input.smtp_host = "https://smtp.x.de".into();
    assert!(validate_input(input.clone()).is_err());
    input.smtp_host = "smtp.x.de".into();
    input.email = "kein-at".into();
    assert!(validate_input(input).is_err());
}
