// Unsaved-edit tracking. Editors register while they hold changes; anything
// that would unmount them (switching files, views or list items) goes through
// guard(), which asks before discarding.
import {useEffect} from 'react';
import {confirmDialog} from '../ui/dialogs';

const editors = new Set<string>();

export function hasUnsavedEdits(): boolean {
  return editors.size > 0;
}

/** Registers an editor as holding unsaved changes while dirty is true. */
export function useUnsavedEdits(key: string, dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    editors.add(key);
    return () => {
      editors.delete(key);
    };
  }, [key, dirty]);
}

export async function confirmDiscard(): Promise<boolean> {
  if (!editors.size) return true;
  const ok = await confirmDialog({
    title: 'Discard unsaved changes?',
    body: 'You have edits that haven’t been saved. Leaving now throws them away.',
    confirmLabel: 'Discard changes',
    danger: true,
  });
  if (ok) editors.clear();
  return ok;
}

/** Runs fn now if nothing is unsaved, otherwise after the person agrees to discard. */
export function guard(fn: () => void) {
  if (!editors.size) {
    fn();
    return;
  }
  void confirmDiscard().then(ok => {
    if (ok) fn();
  });
}

/** For tests. */
export function resetUnsavedEdits() {
  editors.clear();
}
