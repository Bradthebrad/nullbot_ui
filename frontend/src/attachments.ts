export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export type AttachmentInfo = {
  name?: string; path?: string; original_path?: string; kind?: string;
  size?: number; token?: string; error?: string; preview_url?: string;
};
export type StagedAttachment = AttachmentInfo & {id: string; status: 'preparing' | 'ready' | 'failed'};
export type AttachmentAPI = {
  attachFiles: (paths: string[]) => Promise<AttachmentInfo[]>;
  attachBytes: (name: string, base64: string) => Promise<AttachmentInfo>;
};

// Only claim a COMPLETE list of absolute paths. Ambiguous unquoted spaces and
// prose remain native textarea input; quote paths containing spaces.
export function parseClipboardPaths(text: string): string[] | null {
  const input = text.trim();
  if (!input) return null;
  const paths: string[] = [];
  let pos = 0;
  while (pos < input.length) {
    const quote = input[pos] === '"' || input[pos] === "'" ? input[pos++] : '';
    const start = pos;
    if (quote) {
      while (pos < input.length && input[pos] !== quote) pos++;
      if (pos === input.length) return null;
    } else {
      while (pos < input.length && !/\s/.test(input[pos])) pos++;
    }
    const path = input.slice(start, pos);
    if (quote) pos++;
    if (pos < input.length && !/\s/.test(input[pos])) return null;
    const windows = /^(?:[a-z]:[\\/]|\\\\[^\\/\s]+[\\/][^\\/\s]+[\\/])/i.test(path);
    const unix = /^\/(?:[^/\s]+\/)+[^/]+$/.test(path);
    if ((!windows && !unix) || /[\r\n\x00-\x1f"<>|?*]/.test(path) || (!quote && /[';,]/.test(path))) return null;
    if (windows && path.slice(2).includes(':')) return null;
    paths.push(path);
    while (pos < input.length && /\s/.test(input[pos])) pos++;
  }
  return paths.length ? paths : null;
}

export function handleAttachmentPaste(
  event: {clipboardData: DataTransfer | null; preventDefault: () => void},
  stageFiles: (files: File[]) => void,
  stagePaths: (paths: string[]) => void,
): boolean {
  const data = event.clipboardData;
  let files = Array.from(data?.files || []);
  if (!files.length) files = Array.from(data?.items || []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => !!file);
  if (files.length) {
    event.preventDefault(); // synchronous, before any byte read or bridge call
    stageFiles(files);
    return true;
  }
  const paths = parseClipboardPaths(data?.getData('text/plain') || '');
  if (!paths) return false;
  event.preventDefault();
  stagePaths(paths);
  return true;
}

export async function fileBase64(file: Pick<File, 'size' | 'arrayBuffer'>): Promise<string> {
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_ATTACHMENT_BYTES) throw new Error('File exceeds the 20 MiB attachment limit.');
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES || buffer.byteLength !== file.size) throw new Error('File size changed while preparing attachment.');
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

// Never render remote, file:, SVG, or arbitrary backend-provided URLs.
export function safeRasterPreview(url?: string): string | undefined {
  if (!url || url.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 64) return undefined;
  return /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(url) ? url : undefined;
}

export function attachmentSendBlock(items: StagedAttachment[]): string {
  if (items.some(item => item.status === 'failed')) return 'Remove failed attachments before sending.';
  if (items.some(item => item.status === 'preparing')) return 'Wait for attachments to finish preparing, or remove them before sending.';
  if (items.some(item => !item.token)) return 'Remove attachments without a ready token before sending.';
  return '';
}

let sequence = 0;
// Snapshot is updated synchronously, so Enter immediately after paste is guarded
// even before React renders. Completions only replace existing IDs, never append.
export function createAttachmentQueue(api: AttachmentAPI) {
  let items: StagedAttachment[] = [];
  const listeners = new Set<() => void>();
  let work = Promise.resolve();
  const publish = (next: StagedAttachment[]) => { items = next; listeners.forEach(listener => listener()); };
  const has = (id: string) => items.some(item => item.id === id);
  function enqueue(seeds: AttachmentInfo[], prepare: (index: number, id: string) => Promise<AttachmentInfo>) {
    const staged = seeds.map(seed => ({...seed, id: `attachment-${++sequence}`, status: 'preparing' as const}));
    publish([...items, ...staged]);
    staged.forEach((item, index) => {
      work = work.then(async () => {
        if (!has(item.id)) return;
        try {
          const result = await prepare(index, item.id);
          if (!result || result.error || !result.token) throw new Error(result?.error || 'Attachment preparation returned no token.');
          publish(items.map(current => current.id === item.id ? {...current, ...result, id: item.id, status: 'ready', preview_url: safeRasterPreview(result.preview_url)} : current));
        } catch (error) {
          publish(items.map(current => current.id === item.id ? {...current, status: 'failed', error: String(error instanceof Error ? error.message : error)} : current));
        }
      });
    });
    return work;
  }
  return {
    snapshot: () => items,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    remove: (id: string) => publish(items.filter(item => item.id !== id)),
    removeMany: (ids: string[]) => publish(items.filter(item => !ids.includes(item.id))),
    stagePaths: (paths: string[]) => enqueue(paths.filter(Boolean).map(path => ({original_path: path, name: path.split(/[\\/]/).pop() || path})), async index => {
      const result = await api.attachFiles([paths.filter(Boolean)[index]]);
      return result?.[0];
    }),
    stageFiles: (files: File[]) => enqueue(files.map(file => ({name: file.name || 'clipboard-image.png', size: file.size})), async (index, id) => {
      const data = await fileBase64(files[index]);
      if (!has(id)) throw new Error('Removed');
      return api.attachBytes(files[index].name || 'clipboard-image.png', data);
    }),
  };
}
