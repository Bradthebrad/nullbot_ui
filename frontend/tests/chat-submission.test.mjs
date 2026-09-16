import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const read=name=>fs.readFileSync(new URL(`../src/${name}`,import.meta.url),'utf8');
function load(name,globals={}) {const exports={};vm.runInNewContext(ts.transpile(read(name),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}),{exports,...globals});return exports;}

test('typed routing adapts tokens and skill paths without leaking client attachment metadata',async()=>{
  let captured;let reply={data:{submission_status:'queued',background:true}};
  const api=load('chatSubmission.ts',{crypto:{randomUUID:()=> 'request-1'},window:{go:{main:{App:{SubmitChatRequest:async request=>{captured=request;return reply;}}}}}});
  const request=api.makeChatRequest('steer','guidance',[{token:'@file("staged.png")',path:'private-path',preview_url:'private-bytes'}],['a/SKILL.md'],'primary-1');
  await api.submitChatRequest(request);
  assert.equal(captured.text,'guidance\n\n@file("staged.png")');assert.equal(captured.skill_paths[0],'a/SKILL.md');
  assert.equal(captured.target_job_id,'primary-1');assert.equal(captured.request_id,'request-1');
  assert.doesNotMatch(JSON.stringify(captured),/private-path|private-bytes|attachments/);
  for(const data of [{accepted:false},{submission_status:'rejected'},{submission:{status:'rejected'}}]) {reply={message:'not accepted',data};await assert.rejects(api.submitChatRequest(request),/not accepted/);}
});

test('resize bounds clamp nonfinite, saved oversize and undersize inputs',()=>{
  const api=load('ChatLayout.tsx',{require:()=>({})});
  assert.equal(api.clampSize(900,220,500),500);assert.equal(api.clampSize(-100,220,500),220);
  assert.equal(api.clampSize(NaN,220,500),220);
  const panel=api.resizeBounds('activity',900,700);assert.equal(panel.max,540);
  const composer=api.resizeBounds('composer',900,320);assert.equal(composer.max,180);
  const source=read('ChatLayout.tsx');
  assert.match(source,/localStorage.setItem/);assert.match(source,/ResizeObserver/);assert.match(source,/onPointerCancel/);
});

test('separator keyboard and captured pointer resize are accessible and cancel cleanly',()=>{
  const changes=[];const api=load('ChatLayout.tsx',{React:{createElement:(type,props,...children)=>({type,props,children})},require:()=>({useRef:initial=>({current:initial})})});
  const handle=api.ResizeHandle({axis:'activity',value:390,min:220,max:700,onChange:value=>changes.push(value)});
  assert.equal(handle.props.role,'separator');assert.equal(handle.props.tabIndex,0);assert.equal(handle.props['aria-orientation'],'vertical');
  for(const key of ['ArrowLeft','ArrowRight','Home','End']) handle.props.onKeyDown({key,preventDefault(){}});
  assert.deepEqual(changes,[400,380,220,700]);
  let captured;handle.props.onPointerDown({button:0,pointerId:1,clientX:600,preventDefault(){},currentTarget:{focus(){},setPointerCapture:id=>captured=id}});
  handle.props.onPointerMove({pointerId:1,clientX:500});assert.equal(changes.at(-1),490);assert.equal(captured,1);
  handle.props.onPointerCancel();handle.props.onPointerMove({pointerId:1,clientX:400});assert.equal(changes.at(-1),490);
});

test('busy dialog focuses Cancel, restores composer focus, and exposes all explicit routes',()=>{
  const effects=[];let shown=0,focused=0,restored=0,canceled=0;const modes=[];
  const api=load('BusySendDialog.tsx',{React:{createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)})},document:{activeElement:{isConnected:true,focus(){restored++;}}},require:()=>({useRef:initial=>({current:initial}),useEffect:effect=>effects.push(effect)})});
  const tree=api.default({onChoose:mode=>modes.push(mode),onCancel:()=>canceled++});
  function nodes(node){return !node||typeof node!=='object'?[]:[node,...node.children.flatMap(nodes)];}
  const buttons=nodes(tree).filter(node=>node.type==='button');
  tree.props.ref.current={showModal(){shown++;},close(){}};buttons.at(-1).props.ref.current={focus(){focused++;}};
  const cleanup=effects[0]();assert.equal(shown,1);assert.equal(focused,1);
  for(const button of buttons.slice(0,3))button.props.onClick();assert.deepEqual(modes,['also','queue','steer']);
  tree.props.onCancel({preventDefault(){}});assert.equal(canceled,1);cleanup();assert.equal(restored,1);
});

