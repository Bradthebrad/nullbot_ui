import {useEffect, useRef, useState} from 'react';
import {AttachmentInfo, safeRasterPreview} from './attachments';
import './attachments.css';

type DisplayAttachment = AttachmentInfo & {id?: string; status?: string};

export default function AttachmentTray({attachments, onRemove, readonly = false}: {attachments: DisplayAttachment[]; onRemove?: (id: string) => void; readonly?: boolean}) {
  const [preview, setPreview] = useState<DisplayAttachment | null>(null);
  const visiblePreview = preview && attachments.includes(preview) ? preview : null;
  return <>
    <div className="attachment-tray" aria-label={readonly ? 'Sent attachments' : 'Staged attachments'}>
      {attachments.map((item, index) => {
        const name = item.name || item.path || 'Attachment';
        const url = safeRasterPreview(item.preview_url);
        const status = item.status || (item.error ? 'failed' : 'ready');
        return <div className={`attachment-chip attachment-${status} ${item.error ? 'error' : ''}`} key={item.id || item.path || `${name}-${index}`}>
          {url ? <button type="button" className="attachment-thumbnail" onClick={() => setPreview(item)} aria-label={`Preview ${name}`}><img src={url} alt="" /></button> : <span className="attachment-file-icon" aria-hidden="true">▤</span>}
          <div className="attachment-details">
            <strong title={name}>{name}</strong>
            <span role="status">{status === 'preparing' ? 'Preparing…' : status === 'failed' ? 'Failed' : 'Ready'}{item.size !== undefined ? ` · ${(item.size / 1024).toFixed(1)} KiB` : ''}</span>
            {item.error && <span className="attachment-error">{item.error}</span>}
          </div>
          {!readonly && onRemove && item.id && <button type="button" className="attachment-remove" onClick={() => onRemove(item.id!)} aria-label={`Remove ${name}`} title="Remove attachment">×</button>}
        </div>;
      })}
    </div>
    {visiblePreview && <AttachmentPreview attachment={visiblePreview} onClose={() => setPreview(null)} />}
  </>;
}

export function AttachmentPreview({attachment, onClose}: {attachment: DisplayAttachment; onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const url = safeRasterPreview(attachment.preview_url);
  const name = attachment.name || attachment.path || 'Image';
  useEffect(() => {
    if (!url) return;
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    // Native modal dialog makes the rest of the application inert and traps Tab.
    element?.showModal();
    closeButton.current?.focus();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, [url]);
  if (!url) return null;
  return <dialog ref={dialog} className="attachment-preview" aria-label={`Image preview: ${name}`} aria-modal="true"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="attachment-preview-content">
      <header><strong>{name}</strong><button type="button" ref={closeButton} onClick={onClose} aria-label="Close image preview">Close</button></header>
      <img src={url} alt={name} />
    </div>
  </dialog>;
}
