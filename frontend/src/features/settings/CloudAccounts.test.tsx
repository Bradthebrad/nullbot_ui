// Cloud accounts: added from their own buttons, checked straight away, and
// what a check found (or could not do) shown on the account.
import {beforeEach, describe, expect, it} from 'vitest';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {installBridge, type FakeBridge} from '../../test/bridge';
import {appStore} from '../../state/app';
import {infraStore, resetInfraWaiting} from '../../state/infra';
import {DialogHost} from '../../ui/dialogs';
import {ToastHost} from '../../ui/toast';
import {CloudView} from '../cloud/CloudView';
import {CloudAccounts} from './CloudAccounts';
import {SecretsSettings} from './SecretsSettings';

const kinds = [
  {kind: 'aws', label: 'AWS credentials', description: 'An access key for the AWS CLI and SDKs.', fields: [
    {name: 'access_key_id', label: 'Access key ID', secret: true, required: true},
    {name: 'secret_access_key', label: 'Secret access key', secret: true, required: true},
    {name: 'session_token', label: 'Session token', secret: true},
    {name: 'region', label: 'Region', secret: false, hint: 'us-east-1'},
    {name: 'account', label: 'Account', secret: false, derived: true},
    {name: 'identity', label: 'Signs in as', secret: false, derived: true},
  ]},
  {kind: 'gcp', label: 'Google Cloud service account', description: 'A service account key file.', file_based: true, fields: [
    {name: 'credentials_json', label: 'Key file (JSON)', secret: true, required: true, multiline: true},
    {name: 'project_id', label: 'Project', secret: false, hint: 'Taken from the key file when empty'},
    {name: 'client_email', label: 'Service account', secret: false, derived: true},
  ]},
  {kind: 'generic', label: 'Other secret', description: 'Any value.', fields: [{name: 'value', label: 'Value', secret: true, required: true}]},
];

const awsChecked = {
  name: 'aws-test', kind: 'aws', label: 'AWS credentials', set: ['access_key_id', 'secret_access_key'], provides: ['AWS_ACCESS_KEY_ID'], agent_use: false, created: '', updated: '', hint: 'ends in WXYZ',
  public: {region: 'us-east-1', account: '123456789012', identity: 'arn:aws:iam::123456789012:user/nullbot-test', verified: new Date().toISOString()},
};
const gcpNew = {
  name: 'gcp-lab', kind: 'gcp', label: 'Google Cloud service account', set: ['credentials_json'], provides: ['GOOGLE_APPLICATION_CREDENTIALS'], agent_use: false, created: '', updated: '',
  public: {project_id: 'acme-lab', client_email: 'nullbot@acme-lab.iam.gserviceaccount.com'},
};

let bridge: FakeBridge;
let secrets: any[];
let tools: Record<string, string>;

beforeEach(() => {
  resetInfraWaiting();
  appStore.set({mcp: [], versions: {}} as any);
  secrets = [awsChecked, gcpNew];
  tools = {aws: '/usr/local/bin/aws', gcloud: '/usr/bin/gcloud'};
  bridge = installBridge({
    VaultStatus: () => ({path: 'vault.json', exists: true, unlocked: true, protection: 'dpapi', protection_label: 'Windows (DPAPI)', secrets: secrets.length}),
    Secrets: () => secrets,
    SecretKinds: () => kinds,
    InfraState: () => ({agent_tools: false, plans: [], resources: [], cost_hourly: 0, tools, accounts: [
      {name: 'aws-test', cloud: 'aws', region: 'us-east-1', account: '123456789012', identity: awsChecked.public.identity, checked: awsChecked.public.verified, agent_use: false},
      {name: 'gcp-lab', cloud: 'gcp', project: 'acme-lab', identity: gcpNew.public.client_email, agent_use: false},
    ]}),
    Tunnels: () => [],
    SaveSecret: (input: any) => ({...input, label: '', set: Object.keys(input.values), provides: []}),
    CheckCloudAccount: (name: string) => (name === 'gcp-lab'
      ? {name, cloud: 'gcp', project: 'acme-lab', identity: gcpNew.public.client_email, note: 'The key signs in, but the Compute Engine API is off in project acme-lab.'}
      : {name, cloud: 'aws', account: '123456789012', identity: awsChecked.public.identity}),
  });
});

