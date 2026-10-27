import {Fragment, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {ChevronRight, Save, Search, Wrench, X} from 'lucide-react';
import {useStore} from '../../lib/store';
import {api} from '../../lib/bindings';
import {useResource} from '../../lib/useResource';
import {firstLine, formatDateTime, formatTime, humanizeName, shorten} from '../../lib/format';
import type {HistoryEntry, HistoryQuery, SavedToolCall, SessionSummary} from '../../lib/types';
import {appStore, setView} from '../../state/app';
import {chatStore, isBusy} from '../../state/chat';
import {reconcileChatHistory} from '../chat/transcript';
import {Blank, DetailHeader, ListGroup, ListRow, Panes, Spinner} from '../../ui/layout';
import {Markdown} from '../../ui/Markdown';
import {Segmented} from '../../ui/Tabs';
import {confirmDialog, promptDialog} from '../../ui/dialogs';
import {toast, toastError} from '../../ui/toast';

type Period = 'any' | 'today' | '7d' | '30d';
type Kind = 'all' | 'messages' | 'tools';
type Filters = {text: string; period: Period; kind: Kind};

/** Words and "quoted phrases", lowercased, as the backend matches them. */
export function searchTerms(text: string): string[] {
  const terms: string[] = [];
  for (const match of text.matchAll(/"([^"]*)"?|(\S+)/g)) {
    const term = (match[1] ?? match[2] ?? '').trim().toLowerCase();
    if (term) terms.push(term);
  }
  return terms;
}

/** Wraps each occurrence of the search terms in <mark>. */
export function Highlight({text, terms}: {text: string; terms: string[]}) {
  if (!terms.length || !text) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const parts = text.split(pattern);
  return <>{parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>))}</>;
}

function sinceFor(period: Period): string | undefined {
  const now = new Date();
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  if (period === '7d') return new Date(now.getTime() - 7 * 86_400_000).toISOString();
  if (period === '30d') return new Date(now.getTime() - 30 * 86_400_000).toISOString();
  return undefined;
}

function toQuery(filters: Filters): HistoryQuery | null {
  const query: HistoryQuery = {limit: 200};
  if (filters.text.trim()) query.text = filters.text.trim();
  const since = sinceFor(filters.period);
  if (since) query.since = since;
  if (filters.kind === 'messages') query.roles = ['user', 'assistant', 'reasoning', 'commentary', 'compaction'];
  if (filters.kind === 'tools') query.roles = ['tool'];
  return query.text || query.since || query.roles ? query : null;
}

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
  return firstLine(session.title || session.preview.replace(/^\w+:\s*/, ''), 70) || session.session_id.replace(/\.jsonl?$/i, '');
}

