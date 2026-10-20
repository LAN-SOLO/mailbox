# mailbox. 1.0 — Funktions- und Sicherheitsaudit

Stand: 2026-10-20 (Runde 2, § 7; Verifikation § 8; Runde 3, § 9) · 2026-10-19 · Basis: `0864694` (v0.1.0 + Hilfe-Sprachumschalter) · Ziel: Test-Build 1.0.0 für macOS und Windows.

Legende Teststatus:
- **E2E** — automatisiert gegen einen echten IMAP/SMTP-Server (GreenMail 2.1.0 in Docker, `cargo test -p mailbox -- --ignored e2e`)
- **Unit** — automatisierter Rust- bzw. Node-Test (`cargo test --workspace`, `pnpm test`)
- **UI** — automatisiert im Dev-Mock über headless Chrome (`scripts/ui-smoke/ui.mjs`, 38 Prüfungen; seit Runde 3 zusätzlich `journeys.mjs`, 72 Prüfungen)
- **statisch** — nur Code-Review; braucht einen manuellen Test (Checkliste unten)

## 1. Feature-Inventar

### Konten
| Feature | Status |
|---|---|
| Konto anlegen/bearbeiten/entfernen (Name, Adresse, Benutzername, Passwort, IMAP/SMTP Host/Port/Verschlüsselung, Signatur, Farbe) | UI (Dialog, Validierung), Unit (`account_validation`) |
| Server-Vorschlag aus der Domain (Presets + `imap.`/`smtp.`-Heuristik) | Unit (`presets`) |
| Verbindungstest IMAP + SMTP getrennt | E2E (`smtp::test`), UI (Mock) |
| Passwort im OS-Schlüsselbund, Fallback `credentials.json` (0600, atomar) | Unit (Datei-Fallback, Rechte); Schlüsselbund **statisch** |
| Eingabeprüfung: Adresse, Hostname ohne Schema/Leerzeichen, Port 1–65535 | Unit, UI (Port 0 abgelehnt) |
| Warnhinweis bei Verschlüsselung „keine“ | UI |
| Konto entfernen löscht Zugangsdaten + Cache, mit Rückfrage | UI (Rückfrage); Löschen **statisch** |

### Ordner
| Feature | Status |
|---|---|
| Ordnerliste mit Rollen (Special-Use + DE/EN-Namensheuristik), Zähler (STATUS) | E2E, Unit |
| Modified-UTF-7 dekodieren (Anzeige) und **kodieren (Anlegen, neu)** | Unit (Roundtrip inkl. RFC-Beispiel), E2E („Prüfung …“) |
| Ordner anlegen / löschen (Rechtsklick, Experte), Papierkorb leeren | Anlegen E2E; Löschen/Leeren **statisch** (UI-Rückfrage getestet) |
| Einfach: nur Rollenordner; Experte: kompletter Baum, Einrückung | UI |
| Sammel-Posteingang (Experte, ≥ 2 Konten), Sortierung nach Datum | UI |

### Liste & Suche
| Feature | Status |
|---|---|
| Neueste zuerst, Seiten nachladen, lokaler Cache je Konto+Ordner | E2E (`do_list` Server + Cache), Unit (Cache) |
| Filter in der Liste (Einfach) | UI (indirekt) |
| Server-Suche mit Bereich alles/Betreff/Von/An/Text (Experte), CHARSET-Fallback | E2E (SUBJECT); andere Bereiche **statisch** |
| Mehrfachauswahl, Stern, gelesen/ungelesen | Flags E2E; UI-Pfad **statisch** |
| Automatischer Abruf (Intervall) | **statisch** |

### Lesen
| Feature | Status |
|---|---|
| MIME → Text/HTML, cid-Bilder als data:, Anhänge, Header | Unit (Fixture), E2E |
| HTML in Sandbox-Iframe ohne Skripte, externe Bilder blockiert / je Nachricht oder global laden | UI + CSP-Experiment in Chromium (siehe 2.2) |
| Links: http(s) → Browser, mailto: → neue Nachricht in mailbox | UI |
| Anhang speichern (Dialog, entschärfter Dateiname) | Unit (Dateinamen), UI (Mock) |
| Header- und Quelltext-Ansicht (Experte) | **statisch** (Mock-Pfad vorhanden) |
| Text/HTML umschalten | **statisch** |

### Schreiben
| Feature | Status |
|---|---|
| Neu, Antworten, Allen antworten (ohne eigene Adressen), Weiterleiten | UI (Antworten, Weiterleiten), E2E (Versand) |
| **Weiterleiten mit Originalanhängen** (neu, auch über ein anderes Konto) | E2E, UI |
| **Entwurf fortsetzen** („Weiter bearbeiten“, ersetzt den alten Entwurf) | E2E (ersetzen, nach Senden entfernt, nur \Draft), UI |
| Anhänge aus Dateien | Unit (MIME), E2E nicht (Datei-Dialog) |
| Strenge Adressprüfung beim Senden (neu) | Unit, E2E |
| Gesendet-Kopie, Entwürfe-Ordner (bei Bedarf angelegt) | E2E |
| Threading (In-Reply-To/References), \Answered auf der beantworteten Nachricht | E2E (Header), UI (Draft-Inhalt) |
| Experten-Editor: Markdown-Werkzeuge, Vorschau, Umbruch 72, Zitat weg, Signatur/Original | Unit (`pnpm test`: Renderer, Escape, Umbruch, Zitate); Toolbar **statisch** |
| Text + HTML (multipart/alternative), Reply-To, Priorität, Lesebestätigung | Unit (`smtp::tests`) |
| ⌘/Strg+⏎ senden, ⌘/Strg+S Entwurf, Esc = Verwerfen mit Rückfrage | Esc UI; Kürzel **statisch** |

### App
| Feature | Status |
|---|---|
| Modi Einfach/Experte | UI |
| Einstellungen (Sprache, Modus, Hell/Dunkel, Akzent, Lesen, Schreiben, Konten, App) mit Live-Vorschau und Rücknahme bei Esc/Abbrechen | UI |
| Tastaturkürzel j/k/r/a/f/e/#/s/u/n// (Experte) | `n` UI; Rest **statisch** |
| DE/EN inkl. Backend-Meldungen | UI (EN-Oberfläche); Backend-Meldungen **statisch** |
| Handbuch + Tutorial (DE/EN-Umschalter, Esc) | UI |
| In-App-Updater (signiert, GitHub latest.json) | **statisch** |

## 2. Sicherheit

### 2.1 Befunde und Status

| # | Schwere | Befund | Status |
|---|---|---|---|
| S1 | hoch | **Rückfragen wirkungslos.** Das Dialog-Plugin ersetzt `window.confirm` durch eine async Funktion; `if (!window.confirm(…))` prüfte ein Promise (immer wahr), und das intern aufgerufene `plugin:dialog\|confirm` existiert in 2.7 nicht mehr. Löschen, endgültiges Löschen im Papierkorb, Papierkorb leeren, Ordner/Konto entfernen und Verwerfen liefen ohne Rückfrage durch. | behoben (`src/dialog.ts`, `confirm()` aus plugin-dialog mit `await`) |
| S2 | mittel | **Sperre externer Inhalte umgehbar.** Die CSP-Meta wurde hinter das erste `<head>` der Mail gesetzt; ein `<img>` davor lud trotzdem (Tracking-Pixel). Zugleich erbte das srcdoc-Iframe die App-CSP (`img-src 'self' data: blob:`), sodass „Externe Bilder laden“ nie funktionierte. | behoben: CSP-Meta ist erstes Element; App-CSP erlaubt `https:`/`http:`-Bilder, verschärft sonst (`frame-src 'self'`, `object-src 'none'`, `base-uri`, `form-action`) |
| S3 | mittel | Anhangsnamen aus fremden Mails gingen ungefiltert als `defaultPath` in den Speichern-Dialog (`../../…`, absolute Pfade, Windows-Gerätenamen, Bidi-Override). | behoben (`mailbox_core::safe_filename`) |
| S4 | mittel | Steuerzeichen im Absendernamen ließen lettre beim Formatieren **abstürzen** (Panic); Message-IDs aus fremden Mails liefen ungefiltert in In-Reply-To/References; Disposition-Notification-To als Roh-Header mit beliebigem Namen. | behoben (Bereinigung + Test `hostile_message_ids_and_names_stay_in_their_header`) |
| S5 | niedrig | `credentials.json` wurde erst lesbar angelegt und dann auf 0600 gesetzt; nicht atomar. | behoben (`create_new` + 0600 + rename) |
| S6 | niedrig | Opener-Berechtigung `opener:default` erlaubte zusätzlich „im Ordner zeigen“. | behoben (`opener:allow-open-url` + `allow-default-urls`) |
| S7 | niedrig | `AccountInput` (enthält Klartext-Passwort) leitete `Debug` ab. | behoben (kein `Debug`) |
| S8 | niedrig | Einstellungen ungeprüft vom Frontend übernommen. | behoben (`Settings::sanitized`) |
| S9 | Info | Verschlüsselung „keine“ ist wählbar (für lokale Testserver). | belassen, Warnhinweis im Dialog |
| S10 | niedrig | rustls 0.23.43 (RUSTSEC-2026-0285/0346/0348/0349), source-map-js 1.2.1 (GHSA-68fv-2mgg-jv7q, nur Build) | behoben (0.23.46 / 1.2.2) |
| S11 | mittel | `imap 3.0.0-alpha.15` zog über das Feature `rustls-tls` `rustls-connector 0.19` → rustls 0.22.4 / rustls-webpki 0.102.8 (RUSTSEC-2026-0346/0349, -0049/0098/0099/0104). | **behoben in Runde 2** (§ 7): IMAP-TLS baut mailbox selbst mit rustls 0.23 (schon im Baum über lettre/reqwest); `cargo audit` meldet rustls 0.22/webpki 0.102 nicht mehr |
| S12 | niedrig (offen) | `zip 4.6.1` im Updater (RUSTSEC-2026-0367/0368/0369). Entpackt werden nur signaturgeprüfte Update-Pakete; macOS nutzt tar.gz, Windows NSIS. Fix erst mit tauri-plugin-updater ≥ 2.14 (zieht Tauri-Upgrade nach sich). | offen — beim nächsten Tauri-Upgrade |

