import { useEffect, useRef, useState } from 'react';
import { Account, MessageSummary, SearchScope, fmtAddressShort, fmtDate, fmtSize } from '../api';
import { Dict, Lang } from '../i18n';
import { IconPaperclip, IconStar, IconX } from '../icons';

export const msgKey = (m: MessageSummary) => `${m.accountId}|${m.folder}|${m.uid}`;

export function MessageList({
  title,
  messages,
  total,
  loading,
  fromCache,
  searchActive,
  expert,
  lang,
  t,
  accounts,
  showAccount,
  activeKey,
  selected,
  focusSearchSignal,
  onOpen,
  onToggleSelect,
  onSelectAll,
  onToggleStar,
  onLoadMore,
  onSearch,
  onClearSearch,
}: {
  title: string;
  messages: MessageSummary[];
  total: number;
  loading: boolean;
  fromCache: boolean;
  searchActive: boolean;
  expert: boolean;
  lang: Lang;
  t: Dict;
  accounts: Account[];
  showAccount: boolean;
  activeKey: string | null;
  selected: Set<string>;
  focusSearchSignal: number;
  onOpen: (m: MessageSummary) => void;
  onToggleSelect: (m: MessageSummary) => void;
  onSelectAll: (all: boolean) => void;
  onToggleStar: (m: MessageSummary) => void;
  onLoadMore: () => void;
  onSearch: (query: string, scope: SearchScope) => void;
  onClearSearch: () => void;
}) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusSearchSignal > 0) inputRef.current?.focus();
  }, [focusSearchSignal]);

  // Einfach: lokaler Filter über die geladenen Zeilen
  const filter = q.trim().toLowerCase();
  const rows =
    !expert && filter
      ? messages.filter(
          (m) =>
            m.subject.toLowerCase().includes(filter) ||
            m.from.some(
              (a) =>
                a.email.toLowerCase().includes(filter) ||
                (a.name ?? '').toLowerCase().includes(filter)
            )
        )
      : messages;

  const hasMore = !searchActive && messages.length < total;
  const acctName = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? a.name || a.email : '';
  };
  const acctColor = (id: string) => accounts.find((x) => x.id === id)?.color || 'var(--blue)';

  const clear = () => {
    setQ('');
    if (searchActive) onClearSearch();
  };

  return (
    <div className="listpane">
      <div className="listbar">
        <input
          ref={inputRef}
          type="text"
          placeholder={expert ? t.searchServer : t.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              clear();
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === 'Enter' && expert && q.trim()) onSearch(q.trim(), scope);
          }}
        />
        {expert && (
          <select value={scope} onChange={(e) => setScope(e.target.value as SearchScope)}>
            <option value="all">{t.scopeAll}</option>
            <option value="subject">{t.scopeSubject}</option>
            <option value="from">{t.scopeFrom}</option>
            <option value="to">{t.scopeTo}</option>
            <option value="body">{t.scopeBody}</option>
          </select>
        )}
        {(q || searchActive) && (
          <button className="icon ghost" title={t.clearSearch} onClick={clear}>
            <IconX size={11} />
          </button>
        )}
      </div>
      <div className="listtitle">
        {expert && rows.length > 0 && (
          <input
            className="chk"
            type="checkbox"
            checked={selected.size > 0 && selected.size === rows.length}
            onChange={(e) => onSelectAll(e.target.checked)}
            title={selected.size > 0 ? t.selectNone : t.selectAll}
          />
        )}
        <span>{searchActive ? t.searchResults : title}</span>
        {selected.size > 0 && <span>· {t.selectedN(selected.size)}</span>}
        <span className="count">
          {loading ? t.loading : fromCache ? t.fromCache : `${total} ${t.messages}`}
        </span>
      </div>
      <div className="msglist">
        {rows.length === 0 && !loading && <div className="empty">{t.noMessages}</div>}
        {rows.map((m) => {
          const key = msgKey(m);
          const isSel = selected.has(key);
          return (
            <div
              key={key}
              className={`msg ${m.seen ? '' : 'unread'} ${activeKey === key ? 'active' : ''} ${isSel ? 'selected' : ''}`}
              onClick={() => onOpen(m)}
            >
              {expert ? (
                <input
                  className="chk"
                  type="checkbox"
                  checked={isSel}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => onToggleSelect(m)}
                />
              ) : (
                <span className="dot" />
              )}
              <button
                className={`star ${m.flagged ? 'on' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleStar(m);
                }}
                title={m.flagged ? t.unstar : t.star}
              >
                <IconStar size={12} filled={m.flagged} />
              </button>
              <span className="l1">
                {expert && <span className="dot" style={{ display: 'inline-block', marginRight: 6, background: m.seen ? 'transparent' : 'var(--blue)' }} />}
                {m.from.length ? m.from.map(fmtAddressShort).join(', ') : '—'}
              </span>
              <span className="date">{fmtDate(m.date, lang)}</span>
              <span className="l2">{m.subject || t.noSubject}</span>
              <span className="meta">
                {showAccount && (
                  <span className="acct" style={{ color: acctColor(m.accountId) }}>
                    {acctName(m.accountId)}
                  </span>
                )}
                {m.hasAttachments && <IconPaperclip size={11} />}
                {expert && <span>{fmtSize(m.size)}</span>}
              </span>
            </div>
          );
        })}
        {hasMore && (
          <div className="loadmore">
            <button onClick={onLoadMore} disabled={loading}>
              {loading ? t.loading : `${t.loadMore} (${messages.length}/${total})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
