// Cloud: a plan an agent proposed is read and approved here, never by the
// agent; machines show what runs on them; removals are plans too.
import {beforeEach, describe, expect, it} from 'vitest';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {installBridge, type FakeBridge} from '../../test/bridge';
import {appStore} from '../../state/app';
import {infraStore, refreshInfraWaiting, requesterName, resetInfraWaiting} from '../../state/infra';
import {DialogHost} from '../../ui/dialogs';
import {ToastHost} from '../../ui/toast';
import {CloudView, hourly, shellQuote} from './CloudView';
import type {InfraPlan, InfraResource} from '../../lib/types';

let bridge: FakeBridge;
let plans: InfraPlan[];
let resources: InfraResource[];

const gpu: InfraResource = {
  id: 'nb-1a2b3c4d', cloud: 'aws', kind: 'instance', name: 'gpu-box', region: 'us-east-1', cloud_id: 'i-0abc', state: 'ready',
  plan_id: 'plan-11111111', credential: 'aws-lab', created: '2026-10-28T10:00:00Z', updated: '2026-10-28T10:05:00Z',
  details: {type: 'g6.xlarge', disk_gb: '100', ssh_user: 'ubuntu', ports: '', public_ip: '34.1.2.3', setup: 'gpu_drivers,ollama', models: 'qwen2.5:32b', ssh_key_secret: 'cloud'},
  cost_hourly: 0.8184, depends_on: ['nb-5e6f7a8b'],
};
const sg: InfraResource = {
  id: 'nb-5e6f7a8b', cloud: 'aws', kind: 'security_group', name: 'nb-gpu-box', region: 'us-east-1', cloud_id: 'sg-0abc', state: 'ready',
  plan_id: 'plan-11111111', credential: 'aws-lab', created: '2026-10-28T10:00:00Z', updated: '2026-10-28T10:00:00Z',
  details: {ports: '', allow_from: '198.51.100.7/32'},
};

const proposal = (): InfraPlan => ({
  id: 'plan-22222222', title: 'Create eval-box on AWS', cloud: 'aws', credential: 'aws-lab', region: 'eu-west-1', kind: 'create',
  state: 'proposed', reason: 'A box to run the eval this afternoon', requester: 'agent main', created: new Date().toISOString(), hash: 'abc123',
  cost_hourly: 0.0496, cost_note: 'On-demand list prices in us-east-1, with the disk.',
  resources: [{...sg, id: 'nb-99999999', name: 'nb-eval-box', state: 'planned', cloud_id: ''}, {...gpu, id: 'nb-88888888', name: 'eval-box', state: 'planned', cloud_id: '', details: {type: 't3.medium', disk_gb: '30', ssh_user: 'ubuntu', ports: '8080'}}],
  steps: [
    {id: 's1', summary: 'Create security group nb-eval-box', action: 'create', argv: ['aws', 'ec2', 'create-security-group', '--group-name', 'nb-eval-box', '--description', 'NullBot plan-22222222 for eval-box']},
    {id: 's2', summary: 'Open TCP 22, 8080 to 198.51.100.7/32', action: 'change', argv: ['aws', 'ec2', 'authorize-security-group-ingress', '--group-id', '{{cloud_id:nb-99999999}}']},
    {id: 's3', summary: 'Start machine eval-box', action: 'create', argv: ['aws', 'ec2', 'run-instances', '--user-data', 'file://{{input_file}}'], input: '#!/bin/bash\necho hi\n'},
  ],
});

