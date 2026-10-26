import {useEffect, useMemo, useRef, useState} from 'react';
import {MoreHorizontal, Package, Play, Plus, RefreshCw, RotateCw, Square} from 'lucide-react';
import {useStore} from '../../lib/store';
import {api} from '../../lib/bindings';
import {useResource} from '../../lib/useResource';
import {capabilityLabel, firstLine, formatCount, formatDateTime, formatDuration, relativeTime, shorten} from '../../lib/format';
import type {MCPServerStatus, MCPToolStatus, MarketPackage, SkillFile} from '../../lib/types';
import {appStore, applyUIState} from '../../state/app';
import {Tabs} from '../../ui/Tabs';
import {Blank, DetailHeader, Facts, ListGroup, ListRow, Panes, Section, Spinner, StatusTag} from '../../ui/layout';
import {MenuButton} from '../../ui/Menu';
import {CopyButton, Markdown} from '../../ui/Markdown';
import {confirmDialog} from '../../ui/dialogs';
import {toast, toastError} from '../../ui/toast';

export function ToolsView() {
  const tab = useStore(appStore, state => state.toolsTab);
  const servers = useStore(appStore, state => state.mcp);
  const failing = servers.filter(s => s.enabled && s.state === 'error').length;
  return (
    <div className="view">
      <div className="view-tabs">
        <Tabs
          label="Tools"
          value={tab}
          onChange={value => appStore.set({toolsTab: value})}
          tabs={[
            {id: 'servers', label: failing ? <>Tool servers <span className="dot bad" aria-label={`${failing} failing`} /></> : 'Tool servers', count: servers.length},
            {id: 'skills', label: 'Skills'},
            {id: 'market', label: 'Marketplace'},
          ]}
        />
      </div>
      {tab === 'servers' ? <ServersTab /> : tab === 'skills' ? <SkillsTab /> : <MarketTab />}
    </div>
  );
}

// ----------------------------------------------------------------- servers

const stateTone = (server: MCPServerStatus) => (!server.enabled ? 'off' : server.state === 'ready' ? 'ok' : server.state === 'error' ? 'bad' : server.state === 'starting' ? 'live' : 'idle');
const stateLabel = (server: MCPServerStatus) => (!server.enabled ? 'Off' : server.state === 'ready' ? 'Running' : server.state === 'error' ? 'Failed' : server.state === 'starting' ? 'Starting' : 'Starts when needed');
const shortName = (name: string) => name.replace(/^NullBot\s+/i, '').replace(/\s+MCP$/i, '') || name;

function ServersTab() {
  const servers = useStore(appStore, state => state.mcp);
  const selected = useStore(appStore, state => state.selectedServer);
  const [adding, setAdding] = useState(false);
  const sorted = useMemo(() => [...servers].sort((a, b) => Number(b.enabled) - Number(a.enabled) || shortName(a.name).localeCompare(shortName(b.name))), [servers]);
  const current = sorted.find(s => s.id === selected) || sorted[0];
  const on = sorted.filter(s => s.enabled);
  const off = sorted.filter(s => !s.enabled);
  const row = (server: MCPServerStatus) => (
    <ListRow
      key={server.id}
      selected={server.id === current?.id}
      onSelect={() => appStore.set({selectedServer: server.id})}
      tone={stateTone(server)}
      title={shortName(server.name)}
      subtitle={server.state === 'error' ? firstLine(server.error, 70) : `${server.remote ? 'Remote' : 'Local'}${server.tool_count ? `, ${server.tool_count} tools` : ''}`}
      meta={server.calls ? `${formatCount(server.calls)} calls` : ''}
    />
  );
  return (
    <>
      <Panes
        label="Tool servers"
        list={
          <>
            <div className="pane-toolbar">
              <button className="btn btn-sm" onClick={() => setAdding(true)}><Plus size={13} />Add server</button>
            </div>
            {!servers.length && <p className="pane-empty faint">No tool servers yet. Add one, or install one from the Marketplace.</p>}
            {on.length > 0 && <ListGroup title="On" count={on.length}>{on.map(row)}</ListGroup>}
            {off.length > 0 && <ListGroup title="Off" count={off.length}>{off.map(row)}</ListGroup>}
          </>
        }
        detail={current ? <ServerDetail key={current.id} summary={current} /> : <Blank title="Tool servers give NullBot more abilities">Each server adds tools, such as searching mail or reading a drive. Every call is checked against your project permissions first.</Blank>}
      />
      {adding && <AddServerDialog onClose={() => setAdding(false)} />}
    </>
  );
}

