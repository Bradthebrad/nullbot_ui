import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ts.transpile(ast.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(ast)).join('\n'), {target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React});
function harness() {
  const refs = [], effects = []; let cursor = 0;
  const context = vm.createContext({
    React: {createElement: (type, props, ...children) => ({type, props: props || {}, children: children.flat(Infinity)})},
    useRef: initial => refs[cursor++] ||= {current: initial},
    useEffect: effect => effects.push(effect),
  });
  vm.runInContext(functions, context);
  context.messageWithVisibleAttachments = message => ({...message, attachments: []});
  return {context, refs, effects, render(messages) {cursor = 0; return context.MessageList({messages});}};
}
function nodes(tree) {return !tree || typeof tree !== 'object' ? [] : [tree, ...tree.children.flatMap(nodes)];}
const base = {agent_id: 'main', run_id: 'run', submission_id: 'submission'};
function stream(context) {
  let messages = [];
  for (const [status, detail] of [['reasoning delta', 'Public checkpoint'], ['response delta', 'Answer']]) messages = context.ingestChatStream(messages, {...base, status, detail});
  return messages;
}
const history = [{...base, role: 'reasoning', content: 'Public checkpoint', time: 'summary-time'}, {...base, role: 'assistant', content: 'Answer', time: 'final-time'}];

test('MessageList follows only while near bottom and resumes after scrolling back', () => {
  const h = harness(); const calls = [];
  let tree = h.render([]);
  const element = {scrollHeight: 1000, scrollTop: 600, clientHeight: 400, scrollTo: value => calls.push(value.top)};
  tree.props.ref.current = element; h.effects.pop()(); assert.deepEqual(calls, [1000]);
  element.scrollTop = 100; tree.props.onScroll({currentTarget: element});
  element.scrollHeight = 2000;
  tree = h.render([{role: 'assistant', content: 'Streaming'}]); h.effects.pop()();
  assert.deepEqual(calls, [1000], 'new content must not pull a reader to bottom');
  element.scrollTop = 1520; tree.props.onScroll({currentTarget: element});
  element.scrollHeight = 2500; h.render([{role: 'assistant', content: 'More streaming'}]); h.effects.pop()();
  assert.deepEqual(calls, [1000, 2500]);
  assert.equal(h.context.isTranscriptNearBottom({scrollHeight: 1000, scrollTop: 519, clientHeight: 400}), false);
});

test('user summary disclosure choices survive chunks, completion, durable replacement and refresh', () => {
  for (const open of [false, true]) {
    const h = harness(); let messages = stream(h.context);
    let summary = nodes(h.render(messages)).find(node => node.type === 'details');
    assert.equal(summary.props.open, true);
    const key = summary.props.key;
    summary.props.onToggle({currentTarget: {open}});
    messages = h.context.ingestChatStream(messages, {...base, status: 'response delta', detail: '!'});
    summary = nodes(h.render(messages)).find(node => node.type === 'details'); assert.equal(summary.props.open, open);
    messages = h.context.ingestChatStream(messages, {...base, status: 'agent complete'});
    summary = nodes(h.render(messages)).find(node => node.type === 'details'); assert.equal(summary.props.open, open);
    const liveKey = h.context.identifyChatMessages(messages)[0].transcriptKey;
    const finalHistory = history.map(row => row.role === 'assistant' ? {...row, content: 'Answer!'} : row);
    for (let i = 0; i < 3; i++) {
      messages = h.context.reconcileChatHistory(messages, finalHistory);
      summary = nodes(h.render(messages)).find(node => node.type === 'details');
      assert.equal(summary.props.key, key); assert.equal(summary.props.open, open);
      assert.equal(messages.length, 2); assert.equal(messages[1].transcriptKey, liveKey);
    }
  }
});

test('row identity is independent of inserted rows and summary identity survives partial persistence', () => {
  const {context} = harness();
  const row = {...base, role: 'assistant', time: 'answer-time', content: 'Answer'};
  assert.equal(context.identifyChatMessages([row])[0].transcriptKey, context.identifyChatMessages([{role: 'reasoning', content: 'Earlier'}, row])[1].transcriptKey);
  let messages = stream(context);
  messages = context.ingestChatStream(messages, {...base, status: 'model start'});
  messages = context.ingestChatStream(messages, {...base, status: 'reasoning delta', detail: 'Second checkpoint'});
  const secondKey = messages[0].summaryKeys[1];
  messages = context.reconcileChatHistory(messages, [history[0]]);
  assert.equal(messages.find(row => row.streamKey).summaryKeys[0], secondKey);
  assert.equal(messages.find(row => row.streamKey).summaries[0], 'Second checkpoint');
  messages = context.ingestChatStream(messages, {...base, status: 'model start'});
  messages = context.ingestChatStream(messages, {...base, status: 'reasoning delta', detail: 'Third checkpoint'});
  const keys = messages.find(row => row.streamKey).summaryKeys;
  assert.equal(keys[0], secondKey); assert.notEqual(keys[0], keys[1]);
});

test('durable summary association excludes worker and private records', () => {
  const {context} = harness(); const messages = stream(context);
  const result = context.reconcileChatHistory(messages, [{...history[0], agent_id: 'worker'}, {...history[0], private: true}]);
  assert.equal(result.filter(row => row.private).length, 0);
  assert.equal(result.find(row => row.streamKey).summaries.length, 1);
  assert.equal(result[0].summaryKey, undefined);
});
