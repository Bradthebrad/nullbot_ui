export function formatDuration(ms: number | undefined | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function elapsedSince(iso: string | undefined, now = Date.now()): number {
  const start = Date.parse(iso || '');
  return Number.isFinite(start) ? Math.max(0, now - start) : 0;
}

export function between(start?: string, end?: string): number | undefined {
  const a = Date.parse(start || '');
  const b = Date.parse(end || '');
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : undefined;
}

export function formatBytes(value: number | undefined | null): string {
  if (!value || value < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}

export function formatCount(value: number | undefined | null): string {
  const n = Number(value || 0);
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`;
}

export function formatCost(value: number | undefined | null): string {
  const n = Number(value || 0);
  if (n === 0) return '$0';
  if (n < 0.01) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

export function formatTime(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})
    : date.toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
}

export function relativeTime(iso?: string, now = Date.now()): string {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return formatDateTime(iso);
}

export function shorten(value: unknown, limit = 80): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

export function basename(path: string): string {
  return String(path || '').split(/[\\/]+/).filter(Boolean).pop() || path;
}

export function permissionLabel(permission?: string, allow?: string[]): string {
  switch (permission) {
    case 'read-only': return 'Read only';
    case 'read-write': return 'Read & write';
    case 'full': return 'Full access';
    case 'custom': {
      const extra = (allow || []).map(c => (c === 'execute' ? 'run' : c));
      return extra.length ? `Read + ${extra.join(', ')}` : 'Custom (read)';
    }
  }
  return permission || 'Unknown';
}

export function capabilityLabel(capability?: string): string {
  switch (capability) {
    case 'read': return 'Read';
    case 'write': return 'Write';
    case 'delete': return 'Delete';
    case 'execute': return 'Run programs';
  }
  return capability || '';
}

export type Tone = 'ok' | 'bad' | 'live' | 'idle' | 'off';

/** Maps the many backend status words onto the five dot tones. */
export function statusTone(status?: string): Tone {
  const value = String(status || '').toLowerCase();
  if (/^(running|starting|canceling|active|working|in[-_ ]?progress|executing)$/.test(value)) return 'live';
  if (/^(done|complete|completed|ready|ok|success|succeeded|installed|authorized|configured)$/.test(value)) return 'ok';
  if (/^(error|failed|failure|denied|expired|blocked)$/.test(value)) return 'bad';
  if (/^(canceled|cancelled|disabled|skipped|stopped)$/.test(value)) return 'off';
  return 'idle';
}

/** Sentence-case label for a backend status word. */
export function statusText(status?: string): string {
  const value = String(status || '').trim().replace(/[_-]+/g, ' ');
  if (!value) return 'Pending';
  if (/^cancell?ed$/i.test(value)) return 'Stopped';
  if (/^canceling$/i.test(value)) return 'Stopping';
  if (/^error$/i.test(value)) return 'Failed';
  return value[0].toUpperCase() + value.slice(1).toLowerCase();
}

/** "project_read_file" or "gmail.search" -> "Project read file". */
export function humanizeName(name?: string): string {
  const words = String(name || '').replace(/^mcp__[^_]+__/, '').replace(/[._-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
}

export function firstLine(text?: string, limit = 120): string {
  const line = String(text || '').split('\n').map(part => part.replace(/^[#*\s>-]+/, '').replace(/\*\*/g, '').trim()).find(Boolean) || '';
  return shorten(line, limit);
}
