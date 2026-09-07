import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Account, Draft, Priority, api } from '../api';
import { Dict } from '../i18n';
import { IconPaperclip, IconSend, IconX } from '../icons';
import { hasMarkup, markdownToMailHtml, stripQuotes, toggleQuote, wrapText } from '../markdown';

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
  /** Zitat der Originalnachricht (Antwort) — für „Original zitieren“,
   *  auch wenn das automatische Zitat abgeschaltet ist. */
  quote: string;
  inReplyTo: string | null;
  references: string[];
}

type Format = 'text' | 'html';

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

export function Compose({
  init,
  accounts,
  expert,
  composeHtml,
  t,
  onClose,
  onSent,
  onDraftSaved,
}: {
  init: ComposeInit;
  accounts: Account[];
  expert: boolean;
  composeHtml: boolean;
  t: Dict;
  onClose: () => void;
  onSent: () => void;
  onDraftSaved: () => void;
}) {
  const [accountId, setAccountId] = useState(init.accountId);
  const [to, setTo] = useState(init.to);
  const [cc, setCc] = useState(init.cc);
  const [bcc, setBcc] = useState(init.bcc);
  const [replyTo, setReplyTo] = useState('');
  const [showCc, setShowCc] = useState(!!init.cc);
  const [showBcc, setShowBcc] = useState(!!init.bcc);
  const [showReplyTo, setShowReplyTo] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [priority, setPriority] = useState<Priority>('normal');
  const [readReceipt, setReadReceipt] = useState(false);
  const [subject, setSubject] = useState(init.subject);
  const [body, setBody] = useState(init.body);
  const [format, setFormat] = useState<Format>(expert && composeHtml ? 'html' : 'text');
  const [preview, setPreview] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [busy, setBusy] = useState<'idle' | 'send' | 'draft'>('idle');
  const [error, setError] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  /** Auswahl, die nach dem nächsten Render gesetzt werden soll — React
   *  schreibt die Textarea nach setBody neu und verwirft dabei den Cursor. */
  const pendingSel = useRef<[number, number] | null>(null);

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta || !pendingSel.current) return;
    const [cs, ce] = pendingSel.current;
    pendingSel.current = null;
    ta.focus();
    ta.setSelectionRange(cs, ce);
  }, [body]);

  // Einfacher Modus: immer Klartext, keine Kopfzeilen-Extras.
  const useHtml = expert && format === 'html';

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
    html: useHtml && hasMarkup(body) ? markdownToMailHtml(body) : null,
    replyTo: expert ? replyTo : '',
    priority: expert ? priority : 'normal',
    readReceipt: expert && readReceipt,
  });

  const pick = async () => {
    const picked = await open({ multiple: true });
    if (!picked) return;
    const list = Array.isArray(picked) ? picked : [picked];
    setAttachments((a) => [...a, ...list.filter((p) => !a.includes(p))]);
  };

  const send = async () => {
    if (busy !== 'idle') return;
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
    if (busy !== 'idle') return;
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

  // --- Editor-Werkzeuge (Experte) -----------------------------------------
  // Änderungen laufen über execCommand('insertText'), damit der native
  // Undo-Stack der Textarea (⌘Z) erhalten bleibt; Fallback: setState.

  /** Ersetzt [start,end) durch `text` und setzt danach die Auswahl. */
  const replaceRange = (start: number, end: number, text: string, sel?: [number, number]) => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(start, end);
    let ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch {
      ok = false;
    }
    if (!ok || ta.value.slice(start, start + text.length) !== text) {
      const next = ta.value.slice(0, start) + text + ta.value.slice(end);
      setBody(next);
    }
    const [cs, ce] = sel ?? [start + text.length, start + text.length];
    pendingSel.current = [cs, ce];
    ta.setSelectionRange(cs, ce);
  };

  const selection = () => {
    const ta = taRef.current;
    if (!ta) return { start: 0, end: 0, text: '' };
    return { start: ta.selectionStart, end: ta.selectionEnd, text: ta.value.slice(ta.selectionStart, ta.selectionEnd) };
  };

  /** Auswahl mit Markern umschließen — oder wieder auspacken. */
  const wrap = (before: string, after = before) => {
    const { start, end, text } = selection();
    const value = taRef.current?.value ?? body;
    // schon umschlossen (Marker direkt außerhalb der Auswahl)?
    if (
      start >= before.length &&
      value.slice(start - before.length, start) === before &&
      value.slice(end, end + after.length) === after
    ) {
      replaceRange(start - before.length, end + after.length, text, [start - before.length, end - before.length]);
      return;
    }
    if (text.startsWith(before) && text.endsWith(after) && text.length >= before.length + after.length) {
      const inner = text.slice(before.length, text.length - after.length);
      replaceRange(start, end, inner, [start, start + inner.length]);
      return;
    }
    const inner = text || t.fmtPlaceholder;
    replaceRange(start, end, `${before}${inner}${after}`, [start + before.length, start + before.length + inner.length]);
  };

  /** Auswahl auf ganze Zeilen ausdehnen und Präfix je Zeile setzen/entfernen. */
  const prefixLines = (make: (i: number) => string, test: RegExp) => {
    const ta = taRef.current;
    if (!ta) return;
    const value = ta.value;
    const s0 = value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    let e0 = value.indexOf('\n', Math.max(ta.selectionEnd, s0));
    if (e0 === -1) e0 = value.length;
    if (ta.selectionEnd > ta.selectionStart && value[ta.selectionEnd - 1] === '\n') e0 = ta.selectionEnd - 1;
    const lines = value.slice(s0, e0).split('\n');
    const allHave = lines.every((l) => l.trim() === '' || test.test(l));
    const next = lines
      .map((l, i) => (allHave ? l.replace(test, '') : l.trim() === '' && lines.length > 1 ? l : `${make(i)}${l}`))
      .join('\n');
    replaceRange(s0, e0, next, [s0, s0 + next.length]);
  };

  const insertBlock = (text: string) => {
    const { start, end } = selection();
    const value = taRef.current?.value ?? body;
    const nlBefore = start === 0 || value[start - 1] === '\n' ? '' : '\n';
    const nlAfter = end >= value.length || value[end] === '\n' ? '' : '\n';
    const block = `${nlBefore}${text}${nlAfter}`;
    replaceRange(start, end, block, [start + block.length, start + block.length]);
  };

  const link = () => {
    const { start, end, text } = selection();
    const isUrl = /^(https?:\/\/|mailto:)\S+$/.test(text.trim());
    if (isUrl) {
      const md = `[${t.fmtPlaceholder}](${text.trim()})`;
      replaceRange(start, end, md, [start + 1, start + 1 + t.fmtPlaceholder.length]);
    } else {
      const label = text || t.fmtPlaceholder;
      const md = `[${label}](https://)`;
      const u = start + label.length + 3;
      replaceRange(start, end, md, [u, u + 8]);
    }
  };

  const codeBlock = () => {
    const { start, end, text } = selection();
    const inner = text || '';
    const value = taRef.current?.value ?? body;
    const nl = start === 0 || value[start - 1] === '\n' ? '' : '\n';
    const md = `${nl}\`\`\`\n${inner}\n\`\`\`\n`;
    const c = start + nl.length + 4;
    replaceRange(start, end, md, [c, c + inner.length]);
  };

  const replaceAll = (fn: (s: string) => string) => {
    const ta = taRef.current;
    if (!ta) return;
    const next = fn(ta.value);
    if (next === ta.value) return;
    replaceRange(0, ta.value.length, next, [next.length, next.length]);
  };

  const quoteSelection = () => {
    const { start, end, text } = selection();
    if (text) {
      const q = toggleQuote(text);
      replaceRange(start, end, q, [start, start + q.length]);
    } else prefixLines(() => '> ', /^\s*> ?/);
  };

  const insertSignature = () => {
    const sig = accounts.find((a) => a.id === accountId)?.signature ?? '';
    if (!sig) return;
    insertBlock(`\n-- \n${sig}`);
  };

  const insertOriginal = () => {
    if (!init.quote) return;
    insertBlock(`\n${init.quote}\n`);
  };

  const exec = (cmd: 'undo' | 'redo') => {
    taRef.current?.focus();
    try {
      document.execCommand(cmd);
    } catch {
      /* WebView ohne execCommand — dann bleibt nur die Tastatur */
    }
  };

  // Tastatur im Textfeld: ⌘⏎ senden, ⌘S Entwurf (beide Modi); Formatierung
  // nur im Expertenmodus.
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = IS_MAC ? e.metaKey : e.ctrlKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'enter') {
      e.preventDefault();
      send();
      return;
    }
    if (k === 's' && !e.shiftKey) {
      e.preventDefault();
      saveDraft();
      return;
    }
    if (!expert) return;
    if (k === 'b') wrap('**');
    else if (k === 'i') wrap('_');
    else if (k === 'e') wrap('`');
    else if (k === 'k') link();
    else if (k === 'x' && e.shiftKey) wrap('~~');
    else if (k === 'p' && e.shiftKey) setPreview((p) => !p);
    else return;
    e.preventDefault();
  };

  // Vorschau verlassen → Cursor zurück ins Textfeld
  useEffect(() => {
    if (!preview) taRef.current?.focus();
  }, [preview]);

  const stats = useMemo(() => {
    const chars = body.length;
    const words = body.trim() ? body.trim().split(/\s+/).length : 0;
    const lines = body ? body.split('\n').length : 0;
    return { chars, words, lines };
  }, [body]);

  const previewDoc = useMemo(
    () => (preview ? markdownToMailHtml(body.trim() ? body : t.previewEmpty) : ''),
    [preview, body, t.previewEmpty]
  );

  const title =
    init.kind === 'reply' ? t.composeReply : init.kind === 'forward' ? t.composeForward : t.compose;

  const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
  const hasSignature = !!accounts.find((a) => a.id === accountId)?.signature;

  return (
    <div className="overlay" onClick={discard}>
      <div className={`modal compose ${expert ? 'expert' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="titlerow">
          <h2>{title}</h2>
          <span className="spacer" />
          {expert && (
            <>
              <span className="fieldlabel">{t.format}</span>
              <select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                <option value="text">{t.formatText}</option>
                <option value="html">{t.formatHtml}</option>
              </select>
            </>
          )}
        </div>
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
        {expert && showReplyTo && (
          <label className="field">
            <span>{t.replyTo}</span>
            <input type="text" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} />
          </label>
        )}
        {(!showCc || !showBcc || (expert && (!showReplyTo || !showOptions))) && (
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
            {expert && !showReplyTo && (
              <button type="button" onClick={() => setShowReplyTo(true)}>
                {t.addReplyTo}
              </button>
            )}
            {expert && !showOptions && (
              <button type="button" onClick={() => setShowOptions(true)}>
                {t.addOptions}
              </button>
            )}
          </div>
        )}
        {expert && showOptions && (
          <div className="optrow">
            <label className="field">
              <span>{t.priority}</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                <option value="normal">{t.prioNormal}</option>
                <option value="high">{t.prioHigh}</option>
                <option value="low">{t.prioLow}</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={readReceipt} onChange={(e) => setReadReceipt(e.target.checked)} />
              {t.readReceipt}
            </label>
          </div>
        )}
        <label className="field">
          <span>{t.subject}</span>
          <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>

        {expert && (
          <div className="fmtbar" onMouseDown={(e) => e.preventDefault()}>
            <button className="b" title={t.fmtBold} disabled={preview} onClick={() => wrap('**')}>
              B
            </button>
            <button className="i" title={t.fmtItalic} disabled={preview} onClick={() => wrap('_')}>
              I
            </button>
            <button className="s" title={t.fmtStrike} disabled={preview} onClick={() => wrap('~~')}>
              S
            </button>
            <button title={t.fmtCode} disabled={preview} onClick={() => wrap('`')}>
              {'</>'}
            </button>
            <span className="sep" />
            <button title={t.fmtHeading} disabled={preview} onClick={() => prefixLines(() => '# ', /^\s*#{1,3} /)}>
              H
            </button>
            <button title={t.fmtBullet} disabled={preview} onClick={() => prefixLines(() => '- ', /^\s*[-*+] /)}>
              •
            </button>
            <button
              title={t.fmtNumbered}
              disabled={preview}
              onClick={() => prefixLines((i) => `${i + 1}. `, /^\s*\d+[.)] /)}
            >
              1.
            </button>
            <button title={t.fmtQuote} disabled={preview} onClick={quoteSelection}>
              {'>'}
            </button>
            <span className="sep" />
            <button title={t.fmtLink} disabled={preview} onClick={link}>
              [↗]
            </button>
            <button title={t.fmtCodeBlock} disabled={preview} onClick={codeBlock}>
              ```
            </button>
            <button title={t.fmtRule} disabled={preview} onClick={() => insertBlock('---')}>
              ―
            </button>
            <span className="sep" />
            <button title={t.fmtUndo} disabled={preview} onClick={() => exec('undo')}>
              ↶
            </button>
            <button title={t.fmtRedo} disabled={preview} onClick={() => exec('redo')}>
              ↷
            </button>
            <span className="sep" />
            {hasSignature && (
              <button className="tool" title={t.toolSignatureTitle} disabled={preview} onClick={insertSignature}>
                {t.toolSignature}
              </button>
            )}
            {init.quote && (
              <button className="tool" title={t.toolQuoteOriginalTitle} disabled={preview} onClick={insertOriginal}>
                {t.toolQuoteOriginal}
              </button>
            )}
            <button className="tool" title={t.toolWrapTitle} disabled={preview} onClick={() => replaceAll((s) => wrapText(s, 72))}>
              {t.toolWrap}
            </button>
            {/\n\s*>/.test(`\n${body}`) && (
              <button className="tool" title={t.toolStripQuotesTitle} disabled={preview} onClick={() => replaceAll(stripQuotes)}>
                {t.toolStripQuotes}
              </button>
            )}
            <span className="spacer" />
            <button className={`tool ${preview ? 'active' : ''}`} title={t.previewTitle} onClick={() => setPreview((p) => !p)}>
              {preview ? t.editor : t.preview}
            </button>
          </div>
        )}
        {expert && preview ? (
          <iframe className="previewframe" sandbox="" srcDoc={previewDoc} title="preview" />
        ) : (
          <label className="field">
            <textarea
              ref={taRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={onKey}
              autoFocus={!!init.to}
              spellCheck
            />
          </label>
        )}
        {expert && (
          <div className="editfoot">
            <span className="hint">{useHtml ? t.hintHtml : t.hintText}</span>
            <span className="cnt">{t.counter(stats.chars, stats.words, stats.lines)}</span>
          </div>
        )}

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
          <button onClick={saveDraft} disabled={busy !== 'idle'} title="⌘S">
            {t.saveDraft}
          </button>
          <span className="spacer" />
          <button className="ghost" onClick={discard} disabled={busy !== 'idle'}>
            {t.discard}
          </button>
          <button className="primary" onClick={send} disabled={busy !== 'idle'} title="⌘⏎">
            <IconSend size={12} /> {busy === 'send' ? t.sending : t.send}
          </button>
        </div>
      </div>
    </div>
  );
}
