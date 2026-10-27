// Files: recursive search, navigation, the right-click actions, selection,
// and previews for the less common formats.
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {installBridge, type FakeBridge} from '../../test/bridge';
import {FilesView, fileClipboard} from './FilesView';
import {PreviewContent, PreviewPane} from './Preview';
import {lookFor} from './fileIcons';
import {appStore} from '../../state/app';
import {DialogHost} from '../../ui/dialogs';
import {resetUnsavedEdits} from '../../lib/dirty';

const root = 'C:\\work\\ops';
const entry = (name: string, extra: Record<string, unknown> = {}) => ({name, path: `${root}\\${name}`, rel_path: name, is_dir: false, size: 120, modified: '2026-10-26T10:00:00Z', extension: name.includes('.') ? name.slice(name.lastIndexOf('.')) : '', kind: 'text', ...extra});
const listing = (dir: string) => ({
  workspace: root, current: dir, parent: dir === root ? 'C:\\work' : root,
  entries: dir === root
    ? [entry('reports', {is_dir: true, kind: 'folder'}), entry('notes.md', {kind: 'markdown'}), entry('data.xlsx', {kind: 'xlsx'}), entry('run.ps1', {kind: 'code'})]
    : [entry('q3.md', {path: `${dir}\\q3.md`, kind: 'markdown'})],
});

let bridge: FakeBridge;
beforeEach(() => {
  resetUnsavedEdits();
  fileClipboard.set({paths: [], move: false});
  bridge = installBridge({
    ListFiles: (path: string) => listing(path),
    PreviewFile: (path: string) => ({path, name: path.split('\\').pop(), kind: 'text', mime: 'text/plain', size: 3, editable: true, truncated: false, content: 'abc'}),
    SearchFiles: (req: any) => ({root: req.root, scanned: 42, truncated: false, skipped: ['node_modules'], entries: [entry('q3-report.md', {path: `${root}\\reports\\2026\\q3-report.md`, rel_path: 'reports/2026/q3-report.md', kind: 'markdown'})]}),
    CopyPaths: (req: any) => listing(req.dest),
    DeletePath: () => listing(root),
  });
  appStore.set({projects: {projects: [{id: 'ops', name: 'ops', path: root, permission: 'full'}], primary_project_id: 'ops', workspace_dir: root, warning: ''} as any, fileRequest: null, ui: null as any});
});
afterEach(() => {
  document.body.innerHTML = '';
});

async function mount() {
  render(<><FilesView /><DialogHost /></>);
  await screen.findByText('notes.md');
}

const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
const menuItem = (name: RegExp | string) => screen.getByRole('menuitem', {name});

