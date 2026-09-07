# mailbox. — Plan

Mail-Client mit zwei Modi für IMAP/SMTP. Tauri 2 + React (Vite, TypeScript),
Rust-Backend mit `imap` (rustls), `lettre` (SMTP, rustls), `mail-parser`,
Passwörter im OS-Schlüsselbund (`keyring`; Fallback: Datei im App-Datenordner).
Terminal-Look wie die anderen LAN-SOLO-Apps (Mono-UI 13 px, `--radius: 4px`,
Uppercase-Mono-Labels, `//`-Hinweiszeilen). DE/EN, signierte In-App-Updates.

## Zwei Modi

**Einfach** — nur, was man zum Mailen braucht:
- Konten und die Rollen-Ordner (Posteingang, Gesendet, Entwürfe, Papierkorb, Spam)
- Nachrichtenliste (neueste zuerst, nachladen), Lesebereich, Suche in der Liste
- Neu, Antworten, Allen antworten, Weiterleiten, Löschen, Archivieren, Stern, ungelesen
- Anhänge speichern, Entwürfe speichern
- Externe Bilder blockiert (Privatsphäre), Klartext bevorzugt

**Experte** — alles aus Einfach plus:
- vollständiger Ordnerbaum mit Zählern, Ordner anlegen/löschen, Papierkorb leeren
- Verschieben in beliebige Ordner, Mehrfachauswahl
- Serverseitige Suche (IMAP SEARCH) mit Scope: alles / Betreff / Von / An / Text
- Quelltext- und Header-Ansicht, externe Bilder je Nachricht oder global
- Sammel-Posteingang über alle Konten, Kontofarben
- Tastaturkürzel (j/k, r, a, f, e, #, s, u, /), Sortierung, Seitengröße
- Signatur je Konto, Zitat-Verhalten, Abrufintervall

## Architektur

- `core/` (`mailbox-core`): reine Logik ohne Tauri — Adress-Parsing,
  Ordner-Rollen (Special-Use + Namensheuristik), MIME→DTO (mail-parser),
  cid→data-URI, HTML→Text-Fallback, Provider-Presets/Server-Heuristik,
  lokaler Summary-Cache. Unit-Tests hier.
- `src-tauri/`: IMAP-Sessions je Konto (Mutex-Pool, Reconnect bei Fehler),
  SMTP-Versand, Schlüsselbund, Settings/Accounts als JSON im Config-Ordner,
  Tauri-Commands laut `src/api.ts` (async + `spawn_blocking`).
- `src/`: React-UI — `App.tsx` (Layout: Sidebar / Liste / Lesebereich),
  `components/` (AccountModal, Compose, MessageView, SettingsModal, Help),
  `i18n.ts` (DE/EN), `styles.css` (Terminal-Look), `api.ts` (Vertrag).

## Roadmap

- 0.1: Konten (Presets + Test), Ordner, Liste, Lesen (Text/HTML sandboxed),
  Flags, Löschen/Verschieben, Verfassen/Antworten/Weiterleiten mit Anhängen,
  Gesendet-Kopie, Entwürfe, Suche, beide Modi, Handbuch, Updater.
- 0.2: IMAP IDLE (Push), Offline-Cache der Bodies, Threading, Filter/Regeln.
- 0.3: OAuth2 für große Anbieter, PGP/S/MIME, Kontakte-Autovervollständigung.
