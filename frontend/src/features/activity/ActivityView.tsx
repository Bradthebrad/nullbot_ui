import {useEffect, useMemo, useState} from 'react';
import {CalendarClock, Pencil, Play, Plus, Square, Trash2} from 'lucide-react';
import {useStore} from '../../lib/store';
import {api} from '../../lib/bindings';
import {useResource} from '../../lib/useResource';
import {useNow} from '../../lib/useNow';
import {between, elapsedSince, firstLine, formatCount, formatDateTime, formatDuration, formatTime, humanizeName, relativeTime, statusText, statusTone} from '../../lib/format';
import type {AgentTask, Plan, PlanStep, PlanSummary, ScheduledTask} from '../../lib/types';
import {appStore, setView} from '../../state/app';
import {Tabs} from '../../ui/Tabs';
import {Blank, DetailHeader, Facts, ListGroup, ListRow, Panes, Section, Spinner, StatusTag} from '../../ui/layout';
import {Markdown} from '../../ui/Markdown';
import {confirmDialog, promptDialog} from '../../ui/dialogs';
import {toast, toastError} from '../../ui/toast';

export function ActivityView() {
  const tab = useStore(appStore, state => state.activityTab);
  return (
    <div className="view">
      <div className="view-tabs">
        <Tabs
          label="Activity"
          value={tab}
          onChange={value => appStore.set({activityTab: value})}
          tabs={[
            {id: 'runs', label: 'Runs'},
            {id: 'plans', label: 'Plans'},
            {id: 'schedules', label: 'Schedules'},
          ]}
        />
      </div>
      {tab === 'runs' ? <RunsTab /> : tab === 'plans' ? <PlansTab /> : <SchedulesTab />}
    </div>
  );
}

// -------------------------------------------------------------------- runs

const isLive = (task: AgentTask) => task.status === 'running' || task.status === 'canceling';

function RunsTab() {
  const initial = useStore(appStore, state => state.ui?.tasks);
  const {data, setData, error} = useResource(api.tasks, {topics: ['tasks'], initial});
  const tasks = useMemo(() => [...(data || [])].sort((a, b) => Date.parse(b.started_at || '') - Date.parse(a.started_at || '')), [data]);
  const [selected, setSelected] = useState('');
  const live = tasks.filter(isLive);
  const recent = tasks.filter(task => !isLive(task));
  const now = useNow(live.length > 0);
  const current = tasks.find(task => task.id === selected) || live[0] || recent[0];

  const row = (task: AgentTask) => (
    <ListRow
      key={task.id}
      selected={task.id === current?.id}
      onSelect={() => setSelected(task.id)}
      tone={statusTone(task.status)}
      title={task.name || humanizeName(task.role) || task.id}
      subtitle={isLive(task) ? task.current || 'Working' : task.error ? firstLine(task.error, 80) : firstLine(task.result || task.prompt, 80)}
      meta={isLive(task) ? formatDuration(elapsedSince(task.started_at, now)) : relativeTime(task.finished_at || task.updated_at, now)}
    />
  );

  return (
    <Panes
      label="Runs"
      list={
        <>
          {error && <p className="notice bad pane-notice">{error}</p>}
          {!tasks.length && <p className="pane-empty faint">Runs started by NullBot, plans and schedules show up here.</p>}
          {live.length > 0 && <ListGroup title="Running" count={live.length}>{live.map(row)}</ListGroup>}
          {recent.length > 0 && <ListGroup title="Recent" count={recent.length}>{recent.map(row)}</ListGroup>}
        </>
      }
      detail={current ? <RunDetail task={current} now={now} onTasks={setData} /> : <Blank title="No runs yet">When NullBot hands work to a subagent, runs a plan or fires a schedule, each run is listed here with its tools and token use.</Blank>}
    />
  );
}

