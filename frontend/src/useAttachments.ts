import {useRef, useSyncExternalStore} from 'react';
import {AttachFiles} from '../wailsjs/go/main/App';
import {AttachmentInfo, createAttachmentQueue} from './attachments';

// Kept outside generated bindings so Wails regeneration cannot remove this bridge.
function attachBytes(name: string, dataBase64: string): Promise<AttachmentInfo> {
  const api = (window as any).go?.main?.App;
  if (!api?.AttachBytes) return Promise.reject(new Error('Clipboard attachments require a backend with AttachBytes support.'));
  return api.AttachBytes(name, dataBase64);
}

export function useAttachments() {
  const ref = useRef<ReturnType<typeof createAttachmentQueue> | null>(null);
  if (!ref.current) ref.current = createAttachmentQueue({attachFiles: AttachFiles, attachBytes});
  const queue = ref.current;
  const attachments = useSyncExternalStore(queue.subscribe, queue.snapshot, queue.snapshot);
  return {attachments, queue};
}
