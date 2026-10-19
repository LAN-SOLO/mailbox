# mailbox. 1.0 — Funktions- und Sicherheitsaudit

Stand: 2026-10-20 (Runde 2, § 7) · 2026-10-19 · Basis: `0864694` (v0.1.0 + Hilfe-Sprachumschalter) · Ziel: Test-Build 1.0.0 für macOS und Windows.

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

- ~~Keine Timeouts auf IMAP-Sockets~~ — seit Runde 2 behoben (20 s Verbindungsaufbau, 100 s je Lese-/Schreiboperation; § 7). Eine Operation, die nach dem Timeout abbricht, wird nicht automatisch wiederholt (MOVE/APPEND sind nicht idempotent).
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
- [ ] Ohne Netz (WLAN aus) „Nach Updates suchen“ → rote Meldung in der App-Sprache (nicht stumm)
- [ ] Update-Hinweis beim Start sitzt unten links und verschwindet, solange ein Dialog offen ist

**Runde 2 (Verbindung & Dateien)**
- [ ] macOS und Windows: Konto bei Gmail/GMX/Outlook (993/TLS) und einem Anbieter mit 143/STARTTLS verbinden — „Verbindung testen“ OK (eigene TLS-Schicht, System-Zertifikatsspeicher)
- [ ] Firmen-/Proxy-Zertifizierungsstelle (falls vorhanden) im System installiert → Verbindung klappt; selbst signiertes Zertifikat (z. B. GreenMail 3993) → „TLS-Fehler“
- [ ] Hängender Server: nach Login das Netz kappen (Kabel/WLAN), „Abrufen“ → nach ≤ 100 s „Zeitüberschreitung“, die App bleibt bedienbar; Netz wieder an, „Abrufen“ → Liste kommt
- [ ] Windows: Anhang als PDF speichern, PDF im Acrobat offen lassen, erneut unter **demselben** Namen speichern → Meldung „… vermutlich in einem anderen Programm geöffnet“; nach Schließen klappt es; keine `.part`-Reste im Ordner
- [ ] Windows: Speicherort in OneDrive-Ordner mit Umlaut im Pfad → Datei vollständig, keine `.part`-Reste
- [ ] Konto entfernen, während eine Liste lädt → App friert nicht ein, Konto verschwindet

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
