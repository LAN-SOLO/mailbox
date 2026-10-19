# mailbox.

Mail-Client mit zwei Modi — IMAP/SMTP, lokal, ohne Konto-Zwang.

- **Einfach:** Posteingang, Gesendet, Entwürfe, Papierkorb — lesen, antworten, weiterleiten, schreiben, löschen. Mehr nicht, weil mehr selten nötig ist.
- **Experte:** vollständiger Ordnerbaum mit Zählern, Verschieben, Mehrfachauswahl, Server-Suche, Quelltext- und Header-Ansicht, Sammel-Posteingang, Tastaturkürzel.
- **Konten:** Presets für gängige Anbieter, sonst `imap.`/`smtp.`-Heuristik — mit Verbindungstest vor dem Speichern.
- **Privatsphäre:** externe Bilder in HTML-Mails sind blockiert, bis Sie sie laden; Passwörter liegen im Schlüsselbund des Systems.
- **Versand:** SMTP mit Anhängen, Antwort-Threading (In-Reply-To/References), Kopie in „Gesendet“, Entwürfe auf dem Server (fortsetzbar), Weiterleiten mit den Originalanhängen, strenge Adressprüfung vor dem Senden.

DE/EN, signierte In-App-Updates. Keine Telemetrie.

Aktuelle Version: **1.0.0** — Funktions- und Sicherheitsaudit siehe `AUDIT-1.0.md`.

## Entwicklung

```sh
pnpm install
pnpm tauri dev
pnpm test                 # Markdown-Renderer des Editors (Node, ohne Framework)
cargo test --workspace    # Kern + Backend (Unit-Tests)
```

End-to-End gegen GreenMail (Docker), Befehl im Kopf von `src-tauri/src/commands/e2e.rs`:

```sh
MAILBOX_E2E_SMTP_PORT=13025 MAILBOX_E2E_IMAP_PORT=13143 \
  cargo test -p mailbox -- --ignored e2e
```

UI ohne Mail-Server: `pnpm dev` und `http://localhost:1433/?mock` (Dev-Mock `src/devmock.ts`).

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
