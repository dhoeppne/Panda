import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeft, Menu } from 'lucide-react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Sidebar } from './components/Sidebar';
import { INTERACTIVE_CONTROL_SELECTOR } from './components/scrollPolicy';
import { MessageStream } from './components/MessageStream';
import { EmptyState } from './components/EmptyState';
import { AuthGate } from './components/AuthGate';
import { agentLabel, StatusBar } from './components/StatusBar';
import { Composer } from './components/Composer';
import { lastTurnStopped, useMessageQueueDrain } from './messageQueue';
import { PlanDock } from './components/PlanDock';
import {
  useActiveConnection,
  useActiveDoc,
  useActiveEffectiveCapabilities,
  useActiveSessions,
  usePanda,
} from './store';
import { useForegroundLifecycle, useMainView, useSessionModes } from './projector/hooks';
import { navigate, useHashRoute } from './routes';
import {
  beginDrawerDrag,
  beginsDrawerSwipe,
  drawerDragOnMove,
  drawerDragOnRelease,
  EDGE_ZONE_PX,
  HORIZONTAL_PAN_SELECTOR,
  TEXT_ENTRY_SELECTOR,
  type DrawerDrag,
  type SwipeStart,
} from './navSwipe';
import { composerDraftKey, useComposerDrafts } from './composerDrafts';
import { profileIdOfConnection, sameChat, type ChatId } from './chatId';
import { resolveNewChatFamily, useNewChat, useProfiles } from './newChat';
import { FamilyLabel, FamilyPicker } from './components/FamilyPicker';
import { familyCommandSource, sessionCommandSource, type CommandSource } from './commands';
import { notifyUser } from './userNotice';
import type { AcpUserContentBlock } from './protocol/types';
import { SettingsPage, SETTINGS_SECTIONS, type SettingsSectionId } from './components/SettingsPage';
import { useLiveSession } from './useLiveSession';
import { UserNoticeToasts } from './components/UserNoticeToasts';
import type { ForegroundSessionController } from './session-controller';
import './App.css';
import { useI18n } from './i18n/context';

/** The drawer's breakpoint, as Sidebar.css declares it: at 768px and up the
 * sidebar is a static column and there is nothing to swipe. */
const DRAWER_QUERY = '(min-width: 768px)';

/** Route-level shell: `#/` is the session screen, `#/settings` the settings
 * screen. MainScreen owns the shell (sidebar + header); the settings route
 * swaps only the main column's content (#111) so the app chrome — sidebar,
 * header, mobile drawer — never unmounts across routes. */
export default function App() {
  return <MainScreen />;
}

