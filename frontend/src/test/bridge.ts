// A fake Wails bridge for tests: window.go.main.App methods and the runtime
// event bus. Unknown methods resolve to an empty object and are recorded.

type Handler = (...args: any[]) => any;

export type FakeBridge = {
  calls: {method: string; args: unknown[]}[];
  emit: (event: string, payload: unknown) => void;
  set: (method: string, handler: Handler) => void;
  callsTo: (method: string) => unknown[][];
};

export const baseState = () => ({
  reply: {history: [], activity: [], suggestions: ['/help', '/plan'], data: {submissions: {busy: false, queue: [], jobs: []}}},
  config: {bot_name: 'NullBot', ui: {appearance: 'light', accent: 'amber'}, model: {provider: 'openai', model: 'gpt-5.1'}},
  keys: {},
  runtime: {bot_name: 'NullBot', provider: 'openai', model: 'gpt-5.1', reasoning_effort: 'medium'},
  models: [{provider: 'openai', models: [{id: 'gpt-5.1', name: 'GPT-5.1'}]}],
  models_fresh: true,
  mcp: [],
  projects: {projects: [{id: 'ops', name: 'acme-ops', path: 'C:\\work\\acme-ops', permission: 'read-write'}], primary_project_id: 'ops', workspace_dir: 'C:\\work\\acme-ops', warning: ''},
  themes: [], usage: {}, tasks: [], scheduled: [], thoughts: [],
  files: {workspace: 'C:\\work\\acme-ops', current: 'C:\\work\\acme-ops', parent: 'C:\\work', entries: []},
  marketplace: {packages: []},
});

export function installBridge(handlers: Record<string, Handler> = {}): FakeBridge {
  const calls: FakeBridge['calls'] = [];
  const listeners = new Map<string, Set<Handler>>();
  const table: Record<string, Handler> = {State: () => baseState(), ...handlers};
  const app = new Proxy({}, {
    get(_target, key: string) {
      return (...args: unknown[]) => {
        calls.push({method: key, args});
        const handler = table[key];
        try {
          return Promise.resolve(handler ? handler(...args) : {});
        } catch (error) {
          return Promise.reject(error);
        }
      };
    },
  });
  (window as any).go = {main: {App: app}};
  (window as any).runtime = {
    EventsOnMultiple(name: string, callback: Handler) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(callback);
      return () => listeners.get(name)?.delete(callback);
    },
    EventsOff() {},
    OnFileDrop() {},
    OnFileDropOff() {},
  };
  return {
    calls,
    emit: (event, payload) => listeners.get(event)?.forEach(fn => fn(payload)),
    set: (method, handler) => {
      table[method] = handler;
    },
    callsTo: method => calls.filter(call => call.method === method).map(call => call.args),
  };
}

export function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}
