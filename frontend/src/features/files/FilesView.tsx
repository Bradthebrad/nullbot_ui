import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ArrowUp, ExternalLink, File, FileArchive, FileCode, FileImage, FilePlus, FileSpreadsheet, FileText, Folder, FolderOpen, FolderPlus,
  MessageSquarePlus, Pencil, Search, X,
} from 'lucide-react';
import {useStore} from '../../lib/store';
import {api} from '../../lib/bindings';
import {formatBytes, formatDateTime, permissionLabel} from '../../lib/format';
import {commonPrefix, dirname, isAbsolutePath, isInside, joinPath, segmentsBelow} from '../../lib/paths';
import type {FileBrowser, FileEntry, FilePreview, Project} from '../../lib/types';
import {appStore} from '../../state/app';
import {attachToChat} from '../../state/chat';
import {Blank, Spinner} from '../../ui/layout';
import {ContextMenu, type MenuItem} from '../../ui/Menu';
import {CopyButton, Markdown} from '../../ui/Markdown';
import {Segmented} from '../../ui/Tabs';
import {confirmDialog, promptDialog} from '../../ui/dialogs';
import {toast, toastError} from '../../ui/toast';

function can(project: Project | undefined, capability: 'write' | 'delete'): boolean {
  if (!project) return false;
  if (project.permission === 'full') return true;
  if (project.permission === 'read-write') return true;
  if (project.permission === 'custom') return (project.allow || []).includes(capability);
  return false;
}

const kindIcon: Record<string, typeof File> = {
  markdown: FileText, text: FileText, docx: FileText, code: FileCode, data: FileCode,
  csv: FileSpreadsheet, xlsx: FileSpreadsheet, image: FileImage, archive: FileArchive,
};

function EntryIcon({entry}: {entry: FileEntry}) {
  const Icon = entry.is_dir ? Folder : kindIcon[entry.kind] || File;
  return <Icon size={15} strokeWidth={1.75} className={entry.is_dir ? 'icon-dir' : 'icon-file'} aria-hidden="true" />;
}

