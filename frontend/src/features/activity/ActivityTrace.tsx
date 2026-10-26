import {memo, useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ChevronRight, ExternalLink} from 'lucide-react';
import {useStore} from '../../lib/store';
import {chatStore} from '../../state/chat';
import {appStore, openSettings} from '../../state/app';
import {api} from '../../lib/bindings';
import {capabilityLabel, formatDuration, formatTime, permissionLabel, shorten} from '../../lib/format';
import {useNow} from '../../lib/useNow';
import {CopyButton, Markdown} from '../../ui/Markdown';
import {describeStep, hostOf, resultLinks, stepSource} from './describe';
import {stepDuration, type Step, type Turn} from './model';
import {StepIcon} from './StepIcon';
import {isTranscriptNearBottom} from '../chat/transcript';

/** The inspector's flight-recorder view of what the agent is doing. */
export function ActivityTrace() {
  const turns = useStore(chatStore, state => state.activity.turns);
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [expandedTurns, setExpandedTurns] = useState<Record<string, boolean>>({});
  const focusStep = useStore(appStore, state => state.focusStep);
  const toggle = useCallback((id: string, fallback: boolean) => setExpandedTurns(current => ({...current, [id]: !(current[id] ?? fallback)})), []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  // Jump to a step: expand its turn first if it is collapsed, then focus it.
  useEffect(() => {
    if (!focusStep) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-step="${CSS.escape(focusStep)}"]`);
    if (el) {
      follow.current = false;
      el.scrollIntoView({block: 'center'});
      el.querySelector<HTMLButtonElement>('.step-main')?.focus();
      appStore.set({focusStep: ''});
      return;
    }
    const turn = chatStore.get().activity.turns.find(t => t.steps.some(s => s.key === focusStep));
    if (!turn || expandedTurns[turn.id] === true) {
      appStore.set({focusStep: ''});
      return;
    }
    setExpandedTurns(current => ({...current, [turn.id]: true}));
  }, [focusStep, expandedTurns]);

  if (!turns.length) {
    return (
      <div className="trace-empty">
        <p>Each step NullBot takes shows up here as it happens: which tool it used, what came back, and anything your project permissions blocked.</p>
      </div>
    );
  }
  const recent = new Set(turns.slice(-3).map(turn => turn.id));
  return (
    <div className="trace" ref={scroller} onScroll={event => {follow.current = isTranscriptNearBottom(event.currentTarget);}}>
      {turns.map(turn => {
        const fallback = recent.has(turn.id) || turn.state === 'running';
        return <TurnBlock key={turn.id} turn={turn} expanded={expandedTurns[turn.id] ?? fallback} fallback={fallback} onToggle={toggle} focusKey={focusStep} />;
      })}
    </div>
  );
}

function questionFor(messages: any[], turnID: string): string {
  for (const message of messages) {
    if (message.role === 'user' && message.submission_id === turnID) return String(message.content || '').replace(/@file\([^)]*\)/g, '').trim();
  }
  return '';
}

const TurnBlock = memo(function TurnBlock({turn, expanded, fallback, onToggle, focusKey}: {turn: Turn; expanded: boolean; fallback: boolean; onToggle: (id: string, fallback: boolean) => void; focusKey: string}) {
  const question = useStore(chatStore, state => questionFor(state.messages, turn.id));
  const running = turn.state === 'running';
  const now = useNow(running);
  const elapsed = turn.endedAt ? Date.parse(turn.endedAt) - Date.parse(turn.startedAt || '') : running ? now - Date.parse(turn.startedAt || '') : NaN;
  const tools = turn.steps.filter(step => step.kind === 'tool').length;
  const label = question ? `“${shorten(question, 90)}”` : turn.id === 'session' ? 'Outside a request' : `Request at ${formatTime(turn.startedAt)}`;
  return (
    <section className={`turn turn-${turn.state} ${turn.lane === 'also' ? 'turn-side' : ''}`} aria-label={label}>
      <button type="button" className="turn-head" aria-expanded={expanded} onClick={() => onToggle(turn.id, fallback)}>
        <ChevronRight size={14} className="turn-chevron" />
        <span className="turn-label">{turn.lane === 'also' && <span className="turn-lane">Side question</span>}{label}</span>
        <span className="turn-meta num">
          {running ? <span className="dot live" /> : turn.state === 'error' ? <span className="dot bad" /> : null}
          {Number.isFinite(elapsed) ? formatDuration(elapsed) : ''}
        </span>
      </button>
      {expanded ? (
        <ol className="steps">
          {turn.steps.map(step => <StepRow key={step.key} step={step} focused={!!focusKey && focusKey === step.key} />)}
          {running && turn.writing && <PseudoStep text="Writing the answer" />}
          {running && !turn.writing && !turn.steps.some(step => step.state === 'running') && <PseudoStep text={turn.steps.length ? 'Deciding what to do next' : 'Working on it'} />}
          {turn.state === 'canceled' && <li className="step step-note"><span className="step-marker" /><div className="step-main static"><span className="step-title faint">Stopped</span></div></li>}
        </ol>
      ) : (
        <p className="turn-collapsed faint">{tools ? `${tools} tool call${tools === 1 ? '' : 's'}` : `${turn.steps.length} step${turn.steps.length === 1 ? '' : 's'}`}</p>
      )}
    </section>
  );
});

function PseudoStep({text}: {text: string}) {
  return (
    <li className="step step-running step-pseudo">
      <span className="step-marker"><span className="dot live" /></span>
      <div className="step-main static"><span className="step-title muted">{text}</span></div>
    </li>
  );
}

const StepRow = memo(function StepRow({step, focused}: {step: Step; focused: boolean}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (focused) setOpen(true);
  }, [focused]);
  const description = describeStep(step);
  const now = useNow(step.state === 'running');
  const duration = stepDuration(step, now);
  const source = stepSource(step);
  const expandable = step.kind === 'tool' || (step.kind === 'thinking' && !!step.text);
  return (
    <li className={`step step-${step.state} step-${step.kind} ${step.agentName ? 'step-sub' : ''}`} data-step={step.key}>
      <span className="step-marker" aria-hidden="true"><StepIcon step={step} category={description.category} /></span>
      <button type="button" className="step-main" aria-expanded={expandable ? open : undefined} disabled={!expandable} onClick={() => setOpen(value => !value)}>
        <span className="step-title">{description.title}</span>
        <span className="step-time num">{duration != null && step.kind !== 'note' && !(step.kind === 'thinking' && duration < 50) ? formatDuration(duration) : ''}</span>
        {(source || description.detail) && (
          <span className="step-line">
            {source && <span className="step-source">{source}</span>}
            {description.detail && <span className="step-detail">{description.detail}</span>}
          </span>
        )}
      </button>
      {open && expandable && (step.kind === 'thinking' ? <div className="step-body"><Markdown className="prose prose-sm">{step.text || ''}</Markdown></div> : <StepDetail step={step} />)}
    </li>
  );
});

function pathOf(link: string): string {
  try {
    return new URL(link).pathname;
  } catch {
    return '';
  }
}

/** The project's permission as people set it, including Custom's extras. */
function useProjectPermission(name?: string, fallback?: string): string {
  const project = useStore(appStore, state => state.projects?.projects.find(p => p.name === name || p.id === name));
  return project ? permissionLabel(project.permission, project.allow) : permissionLabel(fallback);
}

function StepDetail({step}: {step: Step}) {
  const args = Object.entries(step.args || {});
  const links = resultLinks(step);
  const perm = step.permission;
  const projectPermission = useProjectPermission(perm?.project, perm?.permission);
  return (
    <div className="step-body">
      {step.state === 'blocked' && perm && (
        <div className="notice bad step-blocked">
          <div>
            <p><strong>Not run.</strong> {perm.reason}</p>
            <p className="muted">This call needs {capabilityLabel(perm.capability).toLowerCase()} access{perm.project ? ` in ${perm.project}` : ''}{perm.permission ? `, which is ${projectPermission.toLowerCase()}` : ''}. Change the project’s permission, or change what this tool is treated as needing on the Tools page.</p>
            <div className="btn-row">
              <button className="btn btn-sm" onClick={() => openSettings('projects')}>Project permissions</button>
              {step.server && <button className="btn btn-sm" onClick={() => appStore.set({view: 'tools', toolsTab: 'servers', selectedServer: step.server || ''})}>Tool settings</button>}
            </div>
          </div>
        </div>
      )}
      {args.length > 0 && (
        <div className="kv">
          <h4>Arguments</h4>
          <table>
            <tbody>
              {args.map(([key, value]) => (
                <tr key={key}>
                  <th scope="row">{key}</th>
                  <td><ArgValue value={value} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {step.error && step.state === 'error' && (
        <div className="kv">
          <h4>Error</h4>
          <pre className="step-text bad-text">{step.error}</pre>
        </div>
      )}
      {links.length > 0 && (
        <div className="kv">
          <h4>Links</h4>
          <ul className="link-list">
            {links.map(link => (
              <li key={link}>
                <a href={link} className="link-external" title={link}>{hostOf(link)}<span className="faint"> {shorten(pathOf(link), 40)}</span></a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {step.result && (
        <div className="kv">
          <h4>Returned</h4>
          <pre className="step-text">{step.result}</pre>
        </div>
      )}
      {perm && perm.allowed && (
        <p className="step-perm faint">
          <span title={perm.rule}>Allowed: needs {capabilityLabel(perm.capability).toLowerCase()} access</span>{perm.project ? <> in {perm.project}, which is set to {projectPermission.toLowerCase()}</> : null}.
        </p>
      )}
      <div className="step-foot">
        <CopyButton text={JSON.stringify({tool: step.tool, server: step.server, args: step.args, result: step.result, error: step.error, permission: step.permission, duration_ms: step.durationMs}, null, 2)} label="Copy details" />
        {step.server && <button className="btn btn-ghost btn-sm" onClick={() => appStore.set({view: 'tools', toolsTab: 'servers', selectedServer: step.server || ''})}><ExternalLink size={13} />{step.serverTitle || step.server}</button>}
      </div>
    </div>
  );
}

function ArgValue({value}: {value: unknown}) {
  const [full, setFull] = useState(false);
  if (value == null) return <span className="faint">none</span>;
  if (typeof value === 'boolean' || typeof value === 'number') return <span className="mono">{String(value)}</span>;
  if (typeof value === 'string') {
    const pathy = /^([a-zA-Z]:[\\/]|\/|~\/|\.\.?\/)/.test(value) || /^https?:\/\//.test(value);
    const long = value.length > 160;
    const shown = long && !full ? `${value.slice(0, 160)}…` : value;
    return (
      <span className={pathy ? 'mono arg-text' : 'arg-text'}>
        {shown}
        {long && <button className="link-button" onClick={() => setFull(v => !v)}>{full ? 'less' : 'more'}</button>}
      </span>
    );
  }
  const json = JSON.stringify(value, null, 1);
  return <span className="mono arg-text">{json.length > 240 && !full ? `${json.slice(0, 240)}…` : json}{json.length > 240 && <button className="link-button" onClick={() => setFull(v => !v)}>{full ? 'less' : 'more'}</button>}</span>;
}

export async function openLink(url: string) {
  await api.openExternal(url);
}
