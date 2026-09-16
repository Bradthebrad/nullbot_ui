import {useRef, useState} from 'react';

// Kept in the mounted chat view: no prompt contents are written to browser storage.
export function useComposerDraft() {
  const [input, render] = useState('');
  const value = useRef('');
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  function setInput(next: string) {
    if (next === value.current) return;
    undoStack.current = [...undoStack.current.slice(-199), value.current];
    redoStack.current = [];
    value.current = next;
    render(next);
  }
  function move(from: string[], to: string[]) {
    if (!from.length) return;
    to.push(value.current);
    value.current = from.pop()!;
    render(value.current);
  }
  return {input, setInput, undo: () => move(undoStack.current, redoStack.current),
    redo: () => move(redoStack.current, undoStack.current),
    canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0};
}
