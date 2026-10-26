import {useEffect, useMemo, useState} from 'react';
import {Save, Search} from 'lucide-react';
import {useStore} from '../../lib/store';
import {api} from '../../lib/bindings';
import {useResource} from '../../lib/useResource';
import {firstLine, formatDateTime} from '../../lib/format';
import type {ChatMessage, SessionSummary} from '../../lib/types';
import {appStore, setView} from '../../state/app';
import {chatStore, isBusy} from '../../state/chat';
import {reconcileChatHistory} from '../chat/transcript';
import {Blank, DetailHeader, ListGroup, ListRow, Panes, Spinner} from '../../ui/layout';
import {Markdown} from '../../ui/Markdown';
import {confirmDialog, promptDialog} from '../../ui/dialogs';
import {toast, toastError} from '../../ui/toast';

function dayGroup(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Earlier';
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(now) - start(date)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  if (days < 31) return 'This month';
  return date.toLocaleDateString([], {month: 'long', year: 'numeric'});
}

function sessionTitle(session: SessionSummary) {
  return firstLine(session.preview, 70) || session.session_id.replace(/\.jsonl?$/i, '');
}

export function HistoryView() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const {data, error, loading, reload} = useResource(() => (submitted ? api.searchSessions(submitted) : api.sessions(200)), {topics: ['history'], deps: [submitted]});
  const sessions = data || [];
  const [selected, setSelected] = useState('');
  const current = sessions.find(s => s.session_id === selected) || sessions[0];

  // Search as you type, after a pause.
  useEffect(() => {
    const id = window.setTimeout(() => setSubmitted(query.trim()), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  const groups = useMemo(() => {
    const out: [string, SessionSummary[]][] = [];
    for (const session of sessions) {
      const label = dayGroup(session.modified);
      const last = out[out.length - 1];
      if (last && last[0] === label) last[1].push(session);
      else out.push([label, [session]]);
    }
    return out;
  }, [sessions]);

  async function saveCurrent() {
    const name = await promptDialog({title: 'Save this conversation', label: 'Name', placeholder: 'quarterly-report-review', confirmLabel: 'Save'});
    if (!name) return;
    try {
      await api.saveCurrentSession(name);
      toast('Conversation saved.', 'success');
      reload();
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <div className="view">
      <Panes
        label="Saved conversations"
        listWidth={340}
        list={
          <>
            <div className="pane-toolbar">
              <div className="search-field">
                <Search size={13} aria-hidden="true" />
                <input className="bare-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
              </div>
              <button className="btn btn-sm btn-icon" title="Save the current conversation" aria-label="Save the current conversation" onClick={() => void saveCurrent()}><Save size={13} /></button>
            </div>
            {error && <p className="notice bad pane-notice">{error}</p>}
            {loading && !sessions.length && <p className="pane-empty"><Spinner label="Loading" /></p>}
            {!loading && !sessions.length && <p className="pane-empty faint">{submitted ? `Nothing matches “${submitted}”.` : 'Conversations are saved here as you work.'}</p>}
            {groups.map(([label, list]) => (
              <ListGroup key={label} title={label}>
                {list.map(session => (
                  <ListRow
                    key={session.session_id}
                    selected={session.session_id === current?.session_id}
                    onSelect={() => setSelected(session.session_id)}
                    title={sessionTitle(session)}
                    subtitle={`${session.messages} messages`}
                    meta={formatDateTime(session.modified)}
                  />
                ))}
              </ListGroup>
            ))}
          </>
        }
        detail={current ? <SessionDetail key={current.session_id} session={current} /> : <Blank title="No conversation selected">Pick a saved conversation to read it, or continue it where it left off.</Blank>}
      />
    </div>
  );
}

function SessionDetail({session}: {session: SessionSummary}) {
  const {data, error, loading} = useResource(() => api.readSession(session.session_id, 200), {deps: [session.session_id]});
  const busy = useStore(chatStore, isBusy);
  const botName = useStore(appStore, state => state.runtime.bot_name || 'NullBot');
  const [loadingSession, setLoadingSession] = useState(false);
  const messages = (data || []) as ChatMessage[];
  const shown = messages.filter(m => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim() && m.lane !== 'also');
  const hidden = messages.length - shown.length;

  async function load() {
    if (chatStore.get().messages.length && !(await confirmDialog({title: 'Continue this conversation?', body: 'It replaces the conversation on screen. The current one stays in history.', confirmLabel: 'Continue it'}))) return;
    setLoadingSession(true);
    try {
      const reply = await api.loadSession(session.session_id, 120);
      chatStore.set({messages: reconcileChatHistory([], reply.history || []), commandOutput: null});
      setView('chat');
      toast('Conversation loaded.', 'success');
    } catch (err) {
      toastError(err);
    } finally {
      setLoadingSession(false);
    }
  }

  return (
    <div className="detail">
      <DetailHeader
        title={sessionTitle(session)}
        subtitle={`${session.messages} messages, last active ${formatDateTime(session.modified)}`}
        actions={
          <button className="btn btn-primary" disabled={busy || loadingSession} title={busy ? 'Wait for the current request to finish' : undefined} onClick={() => void load()}>
            {loadingSession && <span className="spinner" />}Continue this conversation
          </button>
        }
      />
      <div className="detail-body session-read">
        {loading && !data ? <Spinner label="Reading" /> : error ? <p className="notice bad">{error}</p> : (
          <>
            {shown.map((message, index) => (
              <article key={index} className={`row row-${message.role === 'user' ? 'user' : 'assistant'}`}>
                <div className="row-gutter"><span className="row-speaker">{message.role === 'user' ? 'You' : botName}</span></div>
                <div className="row-body">
                  {message.role === 'user' ? <div className="user-text">{String(message.content || '').replace(/@file\([^)]*\)/g, '').trim()}</div> : <Markdown>{message.content || ''}</Markdown>}
                </div>
              </article>
            ))}
            {hidden > 0 && <p className="faint detail-foot">{hidden} tool and thinking entries are not shown.</p>}
          </>
        )}
      </div>
    </div>
  );
}
