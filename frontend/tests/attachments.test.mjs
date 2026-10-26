import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = name => fs.readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
function load(name, extras = {}) {
  const exports = {};
  const context = vm.createContext({exports, Uint8Array, Error, btoa, ...extras});
  vm.runInContext(ts.transpile(read(name), {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React}), context);
  return exports;
}
const helpers = load('attachments.ts');
const routing = load('chatSubmission.ts', {crypto: {randomUUID: () => 'test-request'}});
const {parseClipboardPaths, handleAttachmentPaste, fileBase64, createAttachmentQueue, attachmentSendBlock, safeRasterPreview, MAX_ATTACHMENT_BYTES} = helpers;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise, resolve, reject}; };
const ready = name => ({name, token: `@file("${name}")`});

test('ordinary text, mixed prose and ambiguous unquoted spaces are never intercepted', () => {
  for (const text of ['hello world', 'please inspect C:\\work\\a.png', 'C:\\work\\a.png please', 'C:\\My Files\\a.png', '"C:\\a.png" trailing prose', '"C:\\a.png', 'https://example.com/a.png', '/help', 'C:\\a.png\nthis is a note']) {
    assert.equal(parseClipboardPaths(text), null, text);
    let called = false;
    assert.equal(handleAttachmentPaste({clipboardData: {files: [], getData: () => text}, preventDefault: () => {called=true;}}, () => {called=true;}, () => {called=true;}), false);
    assert.equal(called, false, text);
  }
});

test('complete quoted multi-path lists retain Windows spaces, UNC and line boundaries', () => {
  assert.deepEqual(Array.from(parseClipboardPaths('"C:\\My Files\\a one.png" "D:\\Other Files\\b two.txt"')), ['C:\\My Files\\a one.png', 'D:\\Other Files\\b two.txt']);
  assert.deepEqual(Array.from(parseClipboardPaths("'C:\\My Files\\a.png'\r\n\\\\server\\share\\b.txt")), ['C:\\My Files\\a.png', '\\\\server\\share\\b.txt']);
  const calls = [];
  handleAttachmentPaste({clipboardData: {files: [], getData: () => '"C:\\a b.png"'}, preventDefault: () => calls.push('prevent')}, () => calls.push('files'), paths => calls.push(...paths));
  assert.deepEqual(calls, ['prevent', 'C:\\a b.png']);
});

test('clipboard File objects and screenshot items win over text, synchronously prevent once', () => {
  const file = {name: 'image.png'};
  for (const data of [{files: [file]}, {files: [], items: [{kind: 'file', getAsFile: () => file}]}]) {
    const calls = [];
    data.getData = () => {throw Error('must not read competing text');};
    const result = handleAttachmentPaste({clipboardData: data, preventDefault: () => calls.push('prevent')}, files => {calls.push(files[0]);}, () => {throw Error('must not resolve paths');});
    assert.equal(result, true); assert.deepEqual(calls, ['prevent', file]);
  }
});

test('file byte limit is checked before reading; binary conversion and changed size checks execute', async () => {
  let reads = 0;
  await assert.rejects(fileBase64({size: MAX_ATTACHMENT_BYTES + 1, arrayBuffer: () => {reads++;}}), /20 MiB/);
  assert.equal(reads, 0);
  assert.equal(await fileBase64({size: 4, arrayBuffer: async () => Uint8Array.from([0, 255, 128, 65]).buffer}), 'AP+AQQ==');
  assert.equal(await fileBase64({size: MAX_ATTACHMENT_BYTES, arrayBuffer: async () => new ArrayBuffer(MAX_ATTACHMENT_BYTES)}).then(value => value.length), Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4);
  await assert.rejects(fileBase64({size: 2, arrayBuffer: async () => new ArrayBuffer(3)}), /size changed/);
});

test('staging is synchronous, per-item failures are visible, no Submit occurs, and removal cannot resurrect', async () => {
  const pending = deferred(); let calls = 0;
  const queue = createAttachmentQueue({attachFiles: async paths => {calls++; return paths[0] === 'first' ? pending.promise : [{error: 'permission denied'}];}, attachBytes: () => {throw Error('wrong ingestion');}});
  const done = queue.stagePaths(['first', 'second']);
  const [first, second] = queue.snapshot();
  assert.equal(first.status, 'preparing'); assert.notEqual(first.id, second.id);
  assert.match(attachmentSendBlock(queue.snapshot()), /Wait/);
  await tick(); queue.remove(first.id); pending.resolve([ready('first')]); await done;
  assert.equal(calls, 2); assert.equal(queue.snapshot().length, 1);
  assert.equal(queue.snapshot()[0].id, second.id); assert.equal(queue.snapshot()[0].status, 'failed');
  assert.match(queue.snapshot()[0].error, /permission denied/);
  assert.match(attachmentSendBlock(queue.snapshot()), /Remove failed/);
  queue.remove(second.id); assert.equal(attachmentSendBlock(queue.snapshot()), '');
});

