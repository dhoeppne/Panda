import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { IconButton } from '@astryxdesign/core/IconButton';
import { useImperativeAlertDialog } from '@astryxdesign/core/AlertDialog';
import { Spinner } from '@astryxdesign/core/Spinner';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';
import pandaBadge from '../assets/brand/panda-badge.png';
import { usePanda, type SessionEntry } from '../store';
import type { SessionDocument } from '../protocol/types';
import { connectionLifecycle, isLinkUp, type ConnectionPhase } from '../projector/connectionLifecycle';
import { reconcileProfileSlots } from '../liveConnections';
import { effectiveCapability, PANDA_HOST_CAPABILITIES } from '../capabilities';
import { useI18n } from '../i18n/context';
import { formatRelativeTime } from '../relativeTime';
import type { AgentProfile } from '../profiles';
import { navigate, useHashRoute } from '../routes';
import { notifyUser } from '../userNotice';
import { workspaceLabel } from '../workspace';
import { useNewChat, useProfiles } from '../newChat';
import {
  addFolder,
  addSection,
  buildNavTree,
  forgetChat,
  loadNavLayout,
  navKey,
  newNavId,
  placeChat,
  removeFolder,
  removeSection,
  renameFolder,
  renameSection,
  saveNavLayout,
  setChatTitle,
  subscribeNavLayout,
  toggleFolder,
  toggleSection,
  type NavLayout,
  type NavPlacement,
  type NavRow,
  type RecencyBucket,
} from '../navLayout';
import type { LiveSessionFacade } from '../useLiveSession';
import { SettingsSideNav, type SettingsSectionId } from './SettingsPage';
import { FamilyBadge } from './FamilyPicker';
import './Sidebar.css';

/** One chat of the merged list, with what the row needs to render. */
type ChatRow = NavRow & { entry: SessionEntry; familyName: string };

/** The persisted layout, kept current with storage. Writes that storage
 * rejects tell the user; the in-memory view still moves. */
function useNavLayout(): [NavLayout, (next: NavLayout) => void] {
  const [layout, setLayout] = useState<NavLayout>(() => loadNavLayout());
  const { t } = useI18n();
  useEffect(() => subscribeNavLayout(setLayout), []);
  const commit = useCallback(
    (next: NavLayout) => {
      setLayout(next);
      if (!saveNavLayout(next)) notifyUser('error', t('side.notice.layoutSaveFailed'));
    },
    [t],
  );
  return [layout, commit];
}

/**
 * The merged chat list: every session of every family connection, keyed by
 * endpoint + session id. The selector returns slot ids, endpoints and the
 * session-list refs only, so streaming document updates do not re-render
 * the whole list (useShallow compares element by element).
 */
function useChatRows(profiles: AgentProfile[]): ChatRow[] {
  const flat = usePanda(
    useShallow((s) =>
      Object.entries(s.connections).flatMap(([id, slot]) => [id, slot.connection.url, slot.sessions] as const),
    ),
  );
  return useMemo(() => {
    const rows: ChatRow[] = [];
    for (let index = 0; index < flat.length; index += 3) {
      const connectionId = flat[index] as string;
      const endpoint = flat[index + 1] as string | null;
      const sessions = flat[index + 2] as SessionEntry[];
      if (!endpoint) continue;
      const familyName = profiles.find((profile) => profile.id === connectionId)?.name ?? endpoint;
      for (const entry of sessions) {
        rows.push({
          key: navKey(endpoint, entry.sessionId),
          connectionId,
          sessionId: entry.sessionId,
          cwd: entry.cwd,
          updatedAt: entry.updatedAt,
          entry,
          familyName,
        });
      }
    }
    return rows;
  }, [flat, profiles]);
}

/** What the sidebar is dragging: a chat's layout key. */
const DRAG_TYPE = 'application/x-panda-chat';

/**
 * Session-centered sidebar (navigation redesign): New chat, search, then
 * one list of every family's chats — Pinned, the user's sections (folders,
 * then loose chats) and Recents by date. Each row carries its family's
 * badge. The footer shows one status dot per family and the settings gear.
 */
