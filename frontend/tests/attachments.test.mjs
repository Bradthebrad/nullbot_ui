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

// Same executable TypeScript + lightweight hook/tree approach as projects-models.test.mjs.
const appSource = read('App.tsx');
const ast = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function mountChat(api, busy = false) {
  const slots = []; let cursor = 0; let draft = 'keep my draft'; let status = '';
  const queue = createAttachmentQueue(api);
  const useState = initial => {const i=cursor++; if (!(i in slots)) slots[i]=initial; return [slots[i], value => {slots[i]=typeof value==='function'?value(slots[i]):value;}];};
  const React = {createElement: (type, props, ...children) => ({type, props: props || {}, children: children.flat(Infinity)})};
  const globals = {React, ...helpers, ...routing, useChatLayout: () => ({container:{current:null}, activityWidth:390, composerHeight:250, activityBounds:{min:220,max:700}, composerBounds:{min:150,max:600}, change(){}}), useState, useRef: initial => {const i=cursor++; return slots[i] ??= {current:initial};}, useEffect: () => {},
    useComposerDraft: () => ({input:draft, setInput: value => {draft=value;}}), useAttachments: () => ({attachments:queue.snapshot(), queue}),
    useSkillContext: () => ({paths:['skill/SKILL.md'], matches:[]}), ...api};
  for (const name of ['ResizeHandle','BusySendDialog','MessageList','SkillContextNotice','SkillComposer','AttachmentTray','AlsoDrawer','LiveActivity','Files','Layers','Compass','ListChecks','Archive','PauseIcon','Play','Save','Trash2','Send']) globals[name]=name;
  const context = vm.createContext(globals);
  vm.runInContext(ts.transpile(ast.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(ast)).join('\n'), {target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.React}), context);
  return {queue, draft:()=>draft, status:()=>status, render() {cursor=0; return context.ChatView({active:true, busy, ui:{config:{}}, messages:[], activity:[], suppressNextReplyRef:{current:false}, setStatus:value=>{status=value;}, setMessages:()=>{}, setActivity:()=>{}, setBusy:()=>{}, refreshState:()=>{}});}};
}
function nodes(tree, predicate) {if(!tree || typeof tree!=='object')return []; return [...(predicate(tree)?[tree]:[]), ...(tree.children||[]).flatMap(child=>nodes(child,predicate))];}
const text = tree => typeof tree==='string'?tree:(tree?.children||[]).map(text).join('');
const sendButton = tree => nodes(tree, n=>n.type==='button' && text(n)==='Send')[0];
const composer = tree => nodes(tree,n=>n.type==='SkillComposer')[0];

test('rendered composer Send and Enter guard pending/failed snapshots, preserve draft, send only ready tokens with skills', async () => {
  const pending=deferred(); const outbound=[];
  const view=mountChat({attachFiles:async()=>pending.promise, submitChatRequest:async (...args)=>{outbound.push(args); return {data:{background:true}};}});
  const staleTree=view.render();
  const done=view.queue.stagePaths(['C:\\a.png']);
  assert.equal(sendButton(view.render()).props.disabled,true);
  await sendButton(staleTree).props.onClick(); // snapshot guard, not just disabled DOM
  composer(staleTree).props.onKeyDown({key:'Enter', preventDefault(){}});
  assert.equal(outbound.length,0); assert.equal(view.draft(),'keep my draft');
  pending.resolve([{error:'denied'}]); await done;
  assert.equal(sendButton(view.render()).props.disabled,true);
  await sendButton(view.render()).props.onClick(); assert.match(view.status(),/Remove failed/);
  view.queue.remove(view.queue.snapshot()[0].id);
  await view.queue.stageFiles([]);
  await sendButton(view.render()).props.onClick();
  assert.equal(outbound.length,1); assert.equal(outbound[0][0].text,'keep my draft'); assert.deepEqual(Array.from(outbound[0][0].skills),['skill/SKILL.md']);
  assert.equal(view.draft(),'');
});