const source=read('App.tsx');const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const context=vm.createContext({});vm.runInContext(ts.transpile(ast.statements.filter(ts.isFunctionDeclaration).map(node=>node.getText(ast)).join('\n'),{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}),context);
test('commentary, tool-round public text and summaries survive repeated final history reconciliation',()=>{
  const base={agent_id:'main',run_id:'r',submission_id:'p'};let messages=[];
  for(const [status,detail] of [['model start',''],['response delta','I will inspect the code.'],['reasoning delta','Public summary'],['model start',''],['commentary delta','Progress update.'],['response delta','Final answer'],['agent complete','']]) messages=context.ingestChatStream(messages,{...base,status,detail});
  const history=[{role:'assistant',run_id:'r',time:'final',content:'Final answer'}];
  for(let i=0;i<3;i++)messages=context.reconcileChatHistory(messages,history);
  assert.equal(messages.length,2);assert.equal(messages.filter(message=>message.content==='Final answer').length,1);
  assert.deepEqual(Array.from(messages[0].commentary),['I will inspect the code.','Progress update.']);assert.equal(messages[0].summaries[0],'Public summary');
  const next=[...history,{role:'assistant',time:'second',content:'Second answer'}];messages=context.reconcileChatHistory(messages,next);
  assert.equal(messages[0].finalTime,'final');assert.equal(messages[2].content,'Second answer');
});

test('private records never enter public transcript or activity and Also streams stay out of primary',()=>{
  const base={agent_id:'main',run_id:'r',status:'reasoning delta',detail:'PRIVATE'};
  for(const extra of [{private:true},{visibility:'private'},{channel:'analysis'},{kind:'raw_reasoning'}]) {
    assert.equal(context.ingestChatStream([],{...base,...extra}).length,0);assert.equal(context.mergeActivityRecords([],[{...base,...extra}],true).length,0);
  }
  assert.equal(context.ingestChatStream([],{...base,lane:'also'}).length,0);
});

test('durable public history replaces transient copies and explicit session changes bypass retention',()=>{
  const base={agent_id:'main',run_id:'r',submission_id:'p'};let messages=[];
  for(const [status,detail] of [['reasoning delta','Public summary'],['commentary','Inspecting'],['response delta','Final'],['agent complete','']]) messages=context.ingestChatStream(messages,{...base,status,detail});
  const history=[{role:'reasoning',content:'Public summary',submission_id:'p'},{role:'commentary',content:'Inspecting',submission_id:'p'},{role:'assistant',content:'Final',time:'final'}];
  messages=context.reconcileChatHistory(messages,history);assert.equal(messages.length,3);
  messages=context.reconcileChatHistory(messages,history);assert.equal(messages.length,3);
  assert.match(source,/if \(reply.data\?\.history_replace\)/);
  assert.match(source,/setMessages\(\(\) => reply.history \|\| \[\]\)/);
});

test('Also correlation keeps client and job IDs distinct, and rejection rolls back only its own optimistic entries',()=>{
  assert.match(source,/job.request_id === item.requestID \|\| job.id === item.jobID/);
  assert.match(source,/reply.data.request_id === item.requestID/);
  assert.match(source,/reply.data.submission_id === item.jobID/);
  assert.match(source,/optimisticRequestID: request.request_id/);
  assert.match(source,/current.filter\(\(message\) => message.optimisticRequestID !== request.request_id\)/);
  assert.match(source,/reply.data\?\.background \? item.status : 'done'/);
  assert.match(source,/await removeQueuedChat\(job.id\)/);
});

test('Also lane has an independent identity even with identical agent/run/tool names',()=>{
  const base={agent_id:'worker',run_id:'r',name:'read_file',status:'tool start'};
  const items=context.buildActivityTimeline([{...base,submission_id:'p',lane:'primary'},{...base,submission_id:'a',lane:'also'},{...base,submission_id:'a',lane:'also',status:'tool complete'}]);
  assert.equal(items.length,2);assert.equal(items[0].state,'running');assert.equal(items[1].state,'complete');assert.equal(items[1].also,true);
  const summaries=context.buildActivityTimeline([{...base,status:'reasoning delta',lane:'primary',detail:'main'},{...base,status:'reasoning delta',lane:'also',detail:'side'}]);
  assert.equal(summaries.length,2);
});
