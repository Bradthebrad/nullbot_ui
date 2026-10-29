import {Eraser, X} from 'lucide-react';
import {useStore} from '../../lib/store';
import {appStore, toggleInspector} from '../../state/app';
import {useChat, useChatState} from './ChatContext';
import {chatsStore, focusedChat, showChat} from '../../state/chats';
import {api} from '../../lib/bindings';
import {toastError} from '../../ui/toast';
import {Pause, Play, Square} from 'lucide-react';
import type {ChatInfo} from '../../lib/types';
import {ActivityTrace} from '../activity/ActivityTrace';
import {Markdown} from '../../ui/Markdown';
import AttachmentTray from '../../AttachmentTray';
import {formatTime} from '../../lib/format';

export function Inspector() {
  const tab = useStore(appStore, state => state.inspectorTab);
  const chat = useChat();
  const sideCount = useChatState(state => state.side.length);
  const sideWorking = useChatState(state => state.side.some(item => item.status === 'working'));
  const working = useStore(chatsStore, state => state.list.filter(c => c.status !== 'idle').length);
  return (
    <aside className="inspector" id="live-activity" aria-label="Activity">
      <div className="inspector-head">
        <div className="tabs" role="tablist" aria-label="Inspector">
          <button role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'tab active' : 'tab'} onClick={() => appStore.set({inspectorTab: 'activity'})}>Activity</button>
          <button role="tab" aria-selected={tab === 'side'} className={tab === 'side' ? 'tab active' : 'tab'} onClick={() => appStore.set({inspectorTab: 'side'})}>
            Side questions
            {sideCount > 0 && <span className="tab-count num">{sideWorking ? <span className="dot live" /> : null}{sideCount}</span>}
          </button>
          <button role="tab" aria-selected={tab === 'chats'} className={tab === 'chats' ? 'tab active' : 'tab'} onClick={() => appStore.set({inspectorTab: 'chats'})}>
            Chats
            {working > 0 && <span className="tab-count num"><span className="dot live" />{working}</span>}
          </button>
        </div>
        <div className="inspector-actions">
          {tab !== 'chats' && (
            <button className="btn btn-ghost btn-icon btn-sm" title={tab === 'activity' ? 'Clear activity' : 'Clear side questions'} aria-label={tab === 'activity' ? 'Clear activity' : 'Clear side questions'} onClick={tab === 'activity' ? chat.clearActivity : chat.clearSide}>
              <Eraser size={14} />
            </button>
          )}
          <button className="btn btn-ghost btn-icon btn-sm" title="Hide panel (Ctrl+.)" aria-label="Hide panel" onClick={() => toggleInspector(false)}>
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="inspector-body">{tab === 'activity' ? <ActivityTrace /> : tab === 'side' ? <SideQuestions /> : <ChatsOverview />}</div>
    </aside>
  );
}

function SideQuestions() {
  const items = useChatState(state => state.side);
  if (!items.length) {
    return (
      <div className="trace-empty">
        <p>Ask a side question with <strong>Ask on the side</strong> in the composer. It gets its own answer here without interrupting the main conversation.</p>
      </div>
    );
  }
  return (
    <div className="side-list">
      {items.map(item => (
        <article key={item.id} className={`side-item side-${item.status}`}>
          <header>
            <span className="side-q">{item.question}</span>
            <time className="faint num">{formatTime(item.time)}</time>
          </header>
          {item.attachments?.length > 0 && <AttachmentTray attachments={item.attachments} readonly />}
          {item.status === 'working' ? (
            <p className="side-working"><span className="dot live" /> Working on it</p>
          ) : item.status === 'error' ? (
            <p className="side-error">{item.answer || 'This side question failed.'}</p>
          ) : (
            <Markdown className="prose prose-sm">{item.answer}</Markdown>
          )}
        </article>
      ))}
    </div>
  );
}

const chatStatusText: Record<ChatInfo['status'], string> = {idle: 'Idle', running: 'Working', paused: 'Paused', stopping: 'Stopping', held: 'Held'};

/** Every chat at a glance, with what it is doing and its controls. */
function ChatsOverview() {
  const list = useStore(chatsStore, state => state.list);
  const focused = useStore(chatsStore, state => focusedChat(state));
  async function control(id: string, action: 'pause' | 'resume' | 'stop') {
    try {
      await api.chatControl(id, action);
    } catch (error) {
      toastError(error);
    }
  }
  if (!list.length) return <div className="trace-empty"><p>Open more chats with the + beside the tabs. Each one runs on its own; this list shows them all.</p></div>;
  return (
    <div className="chats-overview">
      {list.map(chat => (
        <article key={chat.id} className={`chat-card ${chat.id === focused ? 'is-focused' : ''}`}>
          <header>
            <button className="chat-card-title" onClick={() => showChat(chat.id)}>
              <span className={`dot ${chat.status === 'idle' ? 'off' : chat.status === 'running' || chat.status === 'stopping' ? 'live' : 'idle'}`} aria-hidden="true" />
              {chat.title}
            </button>
            <span className="faint">{chatStatusText[chat.status] || chat.status}{chat.queue ? `, ${chat.queue} queued` : ''}</span>
          </header>
          {chat.request && <p className="chat-card-request">{chat.request}</p>}
          {!chat.request && chat.last_reply && <p className="chat-card-reply faint">{chat.last_reply}</p>}
          {(chat.subagents || []).length > 0 && (
            <ul className="chat-card-subagents">
              {chat.subagents!.map(sub => (
                <li key={sub.id}><span className="dot live" aria-hidden="true" /><strong>{sub.name || sub.role || sub.id}</strong>{sub.current ? <span className="faint"> {sub.current}</span> : null}</li>
              ))}
            </ul>
          )}
          {chat.status !== 'idle' && (
            <div className="row-actions">
              {chat.status === 'running' && <button className="btn btn-sm" onClick={() => void control(chat.id, 'pause')}><Pause size={11} />Pause</button>}
              {(chat.status === 'paused' || chat.status === 'held') && <button className="btn btn-sm" onClick={() => void control(chat.id, 'resume')}><Play size={11} />Resume</button>}
              {chat.status !== 'held' && <button className="btn btn-sm" disabled={chat.status === 'stopping'} onClick={() => void control(chat.id, 'stop')}><Square size={11} />Stop</button>}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
