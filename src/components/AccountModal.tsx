import { useState } from 'react';
import { Account, AccountInput, Security, api } from '../api';
import { Dict } from '../i18n';

const COLORS = ['#38bdf8', '#34d399', '#a78bfa', '#fbbf24', '#f87171', '#fb923c', '#e879f9'];

function emptyInput(): AccountInput {
  return {
    name: '',
    email: '',
    imapHost: '',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: '',
    smtpPort: 465,
    smtpSecurity: 'tls',
    username: '',
    signature: '',
    color: COLORS[0],
    password: '',
  };
}

export function AccountModal({
  account,
  expert,
  t,
  onClose,
  onSaved,
}: {
  account: Account | null;
  expert: boolean;
  t: Dict;
  onClose: () => void;
  onSaved: (a: Account) => void;
}) {
  const [f, setF] = useState<AccountInput>(() =>
    account
      ? {
          id: account.id,
          name: account.name,
          email: account.email,
          imapHost: account.imapHost,
          imapPort: account.imapPort,
          imapSecurity: account.imapSecurity,
          smtpHost: account.smtpHost,
          smtpPort: account.smtpPort,
          smtpSecurity: account.smtpSecurity,
          username: account.username,
          signature: account.signature,
          color: account.color || COLORS[0],
          password: '',
        }
      : emptyInput()
  );
  const [showServers, setShowServers] = useState(expert || !!account);
  const [guess, setGuess] = useState<'none' | 'ok' | 'fail'>('none');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof AccountInput>(k: K, v: AccountInput[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  const guessServers = async () => {
    if (!f.email.includes('@')) return;
    if (!f.username) set('username', f.email);
    // nur vorbelegen, wenn noch nichts eingetragen wurde
    if (f.imapHost && f.smtpHost) return;
    try {
      const g = await api.guessServers(f.email);
      if (g) {
        setF((p) => ({ ...p, ...g, username: p.username || p.email }));
        setGuess('ok');
      } else {
        setGuess('fail');
        setShowServers(true);
      }
    } catch {
      setGuess('fail');
      setShowServers(true);
    }
  };

  const payload = (): AccountInput => {
    const out: AccountInput = { ...f, username: f.username || f.email };
    if (!out.password) delete out.password;
    return out;
  };

  const test = async () => {
    setTesting(true);
    setTestResult([]);
    setError('');
    try {
      const r = await api.testAccount(payload());
      setTestResult([`IMAP: ${r.imap}`, `SMTP: ${r.smtp}`]);
    } catch (e) {
      setError(String(e));
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setError('');
    if (!f.email.includes('@') || !f.imapHost || !f.smtpHost) {
      setShowServers(true);
      setError(t.accNotGuessed);
      return;
    }
    setSaving(true);
    try {
      const a = await api.saveAccount(payload());
      onSaved(a);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const secSelect = (value: Security, onChange: (s: Security) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value as Security)}>
      <option value="tls">{t.secTls}</option>
      <option value="starttls">{t.secStarttls}</option>
      <option value="none">{t.secNone}</option>
    </select>
  );

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>{t.accountTitle}</h2>
        <div className="row2">
          <label className="field grow1">
            <span>{t.accName}</span>
            <input type="text" value={f.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label className="field grow1">
            <span>{t.accEmail}</span>
            <input
              type="text"
              value={f.email}
              onChange={(e) => set('email', e.target.value.trim())}
              onBlur={guessServers}
              autoFocus={!account}
            />
          </label>
        </div>
        <div className="row2">
          <label className="field grow1">
            <span>{account ? t.accPasswordKeep : t.accPassword}</span>
            <input
              type="password"
              value={f.password ?? ''}
              onChange={(e) => set('password', e.target.value)}
            />
          </label>
          <label className="field grow1">
            <span>
              {t.accUsername} <span className="dim">— {t.accUsernameHint}</span>
            </span>
            <input
              type="text"
              value={f.username}
              placeholder={f.email}
              onChange={(e) => set('username', e.target.value)}
            />
          </label>
        </div>
        {guess === 'ok' && <div className="note">{t.accGuessed}</div>}
        {guess === 'fail' && <div className="note">{t.accNotGuessed}</div>}
        {account?.passwordStored === 'file' && <div className="note">{t.accStoredFile}</div>}

        {!expert && (
          <div className="linkrow">
            <button type="button" onClick={() => setShowServers((s) => !s)}>
              {showServers ? t.accHideServers : t.accShowServers}
            </button>
          </div>
        )}
        {showServers && (
          <>
            <div className="fieldlabel">{t.accImap}</div>
            <div className="row2">
              <label className="field grow1">
                <span>{t.accHost}</span>
                <input
                  type="text"
                  value={f.imapHost}
                  onChange={(e) => set('imapHost', e.target.value.trim())}
                />
              </label>
              <label className="field" style={{ width: 90 }}>
                <span>{t.accPort}</span>
                <input
                  type="number"
                  value={f.imapPort}
                  onChange={(e) => set('imapPort', Number(e.target.value) || 0)}
                />
              </label>
              <label className="field" style={{ width: 130 }}>
                <span>{t.accSecurity}</span>
                {secSelect(f.imapSecurity, (s) => set('imapSecurity', s))}
              </label>
            </div>
            <div className="fieldlabel">{t.accSmtp}</div>
            <div className="row2">
              <label className="field grow1">
                <span>{t.accHost}</span>
                <input
                  type="text"
                  value={f.smtpHost}
                  onChange={(e) => set('smtpHost', e.target.value.trim())}
                />
              </label>
              <label className="field" style={{ width: 90 }}>
                <span>{t.accPort}</span>
                <input
                  type="number"
                  value={f.smtpPort}
                  onChange={(e) => set('smtpPort', Number(e.target.value) || 0)}
                />
              </label>
              <label className="field" style={{ width: 130 }}>
                <span>{t.accSecurity}</span>
                {secSelect(f.smtpSecurity, (s) => set('smtpSecurity', s))}
              </label>
            </div>
          </>
        )}

        <label className="field">
          <span>{t.accSignature}</span>
          <textarea
            rows={3}
            value={f.signature}
            onChange={(e) => set('signature', e.target.value)}
          />
        </label>
        {expert && (
          <label className="field">
            <span>{t.accColor}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`icon ${f.color === c ? 'active' : ''}`}
                  style={{ background: c, width: 22, height: 22, borderColor: f.color === c ? '#fff' : c }}
                  onClick={() => set('color', c)}
                />
              ))}
            </div>
          </label>
        )}

        {testResult.map((l) => (
          <div key={l} className="okline">
            {l}
          </div>
        ))}
        {error && <div className="errline">{error}</div>}

        <div className="btnrow">
          <button onClick={test} disabled={testing || saving}>
            {testing ? t.accTesting : t.accTest}
          </button>
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            {t.cancel}
          </button>
          <button className="primary" onClick={save} disabled={saving || testing}>
            {t.saveAccount}
          </button>
        </div>
      </div>
    </div>
  );
}
