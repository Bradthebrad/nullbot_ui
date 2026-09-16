import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ast.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(ast)).join('\n');
function render(activity) {
  const context = vm.createContext({
    React: {createElement: (type, props, ...children) => ({type, props: props || {}, children: children.flat(Infinity)})},
    useRef: initial => ({current: initial}),
    useEffect: () => {},
    Activity: 'activity-icon',
  });
  vm.runInContext(ts.transpile(functions, {target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React}), context);
  return context.LiveActivity({activity});
}
function nodes(tree) {
  return !tree || typeof tree !== 'object' ? [] : [tree, ...tree.children.flatMap(nodes)];
}
function cards(tree) { return nodes(tree).filter(node => node.props.item); }
const event = (agent, index) => ({agent_id: agent, run_id: `run-${index}`, time: `2026-09-14T00:00:${String(index % 60).padStart(2, '0')}Z`, status: 'tool start', name: `tool-${index}`, detail: 'args: {}'});

test('Live Activity has no agent dropdown or filter row and includes every agent', () => {
  const tree = render([event('main', 0), event('worker', 1), event('also-worker', 2)]);
  assert.equal(nodes(tree).some(node => node.type === 'select' || node.props.className === 'activity-filters'), false);
  assert.deepEqual(Array.from(cards(tree), node => node.props.item.agent), ['main', 'worker', 'also-worker']);
});

test('Live Activity retains the latest 80 events across agents', () => {
  const tree = render(Array.from({length: 85}, (_, index) => event(index % 2 ? 'worker' : 'main', index)));
  const items = cards(tree);
  assert.equal(items.length, 80);
  assert.equal(items[0].props.item.name, 'tool-5');
  assert.equal(items.at(-1).props.item.name, 'tool-84');
});

test('Live Activity empty state does not refer to the removed filter', () => {
  const tree = render([]);
  const empty = nodes(tree).find(node => node.props.className === 'empty-state small');
  assert.equal(empty.children.join(''), 'Tool calls and reasoning checkpoints appear here.');
  assert.equal(cards(tree).length, 0);
});
