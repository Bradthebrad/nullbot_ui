// Visuals: everything the agent has shown, by project, with what the
// person sent back and every interaction recorded.
import {useEffect, useMemo, useState} from 'react';
import {FolderOpen, Search, SquareArrowOutUpRight, Trash2} from 'lucide-react';
import {useStore} from '../../lib/store';
import {api} from '../../lib/bindings';
import {formatDateTime, relativeTime} from '../../lib/format';
import type {VisualEvent, Visualization} from '../../lib/types';
import {appStore, setView} from '../../state/app';
import {kindNames, openVisual, visualStore} from '../../state/visuals';
import {confirmDialog} from '../../ui/dialogs';
import {Blank, DetailHeader, Facts, ListGroup, ListRow, Panes, Section, Spinner} from '../../ui/layout';
import {toast, toastError} from '../../ui/toast';
import {VisualIcon} from './visualIcons';
import {VisualSurface} from './VisualSurface';

type Sort = 'newest' | 'oldest' | 'project' | 'title';

export function statusLabel(v: Visualization): {label: string; tone: '' | 'warn' | 'ok' | 'bad'} {
  if (v.waiting) return {label: 'Waiting for you', tone: 'warn'};
  if (v.status === 'submitted') return {label: 'Answered', tone: 'ok'};
  if (v.status === 'dismissed') return {label: 'Skipped', tone: ''};
  return {label: 'Open', tone: ''};
}

function StatusChip({visual}: {visual: Visualization}) {
  const {label, tone} = statusLabel(visual);
  return <span className={`tag ${tone}`}>{label}</span>;
}

