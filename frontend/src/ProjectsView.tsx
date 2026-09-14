import {useEffect, useState} from 'react';
import './projects-models.css';

export type Project = {id: string; name: string; path: string; permission: 'read-only' | 'read-write' | 'full'};
export type ProjectsState = {projects: Project[]; primary_project_id: string; workspace_dir: string; warning: string};
type Props = {
  load: () => Promise<ProjectsState>;
  save: (projects: Project[], primary: string) => Promise<ProjectsState>;
  onSaved?: (state: ProjectsState) => void;
};
const fullWarning = 'Full permits unsandboxed commands and MCP servers, including access outside project paths. All projects must be Full to enable external tools. Already-running processes are not revoked.';
const snapshot = (projects: Project[], primary: string) => JSON.stringify({projects, primary});

export default function ProjectsView({load, save, onSaved}: Props) {
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
    setProjects((state.projects || []).map(p => ({...p})));
    setPrimary(state.primary_project_id || '');
    setLoaded({...state, projects: (state.projects || []).map(p => ({...p}))});
  }
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    load().then(state => {if (active) apply(state);})
      .catch(e => {if (active) setError(String(e));})
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [load, retry]);

  function update(id: string, patch: Partial<Project>) {
    setProjects(rows => rows.map(p => p.id === id ? {...p, ...patch} : p));
    setMessage('');
  }
  function addProject() {
    const path = newPath.trim();
    if (!path) return;
    const id = crypto.randomUUID();
    const name = path.split(/[\\/]+/).filter(Boolean).pop() || 'Project';
    setProjects(rows => [...rows, {id, name, path, permission: newPermission}]);
    if (!primary) setPrimary(id);
    setNewPath(''); setNewPermission('read-only'); setMessage('');
  }
  async function persist() {
    if (!valid || !dirty || saving || !loaded) return;
    // Compare against the last successful load/save, not other staged edits.
    // Moving a Full project to a new path grants new access and also needs confirmation.
    const escalated = projects.filter(p => p.permission === 'full' && !loaded.projects.some(old => old.id === p.id && old.permission === 'full' && old.path.trim() === p.path.trim()));
    if (escalated.length && !window.confirm(`Grant Full access to ${escalated.map(p => p.name || p.path).join(', ')}?\n\n${warning}\n\nSave these permissions?`)) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await save(projects, primary);
      apply(result);
      setMessage('Projects saved. Primary workspace synchronized.');
      onSaved?.(result);
    } catch (e) {setError(String(e));} finally {setSaving(false);}
  }

  return <section className="projects-view pm-projects" aria-label="Projects" aria-busy={loading || saving}>
    <header className="pm-heading"><div><h2>Projects</h2><p>Allowed folders and tool permissions. Choose a primary project for relative paths.</p></div>
      {dirty && <span className="pm-badge">Unsaved changes</span>}
    </header>
    <div className="pm-permission-guide"><span><strong>Read only</strong> Inspect files</span><span><strong>Read &amp; write</strong> Inspect and edit with checked tools</span><span><strong>Full</strong> Unsandboxed external tools</span></div>
    <details className="pm-caveat"><summary>Full access and permission safety</summary><p>{warning}</p><p>These checks are not an operating-system sandbox. Overlapping paths use the most restrictive permission. Restricted mode does not start external MCP servers; use project_read_file, project_write_file and list_dir.</p></details>
    {loading && <p role="status">Loading projects…</p>}
    {error && <div className="pm-notice" role="alert">{error}{!loaded && !loading && <button type="button" onClick={() => setRetry(n => n + 1)}>Retry loading</button>}</div>}
    {message && <p className="pm-notice" role="status">{message}</p>}
    <fieldset className="pm-project-fields" disabled={loading || saving || !loaded}>
      <legend className="pm-sr-only">Edit project access</legend>
      <form className="pm-add-project" onSubmit={e => {e.preventDefault(); addProject();}}>
        <label className="pm-field pm-path"><span>New project folder</span><input value={newPath} onChange={e => setNewPath(e.target.value)} placeholder="Absolute directory path" aria-label="New project absolute directory path" /></label>
        <label className="pm-field"><span>Permission</span><select value={newPermission} onChange={e => setNewPermission(e.target.value as Project['permission'])}><PermissionOptions /></select></label>
        <button type="submit" disabled={!newPath.trim()}>Add project</button>
      </form>
      <div className="pm-project-list">
        {!projects.length && !loading && <p className="pm-muted">No projects yet. Add a folder above, then save.</p>}
        {projects.map((p, index) => <article className={`pm-project-card ${primary === p.id ? 'is-primary' : ''}`} key={p.id} aria-label={`Project ${index + 1}: ${p.name}`}>
          <header className="pm-card-heading"><strong>{p.name || `Project ${index + 1}`}</strong>
            {primary === p.id ? <span className="pm-badge">{loaded?.primary_project_id === p.id ? 'Primary workspace' : 'Primary on save'}</span> : <button type="button" onClick={() => {setPrimary(p.id); setMessage('');}} aria-label={`Make ${p.name || p.path} primary`}>Set as primary</button>}
          </header>
          <div className="pm-project-edit">
            <label className="pm-field"><span>Name</span><input value={p.name} onChange={e => update(p.id, {name: e.target.value})} /></label>
            <label className="pm-field pm-path"><span>Absolute folder path</span><input value={p.path} onChange={e => update(p.id, {path: e.target.value})} /></label>
            <label className="pm-field"><span>Permission</span><select value={p.permission} onChange={e => update(p.id, {permission: e.target.value as Project['permission']})}><PermissionOptions /></select></label>
            <button type="button" disabled={projects.length === 1} aria-label={`Remove ${p.name || p.path}`} onClick={() => {
              const remaining = projects.filter(row => row.id !== p.id);
              setProjects(remaining); if (primary === p.id) setPrimary(remaining[0]?.id || ''); setMessage('');
            }}>Remove</button>
          </div>
        </article>)}
      </div>
      <footer className="pm-save-bar"><div><strong>{dirty ? 'Changes are not saved yet' : 'Project permissions are up to date'}</strong><p>Adding, editing, removing and choosing primary take effect only when you save.</p>{loaded?.workspace_dir && <small>Saved workspace: {loaded.workspace_dir}</small>}{newPath.trim() && <p>Add the folder above to include it in your changes.</p>}</div>
        <button type="button" className="primary" disabled={!valid || !dirty || saving} onClick={persist}>{saving ? 'Saving…' : 'Save projects'}</button>
      </footer>
    </fieldset>
  </section>;
}

function PermissionOptions() {
  return <><option value="read-only">Read only</option><option value="read-write">Read &amp; write</option><option value="full">Full</option></>;
}
