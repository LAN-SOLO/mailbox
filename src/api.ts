// mailbox — Vertrag zwischen Frontend und Tauri-Backend.
// Jede `invoke`-Signatur hier ist verbindlich: das Rust-Backend implementiert
// exakt diese Kommando-Namen und (camelCase-)Argumente, die DTOs werden mit
// `#[serde(rename_all = "camelCase")]` serialisiert.
import { invoke } from '@tauri-apps/api/core';

export type Security = 'tls' | 'starttls' | 'none';
export type Mode = 'simple' | 'expert';
export type FolderRole = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'other';
export type Flag = 'seen' | 'flagged' | 'answered';
export type SearchScope = 'all' | 'subject' | 'from' | 'to' | 'body';
export type Priority = 'normal' | 'high' | 'low';

export interface Account {
  id: string;
  /** Anzeigename für den Absender („Max Muster“). */
  name: string;
  email: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: Security;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: Security;
  /** Login-Name — meist gleich der E-Mail-Adresse. */
  username: string;
  /** Signatur (Klartext), wird beim Verfassen unter den Text gesetzt. */
  signature: string;
  /** Akzentfarbe des Kontos (Hex) — nur Expertenmodus. */
  color: string;
  /** Wo das Passwort liegt: OS-Schlüsselbund, Datei (Fallback) oder fehlt. */
  passwordStored: 'keychain' | 'file' | 'none';
}

/** Eingabe beim Anlegen/Bearbeiten — Passwort nur mitschicken, wenn es
 *  gesetzt/geändert werden soll. `id` leer = neues Konto. */
export interface AccountInput {
  id?: string;
  name: string;
  email: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: Security;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: Security;
  username: string;
  signature: string;
  color: string;
  password?: string;
}

export interface ServerGuess {
  imapHost: string;
  imapPort: number;
  imapSecurity: Security;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: Security;
}

export interface Folder {
  /** Voller IMAP-Name inkl. Hierarchie („INBOX/Projekte/2026“). */
  name: string;
  delimiter: string | null;
  /** Letztes Pfadsegment für die Anzeige. */
  display: string;
  role: FolderRole;
  /** \Noselect — nur Container, kann nicht geöffnet werden. */
  noSelect: boolean;
  depth: number;
  /** Aus STATUS — null, wenn nicht abgefragt. */
  unread: number | null;
  total: number | null;
}

export interface Address {
  name: string | null;
  email: string;
}

export interface MessageSummary {
  uid: number;
  accountId: string;
  folder: string;
  from: Address[];
  to: Address[];
  subject: string;
  /** ISO-8601 (UTC) oder null. */
  date: string | null;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  draft: boolean;
  size: number;
  hasAttachments: boolean;
}

export interface Attachment {
  /** Index innerhalb der Nachricht — für saveAttachment. */
  index: number;
  filename: string;
  mime: string;
  size: number;
  contentId: string | null;
  inline: boolean;
}

export interface MessageDetail extends MessageSummary {
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  /** Klartext-Body (oder aus HTML abgeleitet), null wenn nicht vorhanden. */
  text: string | null;
  /** HTML-Body; `cid:`-Bilder sind bereits als data:-URIs eingebettet. */
  html: string | null;
  attachments: Attachment[];
  /** Alle Header in Reihenfolge — für die Expertenansicht. */
  headers: [string, string][];
}

export interface MessagePage {
  messages: MessageSummary[];
  /** Gesamtzahl im Ordner (EXISTS). */
  total: number;
  /** true, wenn aus dem lokalen Cache (noch nicht mit dem Server abgeglichen). */
  fromCache: boolean;
}

export interface Draft {
  accountId: string;
  /** Adresslisten als Freitext („Max <max@x.de>, y@z.de“) — Backend parst. */
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  /** Klartext-Body inkl. Signatur. */
  body: string;
  /** Absolute Dateipfade (aus dem Dialog-Plugin). */
  attachments: string[];
  inReplyTo: string | null;
  references: string[];
  /** HTML-Fassung (Expertenmodus, aus Markdown gerendert) — null = nur
   *  Klartext. Wenn gesetzt: multipart/alternative, Klartext bleibt dabei. */
  html: string | null;
  /** Reply-To als Freitext-Adressliste, leer = keiner. */
  replyTo: string;
  priority: Priority;
  /** Lesebestätigung anfordern (Disposition-Notification-To). */
  readReceipt: boolean;
}

export interface TestResult {
  imap: string;
  smtp: string;
}