function ServerDetail({summary}: {summary: MCPServerStatus}) {
  const {data, setData, error, loading} = useResource(() => api.mcpServer(summary.id), {topics: ['mcp'], deps: [summary.id, summary.state, summary.tool_count]});
  const server = data || summary;
  const [working, setWorking] = useState('');
  const [query, setQuery] = useState('');

  async function act(kind: string, run: () => Promise<unknown>, done: string) {
    setWorking(kind);
    try {
      await run();
      toast(done, 'success');
    } catch (err) {
      toastError(err);
    } finally {
      setWorking('');
    }
  }
  const toggle = (action: 'enable' | 'disable' | 'remove') => act(action, async () => applyUIState(await api.toggleMCPServer(server.id, action)), action === 'remove' ? `Removed ${server.name}.` : action === 'enable' ? `${server.name} is on.` : `${server.name} is off.`);
  const running = server.state === 'ready' || server.state === 'starting';
  const tools = (server.tools || []).filter(tool => !query || `${tool.name} ${tool.title || ''} ${tool.description || ''}`.toLowerCase().includes(query.toLowerCase()));
  const command = [server.command, ...(server.args || [])].filter(Boolean).join(' ');

  return (
    <div className="detail">
      <DetailHeader
        title={server.name}
        subtitle={[stateLabel(server), server.server_name && server.server_name !== server.name ? `${server.server_name}${server.server_version ? ` ${server.server_version}` : ''}` : server.server_version].filter(Boolean).join(', ')}
        actions={
          <>
            {server.enabled && running && <button className="btn" disabled={!!working} onClick={() => void act('stop', () => api.stopMCPServer(server.id), `Stopped ${server.name}. It starts again when a tool is needed.`)}><Square size={12} />Stop</button>}
            {server.enabled && (
              <button className="btn btn-primary" disabled={!!working} onClick={() => void act('start', () => (running ? api.restartMCPServer(server.id) : api.startMCPServer(server.id)).then(next => setData(next)), `${server.name} is running.`)}>
                {working === 'start' ? <span className="spinner" /> : running ? <RotateCw size={13} /> : <Play size={13} />}
                {running ? 'Restart' : server.state === 'error' ? 'Try again' : 'Start'}
              </button>
            )}
            {!server.enabled && <button className="btn btn-primary" disabled={!!working} onClick={() => void toggle('enable')}>Turn on</button>}
            <MenuButton
              className="btn btn-ghost btn-icon"
              title="More"
              align="end"
              label={<MoreHorizontal size={16} />}
              items={[
                ...(server.enabled ? [{label: 'Turn off', onSelect: () => void toggle('disable')}, {kind: 'separator' as const}] : []),
                {label: 'Remove…', danger: true, onSelect: async () => {
                  if (await confirmDialog({title: `Remove ${server.name}?`, body: 'Its tools stop being available. Installed files are kept, so you can add it again later.', confirmLabel: 'Remove', danger: true})) void toggle('remove');
                }},
              ]}
            />
          </>
        }
      />
      <div className="detail-body">
        {server.state === 'error' && (
          <div className="notice bad">
            <div>
              <p><strong>{server.name} failed to start.</strong> {server.error}</p>
              {server.stderr && (
                <details className="stderr">
                  <summary>What the server printed</summary>
                  <pre className="source-text">{server.stderr}</pre>
                </details>
              )}
            </div>
          </div>
        )}
        {error && !data && <p className="notice bad">{error}</p>}
        <Section title="Connection">
          <Facts items={[
            [server.remote ? 'Address' : 'Program', command ? <span className="mono wrap">{command}<CopyButton text={command} label="Copy" /></span> : ''],
            ['Runs in', !server.remote && server.cwd ? <span className="mono wrap">{server.cwd}</span> : server.remote ? 'Remote service' : ''],
            ['Process', server.pid ? <span className="num">PID {server.pid}</span> : ''],
            ['Started', server.started_at ? formatDateTime(server.started_at) : ''],
            ['Last used', server.last_used_at ? relativeTime(server.last_used_at) : ''],
            ['Calls', server.calls ? `${formatCount(server.calls)}${server.errors ? `, ${server.errors} failed` : ''}` : ''],
            ['Typical time', server.avg_latency_ms ? formatDuration(server.avg_latency_ms) : ''],
            ['Restarts', server.restarts ? String(server.restarts) : ''],
          ]} />
        </Section>
        {server.instructions && (
          <Section title="Server notes">
            <details className="server-notes">
              <summary>{shorten(firstLine(server.instructions, 140), 140)}</summary>
              <Markdown className="prose prose-sm">{server.instructions}</Markdown>
            </details>
          </Section>
        )}
        <Section
          title={`Tools${server.tools?.length ? ` (${server.tools.length})` : ''}`}
          actions={server.tools && server.tools.length > 8 ? <input className="input input-sm" placeholder="Filter tools" value={query} onChange={event => setQuery(event.target.value)} aria-label="Filter tools" /> : undefined}
        >
          <p className="faint section-note">“Needs” is the access a call must have in the project it touches. Auto works it out from the server’s hints and the tool’s name; change it if a tool is classed wrongly.</p>
          {loading && !server.tools?.length ? <Spinner label="Loading tools" /> : !server.tools?.length ? (
            <p className="muted">{server.enabled ? (running ? 'This server offers no tools.' : 'Start the server to see its tools.') : 'Turn the server on to see its tools.'}</p>
          ) : (
            <table className="table tool-table">
              <thead><tr><th>Tool</th><th>Needs</th></tr></thead>
              <tbody>{tools.map(tool => <ToolRow key={tool.name} server={server.id} tool={tool} onChange={setData} />)}</tbody>
            </table>
          )}
        </Section>
      </div>
    </div>
  );
}

