import {useEffect, useRef, useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Activity,
  Archive,
  Bot,
  Brain,
  Check,
  ChevronUp,
  CircleStop,
  Clock,
  Compass,
  Copy,
  Download,
  FilePenLine,
  FilePlus2,
  Files,
  FolderPlus,
  Gauge,
  Home,
  Layers,
  LineChart,
  ListChecks,
  MessageSquare,
  MoonStar,
  PackagePlus,
  PanelLeft,
  Pause as PauseIcon,
  Play,
  CalendarDays,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  Sparkles,
  Store,
  TerminalSquare,
  Trash2,
  WandSparkles,
} from 'lucide-react';
import botArt from './assets/nullbot-bot.png';
import './App.css';
import {
  AccountStatus,
  AddMCPServer,
  Analyze,
  AttachFiles,
  AttachTextPaths,
  BeginCodexLogin,
  BuildUsageReport,
  CancelTask,
  CancelScheduledTask,
  Command,
  CompactConversation,
  CompletePath,
  CreateDirectory,
  CreateFile,
  CreatePlan,
  CreateScheduledTask,
  DeletePath,
  DeletePlan,
  DeleteScheduledTask,
  ExecutePlan,
  InstallMarketPackage,
  ListFiles,
  LoadSession,
  Marketplace,
  Models,
  Pause as PauseBot,
  Plans,
  PollCodexLogin,
  PreviewFile,
  ReadPlan,
  ReadSession,
  ReadSkill,
  RenamePath,
  Resume,
  RunScheduledTaskNow,
  SaveConfig,
  SaveAccountKeys,
  SaveCurrentSession,
  SaveFile,
  SavePlan,
  SavePrompts,
  SaveSkill,
  SearchSessions,
  SendAlso,
  SetBotName,
  SetModel,
  SetTheme,
  SetWorkingDirectory,
  DiscoverMCPTools,
  PromptDefaults,
  SaveUsageReport,
  Sessions,
  Skills,
  State,
  Submit,
  ScheduledTasks,
  Tasks,
  Thoughts,
  ToggleMCPServer,
} from '../wailsjs/go/main/App';
import {CanResolveFilePaths, EventsOn, OnFileDrop, OnFileDropOff} from '../wailsjs/runtime/runtime';

type View =
  | 'chat'
  | 'agents'
  | 'files'
  | 'models'
  | 'settings'
  | 'market'
  | 'skills'
  | 'mcp'
  | 'history'
  | 'usage'
  | 'prompts'
  | 'plan'
  | 'tasks'
  | 'themes'
  | 'identity';

type AnyMap = Record<string, any>;

const navItems: Array<{id: View; label: string; icon: any}> = [
  {id: 'chat', label: 'Chat', icon: MessageSquare},
  {id: 'agents', label: 'Agents', icon: Brain},
  {id: 'files', label: 'Files', icon: Files},
  {id: 'models', label: 'Models', icon: Bot},
  {id: 'settings', label: 'Settings', icon: Settings},
  {id: 'market', label: 'Marketplace', icon: Store},
  {id: 'skills', label: 'Skills', icon: WandSparkles},
  {id: 'mcp', label: 'MCP Tools', icon: TerminalSquare},
  {id: 'history', label: 'Sessions', icon: Clock},
  {id: 'usage', label: 'Usage', icon: LineChart},
  {id: 'plan', label: 'Plan', icon: ListChecks},
  {id: 'tasks', label: 'Tasks', icon: Gauge},
  {id: 'prompts', label: 'Prompts', icon: Sparkles},
  {id: 'themes', label: 'Themes', icon: MoonStar},
  {id: 'identity', label: 'Bot Name', icon: Archive},
];

const slashForView: Partial<Record<View, string>> = {
  agents: '/agents',
  tasks: '/tasks',
  plan: '/plan',
  market: '/market',
  mcp: '/mcp',
  skills: '/skills',
  usage: '/usage',
};

function App() {
  const [view, setView] = useState<View>('chat');
  const [ui, setUi] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Starting NullBot UI');
  const suppressNextReplyRef = useRef(false);

  useEffect(() => {
    refreshState();
    const offActivity = EventsOn('activity', (record: any) => {
      setActivity((current) => [...current.slice(-399), record]);
    });
    const offReply = EventsOn('reply', (reply: any) => {
      if (suppressNextReplyRef.current) {
        suppressNextReplyRef.current = false;
        if (reply.activity?.length) {
          setActivity((current) => [...current, ...(reply.activity || [])].slice(-400));
        }
        return;
      }
      setMessages(reply.history || []);
      if (reply.activity?.length) {
        setActivity((current) => [...current, ...(reply.activity || [])].slice(-400));
      }
      setStatus(reply.message || 'Ready');
    });
    return () => {
      offActivity();
      offReply();
    };
  }, []);

  async function refreshState() {
    try {
      const next = await State();
      setUi(next);
      setMessages(next.reply?.history || []);
      setActivity(next.reply?.activity || []);
      setStatus(next.reply?.message || 'Ready');
    } catch (error: any) {
      setStatus(String(error));
    }
  }

  async function openView(next: View) {
    setView(next);
    const command = slashForView[next];
    if (!command) return;
    try {
      const reply = await Command(command);
      setMessages(reply.history || []);
      setStatus(reply.message || 'Ready');
      if (reply.data) {
        setUi((current: any) => ({...current, lastPanel: reply}));
      }
    } catch (error: any) {
      setStatus(String(error));
    }
  }

  const theme = ui?.themes?.find((t: any) => t.id === ui?.config?.ui?.theme) || ui?.themes?.[0];

  return (
    <div className="app" style={themeVars(theme)}>
      <Sidebar current={view} onOpen={openView} />
      <main className="workspace">
        <TopBar ui={ui} status={status} busy={busy} onRefresh={refreshState} />
        {!ui ? (
          <div className="loading">Loading NullBot...</div>
        ) : (
          <>
            {view === 'chat' && (
              <ChatView
                ui={ui}
                messages={messages}
                activity={activity}
                busy={busy}
                setBusy={setBusy}
                setMessages={setMessages}
                setActivity={setActivity}
                setStatus={setStatus}
                refreshState={refreshState}
                suppressNextReplyRef={suppressNextReplyRef}
              />
            )}
            {view === 'agents' && <AgentsView ui={ui} refreshState={refreshState} />}
            {view === 'files' && <FilesView initial={ui.files} refreshState={refreshState} />}
            {view === 'models' && <ModelsView ui={ui} refreshState={refreshState} />}
            {view === 'settings' && <SettingsView ui={ui} refreshState={refreshState} setStatus={setStatus} />}
            {view === 'market' && <MarketplaceView initial={ui.marketplace} refreshState={refreshState} />}
            {view === 'skills' && <SkillsView />}
            {view === 'mcp' && <MCPView ui={ui} refreshState={refreshState} />}
            {view === 'history' && <HistoryView refreshState={refreshState} setMessages={setMessages} />}
            {view === 'usage' && <UsageView ui={ui} />}
            {view === 'plan' && <PlanView refreshState={refreshState} />}
            {view === 'tasks' && <TasksView />}
            {view === 'prompts' && <PromptsView ui={ui} refreshState={refreshState} />}
            {view === 'themes' && <ThemesView ui={ui} refreshState={refreshState} setUi={setUi} />}
            {view === 'identity' && <IdentityView ui={ui} refreshState={refreshState} />}
          </>
        )}
      </main>
    </div>
  );
}

