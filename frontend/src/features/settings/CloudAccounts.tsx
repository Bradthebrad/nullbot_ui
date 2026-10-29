// Cloud accounts: the aws and gcp secrets cloud plans run with, how to add
// one, and a check that asks the cloud who a key signs in as. Shown in
// Settings > Secrets and in the Cloud view.
import {useEffect, useRef, useState} from 'react';
import {ExternalLink} from 'lucide-react';
import {api} from '../../lib/bindings';
import {useResource} from '../../lib/useResource';
import {relativeTime} from '../../lib/format';
import type {CloudIdentity, SecretInfo} from '../../lib/types';
import {openSettings} from '../../state/app';
import {Spinner, StatusTag} from '../../ui/layout';
import {toast, toastError} from '../../ui/toast';
import {AgentToggle, RemoveButton, SecretEditor, freeName, message} from './secretParts';

type Cloud = 'aws' | 'gcp';

const clouds: Record<Cloud, {name: string; cli: string; tool: string; install: string; add: string; howTo: string}> = {
  aws: {
    name: 'AWS', cli: 'the AWS CLI', tool: 'aws', install: 'https://aws.amazon.com/cli/', add: 'Add an AWS account',
    howTo: 'An access key for an IAM user that has only the permissions plans need. Make one in the AWS console: IAM, Users, the user, Security credentials, Create access key.',
  },
  gcp: {
    name: 'Google Cloud', cli: 'the Google Cloud CLI', tool: 'gcloud', install: 'https://cloud.google.com/sdk/docs/install', add: 'Add a Google Cloud account',
    howTo: 'A service account’s JSON key. Make one in the Google Cloud console: IAM & Admin, Service accounts, the account, Keys, Add key, JSON.',
  },
};

export const permissionsURL = 'https://github.com/Bradthebrad/nullbot/blob/main/docs/INFRA.md#permissions-plans-need';

export const isCloudAccount = (s: SecretInfo) => s.kind === 'aws' || s.kind === 'gcp';

type Result = {error?: string; note?: string};

/** What the account signs in as, in a sentence. */
function describe(s: SecretInfo) {
  const p = s.public || {};
  if (s.kind === 'aws') {
    const where = p.region ? <> Plans run in <span className="mono">{p.region}</span> unless they name another region.</> : <> It has no region, so each plan has to name one.</>;
    if (p.verified && p.account) {
      return <>Signs in to account <span className="mono">{p.account}</span> as <span className="mono">{p.identity}</span>.{where}</>;
    }
    return <>Not checked yet. Check asks AWS who this key belongs to; it changes nothing and costs nothing.{where}</>;
  }
  const who = p.client_email ? <span className="mono">{p.client_email}</span> : 'its service account';
  const project = p.project_id ? <> Plans use project <span className="mono">{p.project_id}</span>.</> : <> The key file names no project; set one.</>;
  if (p.verified) return <>Signs in as {who}.{project}</>;
  return <>Not checked yet. Check asks Google Cloud whether {who} signs in and can use Compute Engine; it changes nothing.{project}</>;
}

