// Files: browse, search and manage the folders NullBot may use, and preview
// what's in them. Every action is checked against the project's permission
// here for the buttons, and again in the backend before anything happens.
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, ArrowUp, ClipboardPaste, FilePlus, Folder, FolderPlus, House, RefreshCw, Search, X} from 'lucide-react';
import {createStore, useStore} from '../../lib/store';
import {api} from '../../lib/bindings';
import {formatBytes, formatCount, formatDateTime, permissionLabel} from '../../lib/format';
import {commonPrefix, dirname, isAbsolutePath, isInside, joinPath, segmentsBelow} from '../../lib/paths';
import {guard} from '../../lib/dirty';
import type {Capability, FileBrowser, FileEntry, FilePreview, FileSearchKind, FileSearchResult, Project} from '../../lib/types';
import {appStore, openSettings} from '../../state/app';
import {attachToChat, chatStore, isBusy} from '../../state/chat';
import {Blank, Spinner} from '../../ui/layout';
import {ContextMenu, type MenuItem} from '../../ui/Menu';
import {Segmented} from '../../ui/Tabs';
import {confirmDialog, promptDialog} from '../../ui/dialogs';
import {toast, toastError} from '../../ui/toast';
import {EntryIcon, kindLabel} from './fileIcons';
import {PreviewPane} from './Preview';

function projectAllows(project: Project, capability: Capability): boolean {
  switch (project.permission) {
    case 'full': return true;
    case 'read-write': return capability !== 'execute';
    case 'custom': return capability === 'read' || (project.allow || []).includes(capability);
    default: return capability === 'read';
  }
}

/**
 * Mirrors the backend: every project the path is in must allow the
 * capability (the strictest overlapping project wins), and a change to a
 * folder also needs every project inside that folder to allow it.
 */
export function allowedAt(projects: Project[], path: string, capability: Capability, tree = false): boolean {
  if (!path) return false;
  const containing = projects.filter(p => isInside(path, p.path));
  if (!containing.length) return false;
  const nested = tree ? projects.filter(p => isInside(p.path, path) && !isInside(path, p.path)) : [];
  return [...containing, ...nested].every(p => projectAllows(p, capability));
}

const samePath = (a: string, b: string) => isInside(a, b) && isInside(b, a);

/** Copied or cut files, kept while you move between folders and views. */
export const fileClipboard = createStore<{paths: string[]; move: boolean}>({paths: [], move: false});

const kindFilters: {id: FileSearchKind; label: string}[] = [
  {id: '', label: 'All types'},
  {id: 'folder', label: 'Folders'},
  {id: 'document', label: 'Documents'},
  {id: 'code', label: 'Code and data'},
  {id: 'sheet', label: 'Spreadsheets'},
  {id: 'image', label: 'Images'},
  {id: 'media', label: 'Audio and video'},
  {id: 'archive', label: 'Archives'},
];

const kindGroups: Record<string, string[]> = {
  document: ['markdown', 'text', 'docx', 'odt', 'rtf', 'pdf', 'pptx', 'odp', 'html'],
  code: ['code', 'json', 'data'],
  sheet: ['csv', 'xlsx', 'ods'],
  image: ['image'],
  media: ['audio', 'video'],
  archive: ['archive'],
};

export function matchesKind(entry: FileEntry, kind: FileSearchKind): boolean {
  if (!kind) return true;
  if (kind === 'folder') return entry.is_dir;
  return !entry.is_dir && (kindGroups[kind] || []).includes(entry.kind);
}

const byName = (a: FileEntry, b: FileEntry) => Number(!!b.is_dir) - Number(!!a.is_dir) || a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'});