export function Sidebar({ live, mobileOpen, onMobileClose, settingsSection, onSelectSettingsSection }: {
  live: LiveSessionFacade;
  mobileOpen: boolean;
  onMobileClose(): void;
  /** Which settings section is showing (#117). */
  settingsSection: SettingsSectionId;
  onSelectSettingsSection(id: SettingsSectionId): void;
}) {
  const { t } = useI18n();
  const onSettings = useHashRoute() === 'settings';
  const exitSettings = () => {
    if (onSettings) navigate('main');
  };
  const profiles = useProfiles();
  const familyNames = useMemo(() => profiles.map((profile) => profile.name), [profiles]);

  // Topology follows the profile list (seed + prune, #61); every family then
  // connects once in the background so its chats join the merged list.
  useEffect(() => {
    reconcileProfileSlots(profiles);
    live.connectInBackground(profiles);
  }, [profiles, live]);

  const [layout, commit] = useNavLayout();
  const rows = useChatRows(profiles);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState<{ kind: 'section' } | { kind: 'folder'; sectionId: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const newChatOpen = useNewChat((s) => s.open);

  const closeNav = () => {
    exitSettings();
    onMobileClose();
  };

  const startNewChat = () => {
    useNewChat.getState().start();
    closeNav();
  };

  const rowProps = {
    layout,
    commit,
    live,
    familyNames,
    newChatOpen,
    renaming,
    setRenaming,
    onOpened: closeNav,
  };

  const query = search.trim().toLowerCase();
  const tree = useMemo(() => buildNavTree(rows, layout, new Date()), [rows, layout]);
  const hits = useMemo(() => {
    if (!query) return [];
    const docs = usePanda.getState().connections;
    return rows
      .filter((row) => chatLabel(row, layout, docs[row.connectionId]?.docs[row.sessionId]).toLowerCase().includes(query))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }, [query, rows, layout]);

  const commitNewName = (name: string) => {
    const trimmed = name.trim();
    if (adding && trimmed) {
      commit(
        adding.kind === 'section'
          ? addSection(layout, newNavId(), trimmed)
          : addFolder(layout, adding.sectionId, newNavId(), trimmed),
      );
    }
    setAdding(null);
  };

  const list = (
    <>
      {query ? (
        <NavGroup label={t('side.results', { n: hits.length })}>
          {hits.length > 0
            ? hits.map((row) => <ChatRowItem key={row.key} row={row} {...rowProps} />)
            : <div className="sidebar-empty">{t('side.noMatches')}</div>}
        </NavGroup>
      ) : rows.length === 0 ? (
        <NavGroup label={t('side.recents')}>
          <div className="sidebar-empty">
            {profiles.length === 0 ? t('side.noFamilies') : t('side.noChats')}
          </div>
        </NavGroup>
      ) : (
        <>
          {tree.pinned.length > 0 && (
            <NavGroup
              label={t('side.pinned')}
              collapsed={layout.pinnedCollapsed}
              onToggle={() => commit({ ...layout, pinnedCollapsed: !layout.pinnedCollapsed })}
              drop={{ placement: { kind: 'pinned' }, layout, commit }}
            >
              {tree.pinned.map((row) => <ChatRowItem key={row.key} row={row} {...rowProps} />)}
            </NavGroup>
          )}
          {tree.sections.map(({ section, folders, loose }) => (
            <NavGroup
              key={section.id}
              label={section.name}
              collapsed={section.collapsed}
              onToggle={() => commit(toggleSection(layout, section.id))}
              drop={{ placement: { kind: 'section', sectionId: section.id, folderId: null }, layout, commit }}
              renaming={renaming === `section:${section.id}`}
              onRename={(name) => {
                if (name.trim()) commit(renameSection(layout, section.id, name.trim()));
                setRenaming(null);
              }}
              actions={
                <>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<FolderPlus size={12} />}
                    label={t('side.newFolderIn', { name: section.name })}
                    tooltip={t('side.newFolder')}
                    clickAction={() => {
                      if (section.collapsed) commit(toggleSection(layout, section.id));
                      setAdding({ kind: 'folder', sectionId: section.id });
                    }}
                  />
                  <NavMenu label={t('side.sectionActions')}>
                    {(close) => (
                      <>
                        <MenuItem icon={<FolderPlus size={14} />} onSelect={() => {
                          close();
                          if (section.collapsed) commit(toggleSection(layout, section.id));
                          setAdding({ kind: 'folder', sectionId: section.id });
                        }}>{t('side.newFolder')}</MenuItem>
                        <MenuItem icon={<Pencil size={14} />} onSelect={() => {
                          close();
                          setRenaming(`section:${section.id}`);
                        }}>{t('side.renameSection')}</MenuItem>
                        <hr className="nav-menu-sep" />
                        <MenuItem icon={<Trash2 size={14} />} danger hint={t('side.deleteSectionHint')} onSelect={() => {
                          close();
                          commit(removeSection(layout, section.id));
                        }}>{t('side.deleteSection')}</MenuItem>
                      </>
                    )}
                  </NavMenu>
                </>
              }
            >
              {folders.map(({ folder, rows: folderRows }) => (
                <FolderBlock
                  key={folder.id}
                  name={folder.name}
                  count={folderRows.length}
                  collapsed={folder.collapsed}
                  onToggle={() => commit(toggleFolder(layout, section.id, folder.id))}
                  drop={{ placement: { kind: 'section', sectionId: section.id, folderId: folder.id }, layout, commit }}
                  renaming={renaming === `folder:${folder.id}`}
                  onRename={(name) => {
                    if (name.trim()) commit(renameFolder(layout, section.id, folder.id, name.trim()));
                    setRenaming(null);
                  }}
                  onStartRename={() => setRenaming(`folder:${folder.id}`)}
                  onDelete={() => commit(removeFolder(layout, section.id, folder.id))}
                >
                  {folderRows.map((row) => <ChatRowItem key={row.key} row={row} {...rowProps} />)}
                </FolderBlock>
              ))}
              {adding?.kind === 'folder' && adding.sectionId === section.id && (
                <InlineName
                  icon={<Folder size={14} className="sidebar-icon-faint" />}
                  placeholder={t('side.folderName')}
                  onDone={commitNewName}
                />
              )}
              {loose.map((row) => <ChatRowItem key={row.key} row={row} {...rowProps} />)}
              {folders.length === 0 && loose.length === 0 && !(adding?.kind === 'folder' && adding.sectionId === section.id) && (
                <div className="sidebar-empty">{t('side.dropHere')}</div>
              )}
            </NavGroup>
          ))}
          {adding?.kind === 'section' ? (
            <InlineName placeholder={t('side.sectionName')} onDone={commitNewName} />
          ) : (
            <button type="button" className="nav-add-section" onClick={() => setAdding({ kind: 'section' })}>
              <Plus size={13} />
              {t('side.newSection')}
            </button>
          )}
          <NavGroup
            label={t('side.recents')}
            collapsed={layout.recentsCollapsed}
            onToggle={() => commit({ ...layout, recentsCollapsed: !layout.recentsCollapsed })}
            drop={{ placement: null, layout, commit }}
          >
            {tree.recents.length > 0
              ? tree.recents.map(({ bucket, rows: bucketRows }) => (
                  <div key={bucket} className="nav-bucket-group">
                    <div className="nav-bucket">{t(BUCKET_LABELS[bucket])}</div>
                    {bucketRows.map((row) => <ChatRowItem key={row.key} row={row} {...rowProps} />)}
                  </div>
                ))
              : <div className="sidebar-empty">{t('side.allFiled')}</div>}
          </NavGroup>
        </>
      )}
    </>
  );

  return (
    <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
      <div className="sidebar-brand">
        <span className="sidebar-logo">
          <img src={pandaBadge} alt="" />
        </span>
        Panda
        <span className="sidebar-brand-actions">
          <span className="sidebar-close">
            <IconButton
              variant="ghost"
              size="sm"
              icon={<X size={16} />}
              label={t('app.closeNav')}
              clickAction={onMobileClose}
            />
          </span>
        </span>
      </div>

      {onSettings ? (
        <SettingsSideNav
          activeId={settingsSection}
          onSelect={onSelectSettingsSection}
          onNavigate={onMobileClose}
          onBack={exitSettings}
        />
      ) : (
        <>
          <div className="nav-top">
            <button
              type="button"
              className={`nav-new-chat ${newChatOpen ? 'nav-new-chat--active' : ''}`}
              onClick={startNewChat}
              disabled={profiles.length === 0}
            >
              <SquarePen size={15} />
              {t('side.newChat')}
            </button>
            <label className="nav-search">
              <Search size={14} />
              <input
                type="search"
                value={search}
                placeholder={t('side.search')}
                aria-label={t('side.search')}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
          <div className="sidebar-sessions nav-list">{list}</div>
        </>
      )}

      <div className="sidebar-footer">
        <div className="nav-families">
          {profiles.length === 0 && !onSettings ? (
            <button
              type="button"
              className="nav-family"
              onClick={() => {
                onSelectSettingsSection('agents');
                navigate('settings');
                onMobileClose();
              }}
            >
              <Plus size={12} />
              {t('side.addAgent')}
            </button>
          ) : (
            profiles.map((profile) => (
              <FamilyStatus
                key={profile.id}
                profile={profile}
                live={live}
                onActivated={closeNav}
              />
            ))
          )}
        </div>
        <IconButton
          variant="ghost"
          size="sm"
          icon={<Settings size={14} />}
          className={onSettings ? 'sidebar-settings-btn--active' : undefined}
          label={onSettings ? t('side.backToSession') : t('side.settings')}
          tooltip={onSettings ? t('side.backToSessionTooltip') : t('side.settingsTooltip')}
          clickAction={() => {
            navigate(onSettings ? 'main' : 'settings');
            onMobileClose();
          }}
        />
      </div>
    </aside>
  );
}

