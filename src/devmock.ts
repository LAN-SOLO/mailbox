// Dev-Mock: simuliert das Tauri-Backend im Browser (nur `pnpm dev` +
// `?mock` in der URL) — für UI-Arbeit ohne laufenden Mail-Server.
// Wird in main.tsx nur im DEV-Modus dynamisch geladen.
import type {
  Account,
  Folder,
  MessageDetail,
  MessageSummary,
  Settings,
} from './api';

// URL-Parameter für UI-Durchläufe: ?mock&lang=en&theme=light&mode=expert
const q = new URLSearchParams(location.search);
const settings: Settings = {
  language: q.get('lang') === 'en' ? 'en' : 'de',
  mode: (q.get('mode') as Settings['mode']) || (localStorage.getItem('mock.mode') as Settings['mode']) || 'simple',
  theme: q.get('theme') === 'light' ? 'light' : 'dark',
  accent: 'blue',
  autoUpdate: false,
  loadRemoteImages: false,
  pageSize: 50,
  checkIntervalMin: 0,
  markReadOnOpen: true,
  confirmDelete: true,
  quoteOnReply: true,
  composeHtml: true,
};

const accounts: Account[] = [
  {
    id: 'a1',
    name: 'Max Muster',
    email: 'max@lan-solo.test',
    imapHost: 'localhost',
    imapPort: 3143,
    imapSecurity: 'none',
    smtpHost: 'localhost',
    smtpPort: 3025,
    smtpSecurity: 'none',
    username: 'max',
    signature: 'Max Muster\nLAN-SOLO',
    color: '#38bdf8',
    passwordStored: 'keychain',
  },
  {
    id: 'a2',
    name: 'Büro',
    email: 'buero@lan-solo.test',
    imapHost: 'localhost',
    imapPort: 3143,
    imapSecurity: 'none',
    smtpHost: 'localhost',
    smtpPort: 3025,
    smtpSecurity: 'none',
    username: 'buero',
    signature: '',
    color: '#a78bfa',
    passwordStored: 'file',
  },
];

const f = (name: string, role: Folder['role'], depth = 0, unread = 0, total = 0, noSelect = false): Folder => ({
  name,
  delimiter: '/',
  display: name.split('/').pop() || name,
  role,
  noSelect,
  depth,
  unread,
  total,
});
const folders: Folder[] = [
  f('INBOX', 'inbox', 0, 2, 3),
  f('Drafts', 'drafts', 0, 0, 1),
  f('Sent', 'sent', 0, 0, 12),
  f('Archive', 'archive', 0, 0, 40),
  f('Junk', 'junk', 0, 1, 1),
  f('Trash', 'trash', 0, 0, 5),
  f('Projekte', 'other', 0, 0, 0, true),
  f('Projekte/2026', 'other', 1, 1, 8),
  f('Projekte/Kunden', 'other', 1, 0, 3),
  f('Newsletter', 'other', 0, 4, 120),
];

const now = Date.now();
const m = (uid: number, from: string, email: string, subject: string, minsAgo: number, extra: Partial<MessageSummary> = {}): MessageSummary => ({
  uid,
  accountId: 'a1',
  folder: 'INBOX',
  from: [{ name: from, email }],
  to: [{ name: 'Max Muster', email: 'max@lan-solo.test' }],
  subject,
  date: new Date(now - minsAgo * 60000).toISOString(),
  seen: false,
  flagged: false,
  answered: false,
  draft: false,
  size: 4210,
  hasAttachments: false,
  ...extra,
});
const drafts: MessageSummary[] = [
  m(10, 'Max Muster', 'max@lan-solo.test', 'Entwurf: Angebot nachfassen', 30, {
    folder: 'Drafts',
    seen: true,
    draft: true,
    hasAttachments: true,
    to: [{ name: 'Anna Beispiel', email: 'anna@lan-solo.test' }],
  }),
];
const messages: MessageSummary[] = [
  m(3, 'Anna Beispiel', 'anna@lan-solo.test', 'Angebot Q4 — mit Anhang', 12, { hasAttachments: true, size: 184320 }),
  m(2, 'Björn Müller', 'bjoern@lan-solo.test', 'Re: Terminvorschlag', 190, { seen: true, answered: true }),
  m(1, 'Anna Beispiel', 'anna@lan-solo.test', 'Willkommen bei mailbox', 60 * 24 * 3, { flagged: true }),
];

