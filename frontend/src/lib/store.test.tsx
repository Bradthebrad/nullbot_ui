import {describe, expect, it} from 'vitest';
import {act, render} from '@testing-library/react';
import {createStore, shallowEqual, useStore} from './store';

describe('createStore', () => {
  it('notifies only on real changes', () => {
    const store = createStore({a: 1, b: [1]});
    let calls = 0;
    store.subscribe(() => calls++);
    store.set({a: 1});
    store.set({});
    expect(calls).toBe(0);
    store.set(state => ({a: state.a + 1}));
    expect(calls).toBe(1);
    expect(store.get().a).toBe(2);
  });
});

describe('shallowEqual', () => {
  it('compares one level deep', () => {
    expect(shallowEqual({a: 1, b: 'x'}, {a: 1, b: 'x'})).toBe(true);
    expect(shallowEqual({a: {}}, {a: {}})).toBe(false);
    expect(shallowEqual([1, 2], [1, 2])).toBe(true);
    expect(shallowEqual([1], {0: 1})).toBe(false);
  });
});

describe('useStore', () => {
  it('re-renders a component only when its slice changes', () => {
    const store = createStore({count: 0, other: 0});
    let renders = 0;
    function Count() {
      renders++;
      const count = useStore(store, state => state.count);
      return <span>{count}</span>;
    }
    const view = render(<Count />);
    expect(renders).toBe(1);
    act(() => store.set({other: 1}));
    expect(renders).toBe(1);
    act(() => store.set({count: 5}));
    expect(view.container.textContent).toBe('5');
    expect(renders).toBe(2);
  });

  it('keeps derived objects stable with an equality function', () => {
    const store = createStore({a: 1, b: 2, c: 0});
    let renders = 0;
    function Pair() {
      renders++;
      const pair = useStore(store, state => ({a: state.a, b: state.b}), shallowEqual);
      return <span>{pair.a + pair.b}</span>;
    }
    render(<Pair />);
    act(() => store.set({c: 1}));
    expect(renders).toBe(1);
  });
});