const BUCKET_LABELS: Record<RecencyBucket, 'side.bucket.today' | 'side.bucket.yesterday' | 'side.bucket.week' | 'side.bucket.older'> = {
  today: 'side.bucket.today',
  yesterday: 'side.bucket.yesterday',
  week: 'side.bucket.week',
  older: 'side.bucket.older',
};

/** A chat's visible label: the local Rename title, else the session row label. */
function chatLabel(row: ChatRow, layout: NavLayout, doc: SessionDocument | undefined): string {
  return layout.titles[row.key] ?? sessionRowLabel(row.entry, doc);
}

type DropTarget = { placement: NavPlacement | null; layout: NavLayout; commit(next: NavLayout): void };

/** Drag-and-drop wiring for one target (desktop; touch uses the Move to menu). */
function useDrop(drop: DropTarget | undefined) {
  const [over, setOver] = useState(false);
  if (!drop) return { over: false, handlers: {} };
  return {
    over,
    handlers: {
      onDragOver: (event: React.DragEvent) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        event.stopPropagation();
        setOver(true);
      },
      onDragLeave: (event: React.DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (event: React.DragEvent) => {
        const key = event.dataTransfer.getData(DRAG_TYPE);
        setOver(false);
        if (!key) return;
        event.preventDefault();
        event.stopPropagation();
        drop.commit(placeChat(drop.layout, key, drop.placement));
      },
    },
  };
}

