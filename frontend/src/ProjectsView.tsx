// Project folders and what NullBot may do in each. Kept free of runtime
// imports so tests can execute it with a minimal hook harness.
import {useEffect, useState} from 'react';
import './projects-models.css';

export type Capability = 'read' | 'write' | 'delete' | 'execute';
export type Project = {id: string; name: string; path: string; permission: 'read-only' | 'read-write' | 'full' | 'custom'; allow?: Capability[]};
export type ProjectsState = {projects: Project[]; primary_project_id: string; workspace_dir: string; warning: string};
type Props = {
  load: () => Promise<ProjectsState>;
  save: (projects: Project[], primary: string) => Promise<ProjectsState>;
  onSaved?: (state: ProjectsState) => void;
  /** Asks before granting new access. Defaults to window.confirm. */
  confirm?: (title: string, body: string) => boolean | Promise<boolean>;
  /** Told when there are (or are no longer) unsaved changes. */
  onDirtyChange?: (dirty: boolean) => void;
};

const fullWarning = 'Run programs lets tools run commands and start local tool servers in the folder. Tool servers are separate programs: NullBot checks every tool call against your project permissions, but it cannot sandbox what a server’s own code does.';
const snapshot = (projects: Project[], primary: string) => JSON.stringify({projects: projects.map(p => ({...p, allow: p.permission === 'custom' ? [...(p.allow || [])].sort() : undefined})), primary});
const extras: {id: Capability; label: string}[] = [
  {id: 'write', label: 'Edit files'},
  {id: 'delete', label: 'Delete files'},
  {id: 'execute', label: 'Run programs'},
];
const levels: {id: Project['permission']; label: string; caps: Capability[]}[] = [
  {id: 'read-only', label: 'Read only', caps: ['read']},
  {id: 'read-write', label: 'Read & write', caps: ['read', 'write', 'delete']},
  {id: 'full', label: 'Full', caps: ['read', 'write', 'delete', 'execute']},
  {id: 'custom', label: 'Custom', caps: ['read']},
];

function runs(project: Project) {
  return project.permission === 'full' || (project.permission === 'custom' && (project.allow || []).includes('execute'));
}

function folderName(path: string) {
  return path.split(/[\\/]+/).filter(Boolean).pop() || 'Project';
}