export function HistoryView() {
  const [text, setText] = useState('');
  const [filters, setFilters] = useState<Filters>({text: '', period: 'any', kind: 'all'});
  const query = useMemo(() => toQuery(filters), [filters]);
  const key = JSON.stringify(query);
  const {data, error, loading, reload} = useResource(() => (query ? api.searchSessionsWith(query) : api.sessions(200)), {topics: ['history'], deps: [key]});
  const sessions = data || [];
  const [selected, setSelected] = useState('');
  const current = sessions.find(s => s.session_id === selected) || sessions[0];
  const terms = useMemo(() => searchTerms(filters.text), [filters.text]);

  // Search as you type, after a pause.
  useEffect(() => {
    const id = window.setTimeout(() => setFilters(f => (f.text === text.trim() ? f : {...f, text: text.trim()})), 250);
    return () => window.clearTimeout(id);
  }, [text]);

  const groups = useMemo(() => {
    if (query) return [['Matches', sessions] as [string, SessionSummary[]]];
    const out: [string, SessionSummary[]][] = [];
    for (const session of sessions) {
      const label = dayGroup(session.modified);
      const last = out[out.length - 1];
      if (last && last[0] === label) last[1].push(session);
      else out.push([label, [session]]);
    }
    return out;
  }, [sessions, query]);

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

  const filtering = !!query;
  return (
    <div className="view">
      <Panes
        label="Saved conversations"
        listWidth={360}
        list={
          <>
            <div className="pane-toolbar history-toolbar">
              <div className="history-search-row">
                <div className="search-field">
                  <Search size={13} aria-hidden="true" />
                  <input className="bare-input" value={text} onChange={event => setText(event.target.value)} placeholder="Search messages and tool calls" aria-label="Search history" />
                  {text && <button className="btn btn-ghost btn-icon btn-sm" aria-label="Clear search" onClick={() => setText('')}><X size={12} /></button>}
                </div>
                <button className="btn btn-sm btn-icon" title="Save the current conversation" aria-label="Save the current conversation" onClick={() => void saveCurrent()}><Save size={13} /></button>
              </div>
              <div className="history-filters">
                <select className="select select-sm" value={filters.period} aria-label="When" onChange={event => setFilters(f => ({...f, period: event.target.value as Period}))}>
                  <option value="any">Any time</option>
                  <option value="today">Today</option>
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                </select>
                <Segmented label="Search in" value={filters.kind} onChange={kind => setFilters(f => ({...f, kind}))} options={[{id: 'all', label: 'Everything'}, {id: 'messages', label: 'Messages'}, {id: 'tools', label: 'Tool calls'}]} />
              </div>
            </div>
            {error && <p className="notice bad pane-notice">{error}</p>}
            {loading && !sessions.length && <p className="pane-empty"><Spinner label={filtering ? 'Searching' : 'Loading'} /></p>}
            {!loading && !sessions.length && <p className="pane-empty faint">{filtering ? 'Nothing matches. Try fewer words, or widen the time range.' : 'Conversations are saved here as you work.'}</p>}
            {groups.map(([label, list]) => (
              <ListGroup key={label} title={label} count={filtering ? list.length : undefined}>
                {list.map(session => (
                  <ListRow
                    key={session.session_id}
                    selected={session.session_id === current?.session_id}
                    onSelect={() => setSelected(session.session_id)}
                    title={sessionTitle(session)}
                    subtitle={filtering && session.snippet ? <Highlight text={session.snippet} terms={terms} /> : `${session.messages} messages`}
                    meta={filtering ? `${session.matches || 0} ${session.matches === 1 ? 'match' : 'matches'}` : formatDateTime(session.modified)}
                  />
                ))}
              </ListGroup>
            ))}
          </>
        }
        detail={current ? <SessionDetail key={`${current.session_id}:${key}`} session={current} query={query} terms={terms} /> : <Blank title="No conversation selected">Pick a saved conversation to read it, or continue it where it left off.</Blank>}
      />
    </div>
  );
}

function SessionDetail({session, query, terms}: {session: SessionSummary; query: HistoryQuery | null; terms: string[]}) {
  const [showTools, setShowTools] = useState(query?.roles?.includes('tool') ?? false);
  const {data: hits} = useResource(() => (query ? api.searchHistory({...query, session_id: session.session_id, limit: 200}) : Promise.resolve(null)), {deps: [session.session_id, JSON.stringify(query)]});
  const hitKeys = useMemo(() => new Set((hits?.hits || []).map(h => `${h.kind}:${h.index}`)), [hits]);
  const toolHits = (hits?.hits || []).some(h => h.kind === 'tool');
  const tools = showTools || toolHits;
  const {data, error, loading} = useResource(() => api.sessionEntries(session.session_id, tools), {deps: [session.session_id, tools]});
  const busy = useStore(chatStore, isBusy);
  const botName = useStore(appStore, state => state.runtime.bot_name || 'NullBot');
  const [loadingSession, setLoadingSession] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const entries = data || [];
  const toolCount = entries.filter(e => e.kind === 'tool').length;

  // Bring the first match into view.
  useEffect(() => {
    if (!hitKeys.size || !entries.length) return;
    const first = body.current?.querySelector<HTMLElement>('.is-hit');
    first?.scrollIntoView({block: 'center'});
  }, [hitKeys, entries.length]);

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
        subtitle={[`${session.messages} messages`, tools && toolCount ? `${toolCount} tool calls` : '', `last active ${formatDateTime(session.modified)}`, hits ? `${hits.hits.length}${hits.more ? '+' : ''} matches here` : ''].filter(Boolean).join(', ')}
        actions={
          <>
            <label className="check"><input type="checkbox" checked={tools} disabled={toolHits} onChange={event => setShowTools(event.target.checked)} />Show tool calls</label>
            <button className="btn btn-primary" disabled={busy || loadingSession} title={busy ? 'Wait for the current request to finish' : undefined} onClick={() => void load()}>
              {loadingSession && <span className="spinner" />}Continue this conversation
            </button>
          </>
        }
      />
      <div className="detail-body session-read" ref={body}>
        {loading && !data ? <Spinner label="Reading" /> : error ? <p className="notice bad">{error}</p> : entries.map(entry => (
          <EntryRow key={`${entry.kind}:${entry.index}`} entry={entry} hit={hitKeys.has(`${entry.kind}:${entry.index}`)} terms={terms} botName={botName} />
        ))}
      </div>
    </div>
  );
}