function detail(uid: number): MessageDetail {
  const s = [...messages, ...drafts].find((x) => x.uid === uid) || messages[0];
  const html =
    uid === 3
      ? '<html><body style="font-family:sans-serif"><h2 style="color:#0284c7">Angebot Q4</h2><p>Hallo Max,</p><p>anbei das <b>Angebot</b> als PDF. Externe Bilder sind hier blockiert:</p><img src="https://example.com/track.gif" width="200" height="40" alt="[externes Bild]"><p>Viele Grüße<br>Anna</p></body></html>'
      : null;
  return {
    ...s,
    cc: uid === 3 ? [{ name: 'Büro', email: 'buero@lan-solo.test' }] : [],
    bcc: [],
    replyTo: [],
    messageId: `<msg-${uid}@lan-solo.test>`,
    inReplyTo: uid === 2 ? '<msg-9@lan-solo.test>' : null,
    references: uid === 2 ? ['<msg-9@lan-solo.test>'] : [],
    text:
      uid === 10
        ? 'Hallo Anna,\n\nkurze Nachfrage zum **Angebot**.\n\n-- \nMax Muster\nLAN-SOLO'
        : uid === 3
        ? 'Hallo Max,\n\nanbei das Angebot als PDF.\n\nViele Grüße\nAnna'
        : uid === 2
          ? 'Passt mir gut.\n\n> Wie wäre Dienstag?'
          : 'Hallo,\n\ndies ist eine Klartext-Testmail mit Umlauten: äöü ß.\n\nViele Grüße\nAnna',
    html,
    attachments: uid === 10 ? [{ index: 1, filename: 'Notizen.txt', mime: 'text/plain', size: 812, contentId: null, inline: false }] : uid === 3 ? [{ index: 2, filename: 'Angebot.pdf', mime: 'application/pdf', size: 180224, contentId: null, inline: false }] : [],
    headers: [
      ['From', `${s.from[0].name} <${s.from[0].email}>`],
      ['To', 'Max Muster <max@lan-solo.test>'],
      ['Subject', s.subject],
      ['Date', s.date || ''],
      ['Message-ID', `<msg-${uid}@lan-solo.test>`],
      ['X-Mailer', 'mock'],
    ],
  };
}