describe('Files', () => {
  it('searches subfolders and shows where each result is', async () => {
    await mount();
    fireEvent.click(screen.getByRole('radio', {name: 'Subfolders too'}));
    fireEvent.change(screen.getByRole('textbox', {name: /Search this folder and its subfolders/}), {target: {value: 'report'}});
    await screen.findByText('q3-report.md', {}, {timeout: 2000});
    expect(bridge.callsTo('SearchFiles').at(-1)).toEqual([{root, query: 'report', kind: ''}]);
    expect(screen.getByText('reports/2026')).toBeTruthy();
    expect(screen.getByText('q3-report.md').closest('tr')?.querySelector('.file-folder')?.textContent).toBe('reports/2026');
    expect(screen.getByRole('status').textContent).toMatch(/1 result below .*skipped node_modules/);
    fireEvent.contextMenu(row('q3-report.md'));
    fireEvent.click(menuItem('Go to its folder'));
    await waitFor(() => expect(bridge.callsTo('ListFiles').at(-1)).toEqual([`${root}\\reports\\2026`]));
  });

  it('filters this folder by type', async () => {
    await mount();
    fireEvent.change(screen.getByRole('combobox', {name: 'Type'}), {target: {value: 'sheet'}});
    expect(screen.getByText('data.xlsx')).toBeTruthy();
    expect(screen.queryByText('notes.md')).toBeNull();
  });

  it('goes back, forward, up and home', async () => {
    await mount();
    fireEvent.click(row('reports'));
    await screen.findByText('q3.md');
    fireEvent.click(screen.getByRole('button', {name: 'Back'}));
    await screen.findByText('notes.md');
    fireEvent.click(screen.getByRole('button', {name: 'Forward'}));
    await screen.findByText('q3.md');
    fireEvent.click(screen.getByRole('button', {name: 'Primary project'}));
    await screen.findByText('notes.md');
    fireEvent.click(screen.getByRole('button', {name: 'Go to…'}));
    const path = screen.getByRole('textbox', {name: 'Folder path'});
    fireEvent.change(path, {target: {value: `${root}\\reports`}});
    fireEvent.keyDown(path, {key: 'Enter'});
    await screen.findByText('q3.md');
  });

  it('opens with, copies, cuts, pastes and duplicates from the right-click menu', async () => {
    await mount();
    fireEvent.contextMenu(row('notes.md'));
    fireEvent.click(menuItem('Open with…'));
    expect(bridge.callsTo('OpenWith')).toEqual([[`${root}\\notes.md`]]);

    fireEvent.contextMenu(row('notes.md'));
    fireEvent.click(menuItem(/^Copy Ctrl\+C/));
    fireEvent.contextMenu(row('reports'));
    fireEvent.click(menuItem(/Paste into this folder/));
    await waitFor(() => expect(bridge.callsTo('CopyPaths')).toEqual([[{sources: [`${root}\\notes.md`], dest: `${root}\\reports`, move: false}]]));

    fireEvent.contextMenu(row('data.xlsx'));
    fireEvent.click(menuItem(/^Cut/));
    expect(row('data.xlsx').className).toContain('is-cut');
    fireEvent.click(screen.getByRole('button', {name: /Move here/}));
    await waitFor(() => expect(bridge.callsTo('CopyPaths').at(-1)).toEqual([{sources: [`${root}\\data.xlsx`], dest: root, move: true}]));

    fireEvent.contextMenu(row('notes.md'));
    fireEvent.click(menuItem('Duplicate'));
    await waitFor(() => expect(bridge.callsTo('CopyPaths').at(-1)).toEqual([{sources: [`${root}\\notes.md`], dest: root, move: false}]));
  });

  it('leaves Alt+arrows to text fields and refreshes search results after a change', async () => {
    await mount();
    fireEvent.click(row('reports'));
    await screen.findByText('q3.md');
    const search = screen.getByRole('textbox', {name: 'Filter this folder'});
    fireEvent.keyDown(search, {key: 'ArrowLeft', altKey: true});
    expect(screen.getByText('q3.md')).toBeTruthy();
    fireEvent.keyDown(row('q3.md'), {key: 'ArrowLeft', altKey: true});
    await screen.findByText('notes.md');

    fireEvent.click(screen.getByRole('radio', {name: 'Subfolders too'}));
    fireEvent.change(screen.getByRole('textbox', {name: /Search this folder and its subfolders/}), {target: {value: 'report'}});
    await screen.findByText('q3-report.md', {}, {timeout: 2000});
    const searches = bridge.callsTo('SearchFiles').length;
    fireEvent.contextMenu(row('q3-report.md'));
    fireEvent.click(menuItem('Duplicate'));
    await waitFor(() => expect(bridge.callsTo('SearchFiles').length).toBeGreaterThan(searches));
  });

  it('says why a file can’t be edited', () => {
    render(<PreviewPane preview={{path: `${root}\\old.txt`, name: 'old.txt', kind: 'text', mime: 'text/plain', size: 4, editable: false, truncated: false, content: 'café', encoding: 'windows-1252', read_only_reason: 'Stored as Windows-1252 text; edit it in another app to keep that encoding'}} writable onSaved={() => undefined} />);
    const edit = screen.getByRole('button', {name: 'Edit'}) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(edit.title).toMatch(/Windows-1252/);
  });

  it('selects several files and deletes them together', async () => {
    await mount();
    fireEvent.click(row('notes.md'), {ctrlKey: true});
    fireEvent.click(row('run.ps1'), {ctrlKey: true});
    expect(screen.getByText(/2 selected/)).toBeTruthy();
    fireEvent.keyDown(row('run.ps1'), {key: 'Delete'});
    fireEvent.click(await screen.findByRole('button', {name: 'Delete'}));
    await waitFor(() => expect(bridge.callsTo('DeletePath')).toEqual([[`${root}\\notes.md`], [`${root}\\run.ps1`]]));
  });

  it('gives file types their own icons', () => {
    const look = (name: string, kind: string, is_dir = false) => lookFor({name, kind, is_dir, extension: name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''}).tone;
    expect([look('a', 'folder', true), look('a.md', 'markdown'), look('a.pdf', 'pdf'), look('a.go', 'code'), look('a.xlsx', 'xlsx'), look('a.pptx', 'pptx'), look('a.mp4', 'video'), look('a.zip', 'archive'), look('a.db', 'binary')])
      .toEqual(['folder', 'doc', 'pdf', 'code', 'sheet', 'slides', 'media', 'archive', 'sheet']);
  });
});

describe('Previews', () => {
  const base = {path: 'x', name: 'x', mime: '', size: 2048, editable: false, truncated: false};
  it('lists archives, dumps binaries and plays media', () => {
    const {container, rerender} = render(<PreviewContent mode="rendered" preview={{...base, kind: 'archive', count: 2, entries: [{name: 'a/', size: 0, is_dir: true}, {name: 'a/b.txt', size: 5}]}} />);
    expect(screen.getByText('a/b.txt')).toBeTruthy();
    expect(screen.getByText(/2 items/)).toBeTruthy();
    rerender(<PreviewContent mode="rendered" preview={{...base, kind: 'binary', hex: '00000000  4d 5a'}} />);
    expect(screen.getByText(/4d 5a/)).toBeTruthy();
    rerender(<PreviewContent mode="rendered" preview={{...base, kind: 'audio', url: '/__local/t/a.mp3'}} />);
    expect(container.querySelector('audio')?.getAttribute('src')).toBe('/__local/t/a.mp3');
    rerender(<PreviewContent mode="rendered" preview={{...base, kind: 'html', url: '/__local/t/p.html', content: '<p>x</p>'}} />);
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe('');
    rerender(<PreviewContent mode="rendered" preview={{...base, kind: 'json', content: '{"a":1}', formatted: '{\n  "a": 1\n}'}} />);
    expect(within(container).getByText(/"a": 1/).textContent).toContain('\n');
  });
});
