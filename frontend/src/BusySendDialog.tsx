import {useEffect, useRef} from 'react';
import type {ChatMode} from './chatSubmission';

export default function BusySendDialog({onChoose, onCancel}: {onChoose: (mode: ChatMode) => void; onCancel: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    cancel.current?.focus();
    return () => {dialog.current?.close(); if (previous?.isConnected) previous.focus();};
  }, []);
  return <dialog ref={dialog} className="busy-send-dialog" aria-modal="true" aria-labelledby="busy-send-title" aria-describedby="busy-send-description"
    onCancel={event => {event.preventDefault(); onCancel();}}>
    <h2 id="busy-send-title">Current tasks are still working</h2>
    <p id="busy-send-description">Choose how to send this draft. Cancel keeps your text, attachments, and skill selections unchanged.</p>
    <div className="busy-send-options">
      <button className="also-action" onClick={() => onChoose('also')}><strong>Also — Ask on side</strong><span>Get a separate answer without interrupting current tasks.</span></button>
      <button onClick={() => onChoose('queue')}><strong>Queue after Current Tasks</strong><span>Run this request after current work finishes.</span></button>
      <button onClick={() => onChoose('steer')}><strong>Steer Current Workers</strong><span>Send this guidance to the workers already running.</span></button>
    </div>
    <button ref={cancel} onClick={onCancel}>Cancel — keep draft</button>
  </dialog>;
}
