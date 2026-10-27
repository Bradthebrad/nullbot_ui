// Context measurements and compaction, as the activity panel and the chat
// show them.
import {describe, expect, it} from 'vitest';
import {applyActivity, contextNote, emptyActivity} from './model';
import {describeStep} from './describe';
import {latestContext} from '../chat/ContextMeter';
import {compactionSummary} from '../chat/Transcript';
import {formatTokens} from '../../lib/format';
import type {ActivityRecord} from '../../lib/types';

let seq = 0;
const rec = (record: ActivityRecord): ActivityRecord => ({seq: ++seq, agent_id: 'main', submission_id: 's1', time: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(), ...record});

describe('context in activity', () => {
  it('says what each compaction pass did, with sizes', () => {
    const state = applyActivity(emptyActivity, [
      rec({status: 'context shortened', context: {shortened: 6, before_tokens: 142300, after_tokens: 81000, context_window: 200000}}),
      rec({status: 'context compact complete', context: {summarized: 24, before_tokens: 172000, after_tokens: 38000, context_window: 200000}}),
    ]);
    expect(state.turns[0].steps.map(step => describeStep(step).title)).toEqual([
      'Shortened 6 earlier tool results to make room: 142k → 81k of 200k tokens.',
      'Summarized 24 earlier messages to make room: 172k → 38k of 200k tokens.',
    ]);
    expect(contextNote('context shortened', {shortened: 1})).toBe('Shortened 1 earlier tool result to make room.');
  });

  it('keeps the manager’s latest measurement on the turn, not a subagent’s', () => {
    const state = applyActivity(emptyActivity, [
      rec({status: 'model start', context: {context_tokens: 40000, context_window: 200000, shorten_at: 120000, summarize_at: 170000}}),
      rec({status: 'model start', agent_id: 'researcher/task-1', context: {context_tokens: 90000, context_window: 128000}}),
    ]);
    expect(state.turns[0].context).toEqual({tokens: 40000, window: 200000, shortenAt: 120000, summarizeAt: 170000});
    expect(latestContext(state.turns)).toEqual(state.turns[0].context);
  });

  it('marks a tool result the guard cut to fit', () => {
    const state = applyActivity(emptyActivity, [
      rec({status: 'tool start', call_id: 'r', tool: 'read_file', args: {path: 'big.log'}}),
      rec({status: 'tool complete', call_id: 'r', tool: 'read_file', result: 'line 1…', context: {full_tokens: 61000, full_chars: 244113, shown_chars: 12000, free_tokens: 23000, context_window: 200000}}),
    ]);
    const step = state.turns[0].steps[0];
    expect(step.guard?.full_tokens).toBe(61000);
    expect(describeStep(step).detail).toBe('Cut to fit: about 61k tokens, too large for the room left');
  });
});

describe('formatTokens', () => {
  it('reads like people write token counts', () => {
    expect([950, 1500, 12400, 200000, 1047576].map(formatTokens)).toEqual(['950', '1.5k', '12k', '200k', '1.05M']);
  });
});

describe('compaction in the transcript', () => {
  it('shows the summary without the sentence addressed to the model', () => {
    expect(compactionSummary('Summary of earlier work in this conversation. Treat it as an accurate record of the messages and tool results it replaces.\n\n- Migrated 14 tables')).toBe('- Migrated 14 tables');
  });
});