function EntryRow({entry, hit, terms, botName}: {entry: HistoryEntry; hit: boolean; terms: string[]; botName: string}) {
  if (entry.kind === 'tool' && entry.tool) return <ToolEntry call={entry.tool} hit={hit} terms={terms} />;
  const message = entry.message;
  if (!message || !String(message.content || '').trim()) return null;
  const role = message.role || 'assistant';
  const hitClass = hit ? ' is-hit' : '';
  if (role === 'reasoning' || role === 'commentary' || role === 'compaction') {
    return (
      <article className={`row row-quiet${hitClass}`}>
        <div className="row-gutter" />
        <div className="row-body commentary prose-sm">
          <span className="faint">{role === 'reasoning' ? 'Thinking: ' : role === 'compaction' ? 'Compacted here. Summary: ' : ''}</span>
          {hit ? <Highlight text={String(message.content || '')} terms={terms} /> : shorten(message.content, 400)}
        </div>
      </article>
    );
  }
  const user = role === 'user';
  return (
    <article className={`row row-${user ? 'user' : 'assistant'}${hitClass}`}>
      <div className="row-gutter">
        <span className="row-speaker" title={formatDateTime(message.time)}>{user ? 'You' : botName}</span>
      </div>
      <div className="row-body">
        {user ? (
          <div className="user-text">{hit ? <Highlight text={String(message.content).replace(/@file\([^)]*\)/g, '').trim()} terms={terms} /> : String(message.content).replace(/@file\([^)]*\)/g, '').trim()}</div>
        ) : <Markdown>{message.content || ''}</Markdown>}
      </div>
    </article>
  );
}

function argSummary(args?: Record<string, unknown>): string {
  if (!args) return '';
  for (const key of ['query', 'q', 'path', 'file', 'url', 'name', 'key', 'id', 'command']) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return shorten(value, 80);
  }
  const first = Object.values(args).find(v => typeof v === 'string' && v.trim());
  return typeof first === 'string' ? shorten(first, 80) : '';
}

function ToolEntry({call, hit, terms}: {call: SavedToolCall; hit: boolean; terms: string[]}) {
  const [open, setOpen] = useState(hit);
  const failed = call.status !== 'tool complete';
  const outcome = call.error || call.detail || firstLine(call.result, 140);
  const show = (value: string): ReactNode => (hit ? <Highlight text={value} terms={terms} /> : value);
  return (
    <div className={`hist-tool${failed ? ' is-failed' : ''}${hit ? ' is-hit' : ''}`}>
      <button type="button" className="hist-tool-head" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <ChevronRight size={12} className="thinking-chevron" />
        <Wrench size={12} aria-hidden="true" />
        <span className="hist-tool-name">{humanizeName(call.tool) || 'Tool'}</span>
        {call.server && <span className="faint">{call.server}</span>}
        {argSummary(call.args) && <span className="hist-tool-arg mono">{show(argSummary(call.args))}</span>}
        <time className="faint num">{formatTime(call.time)}</time>
      </button>
      {!open && outcome && <p className={failed ? 'hist-tool-outcome bad-text' : 'hist-tool-outcome muted'}>{show(shorten(outcome, 160))}</p>}
      {open && (
        <div className="hist-tool-body">
          {call.args && Object.keys(call.args).length > 0 && <pre className="step-text">{show(JSON.stringify(call.args, null, 2))}</pre>}
          {call.error ? <pre className="step-text bad-text">{show(call.error)}</pre> : call.result ? <pre className="step-text">{show(call.result)}</pre> : call.detail ? <p className="bad-text">{call.detail}</p> : null}
          {call.agent_id && call.agent_id !== 'main' && <p className="faint">Run by {call.agent_id.split('/')[0]}</p>}
        </div>
      )}
    </div>
  );
}
