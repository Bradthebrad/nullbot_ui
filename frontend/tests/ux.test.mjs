import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ast.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(ast)).join('\n');
const context = vm.createContext({});
vm.runInContext(ts.transpile(functions, {target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React}), context);

test('tool events deduplicate and preserve both arguments and result', () => {
  const start = {time: '2026-01-01T00:00:00Z', status: 'tool start', name: 'read_file', agent: 'worker', detail: 'args: {"path":"a.txt"}'};
  const end = {...start, time: '2026-01-01T00:00:01Z', status: 'tool complete', detail: 'Read 42 bytes'};
  const items = context.buildActivityTimeline([start, start, end, end]);
  assert.equal(items.length, 1);
  assert.equal(items[0].state, 'complete');
  assert.match(items[0].raw, /a.txt/);
  assert.match(items[0].raw, /Read 42 bytes/);
});

test('same-name tools from separate agents do not cross-pair', () => {
  const start = {time: '2026-01-01T00:00:00Z', status: 'tool start', name: 'read_file', detail: 'args: {}'};
  const items = context.buildActivityTimeline([{...start, agent: 'one'}, {...start, agent: 'two'}, {...start, agent: 'one', status: 'tool error', detail: 'denied'}]);
  assert.equal(items[0].state, 'error');
  assert.equal(items[1].state, 'running');
  assert.equal(items[1].agent, 'two');
});

test('unpaired completion retains available result', () => {
  const [item] = context.buildActivityTimeline([{status: 'tool complete', name: 'search_text', detail: '3 matches'}]);
  assert.equal(item.raw, '3 matches');
});

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

test('composer remains mounted across tabs and clear occurs only after accepted calls', () => {
  assert.match(source, /className="persistent-chat" hidden=\{view !== 'chat'\}/);
  assert.match(source, /await submitChatRequest\(request\);\s*accepted\(\)/);
  assert.match(source, /onClick=\{\(\) => send\('also'\)\}/);
  assert.doesNotMatch(source, /alsoMode|setAlsoMode/);
  assert.match(source, /if \(inputRevision.current === revision\) setInput\(''\)/);
  assert.match(source, /input === '' \|\| historyCursor !== null/);
});


test('activity excludes all answer text and completion details', () => {
  const base = {agent_id: 'main', run_id: 'r', time: '2026-01-01'};
  const items = context.buildActivityTimeline([{...base, status: 'response delta', detail: 'SECRET ANSWER'}, {...base, status: 'agent complete', detail: 'SECRET ANSWER'}]);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Work Complete');
  assert.doesNotMatch(JSON.stringify(items), /SECRET ANSWER/);
  assert.doesNotMatch(source, /Include model\/status events/);
});

test('reasoning references stay chronological across tools and agent filters', () => {
  const r = {status: 'reasoning delta', agent_id: 'main', run_id: 'r', detail: 'x'};
  const items = context.buildActivityTimeline([r, r, {status: 'tool start', name: 'read_file'}, {...r, detail: 'next'}, {...r, agent_id: 'worker', detail: 'agent summary'}]);
  assert.deepEqual(Array.from(items, item => item.kind), ['reasoning', 'tool', 'reasoning', 'reasoning']);
  assert.equal(items[0].subtitle, 'xx');
  assert.equal(items[2].subtitle, 'next');
  assert.equal(items[3].agent, 'worker');
});

test('chat streams real deltas beyond 400 records, excludes agents and reconciles once', () => {
  const delta = {status: 'response delta', agent_id: 'main', run_id: 'run', detail: 'x'};
  let messages = [];
  for (let i = 0; i < 650; i++) messages = context.ingestChatStream(messages, delta);
  assert.equal(messages[0].content.length, 650);
  messages = context.ingestChatStream(messages, {...delta, detail: ' \n'});
  assert.ok(messages[0].content.endsWith(' \n'));
  messages = context.ingestChatStream(messages, {...delta, agent_id: 'worker', detail: 'hidden'});
  assert.equal(messages.length, 1);
  messages = context.ingestChatStream(messages, {...delta, status: 'reasoning delta', detail: 'Summary'});
  messages = context.ingestChatStream(messages, {...delta, status: 'agent complete'});
  const history = [{role: 'assistant', content: 'Final answer', time: 'final'}];
  messages = context.reconcileChatHistory(messages, history);
  messages = context.reconcileChatHistory(messages, history);
  assert.equal(messages.filter(m => m.content === 'Final answer').length, 1);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].summaries[0], 'Summary');
});

test('failed partial chat survives final history and refresh', () => {
  const delta = {status: 'response delta', agent_id: 'main', run_id: 'run', detail: 'Partial'};
  let messages = context.ingestChatStream([], delta);
  messages = context.ingestChatStream(messages, {...delta, status: 'model error'});
  messages = context.reconcileChatHistory(messages, [{role: 'assistant', content: 'Error'}]);
  messages = context.reconcileChatHistory(messages, []);
  const partial = messages.find(message => message.streamKey);
  assert.equal(partial.content, 'Partial');
  assert.equal(partial.streamState, 'incomplete');
  assert.equal(messages.filter(message => message.content === 'Error').length, 1);
});

test('reasoning memory survives activity cap without storing response deltas', () => {
  let records = [];
  for (let i = 0; i < 650; i++) records = context.mergeActivityRecords(records, [{status: 'reasoning delta', detail: 'x'}], true);
  records = context.mergeActivityRecords(records, [{status: 'response delta', detail: 'answer'}]);
  assert.equal(context.buildActivityTimeline(records)[0].subtitle.length, 650);
  assert.doesNotMatch(JSON.stringify(records), /answer/);
});

test('skill suggestions are metadata-only, bounded, and require useful matching text', () => {
  const skills = [{name: 'build', description: 'Compile frontend projects', path: 'build/SKILL.md'}, {name: 'images', description: 'Draw images', path: 'images/SKILL.md'}];
  assert.equal(context.suggestSkillMatches('please use the', skills).length, 0);
  assert.equal(context.suggestSkillMatches('Compile frontend', skills)[0].path, 'build/SKILL.md');
  assert.match(source, /makeChatRequest\(selectedMode, text, sendAttachments, sendSkills/);
  assert.match(source, /Context updated:/);
  assert.doesNotMatch(source, /async function revealReply/);
});
