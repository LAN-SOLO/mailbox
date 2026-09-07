import { Account, Folder, FolderRole } from '../api';
import { Dict } from '../i18n';
import {
  IconArchive,
  IconDraft,
  IconEdit,
  IconFolder,
  IconInbox,
  IconJunk,
  IconMail,
  IconPlus,
  IconSend,
  IconTrash,
} from '../icons';

export interface FolderSel {
  accountId: string;
  folder: string;
}

const SIMPLE_ROLES: FolderRole[] = ['inbox', 'drafts', 'sent', 'archive', 'junk', 'trash'];

export function roleLabel(f: Folder, t: Dict): string {
  switch (f.role) {
    case 'inbox':
      return t.folderInbox;
    case 'sent':
      return t.folderSent;
    case 'drafts':
      return t.folderDrafts;
    case 'trash':
      return t.folderTrash;
    case 'junk':
      return t.folderJunk;
    case 'archive':
      return t.folderArchive;
    default:
      return f.display;
  }
}

function RoleIcon({ role }: { role: FolderRole }) {
  switch (role) {
    case 'inbox':
      return <IconInbox size={13} />;
    case 'sent':
      return <IconSend size={13} />;
    case 'drafts':
      return <IconDraft size={13} />;
    case 'trash':
      return <IconTrash size={13} />;
    case 'junk':
      return <IconJunk size={13} />;
    case 'archive':
      return <IconArchive size={13} />;
    default:
      return <IconFolder size={13} />;
  }
}

export function Sidebar({
  accounts,
  folders,
  expert,
  sel,
  unified,
  t,
  onSelect,
  onSelectUnified,
  onAddAccount,
  onEditAccount,
  onCreateFolder,
  onDeleteFolder,
  onEmptyTrash,
}: {
  accounts: Account[];
  folders: Record<string, Folder[]>;
  expert: boolean;
  sel: FolderSel | null;
  unified: boolean;
  t: Dict;
  onSelect: (s: FolderSel) => void;
  onSelectUnified: () => void;
  onAddAccount: () => void;
  onEditAccount: (a: Account) => void;
  onCreateFolder: (accountId: string) => void;
  onDeleteFolder: (accountId: string, folder: Folder) => void;
  onEmptyTrash: (accountId: string, folder: Folder) => void;
}) {
  const totalUnread = Object.values(folders)
    .flat()
    .filter((f) => f.role === 'inbox')
    .reduce((n, f) => n + (f.unread ?? 0), 0);

  return (
    <div className="sidebar">
      {expert && accounts.length > 1 && (
        <div className="sb-unified">
          <button className={`sb-folder ${unified ? 'active' : ''}`} onClick={onSelectUnified}>
            <IconMail size={13} />
            <span className="fname">{t.unifiedInbox}</span>
            {totalUnread > 0 && <span className="cnt unread">{totalUnread}</span>}
          </button>
        </div>
      )}
      {accounts.map((a) => {
        const list = folders[a.id] ?? [];
        // Einfach: nur Rollen-Ordner in fester Reihenfolge
        const visible = expert
          ? list
          : SIMPLE_ROLES.map((r) => list.find((f) => f.role === r)).filter((f): f is Folder => !!f);
        return (
          <div key={a.id}>
            <div className="sb-account" title={a.email}>
              <span className="swatch" style={{ background: a.color || 'var(--blue)' }} />
              <span className="name">{a.name || a.email}</span>
              {expert && (
                <>
                  <button className="icon ghost" title={t.newFolder} onClick={() => onCreateFolder(a.id)}>
                    <IconPlus size={11} />
                  </button>
                  <button className="icon ghost" title={t.editAccount} onClick={() => onEditAccount(a)}>
                    <IconEdit size={11} />
                  </button>
                </>
              )}
            </div>
            {visible.map((f) => {
              const active = !unified && sel?.accountId === a.id && sel.folder === f.name;
              const label = expert && f.role === 'other' ? f.display : roleLabel(f, t);
              return (
                <button
                  key={f.name}
                  className={`sb-folder ${active ? 'active' : ''} ${f.noSelect ? 'noselect' : ''}`}
                  style={{ paddingLeft: 12 + (expert ? f.depth * 12 : 0) }}
                  title={f.name}
                  disabled={f.noSelect}
                  onClick={() => onSelect({ accountId: a.id, folder: f.name })}
                  onContextMenu={(e) => {
                    if (!expert) return;
                    e.preventDefault();
                    if (f.role === 'trash') onEmptyTrash(a.id, f);
                    else if (f.role === 'other') onDeleteFolder(a.id, f);
                  }}
                >
                  <RoleIcon role={f.role} />
                  <span className="fname">{label}</span>
                  {f.unread ? (
                    <span className="cnt unread">{f.unread}</span>
                  ) : expert && f.total != null ? (
                    <span className="cnt">{f.total}</span>
                  ) : null}
                </button>
              );
            })}
            {expert && list.some((f) => f.role === 'trash') && (
              <div className="sb-actions">
                <button
                  className="ghost"
                  onClick={() => {
                    const trash = list.find((f) => f.role === 'trash');
                    if (trash) onEmptyTrash(a.id, trash);
                  }}
                >
                  <IconTrash size={11} /> {t.emptyTrash}
                </button>
              </div>
            )}
          </div>
        );
      })}
      <div className="sb-actions" style={{ marginTop: 8 }}>
        <button className="ghost" onClick={onAddAccount}>
          <IconPlus size={11} /> {t.addAccount}
        </button>
      </div>
    </div>
  );
}