Geprüft ohne Befund: TLS-Prüfung nirgends abgeschaltet (kein `danger_skip_tls_verify`, lettre `relay`/`starttls_relay`); Updater-Pubkey gesetzt, Endpoint https; IMAP-Strings über `validate_str`/eigene Quotierung ohne CR/LF; Suche quotiert; kein `dangerouslySetInnerHTML`; Markdown-Renderer escaped vor dem Einfügen und verlinkt nur http(s)/mailto (Tests); Vorschau-Iframe `sandbox=""`; localStorage nur für `mailbox.tutorialSeen`; Passwörter werden nirgends geloggt; Fehlermeldungen enthalten Host/Port, keine Zugangsdaten.

### 2.2 CSP-Nachweis (Chromium, entspricht WebView2)

Experiment mit Eltern-CSP als HTTP-Header und Mail im srcdoc-Iframe (Treffer = Abrufe des Tracking-Bilds):

| Eltern-CSP | Wrapper | externe Bilder | Treffer |
|---|---|---|---|
| alt (`img-src 'self' data: blob:`) | neu | erlaubt | 0 → Funktion „laden“ war tot |
| neu (+ `https: http:`) | neu | erlaubt | 1 |
| neu | neu | blockiert | 0 |
| neu | neu, `<img>` vor `<head>` | blockiert | 0 |
| neu | **alt**, `<img>` vor `<head>` | blockiert | 1 → Umgehung |
| neu | neu, CSS-Hintergrundbild | blockiert | 0 |
| neu | neu, eigene CSP-Meta der Mail `img-src *` | blockiert | 0 |

WebKit (macOS) folgt laut Spezifikation demselben Erbschaftsmodell — **manuell gegenprüfen** (Checkliste).

## 3. Weitere behobene Fehler

- Konto bearbeiten aus Einstellungen → Konten: Dialog lag *unter* den Einstellungen (unsichtbar).
- Esc im Expertenmodus schloss den Editor ohne Rückfrage (Text weg) und die Einstellungen ohne Rücknahme der Live-Vorschau; Esc wirkt jetzt nur auf den obersten Dialog, in beiden Modi.
- \Answered wurde auf die gerade *offene* statt auf die beantwortete Nachricht gesetzt.
- Ordnernamen mit Umlauten wurden ungekodiert an den Server geschickt.
- Tippfehler in Empfängerlisten verschwanden still („a@b.de, anna“ → nur a@b.de).
- Sammel-Posteingang sortierte Datumsstrings lexikalisch (Zeitzonen-Fehler).
- „Mehr laden“ konnte Dubletten erzeugen; Ordnerwechsel ohne Cache fragte den Server doppelt.
- Markdown: `_`/`*` in URLs wurden zu `<i>` im `href`.
- Nach Ruhezustand/WLAN-Wechsel hing der erste IMAP-Befehl auf der toten Verbindung → Session nach > 4 min Leerlauf neu (Wanduhr, weil `Instant` auf macOS im Ruhezustand steht).
- Backend-Fehlermeldungen waren immer deutsch.
- React-Warnung „setState while rendering“ in den Einstellungen.
- Tooltips zeigten unter Windows ⌘ statt Strg.

## 4. Bekannte Grenzen

- ~~Keine Timeouts auf IMAP-Sockets~~ — seit Runde 2 behoben (20 s Verbindungsaufbau, 100 s je Lese-/Schreiboperation; § 7). Seit Runde 3: Kurzprobe (NOOP, 8 s) vor dem Wiederbenutzen einer Verbindung nach > 30 s Leerlauf; lesende/idempotente Befehle werden nach Timeout einmal auf neuer Verbindung wiederholt, MOVE/APPEND/EXPUNGE/CREATE nicht (§ 9).
- ~~Ohne UIDPLUS fällt endgültiges Löschen auf `EXPUNGE` des ganzen Ordners zurück~~ — seit Runde 3 nach RFC 4315 § 2.1: fremde \Deleted vorübergehend entfernt, `EXPUNGE`, zurückgesetzt (§ 9). Restrisiko: setzt ein *anderes* Programm genau zwischen `UID SEARCH DELETED` und `EXPUNGE` ein neues \Deleted, wird diese Nachricht mit entfernt (wie von jenem Programm beabsichtigt).
- Kein IDLE (Push), kein Threading-Ansicht, kein OAuth2 (große Anbieter brauchen App-Passwörter), kein PGP/S/MIME.
- Beim Weiterleiten im Klartext gehen eingebettete (cid-)Bilder des Originals nicht mit; normale Anhänge schon.
- Der Listen-Cache (Betreff/Absender der ersten Seite) liegt unverschlüsselt im Cache-Ordner des Benutzers.
- Nur gegen GreenMail getestet, nicht gegen echte Anbieter (Gmail, Outlook, GMX …).
- Schlüsselbund (macOS Keychain, Windows Credential Manager), Datei-Dialoge, nativer Bestätigungsdialog und Updater laufen nur in der echten App — nicht automatisiert getestet.

## 5. Manuelle Testcheckliste (macOS und Windows)

Jeweils auf **macOS** (arm64 oder Intel) und **Windows 11** abhaken. Testkonto bei einem echten Anbieter (App-Passwort) und optional GreenMail.

**Installation & Start**
- [ ] DMG öffnet ohne Gatekeeper-Warnung (notarisiert) / Setup.exe installiert, Startmenü-Eintrag
- [ ] Erster Start: Tutorial erscheint, Esc und ✕ schließen es; DE/EN-Umschalter im Handbuch
- [ ] Einstellungen → App zeigt **Version 1.0.0**

**Konten**
- [ ] Konto mit Preset (z. B. GMX/Gmail): Server werden vorgeschlagen, „Verbindung testen“ meldet IMAP und SMTP OK
- [ ] Passwort landet im Schlüsselbund (macOS: Schlüsselbundverwaltung „com.lan-solo.mailbox“; Windows: Anmeldeinformationsverwaltung) — kein `credentials.json` im Datenordner
- [ ] Falsches Passwort → verständliche Meldung; Port 0 → „Ports müssen zwischen 1 und 65535 liegen“
- [ ] Verschlüsselung „keine“ → gelber Warnhinweis
- [ ] Einstellungen → Konten → Stift: Konto-Dialog liegt sichtbar **über** den Einstellungen; Esc schließt nur ihn
- [ ] Konto entfernen → **nativer Dialog** fragt nach; „Abbrechen“ lässt das Konto stehen

**Lesen**
- [ ] HTML-Newsletter: externe Bilder blockiert, Hinweis sichtbar; „Externe Bilder laden“ lädt sie tatsächlich (WebKit/WebView2!); Layout des Newsletters intakt (eingebettete `<link>`/`<iframe>` sind entschärft)
- [ ] Link in HTML-Mail öffnet den Standardbrowser; mailto:-Link öffnet „Neue Nachricht“ in mailbox
- [ ] Anhang speichern: Dialog schlägt den Dateinamen ohne Pfad vor; Datei ist korrekt (PDF öffnen)
- [ ] Experte: Header- und Quelltext-Ansicht, Esc schließt sie

**Schreiben**
- [ ] Neue Nachricht mit Datei-Anhang (Windows: Pfad mit Laufwerksbuchstabe und Umlaut, z. B. `C:\Users\…\Prüfung.pdf`) an sich selbst; kommt an, Kopie in „Gesendet“
- [ ] Empfänger „ich@example.org, anna“ → Senden verweigert mit Hinweis auf „anna“
- [ ] Antworten: Betreff „Re:“, Zitat; nach dem Senden trägt **die beantwortete** Nachricht das Beantwortet-Flag
- [ ] Weiterleiten einer Mail mit PDF: Anhang steht „aus dem Original“ im Editor, ✕ entfernt ihn; ohne ✕ kommt er beim Empfänger an
- [ ] Als Entwurf speichern → Entwürfe-Ordner; Entwurf öffnen → „Weiter bearbeiten“ → ändern → speichern: nur **ein** Entwurf bleibt; senden: Entwurf verschwindet
- [ ] Text tippen, Esc → nativer Dialog „Nachricht verwerfen?“; Abbrechen behält den Text
- [ ] Experte: ⌘B/Strg+B, ⌘⇧P/Strg+Shift+P Vorschau, ⌘⏎/Strg+Enter senden; Tooltips zeigen unter Windows „Strg+…“
- [ ] Experte: Text + HTML — Empfänger sieht Formatierung, Klartext-Client den Markdown-Text

