// Folds activity records into turns (one per chat submission) made of steps
// (tool calls, thinking rounds, notes). Updates are copy-on-write so React can
// skip unchanged turns and steps.
import type {ActivityRecord, PermissionDecision} from '../../lib/types';

export type StepState = 'running' | 'done' | 'error' | 'blocked';
export type StepKind = 'tool' | 'thinking' | 'note' | 'error';

export type Step = {
  key: string;
  kind: StepKind;
  state: StepState;
  seq: number;
  agent: string;
  agentName?: string;
  taskId?: string;
  runId?: string;
  tool?: string;
  server?: string;
  serverTitle?: string;
  title?: string;
  source?: string;
  readOnly?: boolean;
  destructive?: boolean;
  args?: Record<string, unknown>;
  result?: string;
  resultMeta?: Record<string, unknown>;
  error?: string;
  permission?: PermissionDecision;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  text?: string;
};

export type TurnState = 'running' | 'done' | 'error' | 'canceled';

export type Turn = {
  id: string;
  lane: string;
  state: TurnState;
  startedAt?: string;
  endedAt?: string;
  steps: Step[];
  writing: boolean;
};

export type ActivityState = {turns: Turn[]; maxSeq: number};

export const emptyActivity: ActivityState = {turns: [], maxSeq: 0};

export const MAX_TURNS = 40;
export const MAX_STEPS = 300;
const MAX_THINKING = 20_000;

const statusAliases: Record<string, string> = {
  on_llm_new_token: 'response delta',
  on_llm_reasoning: 'reasoning delta',
  on_llm_commentary: 'commentary',
  on_llm_end: 'agent complete',
  on_llm_error: 'model error',
  on_chat_model_start: 'model start',
};

export function recordStatus(record: ActivityRecord): string {
  return record.status || statusAliases[record.kind || ''] || '';
}

export function isPublicRecord(record: {private?: boolean; visibility?: string; channel?: string; kind?: string}): boolean {
  return record.private !== true && record.visibility !== 'private' && record.channel !== 'analysis' && !/private|raw_reasoning|chain_of_thought/i.test(String(record.kind || ''));
}

export function isAlsoLane(record: {lane?: string; agent_id?: string}): boolean {
  return record.lane === 'also' || /^(also|observer)(?:$|[-:/])/i.test(String(record.agent_id || ''));
}

function agentOf(record: ActivityRecord): string {
  return String(record.agent_id || record.task_id || 'main');
}

/** Subagent ids look like "researcher/task-0007"; the manager is "main" or "primary/…". */
export function subagentName(agent: string): string | undefined {
  if (!agent || agent === 'main' || /^(primary|also)\//.test(agent)) return undefined;
  const [name] = agent.split('/');
  return name || undefined;
}

function toolName(record: ActivityRecord): string {
  if (record.tool) return record.tool;
  const name = String(record.name || '');
  // Older records prefix subagent tool names with "agent/".
  return name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
}

function parseLegacyArgs(detail?: string): Record<string, unknown> | undefined {
  const match = /^args:\s*(.*)$/s.exec(String(detail || '').trim());
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1]);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function legacyResult(detail?: string): string | undefined {
  const text = String(detail || '').trim();
  if (!text || text === 'Tool call complete.') return undefined;
  return text.replace(/^result:\s*/, '').replace(/^error:\s*/, '');
}

function durationBetween(start?: string, end?: string): number | undefined {
  const a = Date.parse(start || '');
  const b = Date.parse(end || '');
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : undefined;
}