export function FilesView() {
  const projects = useStore(appStore, state => state.projects);
  const request = useStore(appStore, state => state.fileRequest);
  const initial = useStore(appStore, state => state.ui?.files);
  const [browser, setBrowser] = useState<FileBrowser | null>(initial || null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [menu, setMenu] = useState<{x: number; y: number; entry?: FileEntry} | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const all = projects?.projects || [];
  const primary = all.find(p => p.id === projects?.primary_project_id) || all[0];
  const current = browser?.current || '';
  const project = all.filter(p => isInside(current, p.path)).sort((a, b) => b.path.length - a.path.length)[0];

  const go = useCallback(async (path: string) => {
    try {
      const next = await api.listFiles(path);
      if (next.error) throw new Error(next.error);
      setBrowser(next);
      setError('');
      setFilter('');
      return next;
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      return null;
    }
  }, []);

  const open = useCallback(async (path: string) => {
    setLoadingPreview(true);
    try {
      setPreview(await api.previewFile(path));
    } catch (err) {
      setPreview(null);
      toastError(err);
    } finally {
      setLoadingPreview(false);
    }
  }, []);

  // First visit: show the primary project.
  useEffect(() => {
    if (!browser && primary) void go(primary.path);
  }, [primary?.path]);

  // Links in chat that point at local files land here.
  useEffect(() => {
    if (!request) return;
    const target = isAbsolutePath(request.path) || !primary ? request.path : joinPath(primary.path, request.path);
    void (async () => {
      const asDir = await api.listFiles(target).catch(() => null);
      if (asDir && !asDir.error && asDir.current) {
        setBrowser(asDir);
        setPreview(null);
        return;
      }
      await go(dirname(target));
      await open(target);
    })();
    appStore.set({fileRequest: null});
  }, [request?.nonce]);

  const refresh = () => (current ? go(current) : undefined);

  const entries = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const sorted = [...(browser?.entries || [])].sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'}));
    return q ? sorted.filter(entry => entry.name.toLowerCase().includes(q)) : sorted;
  }, [browser, filter]);

  async function createIn(kind: 'file' | 'folder') {
    if (!browser) return;
    const name = await promptDialog({title: kind === 'file' ? 'New file' : 'New folder', label: 'Name', confirmLabel: 'Create', placeholder: kind === 'file' ? 'notes.md' : 'reports'});
    if (!name) return;
    try {
      const next = kind === 'file' ? await api.createFile(browser.current, name) : await api.createDirectory(browser.current, name);
      setBrowser(next);
      if (kind === 'file') void open(joinPath(browser.current, name));
    } catch (err) {
      toastError(err);
    }
  }
  async function rename(entry: FileEntry) {
    const name = await promptDialog({title: `Rename ${entry.is_dir ? 'folder' : 'file'}`, label: 'New name', initial: entry.name, confirmLabel: 'Rename'});
    if (!name || name === entry.name) return;
    try {
      setBrowser(await api.renamePath(entry.path, name));
      if (preview?.path === entry.path) setPreview(null);
    } catch (err) {
      toastError(err);
    }
  }
  async function remove(entry: FileEntry) {
    const ok = await confirmDialog({
      title: `Delete ${entry.name}?`,
      body: entry.is_dir ? 'The folder and everything in it are deleted. This can’t be undone.' : 'This can’t be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      setBrowser(await api.deletePath(entry.path));
      if (preview?.path === entry.path) setPreview(null);
      toast(`Deleted ${entry.name}.`);
    } catch (err) {
      toastError(err);
    }
  }

  function menuItems(entry?: FileEntry): MenuItem[] {
    const writable = can(project, 'write');
    const deletable = can(project, 'delete');
    const items: MenuItem[] = [];
    if (entry) {
      items.push(
        {label: entry.is_dir ? 'Open folder' : 'Preview', onSelect: () => (entry.is_dir ? void go(entry.path) : void open(entry.path))},
        {label: 'Open in default app', onSelect: () => void api.openPath(entry.path).catch(toastError)},
        {label: 'Show in file manager', onSelect: () => void api.revealPath(entry.path).catch(toastError)},
      );
      if (!entry.is_dir) items.push({label: 'Attach to a message', onSelect: () => attachToChat([entry.path])});
      items.push(
        {label: 'Copy path', onSelect: () => void navigator.clipboard?.writeText(entry.path).then(() => toast('Path copied.'))},
        {kind: 'separator'},
        {label: 'Rename…', disabled: !writable, onSelect: () => void rename(entry)},
        {label: 'Delete…', danger: true, disabled: !deletable, onSelect: () => void remove(entry)},
        {kind: 'separator'},
      );
    }
    items.push(
      {label: 'New file…', disabled: !writable, onSelect: () => void createIn('file')},
      {label: 'New folder…', disabled: !writable, onSelect: () => void createIn('folder')},
    );
    return items;
  }

  if (!all.length) {
    return (
      <div className="view">
        <Blank title="No projects yet" action={<button className="btn btn-primary" onClick={() => appStore.set({view: 'settings', settingsSection: 'projects'})}>Add a project</button>}>
          Files shows the folders you’ve given NullBot access to. Add a project folder to browse it here.
        </Blank>
      </div>
    );
  }

  const writable = can(project, 'write');
  return (
    <div className="view files">
      <div className="view-tabs files-projects">
        <div className="tabs" role="tablist" aria-label="Projects">
          {all.map(p => (
            <button key={p.id} role="tab" aria-selected={p.id === project?.id} className={p.id === project?.id ? 'tab active' : 'tab'} title={p.path} onClick={() => {
              setPreview(null);
              void go(p.path);
            }}>
              {p.name}
              <span className="tab-note">{permissionLabel(p.permission, p.allow)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="files-bar">
        <button className="btn btn-ghost btn-icon btn-sm" title="Up one folder" aria-label="Up one folder" disabled={!browser?.parent || !project || current === project.path} onClick={() => browser && void go(browser.parent)}><ArrowUp size={14} /></button>
        <PathBar current={current} project={project} onGo={path => void go(path)} />
        <div className="files-filter">
          <Search size={13} aria-hidden="true" />
          <input ref={filterRef} className="bare-input" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter this folder" aria-label="Filter this folder" onKeyDown={event => {
            if (event.key === 'Escape') setFilter('');
            if (event.key === 'ArrowDown') list.current?.querySelector<HTMLElement>('.file-row')?.focus();
          }} />
          {filter && <button className="btn btn-ghost btn-icon btn-sm" aria-label="Clear filter" onClick={() => setFilter('')}><X size={12} /></button>}
        </div>
        <button className="btn btn-sm" disabled={!writable} title={writable ? 'New file' : 'This project is read only'} onClick={() => void createIn('file')}><FilePlus size={13} />File</button>
        <button className="btn btn-sm" disabled={!writable} title={writable ? 'New folder' : 'This project is read only'} onClick={() => void createIn('folder')}><FolderPlus size={13} />Folder</button>
      </div>
      {error && <p className="notice bad files-error">{error}</p>}
      <div className="panes files-panes">
        <div className="pane-list file-list" ref={list} onContextMenu={event => {
          if (event.target === event.currentTarget) {
            event.preventDefault();
            setMenu({x: event.clientX, y: event.clientY});
          }
        }}>
          <table className="table file-table">
            <thead>
              <tr><th>Name</th><th className="num-col">Size</th><th>Modified</th></tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr
                  key={entry.path}
                  className={preview?.path === entry.path ? 'file-row selected' : 'file-row'}
                  tabIndex={0}
                  onClick={() => (entry.is_dir ? void go(entry.path) : void open(entry.path))}
                  onContextMenu={event => {
                    event.preventDefault();
                    setMenu({x: event.clientX, y: event.clientY, entry});
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter') entry.is_dir ? void go(entry.path) : void open(entry.path);
                    else if (event.key === 'ArrowDown') (event.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
                    else if (event.key === 'ArrowUp') {
                      const previous = event.currentTarget.previousElementSibling as HTMLElement | null;
                      if (previous) previous.focus();
                      else filterRef.current?.focus();
                    }
                    else if (event.key === 'Backspace' && browser?.parent && project && current !== project.path) void go(browser.parent);
                    else if (event.key === 'Delete' && can(project, 'delete')) void remove(entry);
                    else if (event.key === 'F2' && writable) void rename(entry);
                    else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setMenu({x: rect.left + 24, y: rect.bottom, entry});
                    }
                  }}
                >
                  <td className="file-name"><EntryIcon entry={entry} /><span>{entry.name}</span></td>
                  <td className="num-col num faint">{entry.is_dir ? '' : formatBytes(entry.size)}</td>
                  <td className="faint num">{formatDateTime(entry.modified)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!entries.length && <p className="pane-empty faint">{filter ? 'Nothing in this folder matches the filter.' : 'This folder is empty.'}</p>}
        </div>
        <div className="pane-detail">
          {loadingPreview && !preview ? <Blank title="Opening"><Spinner /></Blank> : preview ? (
            <PreviewPane key={preview.path} preview={preview} writable={writable} onSaved={next => {
              setPreview(next);
              void refresh();
            }} />
          ) : (
            <Blank title="Pick a file to preview it">Markdown, code, images, PDFs, spreadsheets and Word documents preview here. Right-click for more actions.</Blank>
          )}
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.entry)} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Breadcrumbs below the project root; click to edit as a path with Tab completion. */
function PathBar({current, project, onGo}: {current: string; project?: Project; onGo: (path: string) => void}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [suggestions, setSuggestions] = useState<{name: string; path: string; is_dir: boolean}[]>([]);
  const [index, setIndex] = useState(0);
  useEffect(() => setValue(current), [current]);
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

  if (editing) {
    return (
      <div className="pathbar editing">
        <input
          className="input mono"
          autoFocus
          value={value}
          aria-label="Folder path"
          onChange={event => {
            setValue(event.target.value);
            setSuggestions([]);
          }}
          onBlur={() => window.setTimeout(() => {
            setEditing(false);
            setSuggestions([]);
          }, 120)}
          onKeyDown={event => {
            if (event.key === 'Tab') {
              event.preventDefault();
              void complete();
            } else if (event.key === 'Enter') {
              event.preventDefault();
              onGo(value);
              setEditing(false);
              setSuggestions([]);
            } else if (event.key === 'Escape') {
              setEditing(false);
              setValue(current);
            }
          }}
        />
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
      <button className="crumb-edit" onClick={() => setEditing(true)} title="Type a path (Tab completes)">Type a path</button>
    </nav>
  );
}

function PreviewPane({preview, writable, onSaved}: {preview: FilePreview; writable: boolean; onSaved: (preview: FilePreview) => void}) {
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(preview.content || '');
  const [saving, setSaving] = useState(false);
  const dirty = editing && draft !== (preview.content || '');

  async function save() {
    setSaving(true);
    try {
      onSaved(await api.saveFile(preview.path, draft));
      setEditing(false);
      toast(`Saved ${preview.name}.`, 'success');
    } catch (error) {
      toastError(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="detail file-preview">
      <header className="detail-header">
        <div className="detail-heading">
          <h2 title={preview.path}>{preview.name}</h2>
          <div className="detail-sub">
            <span className="muted">{kindLabel(preview.kind)}, {formatBytes(preview.size)}{preview.truncated ? ', showing the start' : ''}</span>
          </div>
        </div>
        <div className="detail-actions">
          {preview.kind === 'markdown' && !editing && (
            <Segmented label="Markdown view" value={mode} onChange={setMode} options={[{id: 'rendered', label: 'Rendered'}, {id: 'source', label: 'Source'}]} />
          )}
          {preview.editable && !editing && (
            <button className="btn" disabled={!writable || preview.truncated} title={!writable ? 'This project is read only' : preview.truncated ? 'Too large to edit here' : 'Edit'} onClick={() => {
              setDraft(preview.content || '');
              setEditing(true);
            }}><Pencil size={13} />Edit</button>
          )}
          {editing && (
            <>
              <button className="btn" onClick={async () => {
                if (!dirty || (await confirmDialog({title: 'Discard your changes?', confirmLabel: 'Discard', danger: true}))) setEditing(false);
              }}>Cancel</button>
              <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}>Save</button>
            </>
          )}
          {!editing && (
            <>
              <button className="btn btn-ghost btn-icon" title="Attach to a message" aria-label="Attach to a message" onClick={() => attachToChat([preview.path])}><MessageSquarePlus size={15} /></button>
              <button className="btn btn-ghost btn-icon" title="Show in file manager" aria-label="Show in file manager" onClick={() => void api.revealPath(preview.path).catch(toastError)}><FolderOpen size={15} /></button>
              <button className="btn btn-ghost btn-icon" title="Open in default app" aria-label="Open in default app" onClick={() => void api.openPath(preview.path).catch(toastError)}><ExternalLink size={15} /></button>
            </>
          )}
        </div>
      </header>
      <div className={`preview-body preview-${preview.kind}`}>
        {editing ? (
          <textarea className="code-editor" spellCheck={false} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              if (dirty) void save();
            }
          }} autoFocus aria-label={`Edit ${preview.name}`} />
        ) : <PreviewContent preview={preview} mode={mode} />}
      </div>
    </div>
  );
}

function kindLabel(kind: string) {
  switch (kind) {
    case 'markdown': return 'Markdown';
    case 'code': return 'Code';
    case 'data': return 'Data';
    case 'csv': return 'Table';
    case 'xlsx': return 'Spreadsheet';
    case 'docx': return 'Word document';
    case 'pdf': return 'PDF';
    case 'image': return 'Image';
    case 'archive': return 'Archive';
    default: return 'Text';
  }
}

function PreviewContent({preview, mode}: {preview: FilePreview; mode: 'rendered' | 'source'}) {
  if (preview.error) return <Blank title="No preview">{preview.error}</Blank>;
  const url = preview.url || preview.data_url;
  if (preview.kind === 'image' && url) return <div className="image-stage"><img src={url} alt={preview.name} /></div>;
  if (preview.kind === 'pdf' && url) return <iframe className="pdf-frame" src={url} title={preview.name} />;
  if ((preview.kind === 'csv' || preview.kind === 'xlsx') && preview.headers) {
    return (
      <div className="table-scroll">
        <table className="table data-table">
          <thead><tr>{preview.headers.map((header, i) => <th key={i}>{header || `Column ${i + 1}`}</th>)}</tr></thead>
          <tbody>{(preview.rows || []).map((row, r) => <tr key={r}>{preview.headers!.map((_, c) => <td key={c}>{row[c] || ''}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  if (preview.kind === 'markdown' && mode === 'rendered') return <div className="doc"><Markdown className="prose">{preview.content || ''}</Markdown></div>;
  if (preview.kind === 'docx') return <div className="doc"><p className="pre-wrap prose">{preview.content}</p></div>;
  const text = preview.content || '';
  return (
    <div className="source">
      <div className="source-bar"><CopyButton text={text} /></div>
      <pre className="source-text">{text || 'This file is empty.'}</pre>
    </div>
  );
}