**Ordner & Liste**
- [ ] Experte: Ordner „Prüfung ä“ anlegen → erscheint mit Umlaut (auch im Webmail)
- [ ] Rechtsklick → Ordner löschen fragt nativ nach; Abbrechen lässt ihn stehen
- [ ] Löschen einer Nachricht: Rückfrage (falls eingestellt), Nachricht im Papierkorb; dort erneut löschen → „endgültig löschen?“, Abbrechen wirkt
- [ ] Papierkorb leeren mit Rückfrage
- [ ] Server-Suche (Experte) in allen Bereichen, auch nach einem Wort mit Umlaut (z. B. „Grüße“); Esc beendet die Suche
- [ ] Sammel-Posteingang mit zwei Konten: neueste oben, Kontofarbe sichtbar
- [ ] Mehr laden bei > 50 Nachrichten ohne doppelte Zeilen
- [ ] Rechner 10 min schlafen legen, aufwecken, „Abrufen“: Liste kommt ohne Hänger

**Darstellung & Sprache**
- [ ] Hell/Dunkel und alle vier Akzente, Warnhinweise im hellen Modus lesbar
- [ ] Sprache Englisch: Oberfläche **und** Fehlermeldungen (z. B. falsches Passwort) englisch
- [ ] Tastaturkürzel j/k/r/a/f/e/#/s/u/n// im Expertenmodus

**Updates**
- [ ] „Nach Updates suchen“ meldet „Aktuell.“ bzw. findet ein höheres Release; Installation startet die App neu
- [ ] Ohne Netz (WLAN aus) „Nach Updates suchen“ → rote Meldung in der App-Sprache (nicht stumm)
- [ ] Update-Hinweis beim Start sitzt unten links und verschwindet, solange ein Dialog offen ist

**Runde 2 (Verbindung & Dateien)**
- [ ] macOS und Windows: Konto bei Gmail/GMX/Outlook (993/TLS) und einem Anbieter mit 143/STARTTLS verbinden — „Verbindung testen“ OK (eigene TLS-Schicht, System-Zertifikatsspeicher)
- [ ] Firmen-/Proxy-Zertifizierungsstelle (falls vorhanden) im System installiert → Verbindung klappt; selbst signiertes Zertifikat (z. B. GreenMail 3993) → „TLS-Fehler“
- [ ] Hängender Server: nach Login das Netz kappen (Kabel/WLAN), „Abrufen“ → nach ≤ 100 s (Pause > 30 s: ≤ ~30 s über die Probe; Pause < 30 s: bis ~120 s, weil lesende Befehle nach dem Timeout einmal neu verbinden, § 9) eine Fehlermeldung, die App bleibt bedienbar; Netz wieder an, „Abrufen“ → Liste kommt
- [ ] Windows: Anhang als PDF speichern, PDF im Acrobat offen lassen, erneut unter **demselben** Namen speichern → Meldung „… vermutlich in einem anderen Programm geöffnet“; nach Schließen klappt es; keine `.part`-Reste im Ordner
- [ ] Windows: Speicherort in OneDrive-Ordner mit Umlaut im Pfad → Datei vollständig, keine `.part`-Reste
- [ ] Konto entfernen, während eine Liste lädt → App friert nicht ein, Konto verschwindet und sein Cache-Ordner bleibt danach weg (Runde 2 – Verifikation, W3)
- [ ] macOS, frische Installation: Anhang nach **Downloads**, **Dokumente** und **Schreibtisch** speichern — erscheint eine Datenschutz-Abfrage („… auf Dateien im Ordner … zugreifen“)? Mit „Nicht erlauben“ muss trotzdem gespeichert werden (W4: Rückfall auf direktes Schreiben)
- [ ] Anhang mit sehr langem Namen (~240 Zeichen) speichern → klappt, keine `.part`-Reste (W4)
- [ ] macOS: Schlüsselbund-Rückfrage beim Ändern des Passworts offen lassen → Fenster bleibt bedienbar (W5)

## 6. Verifikation (zweiter, unabhängiger Prüfer, 2026-10-19)

Ziel: die Aussagen oben zu widerlegen. Alles unten wurde selbst ausgeführt, nicht übernommen.

### 6.1 Selbst ausgeführte Tests

| Prüfung | Ergebnis |
|---|---|
| `pnpm build` (tsc + vite) | grün |
| `pnpm test` | 25/25 (17 Markdown + **8 neu** `scripts/mailhtml.test.ts`) |
| `cargo test --workspace` | mailbox 11 + 3 ignoriert (E2E), core 18 — grün |
| `cargo test --workspace -- --include-ignored` gegen GreenMail 2.1.0 (Docker, Ports 14025/14143) | 14/14 + 18/18 grün, inkl. **neu** `e2e_verify_unicode_and_big` |
| `cargo clippy --workspace --all-targets` | 0 Warnungen |
| `node scripts/ui-smoke/ui.mjs` (headless Chrome gegen `pnpm dev ?mock`) | 38/38, 0 Konsolenfehler |
| `pnpm audit` / `cargo audit` | 0 / nur die oben offenen S11, S12 + „unmaintained“ — bestätigt |
| Versionen | `package.json`, `tauri.conf.json`, `src-tauri/Cargo.toml`, `core/Cargo.toml`, `Cargo.lock` (mailbox + mailbox-core) = 1.0.0; keine 0.1.0 mehr im Code |
| Dialog-Plugin (S1) | Quelltext geprüft: plugin-dialog 2.7.3 (JS = Rust) ruft `plugin:dialog\|message` mit `OkCancelCustom`; rfd 0.16 liefert auf macOS **und** Windows (`common-controls-v6`, von Tauri aktiviert) die Beschriftung des geklickten Knopfs → `=== okLabel` stimmt. |
| Header-Härtung | Zusatzprobe: Betreff mit CR/LF/NUL, Anhangsname und MIME-Typ mit CR/LF, lokaler Anhang „Größe & Preis (1).txt“ in Ordner mit Leerzeichen/Umlaut → keine Header-Injection, RFC-2231-Dateiname korrekt. |

### 6.2 Neu gefundene und behobene Fehler

| # | Schwere | Befund | Nachweis / Status |
|---|---|---|---|
| V1 | mittel (Sicherheit/Privatsphäre) | **Tracking trotz Sperre:** `<link rel=preconnect>` und eingebettete `<iframe>`/`<object>`/`<embed>` in einer HTML-Mail bauen eine TCP-Verbindung zum Absender-Server auf, *bevor* die CSP die Anfrage sperrt — der Absender sieht IP und Öffnungszeitpunkt, obwohl „externe Bilder“ blockiert sind. `dns-prefetch` leakt analog über DNS (auf Windows ist der App-Ursprung `http://tauri.localhost`, dort ist Link-DNS-Prefetch standardmäßig an). | Chromium-Experiment mit Zähl-Socket: vorher 1–2 nackte Verbindungen, nachher 0 (3 Läufe). Behoben in `src/mailHtml.ts`: `<link>` → wirkungsloses `<meta data-link>`, Rahmen-Tags → unbekannte Elemente, `x-dns-prefetch-control: off` direkt nach der CSP-Meta. Test `scripts/mailhtml.test.ts`. |
| V2 | mittel (Funktion) | **Server-Suche nach Umlauten fand nichts.** Der Suchbegriff ging als 8-Bit-Quoted-String; RFC 3501 erlaubt dort nur 7-Bit, strikte Server liefern leer (GreenMail nachgewiesen: Quoted → 0 Treffer, Literal → Treffer). | Behoben: Nicht-ASCII als `{n+}`-Literal (LITERAL+/LITERAL-, Gmail/Outlook/Dovecot/GreenMail), `CHARSET UTF-8` nur dann; ohne LITERAL+ wie bisher Quoted (synchrone Literale unterstützt die imap-Bibliothek für SEARCH nicht — ausprobiert, scheitert an der `+`-Antwort). Suche dafür nach `do_search` herausgelöst; Tests `search_criteria_literals` (Unit) und `e2e_verify_unicode_and_big` (E2E). |
| V3 | niedrig (Windows) | Tooltips „Entwurf speichern“/„Senden“ zeigten auf deutschem Windows „Ctrl+S“/„Ctrl+Enter“ statt „Strg+…“ | Behoben über Wörterbuch-Einträge `kbdSave`/`kbdSend` (laufen durch `platformKeys`); mit `navigator.platform = Win32` geprüft: „Strg+S \| Strg+Enter“ / „Ctrl+S \| Ctrl+Enter“. |

Handbuch (DE/EN) ergänzt: Suche findet Umlaute; Vorab-Verbindungen und eingebettete Fremdinhalte bleiben gesperrt; „Neu in 1.0“ nennt die Umlaut-Suche.

### 6.3 Zusätzlich E2E abgedeckt (`e2e_verify_unicode_and_big`)

- 12-MB-Anhang aus einem Pfad mit Leerzeichen, Umlaut und `&` senden → beim Empfänger byte-genau, Dateiname „Größe & Preis (final).bin“ erhalten.
- Suche nach Umlaut-Betreff und über alle Bereiche; leere Suche → leer.
- Nachricht in Ordner „Rechnungen äöü …“ verschieben, dort listen und **von dort** mit dem 12-MB-Anhang weiterleiten → kommt vollständig an.
- Ungültiger Anhangsindex und fehlende lokale Datei → Fehler (mit Dateiname), nichts verschickt.
- Umlaut-Ordner über den vom Server gelieferten (kodierten) Namen löschen.

### 6.4 Bestätigt, aber nur statisch / Restrisiken

