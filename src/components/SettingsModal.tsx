import { useEffect, useState } from 'react';
import { Account, Settings, UpdateInfo, api } from '../api';
import { Dict } from '../i18n';
import { IconEdit, IconPlus, IconTrash } from '../icons';

export const APP_VERSION = '0.1.0';

type SetTab = 'general' | 'reading' | 'compose' | 'accounts' | 'app';

export function SettingsModal({
  settings,
  accounts,
  t,
  onClose,
  onSave,
  onLive,
  onAddAccount,
  onEditAccount,
  onDeleteAccount,
}: {
  settings: Settings;
  accounts: Account[];
  t: Dict;
  onClose: () => void;
  onSave: (s: Settings) => void;
  onLive: (s: Settings) => void;
  onAddAccount: () => void;
  onEditAccount: (a: Account) => void;
  onDeleteAccount: (a: Account) => void;
}) {
  const [tab, setTab] = useState<SetTab>('general');
  const [s, setS] = useState<Settings>({ ...settings });
  const [updState, setUpdState] = useState<'idle' | 'checking' | 'none' | 'error'>('idle');
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dataPath, setDataPath] = useState('');

  useEffect(() => {
    api.dataPath().then(setDataPath).catch(() => {});
  }, []);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setS((prev) => {
      const next = { ...prev, [key]: value };
      onLive(next);
      return next;
    });

  const checkUpdates = () => {
    setUpdState('checking');
    setUpdate(null);
    api
      .checkUpdate()
      .then((u) => {
        if (u) {
          setUpdate(u);
          setUpdState('idle');
        } else setUpdState('none');
      })
      .catch(() => setUpdState('error'));
  };

  const expert = s.mode === 'expert';
  const tabs: [SetTab, string][] = [
    ['general', t.setGeneral],
    ['reading', t.setReading],
    ['compose', t.setCompose],
    ['accounts', t.setAccounts],
    ['app', t.setApp],
  ];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <h2>{t.settings}</h2>
        <div className="set-tabs">
          {tabs.map(([id, label]) => (
            <button key={id} className={`chip ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'general' && (
          <>
            <div className="row2">
              <label className="field grow1">
                <span>{t.language}</span>
                <select value={s.language} onChange={(e) => set('language', e.target.value as 'de' | 'en')}>
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label className="field grow1">
                <span>{t.mode}</span>
                <select value={s.mode} onChange={(e) => set('mode', e.target.value as Settings['mode'])}>
                  <option value="simple">{t.modeSimple}</option>
                  <option value="expert">{t.modeExpert}</option>
                </select>
              </label>
            </div>
            <div className="note">{t.modeHint}</div>
            <div className="row2">
              <label className="field grow1">
                <span>{t.theme}</span>
                <select value={s.theme} onChange={(e) => set('theme', e.target.value)}>
                  <option value="dark">{t.themeDark}</option>
                  <option value="light">{t.themeLight}</option>
                </select>
              </label>
              <label className="field grow1">
                <span>{t.accent}</span>
                <select value={s.accent} onChange={(e) => set('accent', e.target.value)}>
                  <option value="blue">{t.accentBlue}</option>
                  <option value="emerald">{t.accentEmerald}</option>
                  <option value="violet">{t.accentViolet}</option>
                  <option value="amber">{t.accentAmber}</option>
                </select>
              </label>
            </div>
          </>
        )}

        {tab === 'reading' && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={s.markReadOnOpen}
                onChange={(e) => set('markReadOnOpen', e.target.checked)}
              />
              {t.markReadOnOpen}
            </label>
            {expert && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.loadRemoteImages}
                  onChange={(e) => set('loadRemoteImages', e.target.checked)}
                />
                {t.loadRemoteImages}
              </label>
            )}
            <div className="row2">
              <label className="field grow1">
                <span>{t.pageSize}</span>
                <input
                  type="number"
                  min={10}
                  max={500}
                  value={s.pageSize}
                  onChange={(e) => set('pageSize', Math.max(10, Math.min(500, Number(e.target.value) || 50)))}
                />
              </label>
              <label className="field grow1">
                <span>{t.checkInterval}</span>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={s.checkIntervalMin}
                  onChange={(e) => set('checkIntervalMin', Math.max(0, Number(e.target.value) || 0))}
                />
              </label>
            </div>
          </>
        )}

        {tab === 'compose' && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={s.quoteOnReply}
                onChange={(e) => set('quoteOnReply', e.target.checked)}
              />
              {t.quoteOnReply}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={s.confirmDelete}
                onChange={(e) => set('confirmDelete', e.target.checked)}
              />
              {t.confirmDeleteSetting}
            </label>
            {expert && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.composeHtml}
                  onChange={(e) => set('composeHtml', e.target.checked)}
                />
                {t.composeHtmlSetting}
              </label>
            )}
          </>
        )}

        {tab === 'accounts' && (
          <>
            {accounts.length === 0 && <div className="note">{t.noAccounts}</div>}
            {accounts.map((a) => (
              <div key={a.id} className="acct-row">
                <span className="swatch" style={{ background: a.color || 'var(--blue)' }} />
                <span className="grow1">
                  {a.name ? `${a.name} — ` : ''}
                  {a.email}
                  <div className="dim">
                    {a.imapHost}:{a.imapPort} · {a.smtpHost}:{a.smtpPort}
                    {a.passwordStored === 'file' ? ' · file' : ''}
                    {a.passwordStored === 'none' ? ' · !' : ''}
                  </div>
                </span>
                <button className="icon" title={t.editAccount} onClick={() => onEditAccount(a)}>
                  <IconEdit size={12} />
                </button>
                <button className="icon danger" title={t.deleteAccount} onClick={() => onDeleteAccount(a)}>
                  <IconTrash size={12} />
                </button>
              </div>
            ))}
            <div className="btnrow" style={{ justifyContent: 'flex-start' }}>
              <button onClick={onAddAccount}>
                <IconPlus size={12} /> {t.addAccount}
              </button>
            </div>
          </>
        )}

        {tab === 'app' && (
          <>
            <div className="fieldlabel">{t.updates}</div>
            <label className="check">
              <input
                type="checkbox"
                checked={s.autoUpdate}
                onChange={(e) => set('autoUpdate', e.target.checked)}
              />
              {t.autoUpdate}
            </label>
            <div className="updatebox">
              <span>
                {t.version} {APP_VERSION}
              </span>
              <button onClick={checkUpdates} disabled={updState === 'checking'}>
                {updState === 'checking' ? t.checking : t.checkUpdates}
              </button>
              {updState === 'none' && <span>{t.upToDate}</span>}
              {updState === 'error' && <span style={{ color: 'var(--red)' }}>{t.updateError}</span>}
              {update && (
                <>
                  <span>
                    {t.updateAvailable} <strong>{update.version}</strong>
                  </span>
                  <button
                    className="primary"
                    disabled={installing}
                    onClick={() => {
                      setInstalling(true);
                      api.installUpdate().catch(() => setInstalling(false));
                    }}
                  >
                    {installing ? t.updateInstalling : t.installUpdate}
                  </button>
                </>
              )}
            </div>
            <div className="sep" />
            <div className="fieldlabel">{t.dataPath}</div>
            <div className="note" style={{ userSelect: 'text', WebkitUserSelect: 'text' }}>
              {dataPath}
            </div>
            <div className="note">{t.privacyNote}</div>
            {expert && (
              <>
                <div className="fieldlabel">{t.shortcuts}</div>
                <div className="note">{t.shortcutHint}</div>
                <div className="note">{t.editorShortcutHint}</div>
              </>
            )}
          </>
        )}

        <div className="btnrow">
          <button className="ghost" onClick={onClose}>
            {t.cancel}
          </button>
          <button className="primary" onClick={() => onSave(s)}>
            {t.saveSettings}
          </button>
        </div>
      </div>
    </div>
  );
}