test('accepted sends remove only their snapshot; concurrent staging and edited draft survive', async () => {
  const submitted=deferred(); let outbound;
  const view=mountChat({attachFiles:async paths=>[ready(paths[0])], submitChatRequest:async value=>{outbound=value; return submitted.promise;}});
  await view.queue.stagePaths(['one.png']);
  const sending=sendButton(view.render()).props.onClick();
  assert.match(routing.chatWireRequest(outbound).text, /keep my draft\n\n@file\("one.png"\)/);
  composer(view.render()).props.onChange({target:{value:'next draft'}});
  await view.queue.stagePaths(['two.png']);
  submitted.resolve({data:{background:true}}); await sending;
  assert.equal(view.draft(),'next draft'); assert.deepEqual(Array.from(view.queue.snapshot(),item=>item.name),['two.png']);
});

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

test('rejected sends retain draft and ready attachments for retry', async () => {
  const view=mountChat({attachFiles:async paths=>[ready(paths[0])],submitChatRequest:async()=>{throw Error('offline');}});
  await view.queue.stagePaths(['one.png']);
  await sendButton(view.render()).props.onClick();
  assert.equal(view.draft(),'keep my draft');assert.equal(view.queue.snapshot()[0].status,'ready');
  assert.match(view.status(),/offline/);
});

test('Also button directly sends the composer with attachments; no mode toggle', async () => {
  const calls=[];const pending=deferred();
  const view=mountChat({attachFiles:async()=>pending.promise,submitChatRequest:async value=>{calls.push(value);return {message:'ok'};}});
  const done=view.queue.stagePaths(['side.png']);
  const also=()=>nodes(view.render(),n=>n.type==='button' && text(n)==='Also')[0];
  await also().props.onClick();assert.equal(calls.length,0);
  pending.resolve([ready('side.png')]);await done;
  await also().props.onClick();assert.equal(calls.length,1);assert.equal(calls[0].mode,'also');
  assert.ok(routing.chatWireRequest(calls[0]).text.includes('side.png'));
  assert.equal(view.draft(),'');assert.equal(view.queue.snapshot().length,0);
});

test('busy Send and Enter ask for routing, Cancel preserves draft and queue/steer explicitly submit once', async () => {
  for (const mode of ['queue','steer','also']) {
    const calls=[];const pending=deferred();
    const view=mountChat({attachFiles:async paths=>[ready(paths[0])],submitChatRequest:async value=>{calls.push(value);return pending.promise;}},true);
    await view.queue.stagePaths(['ready.png']);
    await sendButton(view.render()).props.onClick();
    let modal=nodes(view.render(),n=>n.type==='BusySendDialog')[0];assert.ok(modal);assert.equal(calls.length,0);
    modal.props.onCancel();assert.equal(nodes(view.render(),n=>n.type==='BusySendDialog').length,0);
    assert.equal(view.draft(),'keep my draft');assert.equal(view.queue.snapshot().length,1);
    composer(view.render()).props.onKeyDown({key:'Enter',preventDefault(){}});
    modal=nodes(view.render(),n=>n.type==='BusySendDialog')[0];assert.ok(modal);
    modal.props.onChoose(mode);modal.props.onChoose(mode);
    assert.equal(calls.length,1);assert.equal(calls[0].mode,mode);
    assert.equal(calls[0].skills[0],'skill/SKILL.md');assert.equal(calls[0].attachments.length,1);
    pending.resolve({data:{background:true}});await tick();
    assert.equal(view.draft(),'');assert.equal(view.queue.snapshot().length,0);
  }
});

test('Shift Enter and IME Enter never submit or open busy dialog', () => {
  const view=mountChat({submitChatRequest:()=>{throw Error('must not submit');}},true);
  composer(view.render()).props.onKeyDown({key:'Enter',shiftKey:true});
  composer(view.render()).props.onKeyDown({key:'Enter',nativeEvent:{isComposing:true}});
  assert.equal(nodes(view.render(),n=>n.type==='BusySendDialog').length,0);
});