/** A labeled group: Pinned, a section, Recents or search results. */
function NavGroup({ label, collapsed = false, onToggle, drop, actions, renaming, onRename, children }: {
  label: string;
  collapsed?: boolean;
  onToggle?(): void;
  drop?: DropTarget;
  actions?: ReactNode;
  renaming?: boolean;
  onRename?(name: string): void;
  children: ReactNode;
}) {
  const { over, handlers } = useDrop(drop);
  return (
    <section className={`nav-group ${over ? 'nav-drop' : ''}`} {...handlers}>
      <div className="nav-group-head">
        {renaming && onRename ? (
          <InlineName initial={label} placeholder={label} onDone={onRename} compact />
        ) : onToggle ? (
          <button type="button" className="nav-group-toggle" aria-expanded={!collapsed} onClick={onToggle}>
            <span className="sidebar-label truncate">{label}</span>
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        ) : (
          <span className="sidebar-label truncate">{label}</span>
        )}
        {actions && <span className="nav-group-actions">{actions}</span>}
      </div>
      {!collapsed && <div className="nav-group-body">{children}</div>}
    </section>
  );
}

function FolderBlock({ name, count, collapsed, onToggle, drop, renaming, onRename, onStartRename, onDelete, children }: {
  name: string;
  count: number;
  collapsed: boolean;
  onToggle(): void;
  drop: DropTarget;
  renaming: boolean;
  onRename(name: string): void;
  onStartRename(): void;
  onDelete(): void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const { over, handlers } = useDrop(drop);
  return (
    <div className="nav-folder" {...handlers}>
      <div className={`nav-folder-row ${over ? 'nav-drop' : ''}`}>
        {renaming ? (
          <InlineName
            icon={<Folder size={14} className="sidebar-icon-faint" />}
            initial={name}
            placeholder={name}
            onDone={onRename}
          />
        ) : (
          <button type="button" className="nav-folder-btn" aria-expanded={!collapsed} onClick={onToggle}>
            {collapsed ? <Folder size={14} className="nav-folder-icon" /> : <FolderOpen size={14} className="nav-folder-icon" />}
            <span className="truncate">{name}</span>
            <span className="nav-count">{count}</span>
          </button>
        )}
        {!renaming && (
          <span className="nav-row-more">
            <NavMenu label={t('side.folderActions')}>
              {(close) => (
                <>
                  <MenuItem icon={<Pencil size={14} />} onSelect={() => { close(); onStartRename(); }}>
                    {t('side.renameFolder')}
                  </MenuItem>
                  <MenuItem icon={<Trash2 size={14} />} danger hint={t('side.deleteFolderHint')} onSelect={() => { close(); onDelete(); }}>
                    {t('side.deleteFolder')}
                  </MenuItem>
                </>
              )}
            </NavMenu>
          </span>
        )}
      </div>
      {!collapsed && count > 0 && <div className="nav-folder-body">{children}</div>}
    </div>
  );
}

/** A name field for a new or renamed section, folder or chat. Enter or blur
 * keeps the text, Escape drops it. */
function InlineName({ icon, initial = '', placeholder, onDone, compact = false }: {
  icon?: ReactNode;
  initial?: string;
  placeholder: string;
  onDone(name: string): void;
  compact?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (name: string) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <div className={`nav-inline-name ${compact ? 'nav-inline-name--compact' : ''}`}>
      {icon}
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') finish(value);
          else if (event.key === 'Escape') finish('');
        }}
        onBlur={() => finish(value)}
      />
    </div>
  );
}