- Leerlauf-Grenze 4 min < Standard-Abrufintervall 5 min: jeder automatische Abruf baut die IMAP-Verbindung neu auf (ein Login je Konto alle 5 min). Funktional korrekt, nur nicht sparsam.
- Entwurf ersetzen löscht den alten nur mit `\Draft`-Flag — Entwürfe anderer Programme ohne dieses Flag bleiben als Dublette stehen (sicherer Fehlerfall).
- Ohne UIDPLUS räumt das Ersetzen eines Entwurfs per `EXPUNGE` den ganzen Entwürfe-Ordner von \Deleted-Nachrichten.
- Umlaut-Suche auf Servern ohne LITERAL+/LITERAL- hängt weiter von deren Nachsicht bei 8-Bit-Quoted-Strings ab.
- Native Dialoge, Schlüsselbund, Updater, WebKit-Verhalten der CSP und der Link-Entschärfung: nur auf echter Hardware prüfbar (Checkliste oben).


## 7. Runde 2 (2026-10-20)

Basis: `aa1a93c`. Ziel: Reste aus Runde 1 im Code beheben (nicht nur dokumentieren) und die Fehlerbilder L1–L13 aus den anderen Apps gegen mailbox prüfen. „Getestet“ heißt hier: selbst ausgeführt.

### 7.1 Behoben

| # | Schwere | Befund | Behebung / Nachweis |
|---|---|---|---|
| R1 | mittel (Sicherheit) | S11: rustls 0.22 / webpki 0.102 mit offenen RUSTSEC-Meldungen über `imap`-Feature `rustls-tls` | IMAP-TLS in `src-tauri/src/imap.rs` selbst: rustls 0.23 (ring), Wurzeln aus dem System (`rustls-native-certs`) + `webpki-roots`, Zertifikats-/Namensprüfung immer an. STARTTLS von Hand: Begrüßung und Antwort Byte für Byte, ohne `OK` kein Klartext-Weiter. Alle drei Crates standen schon in `Cargo.lock` (lettre/reqwest) und werden nur direkt genutzt. `cargo audit`: nur noch S12 (zip) + „unmaintained“. Tests: `starttls_refused_never_falls_back_to_plaintext`, `starttls_injected_plaintext_breaks_handshake` (nach dem OK eingeschleuster Klartext landet im Handshake und scheitert), `bad_starttls_greeting_rejected`, `e2e_tls_self_signed_rejected` (GreenMail 3993), `net_tls_public_servers` (imap.gmail.com:993, imap.gmx.net:143 STARTTLS, badssl falscher Name / selbst signiert) — alle grün. |
| R2 | mittel (L8/L9) | Kein Timeout auf IMAP-Sockets: ein mitten im Befehl schweigender Server hing das Konto auf, bis TCP aufgab | 20 s Verbindungsaufbau je Adresse (IPv6/IPv4), 100 s Lese-/Schreib-Timeout je Socket-Operation; Meldung „Zeitüberschreitung — der Server antwortet nicht (100 s)“ DE/EN. Session wird nach jedem Verbindungs-/Protokollfehler verworfen (vorher blieb sie nach dem zweiten Fehlversuch im Pool); nach Timeout **keine** automatische Wiederholung. Test `silent_server_times_out_instead_of_hanging` (TLS und Klartext, < 2 s bei 300 ms Limit). |
| R3 | niedrig (Datenintegrität) | Verschieben fiel nach *jedem* MOVE-Fehler auf COPY+EXPUNGE zurück — auch nach Verbindungsabbruch, wenn das MOVE schon durch sein konnte | Rückfall nur noch bei `NO`/`BAD` (Server kann kein MOVE); E2E-Verschieben grün. |
| R4 | mittel (L8/L9) | `save_account`/`delete_account` waren synchrone Befehle (laufen auf dem Hauptthread) — Schlüsselbund-Zugriff und `drop_session` (wartet auf einen laufenden IMAP-Befehl, bis zu 100 s) froren das Fenster ein | Beide async über `spawn_blocking`. Löschen nimmt das Konto zuerst aus der Liste (neue Befehle finden es nicht mehr), dann Session, Passwort, Cache. Fehlgeschlagenes Speichern von `accounts.json` rollt den Speicherstand zurück (und entfernt ein gerade angelegtes Schlüsselbund-Passwort). Test `delete_account_removes_from_list_first`. |
| R5 | mittel (L5) | Windows: `rename` beim atomaren Schreiben (Einstellungen, Konten, Zugangsdaten) scheitert, wenn Virenscanner/OneDrive die frische Datei kurz offen halten; Anhang speichern schrieb direkt in die Zieldatei (halbe Datei bei Abbruch, kaputte Altdatei) | `accounts::rename_retry`: bis zu 12 Wiederholungen (≈ 2 s) bei Fehler 5/32/33, nur auf Windows. Anhänge: erst `.<name>.mailbox-<pid>.part` daneben, `sync_all`, dann umbenennen; bei Fehler wird die Temp-Datei entfernt, unter Windows mit Hinweis „vermutlich in einem anderen Programm geöffnet“. Tests `write_atomic_replaces_and_cleans_up`, `attachment_written_atomically_with_umlaut_path` (Pfad mit Umlaut, Leerzeichen, `&`), `transient_lock_codes`. Die Wiederholung selbst ist auf macOS nicht auslösbar → manuell (Checkliste). |
| R6 | mittel (L11/L13) | Update-Installation scheiterte stumm (Banner und Einstellungen setzten nur den Knopf zurück); Prüf-Fehler zeigten nur „Update-Prüfung fehlgeschlagen“ ohne Grund; `app.updater()`-Fehler kamen roh englisch | Meldung des Backends (in der App-Sprache vorangestellt) als Toast bzw. rot in Einstellungen → App; Knopf wieder bedienbar. UI-Sweep prüft beides in DE/EN. Versionsvergleich/Endpoint/Pubkey unverändert geprüft (semver gegen 1.0.0, GitHub `latest.json`, Minisign-Schlüssel gesetzt). |
| R7 | niedrig (L9) | Schnelles Weiterklicken in der Liste: eine langsamere ältere `get_message`-Antwort überschrieb die zuletzt geklickte Nachricht | Anfrage-Zähler wie bei der Liste; UI-Test „fast clicking shows the last message“. |
| R8 | niedrig (L7) | `<meta http-equiv=refresh>` in HTML-Mails: Chromium sperrt die Weiterleitung im Sandbox-Rahmen (gemessen: 0 Verbindungen), WebKit nicht automatisiert geprüft | `http-equiv` in Meta-Tags der Mail wird zu `data-http-equiv` (unsere CSP-Meta bleibt erstes Element). Leck-Experiment mit Zähl-Socket über 24 Vektoren (Bild, srcset/picture, CSS-Hintergrund/@import/@font-face, video/audio/poster/track, input type=image, SVG image/use, base, a ping, form, link preconnect/prefetch, iframe/object, refresh, dns-prefetch-Schalter): **0 Verbindungen** mit Sperre; Positivkontrolle ohne Verpackung 9 Treffer. Test in `scripts/mailhtml.test.ts`. |
| R9 | niedrig (L1) | Kein automatischer Schutz gegen Rückfall auf `window.confirm`; der Dev-Mock beantwortete `window.confirm` noch synchron (hätte den Fehler aus 0.1 verdeckt) | `scripts/dialogs.test.ts` (in `pnpm test`): kein `window.confirm/alert/prompt` außerhalb des Rückfalls in `dialog.ts`, `dialog.ts` wartet auf plugin `confirm`, Capability erlaubt `message`. Dev-Mock bildet plugin-dialog 2.7 nach (Stubs liefern Promises, Rückfragen nur über `plugin:dialog\|message`). Probeweise eingebautes `if (window.confirm(…))` wird erkannt. |
| R10 | niedrig (Layout) | Bei 900×580 (Mindestgröße): lange Fehlermeldungen liefen als Toast links und rechts aus dem Fenster; der Update-Hinweis oben mittig verdeckte Modus-Umschalter, Suche und „Neue Nachricht“ und lag über offenen Dialogen; Passwortfeld im Konto-Dialog ungestylt (weiß, schmal — im Dunkel-Modus auffällig) | Toast bricht um (max. Fensterbreite − 32 px, Text markierbar); Banner unten links, ausgeblendet solange ein Dialog offen ist; Passwort/E-Mail/Suche-Felder wie Textfelder. Alles im UI-Sweep geprüft. |
| R12 | niedrig (L5) | Entschärfte Anhangsnamen erkannten Windows-Gerätenamen nur exakt: „NUL .txt“, „COM¹.log“, „CONOUT$“ gingen durch | `safe_filename` (core): Stamm ohne Leerzeichen am Ende, COM/LPT mit 0–9 und ¹²³, CONIN$/CONOUT$; „COM10“/„Console“ bleiben. Test `filenames_are_defused`. |
| R11 | niedrig (L11) | Fehler der nativen Datei-Dialoge (Anhang wählen/speichern) liefen als unbehandelte Promise ins Leere | abgefangen und angezeigt. |

### 7.2 L1–L13 für mailbox