export interface Settings {
  language: 'de' | 'en';
  mode: Mode;
  /** "dark" | "light" */
  theme: string;
  /** "blue" | "emerald" | "violet" | "amber" */
  accent: string;
  autoUpdate: boolean;
  /** Externe Bilder in HTML-Mails standardmäßig laden (Expertenmodus). */
  loadRemoteImages: boolean;
  /** Nachrichten pro Seite (Listen-Nachladen). */
  pageSize: number;
  /** Automatischer Abruf in Minuten; 0 = aus. */
  checkIntervalMin: number;
  /** Nachricht beim Öffnen als gelesen markieren. */
  markReadOnOpen: boolean;
  /** Vor dem Löschen nachfragen. */
  confirmDelete: boolean;
  /** Antworten als Zitat mit „>“ einfügen. */
  quoteOnReply: boolean;
  /** Formatierung (Markdown) als HTML-Teil mitsenden — Klartext bleibt
   *  immer enthalten. Nur Expertenmodus. */
  composeHtml: boolean;
}

export interface UpdateInfo {
  version: string;
  notes: string | null;
  date: string | null;
}

export const api = {
  // --- settings ---
  getSettings: () => invoke<Settings>('get_settings'),
  setSettings: (settings: Settings) => invoke<void>('set_settings', { settings }),

  // --- accounts ---
  listAccounts: () => invoke<Account[]>('list_accounts'),
  saveAccount: (input: AccountInput) => invoke<Account>('save_account', { input }),
  deleteAccount: (accountId: string) => invoke<void>('delete_account', { accountId }),
  /** Server-Vorschlag aus der Domain (Preset-Tabelle + imap./smtp.-Heuristik). */
  guessServers: (email: string) => invoke<ServerGuess | null>('guess_servers', { email }),
  /** Probe-Login auf IMAP und SMTP; wirft bei Fehlern eine lesbare Meldung. */
  testAccount: (input: AccountInput) => invoke<TestResult>('test_account', { input }),

  // --- folders ---
  listFolders: (accountId: string, withStatus: boolean) =>
    invoke<Folder[]>('list_folders', { accountId, withStatus }),
  createFolder: (accountId: string, name: string) =>
    invoke<void>('create_folder', { accountId, name }),
  deleteFolder: (accountId: string, name: string) =>
    invoke<void>('delete_folder', { accountId, name }),

  // --- messages ---
  /** Neueste zuerst; `offset` = bereits geladene Nachrichten. `refresh=false`
   *  darf den lokalen Cache liefern (fromCache=true). */
  listMessages: (
    accountId: string,
    folder: string,
    offset: number,
    limit: number,
    refresh: boolean
  ) => invoke<MessagePage>('list_messages', { accountId, folder, offset, limit, refresh }),
  /** Serverseitige Suche (IMAP SEARCH) im Ordner. */
  searchMessages: (accountId: string, folder: string, query: string, scope: SearchScope) =>
    invoke<MessageSummary[]>('search_messages', { accountId, folder, query, scope }),
  getMessage: (accountId: string, folder: string, uid: number) =>
    invoke<MessageDetail>('get_message', { accountId, folder, uid }),
  getMessageSource: (accountId: string, folder: string, uid: number) =>
    invoke<string>('get_message_source', { accountId, folder, uid }),
  setFlag: (accountId: string, folder: string, uids: number[], flag: Flag, value: boolean) =>
    invoke<void>('set_flag', { accountId, folder, uids, flag, value }),
  moveMessages: (accountId: string, folder: string, uids: number[], target: string) =>
    invoke<void>('move_messages', { accountId, folder, uids, target }),
  /** In den Papierkorb verschieben — im Papierkorb selbst: endgültig löschen. */
  deleteMessages: (accountId: string, folder: string, uids: number[]) =>
    invoke<void>('delete_messages', { accountId, folder, uids }),
  emptyFolder: (accountId: string, folder: string) =>
    invoke<void>('empty_folder', { accountId, folder }),
  saveAttachment: (accountId: string, folder: string, uid: number, index: number, path: string) =>
    invoke<void>('save_attachment', { accountId, folder, uid, index, path }),

  // --- compose ---
  /** SMTP-Versand + Kopie in den Gesendet-Ordner. */
  sendMessage: (draft: Draft) => invoke<void>('send_message', { draft }),
  /** Entwurf per APPEND in den Entwürfe-Ordner legen. */
  saveDraft: (draft: Draft) => invoke<void>('save_draft', { draft }),

  // --- misc ---
  dataPath: () => invoke<string>('data_path'),
  checkUpdate: () => invoke<UpdateInfo | null>('check_update'),
  installUpdate: () => invoke<void>('install_update'),
};

// --- helpers ---------------------------------------------------------------

export function fmtAddress(a: Address): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

export function fmtAddressShort(a: Address): string {
  return a.name || a.email;
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Datum kompakt: heute → Uhrzeit, dieses Jahr → „7. Sep“, sonst mit Jahr. */
export function fmtDate(iso: string | null, lang: 'de' | 'en'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const locale = lang === 'de' ? 'de-DE' : 'en-GB';
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtDateLong(iso: string | null, lang: 'de' | 'en'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
