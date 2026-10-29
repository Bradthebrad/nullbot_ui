import {Activity, Blocks, Folder, History, MessageSquare, Settings, Shapes} from 'lucide-react';
import {useStore} from '../lib/store';
import {appStore, setView, type View} from '../state/app';
import {chatsStore} from '../state/chats';
import {useFocusedChatState} from '../features/chat/ChatContext';
import {isBusy} from '../state/chat';
import {visualStore} from '../state/visuals';

const items: {id: View; label: string; icon: typeof Activity; key: string; title?: string}[] = [
  {id: 'chat', label: 'Chat', icon: MessageSquare, key: '1'},
  {id: 'activity', label: 'Activity', icon: Activity, key: '2'},
  {id: 'files', label: 'Files', icon: Folder, key: '3'},
  {id: 'visuals', label: 'Visuals', icon: Shapes, key: '4', title: 'Visualizations'},
  {id: 'tools', label: 'Tools', icon: Blocks, key: '5'},
  {id: 'history', label: 'History', icon: History, key: '6'},
];

export const railViews = [...items.map(item => item.id), 'settings' as View];

export function Rail() {
  const view = useStore(appStore, state => state.view);
  const botName = useStore(appStore, state => String(state.runtime.bot_name || 'NullBot'));
  const focusedBusy = useFocusedChatState(isBusy);
  const othersBusy = useStore(chatsStore, state => state.list.some(c => c.status !== 'idle'));
  const busy = focusedBusy || othersBusy;
  const failing = useStore(appStore, state => state.mcp.some(s => s.enabled && s.state === 'error'));
  const waiting = useStore(visualStore, state => state.live.some(v => v.waiting));
  return (
    <nav className="rail" aria-label="Main">
      <div className="rail-mark" title={botName} aria-hidden="true">{botName.slice(0, 1).toUpperCase()}</div>
      <div className="rail-items">
        {items.map(item => {
          const Icon = item.icon;
          const badge = item.id === 'activity' && busy ? 'live' : item.id === 'tools' && failing ? 'bad' : item.id === 'visuals' && waiting ? 'live' : '';
          return (
            <button key={item.id} className={view === item.id ? 'rail-item active' : 'rail-item'} aria-current={view === item.id ? 'page' : undefined} title={`${item.title || item.label} (Ctrl+${item.key})`} onClick={() => setView(item.id)}>
              <span className="rail-icon">
                <Icon size={18} strokeWidth={1.75} />
                {badge && <span className={`rail-badge dot ${badge}`} />}
              </span>
              <span className="rail-label">{item.label}</span>
            </button>
          );
        })}
      </div>
      <button className={view === 'settings' ? 'rail-item active' : 'rail-item'} aria-current={view === 'settings' ? 'page' : undefined} title="Settings (Ctrl+,)" onClick={() => setView('settings')}>
        <span className="rail-icon"><Settings size={18} strokeWidth={1.75} /></span>
        <span className="rail-label">Settings</span>
      </button>
    </nav>
  );
}
