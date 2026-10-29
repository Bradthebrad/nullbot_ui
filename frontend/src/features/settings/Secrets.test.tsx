// Settings > Secrets: values go in and never come back, agent use needs a
// deliberate yes, and a locked vault asks for its passphrase.
import {beforeEach, describe, expect, it} from 'vitest';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {installBridge, type FakeBridge} from '../../test/bridge';
import {appStore} from '../../state/app';
import {DialogHost} from '../../ui/dialogs';
import {SecretsSettings} from './SecretsSettings';

const kinds = [
  {kind: 'github_token', label: 'GitHub token', description: 'A personal access token.', fields: [
    {name: 'token', label: 'Token', secret: true, required: true}, {name: 'host', label: 'Host', secret: false},
    {name: 'login', label: 'Signed in as', secret: false, derived: true},
  ]},
  {kind: 'aws', label: 'AWS credentials', description: 'An access key.', fields: [
    {name: 'access_key_id', label: 'Access key ID', secret: true, required: true},
    {name: 'secret_access_key', label: 'Secret access key', secret: true, required: true},
    {name: 'region', label: 'Region', secret: false},
  ]},
  {kind: 'ssh_key', label: 'SSH key', description: 'A private key.', file_based: true, fields: [{name: 'private_key', label: 'Private key', secret: true, required: true, multiline: true}]},
];

const secrets = [
  {name: 'github', kind: 'github_token', label: 'GitHub token', public: {host: 'github.com', login: 'octocat', scopes: 'repo'}, set: ['token'], provides: ['GH_TOKEN', 'GITHUB_TOKEN'], agent_use: false, servers: ['github-mcp'], description: 'Work repos', created: '', updated: '', hint: 'ends in 9f2c'},
  {name: 'deploy', kind: 'ssh_key', label: 'SSH key', public: {public_key: 'ssh-ed25519 AAAAC3Nza deploy@nullbot', fingerprint: 'SHA256:abc'}, set: ['private_key'], provides: ['GIT_SSH_COMMAND'], agent_use: true, created: '', updated: ''},
];

let bridge: FakeBridge;
const unlocked = {path: 'C:\\Users\\you\\.nullbot\\vault\\vault.json', exists: true, unlocked: true, protection: 'dpapi', protection_label: 'Windows (DPAPI), for your Windows account', secrets: 2, keychain: 'dpapi'};

beforeEach(() => {
  appStore.set({mcp: [{id: 'github-mcp', name: 'GitHub MCP'}] as any});
  bridge = installBridge({
    VaultStatus: () => unlocked,
    Secrets: () => secrets,
    SecretKinds: () => kinds,
    SaveSecret: (input: any) => ({...input, label: '', set: [], provides: []}),
    VerifyGitHubToken: () => ({login: 'octocat', host: 'github.com'}),
  });
});

describe('Secrets settings', () => {
  it('shows how the vault is protected and what each secret provides, never a value', async () => {
    render(<><SecretsSettings /><DialogHost /></>);
    expect(await screen.findByText(/Protected by Windows \(DPAPI\)/)).toBeTruthy();
    expect(screen.getByText('octocat')).toBeTruthy();
    expect(screen.getByText('ssh-ed25519 AAAAC3Nza deploy@nullbot')).toBeTruthy();
    const row = screen.getAllByText('github').find(el => el.closest('tr'))!.closest('tr')!;
    expect(within(row).getByText('GH_TOKEN, GITHUB_TOKEN')).toBeTruthy();
    expect(within(row).getByText(/Also given to github-mcp/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: 'Check'}));
    await waitFor(() => expect(bridge.callsTo('VerifyGitHubToken')).toEqual([['github']]));
  });

  it('asks before letting agents use a secret, and keeps its other settings', async () => {
    render(<><SecretsSettings /><DialogHost /></>);
    const toggle = await screen.findByRole('checkbox', {name: 'Agents may use github'});
    fireEvent.click(toggle);
    fireEvent.click(await screen.findByRole('button', {name: 'Allow'}));
    await waitFor(() => expect(bridge.callsTo('SaveSecret')).toHaveLength(1));
    const input = bridge.callsTo('SaveSecret')[0][0] as any;
    expect(input).toMatchObject({name: 'github', kind: 'github_token', agent_use: true, description: 'Work repos', servers: ['github-mcp'], values: {}});
  });

  it('adds a secret from the kind’s fields', async () => {
    render(<><SecretsSettings /><DialogHost /></>);
    fireEvent.click(await screen.findByRole('button', {name: 'Add a secret'}));
    fireEvent.change(await screen.findByRole('combobox'), {target: {value: 'aws'}});
    fireEvent.change(screen.getByPlaceholderText('aws-prod'), {target: {value: 'aws-prod'}});
    fireEvent.change(screen.getByLabelText('Access key ID'), {target: {value: 'AKIAEXAMPLE'}});
    fireEvent.change(screen.getByLabelText('Secret access key'), {target: {value: 'very-secret'}});
    fireEvent.change(screen.getByLabelText('Region (optional)'), {target: {value: 'us-east-1'}});
    fireEvent.click(screen.getByRole('checkbox', {name: 'GitHub MCP'}));
    fireEvent.click(screen.getByRole('button', {name: 'Add'}));
    await waitFor(() => expect(bridge.callsTo('SaveSecret')).toHaveLength(1));
    expect(bridge.callsTo('SaveSecret')[0][0]).toMatchObject({
      name: 'aws-prod', kind: 'aws', agent_use: false, servers: ['github-mcp'],
      values: {access_key_id: 'AKIAEXAMPLE', secret_access_key: 'very-secret'}, public: {region: 'us-east-1'},
    });
  });

  it('unlocks a passphrase vault', async () => {
    bridge.set('VaultStatus', () => ({path: '/srv/.nullbot/vault/vault.json', exists: true, unlocked: false, protection: 'passphrase', protection_label: 'a passphrase', secrets: 0, error: 'vault: locked'}));
    bridge.set('UnlockVault', () => unlocked);
    render(<><SecretsSettings /><DialogHost /></>);
    const field = await screen.findByLabelText('Vault passphrase');
    expect(screen.queryByText('All secrets')).toBeNull();
    fireEvent.change(field, {target: {value: 'correct horse'}});
    fireEvent.click(screen.getByRole('button', {name: 'Unlock'}));
    await waitFor(() => expect(bridge.callsTo('UnlockVault')).toEqual([['correct horse']]));
  });
});