/** A row's live facts, as primitives so a streaming chunk elsewhere does not
 * re-render it (useShallow compares field by field). */
type RowFacts = {
  foreground: boolean;
  connected: boolean;
  running: boolean;
  needsAttention: boolean;
  canSwitch: boolean;
  canDelete: boolean;
  disabledReason: 'busy' | 'offline' | 'host' | 'agent' | null;
  label: string;
};

function rowFacts(row: ChatRow, layout: NavLayout): (s: ReturnType<typeof usePanda.getState>) => RowFacts {
  return (s) => {
    const slot = s.connections[row.connectionId];
    const doc = slot?.docs[row.sessionId];
    const label = chatLabel(row, layout, doc);
    if (!slot) {
      return { foreground: false, connected: false, running: false, needsAttention: false, canSwitch: false, canDelete: false, disabledReason: 'offline', label };
    }
    const lifecycle = connectionLifecycle(slot);
    const connected = isLinkUp(lifecycle.phase);
    const foreground = s.activeConnectionId === row.connectionId && s.activeSessionId === row.sessionId;
    const anchored = slot.connection.sessionId === row.sessionId;
    const running = doc?.status === 'running';
    const pendingPermission = doc ? Object.values(doc.permissions).some((permission) => permission.status === 'pending') : false;
    const loadSession = effectiveCapability('loadSession', slot.capabilities, PANDA_HOST_CAPABILITIES);
    const deletable = effectiveCapability('delete', slot.capabilities, PANDA_HOST_CAPABILITIES).available;
    const hasDoc = doc !== undefined;
    const canSwitch = connected ? loadSession.available && !lifecycle.busy : hasDoc;
    const disabledReason: RowFacts['disabledReason'] = canSwitch
      ? null
      : connected && lifecycle.busy
        ? 'busy'
        : !connected
          ? 'offline'
          : loadSession.reason === 'unavailable-on-host'
            ? 'host'
            : 'agent';
    return {
      foreground,
      connected,
      running,
      needsAttention: !foreground && (pendingPermission || (anchored && slot.unreadCompletion)),
      canSwitch,
      canDelete: deletable && connected && !foreground && !lifecycle.busy,
      disabledReason,
      label,
    };
  };
}