beforeEach(() => {
  resetInfraWaiting();
  appStore.set({versions: {}} as any);
  plans = [proposal(), {...proposal(), id: 'plan-11111111', title: 'Create gpu-box on AWS', state: 'applied', requester: 'you (command line)', reason: ''}];
  resources = [gpu, sg];
  bridge = installBridge({
    InfraState: () => ({agent_tools: true, plans, resources, cost_hourly: 0.8184, tools: {aws: '/usr/local/bin/aws', gcloud: 'missing: gcloud was not found'}}),
    Tunnels: () => [],
    DecideInfraPlan: (id: string, approve: boolean) => ({...plans.find(p => p.id === id), state: approve ? 'approved' : 'rejected'}),
    PlanInfraDestroy: (ids: string[]) => ({...proposal(), id: 'plan-33333333', kind: 'destroy', title: `Remove ${ids.join(', ')}`}),
    InspectNode: () => ({
      resource: gpu.id, name: 'gpu-box', address: '34.1.2.3', read: new Date().toISOString(), setup: 'done',
      listeners: [{address: '0.0.0.0', port: 22, process: 'sshd', public: true, known: 'SSH'}, {address: '127.0.0.1', port: 11434, process: 'ollama', public: false, known: 'Ollama'}],
      services: ['ollama.service', 'nullbot.service'],
    }),
    ConnectNodeOllama: () => ({id: 'gpu-box', kind: 'ollama', base_url: 'http://127.0.0.1:40111'}),
    InfraLedger: () => [
      {time: '2026-10-28T10:00:00Z', plan: 'plan-11111111', event: 'proposed', by: 'you (command line)'},
      {time: '2026-10-28T10:01:00Z', plan: 'plan-11111111', event: 'step', summary: 'Start machine gpu-box', argv: ['aws', 'ec2', 'run-instances'], exit: 0},
    ],
    ThisComputer: () => ({name: 'this computer', read: new Date().toISOString(), listeners: [{address: '127.0.0.1', port: 11434, process: 'ollama', public: false}, {address: '0.0.0.0', port: 5432, process: 'postgres', public: true}]}),
  });
});

