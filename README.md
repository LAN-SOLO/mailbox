# mailbox.

Mail-Client mit zwei Modi — IMAP/SMTP, lokal, ohne Konto-Zwang.

- **Einfach:** Posteingang, Gesendet, Entwürfe, Papierkorb — lesen, antworten, weiterleiten, schreiben, löschen. Mehr nicht, weil mehr selten nötig ist.
- **Experte:** vollständiger Ordnerbaum mit Zählern, Verschieben, Mehrfachauswahl, Server-Suche, Quelltext- und Header-Ansicht, Sammel-Posteingang, Tastaturkürzel.
- **Konten:** Presets für gängige Anbieter, sonst `imap.`/`smtp.`-Heuristik — mit Verbindungstest vor dem Speichern.
- **Privatsphäre:** externe Bilder in HTML-Mails sind blockiert, bis Sie sie laden; Passwörter liegen im Schlüsselbund des Systems.
- **Versand:** SMTP mit Anhängen, Antwort-Threading (In-Reply-To/References), Kopie in „Gesendet“, Entwürfe auf dem Server.

DE/EN, signierte In-App-Updates. Keine Telemetrie.

## Entwicklung

```sh
pnpm install
pnpm tauri dev
cargo test --workspace
```

Der Rust-Kern (`core/`, Crate `mailbox-core`) ist Tauri-frei und testbar:
Adress-Parsing, Ordner-Rollen, MIME → Anzeige, Anbieter-Presets, Cache.
Die Kommandos in `src-tauri/src/commands.rs` folgen dem Vertrag in `src/api.ts`.

## Release-Build (lokal)

```sh
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/mailbox-updater.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
pnpm tauri build --bundles app,dmg
```

Details und Roadmap: `MAILBOX_PLAN.md`.