function RunDetail({task, now, onTasks}: {task: AgentTask; now: number; onTasks: (tasks: AgentTask[]) => void}) {
  const [stopping, setStopping] = useState(false);
  const live = isLive(task);
  const duration = live ? elapsedSince(task.started_at, now) : between(task.started_at, task.finished_at || task.updated_at);
  const tokens = task.tokens || {};
  const cached = (tokens.cached_input || 0) + (tokens.cache_creation_input || 0);
  const calls = task.tool_calls || [];
  return (
    <div className="detail">
      <DetailHeader
        title={task.name || humanizeName(task.role) || task.id}
        status={task.status}
        subtitle={[humanizeName(task.role), duration != null ? formatDuration(duration) : ''].filter(Boolean).join(', ')}
        actions={
          <>
            {task.submission_id && (
              <button className="btn" onClick={() => {
                appStore.set({inspectorOpen: true, inspectorTab: 'activity'});
                setView('chat');
              }}>Show steps in chat</button>
            )}
            {task.cancelable && live && (
              <button className="btn btn-danger" disabled={stopping} onClick={async () => {
                setStopping(true);
                try {
                  onTasks(await api.cancelTask(task.id));
                  toast('Stopping the run.');
                } catch (error) {
                  toastError(error);
                } finally {
                  setStopping(false);
                }
              }}><Square size={12} />Stop run</button>
            )}
          </>
        }
      />
      <div className="detail-body">
        {live && task.current && (
          <p className="working-line"><span className="dot live" />{task.current}</p>
        )}
        {task.error && <div className="notice bad"><div><strong>The run failed.</strong> {task.error}</div></div>}
        {task.prompt && (
          <Section title="Asked to">
            <Collapsible text={task.prompt} />
          </Section>
        )}
        {task.result && (
          <Section title="Result">
            <Markdown className="prose">{task.result}</Markdown>
          </Section>
        )}
        <Section title="Details">
          <Facts items={[
            ['Started', formatDateTime(task.started_at)],
            ['Finished', task.finished_at ? formatDateTime(task.finished_at) : live ? 'Still running' : ''],
            ['Tokens in', tokens.input ? formatCount(tokens.input) : ''],
            ['Tokens out', tokens.output ? formatCount(tokens.output) : ''],
            ['From cache', cached ? formatCount(cached) : ''],
            ['Reasoning', tokens.reasoning_output ? formatCount(tokens.reasoning_output) : ''],
            ['Run ID', <span className="mono">{task.id}</span>],
          ]} />
        </Section>
        {calls.length > 0 && (
          <Section title={`Tools used (${calls.length})`}>
            <ol className="calls">
              {calls.slice(-40).map((call, index) => (
                <li key={`${call.time}-${index}`} className={`call call-${statusTone(call.status)}`}>
                  <span className={`dot ${statusTone(/error|fail/i.test(call.status) ? 'error' : /start|run/i.test(call.status) ? 'running' : 'done')}`} />
                  <span className="call-name">{humanizeName(call.name)}</span>
                  {call.detail && <span className="call-detail faint">{firstLine(call.detail, 90)}</span>}
                  <time className="faint num">{formatTime(call.time)}</time>
                </li>
              ))}
            </ol>
          </Section>
        )}
      </div>
    </div>
  );
}

function Collapsible({text, limit = 420}: {text: string; limit?: number}) {
  const [open, setOpen] = useState(false);
  const long = text.length > limit;
  return (
    <div className="collapsible">
      <p className="pre-wrap">{long && !open ? `${text.slice(0, limit).trimEnd()}…` : text}</p>
      {long && <button className="link-button" onClick={() => setOpen(v => !v)}>{open ? 'Show less' : 'Show all'}</button>}
    </div>
  );
}

// ------------------------------------------------------------------- plans

const doneStatus = (status?: string) => /^(done|complete|completed|skipped)$/i.test(String(status || ''));

function planCounts(plan?: Plan) {
  const steps = plan?.steps || [];
  return {done: steps.filter(step => doneStatus(step.status)).length, total: steps.length};
}