export default function ProjectsView({load, save, onSaved, confirm, onDirtyChange}: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [primary, setPrimary] = useState('');
  const [loaded, setLoaded] = useState<ProjectsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [newPath, setNewPath] = useState('');
  const [newPermission, setNewPermission] = useState<Project['permission']>('read-only');
  const [retry, setRetry] = useState(0);
  const warning = loaded?.warning || fullWarning;
  const dirty = !!loaded && snapshot(projects, primary) !== snapshot(loaded.projects || [], loaded.primary_project_id || '');
  const valid = projects.length > 0 && projects.some(p => p.id === primary) && projects.every(p => p.path.trim());

  function apply(state: ProjectsState) {
    setProjects((state.projects || []).map(p => ({...p, allow: p.allow ? [...p.allow] : undefined})));
    setPrimary(state.primary_project_id || '');
    setLoaded({...state, projects: (state.projects || []).map(p => ({...p}))});
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    load().then(state => {if (active) apply(state);})
      .catch(e => {if (active) setError(String(e));})
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [load, retry]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty]);

  function update(id: string, patch: Partial<Project>) {
    setProjects(rows => rows.map(p => {
      if (p.id !== id) return p;
      const next = {...p, ...patch};
      if (next.permission !== 'custom') delete next.allow;
      else next.allow = next.allow || [];
      return next;
    }));
    setMessage('');
  }
  function toggleAllow(project: Project, capability: Capability, on: boolean) {
    const current = new Set(project.allow || []);
    if (on) current.add(capability);
    else current.delete(capability);
    update(project.id, {allow: extras.map(e => e.id).filter(c => current.has(c))});
  }
  function addProject() {
    const path = newPath.trim();
    if (!path) return;
    const id = crypto.randomUUID();
    setProjects(rows => [...rows, {id, name: folderName(path), path, permission: newPermission, ...(newPermission === 'custom' ? {allow: []} : {})}]);
    if (!primary) setPrimary(id);
    setNewPath('');
    setNewPermission('read-only');
    setMessage('');
  }
  async function persist() {
    if (!valid || !dirty || saving || !loaded) return;
    // New permission to run programs (or the same permission on a new path)
    // is the one change that needs a second look.
    const escalated = projects.filter(p => runs(p) && !loaded.projects.some(old => old.id === p.id && runs(old) && old.path.trim() === p.path.trim()));
    if (escalated.length) {
      const title = `Let NullBot run programs in ${escalated.map(p => p.name || p.path).join(', ')}?`;
      const ok = confirm ? await confirm(title, warning) : window.confirm(`${title}\n\n${warning}`);
      if (!ok) return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await save(projects, primary);
      apply(result);
      setMessage('Saved. Running tool servers restart with the new projects.');
      onSaved?.(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return <section className="projects" aria-label="Projects" aria-busy={loading || saving}>
    <header className="settings-head">
      <h2>Projects</h2>
      <p className="muted">The folders NullBot may work in, and what it may do in each. It starts in the primary project: relative paths and local tool servers begin there.</p>
    </header>

    <table className="table perm-matrix" aria-label="What each permission allows">
      <thead><tr><th />{levels.map(level => <th key={level.id}>{level.label}</th>)}</tr></thead>
      <tbody>
        {[{id: 'read' as Capability, label: 'Read files'}, ...extras].map(cap => (
          <tr key={cap.id}>
            <th scope="row">{cap.label}</th>
            {levels.map(level => <td key={level.id} className={level.caps.includes(cap.id) ? 'yes' : level.id === 'custom' && cap.id !== 'read' ? 'maybe' : 'no'}>
              {level.caps.includes(cap.id) ? 'Yes' : level.id === 'custom' && cap.id !== 'read' ? 'If chosen' : 'No'}
            </td>)}
          </tr>
        ))}
      </tbody>
    </table>
    <p className="faint perm-note">This applies to every tool, including tool servers on other machines. Where projects overlap, the stricter one wins. A call that names no folder is judged by the primary project.</p>

    {loading && <p role="status" className="muted">Loading projects…</p>}
    {error && <div className="notice bad" role="alert"><div>{error}{!loaded && !loading && <> <button type="button" className="btn btn-sm" onClick={() => setRetry(n => n + 1)}>Try again</button></>}</div></div>}

    <fieldset className="project-fields" disabled={loading || saving || !loaded}>
      <legend className="sr-only">Edit project access</legend>
      <div className="project-list">
        {!projects.length && !loading && <p className="muted">No projects yet. Add a folder below, then save.</p>}
        {projects.map((p, index) => {
          const isPrimary = primary === p.id;
          return <article className={`project ${isPrimary ? 'is-primary' : ''}`} key={p.id} aria-label={`Project ${index + 1}: ${p.name}`}>
            <div className="project-top">
              <input className="input project-name" value={p.name} aria-label="Project name" onChange={e => update(p.id, {name: e.target.value})} />
              {isPrimary
                ? <span className="tag warn">{loaded?.primary_project_id === p.id ? 'Primary' : 'Primary after saving'}</span>
                : <button type="button" className="btn btn-sm" onClick={() => {setPrimary(p.id); setMessage('');}} aria-label={`Make ${p.name || p.path} primary`}>Set as primary</button>}
              <span className="project-spacer" />
              <button type="button" className="btn btn-ghost btn-sm btn-danger" disabled={projects.length === 1} aria-label={`Remove ${p.name || p.path}`} onClick={() => {
                const remaining = projects.filter(row => row.id !== p.id);
                setProjects(remaining);
                if (primary === p.id) setPrimary(remaining[0]?.id || '');
                setMessage('');
              }}>Remove</button>
            </div>
            <label className="field">
              <span>Folder</span>
              <input className="input mono" value={p.path} onChange={e => update(p.id, {path: e.target.value})} />
            </label>
            <div className="project-access">
              <label className="field">
                <span>Permission</span>
                <select className="select" value={p.permission} onChange={e => update(p.id, {permission: e.target.value as Project['permission']})}><PermissionOptions /></select>
              </label>
              {p.permission === 'custom' && (
                <div className="allow-list" role="group" aria-label={`Also allow in ${p.name}`}>
                  <span className="allow-title">Reading, plus</span>
                  {extras.map(cap => (
                    <label key={cap.id} className="check">
                      <input type="checkbox" checked={(p.allow || []).includes(cap.id)} onChange={e => toggleAllow(p, cap.id, e.target.checked)} />
                      {cap.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            {runs(p) && <p className="project-warn faint">{warning}</p>}
          </article>;
        })}
      </div>

      <form className="project-add" onSubmit={e => {e.preventDefault(); addProject();}}>
        <label className="field grow">
          <span>Add a folder</span>
          <input className="input mono" value={newPath} onChange={e => setNewPath(e.target.value)} placeholder="C:\work\reports" aria-label="New project folder path" />
        </label>
        <label className="field">
          <span>Permission</span>
          <select className="select" value={newPermission} onChange={e => setNewPermission(e.target.value as Project['permission'])}><PermissionOptions /></select>
        </label>
        <button type="submit" className="btn" disabled={!newPath.trim()}>Add</button>
      </form>

      <footer className={`save-bar ${dirty ? 'is-dirty' : ''}`}>
        <div className="save-bar-text">
          {message ? <span role="status">{message}</span> : dirty ? <strong>You have unsaved changes.</strong> : <span className="muted">Projects are up to date.</span>}
          {newPath.trim() && <span className="faint">Press Add to include the folder you typed.</span>}
        </div>
        {dirty && loaded && <button type="button" className="btn" onClick={() => apply(loaded)}>Discard</button>}
        <button type="button" className="btn btn-primary" disabled={!valid || !dirty || saving} onClick={persist}>{saving ? 'Saving…' : 'Save projects'}</button>
      </footer>
    </fieldset>
  </section>;
}

function PermissionOptions() {
  return <><option value="read-only">Read only</option><option value="read-write">Read &amp; write</option><option value="full">Full</option><option value="custom">Custom</option></>;
}