const policyOptions = [
  {id: 'auto', label: 'Auto'},
  {id: 'read', label: 'Read'},
  {id: 'write', label: 'Write'},
  {id: 'delete', label: 'Delete'},
  {id: 'execute', label: 'Run programs'},
  {id: 'blocked', label: 'Never allow'},
];

function ToolRow({server, tool, onChange}: {server: string; tool: MCPToolStatus; onChange: (status: MCPServerStatus) => void}) {
  const [open, setOpen] = useState(false);
  const policy = tool.policy || 'auto';
  const req = tool.requirement;
  const properties = Object.entries((tool.input_schema?.properties || {}) as Record<string, any>);
  const required = new Set<string>(tool.input_schema?.required || []);
  return (
    <>
      <tr className={req?.blocked ? 'is-blocked' : ''}>
        <td>
          <button type="button" className="tool-name" aria-expanded={open} onClick={() => setOpen(v => !v)}>
            <span className="tool-title">{tool.title || tool.name}</span>
            {tool.title && <span className="mono faint">{tool.name}</span>}
            {tool.destructive && <span className="tag bad">Destructive</span>}
            {tool.read_only && <span className="tag">Read only</span>}
          </button>
          {tool.description && <p className="tool-desc muted">{open ? tool.description : firstLine(tool.description, 140)}</p>}
        </td>
        <td className="tool-needs">
          <select
            className="select select-sm"
            value={policy}
            aria-label={`What ${tool.name} needs`}
            onChange={async event => {
              try {
                onChange(await api.setMCPToolPolicy(server, tool.name, event.target.value));
              } catch (error) {
                toastError(error);
              }
            }}
          >
            {policyOptions.map(option => (
              <option key={option.id} value={option.id}>
                {option.id === 'auto' && req && !req.blocked ? `Auto: ${capabilityLabel(req.capability).toLowerCase()}` : option.label}
              </option>
            ))}
          </select>
          {req?.reason && policy === 'auto' && <small className="faint" title={req.reason}>{shorten(req.reason, 60)}</small>}
        </td>
      </tr>
      {open && properties.length > 0 && (
        <tr className="tool-params">
          <td colSpan={2}>
            <table className="params">
              <tbody>
                {properties.map(([name, schema]) => (
                  <tr key={name}>
                    <th scope="row" className="mono">{name}{required.has(name) ? '' : <span className="faint">?</span>}</th>
                    <td className="faint mono">{schemaType(schema)}</td>
                    <td className="muted">{schema?.description || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function schemaType(schema: any): string {
  if (!schema) return '';
  if (Array.isArray(schema.enum)) return schema.enum.slice(0, 5).map((v: unknown) => JSON.stringify(v)).join(' | ');
  if (schema.type === 'array') return `${schemaType(schema.items) || 'any'}[]`;
  return Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type || (schema.anyOf ? 'any' : '');
}

function parseLines(text: string, sep: RegExp): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = line.match(sep);
    if (match && match[1].trim()) out[match[1].trim()] = match[2].trim();
  }
  return out;
}

function splitArgs(text: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(text))) out.push(match[1] ?? match[2] ?? match[3]);
  return out;
}

function AddServerDialog({onClose}: {onClose: () => void}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [transport, setTransport] = useState('stdio');
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [env, setEnv] = useState('');
  const [headers, setHeaders] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const remote = transport === 'streamable-http' || transport === 'sse' || transport === 'http';
  useEffect(() => {
    ref.current?.showModal?.();
    return () => ref.current?.close?.();
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const next = await api.addMCPServer({
        name: name.trim(),
        transport,
        command: command.trim(),
        args: remote ? [] : splitArgs(args),
        env: remote ? {} : parseLines(env, /^([^=]+)=(.*)$/),
        headers: remote ? parseLines(headers, /^([^:]+):(.*)$/) : {},
        enabled,
      });
      applyUIState(next);
      toast(`Added ${name.trim() || command.trim()}.`, 'success');
      onClose();
    } catch (error) {
      toastError(error);
    } finally {
      setSaving(false);
    }
  }
  return (
    <dialog ref={ref} className="modal modal-wide" aria-labelledby="add-server-title" onCancel={event => {event.preventDefault(); onClose();}}>
      <form onSubmit={submit}>
        <h2 id="add-server-title">Add a tool server</h2>
        <div className="modal-body form-stack">
          <div className="form-row">
            <label className="field">
              <span>Name</span>
              <input className="input" value={name} onChange={event => setName(event.target.value)} placeholder="Ticket tracker" autoFocus />
            </label>
            <label className="field">
              <span>Kind</span>
              <select className="select" value={transport} onChange={event => setTransport(event.target.value)}>
                <option value="stdio">Program on this computer</option>
                <option value="python-fastmcp">Python FastMCP file</option>
                <option value="streamable-http">Remote server (HTTP)</option>
                <option value="sse">Remote server (SSE)</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>{remote ? 'Server address' : transport === 'python-fastmcp' ? 'Python file' : 'Program'}</span>
            <input className="input mono" required value={command} onChange={event => setCommand(event.target.value)} placeholder={remote ? 'https://tools.example.com/mcp' : transport === 'python-fastmcp' ? 'C:\\tools\\server.py' : 'npx'} />
          </label>
          {remote ? (
            <label className="field">
              <span>Headers (optional)</span>
              <textarea className="textarea mono" rows={3} value={headers} onChange={event => setHeaders(event.target.value)} placeholder={'Authorization: Bearer …'} />
              <small>One per line, as Name: value.</small>
            </label>
          ) : (
            <>
              <label className="field">
                <span>Arguments (optional)</span>
                <input className="input mono" value={args} onChange={event => setArgs(event.target.value)} placeholder="-y @acme/tracker-mcp" />
              </label>
              <label className="field">
                <span>Environment (optional)</span>
                <textarea className="textarea mono" rows={3} value={env} onChange={event => setEnv(event.target.value)} placeholder="TRACKER_TOKEN=…" />
                <small>One per line, as NAME=value.</small>
              </label>
            </>
          )}
          <label className="check"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Turn on now</label>
          <p className="faint">
            {remote
              ? 'Remote tools are checked against your project permissions like any other tool. What the service does with the data it receives is up to the service.'
              : 'The program runs in the primary project folder and is told which projects it may use. Every call is checked against project permissions, but NullBot can’t sandbox the program itself, so add servers you trust.'}
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !command.trim()}>Add server</button>
        </div>
      </form>
    </dialog>
  );
}

// ------------------------------------------------------------------ skills

const skillTemplate = (name: string) => `---
name: ${name || 'new-skill'}
description: Use this skill when …
---

# ${name ? name.replace(/[-_]+/g, ' ') : 'New skill'}

## Steps

1. `;

function SkillsTab() {
  const {data, setData, error} = useResource(api.skills);
  const skills = useMemo(() => [...(data || [])].sort((a, b) => a.name.localeCompare(b.name)), [data]);
  const [selected, setSelected] = useState<string>('');
  const current = selected === 'new' ? undefined : skills.find(s => s.path === selected) || skills[0];
  const roots = useMemo(() => {
    const groups = new Map<string, SkillFile[]>();
    for (const skill of skills) groups.set(skill.root, [...(groups.get(skill.root) || []), skill]);
    return [...groups.entries()];
  }, [skills]);
  return (
    <Panes
      label="Skills"
      list={
        <>
          <div className="pane-toolbar">
            <button className="btn btn-sm" onClick={() => setSelected('new')}><Plus size={13} />New skill</button>
          </div>
          {error && <p className="notice bad pane-notice">{error}</p>}
          {!skills.length && <p className="pane-empty faint">Skills are instructions NullBot follows for a kind of task. Type / in the composer to use one.</p>}
          {roots.map(([root, list]) => (
            <ListGroup key={root} title={<span title={root}>{shorten(root.split(/[\\/]/).slice(-2).join('/'), 32)}</span>} count={list.length}>
              {list.map(skill => (
                <ListRow key={skill.path} selected={selected !== 'new' && skill.path === current?.path} onSelect={() => setSelected(skill.path)} title={skill.name} subtitle={firstLine(skill.description, 80)} />
              ))}
            </ListGroup>
          ))}
        </>
      }
      detail={selected === 'new' || !current ? (
        <SkillEditor key="new" onSaved={skill => {
          setData(list => [...(list || []).filter(s => s.path !== skill.path), skill]);
          setSelected(skill.path);
        }} />
      ) : <SkillDetail key={current.path} skill={current} onSaved={skill => setData(list => [...(list || []).filter(s => s.path !== skill.path), skill])} />}
    />
  );
}

function SkillDetail({skill, onSaved}: {skill: SkillFile; onSaved: (skill: SkillFile) => void}) {
  const {data, error, loading} = useResource(() => api.readSkill(skill.path), {deps: [skill.path, skill.modified]});
  const [editing, setEditing] = useState(false);
  if (editing && data) return <SkillEditor name={skill.name} initial={data.content || ''} onSaved={next => {onSaved(next); setEditing(false);}} onCancel={() => setEditing(false)} />;
  const body = (data?.content || '').replace(/^---[\s\S]*?\n---\s*/, '');
  return (
    <div className="detail">
      <DetailHeader
        title={skill.name}
        subtitle={skill.description}
        actions={
          <>
            <button className="btn" onClick={() => void api.revealPath(skill.path).catch(toastError)}>Show file</button>
            <button className="btn btn-primary" disabled={!data} onClick={() => setEditing(true)}>Edit</button>
          </>
        }
      />
      <div className="detail-body">
        {loading && !data ? <Spinner /> : error ? <p className="notice bad">{error}</p> : <div className="doc"><Markdown className="prose">{body}</Markdown></div>}
        <p className="faint detail-foot mono">{skill.path}</p>
      </div>
    </div>
  );
}

function SkillEditor({name: initialName = '', initial, onSaved, onCancel}: {name?: string; initial?: string; onSaved: (skill: SkillFile) => void; onCancel?: () => void}) {
  const [name, setName] = useState(initialName);
  const [content, setContent] = useState(initial ?? skillTemplate(''));
  const [saving, setSaving] = useState(false);
  const isNew = !initialName;
  async function save() {
    setSaving(true);
    try {
      if (isNew) {
        const existing = await api.skills();
        if (existing.some(s => s.name === name.trim()) && !(await confirmDialog({title: `Replace the skill “${name.trim()}”?`, body: 'A skill with this name exists. Saving overwrites it.', confirmLabel: 'Replace', danger: true}))) return;
      }
      onSaved(await api.saveSkill(name.trim(), content, true));
      toast('Skill saved.', 'success');
    } catch (error) {
      toastError(error);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="detail">
      <DetailHeader
        title={isNew ? 'New skill' : `Edit ${initialName}`}
        subtitle="The description says when the skill applies; the body says what to do."
        actions={
          <>
            {onCancel && <button className="btn" onClick={onCancel}>Cancel</button>}
            <button className="btn btn-primary" disabled={saving || !name.trim() || !content.trim()} onClick={() => void save()}>Save skill</button>
          </>
        }
      />
      <div className="detail-body form-stack">
        {isNew && (
          <label className="field">
            <span>Name</span>
            <input className="input mono" value={name} placeholder="weekly-report" onChange={event => {
              const next = event.target.value.toLowerCase().replace(/[^a-z0-9-_]+/g, '-');
              setName(next);
              setContent(current => current.replace(/^name: .*$/m, `name: ${next || 'new-skill'}`));
            }} />
          </label>
        )}
        <textarea className="code-editor bordered" spellCheck={false} value={content} onChange={event => setContent(event.target.value)} rows={22} aria-label="Skill file" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------- marketplace

function MarketTab() {
  const initial = useStore(appStore, state => state.ui?.marketplace);
  const [market, setMarket] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [installing, setInstalling] = useState('');
  const [small, setSmall] = useState(false);
  const [enable, setEnable] = useState(true);
  const [query, setQuery] = useState('');

  async function refresh() {
    setRefreshing(true);
    try {
      setMarket(await api.marketplace(true));
    } catch (error) {
      toastError(error);
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    if (!market) void api.marketplace(false).then(setMarket).catch(() => undefined);
  }, []);
  async function install(pkg: MarketPackage) {
    setInstalling(pkg.id);
    try {
      setMarket(await api.installMarketPackage(pkg.id, small, enable));
      applyUIState(await api.state());
      toast(`${pkg.name} installed${enable ? ' and turned on' : ''}.`, 'success');
    } catch (error) {
      toastError(error);
    } finally {
      setInstalling('');
    }
  }
  const packages = (market?.packages || []).filter(pkg => !query || `${pkg.name} ${pkg.description || ''} ${pkg.category || ''}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="view-scroll">
      <div className="market">
        <div className="market-bar">
          <input className="input" placeholder="Search packages" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search packages" />
          <label className="check"><input type="checkbox" checked={enable} onChange={event => setEnable(event.target.checked)} />Turn on after installing</label>
          <label className="check" title="Smaller download, built without debug information"><input type="checkbox" checked={small} onChange={event => setSmall(event.target.checked)} />Smaller build</label>
          <span className="composer-spacer" />
          <button className="btn" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? <span className="spinner" /> : <RefreshCw size={13} />}Check for updates</button>
        </div>
        {market?.error && <p className="notice bad">{market.error}</p>}
        {!market && <Spinner label="Loading the catalog" />}
        <table className="table market-table">
          <thead><tr><th>Package</th><th>Can</th><th /></tr></thead>
          <tbody>
            {packages.map(pkg => (
              <tr key={pkg.id}>
                <td>
                  <div className="pkg-name"><Package size={14} aria-hidden="true" /><strong>{pkg.name}</strong>{pkg.version && <span className="faint num">{pkg.version}</span>}{pkg.installed && <StatusTag status="installed" label="Installed" />}</div>
                  {pkg.description && <p className="muted pkg-desc">{pkg.description}</p>}
                </td>
                <td className="pkg-perms">{(pkg.permissions || []).map(p => <span key={p} className="tag">{p}</span>)}</td>
                <td className="pkg-action">
                  <button className="btn btn-sm" disabled={!!installing} onClick={() => void install(pkg)}>{installing === pkg.id ? <span className="spinner" /> : null}{pkg.installed ? 'Reinstall' : 'Install'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {market && !packages.length && <p className="pane-empty faint">{query ? 'No packages match the search.' : 'The catalog is empty.'}</p>}
        {(market?.local_servers || []).length > 0 && (
          <Section title="Server folders on this computer">
            <table className="table">
              <tbody>
                {market!.local_servers!.map(server => (
                  <tr key={server.id}>
                    <td><strong>{server.name}</strong><p className="muted">{server.description}</p></td>
                    <td className="mono faint wrap">{server.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}
        {market?.dir && <p className="faint detail-foot">Packages install to <span className="mono">{market.dir}</span>.</p>}
      </div>
    </div>
  );
}
