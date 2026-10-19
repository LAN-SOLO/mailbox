# mailbox. 1.0 — Funktions- und Sicherheitsaudit

Stand: 2026-10-19 · Basis: `0864694` (v0.1.0 + Hilfe-Sprachumschalter) · Ziel: Test-Build 1.0.0 für macOS und Windows.

Legende Teststatus:
- **E2E** — automatisiert gegen einen echten IMAP/SMTP-Server (GreenMail 2.1.0 in Docker, `cargo test -p mailbox -- --ignored e2e`)
- **Unit** — automatisierter Rust- bzw. Node-Test (`cargo test --workspace`, `pnpm test`)
- **UI** — automatisiert im Dev-Mock über headless Chrome (`scripts/ui-smoke/ui.mjs`, 38 Prüfungen)
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
| S11 | mittel (offen) | `imap 3.0.0-alpha.15` zieht `rustls-connector 0.19` → rustls 0.22.4 / rustls-webpki 0.102.8 (RUSTSEC-2026-0346/0349, -0049/0098/0099/0104). Kein kompatibles Update ohne Wechsel der IMAP-Bibliothek. Praktisch: keine CRLs im Einsatz (0104/0049 nicht erreichbar), Debug-Ausgaben von Sessions gibt es nicht (0346); Name-Constraint-Fehler (0098/0099) betreffen nur Zertifikate mit Name Constraints. | offen — Roadmap: IMAP-TLS selbst aufbauen (rustls 0.23) oder Bibliothek wechseln |
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

- Keine Timeouts auf IMAP-Sockets (Bibliothek bietet keinen Zugriff); abgefangen wird der häufige Fall (Ruhezustand) über die Neuverbindung nach Leerlauf. Ein mitten im Befehl hängender Server blockiert das Konto, bis TCP aufgibt.
- Ohne UIDPLUS fällt endgültiges Löschen auf `EXPUNGE` des ganzen Ordners zurück (entfernt alle dort mit \Deleted markierten Nachrichten).
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