type Args = Record<string, unknown>;
const handlers: Record<string, (a: Args) => unknown> = {
  get_settings: () => settings,
  set_settings: (a) => {
    Object.assign(settings, a.settings as Settings);
    localStorage.setItem('mock.mode', settings.mode);
  },
  list_accounts: () => accounts,
  save_account: (a) => ({ ...(a.input as Account), id: 'a3', passwordStored: 'keychain' }),
  delete_account: () => undefined,
  guess_servers: () => ({ imapHost: 'imap.example.org', imapPort: 993, imapSecurity: 'tls', smtpHost: 'smtp.example.org', smtpPort: 587, smtpSecurity: 'starttls' }),
  test_account: () => ({ imap: 'OK — imap.example.org:993 (TLS, 12 Capabilities)', smtp: 'OK — smtp.example.org:587 (STARTTLS)' }),
  list_folders: () => folders,
  create_folder: () => undefined,
  delete_folder: (a) => {
    (window as unknown as Record<string, unknown>).__lastDeleteFolder = a;
  },
  list_messages: (a) => {
    const src = a.folder === 'INBOX' ? messages : a.folder === 'Drafts' ? drafts : [];
    return {
      messages: src.map((x) => ({ ...x, accountId: a.accountId as string })),
      total: src.length,
      fromCache: false,
    };
  },
  search_messages: (a) => messages.filter((x) => x.subject.toLowerCase().includes(String(a.query).toLowerCase())),
  get_message: (a) => detail(a.uid as number),
  get_message_source: (a) => `From: anna@lan-solo.test\r\nSubject: ${detail(a.uid as number).subject}\r\n\r\n(mock source)`,
  set_flag: (a) => {
    const uids = a.uids as number[];
    for (const x of messages) if (uids.includes(x.uid)) (x as unknown as Record<string, boolean>)[a.flag as string] = a.value as boolean;
  },
  move_messages: () => undefined,
  delete_messages: (a) => {
    (window as unknown as Record<string, unknown>).__lastDelete = a;
  },
  empty_folder: () => undefined,
  save_attachment: () => undefined,
  send_message: (a) => {
    (window as unknown as Record<string, unknown>).__lastDraft = a.draft;
    console.log('[mock] send_message', JSON.stringify(a.draft));
  },
  save_draft: (a) => {
    (window as unknown as Record<string, unknown>).__lastDraft = a.draft;
    console.log('[mock] save_draft', JSON.stringify(a.draft));
  },
  'plugin:app|version': () => '1.0.0',
  'plugin:dialog|open': () => ['/Users/mock/Documents/Bericht.pdf'],
  'plugin:dialog|save': (a) => `/Users/mock/Downloads/${(a.options as { defaultPath?: string })?.defaultPath ?? 'x'}`,
  'plugin:opener|open_url': (a) => {
    (window as unknown as Record<string, unknown>).__lastOpened = a.url;
  },
  data_path: () => '/Users/mock/Library/Application Support/com.lan-solo.mailbox',
  check_update: () => (q.has('update') ? { version: '1.0.1', notes: 'mock', date: null } : null),
  install_update: () => undefined,
};

// Wie plugin-dialog 2.7 im echten WebView: window.confirm/alert/prompt sind
// async Stubs auf nicht registrierte Befehle (Promise → immer „wahr“, nie ein
// Dialog). Ein Rückfall auf window.confirm im App-Code fällt so im UI-Test auf
// (Löschen trotz „Abbrechen“). Rückfragen laufen nur über „plugin:dialog|message“.
const nativeConfirm = window.confirm.bind(window);
const w = window as unknown as Record<string, unknown>;
for (const k of ['confirm', 'alert', 'prompt']) {
  w[k] = () => Promise.reject(`mock: plugin:dialog|${k} not found (wie plugin-dialog 2.7)`);
}
handlers['plugin:dialog|message'] = (a) => {
  const b = a.buttons as { OkCancelCustom?: [string, string] } | string | undefined;
  const [ok, cancel] = typeof b === 'object' && b?.OkCancelCustom ? b.OkCancelCustom : ['Ok', 'Cancel'];
  const yes = nativeConfirm(String(a.message));
  w.__lastConfirm = { message: a.message, yes };
  return yes ? ok : cancel;
};

(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: (cmd: string, args: Args = {}) => {
    // Fehlerfälle für UI-Tests: window.__mockFail = { kommando: 'Meldung' }
    const failMsg = (w.__mockFail as Record<string, string> | undefined)?.[cmd];
    if (failMsg) return new Promise((_, rej) => setTimeout(() => rej(failMsg), 60));
    const h = handlers[cmd];
    if (!h) return Promise.reject(`mock: unbekanntes Kommando ${cmd}`);
    return new Promise((res) => setTimeout(() => res(h(args)), 60));
  },
  transformCallback: (cb: (r: unknown) => void) => {
    const id = Math.floor(Math.random() * 1e9);
    (window as unknown as Record<string, unknown>)[`_${id}`] = cb;
    return id;
  },
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
};
