import {memo, useLayoutEffect, useRef, useState} from 'react';
import {ChevronRight, ShieldAlert} from 'lucide-react';
import {shallowEqual} from '../../lib/store';
import {kindNames, openVisual, visualStore} from '../../state/visuals';
import {VisualIcon} from '../visuals/visualIcons';
import {statusLabel} from '../visuals/VisualsView';
import {useStore} from '../../lib/store';
import {chatStore} from '../../state/chat';
import {appStore, openSettings, setView} from '../../state/app';
import {Markdown} from '../../ui/Markdown';
import AttachmentTray from '../../AttachmentTray';
import {formatDuration, formatTime, permissionLabel, shorten} from '../../lib/format';
import {followTranscript, isTranscriptNearBottom, messageWithVisibleAttachments, rememberSummaryOpen} from './transcript';
import {describeStep} from '../activity/describe';
import {runningStep, type Turn} from '../activity/model';
import type {ChatMessage} from '../../lib/types';

/** Stable row keys without cloning rows (cloning would defeat row memoization). */
export function rowKeys(messages: ChatMessage[]): string[] {
  const occurrences = new Map<string, number>();
  return messages.map(message => {
    if (message.transcriptKey) return message.transcriptKey;
    const base = message.streamKey ? `stream:${message.streamKey}` : JSON.stringify([
      message.lane || 'primary', message.submission_id || '', message.run_id || '', message.agent_id || '', message.task_id || '', message.role || 'assistant',
      message.id || message.optimisticRequestID || message.time || '',
      message.id || message.optimisticRequestID || message.time || message.submission_id || message.run_id ? '' : message.content || '',
    ]);
    const n = occurrences.get(base) || 0;
    occurrences.set(base, n + 1);
    return `${base}:${n}`;
  });
}

export function Transcript() {
  const messages = useStore(chatStore, state => state.messages);
  const botName = useStore(appStore, state => state.runtime.bot_name || 'NullBot');
  const ref = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  // Disclosure choices outlive a live row being replaced by its durable copy.
  const disclosures = useRef(new Map<string, boolean>());
  useLayoutEffect(() => {
    followTranscript(ref.current, follow.current);
  }, [messages]);
  const keys = rowKeys(messages);
  if (disclosures.current.size > 500) disclosures.current.clear();
  return (
    <div className="transcript" ref={ref} onScroll={event => {follow.current = isTranscriptNearBottom(event.currentTarget);}}>
      <div className="transcript-inner">
        {messages.length === 0 ? <EmptyConversation /> : messages.map((message, index) => (
          <MessageRow key={keys[index]} rowKey={keys[index]} message={message} botName={botName} disclosures={disclosures.current} />
        ))}
      </div>
    </div>
  );
}

function Disclosure({id, label, preview, text, disclosures, initiallyOpen = false}: {id: string; label: string; preview?: string; text: string; disclosures: Map<string, boolean>; initiallyOpen?: boolean}) {
  const [, rerender] = useState(0);
  const open = rememberSummaryOpen(disclosures, id, initiallyOpen);
  return (
    <details className="thinking" open={open} onToggle={event => {
      disclosures.set(id, event.currentTarget.open);
      rerender(n => n + 1);
    }}>
      <summary>
        <ChevronRight size={13} className="thinking-chevron" />
        <span>{label}</span>
        {!open && preview && <span className="thinking-preview">{preview}</span>}
      </summary>
      <Markdown className="prose prose-sm">{text}</Markdown>
    </details>
  );
}

/** The summary without the fixed sentence that introduces it to the model. */
export function compactionSummary(text: string) {
  return String(text || '').replace(/^Summary of earlier work in this conversation\.[^\n]*\n+/, '').trim();
}

