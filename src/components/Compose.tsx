import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Account, Draft, api } from '../api';
import { Dict } from '../i18n';
import { IconPaperclip, IconSend, IconX } from '../icons';

export type ComposeKind = 'new' | 'reply' | 'forward';

/** Vorbelegung — wird von App.tsx aus der Nachricht gebaut. */
export interface ComposeInit {
  kind: ComposeKind;
  accountId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  inReplyTo: string | null;
  references: string[];
}

export function Compose({
  init,
  accounts,
  t,
  onClose,
  onSent,
  onDraftSaved,
}: {
  init: ComposeInit;
  accounts: Account[];
  t: Dict;
  onClose: () => void;
  onSent: () => void;
  onDraftSaved: () => void;
}) {
  const [accountId, setAccountId] = useState(init.accountId);
  const [to, setTo] = useState(init.to);
  const [cc, setCc] = useState(init.cc);
  const [bcc, setBcc] = useState(init.bcc);
  const [showCc, setShowCc] = useState(!!init.cc);
  const [showBcc, setShowBcc] = useState(!!init.bcc);
  const [subject, setSubject] = useState(init.subject);
  const [body, setBody] = useState(init.body);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [busy, setBusy] = useState<'idle' | 'send' | 'draft'>('idle');
  const [error, setError] = useState('');

  const draft = (): Draft => ({
    accountId,
    to,
    cc,
    bcc,
    subject,
    body,
    attachments,
    inReplyTo: init.inReplyTo,
    references: init.references,
  });

  const pick = async () => {
    const picked = await open({ multiple: true });
    if (!picked) return;
    const list = Array.isArray(picked) ? picked : [picked];
    setAttachments((a) => [...a, ...list.filter((p) => !a.includes(p))]);
  };

  const send = async () => {
    if (!to.trim() && !cc.trim() && !bcc.trim()) {
      setError(t.needTo);
      return;
    }
    setError('');
    setBusy('send');
    try {
      await api.sendMessage(draft());
      onSent();
    } catch (e) {
      setError(String(e));
      setBusy('idle');
    }
  };

  const saveDraft = async () => {
    setError('');
    setBusy('draft');
    try {
      await api.saveDraft(draft());
      onDraftSaved();
    } catch (e) {
      setError(String(e));
      setBusy('idle');
    }
  };

  const discard = () => {
    const dirty = body !== init.body || to !== init.to || subject !== init.subject || attachments.length > 0;
    if (!dirty || window.confirm(t.confirmDiscard)) onClose();
  };

  const title =
    init.kind === 'reply' ? t.composeReply : init.kind === 'forward' ? t.composeForward : t.compose;

  const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

  return (
    <div className="overlay" onClick={discard}>
      <div className="modal compose" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <label className="field">
          <span>{t.fromAccount}</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name ? `${a.name} <${a.email}>` : a.email}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t.to}</span>
          <input type="text" value={to} onChange={(e) => setTo(e.target.value)} autoFocus={!init.to} />
        </label>
        {showCc && (
          <label className="field">
            <span>{t.cc}</span>
            <input type="text" value={cc} onChange={(e) => setCc(e.target.value)} />
          </label>
        )}
        {showBcc && (
          <label className="field">
            <span>{t.bcc}</span>
            <input type="text" value={bcc} onChange={(e) => setBcc(e.target.value)} />
          </label>
        )}
        {(!showCc || !showBcc) && (
          <div className="linkrow">
            {!showCc && (
              <button type="button" onClick={() => setShowCc(true)}>
                {t.addCc}
              </button>
            )}
            {!showBcc && (
              <button type="button" onClick={() => setShowBcc(true)}>
                {t.addBcc}
              </button>
            )}
          </div>
        )}
        <label className="field">
          <span>{t.subject}</span>
          <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="field">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} autoFocus={!!init.to} />
        </label>
        {attachments.length > 0 && (
          <div className="attachlist">
            {attachments.map((p) => (
              <div key={p}>
                <IconPaperclip size={12} />
                <span className="path" title={p}>
                  {fileName(p)}
                </span>
                <button
                  className="icon ghost"
                  title={t.removeAttachment}
                  onClick={() => setAttachments((a) => a.filter((x) => x !== p))}
                >
                  <IconX size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        {error && <div className="errline">{error}</div>}
        <div className="btnrow">
          <button onClick={pick} disabled={busy !== 'idle'}>
            <IconPaperclip size={12} /> {t.attach}
          </button>
          <button onClick={saveDraft} disabled={busy !== 'idle'}>
            {t.saveDraft}
          </button>
          <span className="spacer" />
          <button className="ghost" onClick={discard} disabled={busy !== 'idle'}>
            {t.discard}
          </button>
          <button className="primary" onClick={send} disabled={busy !== 'idle'}>
            <IconSend size={12} /> {busy === 'send' ? t.sending : t.send}
          </button>
        </div>
      </div>
    </div>
  );
}
