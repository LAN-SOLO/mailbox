import { useState } from 'react';
import { Lang } from '../i18n';

// Selbstständiges Hilfe-System: schwebender ?-Button, First-Run-Tutorial
// und durchsuchbares Handbuch. Inhalte liegen bewusst hier, nicht in i18n.ts.

const SEEN_KEY = 'mailbox.tutorialSeen';

interface Step {
  title: string;
  body: string[];
}

interface Section {
  id: string;
  title: string;
  body: string[];
}

interface Content {
  labels: {
    fab: string;
    tutorial: string;
    manual: string;
    search: string;
    next: string;
    back: string;
    skip: string;
    done: string;
    stepOf: (n: number, total: number) => string;
    noResults: string;
  };
  tutorial: Step[];
  sections: Section[];
}

const de: Content = {
  labels: {
    fab: 'Hilfe & Handbuch',
    tutorial: 'Tutorial',
    manual: 'Handbuch',
    search: 'Handbuch durchsuchen …',
    next: 'Weiter',
    back: 'Zurück',
    skip: 'Überspringen',
    done: 'Los geht’s',
    stepOf: (n, total) => `Schritt ${n} von ${total}`,
    noResults: 'Keine Treffer',
  },
  tutorial: [
    {
      title: 'Willkommen bei mailbox.',
      body: [
        'mailbox ist ein schlanker Mail-Client für IMAP und SMTP — also für praktisch jedes Postfach, das du heute schon nutzt.',
        'Zwei Modi: „Einfach“ zeigt nur, was man zum Mailen braucht. „Experte“ schaltet Ordnerbaum, Verschieben, Suche auf dem Server, Quelltext und Tastaturkürzel frei.',
        'Alles bleibt auf deinem Rechner: Konten und Cache im Datenordner, Passwörter im Schlüsselbund deines Systems. Keine Cloud, keine Telemetrie.',
        'Dieses Tutorial dauert zwei Minuten. Du findest es jederzeit wieder über den ?-Knopf unten rechts.',
      ],
    },
    {
      title: 'Ein Konto verbinden',
      body: [
        '„Konto hinzufügen“ — dann E-Mail-Adresse und Passwort eintragen. Für gängige Anbieter erkennt mailbox IMAP- und SMTP-Server automatisch, sobald du das Adressfeld verlässt.',
        '• Große Anbieter mit Zwei-Faktor-Anmeldung verlangen ein App-Passwort — das legst du beim Anbieter an und trägst es hier ein.',
        '• „Verbindung testen“ prüft IMAP und SMTP getrennt und sagt genau, was klemmt.',
        '• Unbekannter Anbieter? Server-Einstellungen aufklappen und Host, Port und Verschlüsselung eintragen (üblich: IMAP 993/TLS, SMTP 465/TLS oder 587/STARTTLS).',
      ],
    },
    {
      title: 'Zwei Modi',
      body: [
        'Oben in der Kopfzeile schaltest du jederzeit um:',
        '• Einfach — Posteingang, Gesendet, Entwürfe, Papierkorb, Spam. Lesen, antworten, weiterleiten, löschen, archivieren, Stern. Filtern in der Liste.',
        '• Experte — kompletter Ordnerbaum mit Zählern, Sammel-Posteingang über alle Konten, Verschieben in beliebige Ordner, Mehrfachauswahl, Suche auf dem Server, Header- und Quelltext-Ansicht, Tastaturkürzel.',
        'Der Modus ändert nichts an deinen Daten — nur daran, wie viel Werkzeug sichtbar ist.',
      ],
    },
    {
      title: 'Lesen & Ordner',
      body: [
        'Links die Ordner, in der Mitte die Liste (neueste zuerst), rechts die Nachricht.',
        '• Die Liste zeigt zuerst den lokalen Cache und gleicht dann mit dem Server ab — „Mehr laden“ holt ältere Nachrichten nach.',
        '• Ungelesene Nachrichten sind fett mit blauem Punkt; ein Klick auf den Stern markiert wichtige.',
        '• HTML-Mails laufen in einer abgeschotteten Ansicht: externe Bilder und Tracking-Pixel werden nicht geladen, bis du es je Nachricht erlaubst.',
        '• Anhänge stehen als Schaltflächen über dem Text — Klick speichert sie dahin, wo du willst.',
      ],
    },
    {
      title: 'Schreiben',
      body: [
        '„Neue Nachricht“ oben links (oder n im Expertenmodus). Antworten, Allen antworten und Weiterleiten sitzen direkt über der geöffneten Nachricht.',
        '• Empfänger als Liste: „Max Muster <max@example.org>, anna@example.org“ — Cc und Bcc bei Bedarf einblenden.',
        '• Anhänge über „Anhang …“, so viele du willst.',
        '• Die Signatur des Kontos steht schon unter dem Text; beim Antworten wird die Originalnachricht zitiert (abschaltbar in den Einstellungen).',
        '• Gesendetes landet automatisch im Gesendet-Ordner des Servers, Entwürfe im Entwürfe-Ordner.',
      ],
    },
    {
      title: 'Privatsphäre & Sicherheit',
      body: [
        '• Verbindungen laufen verschlüsselt (TLS/STARTTLS); selbstsignierte Zertifikate lehnt mailbox ab, statt sie stillschweigend zu akzeptieren.',
        '• Passwörter liegen im Schlüsselbund des Systems (macOS Schlüsselbund, Windows Credential Manager, Linux Secret Service). Ist keiner verfügbar, weicht mailbox auf eine Datei im App-Ordner aus und sagt das im Konto-Dialog.',
        '• Externe Inhalte in HTML-Mails sind standardmäßig blockiert.',
        '• Kein Konto bei uns, keine Telemetrie, kein Server dazwischen — mailbox spricht nur mit deinem Mail-Anbieter.',
        'Viel Spaß mit mailbox.',
      ],
    },
  ],
  sections: [
    {
      id: 'accounts',
      title: 'Konten & Anbieter',
      body: [
        'Ein Konto besteht aus Name (Absender), E-Mail-Adresse, Benutzername (meist die Adresse), Passwort und je einem IMAP- und SMTP-Server.',
        'Beim Verlassen des Adressfelds schlägt mailbox die Server für gängige Anbieter vor; für andere Domains wird imap.<domain> / smtp.<domain> mit Standard-Ports versucht — bitte prüfen.',
        '• Große Anbieter mit Zwei-Faktor-Anmeldung brauchen ein App-Passwort (beim Anbieter unter Sicherheit anlegen). Manche verlangen zusätzlich, IMAP im Web-Postfach zu aktivieren.',
        '• „Verbindung testen“ meldet IMAP und SMTP getrennt — ein SMTP-Fehler bei funktionierendem IMAP heißt meist: falscher Port oder Verschlüsselung (465/TLS gegen 587/STARTTLS tauschen).',
        '• Konten bearbeiten: im Expertenmodus über das Stift-Symbol neben dem Kontonamen in der Seitenleiste, sonst über Einstellungen → Konten.',
        '• Konto entfernen löscht nur die lokalen Zugangsdaten und den Cache — auf dem Server bleibt alles.',
      ],
    },
    {
      id: 'modes',
      title: 'Einfach & Experte',
      body: [
        'Der Modus-Schalter sitzt in der Kopfzeile; die Einstellung wird gespeichert.',
        '• Einfach: Rollen-Ordner (Posteingang, Gesendet, Entwürfe, Papierkorb, Spam, ggf. Archiv), Lesen, Antworten, Weiterleiten, Löschen, Archivieren, Stern, gelesen/ungelesen, Filtern in der Liste.',
        '• Experte: zusätzlich Ordnerbaum mit Zählern, Ordner anlegen/löschen, Papierkorb leeren, Sammel-Posteingang, Verschieben, Spam-Markierung, Mehrfachauswahl, Server-Suche mit Bereich, Header/Quelltext, externe Bilder global, Kontofarben, Tastaturkürzel.',
      ],
    },
    {
      id: 'folders',
      title: 'Ordner',
      body: [
        'mailbox erkennt die Rolle eines Ordners über die Kennzeichnung des Servers (Special-Use) oder über gängige Namen (Sent/Gesendet, Trash/Papierkorb, Junk/Spam, Drafts/Entwürfe, Archive/Archiv).',
        '• Ordner anlegen (Experte): Name eingeben, Unterordner mit dem Trennzeichen des Servers, z. B. „INBOX/Projekte“ oder „INBOX.Projekte“.',
        '• Ordner löschen entfernt ihn samt Inhalt auf dem Server — mailbox fragt vorher nach.',
        '• Papierkorb leeren löscht endgültig.',
        '• Unter „Alle Posteingänge“ (Experte) siehst du die Posteingänge aller Konten in einer Liste; Aktionen wirken auf das jeweilige Konto.',
      ],
    },
    {
      id: 'list',
      title: 'Liste & Suche',
      body: [
        'Die Liste zeigt die neuesten Nachrichten zuerst; „Mehr laden“ holt die nächste Seite (Seitengröße in den Einstellungen).',
        '• Beim Ordnerwechsel erscheint sofort der lokale Cache („aus dem Cache“), dann der Abgleich mit dem Server.',
        '• Filterfeld (Einfach): filtert die geladenen Zeilen nach Betreff und Absender.',
        '• Suche (Experte): Enter schickt die Suche an den Server — Bereich „alles“, Betreff, Von, An oder Text. Esc beendet die Suche.',
        '• Mehrfachauswahl (Experte): Häkchen in den Zeilen; Löschen, Verschieben, Stern und gelesen/ungelesen wirken dann auf die Auswahl.',
      ],
    },
    {
      id: 'reading',
      title: 'Lesen',
      body: [
        'Beim Öffnen wird eine Nachricht als gelesen markiert (abschaltbar). Über der Nachricht: Antworten, Allen antworten, Weiterleiten, Archivieren, ungelesen, Stern, Löschen.',
        '• HTML-Mails laufen in einem abgeschotteten Rahmen ohne Skripte; externe Bilder sind blockiert, bis du „Externe Bilder laden“ klickst. Links öffnen sich im Browser.',
        '• „Text / HTML“ schaltet um, wenn die Nachricht beide Fassungen enthält.',
        '• Anhänge: Klick auf die Schaltfläche → Speicherort wählen. Eingebettete Bilder werden direkt angezeigt.',
        '• Experte: „Header“ zeigt alle Kopfzeilen, „Quelltext“ die rohe Nachricht — praktisch bei Zustellproblemen und Phishing-Verdacht.',
      ],
    },
    {
      id: 'compose',
      title: 'Schreiben, Antworten, Anhänge',
      body: [
        '„Neue Nachricht“ öffnet den Editor mit Konto-Auswahl, Empfängern, Betreff und Text. Cc und Bcc lassen sich einblenden.',
        '• Empfänger frei eingeben: „Name <adresse>“ oder nur die Adresse, mehrere durch Komma.',
        '• Antworten setzt Betreff (Re:) und Zitat; „Allen antworten“ nimmt alle Empfänger außer dir selbst. Weiterleiten übernimmt den Text mit Kopfzeilen.',
        '• Anhänge über „Anhang …“ (Dateidialog, Mehrfachauswahl).',
        '• „Senden“ verschickt über SMTP und legt eine Kopie im Gesendet-Ordner ab. „Als Entwurf speichern“ legt die Nachricht im Entwürfe-Ordner des Servers ab.',
        '• Nachrichten sind Klartext — die Signatur des Kontos wird automatisch angehängt.',
      ],
    },
    {
      id: 'expert',
      title: 'Werkzeuge im Expertenmodus',
      body: [
        '• Verschieben …: Zielordner aus dem gesamten Baum wählen.',
        '• Spam: verschiebt in den Spam-Ordner des Kontos.',
        '• Header/Quelltext: vollständige Kopfzeilen bzw. rohe Nachricht, zum Kopieren markierbar.',
        '• Externe Bilder global erlauben: Einstellungen → Lesen (weniger Privatsphäre).',
        '• Kontofarbe: kennzeichnet Nachrichten im Sammel-Posteingang.',
      ],
    },
    {
      id: 'shortcuts',
      title: 'Tastaturkürzel (Experte)',
      body: [
        '• j / k — nächste / vorherige Nachricht',
        '• r / a / f — Antworten / Allen antworten / Weiterleiten',
        '• e — Archivieren · # oder Entf — Löschen',
        '• s — Stern · u — ungelesen',
        '• / — Suche fokussieren · n — neue Nachricht · Esc — Dialog schließen',
        'Kürzel wirken nicht, während ein Eingabefeld den Fokus hat.',
      ],
    },
    {
      id: 'settings',
      title: 'Einstellungen',
      body: [
        '• Allgemein: Sprache, Modus, Darstellung (dunkel/hell), Akzentfarbe.',
        '• Lesen: beim Öffnen als gelesen markieren, externe Bilder (Experte), Seitengröße, Abrufintervall.',
        '• Schreiben: Zitat beim Antworten, Nachfrage vor dem Löschen.',
        '• Konten: anlegen, bearbeiten, entfernen.',
        '• App: Updates, Datenordner, Kürzel.',
      ],
    },
    {
      id: 'updates',
      title: 'Updates',
      body: [
        'mailbox prüft beim Start still auf neue Versionen und zeigt einen Hinweis. Mit Auto-Update wird direkt installiert.',
        'Updates sind signiert — die App installiert nur Pakete, deren Signatur zum eingebauten Schlüssel passt.',
      ],
    },
    {
      id: 'trouble',
      title: 'Wenn etwas klemmt',
      body: [
        '• „Login fehlgeschlagen“: Bei Anbietern mit Zwei-Faktor-Anmeldung ein App-Passwort verwenden; Benutzername ist meist die volle Adresse. Manche Anbieter verlangen, IMAP-Zugriff im Web-Postfach einzuschalten.',
        '• TLS-/Zertifikatsfehler: mailbox akzeptiert keine selbstsignierten oder abgelaufenen Zertifikate. Hostnamen prüfen (imap.example.org statt der IP-Adresse).',
        '• Ports: IMAP 993 (TLS) oder 143 (STARTTLS); SMTP 465 (TLS) oder 587 (STARTTLS). Port 25 ist bei Privatanschlüssen meist gesperrt.',
        '• Linux ohne Secret Service (GNOME Keyring/KWallet): Passwort wird in einer Datei im App-Ordner gespeichert — der Konto-Dialog weist darauf hin.',
        '• Liste bleibt leer: „Abrufen“ klicken; bei Verbindungsabbruch verbindet mailbox beim nächsten Befehl neu.',
        '• Gesendet-Kopie fehlt: Der Server kennzeichnet keinen Gesendet-Ordner — im Expertenmodus einen Ordner „Sent“ anlegen.',
      ],
    },
  ],
};

