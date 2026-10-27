import {describe, expect, it} from 'vitest';
import {applyActivity, emptyActivity, MAX_STEPS, MAX_TURNS, subagentName, turnToolSteps} from './model';
import type {ActivityRecord} from '../../lib/types';

let seq = 0;
const rec = (record: ActivityRecord): ActivityRecord => ({seq: ++seq, agent_id: 'main', submission_id: 's1', time: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(), ...record});
const apply = (...records: ActivityRecord[]) => applyActivity(emptyActivity, records);

describe('applyActivity', () => {
  it('pairs start and completion by call id, keeping arguments, result and duration', () => {
    const start = rec({status: 'tool start', call_id: 'c1', tool: 'read_file', args: {path: 'a.txt'}});
    const done = rec({status: 'tool complete', call_id: 'c1', tool: 'read_file', result: 'Read 42 bytes', duration_ms: 12});
    const state = apply(start, start, done, done);
    const steps = turnToolSteps(state.turns[0]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({state: 'done', args: {path: 'a.txt'}, result: 'Read 42 bytes', durationMs: 12});
  });

  it('ignores records it has already applied (by seq)', () => {
    const start = rec({status: 'tool start', call_id: 'c1', tool: 'search'});
    const once = apply(start);
    expect(applyActivity(once, [start])).toBe(once);
  });

  it('does not cross-pair same-name tools from different agents', () => {
    const one = rec({status: 'tool start', tool: 'read_file', agent_id: 'one/task-1'});
    const two = rec({status: 'tool start', tool: 'read_file', agent_id: 'two/task-2'});
    const failed = rec({status: 'tool error', tool: 'read_file', agent_id: 'one/task-1', error: 'denied'});
    const steps = turnToolSteps(apply(one, two, failed).turns[0]);
    expect(steps.map(step => [step.agent, step.state])).toEqual([['one/task-1', 'error'], ['two/task-2', 'running']]);
  });

  it('keeps the result of a completion that arrives without its start', () => {
    const [step] = turnToolSteps(apply(rec({status: 'tool complete', tool: 'search_text', result: '3 matches'})).turns[0]);
    expect(step).toMatchObject({state: 'done', result: '3 matches'});
  });

  it('marks permission denials as blocked, with the decision attached', () => {
    const permission = {allowed: false, capability: 'write' as const, source: 'builtin', rule: 'builtin', reason: 'docs is read only', project: 'docs', permission: 'read-only' as const};
    const state = apply(rec({status: 'tool start', call_id: 'w', tool: 'project_write_file'}), rec({status: 'tool error', call_id: 'w', tool: 'project_write_file', error: 'permission denied', permission}));
    expect(turnToolSteps(state.turns[0])[0]).toMatchObject({state: 'blocked', permission: {reason: 'docs is read only'}});
  });

  it('never stores answer text from response deltas or completion records', () => {
    const state = apply(
      rec({status: 'submission running'}),
      rec({status: 'response delta', detail: 'SECRET ANSWER', run_id: 'r'}),
      rec({status: 'agent complete', detail: 'SECRET ANSWER', run_id: 'r'}),
    );
    expect(JSON.stringify(state)).not.toMatch(/SECRET ANSWER/);
  });

  it('shows the turn as writing while the answer streams, and stops when the agent completes', () => {
    let state = apply(rec({status: 'submission running'}), rec({status: 'response delta', detail: 'x'}));
    expect(state.turns[0].writing).toBe(true);
    const unchanged = applyActivity(state, [rec({status: 'response delta', detail: 'y'})]);
    expect(unchanged.turns[0]).toBe(state.turns[0]);
    state = applyActivity(unchanged, [rec({status: 'agent complete'})]);
    expect(state.turns[0].writing).toBe(false);
  });

  it('keeps reasoning chronological between tools and attributes subagent thinking', () => {
    const state = apply(
      rec({status: 'reasoning delta', detail: 'x'}),
      rec({status: 'reasoning delta', detail: 'x'}),
      rec({status: 'tool start', tool: 'read_file', call_id: 't'}),
      rec({status: 'model start'}),
      rec({status: 'reasoning delta', detail: 'next'}),
      rec({status: 'reasoning delta', agent_id: 'researcher/task-7', detail: 'worker thought'}),
    );
    const steps = state.turns[0].steps;
    expect(steps.map(step => step.kind)).toEqual(['thinking', 'tool', 'thinking', 'thinking']);
    expect(steps[0].text).toBe('xx');
    expect(steps[2].text).toBe('next');
    expect(steps[3].agentName).toBe('researcher');
  });

  it('includes every agent with no filtering', () => {
    const state = apply(
      rec({status: 'tool start', tool: 'a', agent_id: 'main'}),
      rec({status: 'tool start', tool: 'b', agent_id: 'worker/task-1'}),
      rec({status: 'tool start', tool: 'c', agent_id: 'primary/task-2'}),
    );
    expect(turnToolSteps(state.turns[0]).map(step => step.tool)).toEqual(['a', 'b', 'c']);
  });

  it('drops private records', () => {
    for (const extra of [{private: true}, {visibility: 'private'}, {channel: 'analysis'}, {kind: 'raw_reasoning'}]) {
      expect(apply(rec({status: 'reasoning delta', detail: 'PRIVATE', ...extra})).turns).toHaveLength(0);
    }
  });

  it('gives side questions their own turn even with identical agent and tool names', () => {
    const state = apply(
      rec({status: 'tool start', tool: 'read_file', agent_id: 'worker/t', submission_id: 'p', lane: 'primary', call_id: 'x'}),
      rec({status: 'tool start', tool: 'read_file', agent_id: 'worker/t', submission_id: 'a', lane: 'also', call_id: 'x'}),
      rec({status: 'tool complete', tool: 'read_file', agent_id: 'worker/t', submission_id: 'a', lane: 'also', call_id: 'x'}),
    );
    expect(state.turns.map(turn => [turn.id, turn.lane, turn.steps[0].state])).toEqual([['p', 'primary', 'running'], ['a', 'also', 'done']]);
  });

  it('finishes running steps when the submission ends', () => {
    const state = apply(rec({status: 'submission running'}), rec({status: 'tool start', tool: 'slow', call_id: 's'}), rec({status: 'submission canceled'}));
    expect(state.turns[0].state).toBe('canceled');
    expect(state.turns[0].steps[0].state).toBe('error');
  });

  it('bounds memory: old turns and steps are dropped', () => {
    const turns: ActivityRecord[] = [];
    for (let i = 0; i < MAX_TURNS + 25; i++) turns.push(rec({status: 'submission running', submission_id: `s${i}`}));
    const state = apply(...turns);
    expect(state.turns).toHaveLength(MAX_TURNS);
    expect(state.turns[0].id).toBe('s25');

    const steps: ActivityRecord[] = [];
    for (let i = 0; i < MAX_STEPS + 50; i++) steps.push(rec({status: 'tool start', tool: `t${i}`, call_id: `c${i}`, submission_id: 'big'}));
    const big = apply(...steps).turns[0];
    expect(big.steps).toHaveLength(MAX_STEPS);
    expect(big.steps.at(-1)!.tool).toBe(`t${MAX_STEPS + 49}`);
  });

  it('caps thinking text', () => {
    const records = Array.from({length: 30}, () => rec({status: 'reasoning delta', detail: 'x'.repeat(1000)}));
    expect(apply(...records).turns[0].steps[0].text!.length).toBeLessThanOrEqual(20_000);
  });
});

describe('subagentName', () => {
  it('treats main, primary and also lanes as the manager', () => {
    expect(subagentName('main')).toBeUndefined();
    expect(subagentName('primary/task-1')).toBeUndefined();
    expect(subagentName('researcher/task-7')).toBe('researcher');
  });
});