function Sidebar({current, onOpen}: {current: View; onOpen: (view: View) => void}) {
  return (
    <aside className="sidebar">
      <div className="brand-mini">
        <PanelLeft size={18} />
        <span>NullBot</span>
      </div>
      <nav>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={current === item.id ? 'active' : ''} onClick={() => onOpen(item.id)}>
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function TopBar({ui, status, busy, onRefresh}: {ui: any; status: string; busy: boolean; onRefresh: () => void}) {
  const runtime = ui?.runtime || {};
  return (
    <header className="topbar">
      <div className="top-title">
        {busy && <span className="spinner" />}
        <h1>{runtime.bot_name || 'NullBot'}</h1>
      </div>
      <div className="runtime-strip">
        <Pill label={runtime.provider || 'provider'} value={runtime.model || 'model'} />
        <Pill label="Subagents" value={String(runtime.max_subagents ?? 0)} />
        <Pill label={busy ? 'Working' : 'Ready'} value={statusPhase(status, busy)} />
        <button className="icon-button" onClick={onRefresh} title="Refresh">
          <RefreshCw size={18} />
        </button>
      </div>
    </header>
  );
}

function ChatView({messages, activity, busy, setBusy, setMessages, setActivity, setStatus, refreshState, suppressNextReplyRef}: any) {
  const [input, setInput] = useState('');
  const [alsoMode, setAlsoMode] = useState(false);
  const [alsoOpen, setAlsoOpen] = useState(false);
  const [alsoItems, setAlsoItems] = useState<any[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [dragging, setDragging] = useState(false);
  const [focus, setFocus] = useState('');
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const streamID = useRef(0);

  useEffect(() => {
    OnFileDrop((_x: number, _y: number, paths: string[]) => {
      attachPaths(paths);
      setDragging(false);
    }, true);
    return () => OnFileDropOff();
  }, []);

  function updateInput(value: string) {
    setInput(value);
    setHistoryCursor(null);
  }

  function rememberPrompt(text: string) {
    const prompt = text.trim();
    if (!prompt) return;
    setPromptHistory((current) => {
      if (current[current.length - 1] === prompt) return current;
      return [...current.slice(-99), prompt];
    });
    setHistoryCursor(null);
  }

  function recallPrompt(delta: -1 | 1) {
    if (promptHistory.length === 0) return;
    let next: number | null;
    if (historyCursor === null) {
      if (delta > 0) return;
      next = promptHistory.length - 1;
    } else {
      const candidate = historyCursor + delta;
      if (candidate < 0) {
        next = 0;
      } else if (candidate >= promptHistory.length) {
        next = null;
      } else {
        next = candidate;
      }
    }
    setHistoryCursor(next);
    setInput(next === null ? '' : promptHistory[next]);
  }

  function handleComposerKeyDown(event: any) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
      return;
    }
    if (event.key === 'ArrowUp' && !event.shiftKey && (input.trim() === '' || historyCursor !== null)) {
      event.preventDefault();
      recallPrompt(-1);
      return;
    }
    if (event.key === 'ArrowDown' && !event.shiftKey && historyCursor !== null) {
      event.preventDefault();
      recallPrompt(1);
    }
  }

  async function send() {
    const text = input.trim();
    const sendAttachments = attachments.filter((item) => item.token);
    if (!text && sendAttachments.length === 0) return;
    const outbound = messageWithAttachmentTokens(text, sendAttachments);
    rememberPrompt(text);
    if (alsoMode) {
      const id = `${Date.now()}-${Math.random()}`;
      setAlsoOpen(true);
      setStatus('Also observer working...');
      setInput('');
      setAttachments([]);
      setAlsoItems((current) => [...current, {id, question: text || 'Attached file(s)', attachments: sendAttachments, answer: '', status: 'working', time: new Date().toISOString()}]);
      try {
        const reply = await SendAlso(outbound);
        setAlsoItems((current) => current.map((item) => item.id === id ? {...item, answer: reply.message || '', status: 'done'} : item));
        if (reply.activity?.length) setActivity((current: any[]) => [...current, ...(reply.activity || [])].slice(-400));
        setStatus('Also answer ready.');
      } catch (error: any) {
        setAlsoItems((current) => current.map((item) => item.id === id ? {...item, answer: String(error), status: 'error'} : item));
        setStatus(String(error));
      }
      return;
    }
    const isSlashCommand = text.startsWith('/');
    const currentStream = ++streamID.current;
    let background = false;
    setStatus('Starting agent task...');
    setInput('');
    setAttachments([]);
    if (!isSlashCommand) {
      setMessages((current: any[]) => [
        ...current,
        localMessage('user', outbound, {attachments: sendAttachments}),
        localMessage('assistant', '', {pending: true}),
      ]);
    }
    try {
      const reply = await Submit(outbound);
      background = !!reply.data?.background;
      if (background) {
        setStatus(reply.message || 'Agent task started.');
        return;
      }
      if (isSlashCommand) {
        setMessages(reply.history || []);
      } else {
        await revealReply(reply, currentStream);
      }
      if (reply.activity?.length) setActivity((current: any[]) => [...current, ...(reply.activity || [])].slice(-400));
      setStatus(isSlashCommand ? (reply.message || 'Ready') : 'Response complete.');
    } catch (error: any) {
      if (!isSlashCommand) suppressNextReplyRef.current = false;
      if (!isSlashCommand) {
        setMessages((current: any[]) => [
          ...current.filter((message) => !message.pending),
          localMessage('assistant', String(error), {roleClass: 'error'}),
        ]);
      }
      setStatus(String(error));
    } finally {
      if (!background) {
        setBusy(false);
        refreshState();
      }
    }
  }

  async function revealReply(reply: any, currentStream: number) {
    const history = reply.history || [];
    if (history.length === 0) {
      setMessages([]);
      return;
    }
    const last = history[history.length - 1];
    if ((last.role || '').toLowerCase() !== 'assistant') {
      setMessages(history);
      return;
    }
    const base = history.slice(0, -1);
    const full = String(last.content || '');
    const chunkSize = Math.max(12, Math.ceil(full.length / 140));
    setMessages([...base, {...last, content: '', pending: true}]);
    for (let index = chunkSize; index < full.length; index += chunkSize) {
      if (streamID.current !== currentStream) return;
      setMessages([...base, {...last, content: full.slice(0, index), streaming: true}]);
      await sleep(16);
    }
    if (streamID.current === currentStream) {
      setMessages(history);
    }
  }

  async function attachPaths(paths: string[]) {
    const clean = (paths || []).filter(Boolean);
    if (clean.length === 0) return;
    setStatus('Attaching files...');
    try {
      const next = await AttachFiles(clean);
      setAttachments((current) => mergeAttachments(current, next));
      const ok = next.filter((item: any) => item.token).length;
      const failed = next.length - ok;
      setStatus(failed ? `Attached ${ok}, ${failed} failed.` : `Attached ${ok} file(s).`);
    } catch (error: any) {
      setStatus(String(error));
    }
  }

  async function handlePaste(event: any) {
    const files = Array.from(event.clipboardData?.files || []) as File[];
    if (files.length > 0 && CanResolveFilePaths()) {
      event.preventDefault();
      setStatus('Resolving pasted file(s)...');
      (window as any).runtime?.ResolveFilePaths?.(event.clientX || 0, event.clientY || 0, files);
      return;
    }
    const text = event.clipboardData?.getData('text/plain') || '';
    if (text.trim()) {
      try {
        const next = await AttachTextPaths(text);
        if (next?.length) {
          event.preventDefault();
          setAttachments((current) => mergeAttachments(current, next));
          setStatus(`Attached ${next.filter((item: any) => item.token).length} file(s).`);
        } else {
          setStatus('Pasted into composer.');
        }
      } catch (error: any) {
        setStatus(String(error));
      }
    }
  }

  function removeAttachment(path: string) {
    setAttachments((current) => current.filter((item) => item.path !== path));
  }

  async function runAnalyze() {
    setBusy(true);
    try {
      const reply = await Analyze(focus);
      setStatus(reply.message);
      setFocus('');
    } finally {
      setBusy(false);
    }
  }

  async function runPlan() {
    const typed = input.trim();
    const planFocus = focus.trim() || typed || window.prompt('Plan focus')?.trim() || '';
    if (!planFocus) return;
    const usedComposerText = !focus.trim() && typed === planFocus;
    setStatus('Starting planner task...');
    if (usedComposerText) setInput('');
    try {
      const reply = await Submit(`/plan ${planFocus}`);
      setStatus(reply.message || 'Plan created.');
      setFocus('');
    } catch (error: any) {
      setStatus(String(error));
    }
  }

  async function compact() {
    setBusy(true);
    try {
      const reply = await CompactConversation(focus);
      setMessages(reply.history || []);
      setStatus(reply.message);
      setFocus('');
    } finally {
      setBusy(false);
    }
  }

  async function pause() {
    await PauseBot();
  }

  async function resume() {
    await Resume();
  }

  async function saveSession() {
    const label = window.prompt('Session name');
    if (label) {
      await SaveCurrentSession(label);
      setStatus('Session saved.');
    }
  }

  async function clearChat() {
    if (busy) return;
    if (messages.length > 0 && !window.confirm('Clear visible chat history? Saved sessions will not be deleted.')) return;
    setInput('');
    setAttachments([]);
    setMessages([]);
    try {
      const reply = await Command('/clear');
      setMessages([]);
      setStatus(reply.message || 'Cleared visible chat history.');
    } catch (error: any) {
      setStatus(String(error));
    }
  }

  return (
    <section
      className={`chat-grid ${dragging ? 'dragging-files' : ''}`}
      style={{'--wails-drop-target': 'drop'} as any}
      onDragEnter={(event) => {
        if (event.dataTransfer?.types?.includes('Files')) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
      }}
      onDrop={() => setDragging(false)}
    >
      {dragging && (
        <div className="drop-overlay">
          <Files size={30} />
          <strong>Drop files to attach</strong>
          <span>Images are sent directly; other files are attached for tool inspection.</span>
        </div>
      )}
      <div className="chat-main">
        <MessageList messages={messages} />
        {alsoOpen && (
          <AlsoDrawer
            items={alsoItems}
            active={alsoMode}
            onClose={() => setAlsoOpen(false)}
            onClear={() => setAlsoItems([])}
            onActivate={() => setAlsoMode(true)}
          />
        )}
        <div className="composer">
          <textarea
            value={input}
            onChange={(event) => updateInput(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={handleComposerKeyDown}
            placeholder={alsoMode ? 'Ask a side-channel /also question' : 'Message NullBot or type a slash command'}
          />
          {attachments.length > 0 && <AttachmentTray attachments={attachments} onRemove={removeAttachment} />}
          <div className="composer-actions">
            <button className={alsoMode ? 'seg active' : 'seg'} onClick={() => {
              const next = !alsoMode;
              setAlsoMode(next);
              if (next) setAlsoOpen(true);
            }}>
              <Layers size={16} />
              Also
            </button>
            <input value={focus} onChange={(event) => setFocus(event.target.value)} placeholder="Optional focus" />
            <button onClick={runAnalyze}>
              <Compass size={16} />
              Analyze
            </button>
            <button onClick={runPlan}>
              <ListChecks size={16} />
              Plan
            </button>
            <button onClick={compact}>
              <Archive size={16} />
              Compact
            </button>
            <button onClick={pause}>
              <PauseIcon size={16} />
              Pause
            </button>
            <button onClick={resume}>
              <Play size={16} />
              Resume
            </button>
            <button onClick={saveSession}>
              <Save size={16} />
              Save
            </button>
            <button onClick={clearChat} disabled={busy}>
              <Trash2 size={16} />
              Clear Chat
            </button>
            <button className="primary" onClick={send}>
              <Send size={16} />
              Send
            </button>
          </div>
        </div>
      </div>
      <LiveActivity activity={activity} />
    </section>
  );
}

function AlsoDrawer({items, active, onClose, onClear, onActivate}: {items: any[]; active: boolean; onClose: () => void; onClear: () => void; onActivate: () => void}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollTo({top: ref.current.scrollHeight});
  }, [items]);
  return (
    <aside className="also-drawer">
      <div className="also-head">
        <div>
          <h2>Also Observer</h2>
          <span>{active ? 'Side-channel mode is active' : 'Side-channel answers stay here'}</span>
        </div>
        <div className="row-actions">
          {!active && <button onClick={onActivate}><Layers size={16} /> Use Also</button>}
          <button onClick={onClear} disabled={items.length === 0}>Clear</button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="also-feed" ref={ref}>
        {items.length === 0 && <div className="empty-state small">Ask with Also to keep the answer separate from the main chat.</div>}
        {items.map((item) => (
          <article className={`also-card ${item.status}`} key={item.id}>
            <div className="also-question">
              <strong>Question</strong>
              <time>{formatTime(item.time)}</time>
              <p>{item.question}</p>
              {item.attachments?.length > 0 && <AttachmentTray attachments={item.attachments} readonly />}
            </div>
            <div className="also-answer">
              <strong>{item.status === 'working' ? 'Thinking' : item.status === 'error' ? 'Error' : 'Answer'}</strong>
              {item.status === 'working' && <span className="loading-inline"><span className="spinner" /> Working...</span>}
              {item.answer && <MarkdownContent>{item.answer}</MarkdownContent>}
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}

function AttachmentTray({attachments, onRemove, readonly = false}: {attachments: any[]; onRemove?: (path: string) => void; readonly?: boolean}) {
  return (
    <div className="attachment-tray">
      {attachments.map((attachment) => (
        <div className={`attachment-chip ${attachment.error ? 'error' : ''}`} key={attachment.path || attachment.original_path || attachment.name}>
          <Files size={15} />
          <div>
            <strong>{attachment.name || attachment.path}</strong>
            <span>{attachment.error || `${attachment.kind || 'file'}${attachment.size ? ` / ${formatBytes(attachment.size)}` : ''}`}</span>
          </div>
          {!readonly && onRemove && (
            <button onClick={() => onRemove(attachment.path)} title="Remove attachment">
              <CircleStop size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function MessageList({messages}: {messages: any[]}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollTo({top: ref.current.scrollHeight});
  }, [messages]);
  return (
    <div className="message-list" ref={ref}>
      {messages.length === 0 && <div className="empty-state">Start a conversation or use a sidebar control.</div>}
      {messages.map((message, index) => {
        const visible = messageWithVisibleAttachments(message);
        return (
          <article key={`${message.time}-${index}`} className={`message ${message.role || 'assistant'}`}>
            <div className="message-role">{message.role || 'assistant'}</div>
            {message.pending && !message.content ? (
              <span className="loading-inline"><span className="spinner" /> Working...</span>
            ) : (
              <>
                <MarkdownContent>{visible.content || ''}</MarkdownContent>
                {visible.attachments.length > 0 && <AttachmentTray attachments={visible.attachments} readonly />}
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}

function LiveActivity({activity}: {activity: any[]}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const items = buildActivityTimeline(activity).slice(-80);
  const running = items.filter((item) => item.state === 'running').length;
  useEffect(() => {
    ref.current?.scrollTo({top: ref.current.scrollHeight});
  }, [items.length]);
  return (
    <aside className="activity-pane">
      <div className="pane-title activity-title">
        <div>
          <Activity size={18} />
          <span>Live Activity</span>
        </div>
        <small>{running ? `${running} running` : `${items.length} recent`}</small>
      </div>
      <div className="activity-feed" ref={ref}>
        {items.length === 0 && <div className="empty-state small">No activity yet.</div>}
        {items.map((item) => <ActivityCard key={item.id} item={item} />)}
      </div>
    </aside>
  );
}

function ActivityCard({item}: {item: any}) {
  const Icon = activityIcon(item);
  return (
    <article className={`activity-card ${item.kind} ${item.state}`}>
      <div className="activity-icon">
        {item.state === 'running' ? <span className="spinner" /> : <Icon size={16} />}
      </div>
      <div className="activity-body">
        <div className="activity-head">
          <strong>{item.title}</strong>
          <time>{formatTime(item.time)}</time>
        </div>
        <p>{item.subtitle}</p>
        {item.chips.length > 0 && (
          <div className="activity-chips">
            {item.chips.map((chip: string) => <span key={chip}>{chip}</span>)}
          </div>
        )}
        {item.raw && (
          <details className="activity-raw">
            <summary>details</summary>
            <pre>{item.raw}</pre>
          </details>
        )}
      </div>
    </article>
  );
}

function AgentsView({ui, refreshState}: {ui: any; refreshState: () => void}) {
  const [tab, setTab] = useState('combined');
  const [tasks, setTasks] = useState<any[]>(ui.tasks || []);
  const [thoughts, setThoughts] = useState<any[]>(ui.thoughts || []);
  const maxSubagents = Number(ui.config?.agent?.max_subagents || 0);
  const tabs = ['combined', 'manager', ...Array.from({length: maxSubagents}, (_, index) => `subagent-${index + 1}`)];

  useEffect(() => {
    const id = window.setInterval(async () => {
      setTasks(await Tasks());
      setThoughts(await Thoughts());
    }, 1500);
    return () => window.clearInterval(id);
  }, []);

  const visible = tasks.filter((task) => {
    if (tab === 'combined') return true;
    if (tab === 'manager') return task.role !== 'subagent';
    const subagents = tasks.filter((item) => item.role === 'subagent');
    const idx = Number(tab.split('-')[1]) - 1;
    return subagents[idx]?.id === task.id;
  });
  const visibleIDs = new Set(visible.map((task) => task.id));
  const visibleThoughts = thoughts.filter((thought) => visibleIDs.has(thought.task_id));
  const totals = visible.reduce((sum, task) => {
    sum.running += task.status === 'running' ? 1 : 0;
    sum.toolCalls += task.tool_calls?.length || 0;
    sum.tokens += task.tokens?.total || 0;
    sum.reasoning += task.tokens?.reasoning_output || 0;
    return sum;
  }, {running: 0, toolCalls: 0, tokens: 0, reasoning: 0});

  return (
    <section className="view-column">
      <StickyTabs tabs={tabs} active={tab} onSelect={setTab} labelFor={(value: string) => labelAgentTab(value)} />
      <div className="dashboard-row">
        <Stat title="Running" value={String(totals.running)} />
        <Stat title="Tool Calls" value={String(totals.toolCalls)} />
        <Stat title="Tokens" value={String(totals.tokens)} />
        <Stat title="Reasoning" value={String(totals.reasoning)} />
      </div>
      <div className="agent-layout">
        <div className="task-list">
          {visible.length === 0 && <div className="empty-state small">No tasks for this view yet.</div>}
          {visible.map((task) => (
            <TaskCard key={task.id} task={task} onCancel={async () => {
              await CancelTask(task.id);
              setTasks(await Tasks());
              refreshState();
            }} />
          ))}
        </div>
        <div className="thought-panel">
          <div className="panel-copy">
            <h2>Reasoning Summaries</h2>
            <p>Provider-private reasoning is not exposed. This view shows available summaries, task progress, tool intent, token use, and errors.</p>
          </div>
          {visibleThoughts.length === 0 && <div className="empty-state small">No progress notes recorded for this view yet.</div>}
          {visibleThoughts.map((thought) => (
            <div className="thought" key={thought.task_id}>
              <div className="thought-head">
                <div>
                  <strong>{thought.agent}</strong>
                  <span>{thought.role} / {thought.status}</span>
                </div>
                <time>{formatDateTime(thought.updated_at)}</time>
              </div>
              <p>{thought.current || thought.prompt}</p>
              {(thought.notes || []).slice(-8).map((note: string, index: number) => <small key={index}>{friendlyThoughtNote(note)}</small>)}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FilesView({initial, refreshState}: {initial: any; refreshState: () => void}) {
  const [browser, setBrowser] = useState<any>(initial);
  const [path, setPath] = useState(initial?.current || '');
  const [preview, setPreview] = useState<any>(null);
  const [rawMarkdown, setRawMarkdown] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [contextMenu, setContextMenu] = useState<any>(null);
  const [filter, setFilter] = useState('');
  const [pathSuggestions, setPathSuggestions] = useState<any[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
    };
  }, []);

  async function go(next = path) {
    setPathSuggestions([]);
    setFilter('');
    const result = await ListFiles(next);
    setBrowser(result);
    setPath(result.current);
  }

  async function pick(entry: any) {
    if (entry.is_dir) {
      await go(entry.path);
      return;
    }
    const result = await PreviewFile(entry.path);
    setPreview(result);
    setDraft(result.content || '');
    setEditing(false);
  }

  async function refreshBrowser(next: any) {
    setBrowser(next);
    setPath(next.current);
    if (preview?.path && !(next.entries || []).some((entry: any) => entry.path === preview.path)) {
      setPreview(null);
      setEditing(false);
    }
  }

  async function setWorkspace() {
    const result = await SetWorkingDirectory(browser.current);
    setBrowser(result);
    setPath(result.current);
    refreshState();
  }

  async function saveEdit() {
    const result = await SaveFile({path: preview.path, content: draft});
    setPreview(result);
    setEditing(false);
  }

  function showMenu(event: any, entry?: any) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({x: event.clientX, y: event.clientY, entry});
  }

  async function createFile(kind: 'file' | 'directory') {
    const name = window.prompt(kind === 'directory' ? 'New directory name' : 'New file name');
    if (!name) return;
    const result = kind === 'directory'
      ? await CreateDirectory({dir: browser.current, name})
      : await CreateFile({dir: browser.current, name});
    await refreshBrowser(result);
  }

  async function renameEntry(entry: any) {
    const nextName = window.prompt('Rename to', entry.name);
    if (!nextName || nextName === entry.name) return;
    const result = await RenamePath({path: entry.path, new_name: nextName});
    await refreshBrowser(result);
    if (preview?.path === entry.path) setPreview(null);
  }

  async function deleteEntry(entry: any) {
    const label = entry.is_dir ? 'directory and its contents' : 'file';
    if (!window.confirm(`Delete ${label} "${entry.name}"? This cannot be undone.`)) return;
    const result = await DeletePath(entry.path);
    await refreshBrowser(result);
    if (preview?.path === entry.path) setPreview(null);
  }

  function updatePath(value: string) {
    setPath(value);
    setPathSuggestions([]);
    setSelectedSuggestion(0);
  }

  async function completeCurrentPath() {
    if (pathSuggestions.length > 0) {
      const next = (selectedSuggestion + 1) % pathSuggestions.length;
      setSelectedSuggestion(next);
      setPath(pathSuggestions[next].path);
      return;
    }
    const suggestions = await CompletePath(path, browser.current);
    setPathSuggestions(suggestions || []);
    setSelectedSuggestion(0);
    if (!suggestions?.length) return;
    if (suggestions.length === 1) {
      setPath(suggestions[0].path);
      setPathSuggestions([]);
      return;
    }
    const shared = commonPrefix(suggestions.map((suggestion: any) => suggestion.path));
    if (shared.length > path.length) setPath(shared);
  }

  function handlePathKeyDown(event: any) {
    if (event.key === 'Tab') {
      event.preventDefault();
      completeCurrentPath();
      return;
    }
    if (pathSuggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedSuggestion((current) => (current + 1) % pathSuggestions.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedSuggestion((current) => (current - 1 + pathSuggestions.length) % pathSuggestions.length);
      return;
    }
    if (event.key === 'Enter') {
      const suggestion = pathSuggestions[selectedSuggestion];
      if (suggestion) {
        event.preventDefault();
        setPath(suggestion.path);
        setPathSuggestions([]);
      }
      return;
    }
    if (event.key === 'Escape') {
      setPathSuggestions([]);
    }
  }

  const filteredEntries = (browser.entries || []).filter((entry: any) => {
    const query = filter.trim().toLowerCase();
    if (!query) return true;
    return [entry.name, entry.rel_path, entry.kind, entry.extension]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  return (
    <section className="files-view">
      <div className="file-toolbar">
        <button onClick={() => go(browser.workspace)} title="Home">
          <Home size={16} />
          Home
        </button>
        <button onClick={() => go(browser.parent)} title="Up">
          <ChevronUp size={16} />
          Up
        </button>
        <button onClick={setWorkspace} title="Set working directory">
          <Check size={16} />
          Set Working Directory
        </button>
        <div className="path-complete">
          <input
            value={path}
            onChange={(event) => updatePath(event.target.value)}
            onKeyDown={handlePathKeyDown}
            onBlur={() => window.setTimeout(() => setPathSuggestions([]), 120)}
            placeholder="Directory path"
          />
          {pathSuggestions.length > 0 && (
            <div className="path-suggestions">
              {pathSuggestions.map((suggestion: any, index: number) => (
                <button
                  key={suggestion.path}
                  className={index === selectedSuggestion ? 'active' : ''}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setPath(suggestion.path);
                    setPathSuggestions([]);
                  }}
                >
                  <span>{suggestion.is_dir ? 'dir' : 'file'}</span>
                  <strong>{suggestion.name}</strong>
                  <small>{suggestion.path}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="primary" onClick={() => go(path)}>
          <Compass size={16} />
          Go
        </button>
      </div>
      <div className="file-split">
        <div className="file-list" onContextMenu={(event) => showMenu(event)}>
          <div className="file-filter" onContextMenu={(event) => event.stopPropagation()}>
            <Search size={16} />
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search current directory" />
            {filter && (
              <button title="Clear search" onClick={() => setFilter('')}>
                <CircleStop size={14} />
              </button>
            )}
          </div>
          {filteredEntries.length === 0 && <div className="empty-state small">No files match this search.</div>}
          {filteredEntries.map((entry: any) => (
            <div
              key={entry.path}
              className="file-row"
              role="button"
              tabIndex={0}
              onClick={() => pick(entry)}
              onContextMenu={(event) => showMenu(event, entry)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') pick(entry);
              }}
            >
              <span>{entry.is_dir ? 'dir' : entry.kind}</span>
              <strong>{entry.name}</strong>
              <small>{entry.is_dir ? '' : formatBytes(entry.size)}</small>
              <button className="inline-danger" title="Delete" onClick={(event) => {
                event.stopPropagation();
                deleteEntry(entry);
              }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {contextMenu && (
            <FileContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              entry={contextMenu.entry}
              onNewFile={() => createFile('file')}
              onNewDirectory={() => createFile('directory')}
              onRename={() => contextMenu.entry && renameEntry(contextMenu.entry)}
              onDelete={() => contextMenu.entry && deleteEntry(contextMenu.entry)}
            />
          )}
        </div>
        <div className="preview">
          {!preview && <div className="empty-state">Select a file for preview.</div>}
          {preview && (
            <>
              <div className="preview-header">
                <div>
                  <h2>{preview.name}</h2>
                  <span>{preview.kind} / {formatBytes(preview.size)}</span>
                </div>
                {preview.kind === 'markdown' && (
                  <label className="checkline">
                    <input type="checkbox" checked={rawMarkdown} onChange={(event) => setRawMarkdown(event.target.checked)} />
                    Raw
                  </label>
                )}
                {preview.editable && (
                  <button onClick={() => setEditing(!editing)}>
                    <FilePenLine size={16} />
                    Edit
                  </button>
                )}
              </div>
              {editing ? (
                <div className="editor-pane">
                  <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
                  <button className="primary" onClick={saveEdit}>
                    <Save size={16} />
                    Save File
                  </button>
                </div>
              ) : (
                <FilePreview preview={preview} rawMarkdown={rawMarkdown} />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function FilePreview({preview, rawMarkdown}: {preview: any; rawMarkdown: boolean}) {
  if (preview.error) return <div className="empty-state">{preview.error}</div>;
  if (preview.kind === 'image') return <img className="image-preview" src={preview.data_url} alt={preview.name} />;
  if (preview.kind === 'pdf') return <iframe className="pdf-preview" src={preview.data_url} title={preview.name} />;
  if (preview.kind === 'xlsx' || preview.kind === 'csv') return <TablePreview headers={preview.headers || []} rows={preview.rows || []} />;
  if (preview.kind === 'markdown' && !rawMarkdown) {
    return <div className="markdown-body"><MarkdownContent>{preview.content || ''}</MarkdownContent></div>;
  }
  return <CopyBlock text={preview.content || 'No text preview.'}><pre className="code-preview">{preview.content || 'No text preview.'}</pre></CopyBlock>;
}

function FileContextMenu({x, y, entry, onNewFile, onNewDirectory, onRename, onDelete}: any) {
  return (
    <div className="context-menu" style={{left: x, top: y}} onClick={(event) => event.stopPropagation()}>
      <button onClick={onNewFile}><FilePlus2 size={15} /> New File</button>
      <button onClick={onNewDirectory}><FolderPlus size={15} /> New Directory</button>
      {entry && <button onClick={onRename}><FilePenLine size={15} /> Rename</button>}
      {entry && <button className="danger" onClick={onDelete}><Trash2 size={15} /> Delete</button>}
    </div>
  );
}

function ModelsView({ui, refreshState}: {ui: any; refreshState: () => void}) {
  const [tab, setTab] = useState('models');
  const [target, setTarget] = useState('manager');
  const [groups, setGroups] = useState<any[]>(ui.models || []);
  const [provider, setProvider] = useState(ui.config?.model?.provider || 'openai');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    Models().then(setGroups).finally(() => setLoading(false));
  }, []);

  async function choose(provider: string, model: string) {
    setLoading(true);
    await SetModel(provider, model, target);
    refreshState();
    setLoading(false);
  }

  const providers = groups.map((group) => group.provider);
  const selected = groups.find((group) => group.provider === provider) || groups[0];
  const models = (selected?.models || []).filter((model: any) => {
    const hay = `${model.name || ''} ${model.id || ''} ${model.description || ''}`.toLowerCase();
    return hay.includes(query.toLowerCase());
  });
  const currentManager = `${ui.config?.model?.provider}/${ui.config?.model?.model}`;
  const currentSubagent = `${ui.config?.subagent_model?.provider}/${ui.config?.subagent_model?.model}`;

  return (
    <section className="view-column">
      <StickyTabs tabs={['models', 'accounts']} active={tab} onSelect={setTab} labelFor={(value: string) => value === 'models' ? 'Models' : 'Accounts'} />
      {tab === 'accounts' ? (
        <AccountsPanel refreshState={refreshState} />
      ) : (
        <>
          <div className="model-toolbar">
            <Segmented value={target} values={['manager', 'subagent', 'both']} onChange={setTarget} />
            <div className="provider-tabs">
              {providers.map((item) => <button key={item} className={item === provider ? 'active' : ''} onClick={() => setProvider(item)}>{item}</button>)}
            </div>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models" />
          </div>
          <div className="dashboard-row">
            <Stat title="Manager" value={currentManager} />
            <Stat title="Subagent" value={currentSubagent} />
            <Stat title="Apply To" value={target} />
          </div>
          {loading && <div className="loading-inline"><span className="spinner" /> Loading models...</div>}
          {selected?.error && <p className="warn">{selected.error}</p>}
          <div className="model-list">
            {models.map((model: any) => {
              const key = `${selected.provider}/${model.id}`;
              const active = key === currentManager || key === currentSubagent;
              return (
                <button key={key} className={active ? 'selected' : ''} onClick={() => choose(selected.provider, model.id)}>
                  <div>
                    <strong>{model.name || model.id}</strong>
                    <span>{model.id}</span>
                  </div>
                  <p>{model.description}</p>
                  <small>{model.reasoning ? 'reasoning' : 'standard'}{model.responses ? ' / responses' : ''}</small>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function AccountsPanel({refreshState, setStatus}: {refreshState: () => void; setStatus?: (value: string) => void}) {
  const [state, setState] = useState<any>(null);
  const [keys, setKeys] = useState<any>({openai: '', anthropic: '', openrouter: '', google: '', brave: '', otherProvider: '', otherKey: ''});
  const [working, setWorking] = useState('');
  const [notice, setNotice] = useState('');
  const [codexFlow, setCodexFlow] = useState<any>(null);

  useEffect(() => {
    AccountStatus().then(setState).catch((error: any) => setNotice(String(error)));
  }, []);

  function updateKey(provider: string, value: string) {
    setKeys((current: any) => ({...current, [provider]: value}));
  }

  async function save(provider?: string) {
    setWorking(provider || 'accounts');
    const other: any = {};
    if ((!provider || provider === 'brave') && keys.brave.trim()) {
      other.brave = keys.brave.trim();
    }
    if (keys.otherProvider.trim() && keys.otherKey.trim()) {
      other[keys.otherProvider.trim().toLowerCase()] = keys.otherKey.trim();
    }
    try {
      const next = await SaveAccountKeys({
        openai: provider && provider !== 'openai' ? '' : keys.openai,
        anthropic: provider && provider !== 'anthropic' ? '' : keys.anthropic,
        openrouter: provider && provider !== 'openrouter' ? '' : keys.openrouter,
        google: provider && provider !== 'google' ? '' : keys.google,
        other: provider && !['other', 'brave'].includes(provider) ? {} : other,
      });
      setState(next);
      setKeys({openai: '', anthropic: '', openrouter: '', google: '', brave: '', otherProvider: '', otherKey: ''});
      setNotice('Credentials saved.');
      setStatus?.('Credentials saved.');
      refreshState();
    } catch (error: any) {
      setNotice(String(error));
      setStatus?.(String(error));
    } finally {
      setWorking('');
    }
  }

  async function loginCodex() {
    setWorking('codex');
    setCodexFlow(null);
    try {
      const flow = await BeginCodexLogin();
      setCodexFlow(flow);
      setNotice(`Browser opened for Codex login. Enter code ${flow.user_code}.`);
      setStatus?.('Waiting for Codex login approval.');
      let interval = Math.max(Number(flow.interval_seconds || 5), 3);
      const expiresAt = Date.parse(flow.expires_at || '') || Date.now() + Number(flow.expires_in || 900) * 1000;
      while (Date.now() < expiresAt) {
        await sleep(interval * 1000);
        const result = await PollCodexLogin(flow);
        if (result.account_state) {
          setState(result.account_state);
        }
        if (result.status === 'authorized') {
          setNotice('Codex subscription login saved. NullBot can use subscription-backed models now.');
          setStatus?.('Codex signed in.');
          setCodexFlow(null);
          refreshState();
          return;
        }
        if (result.status === 'slow_down') {
          interval = Math.max(Number(result.interval_seconds || interval + 2), interval + 1);
          setNotice(result.message || 'Still waiting for Codex login approval.');
          continue;
        }
        if (['expired', 'denied'].includes(result.status)) {
          setNotice(result.message || `Codex login ${result.status}.`);
          setStatus?.(result.message || `Codex login ${result.status}.`);
          setCodexFlow(null);
          return;
        }
        setNotice('Waiting for Codex login approval...');
      }
      setNotice('Codex login timed out. Start sign-in again when ready.');
      setStatus?.('Codex login timed out.');
    } catch (error: any) {
      setNotice(`Codex login could not be started: ${String(error)}`);
      setStatus?.(String(error));
    } finally {
      setWorking('');
    }
  }

  async function refreshAccounts() {
    setWorking('refresh');
    try {
      setState(await AccountStatus());
      setNotice('Account status refreshed.');
    } finally {
      setWorking('');
    }
  }

  const accounts = state?.accounts || [];
  const byID = Object.fromEntries(accounts.map((account: any) => [account.id, account]));
  const keyAccounts = ['openai', 'anthropic', 'openrouter', 'google', 'brave'];
  const extraAccounts = accounts.filter((account: any) => !['codex', ...keyAccounts].includes(account.id));

  return (
    <div className="accounts-view">
      <div className="accounts-toolbar">
        <div>
          <h2>Accounts</h2>
          <p>Codex sign-in can power OpenAI/Codex model selections through your ChatGPT subscription. API keys remain available for fallback billing and other providers.</p>
        </div>
        <button onClick={refreshAccounts} disabled={working === 'refresh'}>
          {working === 'refresh' ? <span className="spinner" /> : <RefreshCw size={16} />}
          Refresh
        </button>
      </div>
      {notice && <p className="warn">{notice}</p>}
      <div className="account-grid">
        <article className="account-card">
          <AccountHead account={byID.codex} fallback="Codex subscription" />
          <p>{byID.codex?.detail || 'Sign in with ChatGPT to let NullBot route Codex/OpenAI selections through subscription auth.'}</p>
          <div className="account-path">{state?.codex_auth_path || ''}</div>
          {codexFlow && (
            <div className="device-login-box">
              <span>Enter this code in the browser</span>
              <strong>{codexFlow.user_code}</strong>
              <button onClick={() => navigator.clipboard?.writeText(codexFlow.user_code)}>Copy Code</button>
              <small>{codexFlow.verification_uri}</small>
            </div>
          )}
          <button onClick={loginCodex} disabled={!byID.codex?.can_login || working === 'codex'}>
            {working === 'codex' ? <span className="spinner" /> : <Bot size={16} />}
            Sign In With ChatGPT
          </button>
        </article>
        {keyAccounts.map((provider) => (
          <article className="account-card" key={provider}>
            <AccountHead account={byID[provider]} fallback={provider} />
            <p>{byID[provider]?.detail}</p>
            <input type="password" value={keys[provider] || ''} onChange={(event) => updateKey(provider, event.target.value)} placeholder={`New ${byID[provider]?.label || provider} key`} />
            <button className="primary" onClick={() => save(provider)} disabled={working === provider || !keys[provider]?.trim()}>
              {working === provider ? <span className="spinner dark" /> : <Save size={16} />}
              Save Key
            </button>
          </article>
        ))}
        <article className="account-card">
          <AccountHead account={byID.other} fallback="Other provider" />
          <p>Store a named provider key for future integrations or MCP servers. Direct chat support still needs provider runtime wiring.</p>
          <input value={keys.otherProvider} onChange={(event) => updateKey('otherProvider', event.target.value)} placeholder="Provider id, e.g. perplexity" />
          <input type="password" value={keys.otherKey} onChange={(event) => updateKey('otherKey', event.target.value)} placeholder="Provider API key" />
          <button className="primary" onClick={() => save('other')} disabled={working === 'other' || !keys.otherProvider.trim() || !keys.otherKey.trim()}>
            {working === 'other' ? <span className="spinner dark" /> : <Save size={16} />}
            Save Provider Key
          </button>
        </article>
        {extraAccounts.map((account: any) => (
          <article className="account-card compact" key={account.id}>
            <AccountHead account={account} fallback={account.id} />
            <p>{account.detail}</p>
          </article>
        ))}
      </div>
      {state?.keys_path && <div className="account-path">Key file: {state.keys_path}</div>}
    </div>
  );
}

function AccountHead({account, fallback}: {account: any; fallback: string}) {
  return (
    <div className="account-head">
      <div>
        <strong>{account?.label || fallback}</strong>
        <span>{account?.kind || 'account'}</span>
      </div>
      <small className={`account-status ${statusClass(account?.status || 'not-set')}`}>{account?.status || 'not set'}</small>
      {account?.masked && <em>{account.masked}</em>}
    </div>
  );
}

function SettingsView({ui, refreshState, setStatus}: {ui: any; refreshState: () => void; setStatus: (value: string) => void}) {
  const [tab, setTab] = useState('settings');
  const [config, setConfig] = useState<any>(structuredClone(ui.config));
  const [keys, setKeys] = useState({openai: '', anthropic: '', openrouter: '', google: '', brave: ''});
  const [saving, setSaving] = useState(false);

  function update(path: string, value: any) {
    setConfig((current: any) => {
      const next = structuredClone(current);
      const parts = path.split('.');
      let cursor = next;
      for (let i = 0; i < parts.length - 1; i++) {
        cursor[parts[i]] = cursor[parts[i]] ?? {};
        cursor = cursor[parts[i]];
      }
      cursor[parts[parts.length - 1]] = value;
      return next;
    });
  }

  function updatePermission(key: string, value: string) {
    setConfig((current: any) => ({
      ...current,
      permission_defaults: {...(current.permission_defaults || {}), [key]: value},
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const otherKeys: Record<string, string> | undefined = keys.brave.trim() ? {brave: keys.brave.trim()} : undefined;
      const apiKeys = {
        openai: keys.openai,
        anthropic: keys.anthropic,
        openrouter: keys.openrouter,
        google: keys.google,
        other: otherKeys,
      };
      await SaveConfig(config, apiKeys);
      setStatus('Settings saved.');
      refreshState();
    } catch (error: any) {
      setStatus(String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="view-column">
      <StickyTabs tabs={['settings', 'accounts']} active={tab} onSelect={setTab} labelFor={(value: string) => value === 'settings' ? 'Settings' : 'Accounts'} />
      {tab === 'accounts' ? (
        <AccountsPanel refreshState={refreshState} setStatus={setStatus} />
      ) : (
        <div className="settings-form embedded">
          <div className="settings-panel">
        <h2>Identity</h2>
        <Field label="Brand prefix" value={config.brand_prefix || ''} onChange={(value) => update('brand_prefix', value)} />
        <Field label="Bot name" value={config.bot_name || ''} onChange={(value) => update('bot_name', value)} />
        <Field label="Tagline" value={config.tagline || ''} onChange={(value) => update('tagline', value)} />
        <Field label="App directory" value={config.app_dir || ''} onChange={(value) => update('app_dir', value)} />
        <Field label="Workspace" value={config.workspace_dir || ''} onChange={(value) => update('workspace_dir', value)} />
      </div>
      <div className="settings-panel">
        <h2>Models</h2>
        <ModelConfigFields
          title="Manager"
          value={config.model || {}}
          groups={ui.models || []}
          onChange={(field, value) => update(`model.${field}`, value)}
        />
        <NumberField label="Manager max tokens" value={config.model?.max_tokens || 0} onChange={(value) => update('model.max_tokens', value)} />
        <ModelConfigFields
          title="Subagent"
          value={config.subagent_model || {}}
          groups={ui.models || []}
          onChange={(field, value) => update(`subagent_model.${field}`, value)}
        />
      </div>
      <div className="settings-panel">
        <h2>Agent</h2>
        <NumberField label="Max iterations" value={config.agent?.max_iterations || 0} onChange={(value) => update('agent.max_iterations', value)} />
        <NumberField label="Max subagents" value={config.agent?.max_subagents || 0} onChange={(value) => update('agent.max_subagents', value)} />
        <label className="checkline block"><input type="checkbox" checked={!!config.agent?.use_responses} onChange={(e) => update('agent.use_responses', e.target.checked)} /> Use OpenAI Responses API</label>
        <Field label="Editor command" value={config.editor?.command || ''} onChange={(value) => update('editor.command', value)} />
        <NumberField label="History recent limit" value={config.history_recent_limit || 0} onChange={(value) => update('history_recent_limit', value)} />
        <NumberField label="Artifact recent limit" value={config.artifact_recent_limit || 0} onChange={(value) => update('artifact_recent_limit', value)} />
      </div>
      <div className="settings-panel">
        <h2>Compaction</h2>
        <label className="checkline block"><input type="checkbox" checked={!!config.compaction?.enabled} onChange={(e) => update('compaction.enabled', e.target.checked)} /> Enabled</label>
        <NumberField label="Context token limit" value={config.compaction?.approx_token_limit || 0} onChange={(value) => update('compaction.approx_token_limit', value)} />
        <NumberField label="Compact threshold ratio" value={config.compaction?.threshold_ratio || 0.75} onChange={(value) => update('compaction.threshold_ratio', value)} />
        <NumberField label="Message count limit" value={config.compaction?.message_count_limit || 0} onChange={(value) => update('compaction.message_count_limit', value)} />
        <NumberField label="Keep last messages" value={config.compaction?.keep_last_messages || 0} onChange={(value) => update('compaction.keep_last_messages', value)} />
        <NumberField label="Tool result safety chars" value={config.compaction?.tool_result_char_limit || 0} onChange={(value) => update('compaction.tool_result_char_limit', value)} />
        <Field label="Default focus" value={config.compaction?.default_focus || ''} onChange={(value) => update('compaction.default_focus', value)} />
      </div>
      <div className="settings-panel">
        <h2>API Keys</h2>
        <input placeholder={`OpenAI ${ui.keys?.openai || ''}`} value={keys.openai} onChange={(e) => setKeys({...keys, openai: e.target.value})} />
        <input placeholder={`Anthropic ${ui.keys?.anthropic || ''}`} value={keys.anthropic} onChange={(e) => setKeys({...keys, anthropic: e.target.value})} />
        <input placeholder={`OpenRouter ${ui.keys?.openrouter || ''}`} value={keys.openrouter} onChange={(e) => setKeys({...keys, openrouter: e.target.value})} />
        <input placeholder={`Google ${ui.keys?.google || ''}`} value={keys.google} onChange={(e) => setKeys({...keys, google: e.target.value})} />
        <input placeholder={`Brave Search ${ui.keys?.other?.brave || ''}`} value={keys.brave} onChange={(e) => setKeys({...keys, brave: e.target.value})} />
      </div>
      <div className="settings-panel">
        <h2>Skills & Permissions</h2>
        <label>Skill directories</label>
        <textarea className="short-textarea" value={(config.skill_dirs || []).join('\n')} onChange={(e) => update('skill_dirs', e.target.value.split('\n').map((v) => v.trim()).filter(Boolean))} />
        {['coding', 'shell', 'network'].map((key) => (
          <label className="field" key={key}>
            <span>{key}</span>
            <select value={config.permission_defaults?.[key] || 'ask'} onChange={(e) => updatePermission(key, e.target.value)}>
              <option value="ask">ask</option>
              <option value="deny">deny</option>
              <option value="allow">allow</option>
            </select>
          </label>
        ))}
        <button className="primary" onClick={save} disabled={saving}>
          {saving ? <span className="spinner dark" /> : <Save size={16} />}
          Save Settings
        </button>
      </div>
        </div>
      )}
    </section>
  );
}

function MarketplaceView({initial, refreshState}: {initial: any; refreshState: () => void}) {
  const [market, setMarket] = useState<any>(initial);
  const [small, setSmall] = useState(false);
  const [enable, setEnable] = useState(true);

  async function refresh() {
    setMarket(await Marketplace(true));
  }

  async function install(id: string) {
    setMarket(await InstallMarketPackage(id, small, enable));
    refreshState();
  }

  return (
    <section className="view-column">
      <div className="toolbar">
        <button onClick={refresh}>
          <RefreshCw size={16} />
          Refresh
        </button>
        <label className="checkline"><input type="checkbox" checked={small} onChange={(e) => setSmall(e.target.checked)} /> Small binary</label>
        <label className="checkline"><input type="checkbox" checked={enable} onChange={(e) => setEnable(e.target.checked)} /> Enable after install</label>
      </div>
      <div className="market-grid">
        {(market?.packages || []).map((pkg: any) => (
          <article className="package-card" key={pkg.id}>
            <div>
              <strong>{pkg.name}</strong>
              <span>{pkg.kind} / {pkg.status}</span>
            </div>
            <p>{pkg.description}</p>
            <small>{(pkg.permissions || []).join(', ')}</small>
            <button onClick={() => install(pkg.id)}>
              <PackagePlus size={16} />
              {pkg.installed ? 'Reinstall' : 'Install'}
            </button>
          </article>
        ))}
      </div>
      <h2>Local Server Folders</h2>
      <div className="market-grid compact">
        {(market?.local_servers || []).map((server: any) => (
          <article className="package-card" key={server.id}>
            <strong>{server.name}</strong>
            <p>{server.description}</p>
            <small>{server.path}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function SkillsView() {
  const [skills, setSkills] = useState<any[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('---\nname: new-skill\ndescription: Use this skill when...\n---\n\n# New Skill\n\n## Instructions\n\n- ');

  useEffect(() => {
    Skills().then(setSkills);
  }, []);

  async function open(skill: any) {
    setPreview(await ReadSkill(skill.path));
  }

  async function save() {
    await SaveSkill({name, content, overwrite: true});
    setSkills(await Skills());
  }

  return (
    <section className="two-column">
      <div className="list-panel">
        {skills.map((skill) => (
          <button key={skill.path} onClick={() => open(skill)}>
            <strong>{skill.name}</strong>
            <span>{skill.description}</span>
          </button>
        ))}
      </div>
      <div className="preview">
        {preview ? <div className="markdown-body"><MarkdownContent>{preview.content || ''}</MarkdownContent></div> : <div className="empty-state">Select a skill.</div>}
        <div className="skill-writer">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New skill name" />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} />
          <button className="primary" onClick={save}><Save size={16} /> Save Skill</button>
        </div>
      </div>
    </section>
  );
}

function MCPView({ui, refreshState}: {ui: any; refreshState: () => void}) {
  const [input, setInput] = useState<any>({transport: 'stdio', enabled: true, argsText: ''});
  const servers = ui.config?.enabled_mcp_servers || {};
  const serverIDs = Object.keys(servers);
  const [selectedID, setSelectedID] = useState(serverIDs[0] || '');
  const [tools, setTools] = useState<any[]>([]);
  const [toolError, setToolError] = useState('');
  const [loadingTools, setLoadingTools] = useState(false);

  useEffect(() => {
    if (!selectedID && serverIDs.length > 0) setSelectedID(serverIDs[0]);
    if (selectedID && !servers[selectedID]) setSelectedID(serverIDs[0] || '');
  }, [ui.config?.enabled_mcp_servers]);

  useEffect(() => {
    if (selectedID) {
      inspect(selectedID);
    } else {
      setTools([]);
    }
  }, [selectedID]);

  async function add() {
    await AddMCPServer({
      id: input.id,
      name: input.name,
      transport: input.transport,
      command: input.command,
      args: splitArgs(input.argsText || ''),
      env: {},
      enabled: input.enabled,
    });
    setInput({transport: 'stdio', enabled: true, argsText: ''});
    refreshState();
  }

  async function inspect(id: string) {
    setSelectedID(id);
    setLoadingTools(true);
    setToolError('');
    try {
      setTools(await DiscoverMCPTools(id));
    } catch (error: any) {
      setTools([]);
      setToolError(String(error));
    } finally {
      setLoadingTools(false);
    }
  }

  async function toggle(id: string, action: string) {
    await ToggleMCPServer(id, action);
    refreshState();
  }

  const selectedServer = selectedID ? servers[selectedID] : null;

  return (
    <section className="mcp-layout">
      <div className="settings-panel">
        <h2>Add MCP Server</h2>
        <input placeholder="Server id" value={input.id || ''} onChange={(e) => setInput({...input, id: e.target.value})} />
        <input placeholder="Display name" value={input.name || ''} onChange={(e) => setInput({...input, name: e.target.value})} />
        <select value={input.transport} onChange={(e) => setInput({...input, transport: e.target.value})}>
          <option value="stdio">stdio</option>
          <option value="python-fastmcp">python fastmcp file</option>
          <option value="http">http</option>
          <option value="streamable-http">streamable http</option>
          <option value="sse">sse</option>
        </select>
        <input placeholder="Command, Python file, or endpoint URL" value={input.command || ''} onChange={(e) => setInput({...input, command: e.target.value})} />
        <input placeholder="Args" value={input.argsText || ''} onChange={(e) => setInput({...input, argsText: e.target.value})} />
        <label className="checkline"><input type="checkbox" checked={input.enabled} onChange={(e) => setInput({...input, enabled: e.target.checked})} /> Enabled</label>
        <button className="primary" onClick={add}><PackagePlus size={16} /> Add Server</button>
      </div>
      <div className="settings-panel">
        <h2>Configured Servers</h2>
        {Object.entries(servers).map(([id, server]: [string, any]) => (
          <div className={selectedID === id ? 'server-row selected' : 'server-row'} key={id} onClick={() => inspect(id)} role="button" tabIndex={0}>
            <strong>{id}</strong>
            <span>{server.transport} / {server.enabled ? 'enabled' : 'disabled'}</span>
            <small>{server.command} {(server.args || []).join(' ')}</small>
            <div className="row-actions">
              <button onClick={async (event) => { event.stopPropagation(); await toggle(id, server.enabled ? 'disable' : 'enable'); }}>
                {server.enabled ? <CircleStop size={16} /> : <Play size={16} />}
                {server.enabled ? 'Disable' : 'Enable'}
              </button>
              <button onClick={async (event) => { event.stopPropagation(); await toggle(id, 'remove'); }}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="settings-panel server-tools">
        <div className="preview-header">
          <div>
            <h2>{selectedServer?.name || selectedID || 'Server Tools'}</h2>
            <span>{selectedServer ? `${selectedServer.transport} transport` : 'Select a server'}</span>
          </div>
          <button disabled={!selectedID || loadingTools} onClick={() => selectedID && inspect(selectedID)}>
            {loadingTools ? <span className="spinner" /> : <RefreshCw size={16} />}
            Refresh Tools
          </button>
        </div>
        {loadingTools && <div className="loading-inline"><span className="spinner" /> Discovering tools...</div>}
        {toolError && <p className="warn">{toolError}</p>}
        {!loadingTools && !toolError && tools.length === 0 && <div className="empty-state">No tools discovered for this server.</div>}
        <div className="tool-list">
          {tools.map((tool) => (
            <article className="tool-card" key={tool.name}>
              <strong>{tool.name}</strong>
              <p>{tool.description || 'No description supplied.'}</p>
              {tool.input_schema && (
                <details>
                  <summary>Input schema</summary>
                  <pre>{JSON.stringify(tool.input_schema, null, 2)}</pre>
                </details>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function HistoryView({refreshState, setMessages}: {refreshState: () => void; setMessages: (messages: any[]) => void}) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<any[]>([]);
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Sessions(100).then(setSessions);
  }, []);

  async function search() {
    setSessions(query ? await SearchSessions(query) : await Sessions(100));
  }

  async function preview(session: any) {
    setLoading(true);
    setSelectedSession(session);
    try {
      setSelected(await ReadSession(session.session_id, 120));
    } finally {
      setLoading(false);
    }
  }

  async function loadSelected() {
    if (!selectedSession) return;
    const reply = await LoadSession(selectedSession.session_id, 80);
    setMessages(reply.history || []);
    refreshState();
  }

  return (
    <section className="two-column history-view">
      <div className="list-panel session-list-panel">
        <div className="searchbar">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="Search session text" />
          <button onClick={search}>Search</button>
        </div>
        <div className="session-count">{sessions.length} sessions</div>
        {sessions.map((session) => (
          <button key={session.session_id} className={selectedSession?.session_id === session.session_id ? 'session-row selected' : 'session-row'} onClick={() => preview(session)}>
            <div className="session-row-main">
              <strong>{formatSessionTitle(session)}</strong>
              <span>{session.preview || 'No preview text available.'}</span>
            </div>
            <div className="session-row-meta">
              <small>{formatDateTime(session.modified)}</small>
              <small>{session.messages} messages</small>
            </div>
          </button>
        ))}
      </div>
      <div className="preview session-preview-pane">
        <div className="preview-header">
          <div>
            <h2>{selectedSession?.session_id || 'Session Preview'}</h2>
            <span>{selectedSession ? `${selectedSession.messages} messages / ${formatDateTime(selectedSession.modified)}` : 'Select a session to inspect it'}</span>
          </div>
          <button className="primary" disabled={!selectedSession} onClick={loadSelected}>
            <Play size={16} />
            Load Session
          </button>
        </div>
        {loading && <div className="loading-inline"><span className="spinner" /> Reading session...</div>}
        {!loading && selected.length === 0 && <div className="empty-state">No session selected.</div>}
        <div className="session-transcript">
          {selected.map((message, index) => (
            <article key={index} className={`message ${message.role || ''}`}>
              <div className="message-role">{message.role}</div>
              <MarkdownContent>{message.content || ''}</MarkdownContent>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function UsageView({ui}: {ui: any}) {
  const [filter, setFilter] = useState<any>({bucket: 'day'});
  const [report, setReport] = useState<any>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    BuildUsageReport(filter, false).then(setReport);
  }, []);

  async function build(write = false) {
    setWorking(true);
    try {
      setReport(write ? await SaveUsageReport(filter) : await BuildUsageReport(filter, false));
    } finally {
      setWorking(false);
    }
  }

  function quickRange(range: string) {
    const now = new Date();
    const yyyyMmDd = (date: Date) => date.toISOString().slice(0, 10);
    const start = new Date(now);
    if (range === 'today') {
      setFilter({...filter, start: yyyyMmDd(now), end: yyyyMmDd(now)});
      return;
    }
    if (range === '7d') start.setDate(now.getDate() - 6);
    if (range === '30d') start.setDate(now.getDate() - 29);
    if (range === 'month') start.setDate(1);
    if (range === 'last-month') {
      const firstThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonthEnd = new Date(firstThisMonth);
      lastMonthEnd.setDate(0);
      const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
      setFilter({...filter, start: yyyyMmDd(lastMonthStart), end: yyyyMmDd(lastMonthEnd)});
      return;
    }
    setFilter({...filter, start: yyyyMmDd(start), end: yyyyMmDd(now)});
  }

  const buckets = report?.buckets || [];
  const max = Math.max(1, ...buckets.map((b: any) => b.totals.total_tokens || 0));

  return (
    <section className="view-column">
      <div className="usage-filters">
        <CalendarDays size={18} />
        <select value="" onChange={(e) => e.target.value && quickRange(e.target.value)}>
          <option value="">Quick range</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="month">This month</option>
          <option value="last-month">Last month</option>
        </select>
        <input type="date" value={filter.start || ''} onChange={(e) => setFilter({...filter, start: e.target.value})} />
        <input type="date" value={filter.end || ''} onChange={(e) => setFilter({...filter, end: e.target.value})} />
        <input placeholder="Model filter" value={filter.model || ''} onChange={(e) => setFilter({...filter, model: e.target.value})} />
        <select value={filter.bucket} onChange={(e) => setFilter({...filter, bucket: e.target.value})}>
          <option value="hour">Hour</option>
          <option value="day">Day</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
        </select>
        <button disabled={working} onClick={() => build(false)}>{working ? <span className="spinner" /> : <LineChart size={16} />} Visualize</button>
        <button onClick={() => window.print()}><Download size={16} /> Print</button>
        <button disabled={working} onClick={() => build(true)}>{working ? <span className="spinner" /> : <Save size={16} />} Save Report</button>
      </div>
      <div className="dashboard-row">
        <Stat title="Requests" value={String(report?.totals?.requests || ui.usage?.total?.requests || 0)} />
        <Stat title="Tokens" value={String(report?.totals?.total_tokens || ui.usage?.total?.total_tokens || 0)} />
        <Stat title="Cost" value={`$${Number(report?.totals?.cost_usd || ui.usage?.total?.cost_usd || 0).toFixed(4)}`} />
      </div>
      <div className="bar-chart">
        {buckets.map((bucket: any) => (
          <div className="bar-row" key={bucket.key}>
            <span>{bucket.key}</span>
            <div><i style={{width: `${((bucket.totals.total_tokens || 0) / max) * 100}%`}} /></div>
            <strong>{bucket.totals.total_tokens || 0}</strong>
          </div>
        ))}
      </div>
      {report?.path && <p className="saved-path">Saved {report.path}</p>}
    </section>
  );
}

function PlanView({refreshState}: {refreshState: () => void}) {
  const [reply, setReply] = useState<any>(null);
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [focus, setFocus] = useState('');
  const [raw, setRaw] = useState('');
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState(false);
  const [executingTask, setExecutingTask] = useState('');

  useEffect(() => {
    Plans().then((r) => {
      setReply(r);
      setSelectedPlan(r.data?.selected || null);
      setRaw(JSON.stringify(r.data?.selected || {}, null, 2));
    });
  }, []);

  useEffect(() => {
    if (!executingTask || !selectedPlan?.id) return;
    let cancelled = false;
    async function tick() {
      try {
        const [plan, planReply, tasks] = await Promise.all([
          ReadPlan(selectedPlan.id),
          Plans(),
          Tasks(),
        ]);
        if (cancelled) return;
        setSelectedPlan(plan);
        if (!editing) setRaw(JSON.stringify(plan, null, 2));
        setReply(planReply);
        const task = (tasks || []).find((item: any) => item.id === executingTask);
        if (task && !['running', 'canceling'].includes(String(task.status || '').toLowerCase())) {
          setExecutingTask('');
          refreshState();
        }
      } catch {
        if (!cancelled) setExecutingTask('');
      }
    }
    tick();
    const timer = window.setInterval(tick, 1800);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [executingTask, selectedPlan?.id, editing]);

  async function replan() {
    setWorking(true);
    try {
      const r = await CreatePlan(focus);
      setReply(r);
      setSelectedPlan(r.data?.selected || null);
      setRaw(JSON.stringify(r.data?.selected || {}, null, 2));
      refreshState();
    } finally {
      setWorking(false);
    }
  }

  async function execute() {
    const id = selectedPlan?.id || '';
    setWorking(true);
    try {
      const r = await ExecutePlan(id);
      setReply(r);
      setSelectedPlan(r.data?.selected || selectedPlan);
      setRaw(JSON.stringify(r.data?.selected || selectedPlan || {}, null, 2));
      setExecutingTask(r.data?.task_id || '');
      refreshState();
    } finally {
      setWorking(false);
    }
  }

  async function save() {
    const id = selectedPlan?.id || JSON.parse(raw).id;
    const r = await SavePlan(id, raw);
    setReply(r);
    setSelectedPlan(r.data?.selected || selectedPlan);
  }

  async function deletePlan(plan = selectedPlan) {
    if (!plan?.id) return;
    if (!window.confirm(`Delete plan "${plan.name || plan.id}"? This cannot be undone.`)) return;
    setWorking(true);
    try {
      const r = await DeletePlan(plan.id);
      const next = r.data?.selected || null;
      setReply(r);
      setSelectedPlan(next);
      setRaw(JSON.stringify(next || {}, null, 2));
      setEditing(false);
      refreshState();
    } finally {
      setWorking(false);
    }
  }

  async function openPlan(summary: any) {
    const plan = await ReadPlan(summary.id);
    setSelectedPlan(plan);
    setRaw(JSON.stringify(plan, null, 2));
  }

  return (
    <section className="plan-view">
      <div className="settings-panel">
        <h2>Plans</h2>
        {(reply?.data?.plans || []).map((plan: any) => (
          <div
            className={selectedPlan?.id === plan.id ? 'plan-row selected' : 'plan-row'}
            key={plan.id}
            onClick={() => openPlan(plan)}
            onKeyDown={(event) => event.key === 'Enter' && openPlan(plan)}
            role="button"
            tabIndex={0}
          >
            <div className="plan-row-main">
              <strong>{plan.name}</strong>
              <span>{plan.progress}</span>
            </div>
            <small>{plan.status}</small>
            <button className="inline-danger" title="Delete plan" onClick={(event) => {
              event.stopPropagation();
              deletePlan(plan);
            }}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <input placeholder="Plan focus" value={focus} onChange={(e) => setFocus(e.target.value)} />
        <button onClick={replan} disabled={working}>{working ? <span className="spinner" /> : <Sparkles size={16} />} Plan</button>
        {executingTask && <div className="loading-inline"><span className="spinner" /> Running as {executingTask}</div>}
        <button className="primary" onClick={execute} disabled={!selectedPlan || working || !!executingTask}><Play size={16} /> Execute Plan</button>
      </div>
      <div className="settings-panel">
        <div className="preview-header">
          <div>
            <h2>{selectedPlan?.name || 'Plan Details'}</h2>
            <span>{selectedPlan ? `${selectedPlan.status} / ${planProgress(selectedPlan)}` : 'Select a plan'}</span>
          </div>
          <div className="row-actions">
            <button onClick={() => setEditing(!editing)} disabled={!selectedPlan}><FilePenLine size={16} /> {editing ? 'Preview' : 'Edit JSON'}</button>
            <button className="danger-button" onClick={() => deletePlan()} disabled={!selectedPlan || working}><Trash2 size={16} /> Delete</button>
          </div>
        </div>
        {editing ? (
          <>
            <textarea value={raw} onChange={(e) => setRaw(e.target.value)} />
            <button onClick={save}><Save size={16} /> Save Plan</button>
          </>
        ) : (
          <PlanDetails plan={selectedPlan} />
        )}
      </div>
    </section>
  );
}

function TasksView() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [scheduled, setScheduled] = useState<any[]>([]);
  const [mode, setMode] = useState('in');
  const [delay, setDelay] = useState('10m');
  const [at, setAt] = useState(defaultScheduleDateTime());
  const [prompt, setPrompt] = useState('');
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 1500);
    return () => window.clearInterval(id);
  }, []);

  async function refresh() {
    const [nextTasks, nextScheduled] = await Promise.all([Tasks(), ScheduledTasks()]);
    setTasks(nextTasks || []);
    setScheduled(nextScheduled || []);
  }

  async function createSchedule() {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      setError('Add a message for the scheduled task.');
      return;
    }
    setError('');
    setWorking('create');
    try {
      const req: any = {mode, prompt: cleanPrompt};
      if (mode === 'at') req.at = at;
      if (mode === 'every') req.every = delay;
      if (mode === 'in') req.delay = delay;
      setScheduled(await CreateScheduledTask(req));
      setPrompt('');
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setWorking('');
    }
  }

  async function runSchedule(id: string) {
    setWorking(`run-${id}`);
    try {
      setScheduled(await RunScheduledTaskNow(id));
      await refresh();
    } finally {
      setWorking('');
    }
  }

  async function cancelSchedule(id: string) {
    setWorking(`cancel-${id}`);
    try {
      setScheduled(await CancelScheduledTask(id));
    } finally {
      setWorking('');
    }
  }

  async function deleteSchedule(id: string) {
    if (!window.confirm('Delete this scheduled task?')) return;
    setWorking(`delete-${id}`);
    try {
      setScheduled(await DeleteScheduledTask(id));
    } finally {
      setWorking('');
    }
  }

  return (
    <section className="view-column tasks-view">
      <div className="schedule-panel">
        <div className="preview-header">
          <div>
            <h2>Scheduled Tasks</h2>
            <span>Create one-shot or recurring background agent runs.</span>
          </div>
          {working === 'create' && <span className="loading-inline"><span className="spinner" /> Scheduling...</span>}
        </div>
        <div className="schedule-form">
          <label className="field">
            <span>When</span>
            <select value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="in">In duration</option>
              <option value="at">At date/time</option>
              <option value="every">Every duration</option>
            </select>
          </label>
          {mode === 'at' ? (
            <label className="field">
              <span>Date and time</span>
              <input type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} />
            </label>
          ) : (
            <label className="field">
              <span>{mode === 'every' ? 'Repeat every' : 'Delay'}</span>
              <input value={delay} onChange={(event) => setDelay(event.target.value)} placeholder="10m, 2h, 1d, daily" />
            </label>
          )}
          <label className="field schedule-prompt">
            <span>Message</span>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask NullBot to do something later..." />
          </label>
          <button className="primary" onClick={createSchedule} disabled={working === 'create'}>
            {working === 'create' ? <span className="spinner dark" /> : <CalendarDays size={16} />}
            Schedule
          </button>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <div className="scheduled-grid">
          {scheduled.length === 0 ? (
            <div className="empty-panel">No scheduled tasks yet.</div>
          ) : scheduled.map((item) => (
            <ScheduleCard
              key={item.id}
              item={item}
              working={working}
              onRun={() => runSchedule(item.id)}
              onCancel={() => cancelSchedule(item.id)}
              onDelete={() => deleteSchedule(item.id)}
            />
          ))}
        </div>
      </div>
      <div className="preview-header task-section-title">
        <div>
          <h2>Running and Recent Tasks</h2>
          <span>{tasks.length ? `${tasks.length} task records` : 'No tasks recorded yet.'}</span>
        </div>
      </div>
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} onCancel={async () => setTasks(await CancelTask(task.id))} />
      ))}
    </section>
  );
}

function PromptsView({ui, refreshState}: {ui: any; refreshState: () => void}) {
  const [defaults, setDefaults] = useState<any>({manager: '', subagent: ''});
  const [manager, setManager] = useState('');
  const [subagent, setSubagent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const next = await PromptDefaults();
        if (!alive) return;
        const prompts = ui.config?.prompts || {};
        setDefaults(next);
        setManager(prompts.manager_prompt || withAppend(next.manager, prompts.manager_append));
        setSubagent(prompts.subagent_prompt || withAppend(next.subagent, prompts.subagent_append));
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [ui.config?.prompts]);

  async function save() {
    setSaving(true);
    try {
      await SavePrompts({
        ...(ui.config?.prompts || {}),
        manager_prompt: samePrompt(manager, defaults.manager) ? '' : manager,
        subagent_prompt: samePrompt(subagent, defaults.subagent) ? '' : subagent,
        manager_append: '',
        subagent_append: '',
      });
      refreshState();
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="settings-grid prompt-editor">
      <div className="settings-panel">
        <h2>Manager Prompt</h2>
        {loading && <div className="loading-inline"><span className="spinner" /> Loading default prompt...</div>}
        <textarea value={manager} onChange={(e) => setManager(e.target.value)} />
        <button onClick={() => setManager(defaults.manager)}>Reset to Default</button>
      </div>
      <div className="settings-panel">
        <h2>Subagent Prompt</h2>
        {loading && <div className="loading-inline"><span className="spinner" /> Loading default prompt...</div>}
        <textarea value={subagent} onChange={(e) => setSubagent(e.target.value)} />
        <div className="row-actions">
          <button onClick={() => setSubagent(defaults.subagent)}>Reset to Default</button>
          <button className="primary" onClick={save} disabled={saving}>
            {saving ? <span className="spinner dark" /> : <Save size={16} />}
            Save Prompts
          </button>
        </div>
      </div>
    </section>
  );
}

function ThemesView({ui, refreshState, setUi}: {ui: any; refreshState: () => void; setUi: any}) {
  const [working, setWorking] = useState('');

  async function choose(theme: any) {
    setWorking(theme.id);
    setUi((current: any) => ({
      ...current,
      config: {
        ...(current?.config || {}),
        ui: {...(current?.config?.ui || {}), theme: theme.id},
      },
    }));
    try {
      const next = await SetTheme(theme.id);
      setUi(next);
      refreshState();
    } finally {
      setWorking('');
    }
  }

  return (
    <section className="theme-grid">
      {(ui.themes || []).map((theme: any) => (
        <button key={theme.id} className={ui.config?.ui?.theme === theme.id ? 'theme-card selected' : 'theme-card'} onClick={() => choose(theme)} disabled={working === theme.id}>
          <span className="swatches">
            {[theme.background, theme.panel, theme.accent, theme.accent2].map((color: string) => <i key={color} style={{background: color}} />)}
          </span>
          <strong>{theme.name}</strong>
          <small>{theme.description}</small>
          {working === theme.id && <span className="loading-inline"><span className="spinner" /> Applying...</span>}
        </button>
      ))}
    </section>
  );
}

function IdentityView({ui, refreshState}: {ui: any; refreshState: () => void}) {
  const [name, setName] = useState(ui.runtime?.bot_name || '');
  async function save() {
    await SetBotName(name);
    refreshState();
  }
  return (
    <section className="identity-stage">
      <div className="logo-print">
        <img src={botArt} alt="NullBot mascot" />
        <div className="big-logo">{name || 'NullBot'}</div>
        <div className="scanlines" />
      </div>
      <div className="identity-controls">
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary" onClick={save}><Save size={16} /> Rename Bot</button>
      </div>
    </section>
  );
}

function TaskCard({task, onCancel}: {task: any; onCancel: () => void}) {
  const recentTools = (task.tool_calls || []).slice(-6).map((call: any, index: number) => ({...friendlyToolCall(call), key: `${call.time}-${index}`}));
  return (
    <article className={`task-card ${statusClass(task.status)}`}>
      <div className="task-head">
        <div>
          <strong>{task.name}</strong>
          <span>{task.id} / {task.role}</span>
        </div>
        <span className={`status-badge ${statusClass(task.status)}`}>{task.status}</span>
        {task.cancelable && <button onClick={onCancel}><CircleStop size={16} /> Cancel</button>}
      </div>
      <p>{task.error || task.current || task.prompt}</p>
      <div className="token-line">
        <span>input {task.tokens?.input || 0}</span>
        <span>output {task.tokens?.output || 0}</span>
        {(task.tokens?.cached_input || task.tokens?.cache_creation_input) ? <span>cache {(task.tokens?.cached_input || 0) + (task.tokens?.cache_creation_input || 0)}</span> : null}
        {task.tokens?.reasoning_output ? <span>reasoning {task.tokens.reasoning_output}</span> : null}
        <span>total {task.tokens?.total || 0}</span>
      </div>
      {recentTools.length > 0 && (
        <div className="tool-call-list">
          <span>Recent tools</span>
          {recentTools.map((call: any) => (
            <div className={`tool-call ${call.state}`} key={call.key}>
              <TerminalSquare size={14} />
              <strong>{call.title}</strong>
              <small>{call.subtitle}</small>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function ScheduleCard({item, working, onRun, onCancel, onDelete}: {item: any; working: string; onRun: () => void; onCancel: () => void; onDelete: () => void}) {
  const canCancel = item.status === 'active' || item.status === 'running' || item.status === 'error';
  return (
    <article className={`schedule-card ${statusClass(item.status)}`}>
      <div className="task-head">
        <div>
          <strong>{item.name || item.id}</strong>
          <span>{item.id}{item.repeat_every ? ` / every ${item.repeat_every}` : ''}</span>
        </div>
        <span className={`status-badge ${statusClass(item.status)}`}>{item.status}</span>
      </div>
      <p>{item.prompt}</p>
      <div className="token-line">
        {item.next_run_at && <span>next {formatDateTime(item.next_run_at)}</span>}
        {item.last_run_at && <span>last {formatDateTime(item.last_run_at)}</span>}
        <span>runs {item.run_count || 0}</span>
      </div>
      {item.last_error && <div className="inline-error">{item.last_error}</div>}
      <div className="row-actions">
        <button onClick={onRun} disabled={working === `run-${item.id}`}>
          {working === `run-${item.id}` ? <span className="spinner" /> : <Play size={16} />}
          Run Now
        </button>
        {canCancel && (
          <button onClick={onCancel} disabled={working === `cancel-${item.id}`}>
            {working === `cancel-${item.id}` ? <span className="spinner" /> : <CircleStop size={16} />}
            Cancel
          </button>
        )}
        <button className="inline-danger" onClick={onDelete} disabled={working === `delete-${item.id}`}>
          {working === `delete-${item.id}` ? <span className="spinner" /> : <Trash2 size={16} />}
          Delete
        </button>
      </div>
    </article>
  );
}

function TablePreview({headers, rows}: {headers: string[]; rows: string[][]}) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{headers.map((header, index) => <th key={index}>{header || `Column ${index + 1}`}</th>)}</tr></thead>
        <tbody>{rows.map((row, r) => <tr key={r}>{headers.map((_, c) => <td key={c}>{row[c] || ''}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function MarkdownContent({children}: {children: string}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre({children}: any) {
          const text = extractText(children).replace(/\n$/, '');
          return <CopyBlock text={text}><pre>{children}</pre></CopyBlock>;
        },
        code({className, children, ...props}: any) {
          return <code className={className} {...props}>{children}</code>;
        },
      }}
    >
      {children || ''}
    </ReactMarkdown>
  );
}

function CopyBlock({text, children}: {text: string; children: any}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await copyText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1100);
  }

  return (
    <div className="copy-block">
      <button className="copy-button" onClick={copy} title="Copy">
        <Copy size={14} />
        {copied ? 'Copied' : 'Copy'}
      </button>
      {children}
    </div>
  );
}

function StickyTabs({tabs, active, onSelect, labelFor}: any) {
  return (
    <div className="sticky-tabs">
      {tabs.map((tab: string) => <button key={tab} className={tab === active ? 'active' : ''} onClick={() => onSelect(tab)}>{labelFor(tab)}</button>)}
    </div>
  );
}

function Segmented({value, values, onChange}: {value: string; values: string[]; onChange: (value: string) => void}) {
  return <div className="segmented">{values.map((item) => <button key={item} className={item === value ? 'active' : ''} onClick={() => onChange(item)}>{item}</button>)}</div>;
}

function Pill({label, value}: {label: string; value: string}) {
  return <span className="pill"><small>{label}</small>{value}</span>;
}

function Stat({title, value}: {title: string; value: string}) {
  return <div className="stat"><span>{title}</span><strong>{value}</strong></div>;
}

function Field({label, value, onChange}: {label: string; value: string; onChange: (value: string) => void}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({label, value, onChange}: {label: string; value: number; onChange: (value: number) => void}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value || ''} onChange={(event) => onChange(Number(event.target.value || 0))} />
    </label>
  );
}

function ModelConfigFields({title, value, groups, onChange}: {title: string; value: any; groups: any[]; onChange: (field: string, value: any) => void}) {
  const providers = uniqueStrings(groups.map((group) => group.provider).filter(Boolean));
  const provider = value.provider || providers[0] || '';
  const models = modelsForProvider(groups, provider);
  const modelIDs = uniqueStrings(models.map((model: any) => model.id).filter(Boolean));
  const model = value.model || modelIDs[0] || '';
  if (model && !modelIDs.includes(model)) modelIDs.unshift(model);
  if (provider && !providers.includes(provider)) providers.unshift(provider);

  function chooseProvider(nextProvider: string) {
    onChange('provider', nextProvider);
    const nextModels = modelsForProvider(groups, nextProvider).map((item: any) => item.id).filter(Boolean);
    if (nextModels.length && !nextModels.includes(value.model)) {
      onChange('model', nextModels[0]);
    }
  }

  return (
    <div className="model-config-fields">
      <h3>{title}</h3>
      <label className="field">
        <span>{title} provider</span>
        <select value={provider} onChange={(event) => chooseProvider(event.target.value)}>
          {providers.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <label className="field">
        <span>{title} model</span>
        <select value={model} onChange={(event) => onChange('model', event.target.value)}>
          {modelIDs.map((id) => {
            const option = models.find((item: any) => item.id === id);
            return <option key={id} value={id}>{option?.name ? `${option.name} / ${id}` : id}</option>;
          })}
        </select>
      </label>
      <EffortField
        label={`${title} reasoning`}
        provider={provider}
        model={model}
        modelOption={models.find((item: any) => item.id === model)}
        value={value.reasoning_effort || ''}
        onChange={(next) => onChange('reasoning_effort', next)}
      />
    </div>
  );
}

function EffortField({label, provider, model, modelOption, value, onChange}: {label: string; provider: string; model: string; modelOption: any; value: string; onChange: (value: string) => void}) {
  const supportsReasoning = modelOption?.reasoning || likelyReasoningModel(provider, model);
  const options = supportsReasoning ? reasoningEffortOptions(provider) : [{id: '', label: 'Auto / default', mapped: '', description: 'No explicit reasoning effort for this model.'}];
  if (value && !options.some((option) => option.id === value)) {
    options.push({id: value, label: value, mapped: providerEffort(provider, value), description: 'Current custom value'});
  }
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.id || 'auto'} value={option.id}>
            {option.label}{option.mapped ? ` -> ${option.mapped}` : ''}
          </option>
        ))}
      </select>
      <small>{supportsReasoning ? `Provider value: ${providerEffort(provider, value) || 'auto'}` : 'This model is listed as standard; effort will be left on provider default.'}</small>
    </label>
  );
}

function PlanDetails({plan}: {plan: any}) {
  if (!plan) return <div className="empty-state">Select or create a plan.</div>;
  const steps = plan.steps || [];
  return (
    <div className="plan-detail">
      {plan.description && <p className="plan-summary">{plan.description}</p>}
      <div className="dashboard-row compact">
        <Stat title="Status" value={plan.status || 'unknown'} />
        <Stat title="Progress" value={planProgress(plan)} />
        <Stat title="Current Step" value={plan.current_step || '-'} />
      </div>
      <div className="plan-steps">
        {steps.map((step: any, index: number) => (
          <article className={`plan-step ${statusClass(step.status)}`} key={step.id || index}>
            <header>
              <span>{step.id || String(index + 1)}</span>
              <strong>{step.title || step.name || 'Untitled step'}</strong>
              <small>{step.status || 'pending'}</small>
            </header>
            {step.description && <p>{step.description}</p>}
            {(step.substeps || []).length > 0 && (
              <div className="substeps">
                {step.substeps.map((substep: any, subIndex: number) => (
                  <div className={`substep ${statusClass(substep.status)}`} key={substep.id || subIndex}>
                    <span>{substep.id || `${index + 1}.${subIndex + 1}`}</span>
                    <strong>{substep.title || substep.name || 'Substep'}</strong>
                    <small>{substep.status || 'pending'}</small>
                    {substep.description && <p>{substep.description}</p>}
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function planProgress(plan: any) {
  const steps = plan?.steps || [];
  if (steps.length === 0) return '0/0 complete';
  const done = steps.filter((step: any) => ['done', 'complete', 'completed'].includes(String(step.status || '').toLowerCase())).length;
  return `${done}/${steps.length} complete`;
}

function labelAgentTab(value: string) {
  if (value === 'combined') return 'Combined';
  if (value === 'manager') return 'Manager';
  return `Subagent ${value.split('-')[1]}`;
}

function buildActivityTimeline(records: any[]) {
  const items: any[] = [];
  const runningByTool: Record<string, number[]> = {};
  for (const [index, record] of (records || []).entries()) {
    const status = String(record.status || '');
    const name = String(record.name || record.kind || 'event');
    if (status === 'tool start') {
      const item = makeActivityItem(record, index);
      items.push(item);
      runningByTool[name] = [...(runningByTool[name] || []), items.length - 1];
      continue;
    }
    if (status === 'tool complete' || status === 'tool error') {
      const stack = runningByTool[name] || [];
      const itemIndex = stack.pop();
      if (itemIndex !== undefined) {
        const item = items[itemIndex];
        item.state = status === 'tool error' ? 'error' : 'complete';
        item.endedAt = record.time;
        item.subtitle = status === 'tool error'
          ? cleanActivityDetail(record.detail) || 'Tool failed'
          : `Completed${formatDuration(item.time, record.time)}`;
        item.raw = item.raw || cleanActivityDetail(record.detail);
        continue;
      }
    }
    items.push(makeActivityItem(record, index));
  }
  return items;
}

function makeActivityItem(record: any, index: number) {
  const status = String(record.status || '');
  const args = activityArgs(record.detail);
  const tool = friendlyToolCall(record);
  const item = {
    id: `${record.time || index}-${index}-${record.name || record.kind || status}`,
    time: record.time,
    name: record.name || record.kind || 'event',
    kind: activityKind(status),
    state: activityState(status),
    title: tool.title,
    subtitle: tool.subtitle,
    chips: activityChips(args, record.detail),
    raw: Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : cleanActivityDetail(record.detail),
  };
  if (status === 'model start') {
    item.title = 'Model call started';
    item.subtitle = cleanActivityDetail(record.detail) || 'Preparing a response';
  } else if (status === 'agent complete') {
    item.title = 'Agent completed turn';
    item.subtitle = cleanActivityDetail(record.detail) || 'Ready for the next step';
    item.raw = '';
  } else if (status === 'reasoning') {
    item.title = 'Reasoning summary';
    item.subtitle = cleanActivityDetail(record.detail) || 'Provider-visible reasoning summary received';
    item.raw = '';
  } else if (status === 'model error') {
    item.title = 'Model error';
    item.subtitle = cleanActivityDetail(record.detail) || 'The model call failed';
  }
  if (status === 'tool complete' && !Object.keys(args).length) {
    item.raw = '';
  }
  return item;
}

function activityKind(status: string) {
  if (status.startsWith('tool')) return 'tool';
  if (status.startsWith('model')) return 'model';
  if (status === 'reasoning') return 'reasoning';
  if (status.startsWith('agent')) return 'agent';
  return 'event';
}

function activityState(status: string) {
  if (status.endsWith('start')) return 'running';
  if (status.includes('error')) return 'error';
  if (status.includes('complete') || status === 'agent complete') return 'complete';
  return 'info';
}

function activityIcon(item: any) {
  if (item.state === 'error') return CircleStop;
  if (item.state === 'complete') return Check;
  if (item.kind === 'model') return Brain;
  if (item.kind === 'reasoning') return Sparkles;
  if (item.kind === 'agent') return Bot;
  return TerminalSquare;
}

function friendlyToolCall(record: any) {
  const status = String(record.status || '');
  const args = activityArgs(record.detail);
  const name = String(record.name || 'tool');
  const state = activityState(status);
  return {
    title: friendlyToolTitle(name, args, status),
    subtitle: friendlyToolSubtitle(name, args, status),
    state,
  };
}

function friendlyToolTitle(name: string, args: any, status = 'tool start') {
  const path = labelPath(args.path);
  switch (name) {
    case 'workspace_info':
      return 'Checked workspace';
    case 'list_dir':
      return `Listed ${path}`;
    case 'read_file':
      return `Read ${path}`;
    case 'write_file':
    case 'save_file':
      return `Wrote ${path}`;
    case 'search_files':
      return `Searched ${shorten(args.pattern || 'files', 34)}${args.path ? ` in ${labelPath(args.path)}` : ''}`;
    case 'search_text':
      return `Searched ${shorten(args.query || 'text', 34)}${args.path ? ` in ${labelPath(args.path)}` : ''}`;
    case 'edit_file':
    case 'apply_patch':
      return `Edited ${path}`;
    default:
      if (status === 'tool complete') return `Completed ${humanizeID(name)}`;
      if (status === 'tool error') return `${humanizeID(name)} failed`;
      return `Running ${humanizeID(name)}`;
  }
}

function friendlyToolSubtitle(name: string, args: any, status: string) {
  if (status === 'tool error') return 'Needs attention';
  if (status === 'tool complete') return 'Tool complete';
  if (name === 'workspace_info') return 'Reading workspace metadata';
  if (name === 'read_file') return args.max_bytes ? `Preview limit ${args.max_bytes} bytes` : 'Reading file contents';
  if (name === 'list_dir') return args.max_items ? `Up to ${args.max_items} items` : 'Listing directory';
  if (name === 'search_files' || name === 'search_text') return args.max_matches || args.max_items ? `Up to ${args.max_matches || args.max_items} matches` : 'Searching workspace';
  return 'Tool running';
}

function activityArgs(detail: string) {
  const text = String(detail || '').trim();
  const match = text.match(/^args:\s*(.*)$/s);
  if (!match) return {};
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
}

function activityChips(args: any, detail: string) {
  const chips: string[] = [];
  if (args.path !== undefined) chips.push(`path ${labelPath(args.path)}`);
  if (args.pattern) chips.push(`pattern ${shorten(args.pattern, 24)}`);
  if (args.query) chips.push(`query ${shorten(args.query, 24)}`);
  if (args.max_items) chips.push(`max ${args.max_items}`);
  if (args.max_matches) chips.push(`matches ${args.max_matches}`);
  if (args.max_bytes) chips.push(`${formatBytes(Number(args.max_bytes))}`);
  if (chips.length === 0 && detail?.includes('messages=')) chips.push(String(detail).replace(/\s+/g, ' '));
  return chips.slice(0, 4);
}

function friendlyThoughtNote(note: string) {
  const text = String(note || '').trim();
  const toolStart = text.match(/^using tool\s+(\S+)\s+args:\s*(.*)$/s);
  if (toolStart) {
    const detail = `args: ${toolStart[2]}`;
    return friendlyToolCall({name: toolStart[1], status: 'tool start', detail}).title;
  }
  const toolDone = text.match(/^tool complete:\s*(.+)$/);
  if (toolDone) return `Completed ${humanizeID(toolDone[1])}`;
  if (text.startsWith('started model call:')) return `Model call started (${text.replace('started model call:', '').trim()})`;
  if (text.startsWith('reasoning:')) return text.replace('reasoning:', 'Summary:').trim();
  if (text === 'completed current turn') return 'Completed current turn';
  return text;
}

function labelPath(value: any) {
  const path = String(value || '').trim();
  return path || 'workspace';
}

function humanizeID(value: string) {
  return String(value || 'tool').replace(/[_-]+/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function cleanActivityDetail(detail: string) {
  const text = String(detail || '').trim();
  if (!text || text === 'Tool call complete.') return '';
  return text.replace(/^args:\s*/, '').replace(/^error:\s*/, '');
}

function shorten(value: any, limit = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function formatDuration(start: string, end: string) {
  const startMs = Date.parse(start || '');
  const endMs = Date.parse(end || '');
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return '';
  const seconds = (endMs - startMs) / 1000;
  if (seconds < 1) return ` in ${Math.round(seconds * 1000)} ms`;
  return ` in ${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

function themeVars(theme: any) {
  if (!theme) return {};
  return {
    '--bg': theme.background,
    '--panel': theme.panel,
    '--activity': theme.activity,
    '--border': theme.border,
    '--accent': theme.accent,
    '--accent-2': theme.accent2,
    '--text': theme.text,
    '--muted': theme.muted,
  } as any;
}

function formatTime(value: string) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
}

function formatDateTime(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
}

function defaultScheduleDateTime() {
  const date = new Date(Date.now() + 30 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatSessionTitle(session: any) {
  const value = String(session?.session_id || '');
  const date = new Date(session?.modified || '');
  const prefix = Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString([], {month: 'short', day: 'numeric'});
  return `${prefix} / ${value.replace(/\.jsonl?$/i, '').slice(-18)}`;
}

function formatBytes(value: number) {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function localMessage(role: string, content: string, extra: any = {}) {
  return {
    role,
    content,
    time: new Date().toISOString(),
    local: true,
    ...extra,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function statusPhase(status: string, busy: boolean) {
  const text = String(status || '').toLowerCase();
  if (busy) {
    if (text.includes('also')) return 'Also observer working';
    if (text.includes('compact')) return 'Compacting conversation';
    if (text.includes('analy')) return 'Analyzing workspace';
    return 'Agent working';
  }
  if (text.includes('error') || text.includes('failed')) return 'Needs attention';
  if (text.includes('saved')) return 'Saved';
  if (text.includes('panel opened')) return 'Panel opened';
  if (text.includes('ready')) return 'Ready';
  if (text.includes('complete') || text.includes('done')) return 'Complete';
  return 'Ready';
}

function splitArgs(text: string) {
  return text.split(' ').map((item) => item.trim()).filter(Boolean);
}

function messageWithAttachmentTokens(text: string, attachments: any[]) {
  const tokens = attachments.map((item) => item.token).filter(Boolean);
  if (tokens.length === 0) return text;
  if (!text.trim()) return tokens.join(' ');
  return `${text.trim()}\n\n${tokens.join(' ')}`;
}

function mergeAttachments(current: any[], incoming: any[]) {
  const out = [...(current || [])];
  for (const item of incoming || []) {
    const key = item.path || item.original_path || item.name;
    if (!key || out.some((existing) => (existing.path || existing.original_path || existing.name) === key)) continue;
    out.push(item);
  }
  return out;
}

function messageWithVisibleAttachments(message: any) {
  const fromMessage = message.attachments || [];
  if ((message.role || '').toLowerCase() !== 'user') {
    return {content: message.content || '', attachments: fromMessage};
  }
  const parsed = attachmentsFromText(message.content || '');
  const content = String(message.content || '').replace(attachmentTokenRegex(), '').trim();
  return {content, attachments: mergeAttachments(fromMessage, parsed)};
}

function attachmentsFromText(text: string) {
  const attachments: any[] = [];
  const regex = attachmentTokenRegex();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const path = String(match[1] || match[2] || '').trim().replace(/^["']|["']$/g, '');
    if (!path) continue;
    attachments.push({
      name: basename(path),
      path,
      kind: fileKindLabel(path),
      token: match[0],
    });
  }
  return attachments;
}

function attachmentTokenRegex() {
  return /@file\("([^"]+)"\)|@file\(([^)]+)\)/g;
}

function basename(path: string) {
  return path.split(/[\\/]+/).filter(Boolean).pop() || path;
}

function fileKindLabel(path: string) {
  const ext = path.toLowerCase().split('.').pop() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['docx', 'doc'].includes(ext)) return 'document';
  if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) return 'spreadsheet';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  return 'file';
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function commonPrefix(values: string[]) {
  if (values.length === 0) return '';
  let prefix = values[0] || '';
  for (const value of values.slice(1)) {
    let index = 0;
    while (index < prefix.length && index < value.length && prefix[index].toLowerCase() === value[index].toLowerCase()) {
      index += 1;
    }
    prefix = prefix.slice(0, index);
    if (!prefix) break;
  }
  return prefix;
}

function modelsForProvider(groups: any[], provider: string) {
  return groups.find((group) => group.provider === provider)?.models || [];
}

function reasoningEffortOptions(provider: string) {
  return [
    {id: '', label: 'Auto / default', mapped: '', description: 'Let the provider decide.'},
    {id: 'minimal', label: 'Empty Vessel', mapped: providerEffort(provider, 'minimal'), description: 'Barely any deliberation.'},
    {id: 'low', label: 'One Coffee In', mapped: providerEffort(provider, 'low'), description: 'Light reasoning.'},
    {id: 'medium', label: 'Committee of One', mapped: providerEffort(provider, 'medium'), description: 'Balanced reasoning.'},
    {id: 'high', label: 'Corkboard Detective', mapped: providerEffort(provider, 'high'), description: 'Careful reasoning.'},
    {id: 'xhigh', label: 'Big Brain', mapped: providerEffort(provider, 'xhigh'), description: 'Maximum practical reasoning.'},
  ];
}

function providerEffort(provider: string, effort: string) {
  const normalized = String(effort || '').trim();
  if (!normalized) return '';
  const p = String(provider || '').toLowerCase();
  if (p === 'anthropic') return normalized === 'minimal' ? '' : normalized;
  if (normalized === 'xhigh') return 'high';
  return normalized;
}

function likelyReasoningModel(provider: string, model: string) {
  const hay = `${provider} ${model}`.toLowerCase();
  return /(gpt-5|gpt-4\.1|o\d|reason|thinking|claude|sonnet|opus|haiku)/.test(hay);
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function extractText(node: any): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node.props?.children) return extractText(node.props.children);
  return '';
}

function withAppend(base: string, append: string) {
  const extra = append?.trim();
  if (!extra) return base || '';
  return `${base || ''}\n\n${extra}`;
}

function samePrompt(left: string, right: string) {
  return (left || '').trim() === (right || '').trim();
}

function statusClass(status: string) {
  const value = String(status || 'pending').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  return value || 'pending';
}

export default App;