const en: Content = {
  labels: {
    fab: 'Help & manual',
    tutorial: 'Tutorial',
    manual: 'Manual',
    search: 'Search the manual …',
    next: 'Next',
    back: 'Back',
    skip: 'Skip',
    done: 'Let’s go',
    stepOf: (n, total) => `Step ${n} of ${total}`,
    noResults: 'No results',
  },
  tutorial: [
    {
      title: 'Welcome to mailbox.',
      body: [
        'mailbox is a lean mail client for IMAP and SMTP — which means practically every mailbox you already use.',
        'Two modes: “Simple” shows only what you need to do mail. “Expert” unlocks the folder tree, moving, server-side search, source view and keyboard shortcuts.',
        'Everything stays on your machine: accounts and cache in the data folder, passwords in your system keychain. No cloud, no telemetry.',
        'This tutorial takes two minutes. You can reopen it any time via the ?-button bottom right.',
      ],
    },
    {
      title: 'Connect an account',
      body: [
        '“Add account” — enter e-mail address and password. For common providers mailbox detects IMAP and SMTP servers as soon as you leave the address field.',
        '• Large providers with two-factor login require an app password — create it with the provider and enter it here.',
        '• “Test connection” checks IMAP and SMTP separately and tells you exactly what is wrong.',
        '• Unknown provider? Expand the server settings and enter host, port and encryption (typical: IMAP 993/TLS, SMTP 465/TLS or 587/STARTTLS).',
      ],
    },
    {
      title: 'Two modes',
      body: [
        'Switch at any time in the header:',
        '• Simple — Inbox, Sent, Drafts, Trash, Spam. Read, reply, forward, delete, archive, star. Filter the list.',
        '• Expert — full folder tree with counts, unified inbox across accounts, move to any folder, multi-select, server-side search, header and source view, keyboard shortcuts.',
        'The mode never changes your data — only how much tooling is visible.',
      ],
    },
    {
      title: 'Reading & folders',
      body: [
        'Folders on the left, the list in the middle (newest first), the message on the right.',
        '• The list shows the local cache first and then syncs with the server — “Load more” fetches older messages.',
        '• Unread messages are bold with a blue dot; click the star to mark important ones.',
        '• HTML mail runs in an isolated view: remote images and tracking pixels are not loaded until you allow it per message.',
        '• Attachments appear as buttons above the text — click to save them wherever you like.',
      ],
    },
    {
      title: 'Writing',
      body: [
        '“New message” top left (or n in expert mode). Reply, Reply all and Forward sit right above the open message.',
        '• Recipients as a list: “Jane Doe <jane@example.org>, sam@example.org” — reveal Cc and Bcc when needed.',
        '• Attachments via “Attach …”, as many as you like.',
        '• The account signature is already below the text; replies quote the original (can be turned off in settings).',
        '• Sent mail lands in the server’s Sent folder automatically, drafts in the Drafts folder.',
      ],
    },
    {
      title: 'Privacy & security',
      body: [
        '• Connections are encrypted (TLS/STARTTLS); mailbox rejects self-signed certificates instead of accepting them silently.',
        '• Passwords live in the system keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service). If none is available, mailbox falls back to a file in the app folder and says so in the account dialog.',
        '• Remote content in HTML mail is blocked by default.',
        '• No account with us, no telemetry, no server in between — mailbox talks only to your mail provider.',
        'Enjoy mailbox.',
      ],
    },
  ],
  sections: [
    {
      id: 'accounts',
      title: 'Accounts & providers',
      body: [
        'An account consists of name (sender), e-mail address, username (usually the address), password and one IMAP and one SMTP server.',
        'When you leave the address field mailbox suggests servers for common providers; for other domains it tries imap.<domain> / smtp.<domain> with standard ports — please verify.',
        '• Large providers with two-factor login need an app password (create it under the provider’s security settings). Some also require enabling IMAP in the webmail.',
        '• “Test connection” reports IMAP and SMTP separately — an SMTP error with working IMAP usually means wrong port or encryption (swap 465/TLS and 587/STARTTLS).',
        '• Edit accounts: in expert mode via the pencil next to the account name in the sidebar, otherwise via Settings → Accounts.',
        '• Removing an account only deletes local credentials and cache — everything stays on the server.',
      ],
    },
    {
      id: 'modes',
      title: 'Simple & expert',
      body: [
        'The mode switch sits in the header; the setting is saved.',
        '• Simple: role folders (Inbox, Sent, Drafts, Trash, Spam, Archive if present), read, reply, forward, delete, archive, star, read/unread, filter the list.',
        '• Expert: additionally folder tree with counts, create/delete folders, empty trash, unified inbox, move, spam marking, multi-select, server search with scope, headers/source, remote images globally, account colours, keyboard shortcuts.',
      ],
    },
    {
      id: 'folders',
      title: 'Folders',
      body: [
        'mailbox detects a folder’s role via the server’s special-use flags or via common names (Sent, Trash, Junk/Spam, Drafts, Archive).',
        '• Create folder (expert): enter a name; nest with the server delimiter, e.g. “INBOX/Projects” or “INBOX.Projects”.',
        '• Deleting a folder removes it with its contents on the server — mailbox asks first.',
        '• Empty trash deletes permanently.',
        '• “All inboxes” (expert) shows the inboxes of all accounts in one list; actions apply to the respective account.',
      ],
    },
    {
      id: 'list',
      title: 'List & search',
      body: [
        'The list shows the newest messages first; “Load more” fetches the next page (page size in settings).',
        '• On folder change the local cache appears immediately (“from cache”), then the server sync.',
        '• Filter box (simple): filters loaded rows by subject and sender.',
        '• Search (expert): Enter sends the search to the server — scope “all”, subject, from, to or body. Esc clears the search.',
        '• Multi-select (expert): tick the rows; delete, move, star and read/unread then apply to the selection.',
      ],
    },
    {
      id: 'reading',
      title: 'Reading',
      body: [
        'Opening a message marks it as read (can be turned off). Above the message: Reply, Reply all, Forward, Archive, Unread, Star, Delete.',
        '• HTML mail runs in an isolated frame without scripts; remote images are blocked until you click “Load remote images”. Links open in your browser.',
        '• “Text / HTML” toggles when the message contains both versions.',
        '• Attachments: click the button → choose a location. Embedded images are shown inline.',
        '• Expert: “Headers” shows all header lines, “Source” the raw message — handy for delivery issues and suspected phishing.',
      ],
    },
    {
      id: 'compose',
      title: 'Writing, replying, attachments',
      body: [
        '“New message” opens the editor with account selection, recipients, subject and text. Cc and Bcc can be revealed.',
        '• Enter recipients freely: “Name <address>” or just the address, several separated by commas.',
        '• Reply sets the subject (Re:) and quote; “Reply all” takes all recipients except yourself. Forward takes over the text with header lines.',
        '• Attachments via “Attach …” (file dialog, multi-select).',
        '• “Send” delivers via SMTP and stores a copy in the Sent folder. “Save as draft” stores the message in the server’s Drafts folder.',
        '• Messages are plain text — the account signature is appended automatically.',
      ],
    },
    {
      id: 'expert',
      title: 'Expert tools',
      body: [
        '• Move to …: pick the target folder from the whole tree.',
        '• Spam: moves to the account’s spam folder.',
        '• Headers/Source: full header lines or raw message, selectable for copying.',
        '• Allow remote images globally: Settings → Reading (less privacy).',
        '• Account colour: marks messages in the unified inbox.',
      ],
    },
    {
      id: 'shortcuts',
      title: 'Keyboard shortcuts (expert)',
      body: [
        '• j / k — next / previous message',
        '• r / a / f — reply / reply all / forward',
        '• e — archive · # or Delete — delete',
        '• s — star · u — unread',
        '• / — focus search · n — new message · Esc — close dialog',
        'Shortcuts are inactive while an input field has focus.',
      ],
    },
    {
      id: 'settings',
      title: 'Settings',
      body: [
        '• General: language, mode, appearance (dark/light), accent colour.',
        '• Reading: mark as read on open, remote images (expert), page size, check interval.',
        '• Writing: quote on reply, confirm before delete.',
        '• Accounts: add, edit, remove.',
        '• App: updates, data folder, shortcuts.',
      ],
    },
    {
      id: 'updates',
      title: 'Updates',
      body: [
        'mailbox silently checks for new versions on launch and shows a banner. With auto-update it installs right away.',
        'Updates are signed — the app only installs packages whose signature matches the built-in key.',
      ],
    },
    {
      id: 'trouble',
      title: 'Troubleshooting',
      body: [
        '• “Login failed”: use an app password with providers that have two-factor login; the username is usually the full address. Some providers require enabling IMAP access in the webmail.',
        '• TLS/certificate errors: mailbox does not accept self-signed or expired certificates. Check the hostname (imap.example.org rather than the IP address).',
        '• Ports: IMAP 993 (TLS) or 143 (STARTTLS); SMTP 465 (TLS) or 587 (STARTTLS). Port 25 is usually blocked on consumer connections.',
        '• Linux without Secret Service (GNOME Keyring/KWallet): the password is stored in a file in the app folder — the account dialog points this out.',
        '• List stays empty: click “Refresh”; after a dropped connection mailbox reconnects on the next command.',
        '• Sent copy missing: the server does not flag a Sent folder — create a folder “Sent” in expert mode.',
      ],
    },
  ],
};

