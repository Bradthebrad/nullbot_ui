// Settings > Models > Model servers: finding and adding servers, pulling a
// model with progress, and widening a small Ollama context.
import {beforeEach, describe, expect, it} from 'vitest';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {installBridge, type FakeBridge} from '../../test/bridge';
import {appStore} from '../../state/app';
import {DialogHost} from '../../ui/dialogs';
import {LocalServers} from './LocalServers';

let bridge: FakeBridge;
let endpoints: any[];

const ollama = {
  id: 'ollama', kind: 'ollama', base_url: 'http://localhost:11434', provider: 'local:ollama', title: 'Ollama', kind_label: 'Ollama',
  status: {reachable: true, version: '0.12.0'},
  models: [
    {id: 'qwen2.5:7b', parameters: '7.6B', quantization: 'Q4_K_M', context_window: 4096, max_context: 32768, context_note: 'Ollama’s default unless OLLAMA_CONTEXT_LENGTH is set', capabilities: ['completion', 'tools']},
    {id: 'nomic-embed-text:latest', embedding: true},
  ],
};

beforeEach(() => {
  appStore.set({models: []} as any);
  endpoints = [ollama];
  bridge = installBridge({
    LocalEndpoints: () => endpoints,
    LocalServerKinds: () => [{id: 'ollama', label: 'Ollama', default_url: 'http://localhost:11434'}, {id: 'vllm', label: 'vLLM', default_url: 'http://localhost:8000'}],
    FindLocalServers: () => [{kind: 'lmstudio', base_url: 'http://localhost:1234', models: 3, label: 'LM Studio'}, {kind: 'ollama', base_url: 'http://localhost:11434', models: 2, label: 'Ollama', configured_as: 'ollama'}],
    SaveLocalEndpoint: (e: any) => ({...e, id: e.id || e.kind}),
    CopyLocalModelWithContext: () => 'qwen2.5-7b-32k:latest',
    PullLocalModel: () => undefined,
    ModelCatalog: () => [],
    State: () => ({config: {}}),
    Secrets: () => [{name: 'lab-key', kind: 'api_key'}, {name: 'gh', kind: 'github_token'}],
  });
});

describe('model servers', () => {
  it('lists a server’s chat models and widens a small context', async () => {
    render(<><LocalServers /><DialogHost /></>);
    const server = await screen.findByRole('article', {name: 'Ollama'});
    expect(within(server).getByText('qwen2.5:7b')).toBeTruthy();
    expect(within(server).queryByText('nomic-embed-text:latest')).toBeNull();
    expect(within(server).getByText(/NullBot’s instructions and tools need about 16k/)).toBeTruthy();
    fireEvent.click(within(server).getByRole('button', {name: /Make a 33k copy|Make a 32k copy/}));
    await waitFor(() => expect(bridge.callsTo('CopyLocalModelWithContext')).toEqual([['ollama', 'qwen2.5:7b', 32768]]));
  });

  it('finds servers on this computer and adds one', async () => {
    render(<LocalServers />);
    fireEvent.click(await screen.findByRole('button', {name: 'Find servers on this computer'}));
    const found = await screen.findByLabelText('Servers found');
    expect(within(found).getByText('Added as ollama')).toBeTruthy();
    fireEvent.click(within(found).getByRole('button', {name: 'Add'}));
    await waitFor(() => expect(bridge.callsTo('SaveLocalEndpoint')[0][0]).toMatchObject({kind: 'lmstudio', base_url: 'http://localhost:1234'}));
    await screen.findByText('Added as lmstudio');
  });

  it('adds a server by address with a key from the vault, offering only key secrets', async () => {
    render(<LocalServers />);
    fireEvent.click(await screen.findByRole('button', {name: 'Add a server'}));
    const form = screen.getByRole('form', {name: 'Add a model server'});
    fireEvent.change(within(form).getByRole('combobox', {name: 'Kind'}), {target: {value: 'vllm'}});
    fireEvent.change(within(form).getByRole('textbox', {name: /Address/}), {target: {value: 'http://gpu-box.lan:8000'}});
    fireEvent.change(within(form).getByRole('textbox', {name: /^ID/}), {target: {value: 'gpu'}});
    await waitFor(() => expect(within(form).getAllByRole('option', {name: 'lab-key'})).toHaveLength(1));
    expect(within(form).queryByRole('option', {name: 'gh'})).toBeNull();
    fireEvent.change(within(form).getByRole('combobox', {name: /API key/}), {target: {value: 'lab-key'}});
    fireEvent.click(within(form).getByRole('button', {name: 'Add server'}));
    await waitFor(() => expect(bridge.callsTo('SaveLocalEndpoint')).toEqual([[{id: 'gpu', kind: 'vllm', base_url: 'http://gpu-box.lan:8000', name: '', key_secret: 'lab-key'}, '']]));
  });

  it('pulls a model into Ollama and shows its progress', async () => {
    render(<LocalServers />);
    const server = await screen.findByRole('article', {name: 'Ollama'});
    fireEvent.change(within(server).getByRole('textbox', {name: 'Model to pull into Ollama'}), {target: {value: 'llama3.2:3b'}});
    fireEvent.click(within(server).getByRole('button', {name: 'Pull'}));
    await waitFor(() => expect(bridge.callsTo('PullLocalModel')).toEqual([['ollama', 'llama3.2:3b']]));
    act(() => bridge.emit('model-pull', {server: 'ollama', model: 'llama3.2:3b', status: 'pulling 6a0746a1ec1a', completed: 50, total: 200}));
    expect(await within(server).findByText(/llama3.2:3b: pulling 6a0746a1ec1a · 25%/)).toBeTruthy();
    fireEvent.click(within(server).getByRole('button', {name: 'Cancel'}));
    await waitFor(() => expect(bridge.callsTo('CancelLocalPull')).toEqual([['ollama', 'llama3.2:3b']]));
    act(() => bridge.emit('model-pull', {server: 'ollama', model: 'llama3.2:3b', status: 'canceled', done: true}));
    await waitFor(() => expect(within(server).queryByLabelText('Pulling llama3.2:3b')).toBeNull());
  });
});
