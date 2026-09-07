import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Account,
  Folder,
  MessageDetail,
  MessageSummary,
  SearchScope,
  Settings,
  UpdateInfo,
  api,
  fmtAddress,
  fmtDateLong,
} from './api';
import { dicts, Lang } from './i18n';
import { AccountModal } from './components/AccountModal';
import { Compose, ComposeInit } from './components/Compose';
import { Help } from './components/Help';
import { MessageList, msgKey } from './components/MessageList';
import { MessageView } from './components/MessageView';
import { SettingsModal } from './components/SettingsModal';
import { FolderSel, Sidebar, roleLabel } from './components/Sidebar';
import { IconGear, IconPlus, IconRefresh } from './icons';

type AccountEdit = { kind: 'new' } | { kind: 'edit'; account: Account };

/** Kleiner Eingabedialog (window.prompt ist im WebView nicht verlässlich). */
function PromptModal({
  title,
  onOk,
  onClose,
  okLabel,
  cancelLabel,
}: {
  title: string;
  onOk: (v: string) => void;
  onClose: () => void;
  okLabel: string;
  cancelLabel: string;
}) {
  const [v, setV] = useState('');
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="note" style={{ marginTop: 0 }}>
          {title}
        </div>
        <input
          type="text"
          value={v}
          autoFocus
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && v.trim()) onOk(v.trim());
            if (e.key === 'Escape') onClose();
          }}
        />
        <div className="btnrow">
          <button className="ghost" onClick={onClose}>
            {cancelLabel}
          </button>
          <button className="primary" disabled={!v.trim()} onClick={() => onOk(v.trim())}>
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsBackup, setSettingsBackup] = useState<Settings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [folders, setFolders] = useState<Record<string, Folder[]>>({});
  const [sel, setSel] = useState<FolderSel | null>(null);
  const [unified, setUnified] = useState(false);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [active, setActive] = useState<MessageSummary | null>(null);
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [accountEdit, setAccountEdit] = useState<AccountEdit | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  const [folderPrompt, setFolderPrompt] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [updateAvail, setUpdateAvail] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [focusSearchSignal, setFocusSearchSignal] = useState(0);
  const toastTimer = useRef<number | undefined>(undefined);
  const listReq = useRef(0);

  const lang: Lang = settings?.language ?? 'de';
  const t = dicts[lang];
  const expert = settings?.mode === 'expert';

  const showToast = useCallback((msg: string, isError = false) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), isError ? 6000 : 1800);
  }, []);

  const fail = useCallback((e: unknown) => showToast(String(e), true), [showToast]);

  // --- Laden -------------------------------------------------------------

  const loadFolders = useCallback(
    (accountId: string, withStatus = true) =>
      api
        .listFolders(accountId, withStatus)
        .then((list) => setFolders((f) => ({ ...f, [accountId]: list })))
        .catch(fail),
    [fail]
  );

  const loadAccounts = useCallback(async () => {
    try {
      const list = await api.listAccounts();
      setAccounts(list);
      list.forEach((a) => loadFolders(a.id));
      return list;
    } catch (e) {
      fail(e);
      return [];
    }
  }, [fail, loadFolders]);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      api
        .checkUpdate()
        .then((u) => {
          if (!u) return;
          setUpdateAvail(u);
          if (s.autoUpdate) {
            setInstalling(true);
            api.installUpdate().catch(() => setInstalling(false));
          }
        })
        .catch(() => {});
    });
    loadAccounts();
  }, [loadAccounts]);

  // Darstellung aus den Einstellungen auf <html> spiegeln
  useEffect(() => {
    if (!settings) return;
    document.documentElement.setAttribute('data-theme', settings.theme);
    document.documentElement.setAttribute('data-accent', settings.accent);
  }, [settings?.theme, settings?.accent, settings]);

  const pageSize = settings?.pageSize ?? 50;

  const loadList = useCallback(
    async (target: FolderSel, offset: number, append: boolean) => {
      const req = ++listReq.current;
      setLoading(true);
      try {
        if (!append) {
          const cached = await api.listMessages(target.accountId, target.folder, 0, pageSize, false);
          if (req !== listReq.current) return;
          if (cached.fromCache) {
            setMessages(cached.messages);
            setTotal(cached.total);
            setFromCache(true);
          }
        }
        const page = await api.listMessages(target.accountId, target.folder, offset, pageSize, true);
        if (req !== listReq.current) return;
        setMessages((m) => (append ? [...m, ...page.messages] : page.messages));
        setTotal(page.total);
        setFromCache(false);
      } catch (e) {
        if (req === listReq.current) fail(e);
      } finally {
        if (req === listReq.current) setLoading(false);
      }
    },
    [fail, pageSize]
  );

  const loadUnified = useCallback(async () => {
    const req = ++listReq.current;
    setLoading(true);
    try {
      const parts = await Promise.all(
        accounts.map(async (a) => {
          const inbox = folders[a.id]?.find((f) => f.role === 'inbox');
          if (!inbox) return [] as MessageSummary[];
          try {
            return (await api.listMessages(a.id, inbox.name, 0, pageSize, true)).messages;
          } catch (e) {
            fail(e);
            return [] as MessageSummary[];
          }
        })
      );
      if (req !== listReq.current) return;
      const merged = parts.flat().sort((x, y) => (y.date ?? '').localeCompare(x.date ?? ''));
      setMessages(merged);
      setTotal(merged.length);
      setFromCache(false);
    } finally {
      if (req === listReq.current) setLoading(false);
    }
  }, [accounts, folders, fail, pageSize]);

  const resetList = () => {
    setMessages([]);
    setTotal(0);
    setActive(null);
    setDetail(null);
    setSelected(new Set());
    setSearchActive(false);
  };

  const selectFolder = (s: FolderSel) => {
    setUnified(false);
    setSel(s);
    resetList();
    loadList(s, 0, false);
  };

  const selectUnified = () => {
    setUnified(true);
    setSel(null);
    resetList();
    loadUnified();
  };

  // Erster Ordner: Posteingang des ersten Kontos, sobald dessen Ordner da sind
  useEffect(() => {
    if (sel || unified || accounts.length === 0) return;
    const first = accounts[0];
    const inbox = folders[first.id]?.find((f) => f.role === 'inbox');
    if (inbox) selectFolder({ accountId: first.id, folder: inbox.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, folders, sel, unified]);

  const refresh = useCallback(() => {
    accounts.forEach((a) => loadFolders(a.id));
    if (unified) loadUnified();
    else if (sel && !searchActive) loadList(sel, 0, false);
  }, [accounts, loadFolders, unified, loadUnified, sel, searchActive, loadList]);

  // automatischer Abruf
  useEffect(() => {
    const min = settings?.checkIntervalMin ?? 0;
    if (!min || accounts.length === 0) return;
    const id = window.setInterval(refresh, min * 60 * 1000);
    return () => window.clearInterval(id);
  }, [settings?.checkIntervalMin, accounts.length, refresh]);

  // --- Nachricht öffnen ---------------------------------------------------

  const patchMessage = (key: string, patch: Partial<MessageSummary>) => {
    setMessages((list) => list.map((m) => (msgKey(m) === key ? { ...m, ...patch } : m)));
    setActive((a) => (a && msgKey(a) === key ? { ...a, ...patch } : a));
  };

  const openMessage = async (m: MessageSummary) => {
    setActive(m);
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await api.getMessage(m.accountId, m.folder, m.uid);
      setDetail(d);
      if (settings?.markReadOnOpen && !m.seen) {
        api
          .setFlag(m.accountId, m.folder, [m.uid], 'seen', true)
          .then(() => {
            patchMessage(msgKey(m), { seen: true });
            bumpUnread(m.accountId, m.folder, -1);
          })
          .catch(() => {});
      }
    } catch (e) {
      fail(e);
    } finally {
      setDetailLoading(false);
    }
  };

  const bumpUnread = (accountId: string, folder: string, delta: number) =>
    setFolders((f) => ({
      ...f,
      [accountId]: (f[accountId] ?? []).map((x) =>
        x.name === folder && x.unread != null ? { ...x, unread: Math.max(0, x.unread + delta) } : x
      ),
    }));

  // --- Aktionen ----------------------------------------------------------

  /** Zielmenge einer Aktion: Auswahl, sonst die offene Nachricht. */
  const targets = (): MessageSummary[] => {
    if (selected.size > 0) return messages.filter((m) => selected.has(msgKey(m)));
    return active ? [active] : [];
  };

  const groupBy = (list: MessageSummary[]) => {
    const g = new Map<string, { accountId: string; folder: string; uids: number[]; msgs: MessageSummary[] }>();
    for (const m of list) {
      const k = `${m.accountId}|${m.folder}`;
      const e = g.get(k) ?? { accountId: m.accountId, folder: m.folder, uids: [], msgs: [] };
      e.uids.push(m.uid);
      e.msgs.push(m);
      g.set(k, e);
    }
    return [...g.values()];
  };

  const removeFromList = (list: MessageSummary[]) => {
    const keys = new Set(list.map(msgKey));
    let next: MessageSummary | null = null;
    if (active && keys.has(msgKey(active))) {
      const idx = messages.findIndex((m) => msgKey(m) === msgKey(active));
      next = messages.slice(idx + 1).find((m) => !keys.has(msgKey(m))) ?? null;
    }
    setMessages((m) => m.filter((x) => !keys.has(msgKey(x))));
    setTotal((n) => Math.max(0, n - list.length));
    setSelected(new Set());
    if (active && keys.has(msgKey(active))) {
      setActive(null);
      setDetail(null);
      if (next) openMessage(next);
    }
    for (const m of list) if (!m.seen) bumpUnread(m.accountId, m.folder, -1);
  };

  const folderRole = (accountId: string, folder: string) =>
    folders[accountId]?.find((f) => f.name === folder)?.role ?? 'other';
  const roleFolder = (accountId: string, role: Folder['role']) =>
    folders[accountId]?.find((f) => f.role === role) ?? null;

  const deleteMsgs = async (list = targets()) => {
    if (list.length === 0) return;
    const finalDelete = list.every((m) => folderRole(m.accountId, m.folder) === 'trash');
    if (settings?.confirmDelete || finalDelete) {
      const q = finalDelete ? t.confirmDeleteFinal(list.length) : t.confirmDelete(list.length);
      if (!window.confirm(q)) return;
    }
    try {
      for (const g of groupBy(list)) await api.deleteMessages(g.accountId, g.folder, g.uids);
      removeFromList(list);
      showToast(t.deleted);
      list.forEach((m) => loadFolders(m.accountId));
    } catch (e) {
      fail(e);
    }
  };

  const moveMsgs = async (target: string, list = targets(), label = t.moved) => {
    if (list.length === 0) return;
    try {
      for (const g of groupBy(list)) {
        if (g.folder !== target) await api.moveMessages(g.accountId, g.folder, g.uids, target);
      }
      removeFromList(list.filter((m) => m.folder !== target));
      showToast(label);
      list.forEach((m) => loadFolders(m.accountId));
    } catch (e) {
      fail(e);
    }
  };

  const moveToRole = async (role: Folder['role'], label: string) => {
    const list = targets();
    for (const g of groupBy(list)) {
      const f = roleFolder(g.accountId, role);
      if (f) await moveMsgs(f.name, g.msgs, label);
    }
  };

  const setFlagOn = async (list: MessageSummary[], flag: 'seen' | 'flagged', value: boolean) => {
    try {
      for (const g of groupBy(list)) await api.setFlag(g.accountId, g.folder, g.uids, flag, value);
      for (const m of list) {
        patchMessage(msgKey(m), { [flag]: value });
        if (flag === 'seen' && m.seen !== value) bumpUnread(m.accountId, m.folder, value ? -1 : 1);
      }
    } catch (e) {
      fail(e);
    }
  };

  const toggleRead = () => {
    const list = targets();
    if (list.length === 0) return;
    const allSeen = list.every((m) => m.seen);
    setFlagOn(list, 'seen', !allSeen);
  };
  const toggleStar = (m?: MessageSummary) => {
    const list = m ? [m] : targets();
    if (list.length === 0) return;
    const allFlagged = list.every((x) => x.flagged);
    setFlagOn(list, 'flagged', !allFlagged);
  };

  const search = async (query: string, scope: SearchScope) => {
    if (!sel) return;
    const req = ++listReq.current;
    setLoading(true);
    try {
      const res = await api.searchMessages(sel.accountId, sel.folder, query, scope);
      if (req !== listReq.current) return;
      setMessages(res);
      setTotal(res.length);
      setSearchActive(true);
      setSelected(new Set());
    } catch (e) {
      fail(e);
    } finally {
      if (req === listReq.current) setLoading(false);
    }
  };

  const clearSearch = () => {
    setSearchActive(false);
    if (sel) loadList(sel, 0, false);
  };

  // --- Verfassen ----------------------------------------------------------

  const ownEmails = useMemo(() => new Set(accounts.map((a) => a.email.toLowerCase())), [accounts]);

  const signatureBlock = (accountId: string) => {
    const a = accounts.find((x) => x.id === accountId);
    return a?.signature ? `\n\n-- \n${a.signature}` : '';
  };

  const newMessage = () => {
    const accountId = sel?.accountId ?? active?.accountId ?? accounts[0]?.id;
    if (!accountId) return;
    setCompose({
      kind: 'new',
      accountId,
      to: '',
      cc: '',
      bcc: '',
      subject: '',
      body: signatureBlock(accountId),
      inReplyTo: null,
      references: [],
    });
  };

  const quoted = (d: MessageDetail) => {
    const from = d.from[0] ? fmtAddress(d.from[0]) : '';
    const body = (d.text ?? '').split('\n').map((l) => `> ${l}`).join('\n');
    return `\n\n${t.quoteHeader(fmtDateLong(d.date, lang), from)}\n${body}`;
  };

  const reply = (all: boolean) => {
    if (!detail) return;
    const d = detail;
    const replyTo = d.replyTo.length ? d.replyTo : d.from;
    const to = replyTo.map(fmtAddress).join(', ');
    const cc = all
      ? [...d.to, ...d.cc]
          .filter((a) => !ownEmails.has(a.email.toLowerCase()))
          .filter((a) => !replyTo.some((r) => r.email.toLowerCase() === a.email.toLowerCase()))
          .map(fmtAddress)
          .join(', ')
      : '';
    const subject = /^re:/i.test(d.subject) ? d.subject : `Re: ${d.subject}`;
    const refs = [...d.references, ...(d.messageId ? [d.messageId] : [])];
    setCompose({
      kind: 'reply',
      accountId: d.accountId,
      to,
      cc,
      bcc: '',
      subject,
      body: `${signatureBlock(d.accountId)}${settings?.quoteOnReply ? quoted(d) : ''}`,
      inReplyTo: d.messageId,
      references: refs,
    });
  };

  const forward = () => {
    if (!detail) return;
    const d = detail;
    const subject = /^fwd?:/i.test(d.subject) ? d.subject : `Fwd: ${d.subject}`;
    const head = [
      t.forwardHeader,
      `${t.from}: ${d.from.map(fmtAddress).join(', ')}`,
      `${t.date}: ${fmtDateLong(d.date, lang)}`,
      `${t.subject}: ${d.subject}`,
      `${t.to}: ${d.to.map(fmtAddress).join(', ')}`,
    ].join('\n');
    setCompose({
      kind: 'forward',
      accountId: d.accountId,
      to: '',
      cc: '',
      bcc: '',
      subject,
      body: `${signatureBlock(d.accountId)}\n\n${head}\n\n${d.text ?? ''}`,
      inReplyTo: null,
      references: [],
    });
  };

  // --- Konten & Ordner ----------------------------------------------------

  const deleteAccount = async (a: Account) => {
    if (!window.confirm(t.confirmDeleteAccount(a.email))) return;
    try {
      await api.deleteAccount(a.id);
      if (sel?.accountId === a.id) {
        setSel(null);
        resetList();
      }
      setFolders((f) => {
        const n = { ...f };
        delete n[a.id];
        return n;
      });
      await loadAccounts();
    } catch (e) {
      fail(e);
    }
  };

  const createFolder = async (accountId: string, name: string) => {
    setFolderPrompt(null);
    try {
      await api.createFolder(accountId, name);
      await loadFolders(accountId);
    } catch (e) {
      fail(e);
    }
  };

  const deleteFolder = async (accountId: string, f: Folder) => {
    if (!window.confirm(t.confirmDeleteFolder(f.display))) return;
    try {
      await api.deleteFolder(accountId, f.name);
      if (sel?.accountId === accountId && sel.folder === f.name) {
        setSel(null);
        resetList();
      }
      await loadFolders(accountId);
    } catch (e) {
      fail(e);
    }
  };

  const emptyTrash = async (accountId: string, f: Folder) => {
    if (!window.confirm(t.confirmEmptyTrash)) return;
    try {
      await api.emptyFolder(accountId, f.name);
      if (sel?.accountId === accountId && sel.folder === f.name) {
        resetList();
        loadList(sel, 0, false);
      }
      await loadFolders(accountId);
    } catch (e) {
      fail(e);
    }
  };

  const saveSettings = (s: Settings) => {
    setSettings(s);
    setSettingsBackup(null);
    setShowSettings(false);
    api.setSettings(s).catch(fail);
  };

  const setMode = (mode: Settings['mode']) => {
    if (!settings) return;
    const s = { ...settings, mode };
    setSettings(s);
    setSelected(new Set());
    if (mode === 'simple' && unified) {
      setUnified(false);
      resetList();
    }
    api.setSettings(s).catch(fail);
  };

  // --- Tastaturkürzel (Experte) ------------------------------------------

  useEffect(() => {
    if (!expert) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === 'Escape') {
        setCompose(null);
        setAccountEdit(null);
        setShowSettings(false);
        setFolderPrompt(null);
        return;
      }
      if (typing || compose || accountEdit || showSettings || folderPrompt) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = active ? messages.findIndex((m) => msgKey(m) === msgKey(active)) : -1;
      switch (e.key) {
        case 'j':
          if (messages[idx + 1]) openMessage(messages[idx + 1]);
          break;
        case 'k':
          if (idx > 0) openMessage(messages[idx - 1]);
          break;
        case 'r':
          reply(false);
          break;
        case 'a':
          reply(true);
          break;
        case 'f':
          forward();
          break;
        case 'e':
          moveToRole('archive', t.archived);
          break;
        case '#':
        case 'Delete':
        case 'Backspace':
          deleteMsgs();
          break;
        case 's':
          toggleStar();
          break;
        case 'u':
          toggleRead();
          break;
        case 'n':
          newMessage();
          break;
        case '/':
          e.preventDefault();
          setFocusSearchSignal((n) => n + 1);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // --- Render -------------------------------------------------------------

  if (!settings) return null;

  const currentFolder = sel ? folders[sel.accountId]?.find((f) => f.name === sel.folder) ?? null : null;
  const listTitle = unified
    ? t.unifiedInbox
    : currentFolder
      ? expert && currentFolder.role === 'other'
        ? currentFolder.display
        : roleLabel(currentFolder, t)
      : t.noFolder;
  const activeAccountId = active?.accountId ?? sel?.accountId ?? null;
  const canArchive = !!activeAccountId && !!roleFolder(activeAccountId, 'archive') && folderRole(activeAccountId, active?.folder ?? '') !== 'archive';
  const canSpam = !!activeAccountId && !!roleFolder(activeAccountId, 'junk') && folderRole(activeAccountId, active?.folder ?? '') !== 'junk';

  return (
    <div className="app">
      <div className="header">
        <span className="brand">
          <span className="name">mailbox</span>
          <span className="dot">.</span>
        </span>
        <span className="tagline">{t.tagline}</span>
        <span className="seg">
          <button className={!expert ? 'active' : ''} onClick={() => setMode('simple')}>
            {t.modeSimple}
          </button>
          <button className={expert ? 'active' : ''} onClick={() => setMode('expert')}>
            {t.modeExpert}
          </button>
        </span>
        <span className="spacer" />
        {accounts.length > 0 && (
          <>
            <button className="primary" onClick={newMessage} title="n">
              <IconPlus size={12} /> {t.newMessage}
            </button>
            <button onClick={refresh} disabled={loading} title={t.refresh}>
              <IconRefresh size={12} /> {t.refresh}
            </button>
          </>
        )}
        <button
          className="icon"
          title={t.settings}
          onClick={() => {
            setSettingsBackup(settings);
            setShowSettings(true);
          }}
        >
          <IconGear size={14} />
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="main" style={{ overflow: 'auto' }}>
          <div className="onboard" style={{ flex: 1 }}>
            <h2>{t.onboardTitle}</h2>
            <p>{t.onboardText}</p>
            <button className="primary" onClick={() => setAccountEdit({ kind: 'new' })}>
              <IconPlus size={12} /> {t.addAccount}
            </button>
          </div>
        </div>
      ) : (
        <div className="main">
          <Sidebar
            accounts={accounts}
            folders={folders}
            expert={expert}
            sel={sel}
            unified={unified}
            t={t}
            onSelect={selectFolder}
            onSelectUnified={selectUnified}
            onAddAccount={() => setAccountEdit({ kind: 'new' })}
            onEditAccount={(a) => setAccountEdit({ kind: 'edit', account: a })}
            onCreateFolder={(id) => setFolderPrompt(id)}
            onDeleteFolder={deleteFolder}
            onEmptyTrash={emptyTrash}
          />
          <MessageList
            title={listTitle}
            messages={messages}
            total={total}
            loading={loading}
            fromCache={fromCache}
            searchActive={searchActive}
            expert={expert}
            lang={lang}
            t={t}
            accounts={accounts}
            showAccount={unified}
            activeKey={active ? msgKey(active) : null}
            selected={selected}
            focusSearchSignal={focusSearchSignal}
            onOpen={openMessage}
            onToggleSelect={(m) =>
              setSelected((s) => {
                const n = new Set(s);
                const k = msgKey(m);
                if (n.has(k)) n.delete(k);
                else n.add(k);
                return n;
              })
            }
            onSelectAll={(all) => setSelected(all ? new Set(messages.map(msgKey)) : new Set())}
            onToggleStar={(m) => toggleStar(m)}
            onLoadMore={() => sel && loadList(sel, messages.length, true)}
            onSearch={search}
            onClearSearch={clearSearch}
          />
          <MessageView
            msg={active}
            detail={detail}
            loading={detailLoading}
            expert={expert}
            lang={lang}
            t={t}
            remoteDefault={expert && settings.loadRemoteImages}
            canArchive={canArchive}
            canSpam={canSpam}
            folders={activeAccountId ? folders[activeAccountId] ?? [] : []}
            onReply={() => reply(false)}
            onReplyAll={() => reply(true)}
            onForward={forward}
            onDelete={() => deleteMsgs()}
            onArchive={() => moveToRole('archive', t.archived)}
            onSpam={() => moveToRole('junk', t.moved)}
            onToggleRead={toggleRead}
            onToggleStar={() => toggleStar()}
            onMove={(target) => moveMsgs(target)}
            onToast={showToast}
          />
        </div>
      )}

      {accountEdit && (
        <AccountModal
          account={accountEdit.kind === 'edit' ? accountEdit.account : null}
          expert={expert}
          t={t}
          onClose={() => setAccountEdit(null)}
          onSaved={async () => {
            setAccountEdit(null);
            showToast(t.accountSaved);
            await loadAccounts();
          }}
        />
      )}
      {showSettings && settingsBackup && (
        <SettingsModal
          settings={settings}
          accounts={accounts}
          t={t}
          onClose={() => {
            setSettings(settingsBackup);
            setSettingsBackup(null);
            setShowSettings(false);
          }}
          onSave={saveSettings}
          onLive={setSettings}
          onAddAccount={() => setAccountEdit({ kind: 'new' })}
          onEditAccount={(a) => setAccountEdit({ kind: 'edit', account: a })}
          onDeleteAccount={deleteAccount}
        />
      )}
      {compose && (
        <Compose
          init={compose}
          accounts={accounts}
          t={t}
          onClose={() => setCompose(null)}
          onSent={() => {
            const was = compose;
            setCompose(null);
            showToast(t.sent);
            if (was.kind === 'reply' && active) {
              api.setFlag(active.accountId, active.folder, [active.uid], 'answered', true).catch(() => {});
              patchMessage(msgKey(active), { answered: true });
            }
            accounts.forEach((a) => loadFolders(a.id));
          }}
          onDraftSaved={() => {
            setCompose(null);
            showToast(t.draftSaved);
            accounts.forEach((a) => loadFolders(a.id));
          }}
        />
      )}
      {folderPrompt && (
        <PromptModal
          title={t.newFolderPrompt}
          okLabel={t.newFolder}
          cancelLabel={t.cancel}
          onOk={(name) => createFolder(folderPrompt, name)}
          onClose={() => setFolderPrompt(null)}
        />
      )}

      {updateAvail && (
        <div className="upd-banner">
          <span>
            {t.updateBanner} <strong>{updateAvail.version}</strong>
          </span>
          <button
            className="primary"
            disabled={installing}
            onClick={() => {
              setInstalling(true);
              api.installUpdate().catch(() => setInstalling(false));
            }}
          >
            {installing ? t.updateInstalling : t.updateInstall}
          </button>
          <button className="ghost" onClick={() => setUpdateAvail(null)}>
            {t.updateLater}
          </button>
        </div>
      )}

      <Help lang={lang} />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