function MainScreen() {
  const route = useHashRoute();
  const onSettings = route.kind === 'settings';
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  // The drawer's edge-swipe gesture (navSwipe.ts). The drag lives in a ref:
  // pointermove writes the drawer's geometry to CSS custom properties on the
  // shell instead of re-rendering — the message stream is virtualized, and a
  // state update per frame would fight Virtuoso. `drawerDragging` flips twice
  // per gesture, only to mount the scrim and drop the transition.
  const scrimRef = useRef<HTMLButtonElement | null>(null);
  const navToggleRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<DrawerDrag | null>(null);
  const [drawerDragging, setDrawerDragging] = useState(false);

  const startDrawerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.matchMedia(DRAWER_QUERY).matches) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // One gesture at a time: a second finger during a drag must not take it
    // over, and a drag already in flight owns the geometry.
    if (dragRef.current !== null) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    // The drawer itself, for the two facts a drag needs: is the gesture
    // starting inside it, and how wide is it. Read from the DOM rather than
    // assumed — the CSS owns the width (Sidebar.css `.sidebar`), and a drag
    // that disagrees with it would not track the finger.
    const drawer = event.currentTarget.querySelector<HTMLElement>('.sidebar');
    const width = drawer?.getBoundingClientRect().width ?? 0;
    if (width <= 0) return;
    const start: SwipeStart = {
      surface: drawer?.contains(target)
        ? 'drawer'
        : scrimRef.current?.contains(target)
          ? 'scrim'
          : 'page',
      fromEdge: event.clientX <= EDGE_ZONE_PX,
      // The hamburger is the drawer's own control: a drag on it pans the
      // drawer, so the edge keeps working across its 12–44px band.
      onControl:
        !navToggleRef.current?.contains(target) &&
        target.closest(INTERACTIVE_CONTROL_SELECTOR) !== null,
      inTextEntry: target.closest(TEXT_ENTRY_SELECTOR) !== null,
      inHorizontalPan: target.closest(HORIZONTAL_PAN_SELECTOR) !== null,
      open: mobileNavigationOpen,
    };
    if (!beginsDrawerSwipe(start)) return;
    dragRef.current = beginDrawerDrag({
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: event.timeStamp,
      open: mobileNavigationOpen,
      width,
    });
  };

  const moveDrawerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const move = drawerDragOnMove(drag, event.clientX, event.clientY, event.timeStamp);
    if (move.kind === 'hold') return;
    if (move.kind === 'handoff') {
      // The list underneath keeps this drag: drop ours and let it scroll.
      dragRef.current = null;
      return;
    }
    dragRef.current = move.drag;
    if (move.axisJustLocked) {
      // Capture from here on: the drawer pans even when the finger leaves it,
      // and a captured pointerup retargets the click to the shell, so the row
      // or scrim the drag began on never also reads it as a tap.
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrawerDragging(true);
    }
    event.currentTarget.style.setProperty('--panda-drawer-x', `${move.drag.offset}px`);
    event.currentTarget.style.setProperty('--panda-drawer-progress', `${move.drag.offset / move.drag.width}`);
  };

  const endDrawerDrag = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const release = drawerDragOnRelease(drag, event.timeStamp, cancelled);
    if (release.kind === 'hold') return;
    // The transition returns with the class, so the drawer settles from
    // wherever the finger left it.
    event.currentTarget.style.removeProperty('--panda-drawer-x');
    event.currentTarget.style.removeProperty('--panda-drawer-progress');
    setDrawerDragging(false);
    setMobileNavigationOpen(release.open);
  };

  // Which settings section is showing (#117) — MainScreen-level so it
  // survives settings ⇄ main route flips (returning lands where you left).
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('general');
  const doc = useActiveDoc();
  const connection = useActiveConnection();
  const activeConnectionId = usePanda((s) => s.activeConnectionId);
  const activeSessionId = usePanda((s) => s.activeSessionId);
  const sessions = useActiveSessions();
  // The foreground connection's effective capabilities (issue #22) — the
  // single decision point, never the raw agent declaration.
  const effectiveCaps = useActiveEffectiveCapabilities();

  const live = useLiveSession();
  // The foreground session controller (#51): members are handed down from
  // here individually.
  const controller: ForegroundSessionController = live;
  // Status meaning comes from the lifecycle projection (#53) — busy,
  // composer gating, hint and the auth-gate branch are consumed, not derived.
  const lifecycle = useForegroundLifecycle();
  // Which surface owns the content column (#200/#218) — projected, not
  // derived here: onboarding is pointer-decided so a retained document stays
  // readable after a clean disconnect.
  const view = useMainView();
  // The mode picker's view + write channel (protocol policy, not App's to derive).
  const sessionModes = useSessionModes(controller);
  const { t } = useI18n();
  // Foreground session identity (bug hunts #15/#17): swaps with the
  // foreground — different connection, or a different session on it. The
  // composer keys its draft store by it (a message composed for one agent is
  // never sent to another), and the message stream is REMOUNTED on it (key):
  // flat-item keys (`turn-1-0`…) are identical across sessions, so without
  // the remount one session's expanded cards and scroll-follow mode would
  // leak into the next. Keyed by the UI POINTER, not the connection's settled
  // anchor (#218): offline retained-document viewing diverges the two (the
  // anchor is null while the pointer moves between retained documents), and
  // an anchor-keyed key would collapse every offline view onto one bucket.
  const foregroundSessionKey = composerDraftKey(activeConnectionId ?? 'none', activeSessionId);

  const profiles = useProfiles();

  // The chat the route names, and the chat the foreground holds (ADR 0010).
  // The two are the same id: the route's session id is the agent's own.
  const routeChat: ChatId | null =
    route.kind === 'chat' ? { namespace: route.namespace, sessionId: route.sessionId } : null;
  const foregroundChat: ChatId | null = useMemo(() => {
    if (activeConnectionId === null || activeSessionId === null) return null;
    const owner = profileIdOfConnection(activeConnectionId) ?? activeConnectionId;
    const profile = profiles.find((entry) => entry.id === owner);
    return { namespace: profile ? profile.slug : activeConnectionId, sessionId: activeSessionId };
  }, [activeConnectionId, activeSessionId, profiles]);
  // The route names a chat the foreground does not hold: the route asks for a
  // chat, and the app is opening it.
  const routeUnresolved = routeChat !== null && !sameChat(routeChat, foregroundChat);

  // The new-chat view (navigation redesign): the route names it (#/new). The
  // chat is created on the first send, on the family the picker names.
  const newChatOpen = route.kind === 'new';
  const newChatFamily = resolveNewChatFamily(useNewChat((s) => s.familyId), profiles);
  // A route that names a chat owns the screen while the app opens it (ADR
  // 0010): the new-chat view must not flash over the chat that is coming.
  const showNewChat =
    !onSettings && newChatFamily !== null && (newChatOpen || (view === 'onboarding' && !routeUnresolved));
  const [starting, setStarting] = useState(false);
  const newChatDraftKey = composerDraftKey('new-chat', null);
  // An extra connection of a family carries the family's id behind a '#', so
  // the foreground family is the owner of the foreground connection.
  const foregroundOwner =
    activeConnectionId === null ? null : profileIdOfConnection(activeConnectionId) ?? activeConnectionId;
  const foregroundFamily = profiles.find((profile) => profile.id === foregroundOwner) ?? null;

  // The route opens the chat it names (ADR 0010). It is the one truth: a
  // link from another device, a pasted link, a click in the sidebar — each
  // one names a chat, and the app opens it. The family connects, then the
  // session is loaded on it.
  useEffect(() => {
    if (route.kind !== 'chat') return;
    const id = { namespace: route.namespace, sessionId: route.sessionId };
    if (sameChat(id, foregroundChat)) return; // it is open already
    let stale = false;
    void live.openChatRoute(id).then((ok) => {
      if (ok || stale) return;
      // The chat cannot be opened: the route named a conversation this
      // family does not have, or one it could not reach. The chat that is
      // open (if any) takes the route back.
      navigate(
        foregroundChat
          ? { kind: 'chat', namespace: foregroundChat.namespace, sessionId: foregroundChat.sessionId }
          : { kind: 'new' },
      );
    });
    return () => {
      stale = true;
    };
  }, [route, foregroundChat, live]);
  // The `/` menu (commands.ts): a new chat has no session yet, so it shows
  // the list the picked family sent at `initialize`.
  const newChatSlot = usePanda((s) => (newChatFamily ? s.connections[newChatFamily.id] : undefined));
  const newChatCommands: CommandSource = newChatFamily
    ? familyCommandSource(
        newChatFamily.name,
        newChatSlot?.connection.status ?? 'disconnected',
        newChatSlot?.familyCommands ?? null,
      )
    : { kind: 'none' };
  const foregroundFamilyCommands = usePanda((s) =>
    activeConnectionId ? (s.connections[activeConnectionId]?.familyCommands ?? null) : null,
  );

  const startChat = (content: AcpUserContentBlock[]) => {
    if (!newChatFamily || starting) return;
    setStarting(true);
    void (async () => {
      const ok = await live.startChat(newChatFamily);
      setStarting(false);
      if (!ok) {
        // The composer cleared its draft on submit; give the text back so a
        // failed start loses nothing the user typed.
        const text = content
          .filter((block): block is Extract<AcpUserContentBlock, { type: 'text' }> => block.type === 'text')
          .map((block) => block.text)
          .join('\n');
        useComposerDrafts.getState().setDraft(newChatDraftKey, { value: text });
        notifyUser('error', t('newChat.startFailed', { name: newChatFamily.name }));
        return;
      }
      // The route names the new chat (ADR 0010): the chat the family just
      // made, with the session id the agent minted.
      const state = usePanda.getState();
      const owner = state.activeConnectionId
        ? (profileIdOfConnection(state.activeConnectionId) ?? state.activeConnectionId)
        : null;
      const family = profiles.find((entry) => entry.id === owner);
      if (state.activeSessionId && family) {
        navigate({ kind: 'chat', namespace: family.slug, sessionId: state.activeSessionId });
      }
      await controller.send(content);
    })();
  };

  // Queued messages (messageQueue.ts) go out one per finished turn of the
  // foreground session; a turn that stopped early pauses the queue.
  useMessageQueueDrain({
    sessionKey: foregroundSessionKey,
    busy: lifecycle.docStatus !== 'idle',
    canSendNow: !lifecycle.composerDisabled,
    stopped: lastTurnStopped(doc),
    send: controller.send,
  });

  const activeSession = sessions.find((entry) => entry.sessionId === activeSessionId);
  // On the settings route the header carries the ACTIVE SECTION's title and
  // description (#140): the page-level header inside the column is gone, so
  // the top bar is where "which settings page am I on" answers itself. The
  // back arrow stays — it is one of the settings route's three exits.
  const settingsSectionMeta = SETTINGS_SECTIONS.find((entry) => entry.id === settingsSection);
  const headerTitle = onSettings
    ? t(settingsSectionMeta?.titleKey ?? 'settings.title')
    : showNewChat
      ? t('side.newChat')
      : (activeSession?.title ?? agentLabel(foregroundFamily?.name ?? null, connection.agentName) ?? t('app.liveSessionTitle'));
  const headerMeta = onSettings
    ? (settingsSectionMeta ? t(settingsSectionMeta.descKey) : null)
    : showNewChat
      ? null
      : (connection.url ?? 'acp');

  return (
    <div
      className={`app-shell${drawerDragging ? ' app-shell--drawer-dragging' : ''}`}
      onPointerDown={startDrawerDrag}
      onPointerMove={moveDrawerDrag}
      onPointerUp={(event) => endDrawerDrag(event, false)}
      onPointerCancel={(event) => endDrawerDrag(event, true)}
    >
      <UserNoticeToasts />
      {(mobileNavigationOpen || drawerDragging) && (
        <button
          ref={scrimRef}
          type="button"
          className="app-nav-overlay"
          aria-label={t('app.closeNav')}
          onClick={() => setMobileNavigationOpen(false)}
        />
      )}
      <Sidebar
        live={live}
        mobileOpen={mobileNavigationOpen}
        onMobileClose={() => setMobileNavigationOpen(false)}
        settingsSection={settingsSection}
        onSelectSettingsSection={setSettingsSection}
      />
      <main className="app-main">
        <header className="app-header">
          <div className="app-header-lead">
            <button
              ref={navToggleRef}
              type="button"
              className="app-nav-toggle"
              aria-label={t('app.openNav')}
              onClick={() => setMobileNavigationOpen(true)}
            >
              <Menu size={18} />
            </button>
            {onSettings && (
              <IconButton
                variant="ghost"
                icon={<ArrowLeft size={16} />}
                label={t('app.back')}
                tooltip={t('app.backTooltip')}
                clickAction={() =>
                  navigate(
                    foregroundChat
                      ? { kind: 'chat', namespace: foregroundChat.namespace, sessionId: foregroundChat.sessionId }
                      : { kind: 'new' },
                  )
                }
              />
            )}
            <span className="truncate app-header-title">{headerTitle}</span>
          </div>
          {headerMeta !== null && (
            <span className={`app-header-meta ${onSettings ? 'app-header-meta--desc' : ''}`}>
              {headerMeta}
            </span>
          )}
        </header>
        {onSettings ? (
          <SettingsPage section={settingsSection} />
        ) : showNewChat ? (
          <div className="new-chat">
            <div className="new-chat-intro">
              <h1 className="new-chat-title">{t('newChat.title')}</h1>
              <p className="new-chat-hint">{t('newChat.hint', { name: newChatFamily.name })}</p>
            </div>
            <Composer
              onSend={startChat}
              disabled={starting}
              inputLocked={starting}
              canQueue={false}
              hint={starting ? t('newChat.starting', { name: newChatFamily.name }) : t('newChat.placeholder', { name: newChatFamily.name })}
              attachAccept={undefined}
              canStop={false}
              modes={null}
              onSetMode={() => {}}
              commandSource={newChatCommands}
              configOptions={null}
              onSetConfigOption={() => {}}
              sessionKey={newChatDraftKey}
              family={
                <FamilyPicker
                  families={profiles}
                  currentId={newChatFamily.id}
                  onPick={(familyId) => useNewChat.getState().pick(familyId)}
                />
              }
            />
          </div>
        ) : (
          <>
            {doc.plan && doc.plan.length > 0 && <PlanDock entries={doc.plan} />}
            {/* The auth gate owns the main view for a login challenge AND for
                the login flow's elicitation while the link stays up (bug
                hunt #8): mid-connection re-login keeps the old session, and
                its request-scoped OAuth card must be answerable. Without a
                challenge the standing offer (#90) feeds the method list. */}
            {view === 'auth-gate' ? (
              <AuthGate
                methods={connection.authMethods ?? connection.availableAuthMethods}
                message={connection.error}
                elicitation={connection.authElicitation}
                onAuthenticate={live.authenticate}
                onResolveElicitation={controller.resolveElicitation}
                onOpenElicitationUrl={controller.openElicitationUrl}
              />
            ) : view === 'onboarding' && !routeUnresolved ? (
              // First-run onboarding (#200): no foreground session document
              // to show → the two ways in (connect your own agent / existing
              // agents). A connection still opening its first
              // session (connecting, session/new in flight) passes through
              // here briefly — the status bar narrates that phase. A clean
              // disconnect does NOT land here (#218): its retained document
              // stays readable, so the pointer is still set.
              <EmptyState />
            ) : (
              <MessageStream
                key={foregroundSessionKey}
                onResolvePermission={controller.resolvePermission}
                onResolveElicitation={controller.resolveElicitation}
                onOpenElicitationUrl={controller.openElicitationUrl}
                // A rewind needs a live link and an idle turn: a cut under a
                // running turn would drop the blocks it still streams into.
                onRewind={
                  connection.status === 'connected' &&
                  effectiveCaps.rewind.available &&
                  lifecycle.docStatus === 'idle'
                    ? live.rewind
                    : undefined
                }
              />
            )}
            <StatusBar
              doc={doc}
              connection={connection}
              familyName={foregroundFamily?.name ?? null}
              onAuthenticate={live.authenticate}
            />
            <Composer
              onSend={controller.send}
              disabled={lifecycle.composerDisabled}
              inputLocked={lifecycle.composerInputLocked}
              canQueue={lifecycle.canQueue}
              hint={lifecycle.hint}
              // Undefined until the live link is up and capabilities are
              // negotiated (#214): no agent, no capability claims either way.
              attachAccept={
                connection.status === 'connected'
                  ? { image: effectiveCaps.image.available, files: effectiveCaps.embeddedContext.available }
                  : undefined
              }
              canStop={lifecycle.canStop}
              onStop={live.cancel}
              modes={sessionModes.modes}
              onSetMode={sessionModes.onSetMode}
              commandSource={sessionCommandSource(
                foregroundFamily?.name ?? connection.agentName ?? '',
                doc.availableCommands,
                foregroundFamilyCommands,
              )}
              configOptions={doc.configOptions}
              onSetConfigOption={controller.setConfigOption}
              sessionKey={foregroundSessionKey}
              family={foregroundFamily && <FamilyLabel family={foregroundFamily} families={profiles} />}
            />
          </>
        )}
      </main>
    </div>
  );
}
