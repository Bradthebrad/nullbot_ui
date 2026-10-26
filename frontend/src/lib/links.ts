// Link routing. A plain <a href> in a Wails WebView navigates the app window
// itself and unloads the UI, so every link is intercepted: web and mail links
// open in the system browser, local paths open in the Files view (or the
// system app with Ctrl/Cmd), and anything else is blocked.

export type LinkTarget =
  | {kind: 'external'; url: string}
  | {kind: 'local'; path: string}
  | {kind: 'anchor'; id: string}
  | {kind: 'blocked'; reason: string};

const windowsPath = /^[a-zA-Z]:[\\/]/;

export function classifyHref(raw: string | null | undefined): LinkTarget {
  const href = String(raw || '').trim();
  if (!href) return {kind: 'blocked', reason: 'Empty link'};
  if (href.startsWith('#')) return {kind: 'anchor', id: href.slice(1)};
  if (windowsPath.test(href) || href.startsWith('\\\\')) return {kind: 'local', path: href};
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href)?.[1]?.toLowerCase();
  if (!scheme) {
    // Relative references in bot replies refer to files in the primary project.
    try {
      return {kind: 'local', path: decodeURI(href.split(/[?#]/)[0])};
    } catch {
      return {kind: 'local', path: href.split(/[?#]/)[0]};
    }
  }
  switch (scheme) {
    case 'http':
    case 'https':
      try {
        const url = new URL(href);
        // Links to the app's own origin (e.g. a relative link resolved by the
        // browser) are treated as local paths, never navigated.
        if (url.host === window.location.host) return {kind: 'local', path: decodeURIComponent(url.pathname.replace(/^\//, ''))};
        return {kind: 'external', url: url.toString()};
      } catch {
        return {kind: 'blocked', reason: 'Malformed link'};
      }
    case 'mailto':
      return {kind: 'external', url: href};
    case 'file':
      try {
        const url = new URL(href);
        let path = decodeURIComponent(url.pathname);
        if (/^\/[a-zA-Z]:/.test(path)) path = path.slice(1).replace(/\//g, '\\');
        if (url.host && url.host !== 'localhost') path = `\\\\${url.host}${path.replace(/\//g, '\\')}`;
        return {kind: 'local', path};
      } catch {
        return {kind: 'blocked', reason: 'Malformed file link'};
      }
    default:
      return {kind: 'blocked', reason: `${scheme}: links are not opened from NullBot`};
  }
}

export type LinkHandlers = {
  openExternal: (url: string) => void;
  openLocal: (path: string, options: {system: boolean}) => void;
  blocked: (reason: string) => void;
};

/** Installs capture-phase handlers for clicks on any anchor in the app. */
export function installLinkInterceptor(handlers: LinkHandlers): () => void {
  function route(event: MouseEvent) {
    if (event.defaultPrevented) return;
    if (event.type === 'click' && event.button !== 0) return;
    if (event.type === 'auxclick' && event.button !== 1) return;
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor || anchor.dataset.nativeLink === 'true') return;
    const target = classifyHref(anchor.getAttribute('href'));
    if (target.kind === 'anchor') return;
    event.preventDefault();
    event.stopPropagation();
    if (target.kind === 'external') handlers.openExternal(target.url);
    else if (target.kind === 'local') handlers.openLocal(target.path, {system: event.ctrlKey || event.metaKey});
    else handlers.blocked(target.reason);
  }
  document.addEventListener('click', route, true);
  document.addEventListener('auxclick', route, true);
  const originalOpen = window.open;
  window.open = ((url?: string | URL) => {
    const target = classifyHref(url ? String(url) : '');
    if (target.kind === 'external') handlers.openExternal(target.url);
    else if (target.kind === 'local') handlers.openLocal(target.path, {system: false});
    else if (target.kind === 'blocked') handlers.blocked(target.reason);
    return null;
  }) as typeof window.open;
  return () => {
    document.removeEventListener('click', route, true);
    document.removeEventListener('auxclick', route, true);
    window.open = originalOpen;
  };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