export function FilesView() {
  const projects = useStore(appStore, state => state.projects);
  const request = useStore(appStore, state => state.fileRequest);
  const initial = useStore(appStore, state => state.ui?.files);
  const busy = useStore(chatStore, isBusy);
  const clipboard = useStore(fileClipboard, state => state);
  const [browser, setBrowser] = useState<FileBrowser | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'folder' | 'tree'>('folder');
  const [kind, setKind] = useState<FileSearchKind>('');
  const [results, setResults] = useState<FileSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef('');
  const [menu, setMenu] = useState<{x: number; y: number; entry?: FileEntry} | null>(null);
  const [back, setBack] = useState<string[]>([]);
  const [forward, setForward] = useState<string[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pathEdit = useRef<() => void>(() => undefined);
  // Only the latest listing, preview and search may land.
  const listSeq = useRef(0);
  const previewSeq = useRef(0);
  const searchSeq = useRef(0);

  const all = projects?.projects || [];
  const primary = all.find(p => p.id === projects?.primary_project_id) || all[0];
  const current = browser?.current || '';
  const project = all.filter(p => isInside(current, p.path)).sort((a, b) => b.path.length - a.path.length)[0];
  const writable = allowedAt(all, current, 'write');
  const treeSearch = scope === 'tree' && (!!query.trim() || !!kind);

  const load = useCallback(async (path: string, options: {keepSearch?: boolean; history?: 'push' | 'none'} = {}) => {
    const seq = ++listSeq.current;
    try {
      const next = await api.listFiles(path);
      if (seq !== listSeq.current) return null;
      if (next.error) throw new Error(next.error);
      setBrowser(previous => {
        if (options.history !== 'none' && previous?.current && !samePath(previous.current, next.current)) {
          setBack(stack => [...stack.slice(-49), previous.current]);
          setForward([]);
        }
        return next;
      });
      setError('');
      setSelected([]);
      if (!options.keepSearch) {
        setQuery('');
        setResults(null);
      }
      return next;
    } catch (err) {
      if (seq === listSeq.current) setError(String(err instanceof Error ? err.message : err));
      return null;
    }
  }, []);

  const show = useCallback(async (path: string) => {
    const seq = ++previewSeq.current;
    setLoadingPreview(true);
    try {
      const next = await api.previewFile(path);
      if (seq === previewSeq.current) setPreview(next);
    } catch (err) {
      if (seq === previewSeq.current) {
        setPreview(null);
        toastError(err);
      }
    } finally {
      if (seq === previewSeq.current) setLoadingPreview(false);
    }
  }, []);

  // Navigation asks before discarding an unsaved edit in the preview.
  const go = (path: string) => guard(() => void load(path));
  const open = (path: string) => guard(() => void show(path));
  const goBack = () => {
    const target = back[back.length - 1];
    if (!target) return;
    guard(() => {
      setBack(stack => stack.slice(0, -1));
      if (current) setForward(stack => [current, ...stack]);
      void load(target, {history: 'none'});
    });
  };
  const goForward = () => {
    const target = forward[0];
    if (!target) return;
    guard(() => {
      setForward(stack => stack.slice(1));
      if (current) setBack(stack => [...stack, current]);
      void load(target, {history: 'none'});
    });
  };
  const goUp = () => browser?.parent && project && current !== project.path && go(browser.parent);
  const goHome = () => primary && go(primary.path);

  // Always start from a fresh listing: the snapshot from startup can be stale.
  useEffect(() => {
    if (request) return;
    const start = initial?.current && all.some(p => isInside(initial.current, p.path)) ? initial.current : primary?.path;
    if (start) void load(start, {history: 'none'});
  }, [primary?.path]);

  // When a run finishes, the bot may have changed files here.
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy && current) {
      void load(current, {keepSearch: true, history: 'none'});
      if (treeSearch) void refreshSearch();
    }
    wasBusy.current = busy;
  }, [busy]);

  // Links in chat that point at local files land here.
  useEffect(() => {
    if (!request) return;
    appStore.set({fileRequest: null});
    const target = isAbsolutePath(request.path) || !primary ? request.path : joinPath(primary.path, request.path);
    void (async () => {
      const listing = await api.listFiles(target).catch(() => null);
      // ListFiles answers a file path with its folder, so it is a folder only
      // when the listing is of the target itself.
      if (listing && !listing.error && listing.current && samePath(listing.current, target)) {
        await load(target);
        setPreview(null);
        return;
      }
      await load(dirname(target));
      await show(target);
    })();
  }, [request?.nonce]);

  // Searching subfolders runs in the backend, a moment after typing stops.
  useEffect(() => {
    if (!treeSearch || !current) {
      setResults(null);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api.searchFiles(current, query.trim(), kind).then(found => {
        if (seq === searchSeq.current) setResults(found);
      }).catch(err => {
        if (seq === searchSeq.current) {
          setResults(null);
          toastError(err);
        }
      }).finally(() => {
        if (seq === searchSeq.current) setSearching(false);
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [treeSearch, query, kind, current]);

  const refresh = () => (current ? load(current, {keepSearch: true, history: 'none'}) : undefined);

  const entries = useMemo(() => {
    if (treeSearch) return results?.entries || [];
    const q = query.trim().toLowerCase();
    return [...(browser?.entries || [])].sort(byName).filter(entry => (!q || entry.name.toLowerCase().includes(q)) && matchesKind(entry, kind));
  }, [browser, query, kind, treeSearch, results]);

  const byPath = useMemo(() => new Map(entries.map(entry => [entry.path, entry])), [entries]);
  const selection = selected.map(path => byPath.get(path)).filter(Boolean) as FileEntry[];

  function select(entry: FileEntry, event: {ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean}) {
    if (event.shiftKey && anchor.current && byPath.has(anchor.current)) {
      const paths = entries.map(e => e.path);
      const [a, b] = [paths.indexOf(anchor.current), paths.indexOf(entry.path)].sort((x, y) => x - y);
      setSelected(paths.slice(a, b + 1));
      return;
    }
    anchor.current = entry.path;
    if (event.ctrlKey || event.metaKey) {
      setSelected(current => (current.includes(entry.path) ? current.filter(p => p !== entry.path) : [...current, entry.path]));
      return;
    }
    setSelected([entry.path]);
  }

  function activate(entry: FileEntry) {
    if (entry.is_dir) go(entry.path);
    else open(entry.path);
  }

  async function createIn(type: 'file' | 'folder', dir = current) {
    if (!dir) return;
    const name = await promptDialog({title: type === 'file' ? 'New file' : 'New folder', label: 'Name', confirmLabel: 'Create', placeholder: type === 'file' ? 'notes.md' : 'reports'});
    if (!name) return;
    try {
      const next = type === 'file' ? await api.createFile(dir, name) : await api.createDirectory(dir, name);
      if (samePath(dir, current)) {
        ++listSeq.current;
        setBrowser(next);
      }
      if (treeSearch) void refreshSearch();
      if (type === 'file') open(joinPath(dir, name));
      toast(`Created ${name}.`);
    } catch (err) {
      toastError(err);
    }
  }

  async function rename(entry: FileEntry) {
    const name = await promptDialog({title: `Rename ${entry.is_dir ? 'folder' : 'file'}`, label: 'New name', initial: entry.name, confirmLabel: 'Rename'});
    if (!name || name === entry.name) return;
    try {
      const next = await api.renamePath(entry.path, name);
      if (preview?.path === entry.path) setPreview(null);
      if (treeSearch) void refreshSearch();
      else {
        ++listSeq.current;
        setBrowser(next);
      }
    } catch (err) {
      toastError(err);
    }
  }

  async function remove(items: FileEntry[]) {
    if (!items.length) return;
    const one = items.length === 1 ? items[0] : null;
    const ok = await confirmDialog({
      title: one ? `Delete ${one.name}?` : `Delete ${items.length} items?`,
      body: items.some(item => item.is_dir) ? 'Folders are deleted with everything in them. This can’t be undone.' : 'This can’t be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    let done = 0;
    for (const item of items) {
      try {
        await api.deletePath(item.path);
        done++;
        if (preview?.path === item.path) setPreview(null);
      } catch (err) {
        toastError(err);
      }
    }
    if (done) toast(one && done === 1 ? `Deleted ${one.name}.` : `Deleted ${done} items.`);
    setSelected([]);
    void refresh();
    if (treeSearch) void refreshSearch();
  }

  async function refreshSearch() {
    if (!current) return;
    const seq = ++searchSeq.current;
    const found = await api.searchFiles(current, query.trim(), kind).catch(() => null);
    if (found && seq === searchSeq.current) setResults(found);
  }

  function copy(items: FileEntry[], move: boolean) {
    if (!items.length) return;
    fileClipboard.set({paths: items.map(item => item.path), move});
    toast(`${move ? 'Cut' : 'Copied'} ${items.length === 1 ? items[0].name : `${items.length} items`}. Paste into a folder.`);
  }

  async function paste(dir = current) {
    const {paths, move} = fileClipboard.get();
    if (!paths.length || !dir) return;
    try {
      const next = await api.copyPaths(paths, dir, move);
      if (samePath(dir, current)) {
        ++listSeq.current;
        setBrowser(next);
      }
      if (move) fileClipboard.set({paths: [], move: false});
      if (treeSearch) void refreshSearch();
      toast(`${move ? 'Moved' : 'Pasted'} ${paths.length === 1 ? '1 item' : `${paths.length} items`}.`);
    } catch (err) {
      toastError(err);
      void refresh();
      if (treeSearch) void refreshSearch();
    }
  }

  async function duplicate(entry: FileEntry) {
    try {
      const next = await api.copyPaths([entry.path], dirname(entry.path));
      if (samePath(dirname(entry.path), current)) {
        ++listSeq.current;
        setBrowser(next);
      }
      if (treeSearch) void refreshSearch();
      toast(`Duplicated ${entry.name}.`);
    } catch (err) {
      toastError(err);
    }
  }

  const copyText = (text: string, what: string) => void navigator.clipboard?.writeText(text).then(() => toast(`${what} copied.`));
  const relativeTo = (path: string) => (project ? segmentsBelow(path, project.path).join('/') || '.' : path);
  const canPasteInto = (dir: string) => clipboard.paths.length > 0 && allowedAt(all, dir, 'write');

  function menuItems(entry?: FileEntry): MenuItem[] {
    // Right-clicking one of several selected items acts on all of them.
    const many = entry && selected.length > 1 && selected.includes(entry.path) ? selection : null;
    if (many) {
      const files = many.filter(item => !item.is_dir);
      return [
        {kind: 'heading', label: `${many.length} items selected`},
        {label: `Attach ${files.length} file${files.length === 1 ? '' : 's'} to a message`, disabled: !files.length, onSelect: () => attachToChat(files.map(f => f.path))},
        {kind: 'separator'},
        {label: 'Copy', hint: 'Ctrl+C', onSelect: () => copy(many, false)},
        {label: 'Cut', hint: 'Ctrl+X', disabled: !many.every(item => allowedAt(all, item.path, 'delete', true)), onSelect: () => copy(many, true)},
        {label: 'Copy paths', onSelect: () => copyText(many.map(item => item.path).join('\n'), 'Paths')},
        {kind: 'separator'},
        {label: `Delete ${many.length} items…`, hint: 'Del', danger: true, disabled: !many.every(item => allowedAt(all, item.path, 'delete', true)), onSelect: () => void remove(many)},
      ];
    }
    const items: MenuItem[] = [];
    if (entry) {
      const dir = dirname(entry.path);
      items.push(
        {label: entry.is_dir ? 'Open folder' : 'Preview', hint: 'Enter', onSelect: () => activate(entry)},
        {label: 'Open in default app', onSelect: () => void api.openPath(entry.path).catch(toastError)},
      );
      if (!entry.is_dir) items.push({label: 'Open with…', onSelect: () => void api.openWith(entry.path).catch(toastError)});
      items.push({label: 'Show in file manager', onSelect: () => void api.revealPath(entry.path).catch(toastError)});
      if (!entry.is_dir) items.push({label: 'Attach to a message', onSelect: () => attachToChat([entry.path])});
      if (treeSearch) items.push({label: 'Go to its folder', onSelect: () => go(dir)});
      items.push(
        {kind: 'separator'},
        {label: 'Copy', hint: 'Ctrl+C', onSelect: () => copy([entry], false)},
        {label: 'Cut', hint: 'Ctrl+X', disabled: !allowedAt(all, entry.path, 'delete', true), onSelect: () => copy([entry], true)},
      );
      if (entry.is_dir) items.push({label: 'Paste into this folder', hint: clipboard.paths.length ? `${clipboard.paths.length} item${clipboard.paths.length === 1 ? '' : 's'}` : undefined, disabled: !canPasteInto(entry.path), onSelect: () => void paste(entry.path)});
      items.push(
        {label: 'Duplicate', disabled: !allowedAt(all, dir, 'write'), onSelect: () => void duplicate(entry)},
        {kind: 'separator'},
        {label: 'Copy path', onSelect: () => copyText(entry.path, 'Path')},
        {label: 'Copy relative path', onSelect: () => copyText(relativeTo(entry.path), 'Relative path')},
        {kind: 'separator'},
        // Renaming writes the new name; deleting needs the delete permission.
        {label: 'Rename…', hint: 'F2', disabled: !allowedAt(all, entry.path, 'write', true), onSelect: () => void rename(entry)},
        {label: 'Delete…', hint: 'Del', danger: true, disabled: !allowedAt(all, entry.path, 'delete', true), onSelect: () => void remove([entry])},
      );
      if (entry.is_dir) {
        items.push(
          {kind: 'separator'},
          {label: 'New file in this folder…', disabled: !allowedAt(all, entry.path, 'write'), onSelect: () => void createIn('file', entry.path)},
          {label: 'New folder in this folder…', disabled: !allowedAt(all, entry.path, 'write'), onSelect: () => void createIn('folder', entry.path)},
        );
      }
      return items;
    }
    return [
      {label: 'Paste', hint: 'Ctrl+V', disabled: !canPasteInto(current), onSelect: () => void paste()},
      {kind: 'separator'},
      {label: 'New file…', disabled: !writable, onSelect: () => void createIn('file')},
      {label: 'New folder…', disabled: !writable, onSelect: () => void createIn('folder')},
      {kind: 'separator'},
      {label: 'Refresh', onSelect: () => void refresh()},
      {label: 'Show this folder in file manager', onSelect: () => void api.revealPath(current).catch(toastError)},
      {label: 'Copy folder path', onSelect: () => copyText(current, 'Path')},
    ];
  }

  // Shortcuts for the whole view; typing in a field is left alone.
  function onKeyDown(event: React.KeyboardEvent) {
    const typing = (event.target as HTMLElement).closest('input, textarea, select, [contenteditable]');
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }
    if (mod && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      pathEdit.current();
      return;
    }
    if (typing) return;
    if (event.altKey && event.key === 'ArrowLeft') return goBack();
    if (event.altKey && event.key === 'ArrowRight') return goForward();
    if (event.altKey && event.key === 'ArrowUp') return void goUp();
    if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelected(entries.map(entry => entry.path));
    } else if (mod && event.key.toLowerCase() === 'c' && selection.length) {
      event.preventDefault();
      copy(selection, false);
    } else if (mod && event.key.toLowerCase() === 'x' && selection.length && selection.every(item => allowedAt(all, item.path, 'delete', true))) {
      event.preventDefault();
      copy(selection, true);
    } else if (mod && event.key.toLowerCase() === 'v' && canPasteInto(current)) {
      event.preventDefault();
      void paste();
    } else if (event.key === 'Delete' && selection.length && selection.every(item => allowedAt(all, item.path, 'delete', true))) {
      void remove(selection);
    } else if (event.key === 'Escape') {
      setSelected([]);
    }
  }

  if (!all.length) {
    return (
      <div className="view">
        <Blank title="No projects yet" action={<button className="btn btn-primary" onClick={() => openSettings('projects')}>Add a project</button>}>
          Files shows the folders you’ve given NullBot access to. Add a project folder to browse it here.
        </Blank>
      </div>
    );
  }

  const status = treeSearch ? searchStatus(results, searching, project ? relativeTo(current) : current) : '';
  return (
    <div className="view files" onKeyDown={onKeyDown}>
      <div className="view-tabs files-projects">
        <div className="tabs" role="tablist" aria-label="Projects">
          {all.map(p => (
            <button key={p.id} role="tab" aria-selected={p.id === project?.id} className={p.id === project?.id ? 'tab active' : 'tab'} title={p.path} onClick={() => guard(() => {
              setPreview(null);
              void load(p.path);
            })}>
              {p.name}
              <span className="tab-note">{permissionLabel(p.permission, p.allow)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="files-bar">
        <div className="files-nav">
          <button className="btn btn-ghost btn-icon btn-sm" title="Back (Alt+Left)" aria-label="Back" disabled={!back.length} onClick={goBack}><ArrowLeft size={14} /></button>
          <button className="btn btn-ghost btn-icon btn-sm" title="Forward (Alt+Right)" aria-label="Forward" disabled={!forward.length} onClick={goForward}><ArrowRight size={14} /></button>
          <button className="btn btn-ghost btn-icon btn-sm" title="Up one folder (Alt+Up)" aria-label="Up one folder" disabled={!browser?.parent || !project || current === project.path} onClick={() => void goUp()}><ArrowUp size={14} /></button>
          <button className="btn btn-ghost btn-icon btn-sm" title={primary ? `Primary project: ${primary.path}` : 'Primary project'} aria-label="Primary project" disabled={!primary || samePath(current, primary.path)} onClick={() => void goHome()}><House size={14} /></button>
        </div>
        <PathBar current={current} project={project} onGo={go} editRef={pathEdit} />
        <div className="files-actions">
          <button className="btn btn-ghost btn-icon btn-sm" title="Refresh" aria-label="Refresh" onClick={() => void refresh()}><RefreshCw size={13} /></button>
          {clipboard.paths.length > 0 && (
            <button className="btn btn-sm" disabled={!canPasteInto(current)} title={canPasteInto(current) ? `Paste ${clipboard.paths.length} item${clipboard.paths.length === 1 ? '' : 's'} here (Ctrl+V)` : 'This project doesn’t allow adding files'} onClick={() => void paste()}><ClipboardPaste size={13} />{clipboard.move ? 'Move here' : 'Paste'}</button>
          )}
          <button className="btn btn-sm" disabled={!writable} title={writable ? 'New file' : 'This project doesn’t allow creating files'} onClick={() => void createIn('file')}><FilePlus size={13} />File</button>
          <button className="btn btn-sm" disabled={!writable} title={writable ? 'New folder' : 'This project doesn’t allow creating folders'} onClick={() => void createIn('folder')}><FolderPlus size={13} />Folder</button>
        </div>
      </div>
      <div className="files-search">
        <div className="files-filter">
          <Search size={13} aria-hidden="true" />
          <input ref={searchRef} className="bare-input" value={query} onChange={event => setQuery(event.target.value)}
            placeholder={scope === 'tree' ? 'Search this folder and its subfolders (*.md, report q3)' : 'Filter this folder'}
            aria-label={scope === 'tree' ? 'Search this folder and its subfolders' : 'Filter this folder'}
            onKeyDown={event => {
              if (event.key === 'Escape') setQuery('');
              if (event.key === 'ArrowDown') list.current?.querySelector<HTMLElement>('.file-row')?.focus();
            }} />
          {searching && <Spinner />}
          {query && <button className="btn btn-ghost btn-icon btn-sm" aria-label="Clear search" onClick={() => setQuery('')}><X size={12} /></button>}
        </div>
        <Segmented label="Search in" value={scope} onChange={setScope} options={[{id: 'folder', label: 'This folder'}, {id: 'tree', label: 'Subfolders too'}]} />
        <select className="select select-sm" aria-label="Type" value={kind} onChange={event => setKind(event.target.value as FileSearchKind)}>
          {kindFilters.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </div>
      {error && <p className="notice bad files-error">{error}</p>}
      <div className="panes files-panes">
        <div className="pane-list file-list" ref={list} onContextMenu={event => {
          if (!(event.target as HTMLElement).closest('.file-row')) {
            event.preventDefault();
            setMenu({x: event.clientX, y: event.clientY});
          }
        }} onClick={event => {
          if (!(event.target as HTMLElement).closest('.file-row')) setSelected([]);
        }}>
          {status && <p className="files-status faint" role="status">{status}</p>}
          <table className="table file-table">
            <thead>
              <tr><th>Name</th><th className="num-col">Size</th><th>Modified</th></tr>
            </thead>
            <tbody>
              {entries.map(entry => {
                const isSelected = selected.includes(entry.path);
                const cut = clipboard.move && clipboard.paths.includes(entry.path);
                return (
                  <tr
                    key={entry.path}
                    className={['file-row', isSelected ? 'selected' : '', preview?.path === entry.path ? 'previewed' : '', cut ? 'is-cut' : ''].filter(Boolean).join(' ')}
                    tabIndex={0}
                    aria-selected={isSelected}
                    title={treeSearch ? entry.rel_path : undefined}
                    onClick={event => {
                      if (event.ctrlKey || event.metaKey || event.shiftKey) {
                        select(entry, event);
                        return;
                      }
                      select(entry, {});
                      activate(entry);
                    }}
                    onDoubleClick={() => !entry.is_dir && void api.openPath(entry.path).catch(toastError)}
                    onContextMenu={event => {
                      event.preventDefault();
                      if (!selected.includes(entry.path)) select(entry, {});
                      setMenu({x: event.clientX, y: event.clientY, entry});
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter') activate(entry);
                      else if (event.key === ' ') {
                        event.preventDefault();
                        select(entry, {ctrlKey: true});
                      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        const next = (event.key === 'ArrowDown' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling) as HTMLElement | null;
                        if (next) {
                          next.focus();
                          const nextEntry = entries[[...event.currentTarget.parentElement!.children].indexOf(next)];
                          if (nextEntry && event.shiftKey) select(nextEntry, {shiftKey: true});
                          else if (nextEntry) {
                            anchor.current = nextEntry.path;
                            setSelected([nextEntry.path]);
                          }
                        } else if (event.key === 'ArrowUp') searchRef.current?.focus();
                      } else if (event.key === 'Backspace') void goUp();
                      else if (event.key === 'F2' && allowedAt(all, entry.path, 'write', true)) void rename(entry);
                      else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                        event.preventDefault();
                        const rect = event.currentTarget.getBoundingClientRect();
                        setMenu({x: rect.left + 24, y: rect.bottom, entry});
                      }
                    }}
                  >
                    <td className="file-name">
                      <EntryIcon entry={entry} />
                      {treeSearch ? (
                        <span className="file-name-stack"><span>{entry.name}</span><span className="file-folder faint">{folderOf(entry.rel_path)}</span></span>
                      ) : <span>{entry.name}</span>}
                    </td>
                    <td className="num-col num faint">{entry.is_dir ? '' : formatBytes(entry.size)}</td>
                    <td className="faint num">{formatDateTime(entry.modified)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!entries.length && !searching && (
            <p className="pane-empty faint">
              {treeSearch ? 'Nothing below this folder matches.' : query || kind ? 'Nothing in this folder matches. Search subfolders too to look deeper.' : 'This folder is empty.'}
            </p>
          )}
          {selected.length > 1 && <p className="files-selection faint">{selected.length} selected. Right-click for actions.</p>}
        </div>
        <div className="pane-detail">
          {loadingPreview && !preview ? <Blank title="Opening"><Spinner /></Blank> : preview ? (
            <PreviewPane key={preview.path} preview={preview} writable={allowedAt(all, preview.path, 'write')} onSaved={next => {
              setPreview(next);
              void refresh();
            }} />
          ) : (
            <Blank title="Pick a file to preview it">
              Documents, code, spreadsheets, slides, PDFs, images, audio, video, fonts and archives preview here. Right-click a file for more, or double-click to open it in its app.
            </Blank>
          )}
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.entry)} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Where a search result is, below the folder searched. */
function folderOf(rel: string): string {
  const cut = Math.max(rel.lastIndexOf('/'), rel.lastIndexOf('\\'));
  return cut > 0 ? rel.slice(0, cut) : 'In this folder';
}

function searchStatus(results: FileSearchResult | null, searching: boolean, where: string): string {
  if (!results) return searching ? 'Searching…' : '';
  const n = results.entries.length;
  const parts = [`${formatCount(n)} result${n === 1 ? '' : 's'} below ${where === '.' ? 'the project folder' : where}`];
  parts.push(`${formatCount(results.scanned)} items looked at`);
  if (results.skipped?.length) parts.push(`skipped ${results.skipped.join(', ')}`);
  let text = parts.join(', ') + '.';
  if (results.truncated) text += ' The search stopped early; narrow it to see more.';
  return text;
}

/** Breadcrumbs below the project root; click to type a path (Tab completes). */
function PathBar({current, project, onGo, editRef}: {current: string; project?: Project; onGo: (path: string) => void; editRef: React.MutableRefObject<() => void>}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [suggestions, setSuggestions] = useState<{name: string; path: string; is_dir: boolean}[]>([]);
  const [index, setIndex] = useState(0);
  const editButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  editRef.current = () => setEditing(true);
  useEffect(() => setValue(current), [current]);
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);
  const segments = project ? segmentsBelow(current, project.path) : [];

  async function complete() {
    if (suggestions.length) {
      const next = (index + 1) % suggestions.length;
      setIndex(next);
      setValue(suggestions[next].path);
      return;
    }
    const found = (await api.completePath(value, current).catch(() => [])).filter(s => s.is_dir);
    if (!found.length) return;
    if (found.length === 1) {
      setValue(found[0].path);
      return;
    }
    setSuggestions(found);
    setIndex(-1);
    const shared = commonPrefix(found.map(s => s.path));
    if (shared.length > value.length) setValue(shared);
  }

  function submit() {
    if (value.trim()) onGo(value.trim());
    setEditing(false);
    setSuggestions([]);
  }

  if (editing) {
    return (
      <div className="pathbar editing">
        <input
          className="input mono"
          autoFocus
          value={value}
          aria-label="Folder path"
          onFocus={event => event.currentTarget.select()}
          onChange={event => {
            setValue(event.target.value);
            setSuggestions([]);
          }}
          onBlur={() => window.setTimeout(() => {
            setEditing(false);
            setSuggestions([]);
          }, 150)}
          onKeyDown={event => {
            // Tab completes the path; Shift+Tab still moves focus.
            if (event.key === 'Tab' && !event.shiftKey && value.trim()) {
              event.preventDefault();
              void complete();
            } else if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            } else if (event.key === 'Escape') {
              refocus.current = true;
              setEditing(false);
              setValue(current);
            }
          }}
        />
        <button className="btn btn-sm" onMouseDown={event => {
          event.preventDefault();
          submit();
        }}>Go</button>
        {suggestions.length > 0 && (
          <div className="menu path-suggestions" role="listbox">
            {suggestions.slice(0, 12).map((s, i) => (
              <button key={s.path} type="button" role="option" aria-selected={i === index} className={i === index ? 'menu-item active' : 'menu-item'} onMouseDown={event => {
                event.preventDefault();
                onGo(s.path);
                setEditing(false);
                setSuggestions([]);
              }}>
                <span className="menu-check"><Folder size={12} /></span>
                <span className="menu-label">{s.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <nav className="pathbar" aria-label="Folder">
      {project ? (
        <>
          <button className="crumb" onClick={() => onGo(project.path)} title={project.path}>{project.name}</button>
          {segments.map((segment, i) => (
            <span key={i} className="crumb-wrap">
              <span className="crumb-sep" aria-hidden="true">/</span>
              <button className="crumb" onClick={() => onGo(joinPath(project.path, segments.slice(0, i + 1).join('/')))}>{segment}</button>
            </span>
          ))}
        </>
      ) : (
        <span className="crumb mono">{current}</span>
      )}
      <button ref={editButton} className="crumb-edit" onClick={() => setEditing(true)} title="Type a path and press Enter (Ctrl+L; Tab completes)">Go to…</button>
    </nav>
  );
}

