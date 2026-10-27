import {Eraser, X} from 'lucide-react';
import {useStore} from '../../lib/store';
import {appStore, toggleInspector} from '../../state/app';
import {chatStore, clearActivity, clearSide} from '../../state/chat';
import {ActivityTrace} from '../activity/ActivityTrace';
import {Markdown} from '../../ui/Markdown';
import AttachmentTray from '../../AttachmentTray';
import {formatTime} from '../../lib/format';

export function Inspector() {
  const tab = useStore(appStore, state => state.inspectorTab);
  const sideCount = useStore(chatStore, state => state.side.length);
  const sideWorking = useStore(chatStore, state => state.side.some(item => item.status === 'working'));
  return (
    <aside className="inspector" id="live-activity" aria-label="Activity">
      <div className="inspector-head">
        <div className="tabs" role="tablist" aria-label="Inspector">
          <button role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'tab active' : 'tab'} onClick={() => appStore.set({inspectorTab: 'activity'})}>Activity</button>
          <button role="tab" aria-selected={tab === 'side'} className={tab === 'side' ? 'tab active' : 'tab'} onClick={() => appStore.set({inspectorTab: 'side'})}>
            Side questions
            {sideCount > 0 && <span className="tab-count num">{sideWorking ? <span className="dot live" /> : null}{sideCount}</span>}
          </button>
        </div>
        <div className="inspector-actions">
          <button className="btn btn-ghost btn-icon btn-sm" title={tab === 'activity' ? 'Clear activity' : 'Clear side questions'} aria-label={tab === 'activity' ? 'Clear activity' : 'Clear side questions'} onClick={tab === 'activity' ? clearActivity : clearSide}>
            <Eraser size={14} />
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" title="Hide panel (Ctrl+.)" aria-label="Hide panel" onClick={() => toggleInspector(false)}>
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="inspector-body">{tab === 'activity' ? <ActivityTrace /> : <SideQuestions />}</div>
    </aside>
  );
}

function SideQuestions() {
  const items = useStore(chatStore, state => state.side);
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
