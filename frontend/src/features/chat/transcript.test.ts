// Streaming and history reconciliation for the conversation.
import {describe, expect, it} from 'vitest';
import {identifyChatMessages, ingestChatStream, isTranscriptNearBottom, reconcileChatHistory} from './transcript';

const base = {agent_id: 'main', run_id: 'run', submission_id: 'submission'};
function stream(steps: [string, string][], extra = {}) {
  let messages: any[] = [];
  for (const [status, detail] of steps) messages = ingestChatStream(messages, {...base, ...extra, status, detail});
  return messages;
}

describe('ingestChatStream', () => {
  it('streams every delta and keeps trailing whitespace', () => {
    let messages: any[] = [];
    for (let i = 0; i < 650; i++) messages = ingestChatStream(messages, {...base, status: 'response delta', detail: 'x'});
    expect(messages[0].content).toHaveLength(650);
    messages = ingestChatStream(messages, {...base, status: 'response delta', detail: ' \n'});
    expect(messages[0].content.endsWith(' \n')).toBe(true);
  });

  it('ignores subagents, private records and side questions', () => {
    const delta = {...base, status: 'reasoning delta', detail: 'PRIVATE'};
    expect(ingestChatStream([], {...delta, agent_id: 'worker'})).toHaveLength(0);
    for (const extra of [{private: true}, {visibility: 'private'}, {channel: 'analysis'}, {kind: 'raw_reasoning'}, {lane: 'also'}]) {
      expect(ingestChatStream([], {...delta, ...extra})).toHaveLength(0);
    }
  });
});

describe('commentary from a model that runs its own tools', () => {
  it('moves streamed text that turned out to be commentary instead of repeating it', () => {
    const messages = stream([['response delta', 'Let me look.'], ['commentary', 'Let me look.'], ['model start', ''], ['response delta', 'It is a Go package.'], ['agent complete', '']]);
    expect(messages).toHaveLength(1);
    expect(messages[0].commentary).toEqual(['Let me look.']);
    expect(messages[0].content).toBe('It is a Go package.');
  });

  it('keeps both when the commentary differs from what streamed', () => {
    const messages = stream([['response delta', 'Answer so far'], ['commentary', 'Something else']]);
    expect(messages[0].commentary).toEqual(['Something else']);
    expect(messages[0].content).toBe('Answer so far');
  });
});

describe('reconcileChatHistory', () => {
  it('replaces a streamed answer with the durable one exactly once', () => {
    let messages = stream([['response delta', 'x'], ['reasoning delta', 'Summary'], ['agent complete', '']]);
    const history = [{role: 'assistant', content: 'Final answer', time: 'final'}];
    messages = reconcileChatHistory(messages, history);
    messages = reconcileChatHistory(messages, history);
    expect(messages.filter(m => m.content === 'Final answer')).toHaveLength(1);
    expect(messages).toHaveLength(2);
    expect(messages[0].summaries[0]).toBe('Summary');
  });

  it('keeps a failed partial answer through refreshes', () => {
    let messages = stream([['response delta', 'Partial'], ['model error', '']]);
    messages = reconcileChatHistory(messages, [{role: 'assistant', content: 'Error'}]);
    messages = reconcileChatHistory(messages, []);
    const partial = messages.find(m => m.streamKey);
    expect(partial).toMatchObject({content: 'Partial', streamState: 'incomplete'});
    expect(messages.filter(m => m.content === 'Error')).toHaveLength(1);
  });

  it('keeps commentary, tool-round text and summaries through repeated reconciliation', () => {
    let messages = stream([['model start', ''], ['response delta', 'I will inspect the code.'], ['reasoning delta', 'Public summary'], ['model start', ''], ['commentary delta', 'Progress update.'], ['response delta', 'Final answer'], ['agent complete', '']], {run_id: 'r', submission_id: 'p'});
    const history = [{role: 'assistant', run_id: 'r', time: 'final', content: 'Final answer'}];
    for (let i = 0; i < 3; i++) messages = reconcileChatHistory(messages, history);
    expect(messages).toHaveLength(2);
    expect(messages[0].commentary).toEqual(['I will inspect the code.', 'Progress update.']);
    expect(messages[0].summaries[0]).toBe('Public summary');
    messages = reconcileChatHistory(messages, [...history, {role: 'assistant', time: 'second', content: 'Second answer'}]);
    expect(messages[0].finalTime).toBe('final');
    expect(messages[2].content).toBe('Second answer');
  });

  it('lets durable public history replace transient copies', () => {
    let messages = stream([['reasoning delta', 'Public summary'], ['commentary', 'Inspecting'], ['response delta', 'Final'], ['agent complete', '']], {run_id: 'r', submission_id: 'p'});
    const history = [{role: 'reasoning', content: 'Public summary', submission_id: 'p'}, {role: 'commentary', content: 'Inspecting', submission_id: 'p'}, {role: 'assistant', content: 'Final', time: 'final'}];
    messages = reconcileChatHistory(messages, history);
    expect(messages).toHaveLength(3);
    expect(reconcileChatHistory(messages, history)).toHaveLength(3);
  });

  it('keeps row and summary identity stable as rows are inserted and persisted', () => {
    const row = {...base, role: 'assistant', time: 'answer-time', content: 'Answer'};
    expect(identifyChatMessages([row])[0].transcriptKey).toBe(identifyChatMessages([{role: 'reasoning', content: 'Earlier'}, row])[1].transcriptKey);
    let messages = stream([['reasoning delta', 'Public checkpoint'], ['response delta', 'Answer'], ['model start', ''], ['reasoning delta', 'Second checkpoint']]);
    const secondKey = messages[0].summaryKeys[1];
    messages = reconcileChatHistory(messages, [{...base, role: 'reasoning', content: 'Public checkpoint', time: 'summary-time'}]);
    const live = messages.find(m => m.streamKey);
    expect(live.summaryKeys[0]).toBe(secondKey);
    expect(live.summaries[0]).toBe('Second checkpoint');
  });

  it('excludes worker and private records from durable summaries', () => {
    const messages = stream([['reasoning delta', 'Public checkpoint'], ['response delta', 'Answer']]);
    const summary = {...base, role: 'reasoning', content: 'Public checkpoint', time: 'summary-time'};
    const result = reconcileChatHistory(messages, [{...summary, agent_id: 'worker'}, {...summary, private: true}]);
    expect(result.filter(row => row.private)).toHaveLength(0);
    expect(result.find(row => row.streamKey).summaries).toHaveLength(1);
  });
});

describe('isTranscriptNearBottom', () => {
  it('follows only within 80px of the end', () => {
    expect(isTranscriptNearBottom({scrollHeight: 1000, scrollTop: 520, clientHeight: 400})).toBe(true);
    expect(isTranscriptNearBottom({scrollHeight: 1000, scrollTop: 519, clientHeight: 400})).toBe(false);
  });
});
