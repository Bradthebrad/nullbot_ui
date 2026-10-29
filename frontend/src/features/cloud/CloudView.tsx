// Cloud: machines and buckets NullBot made on AWS and Google Cloud, the
// plans that made them, and the one place a person approves a plan. Every
// command a plan runs is shown exactly as it will run before approval.
import {useMemo, useState, type ReactNode} from 'react';
import {Cable, Check, MoreHorizontal, Play, RefreshCw, Square, X} from 'lucide-react';
import {useStore} from '../../lib/store';
import {api} from '../../lib/bindings';
import {useResource} from '../../lib/useResource';
import {formatDateTime, relativeTime} from '../../lib/format';
import type {CloudAccount, InfraLedgerEntry, InfraPlan, InfraResource, InfraState, InfraStep, NodeReport, Tunnel} from '../../lib/types';
import {CloudAccounts} from '../settings/CloudAccounts';
import {infraStore, requesterName, selectInfra} from '../../state/infra';
import {Blank, DetailHeader, Facts, ListGroup, ListRow, Panes, Section, Spinner, StatusTag} from '../../ui/layout';
import {MenuButton} from '../../ui/Menu';
import {CopyButton} from '../../ui/Markdown';
import {confirmDialog, promptDialog} from '../../ui/dialogs';
import {toast, toastError} from '../../ui/toast';
import type {Tone} from '../../lib/format';

const cloudName = (cloud?: string) => (cloud === 'gcp' ? 'Google Cloud' : cloud === 'aws' ? 'AWS' : String(cloud || ''));

export function hourly(cost?: number) {
  const n = Math.abs(Number(cost || 0));
  if (!n) return '';
  return n < 0.01 ? 'under $0.01 an hour' : `$${n < 1 ? n.toFixed(3).replace(/0$/, '') : n.toFixed(2)} an hour`;
}

const resourceKind: Record<string, string> = {
  instance: 'Machine', bucket: 'Bucket', security_group: 'Security group', key_pair: 'Key pair', firewall: 'Firewall rule',
};

const resourceTone = (r: InfraResource): Tone =>
  r.state === 'ready' ? 'ok' : r.state === 'failed' || r.state === 'missing' ? 'bad' : r.state === 'creating' || r.state === 'deleting' ? 'live' : r.state === 'deleted' ? 'off' : 'idle';

const resourceState = (r: InfraResource) =>
  ({ready: 'Running', creating: 'Creating', failed: 'Failed', deleting: 'Removing', deleted: 'Removed', missing: 'Gone from the cloud', planned: 'Planned'})[r.state] || r.state;

const planState = (p: InfraPlan) =>
  ({proposed: 'Waiting for you', approved: 'Approved', applying: 'Running', applied: p.kind === 'destroy' ? 'Removed' : 'Done', failed: 'Failed', rejected: 'Rejected'})[p.state] || p.state;

/** The status word StatusTag colors by: live for anything needing a look. */
const planStatus = (p: InfraPlan) =>
  ({proposed: 'running', approved: 'pending', applying: 'running', applied: 'done', failed: 'failed', rejected: 'cancelled'})[p.state] || p.state;
const resourceStatus = (r: InfraResource) =>
  ({ready: 'ready', creating: 'running', deleting: 'running', failed: 'failed', missing: 'failed', deleted: 'cancelled'})[r.state] || 'pending';

const planTone = (p: InfraPlan): Tone =>
  p.state === 'proposed' || p.state === 'applying' ? 'live' : p.state === 'applied' ? 'ok' : p.state === 'failed' ? 'bad' : p.state === 'rejected' ? 'off' : 'idle';

/** Shell quoting, so a copied command runs as shown. A placeholder on its
 * own stays bare: NullBot fills it in before the command runs. */