| | Ergebnis |
|---|---|
| L1 | Rückfragen seit Runde 1 über plugin `confirm` mit `await`; jetzt zusätzlich Wächter-Test und Mock nach Plugin-Verhalten (R9). Kein `alert`/`prompt` (Ordnername über eigenen Dialog). |
| L2 | Backend-Meldungen über `lang::tr` (folgt der App-Sprache, gesetzt beim Start und bei jedem Speichern der Einstellungen); neue Meldungen (Timeout, TLS, STARTTLS, Speichern, Updater) zweisprachig. OS-Fehlertexte (`os error 32` …) bleiben in der Sprache des Systems, mit übersetztem Vorspann. |
| L3 | Erststart-Sprache aus `sys-locale` — nutzt auf macOS `CFLocaleCopyPreferredLanguages`, auf Windows `GetUserPreferredUILanguages`, nicht `LANG` (Quelltext 0.3.2 geprüft) → kein Befund. |
| L4 | Kein CSV-/JSON-Import oder -Export in mailbox → entfällt. |
| L5 | R5, R12. Fremde Anhangsnamen werden im Backend entschärft (`mailbox_core::safe_filename`, seit Runde 1: `\ / : * ? " < > \|`, Steuerzeichen, Bidi, reservierte Namen — in Runde 2 erweitert (R12) —, Länge). Lange Pfade: Rust-`std` setzt unter Windows bei Bedarf `\\?\`. |
| L6 | Kürzel über `platformKeys` (⌘ auf macOS, Strg/Ctrl sonst); Hilfe nennt beide. Kein hartkodiertes „Ctrl“ gefunden. |
| L7 | R8 (Runde 1: V1). |
| L8 | Alle Netzwerk-Befehle async/`spawn_blocking`; R2, R4. |
| L9 | R2, R4, R7; Editor sperrt Verwerfen während des Sendens (`busy`). |
| L10 | Daten als RFC 3339 mit Offset aus Date-Header bzw. INTERNALDATE, Anzeige in Ortszeit über `toLocale*`; Sammel-Posteingang sortiert numerisch. Keine Datumswähler/Wochen. Kein Befund. |
| L11 | R6, R11; Rückfragen siehe L1. |
| L12 | UI-Sweep: keine Texte der jeweils anderen Sprache in 13 Ansichten × DE/EN × dunkel/hell (ganze Wörter, inkl. Tooltips/Platzhalter). Handbuch DE+EN ergänzt (Neu in 1.0, Updates, Wenn etwas klemmt, externe Inhalte). |
| L13 | R6. |

### 7.3 Selbst ausgeführt

| Prüfung | Ergebnis |
|---|---|
| `cargo test --workspace` | mailbox 20 + 5 ignoriert, core 18 — grün |
| `cargo test -p mailbox -- --ignored` gegen GreenMail 2.1.0 (Docker, 13025/13143/13993) + Netz | 5/5 (4 E2E inkl. neu `e2e_tls_self_signed_rejected`, `net_tls_public_servers`) |
| `cargo clippy --workspace --all-targets` | 0 Warnungen |
| Windows-Typecheck `cargo check --target x86_64-pc-windows-msvc --workspace --tests` (vom Mac, ohne Linken) | grün |
| `cargo audit` | nur S12 (zip 4.6.1, Windows-Updater; kein 4.x-Fix, erst zip ≥ 9 über updater ≥ 2.14) + „unmaintained“ |
| `pnpm build`, `pnpm test` | grün; 31 Prüfungen (Markdown, Mail-HTML, Dialog-Wächter) |
| `scripts/ui-smoke/ui.mjs` | 38/38, 0 Konsolenfehler (mit dem strengeren Mock) |
| `scripts/ui-smoke/sweep.mjs` (neu) | 141/141 — DE/EN × dunkel/hell bei 900×580: Handbuch, Liste, HTML-Mail, Editor (Experte), alle Einstellungs-Reiter, Konto-Dialog, Update-Fehler (Prüfen/Installieren/Banner), langer Fehler-Toast, Ordner löschen mit Abbrechen, schnelles Weiterklicken |
| Leck-Experiment HTML-Mail (Chromium, Zähl-Socket, App-CSP als Header) | 24 Vektoren → 0 Verbindungen; Positivkontrolle 9 |

### 7.4 Offen / nur auf echter Hardware prüfbar

- S12 (zip im Windows-Updater) bleibt bis zum nächsten Tauri-/Updater-Upgrade.
- Ohne UIDPLUS: endgültiges Löschen und Entwurf ersetzen per `EXPUNGE` des ganzen Ordners (unverändert).
- Listen-Cache (Betreff/Absender der ersten Seite) unverschlüsselt im Cache-Ordner (unverändert, bewusst).
- Echte WebViews (WKWebView/WebView2): CSP-Erbschaft, Bilder laden, Link-/Meta-Entschärfung; native Dialoge (Abbrechen bricht ab); Schlüsselbund/Credential Manager; signierter Updater-Download und Neustart; Windows-Sperren beim Umbenennen (Virenscanner, OneDrive, offene Datei); Firmen-CAs aus dem Systemspeicher; Timeout bei gekapptem Netz auf echter Hardware; Ruhezustand. → Checkliste § 5, Abschnitt „Runde 2“.

## 8. Runde 2 – Verifikation (unabhängiger Prüfer, 2026-10-20)

Geprüft: Diff `aa1a93c..05a9473` (R1–R12), alle Tests selbst neu ausgeführt, geänderte Abläufe im Dev-Mock (headless Chromium) und gegen GreenMail durchgespielt, L1–L13 an weiteren Stellen nachgesehen.

### 8.1 Bestätigt

R1 (rustls 0.23 aus dem vorhandenen Baum, rustls 0.22/webpki 0.102 weg, STARTTLS ohne Klartext-Rückfall, Byte-weises Lesen vor dem Handshake), R2 (Timeouts, Session nach jedem Protokollfehler verworfen), R3, R4, R5, R6, R7, R9, R10, R11, R12 — Code gelesen, Tests grün. R8 im Grundsatz bestätigt, aber umgehbar (W1/W2).

### 8.2 Neu gefunden und behoben

| # | Schwere | Befund | Behebung |
|---|---|---|---|
| W1 | mittel (L7) | Die `http-equiv`-Entschärfung aus R8 suchte das Tag mit `<meta\b[^>]*>` — ein `>` in einem Attributwert *vor* `http-equiv` beendete die Suche zu früh: `<meta content="0;url=…?a>b" http-equiv="refresh">` blieb wirksam (Node-Test, reproduziert). | Kleiner Tokenizer nach HTML-Regeln (`defuseHttpEquiv` in `src/mailHtml.ts`: Werte in "…"/'…', Namensende an Leerraum `/` `>` `=`, linear). In Chromium per `DOMParser` gegen 9 Vektoren geprüft: nur noch die zwei eigenen `http-equiv`-Metas. |
| W2 | mittel (L7) | `<link http-equiv="refresh" content="0;url=…">` aus der Mail wurde von mailbox selbst zu `<meta data-link http-equiv="refresh" …>` umgebaut — also zu einer *aktiven* Weiterleitung (die `http-equiv`-Ersetzung lief vor der `<link>`→`<meta>`-Umwandlung und nur auf `<meta>`). | Der Tokenizer entschärft `<meta>` **und** `<link>` vor der Umwandlung. Neue Prüfungen in `scripts/mailhtml.test.ts`. (Chromium sperrt refresh in der Sandbox ohnehin; WebKit laut Spezifikation ebenso — Verteidigung in der Tiefe.) |
| W3 | niedrig (L9) | Konto löschen, während ein Befehl auf dessen Session wartet: `SessionPool::with` hatte das Konto schon gelesen und verband nach dem `drop_session` neu (Session hing bis Programmende am gelöschten Konto); `do_list` schrieb danach den Listen-Cache (Betreff/Absender) neu in den eben gelöschten Cache-Ordner. | `with` prüft das Konto nach dem Warten auf die Session erneut; `do_list` schreibt den Cache nur, wenn das Konto noch existiert. |
| W4 | niedrig (L5) | R5 schreibt Anhänge über `.{Name}.mailbox-{pid}.part`: bei langen Namen (≥ ~235 Bytes) sprengte der Temp-Name die 255er-Grenze (APFS/NTFS) → Speichern scheiterte, wo direktes Schreiben ging; zwei gleichzeitige Speichervorgänge desselben Namens teilten sich die Temp-Datei; in Ordnern ohne Anlegerecht (nur die gewählte Datei freigegeben) scheiterte es ganz. | Temp-Name aus höchstens 32 Zeichen + PID + laufender Nummer; bei `PermissionDenied` beim Anlegen direkt in die gewählte Datei (Verhalten bis 1.0). Unit-Tests: 250-Byte-Name, Ordner ohne Schreibrecht. |
| W5 | niedrig (L8) | `do_save_account` hielt die Kontenliste gesperrt, während es den Schlüsselbund schrieb — eine System-Rückfrage hätte jeden Befehl blockiert, der die Liste braucht, auch das synchrone `list_accounts` auf dem UI-Thread. | Schlüsselbund außerhalb der Sperre; wurde das Konto währenddessen gelöscht, wird es nicht wieder angelegt und das Passwort entfernt. |
| W6 | niedrig (L9) | R7 schützte nur gegen Weiterklicken. Nach Ordnerwechsel/Löschen/ersetztem Entwurf lief eine noch ausstehende `get_message`-Antwort weiter und markierte die verlassene Nachricht still als gelesen (im Mock mit verzögerter Antwort reproduziert: `set_flag seen` für UID 3). | `clearDetail()` verwirft ausstehende Antworten (Zähler) an allen Stellen, die die Anzeige leeren. Neue Sweep-Prüfungen mit `window.__mockDelay` (Negativkontrolle ohne Fix: FAIL). |

### 8.3 Selbst ausgeführt (nach den Fixes)

| Prüfung | Ergebnis |
|---|---|
| `cargo test --workspace` | mailbox 21 + 5 ignoriert, core 18 — grün |
| `cargo test -p mailbox -- --ignored e2e` gegen GreenMail 2.1.0 (Docker, 23025/23143/23993) | 4/4 inkl. `e2e_tls_self_signed_rejected` |
| `cargo test -p mailbox -- --ignored net_tls` (Gmail 993, GMX 143 STARTTLS, badssl) | grün |
| `cargo clippy --workspace --all-targets` | 0 Warnungen |
| Windows-Typecheck (`x86_64-pc-windows-msvc`, `--workspace --tests`, ohne Linken) | grün |
| `cargo audit` | unverändert: nur S12 (zip) + „unmaintained“ |
| `pnpm build`, `pnpm test` | grün; 33 Prüfungen |
| `scripts/ui-smoke/ui.mjs` | 38/38, 0 Konsolenfehler |
| `scripts/ui-smoke/sweep.mjs` | 143/143 (neu: langsame ältere Antwort, Ordnerwechsel ohne stilles Gelesen-Markieren) |
| Chromium-`DOMParser` gegen 9 `http-equiv`-Vektoren | 9/9 entschärft (vorher 2 wirksam) |

### 8.4 Nicht widerlegt, aber Restrisiko / Hinweis

- Timeout ohne Wiederholung (R2): Nach WLAN-Wechsel *innerhalb* von 4 Minuten Leerlauf wartet der erste Befehl bis zu 100 s, bevor „Zeitüberschreitung“ kommt; der nächste Befehl verbindet neu. Bewusst so (nicht idempotente Befehle), auf echter Hardware zu bewerten.
- Passwortänderung mit fehlschlagendem Schreiben von `accounts.json`: der neue Schlüsselbund-Eintrag bleibt (das alte Passwort wird nicht zurückgeschrieben). Selten, beim nächsten Speichern behoben.
- macOS-Datenschutz (TCC): ob das Anlegen der `.part`-Datei neben der im Dialog gewählten Datei in Downloads/Dokumente/Schreibtisch eine Abfrage auslöst, ist nur auf echter Hardware prüfbar (Checkliste § 5, W4); gespeichert wird in jedem Fall.
- Weiterhin nur auf echter Hardware: alles aus § 7.4.


## 9. Runde 3 (2026-10-20, abschließend)

Basis: `ae38b50`. Ziel: jede Aussage in Handbuch (DE/EN), README und In-App-Texten gegen den Code prüfen, Nutzerabläufe Ende-zu-Ende durchspielen, die zwei Reste aus § 7/§ 8 (Timeout ohne Wiederholung, EXPUNGE ohne UIDPLUS) im Code beheben. „Ausgeführt“ heißt: selbst laufen lassen.

### 9.1 Falsche Aussagen im Handbuch → Code behoben

| # | Aussage (Handbuch) | Befund | Behebung / Nachweis |
|---|---|---|---|
| T1 | „⌘⏎ sendet, ⌘S speichert als Entwurf“, „Vorschau (⌘⇧P)“ | Die Kürzel hingen am Textfeld: aus An/Cc/Betreff wirkungslos; in der Vorschau gibt es kein Textfeld → ⌘⇧P kam nicht zurück, ⌘⏎/⌘S taten nichts. | Kürzel editorweit (`window`-Listener in `Compose.tsx`, gesperrt solange das Handbuch offen ist); Formatierung (⌘B/I/E/K/⇧X) bleibt am Textfeld. `journeys.mjs` J4/J6 (DE ⌘ / EN Strg mit `navigator.platform = Win32`); Negativkontrolle mit altem Code: 5 FAIL. |
| T2 | „Umbruch 72 … Zitate und Signatur bleiben unangetastet“ | Nur die Trennzeile „-- “ blieb; lange Signaturzeilen und Code-Blöcke (```) wurden umgebrochen. | `wrapText`: ab „-- “ und in Code-Blöcken kein Umbruch. `pnpm test` (3 neue Prüfungen), J6. |
| T4 | „Allen antworten nimmt alle Empfänger außer Ihnen selbst“ | Antwort auf eine eigene Nachricht (Gesendet/Entwürfe) ging an einen selbst (Absender = eigene Adresse). | Ist der Absender eine eigene Adresse und kein Reply-To gesetzt, geht die Antwort an die damaligen Empfänger (`App.tsx`). J11. |
| T3 | Einstellungen → Lesen: Seitengröße | Das Feld begrenzte bei jedem Tastendruck auf ≥ 10: „25“ tippen ergab über „2“ → „10“ dann „105“. | Begrenzung 10–500 erst beim Verlassen/Speichern; Abrufintervall 0–120 wie das Feld. J9. |

