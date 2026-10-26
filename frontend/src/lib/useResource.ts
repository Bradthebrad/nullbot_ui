import {useCallback, useEffect, useRef, useState} from 'react';
import {useStore} from './store';
import {appStore} from '../state/app';

/**
 * Loads a snapshot from the backend and reloads it when one of the change
 * topics is announced. No polling: the backend says when data changed.
 */
export function useResource<T>(load: () => Promise<T>, options: {topics?: string[]; initial?: T; deps?: unknown[]} = {}) {
  const {topics = [], initial, deps = []} = options;
  const version = useStore(appStore, state => topics.map(topic => state.versions[topic] || 0).join(','));
  const [data, setData] = useState<T | undefined>(initial);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(initial === undefined);
  const [nonce, setNonce] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let active = true;
    setLoading(true);
    loader.current()
      .then(next => {
        if (!active) return;
        setData(next);
        setError('');
      })
      .catch(err => {
        if (active) setError(String(err instanceof Error ? err.message : err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, nonce, ...deps]);
  const reload = useCallback(() => setNonce(n => n + 1), []);
  return {data, setData, error, loading, reload};
}