const DISABLED_LABELS = {
  busy: 'side.disabled.busy',
  offline: 'side.disabled.offline',
  host: 'side.disabled.host',
  agent: 'side.disabled.agent',
} as const;

function ChatRowItem({ row, layout, commit, live, familyNames, newChatOpen, renaming, setRenaming, onOpened }: {
  row: ChatRow;
  layout: NavLayout;
  commit(next: NavLayout): void;
  live: LiveSessionFacade;
  familyNames: readonly string[];
  newChatOpen: boolean;
  renaming: string | null;
  setRenaming(id: string | null): void;
  onOpened(): void;
}) {
  const { t } = useI18n();
  const facts = usePanda(useShallow(rowFacts(row, layout)));
  const deleteAlert = useImperativeAlertDialog();
  const current = facts.foreground && !newChatOpen;
  const placement = layout.placements[row.key] ?? null;
  const updated = formatRelativeTime(row.updatedAt, t);
  const isRenaming = renaming === `chat:${row.key}`;

  const open = () => {
    useNewChat.getState().close();
    if (!facts.foreground) live.openSession(row.connectionId, row.sessionId, row.cwd);
    onOpened();
  };

  const move = (target: NavPlacement | null) => commit(placeChat(layout, row.key, target));

  return (
    <div
      className="nav-row"
      draggable={!isRenaming}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, row.key);
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      {isRenaming ? (
        <InlineName
          icon={<FamilyBadge name={row.familyName} allNames={familyNames} />}
          initial={facts.label}
          placeholder={facts.label}
          onDone={(name) => {
            if (name.trim()) commit(setChatTitle(layout, row.key, name));
            setRenaming(null);
          }}
        />
      ) : (
        <button
          type="button"
          disabled={!current && !facts.canSwitch && !facts.foreground}
          onClick={open}
          aria-current={current ? 'page' : undefined}
          title={
            facts.canSwitch || facts.foreground
              ? `${facts.label} · ${row.familyName} · ${sessionRowMeta(row.entry)}`
              : facts.disabledReason
                ? t(DISABLED_LABELS[facts.disabledReason])
                : undefined
          }
          className={`nav-row-btn ${current ? 'nav-row-btn--current' : ''} ${
            facts.canSwitch || facts.foreground ? '' : 'nav-row-btn--disabled'
          }`}
        >
          <FamilyBadge name={row.familyName} allNames={familyNames} />
          <span className="truncate">{facts.label}</span>
          {facts.running ? (
            <StatusDot variant="accent" isPulsing label={t('conn.running')} />
          ) : facts.needsAttention ? (
            <StatusDot variant="accent" label={t('side.needsAttention')} />
          ) : null}
          {updated !== null && <span className="nav-row-time">{updated}</span>}
        </button>
      )}
      {!isRenaming && (
        <span className="nav-row-more">
          <NavMenu label={t('side.chatActions')}>
            {(close) => (
              <>
                <MenuItem
                  icon={placement?.kind === 'pinned' ? <PinOff size={14} /> : <Pin size={14} />}
                  onSelect={() => {
                    close();
                    move(placement?.kind === 'pinned' ? null : { kind: 'pinned' });
                  }}
                >
                  {placement?.kind === 'pinned' ? t('side.unpin') : t('side.pin')}
                </MenuItem>
                <MenuItem icon={<Pencil size={14} />} onSelect={() => { close(); setRenaming(`chat:${row.key}`); }}>
                  {t('side.rename')}
                </MenuItem>
                <hr className="nav-menu-sep" />
                <div className="nav-menu-head">{t('side.moveTo')}</div>
                <MenuItem indent={1} checked={placement === null} onSelect={() => { close(); move(null); }}>
                  {t('side.recents')}
                </MenuItem>
                {layout.sections.map((section) => (
                  <div key={section.id} role="none">
                    <MenuItem
                      indent={1}
                      checked={placement?.kind === 'section' && placement.sectionId === section.id && placement.folderId === null}
                      onSelect={() => { close(); move({ kind: 'section', sectionId: section.id, folderId: null }); }}
                    >
                      {section.name}
                    </MenuItem>
                    {section.folders.map((folder) => (
                      <MenuItem
                        key={folder.id}
                        indent={2}
                        icon={<Folder size={13} />}
                        checked={placement?.kind === 'section' && placement.folderId === folder.id}
                        onSelect={() => { close(); move({ kind: 'section', sectionId: section.id, folderId: folder.id }); }}
                      >
                        {folder.name}
                      </MenuItem>
                    ))}
                  </div>
                ))}
                {facts.canDelete && (
                  <>
                    <hr className="nav-menu-sep" />
                    <MenuItem
                      icon={<Trash2 size={14} />}
                      danger
                      onSelect={() => {
                        close();
                        deleteAlert.show({
                          title: t('side.deleteSession'),
                          description: t('side.deleteConfirm', { title: facts.label }),
                          actionLabel: t('side.deleteSession'),
                          actionVariant: 'destructive',
                          onAction: () => {
                            live.deleteSession(row.connectionId, row.sessionId);
                            commit(forgetChat(layout, row.key));
                            deleteAlert.hide();
                          },
                        });
                      }}
                    >
                      {t('side.deleteSession')}
                    </MenuItem>
                  </>
                )}
              </>
            )}
          </NavMenu>
        </span>
      )}
      {deleteAlert.element}
    </div>
  );
}