### 9.2 Ungenaue Aussagen → Text korrigiert (DE+EN gleich)

- Kürzel: Löschen auch mit ⌫ (Rückschritt) — so heißt die Löschtaste auf dem Mac; „u“ schaltet gelesen/ungelesen um (nicht nur „ungelesen“).
- Ordner löschen per Rechtsklick nur für eigene Ordner; Rollen-Ordner (Posteingang, Gesendet, Entwürfe, Spam, Archiv) sind geschützt (Rechtsklick auf den Papierkorb leert ihn).
- Einstellungen: Seitengröße 10–500, Abrufintervall 0–120 Minuten, Kürzel-Übersicht unter App nur im Expertenmodus.
- README „Einfach“: auch Spam und ggf. Archiv (wie `SIMPLE_ROLES`).
- Neu: Kurzprobe/Wiederholung und Löschen ohne UIDPLUS in „Neu in 1.0“, „Liste & Suche“, „Wenn etwas klemmt“.
- DE/EN-Gleichstand maschinell geprüft: je Abschnitt gleiche Zahl an Absätzen und dieselben Zahlen (Ports, Sekunden, Grenzen).

Bestätigt ohne Befund (Code gelesen, teils UI): Server-Vorschlag beim Verlassen des Adressfelds, Hinweis „Passwort liegt in einer Datei“ im Konto-Dialog, keyring mit `apple-native`/`windows-native` (kein Mock-Speicher), Filter (Einfach) nach Betreff/Absender, Text/HTML-Umschalter nur bei beiden Fassungen, Header/Quelltext mit Esc, Kürzel inaktiv in Eingabefeldern, Mehrfachauswahl für Löschen/Verschieben/Stern/gelesen, Rückfrage beim endgültigen Löschen immer, Signatur beim Öffnen des Editors, Zähler Zeichen/Wörter/Zeilen, Auto-Update beim Start, Seitenleisten-Stift (Experte) und Einstellungen → Konten.

### 9.3 Reste behoben

| # | Rest | Behebung | Nachweis |
|---|---|---|---|
| X1 | Timeout ohne Wiederholung: nach WLAN-Wechsel (< 4 min Leerlauf) wartete der erste Befehl bis zu 100 s. | `imap.rs`: eigener Datenstrom mit verstellbarem Timeout (`TimeoutKnob`, Klartext und TLS). Vor dem Wiederbenutzen einer Session mit > 30 s Leerlauf **NOOP mit 8 s**; scheitert sie, neue Verbindung und dann der eigentliche Befehl. `SessionPool::read` für idempotente Befehle (Ordnerliste, Liste, Suche, Nachricht/Anhang laden, Flags): nach Timeout auf einer *weiterbenutzten* Verbindung ein zweiter Versuch auf neuer Verbindung; auf einer eben aufgebauten nicht (dann liegt es am Server). `with` (MOVE, APPEND, EXPUNGE, CREATE, DELETE, Papierkorb leeren) unverändert ohne Wiederholung nach Timeout. | Unit: `probe_detects_dead_connection_quickly` (Mini-Server schweigt nach Login: Probe < 2 s falsch, danach wieder 100 s; antwortender Server: wahr), `retry_policy`; E2E `e2e_round3_expunge_and_probe` (Probe auf echter GreenMail-Verbindung nach künstlichem Leerlauf). Echte WLAN-Wechsel nur auf Hardware (Checkliste). |
| X2 | Ohne UIDPLUS: endgültiges Löschen, Entwurf ersetzen und COPY-Rückfall beim Verschieben liefen auf `EXPUNGE` des ganzen Ordners — auch nach *jedem* `UID EXPUNGE`-Fehler (Verbindungsabbruch). | `expunge_uids` entscheidet nach CAPABILITY, nicht nach Fehler. Mit UIDPLUS `UID EXPUNGE`; ohne: `UID SEARCH DELETED`, fremde \Deleted vorübergehend entfernen, `EXPUNGE`, zurücksetzen (auch nach fehlgeschlagenem EXPUNGE). `do_move`-Rückfall nutzt dieselbe Funktion. | Unit `expunge_without_uidplus_spares_other_deleted_messages` (Skript-Server ohne UIDPLUS: genaue Befehlsfolge; mit UIDPLUS: nur `UID EXPUNGE`); E2E: fremde \Deleted-Nachricht bleibt samt Flag, Nachbar bleibt, nur die gemeinte verschwindet. |

### 9.4 Nutzerabläufe (`scripts/ui-smoke/journeys.mjs`, neu)

Je Durchlauf **DE mit macOS-Kürzeln (⌘)** und **EN mit Windows-Kürzeln (Strg)**, 35 Prüfungen × 2, headless Chromium gegen den Dev-Mock. Der Mock bildet nun auch das Abbrechen der Datei-Dialoge nach (`plugin:dialog|open/save` → `null`, wie plugin-dialog 2.7; `window.__mockDialogCancel`).