function PlansTab() {
  const {data, setData, error} = useResource(api.plans, {topics: ['tasks']});
  const plans: PlanSummary[] = data?.data?.plans || [];
  const [selectedID, setSelectedID] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);
  const currentID = selectedID || plans[0]?.id || '';
  const version = useStore(appStore, state => state.versions.tasks || 0);

  useEffect(() => {
    if (!currentID) {
      setPlan(null);
      return;
    }
    let active = true;
    api.readPlan(currentID).then(next => active && setPlan(next)).catch(() => active && setPlan(null));
    return () => {
      active = false;
    };
  }, [currentID, version]);

  async function create() {
    const goal = await promptDialog({title: 'New plan', label: 'What should the plan accomplish?', placeholder: 'For example: migrate the reports to the new schema', confirmLabel: 'Create plan', body: 'NullBot breaks the goal into steps. You can review and edit them before running the plan.'});
    if (!goal) return;
    setCreating(true);
    try {
      const reply = await api.createPlan(goal);
      if (reply.data?.error) throw new Error(reply.data.error);
      setData(reply);
      if (reply.data?.selected?.id) setSelectedID(reply.data.selected.id);
      toast('Plan created.', 'success');
    } catch (err) {
      toastError(err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Panes
      label="Plans"
      list={
        <>
          <div className="pane-toolbar">
            <button className="btn btn-sm" onClick={() => void create()} disabled={creating}>{creating ? <span className="spinner" /> : <Plus size={13} />}New plan</button>
          </div>
          {error && <p className="notice bad pane-notice">{error}</p>}
          {!plans.length && !creating && <p className="pane-empty faint">No plans yet. A plan is a goal broken into steps that NullBot works through in order.</p>}
          {plans.map(item => (
            <ListRow
              key={item.id}
              selected={item.id === currentID}
              onSelect={() => setSelectedID(item.id)}
              tone={statusTone(item.status === 'planned' ? 'idle' : item.status)}
              title={item.name || item.id}
              subtitle={item.goal ? firstLine(item.goal, 80) : statusText(item.status)}
              meta={item.progress?.replace(/ complete$/, '')}
            />
          ))}
        </>
      }
      detail={plan ? <PlanDetail key={plan.id} plan={plan} onReply={reply => {
        setData(reply);
        if (reply.data?.selected) setPlan(reply.data.selected);
      }} onDeleted={() => setSelectedID('')} /> : <Blank title={creating ? 'Creating the plan' : 'No plan selected'}>{creating ? <Spinner label="NullBot is breaking the goal into steps." /> : 'Create a plan, or pick one from the list.'}</Blank>}
    />
  );
}

function PlanDetail({plan, onReply, onDeleted}: {plan: Plan; onReply: (reply: any) => void; onDeleted: () => void}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');
  const [working, setWorking] = useState('');
  const {done, total} = planCounts(plan);
  const running = /running|executing|in.progress/i.test(plan.status || '') || plan.steps?.some(step => /running|in.progress/i.test(step.status || ''));

  async function execute() {
    setWorking('execute');
    try {
      const reply = await api.executePlan(plan.id);
      if (reply.data?.error) throw new Error(reply.data.error);
      onReply(reply);
      toast('Plan started. Follow it under Runs.', 'success');
    } catch (error) {
      toastError(error);
    } finally {
      setWorking('');
    }
  }
  async function save() {
    try {
      JSON.parse(raw);
    } catch (error) {
      toast(`The plan isn’t valid JSON: ${error instanceof Error ? error.message : error}`, 'error');
      return;
    }
    setWorking('save');
    try {
      const reply = await api.savePlan(plan.id, raw);
      if (reply.data?.error) throw new Error(reply.data.error);
      onReply(reply);
      setEditing(false);
      toast('Plan saved.', 'success');
    } catch (error) {
      toastError(error);
    } finally {
      setWorking('');
    }
  }
  async function remove() {
    if (!(await confirmDialog({title: `Delete “${plan.name || plan.id}”?`, body: 'The plan file is removed. Runs it already started are not affected.', confirmLabel: 'Delete plan', danger: true}))) return;
    try {
      const reply = await api.deletePlan(plan.id);
      onReply(reply);
      onDeleted();
      toast('Plan deleted.');
    } catch (error) {
      toastError(error);
    }
  }

  return (
    <div className="detail">
      <DetailHeader
        title={plan.name || plan.id}
        status={plan.status}
        subtitle={total ? `${done} of ${total} steps done` : 'No steps yet'}
        actions={
          <>
            <button className="btn" onClick={() => {
              setRaw(JSON.stringify(plan, null, 2));
              setEditing(v => !v);
            }}><Pencil size={13} />{editing ? 'Stop editing' : 'Edit'}</button>
            <button className="btn btn-ghost btn-icon" title="Delete plan" aria-label="Delete plan" onClick={() => void remove()}><Trash2 size={14} /></button>
            <button className="btn btn-primary" disabled={!!working || running || !total} onClick={() => void execute()}>{working === 'execute' ? <span className="spinner" /> : <Play size={13} />}{running ? 'Running' : done ? 'Continue plan' : 'Run plan'}</button>
          </>
        }
      />
      <div className="detail-body">
        {total > 0 && <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><span style={{width: `${(done / total) * 100}%`}} /></div>}
        {plan.goal && <p className="lede">{plan.goal}</p>}
        {editing ? (
          <Section title="Plan file" actions={<button className="btn btn-primary btn-sm" disabled={working === 'save'} onClick={() => void save()}>Save plan</button>}>
            <textarea className="textarea mono code-editor" spellCheck={false} value={raw} onChange={event => setRaw(event.target.value)} rows={24} />
            <p className="faint">Steps are objects with a title, an optional description, a status (pending, running, done) and optional substeps.</p>
          </Section>
        ) : (
          <ol className="plan-steps">
            {(plan.steps || []).map((step, index) => <PlanStepRow key={step.id || index} step={step} index={String(index + 1)} current={plan.current_step} />)}
          </ol>
        )}
        {!editing && (plan.notes || []).length > 0 && (
          <Section title="Notes">
            <ul className="plain-list">{plan.notes!.map((note, i) => <li key={i}>{note}</li>)}</ul>
          </Section>
        )}
        <p className="faint detail-foot">Updated {formatDateTime(plan.updated_at)}. Plan ID <span className="mono">{plan.id}</span>.</p>
      </div>
    </div>
  );
}

function PlanStepRow({step, index, current}: {step: PlanStep; index: string; current?: string}) {
  const tone = doneStatus(step.status) ? 'ok' : statusTone(step.status);
  const isCurrent = !!current && (current === step.id || current === index);
  return (
    <li className={`plan-step plan-step-${tone} ${isCurrent ? 'is-current' : ''}`}>
      <span className="plan-step-index num">{index}</span>
      <div className="plan-step-body">
        <div className="plan-step-title">
          <span>{step.title || step.name || 'Untitled step'}</span>
          {step.status && !/^pending$/i.test(step.status) && <StatusTag status={doneStatus(step.status) ? 'done' : step.status} />}
        </div>
        {step.description && <p className="muted">{step.description}</p>}
        {(step.substeps || []).length > 0 && (
          <ol className="plan-steps nested">
            {step.substeps!.map((sub, i) => <PlanStepRow key={sub.id || i} step={sub} index={`${index}.${i + 1}`} current={current} />)}
          </ol>
        )}
      </div>
    </li>
  );
}

// --------------------------------------------------------------- schedules

function defaultAt() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function SchedulesTab() {
  const initial = useStore(appStore, state => state.ui?.scheduled);
  const {data, setData, error} = useResource(api.scheduledTasks, {topics: ['tasks', 'schedules'], initial});
  const items = data || [];
  const [selected, setSelected] = useState('');
  const current = selected === 'new' ? undefined : items.find(item => item.id === selected) || items[0];
  const showForm = selected === 'new' || !items.length;
  return (
    <Panes
      label="Schedules"
      list={
        <>
          <div className="pane-toolbar">
            <button className="btn btn-sm" onClick={() => setSelected('new')}><Plus size={13} />New schedule</button>
          </div>
          {error && <p className="notice bad pane-notice">{error}</p>}
          {items.map(item => (
            <ListRow
              key={item.id}
              selected={!showForm && item.id === current?.id}
              onSelect={() => setSelected(item.id)}
              tone={statusTone(item.status === 'active' ? 'idle' : item.status)}
              title={item.name || firstLine(item.prompt, 60)}
              subtitle={item.repeat_every ? `Every ${item.repeat_every}` : item.next_run_at ? `Once, ${formatDateTime(item.next_run_at)}` : statusText(item.status)}
              meta={item.status === 'active' && item.next_run_at ? relativeIn(item.next_run_at) : ''}
            />
          ))}
        </>
      }
      detail={showForm ? <ScheduleForm onCreated={next => {
        setData(next);
        setSelected(next[next.length - 1]?.id || '');
      }} onCancel={items.length ? () => setSelected('') : undefined} /> : current ? <ScheduleDetail item={current} onChange={setData} /> : null}
    />
  );
}

function relativeIn(iso: string) {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'due';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} d`;
}

function ScheduleForm({onCreated, onCancel}: {onCreated: (items: ScheduledTask[]) => void; onCancel?: () => void}) {
  const [mode, setMode] = useState<'in' | 'at' | 'every'>('in');
  const [delay, setDelay] = useState('30m');
  const [at, setAt] = useState(defaultAt);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim()) return;
    setSaving(true);
    try {
      const req: Record<string, string> = {mode, prompt: prompt.trim()};
      if (name.trim()) req.name = name.trim();
      if (mode === 'at') req.at = at;
      if (mode === 'in') req.delay = delay;
      if (mode === 'every') req.every = delay;
      onCreated(await api.createScheduledTask(req));
      toast('Scheduled.', 'success');
    } catch (error) {
      toastError(error);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="detail" onSubmit={submit}>
      <DetailHeader title="New schedule" subtitle="NullBot runs the message in the background, in the primary project." />
      <div className="detail-body form-stack">
        <label className="field">
          <span>Message</span>
          <textarea className="textarea" rows={5} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="For example: summarize new issues in the tracker and save the summary to reports/" autoFocus />
        </label>
        <div className="form-row">
          <label className="field">
            <span>When</span>
            <select className="select" value={mode} onChange={event => setMode(event.target.value as typeof mode)}>
              <option value="in">After a delay</option>
              <option value="at">At a date and time</option>
              <option value="every">Repeatedly</option>
            </select>
          </label>
          {mode === 'at' ? (
            <label className="field">
              <span>Date and time</span>
              <input className="input" type="datetime-local" value={at} onChange={event => setAt(event.target.value)} />
            </label>
          ) : (
            <label className="field">
              <span>{mode === 'every' ? 'Every' : 'Delay'}</span>
              <input className="input" value={delay} onChange={event => setDelay(event.target.value)} placeholder="30m, 2h, 1d or daily" />
            </label>
          )}
          <label className="field">
            <span>Name (optional)</span>
            <input className="input" value={name} onChange={event => setName(event.target.value)} placeholder="Shown in the list" />
          </label>
        </div>
        <div className="form-actions">
          {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
          <button type="submit" className="btn btn-primary" disabled={saving || !prompt.trim()}><CalendarClock size={14} />Schedule</button>
        </div>
      </div>
    </form>
  );
}

function ScheduleDetail({item, onChange}: {item: ScheduledTask; onChange: (items: ScheduledTask[]) => void}) {
  const [working, setWorking] = useState('');
  async function act(kind: string, run: () => Promise<ScheduledTask[]>, done: string) {
    setWorking(kind);
    try {
      onChange(await run());
      toast(done);
    } catch (error) {
      toastError(error);
    } finally {
      setWorking('');
    }
  }
  const canStop = item.status === 'active' || item.status === 'running' || item.status === 'error';
  return (
    <div className="detail">
      <DetailHeader
        title={item.name || firstLine(item.prompt, 60)}
        status={item.status === 'active' ? undefined : item.status}
        subtitle={item.repeat_every ? `Repeats every ${item.repeat_every}` : 'Runs once'}
        actions={
          <>
            {canStop && <button className="btn" disabled={!!working} onClick={() => void act('cancel', () => api.cancelScheduledTask(item.id), 'Schedule stopped.')}>Stop schedule</button>}
            <button className="btn btn-ghost btn-icon" title="Delete schedule" aria-label="Delete schedule" disabled={!!working} onClick={async () => {
              if (await confirmDialog({title: 'Delete this schedule?', body: 'It will not run again. Past runs stay under Runs.', confirmLabel: 'Delete', danger: true})) void act('delete', () => api.deleteScheduledTask(item.id), 'Schedule deleted.');
            }}><Trash2 size={14} /></button>
            <button className="btn btn-primary" disabled={!!working} onClick={() => void act('run', () => api.runScheduledTaskNow(item.id), 'Started. Follow it under Runs.')}><Play size={13} />Run now</button>
          </>
        }
      />
      <div className="detail-body">
        {item.last_error && <div className="notice bad"><div><strong>The last run failed.</strong> {item.last_error}</div></div>}
        <Section title="Message">
          <p className="pre-wrap">{item.prompt}</p>
        </Section>
        <Section title="Timing">
          <Facts items={[
            ['Next run', item.status === 'active' && item.next_run_at ? `${formatDateTime(item.next_run_at)} (${relativeIn(item.next_run_at)})` : ''],
            ['Last run', item.last_run_at ? formatDateTime(item.last_run_at) : 'Not yet'],
            ['Runs so far', String(item.run_count || 0)],
            ['Schedule ID', <span className="mono">{item.id}</span>],
          ]} />
        </Section>
      </div>
    </div>
  );
}