/**
 * A ··· button with an anchored menu. The menu renders in a portal at fixed
 * coordinates so the scrolling list never clips it; outside pointerdown and
 * Escape close it.
 */
function NavMenu({ label, children }: { label: string; children(close: () => void): ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) return;
    const anchor = buttonRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(anchor.right - menu.width, window.innerWidth - menu.width - margin));
    const below = anchor.bottom + 4;
    const top = below + menu.height > window.innerHeight - margin ? Math.max(margin, anchor.top - menu.height - 4) : below;
    setPosition({ top, left });
    menuRef.current.querySelector<HTMLButtonElement>('.nav-menu-item')?.focus();
  }, [open]);

  return (
    <>
      <span ref={buttonRef} className={`nav-menu-anchor ${open ? 'nav-menu-anchor--open' : ''}`}>
        <IconButton
          variant="ghost"
          size="sm"
          icon={<MoreHorizontal size={14} />}
          label={label}
          clickAction={() => {
            setPosition(null);
            setOpen((value) => !value);
          }}
        />
      </span>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            className="nav-menu"
            style={position ? { top: position.top, left: position.left } : { visibility: 'hidden', top: 0, left: 0 }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              event.preventDefault();
              const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('.nav-menu-item') ?? []);
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              const delta = event.key === 'ArrowDown' ? 1 : -1;
              items[(index + delta + items.length) % items.length]?.focus();
            }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}

