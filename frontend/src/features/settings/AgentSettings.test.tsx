// The context window override must be editable digit by digit, and a value
// too small to use must block saving rather than vanish.
import {beforeEach, describe, expect, it} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {installBridge, type FakeBridge} from '../../test/bridge';
import {ModelsSettings} from './ModelsSettings';
import {AgentSettings} from './AgentSettings';
import {canonical} from './form';
import {appStore} from '../../state/app';

let bridge: FakeBridge;
beforeEach(() => {
  bridge = installBridge({ContextWindow: () => ({tokens: 272000, source: 'built-in'})});
  appStore.set({
    config: {model: {provider: 'openai', model: 'gpt-5.1'}, subagent_model: {}, compaction: {enabled: true, shorten_ratio: 0.6, summarize_ratio: 0.85}} as any,
    models: [{provider: 'openai', models: [{id: 'gpt-5.1', name: 'GPT-5.1'}]}],
  });
});

describe('Model settings: context window', () => {
  it('keeps each digit typed and saves only a usable size', async () => {
    render(<ModelsSettings />);
    const field = (await screen.findAllByRole('spinbutton', {name: /Context window/}))[0] as HTMLInputElement;
    await screen.findAllByText(/Typical for this model family/);
    const save = screen.getByRole('button', {name: 'Save settings'}) as HTMLButtonElement;
    fireEvent.change(field, {target: {value: '1'}});
    expect(field.value).toBe('1');
    expect(screen.getByText(/Use at least 1,024 tokens/)).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.change(field, {target: {value: '120000'}});
    expect(field.value).toBe('120000');
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(bridge.callsTo('SaveConfig')).toHaveLength(1));
    expect((bridge.callsTo('SaveConfig')[0][0] as any).compaction.context_windows).toEqual({'openai/gpt-5.1': 120000});
  });

  it('says what turning automatic compaction off does', async () => {
    render(<AgentSettings />);
    fireEvent.click(screen.getByRole('checkbox', {name: 'Shorten and summarize automatically'}));
    expect(screen.getByText(/nothing is shortened or summarized/)).toBeTruthy();
  });
});

describe('Unsaved changes', () => {
  it('treats empty and unset values alike', () => {
    expect(canonical({a: '', b: 0, c: [], d: {}, e: false, f: null})).toBeUndefined();
    expect(canonical({b: 2, a: {y: '', x: 1}})).toEqual({a: {x: 1}, b: 2});
    expect(JSON.stringify(canonical({b: 1, a: 2}))).toBe(JSON.stringify(canonical({a: 2, b: 1})));
  });

  it('does not count clearing an untouched field as a change', async () => {
    render(<ModelsSettings />);
    const save = (await screen.findByRole('button', {name: 'Save settings'})) as HTMLButtonElement;
    const field = (await screen.findAllByRole('spinbutton', {name: /Context window/}))[0] as HTMLInputElement;
    fireEvent.change(field, {target: {value: '5000'}});
    expect(save.disabled).toBe(false);
    fireEvent.change(field, {target: {value: ''}});
    await waitFor(() => expect(save.disabled).toBe(true));
    expect(screen.getByText('Settings are up to date.')).toBeTruthy();
  });
});