describe('cloud', () => {
  it('shows a waiting plan first, with every command as it will run', async () => {
    render(<CloudView />);
    const header = await screen.findByRole('heading', {name: 'Create eval-box on AWS'});
    expect(header).toBeTruthy();
    expect(screen.getByText('A box to run the eval this afternoon')).toBeTruthy();
    expect(screen.getByText('Why the main agent asked')).toBeTruthy();
    const steps = screen.getByText('Commands, in order (3)').closest('section')!;
    expect(within(steps).getByText(/aws ec2 create-security-group --group-name nb-eval-box --description 'NullBot plan-22222222 for eval-box'/)).toBeTruthy();
    // Values from earlier steps are named, not shown as template syntax.
    expect(within(steps).getByText('‹id of security group nb-eval-box›')).toBeTruthy();
    // A script the requester wrote is open for reading; NullBot's own is folded.
    expect(within(steps).getByText(/First-boot script as requested, 2 lines/).closest('details')!.open).toBe(true);
    const bar = screen.getByRole('region', {name: 'Decision'});
    expect(within(bar).getByText(/Approving runs these 3 commands on AWS/)).toBeTruthy();
    expect(within(bar).getByText('$0.05 an hour')).toBeTruthy();
  });

  it('approves and runs, or rejects, only when a person clicks', async () => {
    render(<CloudView />);
    const bar = await screen.findByRole('region', {name: 'Decision'});
    expect(bridge.callsTo('DecideInfraPlan')).toEqual([]);
    fireEvent.click(within(bar).getByRole('button', {name: 'Approve and run'}));
    await waitFor(() => expect(bridge.callsTo('DecideInfraPlan')).toEqual([['plan-22222222', true, true, 'abc123']]));
    fireEvent.click(within(bar).getByRole('button', {name: 'Reject'}));
    await waitFor(() => expect(bridge.callsTo('DecideInfraPlan')[1]).toEqual(['plan-22222222', false, false, '']));
  });

  it('asks before approving a removal', async () => {
    plans = [{...proposal(), kind: 'destroy', title: 'Remove gpu-box from AWS', resources: [gpu], cost_hourly: -0.8184}];
    render(<><CloudView /><DialogHost /></>);
    const bar = await screen.findByRole('region', {name: 'Decision'});
    expect(within(bar).getByText(/Removing runs these 3 commands/)).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', {name: 'Approve and remove'}));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Remove gpu-box?')).toBeTruthy();
    expect(bridge.callsTo('DecideInfraPlan')).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', {name: 'Remove'}));
    await waitFor(() => expect(bridge.callsTo('DecideInfraPlan')).toEqual([['plan-22222222', true, true, 'abc123']]));
  });

  it('shows a machine, what runs on it, and connects its Ollama', async () => {
    render(<><CloudView /><ToastHost /></>);
    const machines = await screen.findByText('Machines');
    fireEvent.click(within(machines.closest('.list-group') as HTMLElement).getByRole('button', {name: /gpu-box/}));
    await screen.findByRole('heading', {name: 'gpu-box'});
    expect(screen.getByText('34.1.2.3')).toBeTruthy();
    expect(screen.getByText('198.51.100.7/32')).toBeTruthy();
    expect(screen.getByText(/Sets up GPU drivers, Ollama, qwen2.5:32b/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: 'Look inside'}));
    await waitFor(() => expect(bridge.callsTo('InspectNode')).toEqual([['nb-1a2b3c4d']]));
    expect(await screen.findByText('First-boot setup finished.')).toBeTruthy();
    expect(screen.getByText('Only the machine')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', {name: 'Use its Ollama here'})[0]);
    await waitFor(() => expect(bridge.callsTo('ConnectNodeOllama')).toEqual([['nb-1a2b3c4d']]));
    expect(await screen.findByText(/local:gpu-box\/MODEL/)).toBeTruthy();
  });

  it('proposes a removal as a plan instead of removing anything', async () => {
    render(<><CloudView /><ToastHost /></>);
    const machines = await screen.findByText('Machines');
    fireEvent.click(within(machines.closest('.list-group') as HTMLElement).getByRole('button', {name: /gpu-box/}));
    await screen.findByRole('heading', {name: 'gpu-box'});
    fireEvent.click(screen.getByRole('button', {name: 'More'}));
    fireEvent.click(await screen.findByRole('menuitem', {name: 'Remove…'}));
    await waitFor(() => expect(bridge.callsTo('PlanInfraDestroy')).toEqual([[['nb-1a2b3c4d'], false, '']]));
    expect(infraStore.get().selected).toBe('plan-33333333');
    expect(bridge.callsTo('DecideInfraPlan')).toEqual([]);
  });

  it('lists the ledger and what listens on this computer', async () => {
    render(<CloudView />);
    fireEvent.click(await screen.findByRole('button', {name: /Ledger/}));
    expect(await screen.findByText('aws ec2 run-instances')).toBeTruthy();
    expect(screen.getAllByText('You').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', {name: /This computer/}));
    expect(await screen.findByText('postgres')).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
  });

  it('turns agent plans off', async () => {
    render(<CloudView />);
    const box = await screen.findByRole('checkbox', {name: 'Agents can propose'});
    expect((box as HTMLInputElement).checked).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect(bridge.callsTo('SetInfraAgentTools')).toEqual([[false]]));
  });

  it('announces a plan an agent proposed, once', async () => {
    render(<ToastHost />);
    plans = [];
    await act(() => refreshInfraWaiting());
    plans = [proposal()];
    await act(() => refreshInfraWaiting());
    expect(infraStore.get().waiting).toHaveLength(1);
    expect(await screen.findByText(/The main agent proposed a cloud plan: Create eval-box on AWS/)).toBeTruthy();
    await act(() => refreshInfraWaiting());
    expect(screen.getAllByText(/proposed a cloud plan/)).toHaveLength(1);
  });
});

describe('cloud helpers', () => {
  it('quotes commands the way a shell needs them', () => {
    expect(shellQuote('--group-name')).toBe('--group-name');
    expect(shellQuote('NullBot plan for x')).toBe(`'NullBot plan for x'`);
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
    expect(shellQuote('IpRanges=[{CidrIp=1.2.3.4/32}]')).toBe(`'IpRanges=[{CidrIp=1.2.3.4/32}]'`);
    expect(shellQuote('{{cloud_id:nb-1a2b3c4d}}')).toBe('{{cloud_id:nb-1a2b3c4d}}');
  });
  it('names who asked and what it costs', () => {
    expect(requesterName('agent main')).toBe('The main agent');
    expect(requesterName('agent subagent/t-3')).toBe('A subagent');
    expect(requesterName('you (desktop app)')).toBe('You');
    expect(hourly(0.8184)).toBe('$0.818 an hour');
    expect(hourly(2.5)).toBe('$2.50 an hour');
    expect(hourly(-0.05)).toBe('$0.05 an hour');
  });
});
