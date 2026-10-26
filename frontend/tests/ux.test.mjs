import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('composer supports undo, redo, recall/clear undo, and divergent edits', () => {
  const slots = []; let index = 0;
  const hooks = vm.createContext({
    useRef(initial) { const i = index++; return slots[i] ??= {current: initial}; },
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
  });
  const hook = fs.readFileSync(new URL('../src/useComposerDraft.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/m, '').replace('export function', 'function');
  vm.runInContext(ts.transpile(hook, {target: ts.ScriptTarget.ES2022}), hooks);
  const render = () => { index = 0; return hooks.useComposerDraft(); };
  render().setInput('draft'); render().setInput('draft edited');
  render().undo(); assert.equal(render().input, 'draft');
  render().redo(); assert.equal(render().input, 'draft edited');
  render().setInput(''); render().undo(); assert.equal(render().input, 'draft edited');
  render().setInput('new draft'); assert.equal(render().canRedo, false);
});
