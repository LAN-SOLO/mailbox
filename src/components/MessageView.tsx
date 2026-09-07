import { useEffect, useMemo, useRef, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  Address,
  Folder,
  MessageDetail,
  MessageSummary,
  api,
  fmtAddress,
  fmtDateLong,
  fmtSize,
} from '../api';
import { Dict, Lang } from '../i18n';
import {
  IconArchive,
  IconCode,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconForward,
  IconJunk,
  IconList,
  IconMove,
  IconReply,
  IconReplyAll,
  IconStar,
  IconTrash,
} from '../icons';

/** HTML-Mail in ein eigenständiges Dokument mit strenger CSP verpacken. */
function wrapHtml(html: string, remote: boolean): string {
  const img = remote ? "img-src data: https: http: cid:" : 'img-src data: cid:';
  const csp = `default-src 'none'; ${img}; style-src 'unsafe-inline'; font-src data:`;
  const reset =
    '<style>html,body{margin:0;padding:12px;background:#fff;color:#111;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5;word-break:break-word}img{max-width:100%;height:auto}a{color:#0369a1}pre{white-space:pre-wrap}</style>';
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">${reset}`;
  // vorhandenes <head> ergänzen, sonst eines voranstellen
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${head}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

function AddrList({ list, label }: { list: Address[]; label: string }) {
  if (list.length === 0) return null;
  return (
    <div className="hrow">
      <span className="k">{label}</span>
      <span>
        {list.map((a, i) => (
          <span key={i} className="addr" title={fmtAddress(a)}>
            {a.name ? (
              <>
                {a.name} <span className="em">&lt;{a.email}&gt;</span>
              </>
            ) : (
              a.email
            )}
            {i < list.length - 1 ? ', ' : ''}
          </span>
        ))}
      </span>
    </div>
  );
}

export function MessageView({
  msg,
  detail,
  loading,
  expert,
  lang,
  t,
  remoteDefault,
  canArchive,
  canSpam,
  folders,
  onReply,
  onReplyAll,
  onForward,
  onDelete,
  onArchive,
  onSpam,
  onToggleRead,
  onToggleStar,
  onMove,
  onToast,
}: {
  msg: MessageSummary | null;
  detail: MessageDetail | null;
  loading: boolean;
  expert: boolean;
  lang: Lang;
  t: Dict;
  remoteDefault: boolean;
  canArchive: boolean;
  canSpam: boolean;
  folders: Folder[];
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onSpam: () => void;
  onToggleRead: () => void;
  onToggleStar: () => void;
  onMove: (target: string) => void;
  onToast: (m: string, isError?: boolean) => void;
}) {
  const [remote, setRemote] = useState(remoteDefault);
  const [view, setView] = useState<'html' | 'text'>('html');
  const [source, setSource] = useState<string | null>(null);
  const [showHeaders, setShowHeaders] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // je Nachricht zurücksetzen
  useEffect(() => {
    setRemote(remoteDefault);
    setView('html');
    setSource(null);
    setShowHeaders(false);
    setMoveOpen(false);
  }, [msg?.uid, msg?.folder, msg?.accountId, remoteDefault]);

  const doc = useMemo(
    () => (detail?.html ? wrapHtml(detail.html, remote) : ''),
    [detail?.html, remote]
  );

  // Links aus der Sandbox heraus im System-Browser öffnen
  const hookLinks = () => {
    const d = frameRef.current?.contentDocument;
    if (!d) return;
    d.querySelectorAll('a[href]').forEach((a) => {
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        const href = (a as HTMLAnchorElement).getAttribute('href') ?? '';
        if (/^(https?:|mailto:)/i.test(href)) openUrl(href).catch(() => {});
      });
    });
  };

  const saveAttachment = async (index: number, filename: string) => {
    if (!detail) return;
    const path = await save({ defaultPath: filename });
    if (!path) return;
    try {
      await api.saveAttachment(detail.accountId, detail.folder, detail.uid, index, path);
      onToast(t.saved);
    } catch (e) {
      onToast(String(e), true);
    }
  };

  const showSource = async () => {
    if (!detail) return;
    try {
      setSource(await api.getMessageSource(detail.accountId, detail.folder, detail.uid));
    } catch (e) {
      onToast(String(e), true);
    }
  };

  if (!msg) {
    return (
      <div className="readpane">
        <div className="empty">{t.noMessageSelected}</div>
      </div>
    );
  }

  const hasHtml = !!detail?.html;
  const hasText = !!detail?.text;
  const showHtml = hasHtml && (view === 'html' || !hasText);
  const visibleAttachments = detail?.attachments.filter((a) => !a.inline || !a.contentId) ?? [];

  return (
    <div className="readpane">
      <div className="readbar">
        <button onClick={onReply} title="r">
          <IconReply size={12} /> {t.reply}
        </button>
        <button onClick={onReplyAll} title="a">
          <IconReplyAll size={12} /> {t.replyAll}
        </button>
        <button onClick={onForward} title="f">
          <IconForward size={12} /> {t.forward}
        </button>
        <span className="spacer" />
        {canArchive && (
          <button onClick={onArchive} title="e">
            <IconArchive size={12} /> {t.archive}
          </button>
        )}
        {expert && canSpam && (
          <button onClick={onSpam}>
            <IconJunk size={12} /> {t.spam}
          </button>
        )}
        {expert && (
          <span className="rel">
            <button onClick={() => setMoveOpen((o) => !o)}>
              <IconMove size={12} /> {t.moveTo}
            </button>
            {moveOpen && (
              <div className="menu" style={{ right: 0, top: 28 }}>
                {folders
                  .filter((f) => !f.noSelect && f.name !== msg.folder)
                  .map((f) => (
                    <button
                      key={f.name}
                      onClick={() => {
                        setMoveOpen(false);
                        onMove(f.name);
                      }}
                    >
                      {' '.repeat(f.depth * 2)}
                      {f.display}
                    </button>
                  ))}
              </div>
            )}
          </span>
        )}
        <button onClick={onToggleRead} title="u">
          {msg.seen ? t.markUnread : t.markRead}
        </button>
        <button className={msg.flagged ? 'active' : ''} onClick={onToggleStar} title="s">
          <IconStar size={12} filled={msg.flagged} /> {msg.flagged ? t.unstar : t.star}
        </button>
        <button className="danger" onClick={onDelete} title="#">
          <IconTrash size={12} /> {t.delete}
        </button>
      </div>

      <div className="readhead">
        <h1>{msg.subject || t.noSubject}</h1>
        <AddrList list={msg.from} label={t.from} />
        <AddrList list={detail?.to ?? msg.to} label={t.to} />
        {detail && <AddrList list={detail.cc} label={t.cc} />}
        <div className="hrow">
          <span className="k">{t.date}</span>
          <span>{fmtDateLong(msg.date, lang)}</span>
          {expert && <span className="dim">· {fmtSize(msg.size)}</span>}
        </div>
        {visibleAttachments.length > 0 && (
          <div className="attach">
            {visibleAttachments.map((a) => (
              <button key={a.index} onClick={() => saveAttachment(a.index, a.filename)} title={a.mime}>
                <IconDownload size={11} /> {a.filename} <span className="sz">{fmtSize(a.size)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {detail && (hasHtml || expert) && (
        <div className="hintbar">
          {hasHtml && hasText && (
            <>
              <button className={view === 'text' ? 'active' : ''} onClick={() => setView('text')}>
                {t.showText}
              </button>
              <button className={view === 'html' ? 'active' : ''} onClick={() => setView('html')}>
                {t.showHtml}
              </button>
            </>
          )}
          {showHtml && (
            <>
              <span>{remote ? t.remoteLoaded : t.remoteBlocked}</span>
              {!remote && (
                <button onClick={() => setRemote(true)}>
                  <IconEye size={11} /> {t.loadRemote}
                </button>
              )}
              {remote && (
                <button onClick={() => setRemote(false)}>
                  <IconEyeOff size={11} />
                </button>
              )}
            </>
          )}
          <span className="spacer" />
          {expert && (
            <>
              <button onClick={() => setShowHeaders(true)}>
                <IconList size={11} /> {t.headers}
              </button>
              <button onClick={showSource}>
                <IconCode size={11} /> {t.source}
              </button>
            </>
          )}
        </div>
      )}

      <div className="readbody">
        {loading && !detail && <div className="busy">{t.loading}</div>}
        {detail && showHtml && (
          <iframe
            ref={frameRef}
            sandbox="allow-same-origin"
            srcDoc={doc}
            title="message"
            onLoad={hookLinks}
          />
        )}
        {detail && !showHtml && (
          <pre className="mailtext">{detail.text ?? t.noBody}</pre>
        )}
      </div>

      {source !== null && (
        <div className="overlay" onClick={() => setSource(null)}>
          <div className="modal source" onClick={(e) => e.stopPropagation()}>
            <h2>{t.source}</h2>
            <pre>{source}</pre>
            <div className="btnrow">
              <button onClick={() => setSource(null)}>{t.close}</button>
            </div>
          </div>
        </div>
      )}
      {showHeaders && detail && (
        <div className="overlay" onClick={() => setShowHeaders(false)}>
          <div className="modal source" onClick={(e) => e.stopPropagation()}>
            <h2>{t.headers}</h2>
            <div style={{ maxHeight: '62vh', overflow: 'auto' }}>
              <table className="hdrtable">
                <tbody>
                  {detail.headers.map(([k, v], i) => (
                    <tr key={i}>
                      <td>{k}</td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="btnrow">
              <button onClick={() => setShowHeaders(false)}>{t.close}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