export function Help({ lang }: { lang: Lang }) {
  const c = lang === 'de' ? de : en;
  const [mode, setMode] = useState<'closed' | 'tutorial' | 'manual'>(() =>
    localStorage.getItem(SEEN_KEY) ? 'closed' : 'tutorial'
  );
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState(c.sections[0].id);
  const [q, setQ] = useState('');

  const close = () => {
    localStorage.setItem(SEEN_KEY, '1');
    setMode('closed');
    setStep(0);
  };

  const query = q.trim().toLowerCase();
  const filtered = query
    ? c.sections.filter(
        (s) =>
          s.title.toLowerCase().includes(query) ||
          s.body.some((p) => p.toLowerCase().includes(query))
      )
    : c.sections;
  const current = filtered.find((s) => s.id === sel) ?? filtered[0] ?? null;

  const para = (p: string, i: number) =>
    p.startsWith('• ') ? (
      <div key={i} className="hlp-li">
        {p.slice(2)}
      </div>
    ) : (
      <p key={i}>{p}</p>
    );

  return (
    <>
      <button className="hlp-fab" title={c.labels.fab} onClick={() => setMode('manual')}>
        ?
      </button>
      {mode !== 'closed' && (
        <div className="hlp-overlay" onClick={close}>
          <div className="hlp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hlp-head">
              <span className="hlp-brand">
                <span className="hlp-name">mailbox</span>
                <span className="hlp-dot">.</span>
              </span>
              <button
                className={`hlp-tab ${mode === 'tutorial' ? 'active' : ''}`}
                onClick={() => {
                  setMode('tutorial');
                  setStep(0);
                }}
              >
                {c.labels.tutorial}
              </button>
              <button
                className={`hlp-tab ${mode === 'manual' ? 'active' : ''}`}
                onClick={() => setMode('manual')}
              >
                {c.labels.manual}
              </button>
              <span className="hlp-spacer" />
              <button className="hlp-close" onClick={close}>
                ✕
              </button>
            </div>

            {mode === 'tutorial' && (
              <div className="hlp-tut">
                <div className="hlp-step-count">{c.labels.stepOf(step + 1, c.tutorial.length)}</div>
                <h2>{c.tutorial[step].title}</h2>
                {c.tutorial[step].body.map(para)}
                <div className="hlp-tut-nav">
                  <button className="hlp-ghost" onClick={close}>
                    {c.labels.skip}
                  </button>
                  <span className="hlp-dots">
                    {c.tutorial.map((_, i) => (
                      <span key={i} className={i === step ? 'on' : ''} />
                    ))}
                  </span>
                  {step > 0 && <button onClick={() => setStep(step - 1)}>{c.labels.back}</button>}
                  {step < c.tutorial.length - 1 ? (
                    <button className="hlp-primary" onClick={() => setStep(step + 1)}>
                      {c.labels.next}
                    </button>
                  ) : (
                    <button className="hlp-primary" onClick={close}>
                      {c.labels.done}
                    </button>
                  )}
                </div>
              </div>
            )}

            {mode === 'manual' && (
              <div className="hlp-body">
                <div className="hlp-toc">
                  <input
                    type="text"
                    placeholder={c.labels.search}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                  {filtered.length === 0 && <div className="hlp-empty">{c.labels.noResults}</div>}
                  {filtered.map((s) => (
                    <button
                      key={s.id}
                      className={`hlp-toc-item ${current?.id === s.id ? 'active' : ''}`}
                      onClick={() => setSel(s.id)}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
                <div className="hlp-content">
                  {current && (
                    <>
                      <h2>{current.title}</h2>
                      {current.body.map(para)}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