| | Ablauf | Ergebnis |
|---|---|---|
| J1 | Erststart: Tutorial bis zum Ende, Neustart → nicht erneut | ok |
| J2 | Konto anlegen: Server-Vorschlag beim Verlassen des Adressfelds, Verbindungstest IMAP+SMTP, Esc | ok |
| J3 | Anhang speichern: Dialog abgebrochen (nichts geschrieben, kein Toast), **Platte voll** (os error 28), **schreibgeschützter Ordner** (13), **gesperrte Datei** (32, Windows-Hinweis) → Meldung; danach erfolgreich | ok (Fehlertexte aus dem Mock; die Rust-Seite dazu ist per Unit getestet: Ordner ohne Schreibrecht, Ziel ist Ordner, langer Name) |
| J4 | Schreiben (Einfach): Signatur vorbelegt, Anhang-Dialog abgebrochen/gewählt, **⌘/Strg+⏎ aus dem Betreff** sendet mit Anhang | ok (vorher FAIL) |
| J5 | Zeitüberschreitung beim Abrufen → Meldung in App-Sprache; erneut „Abrufen“ → Liste | ok |
| J6 | Experte: Umbruch 72 mit langer Signatur, ⌘/Strg+⇧P Vorschau hin und **zurück**, ⌘/Strg+S aus „An“ | ok (vorher FAIL) |
| J7 | Liste per Tastatur: j/k, s, ⌫ → Rückfrage, Abbrechen löscht nicht | ok |
| J8 | Server-Suche: / fokussiert, Enter, Esc beendet | ok |
| J9 | Seitengröße „25“ tippen, zu klein → 10 beim Speichern; Rechtsklick auf Rollen-Ordner löscht nicht, eigener Ordner nach Rückfrage | ok |
| J10 | **Neustart mitten im Schreiben**: sauberer Start, kein Editor-Rest, Modus bleibt | ok — ungespeicherter Text ist verloren (kein Autosave; das Handbuch verspricht keins) |
| J11 | Eigene Nachricht (Entwurf) „Allen antworten“ → an deren Empfänger, nicht an sich selbst | ok (vorher falsch) |

### 9.5 Selbst ausgeführt (nach den Fixes)

| Prüfung | Ergebnis |
|---|---|
| `cargo test --workspace` | mailbox 24 + 6 ignoriert, core 18 — grün |
| `cargo test -p mailbox -- --ignored e2e` gegen GreenMail 2.1.0 (Docker, 33025/33143/33993) | 5/5 inkl. neu `e2e_round3_expunge_and_probe` |
| `cargo test -p mailbox -- --ignored net_tls` | grün |
| `cargo clippy --workspace --all-targets` | 0 Warnungen |
| Windows-Typecheck (`x86_64-pc-windows-msvc`, `--workspace --tests`, ohne Linken) | grün |
| `cargo audit` / `pnpm audit` | unverändert: nur S12 (zip) + „unmaintained“ / 0 |
| `pnpm build`, `pnpm test` | grün; 36 Prüfungen |
| `scripts/ui-smoke/ui.mjs` | 38/38, 0 Konsolenfehler |
| `scripts/ui-smoke/sweep.mjs` | 143/143 |
| `scripts/ui-smoke/journeys.mjs` | 70/70 (DE/⌘ + EN/Strg), 0 Konsolenfehler |

Keine neuen Abhängigkeiten. Version bleibt 1.0.0.

### 9.6 Nur auf echter Hardware prüfbar (zusätzlich zu § 7.4)

- [ ] macOS und Windows: Liste offen, WLAN wechseln (anderes Netz), binnen 1–3 min „Abrufen“ → Liste nach ≤ ~10 s statt 100 s
- [ ] Windows: Strg+Enter / Strg+S aus „An“ und „Betreff“, Strg+Shift+P hin und zurück (der Editor ruft `preventDefault`, damit WebView2 keine eigenen Browser-Kürzel ausführt — headless Chromium ist kein WebView2, also dort prüfen)
- [ ] macOS: ⌘S im Editor löst keinen „Seite sichern“-Dialog des WebViews aus
- [ ] Server ohne UIDPLUS (falls verfügbar, z. B. ältere Courier-/Firmen-Server): Nachricht im Papierkorb endgültig löschen, eine zweite dort per Webmail als gelöscht markiert → nur die gewählte verschwindet
- [ ] Platte voll / schreibgeschützter USB-Stick als Speicherziel für einen Anhang → verständliche Meldung, keine `.part`-Reste

## Runde 3 – Verifikation (2026-10-20)

Unabhängige, skeptische Prüfung von `ae38b50..e245b5f` (T1–T4, X1, X2, Textkorrekturen). Diff gelesen (Plattformen, Async/Rennen, i18n, Handbuch DE/EN), alle Tests selbst neu ausgeführt, 10 weitere Handbuch-Aussagen gegen den Code geprüft. „Ausgeführt“ = selbst laufen lassen; „gelesen“ = nur Code-Review.

### Befunde

| # | Befund | Behebung / Nachweis |
|---|---|---|
| V1 | **Regression aus T2 (ausgeführt nachgewiesen):** `wrapText` fror *alles* ab der Zeile „-- “ ein. Beim Antworten und Weiterleiten setzt mailbox die Signatur **über** Zitat bzw. Original — eine Antwort unter dem Zitat (Bottom-Posting) und weitergeleiteter Text wurden durch „Umbruch 72“ nicht mehr umbrochen (vor Runde 3 schon). | Signaturblock = „-- “ plus genau die Kontosignatur (wird aus dem Editor übergeben), ohne passende Signatur bis zur nächsten Leerzeile; „-- “ in einem Code-Block zählt nicht. `pnpm test` +6 Prüfungen (Negativkontrolle gegen `e245b5f`: 3 FAIL), `journeys.mjs` J6 +1 Prüfung je Sprache (Bottom-Posting unter Signatur und Zitat). Handbuch DE+EN und README angepasst. |
| V2 | „Neu in 1.0“ versprach ohne Einschränkung, eine tote Verbindung falle „nach höchstens 8 s“ auf. Die Probe läuft nur nach > 30 s Leerlauf; darunter gilt weiter 100 s (dann ein Wiederholungsversuch bei lesenden Befehlen). | Text DE+EN: „nach mehr als 30 s Pause innerhalb von 8 s“ (wie schon in „Wenn etwas klemmt“). |

### Geprüft ohne Befund (gelesen, teils ausgeführt)

- T1 editorweite Kürzel: `busy`-Sperre verhindert Doppel-Senden; React-Handler des Textfelds (Formatierung, `preventDefault`) laufen vor dem `window`-Listener; der globale Listen-Handler in `App.tsx` ist bei offenem Editor aus; native Rückfragen (plugin-dialog) blockieren Eingaben ins WebView, ein Senden aus der Verwerfen-Rückfrage heraus ist so nicht möglich. Ausgeführt: J4/J6 DE/⌘ + EN/Strg.
- T3 Seitengröße: Zwischenwerte (z. B. „2“) gehen als Live-Vorschau an die App; einzige Wirkung wäre ein genau dann fälliger Intervall-Abruf mit weniger Zeilen (Backend kappt auf 1–500), gespeichert wird immer 10–500. Bewusst nicht geändert.
- T4: Antwort auf eigene Nachricht; „Allen antworten“ filtert eigene Adressen und Doppelte aus Cc. Ausgeführt: J11.
- X1: `TimeoutKnob` wird vor jeder Socket-Operation übernommen, Probe setzt danach wieder 100 s (Unit); Windows meldet Timeouts als `TimedOut`, `is_timeout` erkennt beide. Alle `read`-Closures (Ordner, Liste, Suche, Nachricht/Anhang, Flags) sind ohne Seiteneffekte außerhalb der Session — ein zweiter Versuch dupliziert nichts. Slot-Mutex hält Probe und Befehl zusammen, kein Rennen um den Regler.
- X2: Befehlsfolge ohne UIDPLUS stimmt mit RFC 4315 § 2.1 überein; Rücksetzen auch nach EXPUNGE-Fehler. Ausgeführt: Unit (Skript-Server) und E2E (GreenMail kann UIDPLUS; der Pfad ohne UIDPLUS ist nur per Skript-Server ausgeführt).

### 10 weitere Handbuch-Aussagen (Stichprobe, nicht in Runde 3 genannt)

| Aussage | Prüfung | Ergebnis |
|---|---|---|
| Fett/kursiv/… „nochmal drücken entfernt die Auszeichnung“ | `wrap()` in `Compose.tsx` erkennt Marker innerhalb und direkt außerhalb der Auswahl | stimmt (gelesen) |
| „Zitat weg“ entfernt Zitatzeilen samt Kopfzeile | `stripQuotes` + `pnpm test` | stimmt (ausgeführt) |
| Kürzel nur im Expertenmodus und nicht in Eingabefeldern | `App.tsx`: `if (!expert) return`, INPUT/TEXTAREA/SELECT | stimmt (gelesen; J7/J8 ausgeführt) |
| Konto entfernen löscht nur lokale Zugangsdaten und Cache | `do_delete_account`: Liste, Session, Passwort, Cache-Ordner — kein Server-Befehl | stimmt (gelesen, Unit) |
| Unbekannte Domain → imap./smtp.<domain> mit Standard-Ports | `core/presets.rs` + Unit `heuristic_fallback` | stimmt (ausgeführt) |
| Prüfung vor dem Senden meldet Einträge ohne gültige Adresse | `smtp::addresses(strict)` + Unit `strict_reports_typos` | stimmt (ausgeführt) |
| Entwurf: Speichern ersetzt den alten, nach dem Senden verschwindet er | `do_save_draft`/`do_send` → `remove_draft` (nur mit \Draft-Flag) | stimmt (gelesen; E2E-Roundtrip ausgeführt) |
| Update-Hinweis nicht, solange ein Dialog offen ist | `App.tsx`: `updateAvail && !compose && !showSettings && !accountEdit && !folderPrompt` | stimmt (gelesen) |
| Rechtsklick: Papierkorb leeren, eigene Ordner löschen, Rollen-Ordner geschützt | `Sidebar.tsx` `onContextMenu` (nur `role === 'other'` löscht) | stimmt (gelesen; J9 ausgeführt) |
| Einfach-Modus zeigt Spam und ggf. Archiv | `SIMPLE_ROLES` in `Sidebar.tsx` | stimmt (gelesen) |

