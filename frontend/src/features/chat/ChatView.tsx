import {useEffect, useRef, useState, type DragEvent} from 'react';
import {Columns2, MoreHorizontal, Plus, Rows2, X} from 'lucide-react';
import {useStore} from '../../lib/store';
import {api} from '../../lib/bindings';
import {appStore, writePref} from '../../state/app';
import {chatSession, forgetChatSession, isBusy} from '../../state/chat';
import {
  MAIN_CHAT, chatsStore, dropChat, focusGroup, focusedChat, groupsOf, mergeGroup, moveChat, resizeSplit, showChat, splitWith,
  type Group, type LayoutNode,
} from '../../state/chats';
import {ResizeHandle, clampSize} from '../../ChatLayout';
import {Markdown} from '../../ui/Markdown';
import {MenuButton} from '../../ui/Menu';
import {confirmDialog, promptDialog} from '../../ui/dialogs';
import {toastError} from '../../ui/toast';
import {Transcript} from './Transcript';
import {Composer} from './Composer';
import {Inspector} from './Inspector';
import {ChatProvider, useChat, useChatState} from './ChatContext';
import {ErrorBoundary} from '../../ui/ErrorBoundary';
import type {ChatInfo} from '../../lib/types';

function readWidth() {
  try {
    const value = Number(localStorage.getItem('nullbot.inspectorWidth'));
    return Number.isFinite(value) && value > 0 ? value : 360;
  } catch {
    return 360;
  }
}

/**
 * The conversation area: chats in groups of tabs, split side by side or one
 * above another, and the activity panel for the focused chat.
 */
