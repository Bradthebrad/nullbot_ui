// Path helpers that work for both Windows and POSIX paths, since the UI only
// sees strings from the backend.

export function isAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/');
}

export function separatorOf(path: string): string {
  return /^[a-zA-Z]:/.test(path) || path.includes('\\') ? '\\' : '/';
}

export function joinPath(base: string, rel: string): string {
  const sep = separatorOf(base);
  const cleaned = rel.replace(/^\.[\\/]/, '').replace(/[\\/]+/g, sep);
  return base.replace(/[\\/]+$/, '') + sep + cleaned;
}

export function dirname(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (index < 0) return trimmed;
  if (index === 2 && /^[a-zA-Z]:/.test(trimmed)) return trimmed.slice(0, 3);
  return index === 0 ? trimmed.slice(0, 1) : trimmed.slice(0, index);
}

function norm(path: string) {
  const value = path.replace(/[\\/]+/g, '/').replace(/\/$/, '');
  return /^[a-zA-Z]:/.test(value) ? value.toLowerCase() : value;
}

/** True when path is root or inside it. */
export function isInside(path: string, root: string): boolean {
  const p = norm(path);
  const r = norm(root);
  return p === r || p.startsWith(`${r}/`);
}

/** The part of path below root, split into segments. */
export function segmentsBelow(path: string, root: string): string[] {
  if (!isInside(path, root)) return [];
  return norm(path).slice(norm(root).length).split('/').filter(Boolean);
}

export function commonPrefix(values: string[]): string {
  if (!values.length) return '';
  let prefix = values[0];
  for (const value of values.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < value.length && prefix[i].toLowerCase() === value[i].toLowerCase()) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix;
}
