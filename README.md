# mailbox.

Mail-Client mit zwei Modi — IMAP/SMTP, lokal, ohne Konto-Zwang.

- **Einfach:** Posteingang, Gesendet, Entwürfe, Papierkorb, Spam, ggf. Archiv — lesen, antworten, weiterleiten, schreiben, löschen. Mehr nicht, weil mehr selten nötig ist.
- **Experte:** vollständiger Ordnerbaum mit Zählern, Verschieben, Mehrfachauswahl, Server-Suche, Quelltext- und Header-Ansicht, Sammel-Posteingang, Tastaturkürzel.
- **Konten:** Presets für gängige Anbieter, sonst `imap.`/`smtp.`-Heuristik — mit Verbindungstest vor dem Speichern.
- **Privatsphäre:** externe Bilder in HTML-Mails sind blockiert, bis Sie sie laden; Passwörter liegen im Schlüsselbund des Systems.
- **Verbindung:** IMAP-TLS über rustls 0.23 mit System-Zertifikatsspeicher + Mozilla-Wurzeln, STARTTLS ohne Klartext-Rückfall, Verbindungs-/Lese-Timeouts (20 s / 100 s) statt Hängern, Kurzprobe (NOOP, 8 s) vor dem Wiederbenutzen einer ruhenden Verbindung, ein Wiederholungsversuch nur für lesende Befehle; endgültiges Löschen auch ohne UIDPLUS nur der gewählten Nachrichten.
- **Editor (Experte):** Markdown-Werkzeuge mit HTML-Vorschau; Umbruch 72 lässt Zitate, Code-Blöcke und die Kontosignatur stehen, Text unter Signatur und Zitat wird mit umbrochen; ⌘/Strg+⏎, ⌘/Strg+S und ⌘/Strg+⇧P wirken im ganzen Editor.
- **Versand:** SMTP mit Anhängen, Antwort-Threading (In-Reply-To/References), Kopie in „Gesendet“, Entwürfe auf dem Server (fortsetzbar), Weiterleiten mit den Originalanhängen, strenge Adressprüfung vor dem Senden.

DE/EN, signierte In-App-Updates. Keine Telemetrie.

Aktuelle Version: **1.0.0** — Funktions- und Sicherheitsaudit siehe `AUDIT-1.0.md`.

## Entwicklung

```sh
pnpm install
pnpm tauri dev
pnpm test                 # Markdown-Renderer, Mail-HTML-Entschärfung, Wächter gegen window.confirm/alert (Node, ohne Framework)
cargo test --workspace    # Kern + Backend (Unit-Tests, inkl. IMAP-Verbindung gegen Mini-Server)
cargo test -p mailbox -- --ignored net_tls   # echte TLS-Gegenstellen (Netz nötig)
```

End-to-End gegen GreenMail (Docker), Befehl im Kopf von `src-tauri/src/commands/e2e.rs`:

```sh
MAILBOX_E2E_SMTP_PORT=13025 MAILBOX_E2E_IMAP_PORT=13143 MAILBOX_E2E_IMAPS_PORT=13993 \
  cargo test -p mailbox -- --ignored e2e
```

UI ohne Mail-Server: `pnpm dev` und `http://localhost:1433/?mock` (Dev-Mock `src/devmock.ts`;
`&lang=en&theme=light&mode=expert&update` für Sprache, Hell-Modus, Expertenmodus und Update-Hinweis).
Der Mock bildet plugin-dialog 2.7 nach: `window.confirm/alert/prompt` sind dort wirkungslose Promises,
Rückfragen laufen nur über `plugin:dialog|message`. Fehlerfälle: `window.__mockFail = { kommando: 'Meldung' }`; abgebrochene Datei-Dialoge: `window.__mockDialogCancel = true`.
Antwortzeiten für Reihenfolge-Tests: `window.__mockDelay = { kommando: ms | (args) => ms }`.

```sh
node scripts/ui-smoke/ui.mjs                                     # Abläufe (38 Prüfungen)
node --experimental-strip-types scripts/ui-smoke/sweep.mjs       # DE/EN × dunkel/hell bei 900×580: Layout, Sprache, Fehleranzeigen
node --experimental-strip-types scripts/ui-smoke/journeys.mjs    # Nutzerabläufe DE/⌘ + EN/Strg inkl. Fehlerfällen (72 Prüfungen)
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
