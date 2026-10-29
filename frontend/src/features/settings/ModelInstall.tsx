// Install a local model: search Hugging Face for a GGUF build, pick one,
// and put it into Ollama, LM Studio's folder or NullBot's own.
import {useEffect, useState, type ReactNode} from 'react';
import {api} from '../../lib/bindings';
import {onModelInstall} from '../../lib/events';
import {formatBytes} from '../../lib/format';
import type {HFBuild, HFModel, InstallTarget, LocalEndpointInfo, ModelInstallEvent} from '../../lib/types';
import {appStore, refreshState} from '../../state/app';
import {toast, toastError} from '../../ui/toast';
import {Group} from './form';

const sorts = [
  {id: 'downloads', label: 'Most downloaded'},
  {id: 'trending', label: 'Trending'},
  {id: 'likes', label: 'Most liked'},
  {id: 'lastModified', label: 'Recently updated'},
];

/** Where an install can go, with the Ollama servers set up. */
function useTargets() {
  const [servers, setServers] = useState<LocalEndpointInfo[]>([]);
  useEffect(() => {
    api.localEndpoints(false).then(list => setServers((Array.isArray(list) ? list : []).filter(s => s.kind === 'ollama' && !s.disabled))).catch(() => undefined);
  }, []);
  const targets: {value: string; label: string; target: InstallTarget; server?: string}[] = [
    ...servers.map(s => ({value: `ollama:${s.id}`, label: `Pull into ${s.title}`, target: 'ollama' as const, server: s.id})),
    {value: 'lmstudio', label: 'Save into LM Studio’s folder', target: 'lmstudio'},
    {value: 'files', label: 'Save into NullBot’s models folder', target: 'files'},
  ];
  return targets;
}

export function ModelInstall({children}: {children?: ReactNode}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('downloads');
  const [results, setResults] = useState<HFModel[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [repo, setRepo] = useState<HFModel | null>(null);
  const [installs, setInstalls] = useState<Record<string, ModelInstallEvent>>({});

  useEffect(() => onModelInstall(event => {
    setInstalls(prev => ({...prev, [event.id]: event}));
    if (!event.ended) return;
    if (event.error) toastError(new Error(`Installing from ${event.repo}: ${event.error}`));
    else if (event.result) {
      toast(event.result.target === 'ollama' ? `Installed ${event.result.model}.` : `Saved ${event.result.paths?.length === 1 ? 'the model' : `${event.result.paths?.length} files`} from ${event.repo}.`, 'success');
      void refreshState().catch(() => undefined);
      void api.modelCatalog(true).then(models => appStore.set({models})).catch(() => undefined);
    }
  }), []);

  async function search(event?: {preventDefault: () => void}) {
    event?.preventDefault();
    setSearching(true);
    try {
      const list = await api.searchHFModels(query.trim(), sort, 20);
      setResults(Array.isArray(list) ? list : []);
      setRepo(null);
    } catch (e) {
      toastError(e);
    } finally {
      setSearching(false);
    }
  }

  const running = Object.values(installs).filter(i => !i.ended);
  const finished = Object.values(installs).filter(i => i.ended && i.result);

  return (
    <Group title="Install a model" note="Find a GGUF build on Hugging Face and install it into Ollama, LM Studio, or NullBot’s models folder for llama.cpp. Downloads resume and are checked against the published checksum.">
      {children}
      <form className="install-search" role="search" onSubmit={event => void search(event)}>
        <input className="input" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search Hugging Face, such as qwen2.5 7b instruct" aria-label="Search Hugging Face" />
        <select className="select" value={sort} onChange={e => setSort(e.target.value)} aria-label="Order">
          {sorts.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button type="submit" className="btn" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
      </form>

      {running.map(i => (
        <div key={i.id} className="local-pull" aria-label={`Installing from ${i.repo}`}>
          <span className="faint">{i.repo}: {i.status}{i.file ? ` ${i.file}` : ''}{i.total ? ` · ${Math.floor(((i.done || 0) * 100) / i.total)}% of ${formatBytes(i.total)}` : ''}</span>
          {i.total ? <div className="progress"><span style={{width: `${Math.min(100, ((i.done || 0) * 100) / i.total)}%`}} /></div> : null}
          <button type="button" className="btn btn-sm" onClick={() => void api.cancelInstall(i.id)}>Cancel</button>
        </div>
      ))}
      {finished.map(i => i.result?.next ? <p key={i.id} className="notice">{i.repo}: {i.result.next}</p> : null)}

      {results && results.length === 0 && <p className="muted">No GGUF models match. Try fewer words, or the model’s family name.</p>}
      {results && results.length > 0 && !repo && (
        <ul className="install-results">
          {results.map(m => (
            <li key={m.id}>
              <button type="button" className="link-button mono" onClick={() => setRepo(m)}>{m.id}</button>
              <span className="faint num"> {m.downloads.toLocaleString()} downloads · {m.likes.toLocaleString()} likes{m.last_modified ? ` · ${m.last_modified}` : ''}</span>
              {m.needs_token && <span className="tag">Needs a token</span>}
            </li>
          ))}
        </ul>
      )}
      {repo && <Builds model={repo} onBack={() => setRepo(null)} />}
    </Group>
  );
}

function Builds({model, onBack}: {model: HFModel; onBack: () => void}) {
  const [builds, setBuilds] = useState<HFBuild[] | null>(null);
  const [error, setError] = useState('');
  const targets = useTargets();
  const [target, setTarget] = useState('');
  useEffect(() => {
    setBuilds(null);
    setError('');
    api.hfBuilds(model.id).then(list => setBuilds(Array.isArray(list) ? list : [])).catch(e => setError(String(e instanceof Error ? e.message : e)));
  }, [model.id]);
  const chosen = targets.find(t => t.value === target) || targets[0];

  async function install(build: HFBuild) {
    try {
      await api.installModel({repo: model.id, build: build.name, target: chosen.target, server: chosen.server});
    } catch (e) {
      toastError(e);
    }
  }

  const usable = (builds || []).filter(b => !b.projector);
  return (
    <div className="install-builds" aria-label={`Builds of ${model.id}`}>
      <div className="row-actions">
        <button type="button" className="btn btn-sm" onClick={onBack}>Back to results</button>
        <strong className="mono">{model.id}</strong>
      </div>
      {model.needs_token && <p className="notice">This model is gated: accept its terms on Hugging Face, and save your Hugging Face token as an API key secret for provider huggingface.</p>}
      {error && <p className="notice bad" role="alert">{error}</p>}
      {!builds && !error && <p className="muted">Reading the builds…</p>}
      {builds && (
        <>
          <label className="field install-target">
            <span>Install to</span>
            <select className="select" value={chosen.value} onChange={e => setTarget(e.target.value)}>
              {targets.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <table className="install-table">
            <thead><tr><th>Build</th><th>Quantization</th><th className="num">Size</th><th /></tr></thead>
            <tbody>
              {usable.map(b => (
                <tr key={b.name}>
                  <td className="mono">{b.name}{b.parts > 1 ? <span className="faint"> ({b.parts} parts)</span> : null}</td>
                  <td>{b.quant || '—'}{b.recommended && <span className="tag ok">Suggested</span>}</td>
                  <td className="num">{formatBytes(b.size)}</td>
                  <td>{b.complete ? <button type="button" className="btn btn-sm" disabled={chosen.target === 'ollama' && !b.quant} aria-label={`Install ${b.name}`} onClick={() => void install(b)}>Install</button> : <span className="faint">Parts missing</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