/** Applies a batch of records. Returns the same object when nothing changed. */
export function applyActivity(state: ActivityState, records: ActivityRecord[]): ActivityState {
  let turns = state.turns;
  let maxSeq = state.maxSeq;
  let changed = false;
  const copiedTurns = new Set<string>();
  const copiedSteps = new Set<Step>();

  const indexOf = (id: string) => {
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i].id === id) return i;
    return -1;
  };

  function peek(record: ActivityRecord): Turn | undefined {
    const index = indexOf(record.submission_id || 'session');
    return index >= 0 ? turns[index] : undefined;
  }

  function turnFor(record: ActivityRecord, create: boolean): Turn | undefined {
    const id = record.submission_id || 'session';
    let index = indexOf(id);
    if (index < 0) {
      if (!create) return undefined;
      const turn: Turn = {id, lane: isAlsoLane(record) ? 'also' : 'primary', state: 'running', startedAt: record.time, steps: [], writing: false};
      turns = [...turns, turn];
      if (turns.length > MAX_TURNS) turns = turns.slice(turns.length - MAX_TURNS);
      copiedTurns.add(id);
      changed = true;
      return turn;
    }
    if (!copiedTurns.has(id)) {
      const copy = {...turns[index], steps: turns[index].steps.slice()};
      turns = turns.slice();
      turns[index] = copy;
      copiedTurns.add(id);
    }
    changed = true;
    return turns[index];
  }

  function editStep(turn: Turn, index: number): Step {
    const step = turn.steps[index];
    if (copiedSteps.has(step)) return step;
    const copy = {...step};
    turn.steps[index] = copy;
    copiedSteps.add(copy);
    return copy;
  }

  function addStep(turn: Turn, step: Step) {
    turn.steps.push(step);
    copiedSteps.add(step);
    if (turn.steps.length > MAX_STEPS) turn.steps.splice(0, turn.steps.length - MAX_STEPS);
  }

  function findStep(turn: Turn, match: (step: Step) => boolean): number {
    for (let i = turn.steps.length - 1; i >= 0; i--) if (match(turn.steps[i])) return i;
    return -1;
  }

  function finishThinking(turn: Turn, agent: string, time?: string) {
    for (let i = 0; i < turn.steps.length; i++) {
      const s = turn.steps[i];
      if (s.kind === 'thinking' && s.state === 'running' && s.agent === agent) {
        const step = editStep(turn, i);
        step.state = 'done';
        step.endedAt = time;
      }
    }
  }

  for (const record of records) {
    if (!record || !isPublicRecord(record)) continue;
    if (typeof record.seq === 'number' && record.seq > 0) {
      if (record.seq <= maxSeq) continue;
      maxSeq = record.seq;
    }
    const status = recordStatus(record);
    const agent = agentOf(record);
    const seq = record.seq || 0;

    switch (status) {
      case 'submission running': {
        const turn = turnFor(record, true)!;
        turn.state = 'running';
        turn.startedAt = turn.startedAt || record.time;
        turn.lane = isAlsoLane(record) ? 'also' : turn.lane;
        break;
      }
      case 'submission done':
      case 'submission error':
      case 'submission canceled': {
        const turn = turnFor(record, false);
        if (!turn) break;
        turn.state = status === 'submission done' ? 'done' : status === 'submission error' ? 'error' : 'canceled';
        turn.endedAt = record.time;
        turn.writing = false;
        for (let i = 0; i < turn.steps.length; i++) {
          if (turn.steps[i].state === 'running') {
            const step = editStep(turn, i);
            step.state = turn.state === 'done' ? 'done' : 'error';
            step.endedAt = record.time;
          }
        }
        break;
      }
      case 'tool start': {
        const turn = turnFor(record, true)!;
        const callId = record.call_id || record.run_id || `seq-${seq}`;
        const key = `${agent}:${callId}`;
        if (findStep(turn, s => s.key === key) >= 0) break; // duplicate delivery
        addStep(turn, {
          key, kind: 'tool', state: 'running', seq, agent, agentName: subagentName(agent), taskId: record.task_id, runId: record.run_id,
          tool: toolName(record), server: record.server, serverTitle: record.server_title, title: record.title, source: record.source,
          readOnly: record.read_only, destructive: record.destructive,
          args: record.args || parseLegacyArgs(record.detail), startedAt: record.time,
        });
        break;
      }
      case 'tool complete':
      case 'tool error': {
        const turn = turnFor(record, true)!;
        const callId = record.call_id || record.run_id;
        const tool = toolName(record);
        let index = callId ? findStep(turn, s => s.key === `${agent}:${callId}`) : -1;
        if (index < 0 && !callId) index = findStep(turn, s => s.kind === 'tool' && s.state === 'running' && s.agent === agent && s.tool === tool);
        if (index < 0) {
          addStep(turn, {key: `${agent}:${callId || `seq-${seq}`}`, kind: 'tool', state: 'running', seq, agent, agentName: subagentName(agent), taskId: record.task_id, tool, args: record.args, startedAt: record.time});
          index = turn.steps.length - 1;
        }
        const step = editStep(turn, index);
        const denied = record.permission && record.permission.allowed === false;
        step.state = status === 'tool complete' ? 'done' : denied ? 'blocked' : 'error';
        step.endedAt = record.time;
        step.durationMs = record.duration_ms ?? durationBetween(step.startedAt, record.time);
        step.server = step.server || record.server;
        step.serverTitle = step.serverTitle || record.server_title;
        step.title = step.title || record.title;
        step.readOnly = step.readOnly ?? record.read_only;
        step.destructive = step.destructive ?? record.destructive;
        if (!step.args && record.args) step.args = record.args;
        if (record.permission) step.permission = record.permission;
        if (record.result_meta) step.resultMeta = record.result_meta;
        if (status === 'tool complete') step.result = record.result ?? legacyResult(record.detail);
        else step.error = record.error || legacyResult(record.detail) || 'The tool reported an error.';
        break;
      }
      case 'reasoning delta':
      case 'reasoning': {
        const turn = turnFor(record, true)!;
        const index = findStep(turn, s => s.kind === 'thinking' && s.state === 'running' && s.agent === agent);
        const text = String(record.detail || '');
        if (index >= 0) {
          const step = editStep(turn, index);
          step.text = status === 'reasoning' && text ? text : ((step.text || '') + text).slice(0, MAX_THINKING);
          if (status === 'reasoning') {
            step.state = 'done';
            step.endedAt = record.time;
          }
        } else if (text.trim()) {
          addStep(turn, {key: `${agent}:think:${seq}`, kind: 'thinking', state: status === 'reasoning' ? 'done' : 'running', seq, agent, agentName: subagentName(agent), runId: record.run_id, text: text.slice(0, MAX_THINKING), startedAt: record.time, endedAt: status === 'reasoning' ? record.time : undefined});
        }
        break;
      }
      case 'model start': {
        const seen = peek(record);
        if (seen && seen.steps.some(s => s.kind === 'thinking' && s.state === 'running' && s.agent === agent)) finishThinking(turnFor(record, false)!, agent, record.time);
        break;
      }
      case 'response delta': {
        if (subagentName(agent)) break;
        const seen = peek(record);
        if (seen && !seen.writing && seen.state === 'running') turnFor(record, false)!.writing = true;
        break;
      }
      case 'agent complete': {
        const seen = peek(record);
        if (!seen) break;
        const thinking = seen.steps.some(s => s.kind === 'thinking' && s.state === 'running' && s.agent === agent);
        const stopWriting = !subagentName(agent) && seen.writing;
        if (!thinking && !stopWriting) break;
        const turn = turnFor(record, false)!;
        finishThinking(turn, agent, record.time);
        if (stopWriting) turn.writing = false;
        break;
      }
      case 'model error': {
        const turn = turnFor(record, true)!;
        finishThinking(turn, agent, record.time);
        addStep(turn, {key: `${agent}:error:${seq}`, kind: 'error', state: 'error', seq, agent, agentName: subagentName(agent), text: record.detail || 'The model returned an error.', startedAt: record.time, endedAt: record.time});
        turn.writing = false;
        break;
      }
      case 'instruction applied':
      case 'instruction rejected': {
        const turn = turnFor(record, true)!;
        addStep(turn, {key: `note:${seq}`, kind: 'note', state: status === 'instruction applied' ? 'done' : 'error', seq, agent, text: status === 'instruction applied' ? `Guidance delivered: ${record.detail || ''}` : `Guidance was not delivered: ${record.detail || ''}`, startedAt: record.time});
        break;
      }
      case 'context compact complete': {
        const turn = turnFor(record, true)!;
        addStep(turn, {key: `note:${seq}`, kind: 'note', state: 'done', seq, agent, text: 'Compacted older context to stay within the model limit.', startedAt: record.time});
        break;
      }
      case 'context compact error': {
        const turn = turnFor(record, true)!;
        addStep(turn, {key: `note:${seq}`, kind: 'error', state: 'error', seq, agent, text: `Context compaction failed: ${record.detail || ''}`, startedAt: record.time});
        break;
      }
      default:
        break;
    }
  }

  if (!changed && maxSeq === state.maxSeq) return state;
  return {turns, maxSeq};
}

export function stepDuration(step: Step, now = Date.now()): number | undefined {
  if (step.durationMs != null) return step.durationMs;
  const start = Date.parse(step.startedAt || '');
  if (!Number.isFinite(start)) return undefined;
  const end = step.endedAt ? Date.parse(step.endedAt) : now;
  return Number.isFinite(end) ? Math.max(0, end - start) : undefined;
}

export function turnToolSteps(turn: Turn): Step[] {
  return turn.steps.filter(step => step.kind === 'tool');
}

export function runningStep(turn: Turn | undefined): Step | undefined {
  if (!turn) return undefined;
  for (let i = turn.steps.length - 1; i >= 0; i--) {
    const step = turn.steps[i];
    if (step.state === 'running' && step.kind === 'tool') return step;
  }
  return undefined;
}
