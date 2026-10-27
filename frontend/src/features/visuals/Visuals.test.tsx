// The visual window: it pops up for a new visual, records what the frame
// reports (and nothing from anywhere else), and sends the answer.
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {installBridge, type FakeBridge} from '../../test/bridge';
import {VisualWindow} from './VisualWindow';
import {VisualsView} from './VisualsView';
import {boundedEvents} from './VisualSurface';
import {handleLiveVisuals, resetVisuals, visualStore} from '../../state/visuals';
import {appStore} from '../../state/app';
import {DialogHost} from '../../ui/dialogs';
import {ToastHost} from '../../ui/toast';
import type {Visualization} from '../../lib/types';

const base = (extra: Partial<Visualization>): Visualization => ({
  id: 'vis-20261027-091500-aaaaaa', title: 'Pick a logo', kind: 'poll', status: 'open', created_at: '2026-10-27T09:15:00Z', updated_at: '2026-10-27T09:15:00Z',
  events: 0, dir: 'C:\\work\\acme-ops\\.nullbot\\visualizations\\vis-20261027-091500-aaaaaa', project_id: 'ops', project_name: 'acme-ops', ...extra,
});
const poll = base({prompt: 'Which logo should the landing page use?', waiting: true, wait: true, options: [{id: 'round', label: 'Round mark'}, {id: 'square', label: 'Square mark', description: 'Heavier, reads well small'}], allow_other: true});
const page = base({id: 'vis-20261027-091600-bbbbbb', title: 'Checkout prototype', kind: 'html', prompt: 'Try paying with the test card.', submission_id: 's1'});

let bridge: FakeBridge;
beforeEach(() => {
  resetVisuals();
  appStore.set({projects: {projects: [{id: 'ops', name: 'acme-ops', path: 'C:\\work\\acme-ops', permission: 'read-write'}, {id: 'lab', name: 'lab', path: 'C:\\lab', permission: 'full'}], primary_project_id: 'ops', workspace_dir: 'C:\\work\\acme-ops', warning: ''} as any, versions: {}, visualRequest: ''});
  bridge = installBridge({
    OpenVisualization: (id: string) => (id === poll.id ? {visual: poll} : {visual: page, document: '<!doctype html><p>prototype</p>'}),
    RespondVisualization: (req: any) => ({visual: {...(req.id === poll.id ? poll : page), status: req.dismiss ? 'dismissed' : 'submitted', waiting: false}, how: 'tool'}),
    Visualization: (id: string) => (id === poll.id ? {...poll, status: 'submitted', waiting: false} : page),
  });
});
afterEach(() => {
  document.body.innerHTML = '';
});

function mount() {
  return render(<><VisualWindow /><DialogHost /><ToastHost /></>);
}