test('byte read races skip removed ingestion; bridge rejection and missing tokens fail independently', async () => {
  const read = deferred(); let sent = 0;
  const queue = createAttachmentQueue({attachFiles: async () => [{}], attachBytes: async () => {sent++; throw Error('disk full');}});
  const first = queue.stageFiles([{name:'same.png', size:1, arrayBuffer: () => read.promise}]);
  await tick(); queue.remove(queue.snapshot()[0].id); read.resolve(new ArrayBuffer(1)); await first;
  assert.equal(sent, 0); assert.equal(queue.snapshot().length, 0);
  await queue.stageFiles([{name:'same.png', size:1, arrayBuffer: async () => new ArrayBuffer(1)}]);
  assert.match(queue.snapshot()[0].error, /disk full/);
  await queue.stagePaths(['same.png']);
  assert.equal(queue.snapshot().length, 2); assert.match(queue.snapshot()[1].error, /no token/);
});

test('safe preview allowlist rejects active/remote formats and queue sanitizes results', async () => {
  for (const url of ['https://host/image.png', 'file:///a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,AAAA', 'data:image/png;base64,AAA\nA']) assert.equal(safeRasterPreview(url), undefined);
  const url = 'data:image/png;base64,AAAA'; assert.equal(safeRasterPreview(url), url);
  const queue = createAttachmentQueue({attachFiles: async () => [{...ready('a'), preview_url: 'https://host/image.png'}]});
  await queue.stagePaths(['a']); assert.equal(queue.snapshot()[0].preview_url, undefined);
});

function nodes(tree, predicate) {if(!tree || typeof tree!=='object')return []; return [...(predicate(tree)?[tree]:[]), ...(tree.children||[]).flatMap(child=>nodes(child,predicate))];}
// Composer send behavior (guards, partial clears, busy routing) is covered by
// src/features/chat/Composer.test.tsx (vitest + Testing Library).

test('attachment preview renders safe thumbnail button, modal cancel and focus restoration', () => {
  let cursor=0; const slots=[]; const effects=[]; let focused=0, restored=0, shown=0, closed=0, cancelled=0;
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)})};
  const hooks={useState:initial=>{const i=cursor++; if(!(i in slots))slots[i]=initial;return [slots[i],v=>{slots[i]=v;}];},useRef:initial=>{const i=cursor++;return slots[i]??={current:initial};},useEffect:effect=>effects.push(effect)};
  const module=load('AttachmentTray.tsx',{React,document:{activeElement:{isConnected:true,focus(){restored++;}}},require:name=>name==='react'?hooks:name==='./attachments'?helpers:{}});
  const item={id:'a',name:'screen.png',status:'ready',preview_url:'data:image/png;base64,AAAA'};
  const render=()=>{cursor=0;return module.default({attachments:[item]});};
  let tree=render(); const button=nodes(tree,n=>n.props['aria-label']==='Preview screen.png')[0]; assert.ok(button);
  button.props.onClick(); tree=render(); assert.ok(nodes(tree,n=>n.type===module.AttachmentPreview).length);
  cursor=0; slots.length=0; effects.length=0;
  tree=module.AttachmentPreview({attachment:item,onClose:()=>{cancelled++;}});
  tree.props.ref.current={showModal(){shown++;},close(){closed++;}};
  nodes(tree,n=>n.type==='button')[0].props.ref.current={focus(){focused++;}};
  const cleanup=effects[0](); assert.equal(shown,1); assert.equal(focused,1);
  tree.props.onCancel({preventDefault(){}}); assert.equal(cancelled,1);
  cleanup(); assert.equal(closed,1); assert.equal(restored,1);
  assert.equal(tree.props['aria-modal'],'true');
});


test('clipboard bytes reach AttachBytes without resolving paths and duplicate filenames remain distinct', async () => {
  const calls=[];
  const queue=createAttachmentQueue({attachFiles:()=>{throw Error('clipboard must not resolve paths');},attachBytes:async(name,data)=>{calls.push([name,data]);return ready(name);}});
  const file={name:'screen.png',size:3,arrayBuffer:async()=>Uint8Array.from([1,2,3]).buffer};
  await queue.stageFiles([file,file]);
  assert.deepEqual(calls,[['screen.png','AQID'],['screen.png','AQID']]);
  assert.equal(queue.snapshot().length,2);assert.notEqual(queue.snapshot()[0].id,queue.snapshot()[1].id);
  assert.equal(attachmentSendBlock(queue.snapshot()),'');
});
