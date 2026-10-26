// The manager and subagents can each run any model from any provider, and
// subagents can follow the manager.
import {beforeEach, describe, expect, it} from 'vitest';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {installBridge, type FakeBridge} from '../../test/bridge';
import {ModelsSettings} from './ModelsSettings';
import {appStore} from '../../state/app';
import {resetUnsavedEdits} from '../../lib/dirty';

let bridge: FakeBridge;
const groups = [
  {provider: 'openai', models: [{id: 'gpt-5.1', name: 'GPT-5.1', reasoning: true}, {id: 'gpt-5.1-mini', name: 'GPT-5.1 mini'}]},
  {provider: 'anthropic', models: [{id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5'}]},
];

beforeEach(() => {
  resetUnsavedEdits();
  bridge = installBridge({ContextWindow: () => ({tokens: 272000, source: 'built-in'})});
  appStore.set({
    config: {model: {provider: 'openai', model: 'gpt-5.1', reasoning_effort: 'medium'}, subagent_model: {}, agent: {max_subagents: 3, max_iterations: 40}, compaction: {}} as any,
    models: groups as any,
    runtime: {openai_api_key_set: true, anthropic_api_key_set: false},
  });
});

const saved = () => bridge.callsTo('SaveConfig').at(-1)?.[0] as any;

describe('Models settings', () => {
  it('gives subagents their own model from another provider, and how many run at once', async () => {
    render(<ModelsSettings />);
    expect(screen.getByRole('radio', {name: 'Same model as the manager'}).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', {name: /anthropic/i}));
    fireEvent.click(screen.getByRole('button', {name: 'Use Claude Sonnet 5.5 for subagents'}));
    expect(screen.getByRole('radio', {name: 'Their own model'}).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/isn’t set up yet, so requests to it will fail/)).toBeTruthy();
    fireEvent.change(screen.getByRole('spinbutton', {name: /Subagents at once/}), {target: {value: '6'}});
    fireEvent.click(screen.getByRole('button', {name: 'Save settings'}));
    await waitFor(() => expect(saved()).toBeTruthy());
    expect(saved().model).toMatchObject({provider: 'openai', model: 'gpt-5.1', reasoning_effort: 'medium'});
    expect(saved().subagent_model).toMatchObject({provider: 'anthropic', model: 'claude-sonnet-5-5'});
    expect(saved().agent).toEqual({max_subagents: 6, max_iterations: 40});
  });

  it('lets subagents follow the manager', async () => {
    appStore.set({config: {...appStore.get().config, subagent_model: {provider: 'openai', model: 'gpt-5.1-mini'}} as any});
    render(<ModelsSettings />);
    fireEvent.click(screen.getByRole('radio', {name: 'Same model as the manager'}));
    expect(screen.getByText(/follow it when you change it/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: 'Use GPT-5.1 mini for the manager'}));
    fireEvent.click(screen.getByRole('button', {name: 'Save settings'}));
    await waitFor(() => expect(saved()).toBeTruthy());
    expect(saved().model.model).toBe('gpt-5.1-mini');
    expect(saved().subagent_model).toEqual({});
  });

  it('accepts a model ID that isn’t listed', async () => {
    render(<ModelsSettings />);
    const manager = screen.getByText('Manager', {selector: 'h3'}).closest('.settings-group') as HTMLElement;
    fireEvent.change(within(manager).getByRole('combobox', {name: /^Model/}), {target: {value: '__custom__'}});
    fireEvent.change(within(manager).getByRole('textbox', {name: /^Model/}), {target: {value: 'gpt-5.2-preview'}});
    fireEvent.click(screen.getByRole('button', {name: 'Save settings'}));
    await waitFor(() => expect(saved()?.model.model).toBe('gpt-5.2-preview'));
  });
});