describe('Visual window', () => {
  it('pops up for a waiting poll and sends the choice with a note', async () => {
    mount();
    act(() => handleLiveVisuals([poll]));
    const win = await screen.findByRole('dialog', {name: 'Visual: Pick a logo'});
    expect(within(win).getByText('Which logo should the landing page use?', {selector: '.visual-prompt > span'})).toBeTruthy();
    expect(within(win).getByText('Waiting for you')).toBeTruthy();
    const send = within(win).getByRole('button', {name: 'Send to NullBot'}) as HTMLButtonElement;
    await screen.findByText('Square mark');
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByText('Square mark'));
    expect(send.disabled).toBe(false);
    await waitFor(() => expect(bridge.callsTo('RecordVisualEvents').length).toBe(1));
    expect((bridge.callsTo('RecordVisualEvents')[0][1] as any[])[0]).toMatchObject({type: 'select', label: 'Square mark'});
    fireEvent.change(within(win).getByRole('textbox', {name: 'Note for NullBot'}), {target: {value: 'Round looks dated'}});
    fireEvent.click(send);
    await waitFor(() => expect(bridge.callsTo('RespondVisualization')).toHaveLength(1));
    expect(bridge.callsTo('RespondVisualization')[0][0]).toEqual({id: poll.id, response: {selected: ['square']}, note: 'Round looks dated', dismiss: false});
    await waitFor(() => expect(screen.queryByRole('dialog', {name: /Visual:/})).toBeNull());
    expect(await screen.findByText('Sent to NullBot.')).toBeTruthy();
    // It doesn't pop up again for the same visual.
    act(() => handleLiveVisuals([poll]));
    expect(screen.queryByRole('dialog', {name: /Visual:/})).toBeNull();
  });

  it('records only what its own frame reports, and lets the person skip', async () => {
    mount();
    act(() => handleLiveVisuals([{...page, waiting: true}]));
    const win = await screen.findByRole('dialog', {name: 'Visual: Checkout prototype'});
    const frame = await waitFor(() => win.querySelector('iframe') as HTMLIFrameElement);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-modals allow-pointer-lock');
    expect(frame.getAttribute('srcdoc')).toContain('prototype');
    const post = (data: unknown, source: any) => act(() => {
      window.dispatchEvent(new MessageEvent('message', {data, source}));
    });
    // Another window can't record or set the answer.
    post({__nullbot: 1, type: 'events', events: [{type: 'click', target: 'button#pay'}]}, window);
    post({__nullbot: 1, type: 'submit', data: {paid: true}}, window);
    expect(bridge.callsTo('RecordVisualEvents')).toHaveLength(0);
    post({__nullbot: 1, type: 'events', events: [{type: 'click', target: 'button#pay'}, {type: 'error', message: 'pay is not defined'}]}, frame.contentWindow);
    await waitFor(() => expect(bridge.callsTo('RecordVisualEvents')).toEqual([[page.id, [{type: 'click', target: 'button#pay'}, {type: 'error', message: 'pay is not defined'}]]]));
    expect(within(win).getByText('2 interactions recorded')).toBeTruthy();
    post({__nullbot: 1, type: 'submit', data: {paid: false}}, frame.contentWindow);
    expect(within(win).getByText('The visual is ready to send.')).toBeTruthy();
    fireEvent.click(within(win).getByRole('button', {name: 'Skip'}));
    await waitFor(() => expect(bridge.callsTo('RespondVisualization')).toHaveLength(1));
    expect(bridge.callsTo('RespondVisualization')[0][0]).toEqual({id: page.id, response: null, note: '', dismiss: true});
  });

  it('follows the page only when the page itself is leaving', async () => {
    mount();
    act(() => handleLiveVisuals([{...page, waiting: true}]));
    const win = await screen.findByRole('dialog', {name: 'Visual: Checkout prototype'});
    const frame = await waitFor(() => win.querySelector('iframe') as HTMLIFrameElement);
    bridge.set('VisualPage', (id: string, _origin: string, p: string) => ({visual: page, document: `<p>${p}</p>`, page: p}));
    // A frame inside the page asked for widget.html: nothing changes.
    act(() => bridge.emit('visual-navigate', {id: page.id, page: 'widget.html'}));
    expect(bridge.callsTo('VisualPage')).toHaveLength(0);
    // The page says it is leaving, then the server sees the new page.
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {data: {__nullbot: 1, type: 'leaving'}, source: frame.contentWindow}));
    });
    act(() => bridge.emit('visual-navigate', {id: page.id, page: 'thanks.html'}));
    await waitFor(() => expect(bridge.callsTo('VisualPage').map(c => c[2])).toEqual(['thanks.html']));
    // A page that keeps moving is held back.
    for (let i = 0; i < 8; i++) act(() => {
      window.dispatchEvent(new MessageEvent('message', {data: {__nullbot: 1, type: 'navigate', page: `p${i}.html`}, source: frame.contentWindow}));
    });
    await waitFor(() => expect(bridge.callsTo('VisualPage').length).toBeLessThanOrEqual(4));
  });

  it('bounds what a page can report', () => {
    const huge = 'x'.repeat(20_000);
    const out = boundedEvents([{type: 'click'}, {type: 'custom', data: huge}, null, 'text', [1], ...Array.from({length: 400}, (_, i) => ({type: 'key', key: String(i)}))]);
    expect(out[0]).toEqual({type: 'click'});
    expect(out[1]).toMatchObject({type: 'custom', note: 'too large to keep'});
    expect(out.length).toBeLessThanOrEqual(300);
    expect(boundedEvents({not: 'a list'})).toEqual([]);
  });

  it('asks before closing a visual NullBot is waiting on, and minimizes to a pill', async () => {
    mount();
    act(() => handleLiveVisuals([poll, {...page, waiting: true}]));
    const win = await screen.findByRole('dialog', {name: 'Visual: Checkout prototype'});
    expect(within(win).getAllByRole('tab')).toHaveLength(2);
    fireEvent.click(within(win).getByRole('button', {name: 'Minimize'}));
    const pill = await screen.findByRole('button', {name: /Checkout prototype/});
    expect(pill.textContent).toContain('Waiting for you');
    fireEvent.click(pill);
    fireEvent.click(within(await screen.findByRole('dialog', {name: /Visual:/})).getByRole('button', {name: 'Close'}));
    await waitFor(() => expect(screen.getAllByRole('button', {name: 'Close'}).length).toBe(2));
    fireEvent.click(screen.getAllByRole('button', {name: 'Close'}).at(-1)!);
    await waitFor(() => expect(visualStore.get().tabs).toEqual([poll.id]));
  });
});

