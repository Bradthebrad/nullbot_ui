import {useEffect, useRef} from 'react';
import type {ChatMode} from './chatSubmission';

export default function BusySendDialog({onChoose, onCancel}: {onChoose: (mode: ChatMode) => void; onCancel: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    // Focus the safe choice: Enter from the composer must not send by accident.
    keep.current?.focus();
    return () => {dialog.current?.close(); if (previous?.isConnected) previous.focus();};
  }, []);
  return <dialog ref={dialog} className="modal busy-send-dialog" aria-modal="true" aria-labelledby="busy-send-title" aria-describedby="busy-send-description"
    onCancel={event => {event.preventDefault(); onCancel();}}>
    <h2 id="busy-send-title">NullBot is still working</h2>
    <p id="busy-send-description" className="muted">Choose what to do with this message. Your draft, attachments and skills stay as they are until you pick.</p>
    <div className="choice-list">
      <button className="choice" onClick={() => onChoose('queue')}><strong>Queue it</strong><span className="muted">Runs after the current request finishes.</span></button>
      <button className="choice" onClick={() => onChoose('steer')}><strong>Steer the current request</strong><span className="muted">Adds this as guidance for the manager and every subagent it has running, at their next step.</span></button>
      <button className="choice" onClick={() => onChoose('also')}><strong>Ask on the side</strong><span className="muted">Gets a separate answer without interrupting anything.</span></button>
    </div>
    <div className="modal-actions">
      <button ref={keep} className="btn" onClick={onCancel}>Keep editing</button>
    </div>
  </dialog>;
}
