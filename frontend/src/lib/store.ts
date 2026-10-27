import {useRef, useSyncExternalStore} from 'react';

// A minimal external store. Components subscribe to slices with useStore, so
// a streamed token re-renders only the components whose slice changed.

export type Store<T> = {
  get: () => T;
  set: (patch: Partial<T> | ((state: T) => Partial<T>)) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      if (!next || Object.keys(next).length === 0) return;
      let changed = false;
      for (const key of Object.keys(next) as (keyof T)[]) {
        if (!Object.is(state[key], (next as T)[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = {...state, ...next};
      listeners.forEach(listener => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(k => Object.is((a as any)[k], (b as any)[k]));
}

export function useStore<T, S>(store: Store<T>, selector: (state: T) => S, equal: (a: S, b: S) => boolean = Object.is): S {
  // Cache by state and selector identity so repeated getSnapshot calls in one
  // render return the same value; equal() keeps references stable across renders.
  const cache = useRef<{state: T; selector: (state: T) => S; selected: S} | null>(null);
  const getSnapshot = () => {
    const state = store.get();
    const current = cache.current;
    if (current && current.state === state && current.selector === selector) return current.selected;
    const selected = selector(state);
    if (current && equal(current.selected, selected)) {
      cache.current = {state, selector, selected: current.selected};
      return current.selected;
    }
    cache.current = {state, selector, selected};
    return selected;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