export function shellQuote(arg: string) {
  if (/^[A-Za-z0-9_./:=,@%+-]+$/.test(arg) || /^\{\{(cloud_id:nb-[0-9a-f]+|input_file)\}\}$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function CloudView() {
  // Accounts are vault secrets: they change with the secrets topic.
  const {data, error, loading, reload} = useResource(() => api.infraState(), {topics: ['infra', 'secrets']});
  const tunnels = useResource(() => api.tunnels().then(list => (Array.isArray(list) ? list : [])), {topics: ['infra'], initial: [] as Tunnel[]});
  const selected = useStore(infraStore, state => state.selected);
  const state: InfraState | undefined = data;
  const plans = state?.plans || [];
  const resources = state?.resources || [];

  const waiting = plans.filter(p => p.state === 'proposed');
  const running = plans.filter(p => p.state === 'approved' || p.state === 'applying');
  const earlier = plans.filter(p => p.state === 'applied' || p.state === 'failed' || p.state === 'rejected').slice(0, 30);
  const machines = resources.filter(r => r.kind === 'instance' && r.state !== 'deleted');
  const buckets = resources.filter(r => r.kind === 'bucket' && r.state !== 'deleted');
  const missingTools = Object.entries(state?.tools || {}).filter(([, path]) => path.startsWith('missing'));
  const accounts = state?.accounts || [];

  // Something waiting for approval comes first.
  const fallback = waiting[0]?.id || running[0]?.id || machines[0]?.id || buckets[0]?.id || '';
  const current = selected || fallback;
  const plan = plans.find(p => p.id === current);
  const resource = resources.find(r => r.id === current);

  if (!state && loading) return <div className="view"><Spinner label="Loading" /></div>;

  const detail = plan ? (
    <PlanDetail key={plan.id} plan={plan} resources={resources} />
  ) : resource ? (
    <ResourceDetail key={resource.id} resource={resource} resources={resources} tunnels={(tunnels.data || []).filter(t => t.resource === resource.id)} onTunnels={tunnels.reload} />
  ) : current === 'here' ? (
    <HereDetail />
  ) : current === 'ledger' ? (
    <LedgerDetail plans={plans} />
  ) : current === 'accounts' || current.startsWith('account:') ? (
    <AccountsDetail focus={current.slice('account:'.length)} />
  ) : (
    <Blank
      title="Machines and storage in your cloud, under your control"
      action={!accounts.length ? <button className="btn btn-primary" onClick={() => selectInfra('accounts')}>Add a cloud account</button> : undefined}
    >
      NullBot can create machines and buckets on AWS and Google Cloud. Every change is a plan of exact aws or gcloud commands, and nothing runs until you approve it here.{' '}
      {accounts.length ? 'Ask for what you need in chat, or run nullbot infra plan.' : 'Start by adding the AWS or Google Cloud account plans will use.'}
    </Blank>
  );

  return (
    <div className="view cloud">
      <Panes
        label="Cloud"
        listWidth={300}
        list={
          <>
            <div className="pane-toolbar cloud-toolbar">
              <div className="cloud-cost">
                <span className="faint">Now</span>
                <strong className="num">{hourly(state?.cost_hourly) || 'nothing running'}</strong>
              </div>
              <label className="check" title="Agents can propose plans and run the ones you approve. They can never approve one.">
                <input
                  type="checkbox"
                  checked={Boolean(state?.agent_tools)}
                  onChange={async event => {
                    try {
                      await api.setInfraAgentTools(event.target.checked);
                      reload();
                    } catch (err) {
                      toastError(err);
                    }
                  }}
                />
                <span>Agents can propose</span>
              </label>
            </div>
            {error && <p className="notice bad pane-notice">{error}</p>}
            {missingTools.length === 2 && <p className="notice warn pane-notice">Plans need the AWS CLI or the Google Cloud CLI. Install the one for your cloud.</p>}
            {waiting.length > 0 && (
              <ListGroup title="Waiting for you" count={waiting.length}>
                {waiting.map(p => <PlanRow key={p.id} plan={p} selected={p.id === current} />)}
              </ListGroup>
            )}
            {running.length > 0 && (
              <ListGroup title="Running" count={running.length}>
                {running.map(p => <PlanRow key={p.id} plan={p} selected={p.id === current} />)}
              </ListGroup>
            )}
            <ListGroup title="Machines" count={machines.length}>
              {machines.map(r => (
                <ListRow
                  key={r.id}
                  selected={r.id === current}
                  onSelect={() => selectInfra(r.id)}
                  tone={resourceTone(r)}
                  title={r.name}
                  subtitle={[cloudName(r.cloud), r.details?.type, r.details?.public_ip || (r.state !== 'ready' ? resourceState(r).toLowerCase() : '')].filter(Boolean).join(', ')}
                  meta={r.cost_hourly ? `$${r.cost_hourly.toFixed(2)}/h` : ''}
                />
              ))}
              {!machines.length && <p className="pane-empty faint">None running.</p>}
            </ListGroup>
            {buckets.length > 0 && (
              <ListGroup title="Buckets" count={buckets.length}>
                {buckets.map(r => (
                  <ListRow key={r.id} selected={r.id === current} onSelect={() => selectInfra(r.id)} tone={resourceTone(r)} title={r.name} subtitle={[cloudName(r.cloud), r.region].filter(Boolean).join(', ')} />
                ))}
              </ListGroup>
            )}
            <ListGroup title="Accounts" count={accounts.length || undefined}>
              {accounts.map(a => (
                <ListRow
                  key={a.name}
                  selected={current === `account:${a.name}`}
                  onSelect={() => selectInfra(`account:${a.name}`)}
                  tone={a.checked && !a.note ? 'ok' : 'idle'}
                  title={a.name}
                  subtitle={accountSummary(a)}
                />
              ))}
              {!accounts.length && (
                <ListRow
                  selected={current === 'accounts'}
                  onSelect={() => selectInfra('accounts')}
                  title="Add an account"
                  subtitle={state?.accounts_error || 'AWS or Google Cloud'}
                />
              )}
            </ListGroup>
            <ListGroup title="Records">
              <ListRow selected={current === 'here'} onSelect={() => selectInfra('here')} title="This computer" subtitle="What listens on which port" />
              <ListRow selected={current === 'ledger'} onSelect={() => selectInfra('ledger')} title="Ledger" subtitle="Every proposal, decision and command" />
            </ListGroup>
            {earlier.length > 0 && (
              <ListGroup title="Earlier plans" count={earlier.length}>
                {earlier.map(p => <PlanRow key={p.id} plan={p} selected={p.id === current} />)}
              </ListGroup>
            )}
          </>
        }
        detail={detail}
      />
    </div>
  );
}

function accountSummary(a: CloudAccount) {
  return [cloudName(a.cloud), a.region || a.project, !a.checked ? 'not checked' : a.note ? 'needs setup' : ''].filter(Boolean).join(', ');
}

function AccountsDetail({focus}: {focus: string}) {
  return (
    <div className="detail">
      <DetailHeader title="Accounts" subtitle="What plans sign in to AWS and Google Cloud with. Keys stay in the vault." />
      <div className="detail-body">
        <CloudAccounts focus={focus} />
      </div>
    </div>
  );
}

function PlanRow({plan, selected}: {plan: InfraPlan; selected: boolean}) {
  return (
    <ListRow
      selected={selected}
      onSelect={() => selectInfra(plan.id)}
      tone={planTone(plan)}
      title={plan.title}
      subtitle={`${requesterName(plan.requester)}, ${relativeTime(plan.created)}`}
      meta={plan.cost_hourly && plan.cost_hourly > 0 ? `$${plan.cost_hourly.toFixed(2)}/h` : ''}
    />
  );
}

// ---------------------------------------------------------------- a plan

function PlanDetail({plan, resources}: {plan: InfraPlan; resources: InfraResource[]}) {
  const [working, setWorking] = useState('');
  const who = requesterName(plan.requester);
  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of [...resources, ...(plan.resources || [])]) out[r.id] = `${resourceKind[r.kind]?.toLowerCase() || r.kind} ${r.name}`;
    return out;
  }, [plan.resources, resources]);
  const commands = plan.steps.map(step => step.argv.map(shellQuote).join(' ')).join('\n');
  const removes = plan.kind === 'destroy';
  const wipes = removes && plan.steps.some(s => s.argv.includes('--force') || s.argv.includes('--recursive'));

  async function act(kind: string, run: () => Promise<unknown>, done?: string) {
    setWorking(kind);
    try {
      await run();
      if (done) toast(done, 'success');
    } catch (err) {
      toastError(err);
    } finally {
      setWorking('');
    }
  }

  async function approve() {
    if (removes && !(await confirmDialog({
      title: `Remove ${plan.resources.length === 1 ? plan.resources[0].name : `${plan.resources.length} things`}?`,
      body: wipes ? 'This deletes the bucket’s files too. Nothing that is removed can be brought back.' : 'Nothing that is removed can be brought back.',
      confirmLabel: 'Remove',
      danger: true,
    }))) return;
    await act('approve', () => api.decideInfraPlan(plan.id, true, true, plan.hash || ''), removes ? 'Removing. Each step shows here as it runs.' : 'Approved. Each step shows here as it runs.');
  }

  const menu = [
    ...(plan.kind === 'create' && (plan.state === 'applied' || plan.state === 'failed')
      ? [{label: plan.state === 'failed' ? 'Remove what it made…' : 'Remove everything it made…', danger: true, onSelect: () => void proposeRemoval([plan.id], false, plan.title)}]
      : []),
    {label: 'Copy every command', onSelect: () => void navigator.clipboard?.writeText(commands)},
  ];

  return (
    <div className="detail cloud-detail">
      <DetailHeader
        title={plan.title}
        subtitle={<span className="cloud-sub"><StatusTag status={planStatus(plan)} label={planState(plan)} /><span>{who}, {relativeTime(plan.created)}</span></span>}
        actions={
          <>
            {plan.state === 'approved' && (
              <button className="btn btn-primary" disabled={!!working} onClick={() => void act('run', () => api.runInfraPlan(plan.id), 'Started.')}><Play size={13} />Run now</button>
            )}
            {plan.state === 'applying' && (
              <button className="btn" disabled={!!working} onClick={() => void act('stop', async () => {
                if (!(await api.stopInfraPlan(plan.id))) toast('It was started elsewhere (by an agent or the command line), so it stops there.');
                else toast('It stops after the step that is running.');
              })}><Square size={12} />Stop after this step</button>
            )}
            <MenuButton className="btn btn-ghost btn-icon" title="More" align="end" label={<MoreHorizontal size={16} />} items={menu} />
          </>
        }
      />
      <div className="detail-body">
        {plan.reason && (
          <figure className="cloud-reason">
            <blockquote>{plan.reason}</blockquote>
            <figcaption className="faint">Why {who === 'You' ? 'you asked' : `${who.charAt(0).toLowerCase()}${who.slice(1)} asked`}</figcaption>
          </figure>
        )}
        {plan.error && <p className="notice bad">{plan.error}</p>}
        {(plan.notes || []).map((note, i) => <p key={i} className={/open to|no price|spare|not found|install/i.test(note) ? 'notice warn' : 'notice'}>{note}</p>)}
        <Facts items={[
          ['Cloud', [cloudName(plan.cloud), plan.region, plan.project].filter(Boolean).join(', ')],
          ['Credentials', <><span className="mono">{plan.credential}</span><span className="faint">from the vault; never shown to agents</span></>],
          [removes ? 'Saves' : 'Costs', plan.cost_hourly ? <span title={plan.cost_note}>about {hourly(plan.cost_hourly)}</span> : ''],
          ['Decided', plan.decided_by ? `${requesterName(plan.decided_by)}, ${formatDateTime(plan.decided)}` : ''],
          ['Finished', formatDateTime(plan.finished)],
        ]} />
        {plan.cost_note && plan.cost_hourly ? <p className="faint section-note">{plan.cost_note}</p> : null}
        <Section title={removes ? 'What it removes' : 'What it makes'}>
          <table className="table cloud-table">
            <thead><tr><th>Name</th><th>Kind</th><th>Details</th></tr></thead>
            <tbody>
              {plan.resources.map(r => (
                <tr key={r.id}>
                  <td><strong>{r.name}</strong></td>
                  <td>{resourceKind[r.kind] || r.kind}</td>
                  <td className="muted">{resourceSummary(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title={`Commands, in order (${plan.steps.length})`} actions={<CopyButton text={commands} label="Copy all" />}>
          <p className="faint section-note">
            Each runs exactly as written, with the {cloudName(plan.cloud)} credentials in its environment and a private CLI configuration, so your own profiles and logins are never used. A value in angle brackets comes from an earlier step.
          </p>
          <ol className="cloud-steps">
            {plan.steps.map(step => <PlanStep key={step.id} step={step} names={names} />)}
          </ol>
        </Section>
      </div>
      {plan.state === 'proposed' && (
        <div className="approve-bar" role="region" aria-label="Decision">
          <p>
            {removes ? 'Removing runs' : 'Approving runs'} these {plan.steps.length} commands on {cloudName(plan.cloud)} with <span className="mono">{plan.credential}</span>
            {plan.cost_hourly && plan.cost_hourly > 0 ? <>, about <strong>{hourly(plan.cost_hourly)}</strong> while it is up.</> : '.'}
          </p>
          <div className="approve-actions">
            <button className="btn" disabled={!!working} onClick={() => void act('reject', () => api.decideInfraPlan(plan.id, false, false, ''), 'Rejected. Nothing ran.')}><X size={13} />Reject</button>
            <button className={removes ? 'btn btn-danger-solid' : 'btn btn-primary'} disabled={!!working} onClick={() => void approve()}>
              {working === 'approve' ? <span className="spinner" /> : <Check size={13} />}
              {removes ? 'Approve and remove' : 'Approve and run'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PlanStep({step, names}: {step: InfraStep; names: Record<string, string>}) {
  const state = step.state || 'pending';
  const scriptLines = step.input ? step.input.trimEnd().split('\n').length : 0;
  // A script NullBot generated from bootstrap settings says so on its second
  // line; anything else was written by whoever asked, so it starts open.
  const byNullBot = /^#!\/bin\/bash\n# First-boot setup for [a-z0-9-]+, written by NullBot\./.test(step.input || '');
  return (
    <li className={`cloud-step cloud-step-${state}`}>
      <div className="cloud-step-head">
        <span className="cloud-step-summary">{step.summary}</span>
        {state !== 'pending' && <StatusTag status={state} />}
      </div>
      <pre className="cloud-command"><code>{step.argv.map((arg, i) => <Arg key={i} arg={arg} names={names} />)}</code></pre>
      {step.input && (
        <details className="cloud-input" open={!byNullBot}>
          <summary>{byNullBot ? `First-boot script NullBot wrote from the plan’s settings, ${scriptLines} lines` : `First-boot script as requested, ${scriptLines} lines; it runs as root on the machine`}</summary>
          <pre className="source-text">{step.input}</pre>
        </details>
      )}
      {step.error && <p className="cloud-step-error">{step.error}</p>}
      {step.output && !step.error && <pre className="cloud-output">{step.output}</pre>}
    </li>
  );
}

/** One argument, quoted as a shell would need it, with placeholders named. */
function Arg({arg, names}: {arg: string; names: Record<string, string>}) {
  const parts: ReactNode[] = [];
  const quoted = shellQuote(arg);
  const pattern = /\{\{(cloud_id):(nb-[0-9a-f]+)\}\}|\{\{input_file\}\}/g;
  let last = 0;
  for (const match of quoted.matchAll(pattern)) {
    parts.push(quoted.slice(last, match.index));
    const label = match[0] === '{{input_file}}' ? '‹the file below›' : `‹id of ${names[match[2]] || match[2]}›`;
    parts.push(<span key={match.index} className="cloud-placeholder" title={match[0]}>{label}</span>);
    last = (match.index || 0) + match[0].length;
  }
  parts.push(quoted.slice(last));
  return <>{parts}{' '}</>;
}

function resourceSummary(r: InfraResource) {
  const d = r.details || {};
  const bits: string[] = [];
  if (d.type) bits.push(d.type);
  if (d.disk_gb) bits.push(`${d.disk_gb} GB disk`);
  if (d.spot) bits.push('spare capacity');
  if (d.denies) bits.push(`refuses ${d.denies}`);
  if (d.ports !== undefined && r.kind !== 'instance') bits.push(`${portList(d.ports).length > 1 ? 'ports' : 'port'} ${portList(d.ports).join(', ')} from ${(d.allow_from || 'nowhere').split(',').join(', ')} only`);
  if (d.setup) bits.push(setupLabel(d));
  if (r.kind === 'bucket') bits.push(`private, in ${r.region || 'the default location'}`);
  else if (r.cloud_id && r.cloud_id !== r.name && r.kind !== 'instance') bits.push(r.cloud_id);
  return bits.join(', ');
}

/** SSH (22) is always open; plans list it among the ports too. */
function portList(ports?: string) {
  return Array.from(new Set(['22', ...String(ports || '').split(',').map(p => p.trim()).filter(Boolean)]));
}

function setupLabel(d: Record<string, string>) {
  const items = (d.setup || '').split(',').filter(Boolean).map(s => ({gpu_drivers: 'GPU drivers', ollama: 'Ollama', nullbot: 'NullBot', user_data: 'your first-boot script'})[s] || s);
  if (d.models) items.push(d.models.split(',').join(', '));
  return `sets up ${items.join(', ')}`;
}

async function proposeRemoval(ids: string[], contents: boolean, what: string) {
  try {
    const plan = await api.planInfraDestroy(ids, contents, '');
    selectInfra(plan.id);
    toast(`Here is the plan to remove ${what}. Nothing runs until you approve it.`);
  } catch (err) {
    toastError(err);
  }
}

// ------------------------------------------------------------- a resource

function ResourceDetail({resource: r, resources, tunnels, onTunnels}: {resource: InfraResource; resources: InfraResource[]; tunnels: Tunnel[]; onTunnels: () => void}) {
  const machine = r.kind === 'instance';
  const d = r.details || {};
  const [report, setReport] = useState<NodeReport | null>(null);
  const [looking, setLooking] = useState(false);
  const [working, setWorking] = useState('');
  const related = resources.filter(x => (r.depends_on || []).includes(x.id));
  const sshUser = d.ssh_user || (r.cloud === 'gcp' ? 'nullbot' : 'ubuntu');
  const ready = r.state === 'ready';
  const hasOllama = (d.setup || '').includes('ollama') || Boolean(report?.listeners?.some(l => l.port === 11434));

  async function look() {
    setLooking(true);
    try {
      setReport(await api.inspectNode(r.id));
    } catch (err) {
      toastError(err);
    } finally {
      setLooking(false);
    }
  }

  async function connect() {
    setWorking('connect');
    try {
      const e = await api.connectNodeOllama(r.id);
      onTunnels();
      toast(`${r.name}’s Ollama is a model server here now: choose local:${e.id}/MODEL in Settings > Models.`, 'success');
    } catch (err) {
      toastError(err);
    } finally {
      setWorking('');
    }
  }

  async function tunnel() {
    const port = await promptDialog({title: `Open a tunnel to ${r.name}`, label: 'Port on the machine', placeholder: '8080', body: 'A port on the machine becomes a port on this computer, through SSH. Only this computer can use it.'});
    if (!port) return;
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      toast('Choose a port between 1 and 65535.', 'error');
      return;
    }
    try {
      const t = await api.openTunnel(r.id, n, 0);
      onTunnels();
      toast(`Port ${t.remote_port} on ${r.name} is localhost:${t.local_port} here.`, 'success');
    } catch (err) {
      toastError(err);
    }
  }

  const menu = [
    ...(machine && ready ? [
      {label: 'Open a tunnel…', onSelect: () => void tunnel()},
      ...(hasOllama ? [{label: 'Use its Ollama here', onSelect: () => void connect()}] : []),
      {kind: 'separator' as const},
    ] : []),
    ...(r.kind === 'bucket' ? [
      {label: 'Remove if empty…', danger: true, onSelect: () => void proposeRemoval([r.id], false, r.name)},
      {label: 'Remove with its files…', danger: true, onSelect: () => void proposeRemoval([r.id], true, `${r.name} and its files`)},
    ] : [{label: 'Remove…', danger: true, onSelect: () => void proposeRemoval([r.id], false, r.name)}]),
  ];

  return (
    <div className="detail">
      <DetailHeader
        title={r.name}
        subtitle={<span className="cloud-sub"><StatusTag status={resourceStatus(r)} label={resourceState(r)} /><span>{[resourceKind[r.kind] || r.kind, cloudName(r.cloud), r.zone || r.region].filter(Boolean).join(', ')}</span></span>}
        actions={
          <>
            {machine && hasOllama && ready && (
              <button className="btn" disabled={!!working} onClick={() => void connect()}>{working === 'connect' ? <span className="spinner" /> : <Cable size={13} />}Use its Ollama here</button>
            )}
            {machine && ready && (
              <button className="btn btn-primary" disabled={looking} onClick={() => void look()}>{looking ? <span className="spinner" /> : <RefreshCw size={13} />}{report ? 'Look again' : 'Look inside'}</button>
            )}
            <MenuButton className="btn btn-ghost btn-icon" title="More" align="end" label={<MoreHorizontal size={16} />} items={menu} />
          </>
        }
      />
      <div className="detail-body">
        {r.state === 'missing' && <p className="notice bad">This is gone from {cloudName(r.cloud)}, but NullBot did not remove it. Removing it here clears it from the list.</p>}
        <Facts items={[
          ['Address', d.public_ip ? <><span className="mono">{d.public_ip}</span><CopyButton text={d.public_ip} label="Copy address" /></> : ''],
          ['Private address', d.private_ip ? <span className="mono">{d.private_ip}</span> : ''],
          ['Log in', machine ? <span>as <span className="mono">{sshUser}</span>{d.ssh_key_secret ? <> with the SSH key <span className="mono">{d.ssh_key_secret}</span></> : ''}</span> : ''],
          ['Open ports', machine ? openPorts(r, related) : ''],
          ['Size', [d.type, d.disk_gb ? `${d.disk_gb} GB disk` : '', d.spot ? 'spare capacity, can be stopped by the cloud' : ''].filter(Boolean).join(', ')],
          ['First boot', d.setup ? setupLabel(d).replace(/^sets up/, 'Sets up') : ''],
          ['Costs', r.cost_hourly ? `about ${hourly(r.cost_hourly)}` : ''],
          ['Made', <>{formatDateTime(r.created)}, by <button type="button" className="link-button" onClick={() => selectInfra(r.plan_id)}>its plan</button></>],
          ['Credentials', <span className="mono">{r.credential}</span>],
          ['Cloud id', r.cloud_id ? <span className="mono">{r.cloud_id}</span> : ''],
          ['NullBot id', <span className="mono">{r.id}</span>],
        ]} />
        {related.length > 0 && (
          <Section title="Made with it">
            <ul className="plain-list">
              {related.map(x => (
                <li key={x.id}>
                  {resourceKind[x.kind] || x.kind} <span className="mono">{x.name}</span>
                  {x.cloud_id && x.cloud_id !== x.name ? <span className="faint mono"> {x.cloud_id}</span> : null}
                  {resourceSummary(x) ? <span className="muted">: {resourceSummary(x)}</span> : null}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {machine && tunnels.length > 0 && (
          <Section title="Tunnels to this computer">
            <table className="table cloud-table">
              <thead><tr><th>Here</th><th>On the machine</th><th>Since</th><th /></tr></thead>
              <tbody>
                {tunnels.map(t => (
                  <tr key={t.id}>
                    <td className="mono">localhost:{t.local_port}</td>
                    <td className="mono">{t.remote_port}</td>
                    <td className="muted">{relativeTime(t.started)}</td>
                    <td className="num"><button className="btn btn-sm" onClick={async () => { await api.closeTunnel(t.id); onTunnels(); }}>Close</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}
        {machine && (
          <Section title="What runs there">
            {report ? <NodeReportView report={report} /> : (
              <p className="muted">{ready ? 'Look inside logs in over SSH and runs only commands that read: open ports, services, nginx sites, containers, first-boot progress, memory and GPU.' : 'Once the machine is running, NullBot can look inside it.'}</p>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}

function openPorts(r: InfraResource, related: InfraResource[]) {
  const rule = related.find(x => x.kind === 'security_group' || x.kind === 'firewall');
  const ports = portList(r.details?.ports);
  const from = rule?.details?.allow_from || r.details?.allow_from || '';
  return <span>{ports.join(', ')} {from ? <>from <span className="mono">{from.split(',').join(', ')}</span> only</> : ''}</span>;
}

function NodeReportView({report}: {report: NodeReport}) {
  const listeners = report.listeners || [];
  return (
    <div className="node-report">
      {report.error && <p className="notice bad">{report.error}</p>}
      <p className="faint section-note">Read {relativeTime(report.read)}{report.address ? ` from ${report.address}` : ''}.</p>
      {report.setup && (
        <p className={report.setup === 'done' ? 'muted' : 'notice warn'}>
          {report.setup === 'done' ? 'First-boot setup finished.' : `First-boot setup: ${report.setup}.`}
        </p>
      )}
      {(report.setup_lines || []).length > 0 && report.setup !== 'done' && <pre className="cloud-output">{(report.setup_lines || []).join('\n')}</pre>}
      <ListenerTable listeners={listeners} remote={Boolean(report.resource)} />
      {(report.nginx || []).length > 0 && (
        <div>
          <h4 className="node-heading">Web sites (nginx)</h4>
          <table className="table cloud-table">
            <thead><tr><th>Names</th><th>Listens</th><th>Serves</th></tr></thead>
            <tbody>
              {(report.nginx || []).map((site, i) => (
                <tr key={i}>
                  <td className="mono">{(site.server_names || ['(default)']).join(' ')}</td>
                  <td className="mono">{(site.listen || []).join(', ')}</td>
                  <td className="mono">{(site.proxy_pass || []).join(', ') || site.root || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(report.services || []).length > 0 && (
        <div>
          <h4 className="node-heading">Services</h4>
          <p className="mono node-list">{(report.services || []).map(s => s.replace(/\.service$/, '')).join('  ')}</p>
        </div>
      )}
      {(report.containers || []).length > 0 && (
        <div>
          <h4 className="node-heading">Containers</h4>
          <ul className="plain-list mono">{(report.containers || []).map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}
      {(report.system || []).length > 0 && (
        <details className="cloud-input">
          <summary>Memory, disk and GPU</summary>
          <pre className="source-text">{(report.system || []).join('\n')}</pre>
        </details>
      )}
    </div>
  );
}

function ListenerTable({listeners, remote}: {listeners: Listener[]; remote: boolean}) {
  if (!listeners.length) return <p className="muted">Nothing is listening{remote ? ' there' : ''}.</p>;
  return (
    <table className="table cloud-table">
      <thead><tr><th className="num">Port</th><th>Program</th><th>Listening on</th><th>{remote ? 'Reachable' : 'From other computers'}</th></tr></thead>
      <tbody>
        {listeners.map((l, i) => (
          <tr key={`${l.address}:${l.port}:${i}`}>
            <td className="num mono">{l.port}</td>
            <td>{l.process || <span className="faint">unknown</span>}{l.known && l.known.toLowerCase() !== (l.process || '').toLowerCase() ? <span className="faint"> ({l.known})</span> : null}{l.pid ? <span className="faint num"> {l.pid}</span> : null}</td>
            <td className="mono">{l.address}</td>
            <td>{l.public ? <span className="tag warn">{remote ? 'If the firewall allows' : 'Yes'}</span> : <span className="faint">Only {remote ? 'the machine' : 'this computer'}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
type Listener = NonNullable<NodeReport['listeners']>[number];

// -------------------------------------------------------- this computer

function HereDetail() {
  const {data, loading, reload} = useResource(() => api.thisComputer());
  return (
    <div className="detail">
      <DetailHeader
        title="This computer"
        subtitle="Programs listening for connections, and who can reach them"
        actions={<button className="btn" disabled={loading} onClick={reload}>{loading ? <span className="spinner" /> : <RefreshCw size={13} />}Look again</button>}
      />
      <div className="detail-body">
        {!data ? <Spinner label="Looking" /> : (
          <>
            {data.error && <p className="notice warn">{data.error}</p>}
            <ListenerTable listeners={data.listeners || []} remote={false} />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ledger

const ledgerEvent: Record<string, string> = {
  proposed: 'Proposed', approved: 'Approved', rejected: 'Rejected', step: 'Ran', failed: 'Failed', applied: 'Finished', applying: 'Started',
};

function LedgerDetail({plans}: {plans: InfraPlan[]}) {
  const [plan, setPlan] = useState('');
  const {data, error, loading} = useResource(() => api.infraLedger(plan, 300), {topics: ['infra'], deps: [plan]});
  const titles = useMemo(() => Object.fromEntries(plans.map(p => [p.id, p.title])), [plans]);
  const entries = useMemo(() => [...(Array.isArray(data) ? data : [])].reverse(), [data]);
  return (
    <div className="detail">
      <DetailHeader
        title="Ledger"
        subtitle="Kept in your NullBot folder; entries are only ever added"
        actions={
          <select className="select" aria-label="Plan" value={plan} onChange={e => setPlan(e.target.value)}>
            <option value="">Every plan</option>
            {plans.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        }
      />
      <div className="detail-body">
        {error && <p className="notice bad">{error}</p>}
        {loading && !data ? <Spinner label="Loading" /> : !entries.length ? <p className="muted">Nothing yet.</p> : (
          <table className="table cloud-table ledger">
            <thead><tr><th>When</th><th>What</th><th>Who</th></tr></thead>
            <tbody>{entries.map((e, i) => <LedgerRow key={i} entry={e} title={plan ? '' : titles[e.plan] || e.plan} />)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function LedgerRow({entry: e, title}: {entry: InfraLedgerEntry; title: string}) {
  const failed = e.event === 'failed' || Boolean(e.error) || (e.exit !== undefined && e.exit !== 0);
  return (
    <tr className={failed ? 'is-failed' : ''}>
      <td className="muted nowrap" title={formatDateTime(e.time)}>{relativeTime(e.time)}</td>
      <td>
        <div><strong>{ledgerEvent[e.event] || e.event}</strong>{title ? <span className="muted"> {title}</span> : null}{e.summary ? <span> {e.summary}</span> : null}</div>
        {e.argv && e.argv.length > 0 && <code className="ledger-command">{e.argv.map(shellQuote).join(' ')}</code>}
        {e.error && <div className="cloud-step-error">{e.error}</div>}
      </td>
      <td className="muted">{e.by ? requesterName(e.by) : ''}</td>
    </tr>
  );
}
