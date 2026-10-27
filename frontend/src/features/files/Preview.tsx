// The preview pane: shows a file the way it is meant to be read, and edits
// text files in place.
import {useEffect, useMemo, useState} from 'react';
import {ExternalLink, FolderOpen, MessageSquarePlus, Pencil} from 'lucide-react';
import {api} from '../../lib/bindings';
import {formatBytes, formatDateTime} from '../../lib/format';
import {useUnsavedEdits} from '../../lib/dirty';
import type {FilePreview} from '../../lib/types';
import {attachToChat} from '../../state/chat';
import {Blank} from '../../ui/layout';
import {CopyButton, Markdown} from '../../ui/Markdown';
import {Segmented} from '../../ui/Tabs';
import {confirmDialog} from '../../ui/dialogs';
import {toast, toastError} from '../../ui/toast';
import {EntryIcon, kindLabel} from './fileIcons';

type Mode = 'rendered' | 'source';

/** Kinds with two ways to look at them, and what the first is called. */
function viewModes(preview: FilePreview): {rendered: string} | null {
  if (preview.kind === 'markdown') return {rendered: 'Rendered'};
  if (preview.kind === 'html' && preview.url) return {rendered: 'Page'};
  if (preview.kind === 'json' && preview.formatted) return {rendered: 'Formatted'};
  if (preview.kind === 'image' && preview.content) return {rendered: 'Image'};
  return null;
}

