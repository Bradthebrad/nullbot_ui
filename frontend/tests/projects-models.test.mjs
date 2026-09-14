import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Lightweight hook harness: exercises component handlers without adding dependencies.
function mount(file, props, api = {}, confirm = () => true) {
  const slots = []; const effects = []; let cursor = 0;
  const React = {createElement(type, props, ...children) {
    if (typeof type === 'function') return type(props || {});
    return {type, props: props || {}, children: children.flat(Infinity)};
  }};
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => {slots[i] = typeof value === 'function' ? value(slots[i]) : value;}]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= {current: initial}; },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((d, n) => d !== slots[i][n])) {slots[i] = deps; effects.push(effect);} },
  };
  const source = fs.readFileSync(new URL(`../src/${file}.tsx`, import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default function', 'function').replace(/export type /g, 'type ');
  const context = vm.createContext({...hooks, ...api, React, window: {confirm}, crypto: {randomUUID: () => 'new-id'}});
  vm.runInContext(ts.transpile(source, {target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React}), context);
  return {render() {cursor = 0; return context[file](props);}, async flush() {effects.splice(0).forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve));}};
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...(tree.children || []).flatMap(child => nodes(child, predicate))];
}
const text = tree => typeof tree === 'string' ? tree : (tree?.children || []).map(text).join('');
const buttons = tree => nodes(tree, n => n.type === 'button');
const initial = {projects: [{id: 'a', name: 'Alpha', path: 'C:/Alpha', permission: 'read-only'}, {id: 'b', name: 'Beta', path: 'C:/Beta', permission: 'read-write'}], primary_project_id: 'a', workspace_dir: 'C:/Alpha', warning: ''};

test('project dropdown labels and staged primary selection preserve backend values', async () => {
  let saved;
  const view = mount('ProjectsView', {load: async () => initial, save: async (projects, primary) => {saved = {projects, primary}; return {...initial, projects, primary_project_id: primary};}});
  view.render(); await view.flush(); let tree = view.render();
  assert.equal(nodes(tree, n => n.type === 'input' && n.props.type === 'radio').length, 0);
  const cards = nodes(tree, n => n.type === 'article');
  const select = nodes(cards[1], n => n.type === 'select')[0];
  assert.deepEqual(nodes(select, n => n.type === 'option').map(n => [n.props.value, text(n)]), [['read-only', 'Read only'], ['read-write', 'Read & write'], ['full', 'Full']]);
  buttons(cards[1]).find(n => text(n) === 'Set as primary').props.onClick();
  assert.equal(saved, undefined);
  tree = view.render();
  await buttons(tree).find(n => text(n) === 'Save projects').props.onClick();
  assert.equal(saved.primary, 'b');
  assert.equal(saved.projects[1].permission, 'read-write');
});

test('Full escalation cancellation does not invoke backend save', async () => {
  let saves = 0; let confirmations = 0;
  const view = mount('ProjectsView', {load: async () => initial, save: async () => {saves++; return initial;}}, {}, () => {confirmations++; return false;});
  view.render(); await view.flush();
  const card = nodes(view.render(), n => n.type === 'article')[0];
  nodes(card, n => n.type === 'select')[0].props.onChange({target: {value: 'full'}});
  await buttons(view.render()).find(n => text(n) === 'Save projects').props.onClick();
  assert.equal(confirmations, 1); assert.equal(saves, 0);
});

test('every model card has three assignment actions targeting that model', async () => {
  const calls = []; let refreshes = 0;
  const view = mount('ModelsView', {ui: {config: {}}, refreshState: () => {refreshes++;}}, {Models: async () => [{provider: 'provider', models: [{id: 'one', name: 'One'}, {id: 'two', name: 'Two'}]}], SetModel: async (...args) => calls.push(args)});
  view.render(); await view.flush();
  for (let index = 0; index < 2; index++) {
    for (const [action, target] of ['manager', 'subagent', 'both'].entries()) {
      const card = nodes(view.render(), n => n.type === 'article')[index];
      assert.equal(buttons(card).length, 3);
      await buttons(card)[action].props.onClick();
      await view.flush();
      assert.deepEqual(calls.at(-1), ['provider', index ? 'two' : 'one', target]);
    }
  }
  assert.equal(refreshes, 6);
});
