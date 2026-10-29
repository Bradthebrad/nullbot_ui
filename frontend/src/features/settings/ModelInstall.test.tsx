// Settings > Models > Install a model: search, builds, install with progress.
import {beforeEach, describe, expect, it} from 'vitest';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {installBridge, type FakeBridge} from '../../test/bridge';
import {ModelInstall} from './ModelInstall';

let bridge: FakeBridge;

beforeEach(() => {
  bridge = installBridge({
    SearchHFModels: () => [{id: 'Qwen/Qwen2.5-7B-Instruct-GGUF', downloads: 120000, likes: 300, last_modified: '2026-09-01'}, {id: 'meta-llama/Llama-3.1-8B-GGUF', downloads: 9000, likes: 50, needs_token: true}],
    HFBuilds: () => [
      {name: 'qwen2.5-7b-instruct-q4_k_m.gguf', quant: 'Q4_K_M', size: 4.68e9, files: ['qwen2.5-7b-instruct-q4_k_m.gguf'], parts: 1, complete: true, recommended: true},
      {name: 'qwen2.5-7b-instruct-q8_0.gguf', quant: 'Q8_0', size: 8.1e9, files: ['a', 'b'], parts: 2, complete: true},
      {name: 'mmproj-f16.gguf', quant: 'F16', size: 6e8, files: ['mmproj-f16.gguf'], parts: 1, complete: true, projector: true},
    ],
    LocalEndpoints: () => [{id: 'ollama', kind: 'ollama', title: 'Ollama', base_url: 'http://localhost:11434', status: {reachable: true}}],
    InstallModel: () => 'install-1',
    MachineHardware: () => ({summary: 'Ryzen 9 7950X · 64 GB RAM · RTX 4090, 24 GB VRAM', hardware: {}}),
    SuggestModels: (opts: any) => ({hardware: {}, options: opts, fits: [
      {model: {name: 'Qwen/Qwen2.5-Coder-14B-Instruct', parameter_count: '14.8B'}, fit: 'good', run_mode: 'gpu', quant: 'Q5_K_M', tokens_per_second: 48.2, ollama_tag: 'qwen2.5-coder:14b', gguf_repo: 'Qwen/Qwen2.5-Coder-14B-Instruct-GGUF'},
      {model: {name: 'mistralai/Devstral-Small-2505', parameter_count: '23.6B'}, fit: 'marginal', run_mode: 'cpu_offload', quant: 'Q4_K_M', tokens_per_second: 9.1, gguf_repo: 'unsloth/Devstral-Small-2505-GGUF'},
    ]}),
    PullLocalModel: () => undefined,
    ModelCatalog: () => [],
    State: () => ({config: {}}),
  });
});

describe('installing a model', () => {
  it('searches, shows the builds and installs into Ollama with progress', async () => {
    render(<ModelInstall />);
    fireEvent.click(screen.getByRole('tab', {name: 'Search Hugging Face'}));
    fireEvent.change(screen.getByRole('searchbox', {name: 'Search Hugging Face'}), {target: {value: 'qwen 7b'}});
    fireEvent.click(screen.getByRole('button', {name: 'Search'}));
    await waitFor(() => expect(bridge.callsTo('SearchHFModels')).toEqual([['qwen 7b', 'downloads', 20]]));
    expect(await screen.findByText('Needs a token')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: 'Qwen/Qwen2.5-7B-Instruct-GGUF'}));
    const builds = await screen.findByLabelText('Builds of Qwen/Qwen2.5-7B-Instruct-GGUF');
    await within(builds).findByText('Suggested');
    expect(within(builds).queryByText('mmproj-f16.gguf')).toBeNull();
    await waitFor(() => expect(within(builds).getByRole('option', {name: 'Pull into Ollama'})).toBeTruthy());
    fireEvent.click(within(builds).getByRole('button', {name: 'Install qwen2.5-7b-instruct-q4_k_m.gguf'}));
    await waitFor(() => expect(bridge.callsTo('InstallModel')).toEqual([[{repo: 'Qwen/Qwen2.5-7B-Instruct-GGUF', build: 'qwen2.5-7b-instruct-q4_k_m.gguf', target: 'ollama', server: 'ollama'}]]));
    act(() => bridge.emit('model-install', {id: 'install-1', repo: 'Qwen/Qwen2.5-7B-Instruct-GGUF', status: 'pulling', done: 50, total: 100}));
    expect(await screen.findByText(/pulling · 50%/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
    await waitFor(() => expect(bridge.callsTo('CancelInstall')).toEqual([['install-1']]));
  });

  it('suggests models for this computer and pulls one into Ollama', async () => {
    render(<ModelInstall />);
    expect(await screen.findByText('Ryzen 9 7950X · 64 GB RAM · RTX 4090, 24 GB VRAM')).toBeTruthy();
    const table = await screen.findByRole('table', {name: 'Models that run well here'});
    expect(within(table).getByText('Runs well')).toBeTruthy();
    expect(within(table).getByText('GPU + RAM')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', {name: 'Task'}), {target: {value: 'coding'}});
    await waitFor(() => expect(bridge.callsTo('SuggestModels').at(-1)![0]).toMatchObject({use_case: 'coding', context_length: 16384}));
    fireEvent.click(await within(table).findByRole('button', {name: 'Install Qwen/Qwen2.5-Coder-14B-Instruct'}));
    await waitFor(() => expect(bridge.callsTo('PullLocalModel')).toEqual([['ollama', 'qwen2.5-coder:14b']]));
    // Without an Ollama tag, it opens the repo's builds.
    fireEvent.click(within(table).getByRole('button', {name: 'Install mistralai/Devstral-Small-2505'}));
    expect(await screen.findByLabelText('Builds of unsloth/Devstral-Small-2505-GGUF')).toBeTruthy();
  });

  it('saves to a folder and says how to serve it', async () => {
    render(<ModelInstall />);
    fireEvent.click(screen.getByRole('tab', {name: 'Search Hugging Face'}));
    fireEvent.click(screen.getByRole('button', {name: 'Search'}));
    fireEvent.click(await screen.findByRole('button', {name: 'Qwen/Qwen2.5-7B-Instruct-GGUF'}));
    const builds = await screen.findByLabelText('Builds of Qwen/Qwen2.5-7B-Instruct-GGUF');
    fireEvent.change(await within(builds).findByRole('combobox', {name: 'Install to'}), {target: {value: 'files'}});
    fireEvent.click(within(builds).getByRole('button', {name: 'Install qwen2.5-7b-instruct-q8_0.gguf'}));
    await waitFor(() => expect(bridge.callsTo('InstallModel')[0][0]).toMatchObject({target: 'files', build: 'qwen2.5-7b-instruct-q8_0.gguf'}));
    act(() => bridge.emit('model-install', {id: 'install-1', repo: 'Qwen/Qwen2.5-7B-Instruct-GGUF', status: 'done', ended: true, result: {target: 'files', model: '/m/a', paths: ['/m/a', '/m/b'], next: 'Serve it with llama.cpp: llama-server -m "/m/a"'}}));
    expect(await screen.findByText(/Serve it with llama.cpp/)).toBeTruthy();
  });
});
