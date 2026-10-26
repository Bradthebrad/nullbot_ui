import {Activity, Blocks, Folder, History, MessageSquare, Settings} from 'lucide-react';
import {useStore} from '../lib/store';
import {appStore, setView, type View} from '../state/app';
import {chatStore, isBusy} from '../state/chat';

const items: {id: View; label: string; icon: typeof Activity; key: string}[] = [
  {id: 'chat', label: 'Chat', icon: MessageSquare, key: '1'},
  {id: 'activity', label: 'Activity', icon: Activity, key: '2'},
  {id: 'files', label: 'Files', icon: Folder, key: '3'},
  {id: 'tools', label: 'Tools', icon: Blocks, key: '4'},
  {id: 'history', label: 'History', icon: History, key: '5'},
];

export const railViews = [...items.map(item => item.id), 'settings' as View];

export function Rail() {
  const view = useStore(appStore, state => state.view);
  const botName = useStore(appStore, state => String(state.runtime.bot_name || 'NullBot'));
  const busy = useStore(chatStore, isBusy);
  const failing = useStore(appStore, state => state.mcp.some(s => s.enabled && s.state === 'error'));
  return (
    <nav className="rail" aria-label="Main">
      <div className="rail-mark" title={botName} aria-hidden="true">{botName.slice(0, 1).toUpperCase()}</div>
      <div className="rail-items">
        {items.map(item => {
          const Icon = item.icon;
          const badge = item.id === 'activity' && busy ? 'live' : item.id === 'tools' && failing ? 'bad' : '';
          return (
            <button key={item.id} className={view === item.id ? 'rail-item active' : 'rail-item'} aria-current={view === item.id ? 'page' : undefined} title={`${item.label} (Ctrl+${item.key})`} onClick={() => setView(item.id)}>
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