describe('Cloud accounts', () => {
  it('has its own group in Settings > Secrets, with who each key signs in as', async () => {
    render(<><SecretsSettings /><DialogHost /></>);
    const group = (await screen.findByRole('heading', {name: 'Cloud accounts'})).closest('.settings-group') as HTMLElement;
    expect(await within(group).findByText('arn:aws:iam::123456789012:user/nullbot-test')).toBeTruthy();
    expect(within(group).getByText('123456789012')).toBeTruthy();
    expect(within(group).getByText(/Not checked yet\. Check asks Google Cloud/)).toBeTruthy();
    expect(within(group).getByRole('button', {name: 'Add AWS account'})).toBeTruthy();
    expect(within(group).getByRole('button', {name: 'Add Google Cloud account'})).toBeTruthy();
  });

  it('adds an AWS account from its own button and checks it straight away', async () => {
    secrets = [];
    render(<><CloudAccounts /><DialogHost /><ToastHost /></>);
    fireEvent.click(await screen.findByRole('button', {name: 'Add AWS account'}));
    const dialog = await screen.findByRole('dialog', {name: 'Add an AWS account'});
    // The kind is set, the name and region are suggested, and it says where
    // to make a key.
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    expect(within(dialog).getByText(/IAM, Users, the user, Security credentials, Create access key/)).toBeTruthy();
    expect((within(dialog).getByPlaceholderText('aws-prod') as HTMLInputElement).value).toBe('aws');
    expect((within(dialog).getByLabelText('Region (optional)') as HTMLInputElement).value).toBe('us-east-1');
    expect(within(dialog).queryByLabelText('Account (optional)')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Access key ID'), {target: {value: 'AKIAEXAMPLE0000000'}});
    fireEvent.change(within(dialog).getByLabelText('Secret access key'), {target: {value: 'very/secret'}});
    fireEvent.click(within(dialog).getByRole('button', {name: 'Add'}));
    await waitFor(() => expect(bridge.callsTo('CheckCloudAccount')).toEqual([['aws']]));
    expect(bridge.callsTo('SaveSecret')[0][0]).toMatchObject({
      name: 'aws', kind: 'aws', agent_use: false, values: {access_key_id: 'AKIAEXAMPLE0000000', secret_access_key: 'very/secret'}, public: {region: 'us-east-1'},
    });
    expect(await screen.findByText('aws signs in to AWS account 123456789012.')).toBeTruthy();
  });

  it('reads a Google Cloud key file instead of a paste', async () => {
    secrets = [];
    render(<><CloudAccounts /><DialogHost /></>);
    fireEvent.click(await screen.findByRole('button', {name: 'Add Google Cloud account'}));
    const dialog = await screen.findByRole('dialog', {name: 'Add a Google Cloud account'});
    const key = '{"type":"service_account","project_id":"acme-lab","private_key":"-----BEGIN PRIVATE KEY-----\\nMII\\n-----END PRIVATE KEY-----\\n"}';
    const file = new File([key], 'acme-lab-1234.json', {type: 'application/json'});
    fireEvent.change(within(dialog).getByLabelText('Choose the key file…'), {target: {files: [file]}});
    await waitFor(() => expect((within(dialog).getByLabelText('Key file (JSON)') as HTMLTextAreaElement).value).toBe(key));
    fireEvent.click(within(dialog).getByRole('button', {name: 'Add'}));
    await waitFor(() => expect(bridge.callsTo('SaveSecret')).toHaveLength(1));
    expect(bridge.callsTo('SaveSecret')[0][0]).toMatchObject({name: 'gcp', kind: 'gcp', values: {credentials_json: key}});
  });

  it('shows what a check could not do on the account, not in a passing toast', async () => {
    bridge.set('CheckCloudAccount', () => {
      throw new Error('AWS does not recognize this access key ID: check it, and that the key is active in IAM');
    });
    render(<><CloudAccounts /><DialogHost /></>);
    const aws = (await screen.findByText('aws-test')).closest('.account') as HTMLElement;
    fireEvent.click(within(aws).getByRole('button', {name: 'Check'}));
    expect((await within(aws).findByRole('alert')).textContent).toMatch(/does not recognize this access key ID/);
    // Whatever an earlier check found, this one failed.
    expect(within(aws).getByText('Check failed')).toBeTruthy();
    expect(within(aws).queryByText('Checked')).toBeNull();

    bridge.set('CheckCloudAccount', (name: string) => ({name, cloud: 'gcp', note: 'The key signs in, but the Compute Engine API is off in project acme-lab.'}));
    const gcp = screen.getByText('gcp-lab').closest('.account') as HTMLElement;
    fireEvent.click(within(gcp).getByRole('button', {name: 'Check'}));
    expect((await within(gcp).findByRole('status')).textContent).toMatch(/Compute Engine API is off/);
  });

  it('says when the cloud’s command is missing, and does not offer a check that cannot run', async () => {
    tools = {aws: 'missing: aws was not found', gcloud: '/usr/bin/gcloud'};
    render(<><CloudAccounts /><DialogHost /></>);
    const aws = (await screen.findByText('aws-test')).closest('.account') as HTMLElement;
    expect(await within(aws).findByText(/isn’t installed here/)).toBeTruthy();
    expect((within(aws).getByRole('button', {name: 'Check'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(aws).getByRole('button', {name: /Get the AWS CLI/}));
    await waitFor(() => expect(bridge.callsTo('OpenExternal')).toEqual([['https://aws.amazon.com/cli/']]));
  });
});

describe('Cloud view accounts', () => {
  it('lists the accounts and opens them in place', async () => {
    render(<><CloudView /><DialogHost /></>);
    const row = await screen.findByRole('button', {name: /aws-test AWS, us-east-1/});
    expect(screen.getByRole('button', {name: /gcp-lab Google Cloud, acme-lab, not checked/})).toBeTruthy();
    fireEvent.click(row);
    expect(infraStore.get().selected).toBe('account:aws-test');
    expect(await screen.findByRole('heading', {name: 'Accounts'})).toBeTruthy();
    expect(await screen.findByText('arn:aws:iam::123456789012:user/nullbot-test')).toBeTruthy();
  });

  it('starts a new user at adding an account', async () => {
    secrets = [];
    bridge.set('InfraState', () => ({agent_tools: false, plans: [], resources: [], cost_hourly: 0, tools, accounts: []}));
    render(<><CloudView /><DialogHost /></>);
    fireEvent.click(await screen.findByRole('button', {name: 'Add a cloud account'}));
    expect(await screen.findByRole('button', {name: 'Add AWS account'})).toBeTruthy();
  });
});