DE/EN-Gleichstand nach den Änderungen erneut per Skript: 13/13 Abschnitte, gleiche Absatzzahl, gleiche Zahlen je Absatz (in „Neu in 1.0“ nur andere Reihenfolge von 30/8 im Satz).

### Restrisiken / Hinweise (nicht behoben)

- Ohne UIDPLUS gehen die fremden \Deleted-UIDs als Komma-Liste ohne Bereiche (`uid_set`) in einen Befehl. Bei sehr vielen (Tausenden) könnte ein Server die Zeile ablehnen → Löschen scheitert sichtbar mit Fehlermeldung, es geht nichts verloren.
- Abrufintervall: UI und Handbuch begrenzen auf 0–120 Minuten, das Backend (`Settings::sanitized`) auf 0–1440. Ein früher gespeicherter Wert über 120 bleibt wirksam, bis er im Dialog geändert wird.
- `cargo audit` zeigt neben S12 (zip, 3 Meldungen) und „unmaintained“ auch `glib` RUSTSEC-2024-0429 („unsound“, nur Linux/GTK, vorbestehend).
- E2E: Der erste Lauf direkt nach dem Container-Start ergab 1/5 (GreenMail war noch nicht bereit); danach zweimal 5/5. Kein Code-Problem, aber beim Wiederholen ein paar Sekunden warten.

### Selbst ausgeführt (nach V1/V2)

| Prüfung | Ergebnis |
|---|---|
| `cargo test --workspace` | mailbox 24 + 6 ignoriert, core 18 — grün (Rust unverändert) |
| E2E gegen GreenMail 2.1.0 (Docker, 43025/43143/43993) | 5/5 (zweimal) |
| `cargo test -p mailbox -- --ignored net_tls` | grün |
| `cargo clippy --workspace --all-targets` | 0 Warnungen |
| Windows-Typecheck (`x86_64-pc-windows-msvc`, `--workspace --tests`, ohne Linken) | grün |
| `cargo audit` / `pnpm audit` | S12 (zip) + Warnungen wie oben / 0 |
| `pnpm build`, `pnpm test` | grün; 42 Prüfungen |
| `scripts/ui-smoke/ui.mjs` | 38/38, 0 Konsolenfehler |
| `scripts/ui-smoke/sweep.mjs` | 143/143 |
| `scripts/ui-smoke/journeys.mjs` | 72/72 (DE/⌘ + EN/Strg), 0 Konsolenfehler |

Keine neuen Abhängigkeiten, Version 1.0.0. Nur auf echter Hardware prüfbar bleibt alles aus § 7.4 und § 9.6 — dazu: „Umbruch 72“ in einer echten Antwort mit Kontosignatur (WKWebView/WebView2 `execCommand('insertText')`).

## Runde 4 – Regressionen (platform)

Prüfung von `ae38b50..0434bef` mit Blick auf Nebenläufigkeit, Plattform und Lebenszyklus (Sperren, Wiederholung, Probe, Tastatur-Listener, Windows-Zweige, DE/EN). Kein Code geändert — kein Fehler gefunden, der einen Fix mit fehlschlagendem Test rechtfertigt.

| Bereich | Ergebnis |
|---|---|
| `SessionPool::run`: Slot-Mutex über Probe + Befehl + Neuverbindung | gehalten nur im `spawn_blocking`-Thread (alle Pool-Nutzer sind `async` + `blocking`), nie auf dem UI-Thread; keine verschachtelte Pool-Nutzung in `read`/`with`-Closures (kein Selbst-Deadlock); Konto-Neuprüfung nach dem Warten (W3) bleibt vor der Probe |
| `TimeoutKnob`/`Stream` | Regler wird nur unter dem Slot-Mutex verstellt; `sync()` vor jedem `read`/`write` (BufStream-Flush schreibt über `write`); Windows-Typecheck (`x86_64-pc-windows-msvc --workspace --tests`) grün; `max(1)` verhindert `set_read_timeout(0)` (Fehler unter Windows) |
| Wiederholung | `read` nur für Ordner/Liste/Suche/Nachricht/Flags; MOVE/APPEND/EXPUNGE/CREATE/DELETE weiter `with` |
| Editor-Kürzel (`window`-Listener) | genau ein Listener je Editor, Aufräumen im Effekt; Handbuch offen → aus; Strg+Alt (AltGr unter Windows) ausgenommen |
| Handbuch DE/EN der geänderten Texte | inhaltlich gleich (Kürzel, Probe 30 s/8 s, Wiederholung, Umbruch 72, Seitengröße/Intervall) |

Korrigiert (nur Doku): Checkliste § 5 „Hängender Server … nach ≤ 100 s“ stimmte seit Runde 3 nicht mehr — ohne Probe (Pause < 30 s) wiederholen lesende Befehle nach dem Timeout einmal mit neuer Verbindung (+ bis 20 s Verbindungsaufbau).

Restrisiken (nicht behoben, kein Regressionsfix):
- Vorschau im Experten-Editor ist ein `sandbox=""`-Iframe. Klickt man **in** die Vorschau, liegt der Tastaturfokus im Iframe; ⌘/Strg+⏎, ⌘/Strg+S, ⌘/Strg+⇧P und Esc erreichen den Editor dann nicht, bis man außerhalb klickt. Das Handbuch („auch … in der Vorschau“) gilt für den Normalfall (Umschalten per Knopf/Kürzel). Ein Fix bräuchte Fokus-Umlenkung — keine Regressionsbehebung, daher offen.
- `drop_session` meldet sich auf einer < 4 min alten Verbindung höflich ab (LOGOUT); ist sie nach WLAN-Wechsel tot, wartet Konto speichern/entfernen bis 100 s (im Hintergrund-Thread, App bedienbar). Vorbestehend; der Regler aus Runde 3 könnte das später auf 8 s kürzen.

Selbst ausgeführt: `cargo test --workspace` (mailbox 24 + 6 ignoriert, core 18) grün; Windows-Typecheck grün; `pnpm test` und `pnpm build` grün.

## Runde 4 – Regressionen (behaviour)

Prüfung von `ae38b50..0434bef` mit Blick auf Nutzerverhalten und Datensicherheit: für jede geänderte Funktion Eingaben, die vorher funktionierten, gegen den neuen Stand (Vergleich im temporären Worktree).

| # | Befund | Behebung / Nachweis |
|---|---|---|
| R1 | **Regression aus T4:** „eigene Nachricht“ war jede Mail von *irgendeinem* eigenen Konto. Eine Mail vom zweiten eigenen Konto (Büro → Max) ging beim Antworten aus Max’ Posteingang an Max selbst statt an Büro (vor Runde 3 korrekt an Büro). | `App.tsx`: eigen = Absender ist genau das Konto der Nachricht; „Allen antworten“ filtert weiterhin alle eigenen Adressen aus Cc. `journeys.mjs` J12 (DE/⌘ + EN/Strg; Mock-Hook `__mockDetailPatch`): vor dem Fix FAIL („Max Muster <max@…>“), danach ok; J11 weiter ok. |

Geprüft ohne Befund (gelesen): Kurzprobe/Wiederholung (`read` nur für Ordner, Liste, Suche, Nachricht/Anhang, Flags — keine Seiteneffekte außerhalb der Session; Cache wird erst nach dem Abruf geschrieben), `expunge_uids` mit/ohne UIDPLUS inkl. `do_move`-Rückfall (meldet einen `UID EXPUNGE`-Fehler jetzt sichtbar statt den ganzen Ordner zu leeren — höchstens Dublette, kein Verlust), Klartext-/TLS-Datenstrom mit Regler, editorweite Kürzel (Formatierung nur Experte, ⌘⏎/⌘S in beiden Modi wie vorher), `wrapText` mit Kontosignatur (Signatur mit Schluss-Leerzeile, Leerzeile in der Signatur, fremde „-- “ im weitergeleiteten Original), Seitengröße/Abrufintervall (kein automatischer Neuabruf bei Live-Vorschau; gespeichert wird 10–500).

Selbst ausgeführt: `cargo test --workspace` (24 + 6 ignoriert, 18) grün; `pnpm test`, `pnpm build` grün; `ui.mjs` ALL OK; `journeys.mjs` 72/74 — die 2 FAIL sind J2 „servers suggested on blur“ und treten auch auf dem unveränderten Stand `0434bef` im Worktree auf (headless-`blur` ohne Fensterfokus, vermutlich parallele Chrome-Instanzen; Code von J2 in dieser Runde unverändert). Keine neuen Abhängigkeiten, Version 1.0.0.