describe('Visuals view', () => {
  const answered = base({id: 'vis-20261026-120000-cccccc', title: 'Defects on panel 4', kind: 'image', status: 'submitted', labels: ['scratch'], response: {image: {width: 800, height: 600}, points: [{n: 1, label: 'scratch', x: 120, y: 340}]}, note: 'Only one I could see', events: 3, responded_at: '2026-10-26T12:05:00Z', created_at: '2026-10-26T12:00:00Z'});
  const labVisual = base({id: 'vis-20261025-080000-dddddd', title: 'Throughput chart', kind: 'chart', status: 'open', project_id: 'lab', project_name: 'lab', created_at: '2026-10-25T08:00:00Z'});

  it('lists visuals by project and shows what was sent back', async () => {
    bridge.set('Visualizations', (project: string) => [answered, labVisual, page].filter(v => !project || v.project_id === project));
    bridge.set('VisualEvents', () => [{type: 'load', t: 1000}, {type: 'pin', t: 2500, label: 'scratch', x: 120, y: 340}, {type: 'error', t: 3000, message: 'boom'}]);
    bridge.set('OpenVisualization', (id: string) => ({visual: [answered, labVisual, page].find(v => v.id === id), document: '<p>x</p>'}));
    render(<><VisualsView /><DialogHost /></>);
    await screen.findByText('Defects on panel 4');
    expect(screen.getByText('Answered')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', {name: 'Sort'}), {target: {value: 'project'}});
    expect(screen.getByText('lab', {selector: '.list-group-title span'})).toBeTruthy();
    fireEvent.click(screen.getByText('Defects on panel 4'));
    await screen.findByText('Only one I could see');
    expect(screen.getByRole('cell', {name: 'scratch'})).toBeTruthy();
    await screen.findByText('Interactions (3)');
    expect(screen.getByText('1 script error')).toBeTruthy();
    expect(screen.getByText('+1.5s')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', {name: 'Project'}), {target: {value: 'lab'}});
    await waitFor(() => expect(bridge.callsTo('Visualizations').at(-1)).toEqual(['lab']));
    await waitFor(() => expect(screen.queryByText('Defects on panel 4')).toBeNull());
    fireEvent.click(screen.getByRole('button', {name: 'Open to answer'}));
    expect(visualStore.get().tabs).toContain(labVisual.id);
  });
});