export function PreviewPane({preview, writable, onSaved}: {preview: FilePreview; writable: boolean; onSaved: (preview: FilePreview) => void}) {
  const [mode, setMode] = useState<Mode>('rendered');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(preview.content || '');
  const [saving, setSaving] = useState(false);
  const dirty = editing && draft !== (preview.content || '');
  useUnsavedEdits(`file:${preview.path}`, dirty);
  const modes = viewModes(preview);

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

  const facts = [kindLabel(preview.kind), formatBytes(preview.size), preview.modified ? `changed ${formatDateTime(preview.modified)}` : '', preview.truncated ? 'showing the start' : ''].filter(Boolean).join(', ');
  return (
    <div className="detail file-preview">
      <header className="detail-header">
        <div className="detail-heading">
          <h2 title={preview.path}><EntryIcon entry={{is_dir: false, kind: preview.kind, extension: '', name: preview.name}} size={16} />{preview.name}</h2>
          <div className="detail-sub"><span className="muted">{facts}</span></div>
        </div>
        <div className="detail-actions">
          {modes && !editing && (
            <Segmented label="View" value={mode} onChange={setMode} options={[{id: 'rendered', label: modes.rendered}, {id: 'source', label: preview.kind === 'json' ? 'As saved' : 'Source'}]} />
          )}
          {(preview.editable || preview.read_only_reason) && !editing && (
            <button className="btn" disabled={!writable || !preview.editable} title={preview.read_only_reason || (!writable ? 'This project doesn’t allow editing files' : 'Edit')} onClick={() => {
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
        ) : <PreviewContent preview={preview} mode={modes ? mode : 'source'} />}
      </div>
    </div>
  );
}

export function PreviewContent({preview, mode}: {preview: FilePreview; mode: Mode}) {
  if (preview.error) return <Blank title="No preview">{preview.error}</Blank>;
  const url = preview.url || preview.data_url;
  switch (preview.kind) {
    case 'image':
      if (mode === 'source' && preview.content) return <SourceView text={preview.content} />;
      return url ? <div className="image-stage"><img src={url} alt={preview.name} /></div> : <Blank title="No preview">This image can’t be shown here.</Blank>;
    case 'pdf':
      return url ? <iframe className="pdf-frame" src={url} title={preview.name} /> : null;
    case 'audio':
      return url ? <div className="media-stage"><audio controls preload="metadata" src={url} aria-label={preview.name} /></div> : null;
    case 'video':
      return url ? <div className="media-stage"><video controls preload="metadata" src={url} aria-label={preview.name} /></div> : null;
    case 'font':
      return url ? <FontSample url={url} name={preview.name} /> : null;
    case 'html':
      if (mode === 'rendered' && preview.url) return <iframe className="html-frame" sandbox="" src={preview.url} title={preview.name} />;
      return <SourceView text={preview.content || ''} />;
    case 'markdown':
      if (mode === 'rendered') return <div className="doc"><Markdown className="prose">{preview.content || ''}</Markdown></div>;
      return <SourceView text={preview.content || ''} />;
    case 'json':
      return <SourceView text={mode === 'rendered' && preview.formatted ? preview.formatted : preview.content || ''} />;
    case 'csv': case 'xlsx': case 'ods':
      if (preview.headers) return <DataTable headers={preview.headers} rows={preview.rows || []} />;
      return <SourceView text={preview.content || ''} />;
    case 'docx': case 'odt': case 'rtf': case 'pptx': case 'odp':
      return <div className="doc"><p className="pre-wrap prose">{preview.content || 'No text found in this document.'}</p></div>;
    case 'archive':
      return <ArchiveList preview={preview} />;
    case 'binary':
      return (
        <div className="source">
          <p className="preview-note faint">This is a binary file. The first {Math.min(preview.size, 1024).toLocaleString()} bytes are shown; use Open to work with it.</p>
          <pre className="source-text hex">{preview.hex || ''}</pre>
        </div>
      );
    default:
      return <SourceView text={preview.content || ''} />;
  }
}

function SourceView({text}: {text: string}) {
  // A gutter of line numbers, for files short enough to number cheaply.
  const numbers = useMemo(() => {
    const lines = text ? text.split('\n').length : 0;
    return lines > 1 && lines <= 20000 ? Array.from({length: lines}, (_, i) => i + 1).join('\n') : '';
  }, [text]);
  return (
    <div className="source">
      <div className="source-bar"><CopyButton text={text} /></div>
      <div className="source-scroll">
        {numbers && <pre className="source-gutter" aria-hidden="true">{numbers}</pre>}
        <pre className="source-text">{text || 'This file is empty.'}</pre>
      </div>
    </div>
  );
}

function DataTable({headers, rows}: {headers: string[]; rows: string[][]}) {
  return (
    <div className="table-scroll">
      <table className="table data-table">
        <thead><tr><th className="row-num" aria-label="Row" />{headers.map((header, i) => <th key={i}>{header || `Column ${i + 1}`}</th>)}</tr></thead>
        <tbody>{rows.map((row, r) => <tr key={r}><td className="row-num faint num">{r + 2}</td>{headers.map((_, c) => <td key={c}>{row[c] || ''}</td>)}</tr>)}</tbody>
      </table>
      {rows.length >= 199 && <p className="preview-note faint">Showing the first 200 rows.</p>}
    </div>
  );
}

function ArchiveList({preview}: {preview: FilePreview}) {
  const entries = preview.entries || [];
  const total = entries.reduce((sum, e) => sum + (e.size || 0), 0);
  return (
    <div className="table-scroll">
      <p className="preview-note faint">{(preview.count || entries.length).toLocaleString()} item{(preview.count || entries.length) === 1 ? '' : 's'}{total ? `, ${formatBytes(total)} unpacked` : ''}{preview.truncated ? `; the first ${entries.length.toLocaleString()} are listed` : ''}.</p>
      <table className="table file-table">
        <thead><tr><th>Name</th><th className="num-col">Size</th></tr></thead>
        <tbody>
          {entries.map(entry => {
            const name = entry.name.replace(/\/$/, '');
            const base = name.slice(name.lastIndexOf('/') + 1);
            return (
              <tr key={entry.name}>
                <td className="file-name"><EntryIcon entry={{is_dir: !!entry.is_dir, kind: '', extension: base.includes('.') ? base.slice(base.lastIndexOf('.')) : '', name: base}} /><span className="mono">{name}</span></td>
                <td className="num-col num faint">{entry.is_dir ? '' : formatBytes(entry.size)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FontSample({url, name}: {url: string; name: string}) {
  const family = useMemo(() => `preview-${Math.random().toString(36).slice(2)}`, [url]);
  const [ready, setReady] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => {
    const face = new FontFace(family, `url(${url})`);
    face.load().then(loaded => {
      document.fonts.add(loaded);
      setReady('ok');
    }).catch(() => setReady('error'));
    return () => {
      try {
        document.fonts.delete(face);
      } catch {
        // already gone
      }
    };
  }, [url]);
  if (ready === 'error') return <Blank title="No preview">This font couldn’t be loaded.</Blank>;
  return (
    <div className="font-sample" style={{fontFamily: ready === 'ok' ? family : undefined}} aria-label={`Sample of ${name}`}>
      <p className="font-sample-xl">Aa Bb Cc 0123</p>
      <p className="font-sample-lg">The quick brown fox jumps over the lazy dog.</p>
      <p>ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 &amp;@#%?!</p>
    </div>
  );
}