export function CloudAccounts({focus}: {focus?: string}) {
  const secrets = useResource(api.secrets, {topics: ['secrets']});
  const kinds = useResource(api.secretKinds);
  const state = useResource(() => api.infraState(), {topics: ['infra']});
  const [editing, setEditing] = useState<{cloud?: Cloud; secret?: SecretInfo} | null>(null);
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, Result>>({});
  const all = secrets.data || [];
  const accounts = all.filter(isCloudAccount);
  const tools = state.data?.tools || {};
  const missing = (cloud: Cloud) => String(tools[clouds[cloud].tool] || '').startsWith('missing');

  async function check(name: string) {
    setChecking(current => ({...current, [name]: true}));
    setResults(current => ({...current, [name]: {}}));
    try {
      const id: CloudIdentity = await api.checkCloudAccount(name);
      setResults(current => ({...current, [name]: {note: id.note}}));
      if (!id.note) {
        toast(id.cloud === 'aws' ? `${name} signs in to AWS account ${id.account}.` : `${name} signs in to Google Cloud as ${id.identity || 'its service account'}.`, 'success');
      }
    } catch (err) {
      setResults(current => ({...current, [name]: {error: message(err)}}));
    } finally {
      setChecking(current => ({...current, [name]: false}));
      secrets.reload();
    }
  }

  if (secrets.error) {
    return (
      <div className="notice warn cloud-accounts-locked">
        <p>{secrets.error}</p>
        <button className="btn btn-sm" onClick={() => openSettings('secrets')}>Open Secrets</button>
      </div>
    );
  }
  if (!secrets.data) return <Spinner label="Loading accounts" />;

  const taken = all.map(s => s.name);
  return (
    <>
      <div className="account-list cloud-accounts">
        {accounts.map(account => (
          <AccountRow
            key={account.name}
            account={account}
            focused={account.name === focus}
            checking={!!checking[account.name]}
            result={results[account.name]}
            missingCLI={missing(account.kind as Cloud)}
            onCheck={() => void check(account.name)}
            onEdit={() => setEditing({secret: account})}
          />
        ))}
        <div className="account">
          <div className="account-main">
            <strong>{accounts.length ? 'Another account' : 'Add an account'}</strong>
            <p className="muted">
              AWS takes an access key for an IAM user; Google Cloud takes a service account’s JSON key file. Give the key only what plans need.{' '}
              <button className="link-button" onClick={() => void api.openExternal(permissionsURL).catch(toastError)}>Which permissions<ExternalLink size={12} aria-hidden="true" /></button>
            </p>
            <div className="row-actions">
              <button className="btn" onClick={() => setEditing({cloud: 'aws'})}>Add AWS account</button>
              <button className="btn" onClick={() => setEditing({cloud: 'gcp'})}>Add Google Cloud account</button>
            </div>
          </div>
        </div>
      </div>
      {editing && kinds.data && (
        <SecretEditor
          kinds={kinds.data}
          secret={editing.secret}
          initialKind={editing.cloud}
          lockKind
          noServers
          title={editing.cloud ? clouds[editing.cloud].add : undefined}
          description={editing.cloud ? clouds[editing.cloud].howTo : undefined}
          initialName={editing.cloud ? freeName(editing.cloud, taken) : undefined}
          initialPublic={editing.cloud === 'aws' ? {region: 'us-east-1'} : undefined}
          onClose={() => setEditing(null)}
          onSaved={saved => {
            setEditing(null);
            secrets.reload();
            // A new or changed key is checked straight away, when the
            // command it needs is here.
            if (!missing(saved.kind as Cloud)) void check(saved.name);
          }}
        />
      )}
    </>
  );
}

function AccountRow({account, focused, checking, result, missingCLI, onCheck, onEdit}: {
  account: SecretInfo; focused: boolean; checking: boolean; result?: Result; missingCLI: boolean; onCheck: () => void; onEdit: () => void;
}) {
  const cloud = clouds[account.kind as Cloud];
  const checked = account.public?.verified;
  // The last check here failed: say so, whatever an earlier one found.
  const failed = !checking && !!result?.error;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({block: 'nearest'});
  }, [focused]);
  return (
    <div ref={ref} className={focused ? 'account is-focused' : 'account'}>
      <div className="account-main">
        <strong>{cloud.name} account <span className="mono">{account.name}</span></strong>
        <p className="muted">{describe(account)}</p>
        {missingCLI && (
          <div className="notice warn">
            <p>Plans and checks run {cloud.cli} (<span className="mono">{cloud.tool}</span>), which isn’t installed here. Install it, then restart NullBot.</p>
            <button className="btn btn-sm" onClick={() => void api.openExternal(cloud.install).catch(toastError)}>Get {cloud.cli}<ExternalLink size={12} aria-hidden="true" /></button>
          </div>
        )}
        {result?.error && <p className="notice bad" role="alert">{result.error}</p>}
        {result?.note && <p className="notice warn" role="status">{result.note}</p>}
        <div className="row-actions">
          <button className="btn" disabled={checking || missingCLI} onClick={onCheck}>{checking ? <span className="spinner" /> : null}Check</button>
          <button className="btn" onClick={onEdit}>Replace or change</button>
          <RemoveButton secret={account} />
        </div>
      </div>
      <div className="account-state">
        <StatusTag status={failed ? 'failed' : checked ? 'ok' : 'idle'} label={failed ? 'Check failed' : checked ? 'Checked' : 'Not checked'} />
        {checked && !failed && <span className="faint" title={checked}>{relativeTime(checked)}</span>}
        {account.hint && <span className="mono faint">{account.hint}</span>}
        <AgentToggle secret={account} />
      </div>
    </div>
  );
}