function firstLine(text: string) {
  return shorten(String(text || '').split('\n').map(line => line.replace(/^[#*\s>-]+/, '').replace(/\*\*/g, '').trim()).find(Boolean) || '', 100);
}

const MessageRow = memo(function MessageRow({message, rowKey, botName, disclosures}: {message: ChatMessage; rowKey: string; botName: string; disclosures: Map<string, boolean>}) {
  const role = message.role || 'assistant';
  if (role === 'reasoning') {
    return (
      <article className="row row-quiet">
        <div className="row-gutter" />
        <div className="row-body">
          <Disclosure id={message.summaryKey || `${rowKey}:summary`} label={message.agent_id && message.agent_id !== 'main' ? `Thinking (${message.agent_id.split('/')[0]})` : 'Thinking'} preview={firstLine(message.content || '')} text={message.content || ''} disclosures={disclosures} />
        </div>
      </article>
    );
  }
  if (role === 'compaction') {
    return (
      <article className="row row-quiet row-compaction" aria-label="Conversation compacted">
        <div className="row-gutter" />
        <div className="row-body">
          <Disclosure id={`${rowKey}:compaction`} label="Conversation compacted. New requests start from this summary; the messages above are kept." preview="" text={compactionSummary(message.content || '')} disclosures={disclosures} />
        </div>
      </article>
    );
  }
  if (role === 'commentary') {
    return (
      <article className="row row-quiet">
        <div className="row-gutter" />
        <div className="row-body commentary"><Markdown className="prose prose-sm">{message.content || ''}</Markdown></div>
      </article>
    );
  }
  const visible = messageWithVisibleAttachments(message);
  const user = role === 'user';
  const failed = message.roleClass === 'error' || message.failed;
  const summaries: string[] = message.summaries || [];
  return (
    <article className={`row row-${user ? 'user' : 'assistant'} ${failed ? 'row-failed' : ''}`}>
      <div className="row-gutter">
        <span className="row-speaker" title={formatTime(message.time)}>{user ? 'You' : botName}</span>
      </div>
      <div className="row-body">
        {summaries.map((summary, i) => (
          <Disclosure key={message.summaryKeys?.[i] || `${rowKey}:summary:${i}`} id={message.summaryKeys?.[i] || `${rowKey}:summary:${i}`} label="Thinking" preview={firstLine(summary)} text={summary} disclosures={disclosures} />
        ))}
        {(message.commentary || []).map((comment: string, i: number) => (
          <div className="commentary" key={i}><Markdown className="prose prose-sm">{comment}</Markdown></div>
        ))}
        {message.pending && !message.content ? (
          <WorkingLine />
        ) : failed ? (
          <p className="row-error">{visible.content || 'The request failed.'}</p>
        ) : user ? (
          <div className="user-text">{visible.content}</div>
        ) : (
          <Markdown>{visible.content || ''}</Markdown>
        )}
        {visible.attachments.length > 0 && <AttachmentTray attachments={visible.attachments} readonly />}
        {message.streamState === 'incomplete' && <p className="row-note faint">The response stopped before it finished.</p>}
        {!user && message.submission_id && <TurnVisuals submissionId={message.submission_id} />}
        {!user && !message.pending && message.submission_id && <TurnTools submissionId={message.submission_id} />}
      </div>
    </article>
  );
});

function WorkingLine() {
  const step = useStore(chatStore, state => {
    const turns = state.activity.turns;
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].state === 'running' && turns[i].lane !== 'also') {
        const running = runningStep(turns[i]);
        return running ? describeStep(running).title : turns[i].writing ? 'Writing' : '';
      }
    }
    return '';
  });
  return (
    <p className="working-line">
      <span className="dot live" />
      <span>{step || 'Working'}</span>
      <button className="link-button" onClick={() => appStore.set({inspectorOpen: true, inspectorTab: 'activity'})}>Show steps</button>
    </p>
  );
}

/** Visuals this request showed, each a click from its window. */
function TurnVisuals({submissionId}: {submissionId: string}) {
  const visuals = useStore(visualStore, state => Object.values(state.known).filter(v => v.submission_id === submissionId).map(v => state.live.find(l => l.id === v.id) || v), shallowEqual);
  if (!visuals.length) return null;
  return (
    <div className="turn-visuals">
      {visuals.map(visual => {
        const status = statusLabel(visual);
        return (
          <button key={visual.id} className={`turn-visual${visual.waiting ? ' is-waiting' : ''}`} onClick={() => openVisual(visual)} title="Open in the visual window">
            <VisualIcon kind={visual.kind} size={15} />
            <span className="turn-visual-text">
              <span className="turn-visual-title">{visual.title}</span>
              <span className="faint">{kindNames[visual.kind] || 'Visual'}</span>
            </span>
            <span className={`tag ${status.tone}`}>{visual.waiting && <span className="dot live" aria-hidden="true" />}{status.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function TurnTools({submissionId}: {submissionId: string}) {
  const turn = useStore(chatStore, state => state.activity.turns.find(t => t.id === submissionId)) as Turn | undefined;
  const [open, setOpen] = useState(false);
  if (!turn) return null;
  const tools = turn.steps.filter(step => step.kind === 'tool');
  if (!tools.length) return null;
  const blocked = tools.filter(step => step.state === 'blocked');
  const failed = tools.filter(step => step.state === 'error');
  const total = turn.endedAt && turn.startedAt ? Date.parse(turn.endedAt) - Date.parse(turn.startedAt) : undefined;
  return (
    <div className="turn-tools">
      <button type="button" className="turn-tools-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <ChevronRight size={13} className="thinking-chevron" />
        Used {tools.length} tool{tools.length === 1 ? '' : 's'}{total ? ` in ${formatDuration(total)}` : ''}
        {blocked.length > 0 && <span className="tag bad"><ShieldAlert size={11} />{blocked.length} blocked</span>}
        {failed.length > 0 && <span className="tag bad">{failed.length} failed</span>}
      </button>
      {open && (
        <ul className="turn-tools-list">
          {tools.map(step => (
            <li key={step.key}>
              <button className="link-button" onClick={() => appStore.set({inspectorOpen: true, inspectorTab: 'activity', focusStep: step.key})}>
                {describeStep(step).title}
              </button>
              {step.state === 'blocked' && step.permission?.reason && <span className="turn-tools-why faint">{step.permission.reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyConversation() {
  const projects = useStore(appStore, state => state.projects);
  const mcp = useStore(appStore, state => state.mcp);
  const primary = projects?.projects.find(p => p.id === projects.primary_project_id);
  const enabled = mcp.filter(server => server.enabled);
  const failing = enabled.filter(server => server.state === 'error');
  return (
    <div className="welcome">
      <h1>What should NullBot work on?</h1>
      <p className="muted">
        {primary ? <>Working in <strong>{primary.name}</strong> ({permissionLabel(primary.permission, primary.allow).toLowerCase()}). </> : 'No project is set up yet. '}
        {enabled.length ? <>Tools from {enabled.map(s => s.name.replace(/^NullBot\s+/i, '').replace(/\s+MCP$/i, '')).join(', ')}.</> : 'No tool servers are enabled.'}
      </p>
      {failing.length > 0 && <p className="notice bad">{failing.map(s => s.name).join(', ')} failed to start. <button className="link-button" onClick={() => {appStore.set({selectedServer: failing[0].id, toolsTab: 'servers'}); setView('tools');}}>See why</button></p>}
      <p className="faint">
        Type <kbd>/</kbd> for commands and skills, <kbd>Ctrl</kbd> <kbd>K</kbd> for everything else. Change what NullBot can touch in{' '}
        <button className="link-button" onClick={() => openSettings('projects')}>Projects</button> and{' '}
        <button className="link-button" onClick={() => setView('tools')}>Tools</button>.
      </p>
    </div>
  );
}