function MenuItem({ icon, danger = false, hint, indent = 0, checked = false, onSelect, children }: {
  icon?: ReactNode;
  danger?: boolean;
  hint?: string;
  indent?: 0 | 1 | 2;
  checked?: boolean;
  onSelect(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role={checked ? 'menuitemradio' : 'menuitem'}
      aria-checked={checked || undefined}
      tabIndex={-1}
      className={`nav-menu-item nav-menu-item--indent-${indent} ${danger ? 'nav-menu-item--danger' : ''} ${
        checked ? 'nav-menu-item--checked' : ''
      }`}
      onClick={onSelect}
    >
      {icon}
      <span className="nav-menu-text">
        <span className="truncate">{children}</span>
        {hint && <span className="nav-menu-hint">{hint}</span>}
      </span>
    </button>
  );
}

/** Lifecycle phase → status dot, as the old section head drew it. */
function PhaseDot({ phase, running }: { phase: ConnectionPhase; running: boolean }) {
  const { t } = useI18n();
  if (phase === 'connecting') return <Spinner size="sm" />;
  if (phase === 'error') return <StatusDot variant="error" label={t('conn.error')} />;
  if (phase === 'auth-required') return <StatusDot variant="warning" label={t('conn.authRequired')} />;
  if (isLinkUp(phase)) {
    return running
      ? <StatusDot variant="accent" isPulsing label={t('conn.running')} />
      : <StatusDot variant="success" label={t('conn.connected')} />;
  }
  return <StatusDot variant="neutral" label={t('conn.disconnected')} />;
}

/** One family in the footer: its status dot and name. A family that is not
 * connected acts on click — reconnect after an error, connect when offline,
 * show the sign-in for auth-required. */
function FamilyStatus({ profile, live, onActivated }: {
  profile: AgentProfile;
  live: LiveSessionFacade;
  onActivated(): void;
}) {
  const { t } = useI18n();
  const facts = usePanda(
    useShallow((s) => {
      const slot = s.connections[profile.id];
      if (!slot) return { phase: 'disconnected' as ConnectionPhase, running: false, error: null as string | null };
      const lifecycle = connectionLifecycle(slot);
      return { phase: lifecycle.phase, running: lifecycle.running, error: lifecycle.error };
    }),
  );
  const up = isLinkUp(facts.phase);
  const act = () => {
    if (up || facts.phase === 'connecting') return;
    useNewChat.getState().close();
    if (facts.phase === 'error') live.reconnectForeground({ connectionId: profile.id });
    else if (facts.phase === 'auth-required') live.foreground(profile.id);
    else live.connectProfile(profile);
    onActivated();
  };
  const status = up
    ? t('conn.connected')
    : facts.phase === 'error'
      ? `${t('conn.error')}: ${facts.error ?? ''} · ${t('side.familyReconnect')}`
      : facts.phase === 'auth-required'
        ? t('conn.authRequired')
        : facts.phase === 'connecting'
          ? t('status.connecting')
          : `${t('conn.disconnected')} · ${t('side.familyConnect')}`;
  return (
    <button
      type="button"
      className={`nav-family ${up ? 'nav-family--up' : ''}`}
      title={`${profile.name}: ${status}`}
      aria-label={`${profile.name}: ${status}`}
      onClick={act}
    >
      <PhaseDot phase={facts.phase} running={facts.running} />
      <span className="truncate">{profile.name}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Session-row labeling (#221): a session without a title used to show
// `cwd · short-id`, which helped nobody find anything. The label prefers the
// conversation's own opening words; the id demotes to hover meta.
// ---------------------------------------------------------------------------

/** The first user message's text, whitespace-collapsed — the conversation's
 * own name for itself. Image-only openers yield null (nothing to show);
 * later turns are never consulted — the FIRST message is the identity. */
export function firstUserMessageText(doc: SessionDocument): string | null {
  for (const turn of doc.turns) {
    for (const block of turn.blocks) {
      if (block.kind !== 'user_message') continue;
      const text = block.content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) return text;
    }
  }
  return null;
}

/** The row's visible label: agent title → first user message (truncated) →
 * workspace label. Only sessions loaded locally have a document, so the
 * fallback improves as history gets read — untitled unread rows keep the
 * workspace label until then. */
export function sessionRowLabel(entry: SessionEntry, doc: SessionDocument | undefined, maxChars = 48): string {
  if (entry.title) return entry.title;
  const opening = doc ? firstUserMessageText(doc) : null;
  if (opening) return opening.length > maxChars ? `${opening.slice(0, maxChars)}…` : opening;
  return workspaceLabel(entry.cwd);
}

/** The row's hover meta when no agent title exists: workspace plus the
 * session's short id — the id stays reachable (#221's「次要 meta」) without
 * squatting the visible label. */
export function sessionRowMeta(entry: SessionEntry): string {
  return `${workspaceLabel(entry.cwd)} · ${entry.sessionId.slice(-6)}`;
}