export function VisualsView() {
  const projects = useStore(appStore, state => state.projects);
  const version = useStore(appStore, state => state.versions.visuals || 0);
  const request = useStore(appStore, state => state.visualRequest);
  const live = useStore(visualStore, state => state.live);
  const [project, setProject] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [query, setQuery] = useState('');
  const [list, setList] = useState<Visualization[] | null>(null);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    let stale = false;
    api.visualizations(project).then(found => {
      if (!stale) setList(Array.isArray(found) ? found : []);
    }).catch(error => {
      if (!stale) setList([]);
      toastError(error);
    });
    return () => {
      stale = true;
    };
  }, [project, version, live.length]);

  useEffect(() => {
    if (request) {
      setSelected(request);
      appStore.set({visualRequest: ''});
    }
  }, [request]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const withLive = (list || []).map(v => ({...v, ...(live.find(l => l.id === v.id) || {})}));
    const filtered = withLive.filter(v => !q || `${v.title} ${v.prompt || ''} ${kindNames[v.kind] || ''}`.toLowerCase().includes(q));
    const by = {
      newest: (a: Visualization, b: Visualization) => b.created_at.localeCompare(a.created_at),
      oldest: (a: Visualization, b: Visualization) => a.created_at.localeCompare(b.created_at),
      title: (a: Visualization, b: Visualization) => a.title.localeCompare(b.title),
      project: (a: Visualization, b: Visualization) => (a.project_name || '').localeCompare(b.project_name || '') || b.created_at.localeCompare(a.created_at),
    }[sort];
    return filtered.sort(by);
  }, [list, live, query, sort]);

  const current = shown.find(v => v.id === selected) || shown[0];

  const groups = useMemo(() => {
    if (sort !== 'project') return [{name: '', items: shown}];
    const out: {name: string; items: Visualization[]}[] = [];
    for (const v of shown) {
      const name = v.project_name || 'No project';
      const group = out.find(g => g.name === name);
      if (group) group.items.push(v);
      else out.push({name, items: [v]});
    }
    return out;
  }, [shown, sort]);

  const listPane = (
    <div className="visuals-list">
      <div className="visuals-filters">
        <label className="files-filter visuals-search">
          <Search size={13} aria-hidden="true" />
          <input className="bare-input" value={query} placeholder="Search visuals" aria-label="Search visuals" onChange={event => setQuery(event.target.value)} />
        </label>
        <select className="select select-sm" aria-label="Project" value={project} onChange={event => setProject(event.target.value)}>
          <option value="">All projects</option>
          {(projects?.projects || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="select select-sm" aria-label="Sort" value={sort} onChange={event => setSort(event.target.value as Sort)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="project">By project</option>
          <option value="title">By title</option>
        </select>
      </div>
      {list === null ? <div className="visual-loading"><Spinner label="Loading" /></div> : !shown.length ? (
        <Blank title={query ? 'No visuals match' : 'No visuals yet'}>
          {query ? 'Try other words.' : 'When NullBot shows you a chart, picture, page or poll, it is kept here with what you sent back.'}
        </Blank>
      ) : groups.map(group => {
        const rows = group.items.map(v => (
          <ListRow
            key={v.id}
            selected={current?.id === v.id}
            onSelect={() => setSelected(v.id)}
            title={<span className="visual-row-title"><VisualIcon kind={v.kind} size={14} />{v.title}</span>}
            subtitle={`${kindNames[v.kind] || 'Visual'}${sort !== 'project' && v.project_name ? ` in ${v.project_name}` : ''}, ${relativeTime(v.created_at)}`}
            aside={<StatusChip visual={v} />}
          />
        ));
        return group.name ? <ListGroup key={group.name} title={group.name} count={group.items.length}>{rows}</ListGroup> : <div key="all" className="list-group">{rows}</div>;
      })}
    </div>
  );

  return (
    <div className="view visuals-view">
      <Panes label="Visuals" listWidth={380} list={listPane} detail={current ? <VisualDetail key={current.id} visual={current} onDeleted={() => {
        setSelected('');
        setList(items => (items || []).filter(v => v.id !== current.id));
      }} /> : <Blank title="Nothing selected">Pick a visual to see it and what was sent back.</Blank>} />
    </div>
  );
}

function VisualDetail({visual, onDeleted}: {visual: Visualization; onDeleted: () => void}) {
  const [events, setEvents] = useState<VisualEvent[] | null>(null);
  // Pages and drawings run their own scripts: they start when asked, not
  // just because a row was selected.
  const [running, setRunning] = useState(visual.kind !== 'html' && visual.kind !== 'svg');
  useEffect(() => {
    let stale = false;
    api.visualEvents(visual.id, 2000).then(found => {
      if (!stale) setEvents(Array.isArray(found) ? found : []);
    }).catch(() => !stale && setEvents([]));
    return () => {
      stale = true;
    };
  }, [visual.id, visual.events, visual.updated_at]);

  async function remove() {
    if (visual.waiting) return toast('NullBot is waiting for an answer to this one. Send or skip it first.', 'error');
    if (!(await confirmDialog({title: `Delete “${visual.title}”?`, body: 'Its content, the answer and every recorded interaction are deleted. This can’t be undone.', confirmLabel: 'Delete', danger: true}))) return;
    try {
      await api.deleteVisualization(visual.id);
      toast(`Deleted ${visual.title}.`);
      onDeleted();
    } catch (error) {
      toastError(error);
    }
  }

  const errors = (events || []).filter(isErrorEvent).length;
  return (
    <div className="detail visual-detail">
      <DetailHeader
        title={<span className="visual-row-title"><VisualIcon kind={visual.kind} size={16} />{visual.title}</span>}
        subtitle={`${kindNames[visual.kind] || 'Visual'}, shown ${formatDateTime(visual.created_at)}`}
        actions={
          <>
            <button className="btn btn-primary" onClick={() => openVisual(visual)}><SquareArrowOutUpRight size={13} />{visual.status === 'open' ? 'Open to answer' : 'Open'}</button>
            <button className="btn btn-ghost btn-icon" title="Show its folder" aria-label="Show its folder" onClick={() => void api.revealVisualization(visual.id).catch(toastError)}><FolderOpen size={15} /></button>
            <button className="btn btn-ghost btn-icon btn-danger" title="Delete" aria-label="Delete" onClick={() => void remove()}><Trash2 size={15} /></button>
          </>
        }
      />
      <div className="detail-body">
        <div className="visual-detail-status"><StatusChip visual={visual} />{visual.responded_at && <span className="muted">{visual.status === 'dismissed' ? 'Skipped' : 'Answered'} {formatDateTime(visual.responded_at)}</span>}</div>
        {visual.prompt && <p className="visual-prompt is-inline">{visual.prompt}</p>}
        <figure className="visual-preview">
          <div className="visual-preview-box">
            {running ? <VisualSurface visual={visual} mode="preview" /> : (
              <div className="visual-preview-idle">
                <p className="muted">This {visual.kind === 'svg' ? 'drawing' : 'page'} runs its own scripts.</p>
                <button className="btn" onClick={() => setRunning(true)}>Show preview</button>
              </div>
            )}
          </div>
          <figcaption className="faint">A preview: what you do here isn’t recorded. Open it to answer.</figcaption>
        </figure>
        {(visual.response != null || visual.note) && (
          <Section title="What was sent">
            {visual.response != null && <ResponseView visual={visual} />}
            {visual.note && <blockquote className="visual-note-quote">{visual.note}</blockquote>}
          </Section>
        )}
        <Section title={`Interactions${events ? ` (${events.length}${visual.events > events.length ? ` of ${visual.events}` : ''})` : ''}`} actions={errors ? <span className="tag bad">{errors} script error{errors === 1 ? '' : 's'}</span> : undefined}>
          {events === null ? <Spinner label="Loading" /> : events.length ? <InteractionLog events={events} /> : <p className="muted">Nothing recorded yet.</p>}
        </Section>
        <Section title="Details">
          <Facts items={[
            ['Project', visual.project_name],
            ['Shows', visual.source ? <span className="mono">{visual.source}</span> : undefined],
            ['Saved in', <span className="mono">{visual.dir}</span>],
            ['Internet', visual.allow_network ? 'Allowed' : 'Off'],
            ['NullBot waited', visual.wait ? 'Yes' : 'No, the answer arrives as a message'],
          ]} />
        </Section>
      </div>
    </div>
  );
}

function ResponseView({visual}: {visual: Visualization}) {
  const response = visual.response as any;
  if (visual.kind === 'poll' && response && Array.isArray(response.selected)) {
    const labels = new Map((visual.options || []).map(o => [o.id, o.label]));
    return (
      <ul className="visual-answer">
        {response.selected.map((id: string) => <li key={id}>{labels.get(id) || id}</li>)}
        {response.other && <li>Something else: {String(response.other)}</li>}
        {!response.selected.length && !response.other && <li className="muted">Nothing chosen</li>}
      </ul>
    );
  }
  if (response && Array.isArray(response.points)) {
    return (
      <table className="table visual-points">
        <thead><tr><th>#</th><th>Label</th><th className="num-col">x</th><th className="num-col">y</th></tr></thead>
        <tbody>{response.points.map((p: any) => <tr key={p.n}><td className="num">{p.n}</td><td>{p.label || ''}</td><td className="num num-col">{p.x}</td><td className="num num-col">{p.y}</td></tr>)}</tbody>
      </table>
    );
  }
  return <pre className="source-text visual-json">{JSON.stringify(response, null, 2)}</pre>;
}

export function isErrorEvent(e: VisualEvent): boolean {
  return e.type === 'error' || e.type === 'rejection' || e.type === 'resource_error' || (e.type === 'console' && e.level === 'error');
}

const eventNames: Record<string, string> = {
  load: 'Opened', click: 'Click', change: 'Changed', form_submit: 'Form sent', key: 'Key', error: 'Script error', rejection: 'Script error',
  resource_error: 'Didn’t load', console: 'Console', dialog: 'Dialog', navigate: 'Moved', custom: 'Logged', pin: 'Marked', unpin: 'Unmarked',
  clear_pins: 'Cleared marks', chart_click: 'Picked', legend: 'Legend', select: 'Chose', unselect: 'Unchose', image_click: 'Click', page: 'Page',
  link_blocked: 'Link blocked', dropped: 'Not recorded',
};

export function describeVisualEvent(e: VisualEvent): string {
  const value = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
  const parts: string[] = [];
  if (e.target) parts.push(String(e.target));
  if (e.name && e.type !== 'console') parts.push(String(e.name));
  if (e.label && !String(e.target || '').includes(String(e.label))) parts.push(String(e.label));
  if (e.key) parts.push(String(e.key));
  if (e.value !== undefined && e.value !== '') parts.push(`= ${value(e.value)}`);
  if (e.message) parts.push(String(e.message));
  if (e.text) parts.push(String(e.text));
  if (e.url) parts.push(String(e.url));
  if (e.source) parts.push(`(${e.source})`);
  if (e.type === 'pin' || e.type === 'image_click') parts.push(`at ${e.x}, ${e.y}`);
  if (e.data !== undefined && e.type === 'custom') parts.push(value(e.data));
  if (e.type === 'dropped') parts.push(`${e.count} interactions`);
  if (e.type === 'load' && e.page) parts.push(String(e.page) === '/' ? '' : String(e.page));
  return parts.join(' ').slice(0, 400);
}

export function InteractionLog({events}: {events: VisualEvent[]}) {
  const start = events.find(e => typeof e.t === 'number')?.t ?? 0;
  return (
    <div className="table-scroll visual-log">
      <table className="table">
        <thead><tr><th className="num-col">Time</th><th>What</th><th>Detail</th></tr></thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i} className={isErrorEvent(e) ? 'is-error' : undefined}>
              <td className="num num-col faint">{typeof e.t === 'number' ? `+${((e.t - start) / 1000).toFixed(1)}s` : ''}</td>
              <td>{eventNames[e.type] || e.type}</td>
              <td className="visual-log-detail">{describeVisualEvent(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Opens the Visuals view on one visual. */
export function showInVisuals(id: string) {
  appStore.set({visualRequest: id});
  setView('visuals');
}