export function ChatView({active}: {active: boolean}) {
  const inspectorOpen = useStore(appStore, state => state.inspectorOpen);
  const layout = useStore(chatsStore, state => state.layout);
  const focused = useStore(chatsStore, state => focusedChat(state));
  const container = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(readWidth);
  const [bounds, setBounds] = useState({min: 280, max: 640});
  useEffect(() => {
    const el = container.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setBounds({min: 280, max: Math.max(280, Math.min(720, el.clientWidth - 420))}));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const inspectorWidth = clampSize(width, bounds.min, bounds.max);
  return (
    <section ref={container} className={`chat ${inspectorOpen ? 'with-inspector' : ''}`} style={{'--inspector-w': `${inspectorWidth}px`} as React.CSSProperties} aria-label="Chats">
      <div className="chat-main workbench" id="chat-main">
        <LayoutView node={layout} active={active} />
      </div>
      {inspectorOpen && (
        <>
          <ResizeHandle axis="activity" value={inspectorWidth} min={bounds.min} max={bounds.max} onChange={value => {
            setWidth(value);
            writePref('nullbot.inspectorWidth', value);
          }} />
          <ErrorBoundary area="The activity panel">
            <ChatProvider chat={focused}><Inspector /></ChatProvider>
          </ErrorBoundary>
        </>
      )}
    </section>
  );
}

function LayoutView({node, active}: {node: LayoutNode; active: boolean}) {
  if (node.kind === 'group') return <GroupView group={node.group} active={active} />;
  return (
    <div className={`chat-split chat-split-${node.dir}`}>
      {node.children.map((child, i) => (
        <SplitCell key={child.kind === 'group' ? child.group.id : child.id} size={node.sizes[i] ?? 1 / node.children.length}>
          {i > 0 && <SplitHandle splitID={node.id} index={i} dir={node.dir} sizes={node.sizes} />}
          <LayoutView node={child} active={active} />
        </SplitCell>
      ))}
    </div>
  );
}

function SplitCell({size, children}: {size: number; children: React.ReactNode}) {
  return <div className="chat-split-cell" style={{flexGrow: size, flexBasis: 0}}>{children}</div>;
}

/** Drags the border between two cells of a split. */
function SplitHandle({splitID, index, dir, sizes}: {splitID: string; index: number; dir: 'row' | 'column'; sizes: number[]}) {
  const drag = useRef<{id: number; start: number; total: number; sizes: number[]} | null>(null);
  const horizontal = dir === 'row';
  const nudge = (delta: number, base = sizes) => {
    const next = [...base];
    const pair = next[index - 1] + next[index];
    const left = Math.min(pair - 0.1, Math.max(0.1, next[index - 1] + delta));
    next[index - 1] = left;
    next[index] = pair - left;
    resizeSplit(splitID, next);
  };
  return (
    <div
      className={`chat-split-handle chat-split-handle-${dir}`}
      role="separator"
      tabIndex={0}
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-label={horizontal ? 'Resize the chats side by side' : 'Resize the chats above and below'}
      onPointerDown={event => {
        if (event.button !== 0) return;
        const parent = event.currentTarget.closest('.chat-split') as HTMLElement | null;
        if (!parent) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {id: event.pointerId, start: horizontal ? event.clientX : event.clientY, total: horizontal ? parent.clientWidth : parent.clientHeight, sizes: [...sizes]};
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (current?.id !== event.pointerId || !current.total) return;
        nudge(((horizontal ? event.clientX : event.clientY) - current.start) / current.total, current.sizes);
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onKeyDown={event => {
        const back = horizontal ? 'ArrowLeft' : 'ArrowUp';
        const forward = horizontal ? 'ArrowRight' : 'ArrowDown';
        if (event.key !== back && event.key !== forward) return;
        event.preventDefault();
        nudge((event.key === forward ? 1 : -1) * (event.shiftKey ? 0.1 : 0.03));
      }}
    ><span aria-hidden="true" /></div>
  );
}

// ------------------------------------------------------------------- groups

const DRAG_TYPE = 'application/x-nullbot-chat';

function GroupView({group, active}: {group: Group; active: boolean}) {
  const focusedGroup = useStore(chatsStore, state => state.focusedGroup);
  const multiple = useStore(chatsStore, state => groupsOf(state.layout).length > 1);
  const focused = focusedGroup === group.id;
  const [edge, setEdge] = useState<'' | 'right' | 'bottom'>('');
  function dropEdge(event: DragEvent<HTMLDivElement>): '' | 'right' | 'bottom' {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x > 0.7 && x >= y) return 'right';
    if (y > 0.7) return 'bottom';
    return '';
  }
  return (
    <div className={`chat-group ${focused && multiple ? 'is-focused' : ''}`} onPointerDownCapture={() => focusGroup(group.id)} onFocusCapture={() => focusGroup(group.id)}>
      <ChatTabs group={group} multiple={multiple} />
      <div
        className="chat-group-body"
        onDragOver={event => {
          if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
          event.preventDefault();
          setEdge(dropEdge(event));
        }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setEdge(''); }}
        onDrop={event => {
          const chat = event.dataTransfer.getData(DRAG_TYPE);
          const where = dropEdge(event);
          setEdge('');
          if (!chat) return;
          event.preventDefault();
          if (where === 'right') splitWith(group.id, 'row', chat);
          else if (where === 'bottom') splitWith(group.id, 'column', chat);
          else moveChat(chat, group.id);
        }}
      >
        {group.tabs.map(id => (
          <div key={id} className="chat-pane" hidden={id !== group.active}>
            <ChatProvider chat={id}>
              <ErrorBoundary area="The conversation"><ChatPane active={active && focused && id === group.active} /></ErrorBoundary>
            </ChatProvider>
          </div>
        ))}
        {edge && <div className={`chat-drop chat-drop-${edge}`} aria-hidden="true" />}
      </div>
    </div>
  );
}

function ChatPane({active}: {active: boolean}) {
  const chat = useChat();
  const loaded = useChatState(state => state.loaded);
  const output = useChatState(state => state.commandOutput);
  useEffect(() => {
    if (!loaded && chat.id !== MAIN_CHAT) void chat.load();
  }, [loaded, chat]);
  return (
    <>
      <ErrorBoundary area="The transcript"><Transcript /></ErrorBoundary>
      <div className="chat-footer">
        {output && (
          <div className="command-output">
            <header>
              <span className="mono">{output.command}</span>
              <button className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={() => chat.store.set({commandOutput: null})}><X size={14} /></button>
            </header>
            <Markdown className="prose prose-sm">{output.message}</Markdown>
          </div>
        )}
        <Composer active={active} />
      </div>
    </>
  );
}

// --------------------------------------------------------------------- tabs

const statusLabel: Record<string, string> = {running: 'Working', stopping: 'Stopping', paused: 'Paused', held: 'Held'};

function chatTitle(id: string, info?: ChatInfo) {
  if (id === MAIN_CHAT) return info?.title || 'Main';
  return info?.title || 'Chat';
}

/** Opens a new chat and shows it, here or split beside this group. */
export async function newChat(groupID?: string, split?: 'row' | 'column') {
  try {
    const info = await api.openChat('');
    chatsStore.set(state => ({list: state.list.some(c => c.id === info.id) ? state.list : [...state.list, info]}));
    if (split && groupID) splitWith(groupID, split, info.id);
    else showChat(info.id, groupID);
    return info;
  } catch (error) {
    toastError(error);
    return null;
  }
}

/** Closes a chat, asking first when it is working. */
export async function closeChat(id: string) {
  if (id === MAIN_CHAT) return;
  const info = chatsStore.get().list.find(c => c.id === id);
  const busy = isBusy(chatSession(id).store.get()) || (info && info.status !== 'idle');
  if (busy && !(await confirmDialog({
    title: `Close ${chatTitle(id, info)}?`,
    body: <p>It is still working. Closing stops its request and anything queued. The conversation so far stays in History.</p>,
    confirmLabel: 'Stop and close',
    danger: true,
  }))) return;
  try {
    await api.closeChat(id);
    dropChat(id);
    forgetChatSession(id);
  } catch (error) {
    toastError(error);
  }
}

export async function renameChat(id: string) {
  const info = chatsStore.get().list.find(c => c.id === id);
  const title = await promptDialog({title: 'Rename chat', label: 'Title', initial: chatTitle(id, info), confirmLabel: 'Rename'});
  if (!title) return;
  try {
    await api.renameChat(id, title);
  } catch (error) {
    toastError(error);
  }
}

function ChatTabs({group, multiple}: {group: Group; multiple: boolean}) {
  const list = useStore(chatsStore, state => state.list);
  const [over, setOver] = useState(-1);
  const byID = new Map(list.map(c => [c.id, c]));
  return (
    <div className="chat-tabs">
      <div
        className="tabs chat-tablist"
        role="tablist"
        aria-label="Chats"
        onDragOver={event => {
          if (event.dataTransfer.types.includes(DRAG_TYPE)) {
            event.preventDefault();
            if (event.target === event.currentTarget) setOver(group.tabs.length);
          }
        }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(-1); }}
        onDrop={event => {
          const chat = event.dataTransfer.getData(DRAG_TYPE);
          const index = over < 0 ? group.tabs.length : over;
          setOver(-1);
          if (!chat) return;
          event.preventDefault();
          event.stopPropagation();
          moveChat(chat, group.id, index);
        }}
      >
        {group.tabs.map((id, i) => {
          const info = byID.get(id);
          const status = info?.status || 'idle';
          const selected = id === group.active;
          return (
            <div
              key={id}
              className={`chat-tab ${selected ? 'active' : ''} ${over === i ? 'drop-before' : ''}`}
              draggable
              onDragStart={event => {
                event.dataTransfer.setData(DRAG_TYPE, id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={event => {
                if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                setOver(event.clientX < rect.left + rect.width / 2 ? i : i + 1);
              }}
            >
              <button
                role="tab"
                aria-selected={selected}
                className="chat-tab-main"
                title={info?.request ? `${chatTitle(id, info)}: ${info.request}` : chatTitle(id, info)}
                onClick={() => showChat(id, group.id)}
                onDoubleClick={() => id !== MAIN_CHAT && void renameChat(id)}
                onAuxClick={event => { if (event.button === 1 && id !== MAIN_CHAT) void closeChat(id); }}
              >
                {status !== 'idle' ? <span className={`dot ${status === 'running' || status === 'stopping' ? 'live' : 'idle'}`} aria-hidden="true" /> : null}
                <span className="chat-tab-title">{chatTitle(id, info)}</span>
                {status !== 'idle' && <span className="sr-only">, {statusLabel[status] || status}</span>}
                {(info?.queue || 0) > 0 && <span className="tab-count num" title={`${info!.queue} queued`}>+{info!.queue}</span>}
              </button>
              {id !== MAIN_CHAT && (
                <button className="chat-tab-close" aria-label={`Close ${chatTitle(id, info)}`} title="Close chat" onClick={() => void closeChat(id)}><X size={12} /></button>
              )}
            </div>
          );
        })}
        {over === group.tabs.length && <span className="chat-tab-drop" aria-hidden="true" />}
      </div>
      <div className="chat-tabs-actions">
        <button className="btn btn-ghost btn-icon btn-sm" title="New chat (Ctrl+T)" aria-label="New chat" onClick={() => void newChat(group.id)}><Plus size={14} /></button>
        <MenuButton
          className="btn btn-ghost btn-icon btn-sm"
          label={<MoreHorizontal size={14} />}
          title="Chat and layout"
          align="end"
          items={[
            {label: 'New chat to the right', hint: 'Ctrl+\\', onSelect: () => void newChat(group.id, 'row')},
            {label: 'New chat below', onSelect: () => void newChat(group.id, 'column')},
            ...(group.tabs.length > 1
              ? [
                  {kind: 'separator' as const},
                  {label: 'Move this chat to the right', onSelect: () => splitWith(group.id, 'row', group.active)},
                  {label: 'Move this chat below', onSelect: () => splitWith(group.id, 'column', group.active)},
                ]
              : []),
            {kind: 'separator' as const},
            {label: 'Rename this chat', disabled: group.active === MAIN_CHAT, onSelect: () => void renameChat(group.active)},
            {label: 'Close this chat', disabled: group.active === MAIN_CHAT, onSelect: () => void closeChat(group.active)},
            ...(multiple ? [{label: 'Close this group', onSelect: () => mergeGroup(group.id)}] : []),
          ]}
        />
        {!multiple && (
          <>
            <button className="btn btn-ghost btn-icon btn-sm" title="New chat to the right" aria-label="New chat to the right" onClick={() => void newChat(group.id, 'row')}><Columns2 size={14} /></button>
            <button className="btn btn-ghost btn-icon btn-sm" title="New chat below" aria-label="New chat below" onClick={() => void newChat(group.id, 'column')}><Rows2 size={14} /></button>
          </>
        )}
      </div>
    </div>
  );
}
